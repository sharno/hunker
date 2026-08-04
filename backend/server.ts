import { Data, Effect, Layer, Option, Schema as S } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { createServer } from "node:http";

import {
  NodeHttpClient,
  NodeHttpServer,
  NodeRuntime,
  NodeServices,
} from "@effect/platform-node";

import { isGeneratedDiffPath, parseGitDiff } from "../src/diff";
import { RepositorySearchMode } from "../src/features/code-search";
import { PullRequestFilter } from "../src/features/repository-pulls";
import {
  CharacterDiffEngine,
  CharacterDiffFailed,
  layer as characterDiffLayer,
} from "./character-diff-engine";
import {
  loadPullCommits,
  loadRepositoryPullRequests,
  loadReviewMetadata,
  parseGitHubUrl,
} from "./github";
import type { FileStatus } from "./github";
import { layer as githubAuthLayer } from "./github-auth";
import { LocalGit, LocalGitFailed, layer as localGitLayer } from "./local-git";
import {
  LocalRepository,
  LocalRepositoryFailed,
  layer as localRepositoryLayer,
} from "./local-repository";
import {
  loadReviewComments,
  replyToReviewComment,
  submitPullRequestReview,
} from "./github-reviews";
import {
  SemanticDiffEngine,
  SemanticEngineFailed,
  layer as semanticDiffLayer,
} from "./semantic-engine";
import {
  isGitOid,
  localFallback,
  loadPinnedDiff,
  loadPinnedFilePair,
  loadPinnedFilePairs,
  loadReviewData,
  pinnedRefs,
} from "./review-backing";
import {
  HunkerSettings,
  SettingsFailed,
  loadSettings,
  saveSettings,
} from "./settings";

class InvalidFileRequest extends Data.TaggedError("InvalidFileRequest")<{
  readonly message: string;
}> {}

class InvalidReviewRequest extends Data.TaggedError("InvalidReviewRequest")<{
  readonly message: string;
}> {}

const repositoryId = (target: Readonly<{ owner: string; repo: string }>) => ({
  owner: target.owner,
  name: target.repo,
});

const isFileStatus = (value: string): value is FileStatus =>
  value === "modified" ||
  value === "added" ||
  value === "deleted" ||
  value === "renamed";

const fileRequest = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const requestUrl = new URL(request.url, "http://localhost:8787");
    const target = yield* parseGitHubUrl(
      requestUrl.searchParams.get("url") ?? "",
    );
    const path = requestUrl.searchParams.get("path") ?? "";
    const previousPath = requestUrl.searchParams.get("previousPath") ?? "";
    const status = requestUrl.searchParams.get("status") ?? "";
    if (path === "" || !isFileStatus(status)) {
      return yield* new InvalidFileRequest({
        message: "Choose a reviewable file before loading its revisions.",
      });
    }
    return { target, path, previousPath, status, refs: pinnedRefs(requestUrl) };
  });

const pullTarget = (url: string) =>
  Effect.gen(function* () {
    const target = yield* parseGitHubUrl(url);
    if (target._tag !== "PullTarget") {
      return yield* new InvalidReviewRequest({
        message:
          "GitHub reviews are available for pull requests, not compare URLs.",
      });
    }
    return target;
  });

const localRepositoryRequest = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const requestUrl = new URL(request.url, "http://localhost:8787");
    const [owner, name, ...remaining] = (
      requestUrl.searchParams.get("repository") ?? ""
    ).split("/");
    if (
      remaining.length > 0 ||
      owner === undefined ||
      owner === "" ||
      name === undefined ||
      name === ""
    ) {
      return yield* new InvalidReviewRequest({
        message: "Choose a repository in owner/name format.",
      });
    }
    return { requestUrl, repository: { owner, name } };
  });

const ReplyBody = S.Struct({
  url: S.String,
  commentId: S.Number,
  body: S.String,
});

const SubmitReviewBody = S.Struct({
  url: S.String,
  body: S.String,
  event: S.Literals(["COMMENT", "APPROVE", "REQUEST_CHANGES"]),
});

const CloneRepositoryBody = S.Struct({
  repository: S.String,
  destination: S.Literals(["temporary", "configured"]),
});

const SaveSettingsBody = S.Struct({ settings: HunkerSettings });

const decodeBody = <A, I>(
  request: HttpServerRequest.HttpServerRequest,
  schema: S.Codec<A, I>,
) =>
  request.json.pipe(
    Effect.flatMap(S.decodeUnknownEffect(schema)),
    Effect.mapError(
      () =>
        new InvalidReviewRequest({
          message: "The review request body is invalid.",
        }),
    ),
  );

const handleDiff = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const requestUrl = new URL(request.url, "http://localhost:8787");
    const target = yield* parseGitHubUrl(
      requestUrl.searchParams.get("url") ?? "",
    );
    const review = yield* loadReviewData(target);
    return HttpServerResponse.jsonUnsafe(review);
  }).pipe(
    Effect.catchTags({
      InvalidGitHubUrl: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: 400 },
          ),
        ),
      GitHubFetchFailed: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: error.status },
          ),
        ),
    }),
  );

const handleCommits = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const requestUrl = new URL(request.url, "http://localhost:8787");
    const target = yield* pullTarget(requestUrl.searchParams.get("url") ?? "");
    const requestedRefs = pinnedRefs(requestUrl);
    const refs = Option.isSome(requestedRefs)
      ? requestedRefs.value
      : yield* loadReviewMetadata(target).pipe(
          Effect.map((metadata) => ({
            base: metadata.baseOid,
            head: metadata.headOid,
          })),
        );
    const localGit = yield* LocalGit;
    const local = yield* localFallback(
      localGit.loadCommits({
        repository: repositoryId(target),
        baseOid: refs.base,
        headOid: refs.head,
        pullNumber: target.number,
      }),
    );
    const commits = Option.isSome(local)
      ? local.value
      : yield* loadPullCommits(target);
    return HttpServerResponse.jsonUnsafe({ commits });
  }).pipe(
    Effect.catchTags({
      InvalidGitHubUrl: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: 400 },
          ),
        ),
      InvalidReviewRequest: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: 400 },
          ),
        ),
      GitHubFetchFailed: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: error.status },
          ),
        ),
    }),
  );

const localRepositoryError = (error: LocalRepositoryFailed) =>
  Effect.succeed(
    HttpServerResponse.jsonUnsafe(
      { error: error.message },
      { status: error.status },
    ),
  );

const handleRepositoryFiles = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const { repository } = yield* localRepositoryRequest(request);
    const local = yield* LocalRepository;
    const files = yield* local.listFiles(repository);
    return HttpServerResponse.jsonUnsafe({ files });
  }).pipe(
    Effect.catchTags({
      InvalidReviewRequest: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: 400 },
          ),
        ),
      LocalRepositoryFailed: localRepositoryError,
    }),
  );

const handleRepositoryCommits = (
  request: HttpServerRequest.HttpServerRequest,
) =>
  Effect.gen(function* () {
    const { repository } = yield* localRepositoryRequest(request);
    const local = yield* LocalRepository;
    return HttpServerResponse.jsonUnsafe(yield* local.listCommits(repository));
  }).pipe(
    Effect.catchTags({
      InvalidReviewRequest: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: 400 },
          ),
        ),
      LocalRepositoryFailed: localRepositoryError,
    }),
  );

const handleRepositoryPullRequests = (
  request: HttpServerRequest.HttpServerRequest,
) =>
  Effect.gen(function* () {
    const { requestUrl, repository } = yield* localRepositoryRequest(request);
    const state = Option.getOrElse(
      S.decodeUnknownOption(PullRequestFilter)(
        requestUrl.searchParams.get("state") ?? "open",
      ),
      (): "open" => "open",
    );
    const page = Number(requestUrl.searchParams.get("page") ?? "1");
    if (!Number.isInteger(page) || page < 1 || page > 1_000) {
      return yield* new InvalidReviewRequest({
        message: "Pull request page must be between 1 and 1000.",
      });
    }
    return HttpServerResponse.jsonUnsafe(
      yield* loadRepositoryPullRequests(repository, state, page),
    );
  }).pipe(
    Effect.catchTags({
      InvalidReviewRequest: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: 400 },
          ),
        ),
      GitHubFetchFailed: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: error.status },
          ),
        ),
    }),
  );

const handleRepositorySearch = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const { requestUrl, repository } = yield* localRepositoryRequest(request);
    const query = requestUrl.searchParams.get("query")?.trim() ?? "";
    if (query === "") {
      return yield* new InvalidReviewRequest({
        message: "Enter a search query.",
      });
    }
    const mode = Option.getOrElse(
      S.decodeUnknownOption(RepositorySearchMode)(
        requestUrl.searchParams.get("mode") ?? "literal",
      ),
      (): "literal" => "literal",
    );
    const local = yield* LocalRepository;
    const results = yield* local.search(repository, query, mode);
    return HttpServerResponse.jsonUnsafe(results);
  }).pipe(
    Effect.catchTags({
      InvalidReviewRequest: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: 400 },
          ),
        ),
      LocalRepositoryFailed: localRepositoryError,
    }),
  );

const handleRepositoryFile = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const { requestUrl, repository } = yield* localRepositoryRequest(request);
    const local = yield* LocalRepository;
    const file = yield* local.readFile(
      repository,
      requestUrl.searchParams.get("path") ?? "",
    );
    return HttpServerResponse.jsonUnsafe(file);
  }).pipe(
    Effect.catchTags({
      InvalidReviewRequest: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: 400 },
          ),
        ),
      LocalRepositoryFailed: localRepositoryError,
    }),
  );

const handleCloneRepository = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const input = yield* decodeBody(request, CloneRepositoryBody);
    const [owner, name, ...remaining] = input.repository.split("/");
    if (
      remaining.length > 0 ||
      owner === undefined ||
      owner === "" ||
      name === undefined ||
      name === ""
    ) {
      return yield* new InvalidReviewRequest({
        message: "Choose a repository in owner/name format.",
      });
    }
    const local = yield* LocalRepository;
    const cloned = yield* local.clone({ owner, name }, input.destination);
    return HttpServerResponse.jsonUnsafe(cloned);
  }).pipe(
    Effect.catchTags({
      InvalidReviewRequest: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: 400 },
          ),
        ),
      LocalRepositoryFailed: localRepositoryError,
    }),
  );

const handleRepositories = Effect.gen(function* () {
  const local = yield* LocalRepository;
  return HttpServerResponse.jsonUnsafe(yield* local.listRepositories);
}).pipe(Effect.catchTag("LocalRepositoryFailed", localRepositoryError));

const settingsError = (error: SettingsFailed) =>
  Effect.succeed(
    HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 500 }),
  );

const handleSettings = Effect.gen(function* () {
  return HttpServerResponse.jsonUnsafe(yield* loadSettings);
}).pipe(Effect.catchTag("SettingsFailed", settingsError));

const handleSaveSettings = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const { settings } = yield* decodeBody(request, SaveSettingsBody);
    return HttpServerResponse.jsonUnsafe(yield* saveSettings(settings));
  }).pipe(
    Effect.catchTags({
      InvalidReviewRequest: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: 400 },
          ),
        ),
      SettingsFailed: settingsError,
    }),
  );

const handleSemantic = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const { target, path, previousPath, status, refs } =
      yield* fileRequest(request);
    const pair = yield* loadPinnedFilePair(
      target,
      refs,
      path,
      previousPath,
      status,
    );
    const semantic = yield* SemanticDiffEngine;
    const result = yield* semantic.analyzeFile({
      path,
      previousPath,
      status,
      ...pair,
    });
    return HttpServerResponse.jsonUnsafe(result);
  }).pipe(
    Effect.catchTags({
      InvalidGitHubUrl: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: 400 },
          ),
        ),
      InvalidFileRequest: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: 400 },
          ),
        ),
      GitHubFetchFailed: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: error.status },
          ),
        ),
    }),
  );

const handleFile = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const { target, path, previousPath, status, refs } =
      yield* fileRequest(request);
    const pair = yield* loadPinnedFilePair(
      target,
      refs,
      path,
      previousPath,
      status,
    );
    return HttpServerResponse.jsonUnsafe(pair);
  }).pipe(
    Effect.catchTags({
      InvalidGitHubUrl: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: 400 },
          ),
        ),
      InvalidFileRequest: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: 400 },
          ),
        ),
      GitHubFetchFailed: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: error.status },
          ),
        ),
    }),
  );

const handleCharacters = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const requestUrl = new URL(request.url, "http://localhost:8787");
    const { target, path, previousPath, status, refs } =
      yield* fileRequest(request);
    const pair = yield* loadPinnedFilePair(
      target,
      refs,
      path,
      previousPath,
      status,
    );
    const engine = yield* CharacterDiffEngine;
    const mode = requestUrl.searchParams.get("mode");
    const result = yield* engine.analyzeFile({
      path,
      ...pair,
      ignoreWhitespace: requestUrl.searchParams.get("whitespace") === "ignore",
      mode: mode === "character" ? "character" : "token",
    });
    return HttpServerResponse.jsonUnsafe(result);
  }).pipe(
    Effect.catchTags({
      InvalidGitHubUrl: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: 400 },
          ),
        ),
      InvalidFileRequest: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: 400 },
          ),
        ),
      GitHubFetchFailed: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: error.status },
          ),
        ),
      CharacterDiffFailed: (error: CharacterDiffFailed) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: error.status },
          ),
        ),
    }),
  );

const handleReviews = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const requestUrl = new URL(request.url, "http://localhost:8787");
    const target = yield* pullTarget(requestUrl.searchParams.get("url") ?? "");
    const comments = yield* loadReviewComments(target);
    return HttpServerResponse.jsonUnsafe({ comments });
  }).pipe(
    Effect.catchTags({
      InvalidGitHubUrl: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: 400 },
          ),
        ),
      InvalidReviewRequest: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: 400 },
          ),
        ),
      GitHubFetchFailed: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: error.status },
          ),
        ),
    }),
  );

const handleReviewReply = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const input = yield* decodeBody(request, ReplyBody);
    if (input.body.trim() === "") {
      return yield* new InvalidReviewRequest({
        message: "Write a reply before posting.",
      });
    }
    const target = yield* pullTarget(input.url);
    const comment = yield* replyToReviewComment(
      target,
      input.commentId,
      input.body.trim(),
    );
    if (comment === undefined) {
      return yield* new InvalidReviewRequest({
        message: "GitHub returned an unexpected reply response.",
      });
    }
    return HttpServerResponse.jsonUnsafe({ comment });
  }).pipe(
    Effect.catchTags({
      InvalidGitHubUrl: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: 400 },
          ),
        ),
      InvalidReviewRequest: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: 400 },
          ),
        ),
      GitHubFetchFailed: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: error.status },
          ),
        ),
    }),
  );

const handleSubmitReview = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const input = yield* decodeBody(request, SubmitReviewBody);
    if (input.event !== "APPROVE" && input.body.trim() === "") {
      return yield* new InvalidReviewRequest({
        message: "Comment and request-changes reviews require a summary.",
      });
    }
    const target = yield* pullTarget(input.url);
    yield* submitPullRequestReview(target, input.body.trim(), input.event);
    return HttpServerResponse.jsonUnsafe({ event: input.event });
  }).pipe(
    Effect.catchTags({
      InvalidGitHubUrl: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: 400 },
          ),
        ),
      InvalidReviewRequest: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: 400 },
          ),
        ),
      GitHubFetchFailed: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: error.status },
          ),
        ),
    }),
  );

const handleMoves = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const requestUrl = new URL(request.url, "http://localhost:8787");
    const target = yield* parseGitHubUrl(
      requestUrl.searchParams.get("url") ?? "",
    );
    const refs = pinnedRefs(requestUrl);
    const diff = yield* loadPinnedDiff(target, refs);
    const files = parseGitDiff(diff).filter(
      (file) => file.patch.includes("@@") && !isGeneratedDiffPath(file.path),
    );
    const pairs = yield* loadPinnedFilePairs(target, refs, files);
    const semantic = yield* SemanticDiffEngine;
    const moves = yield* semantic.analyzeReview(pairs);
    return HttpServerResponse.jsonUnsafe({ moves });
  }).pipe(
    Effect.catchTags({
      InvalidGitHubUrl: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: 400 },
          ),
        ),
      GitHubFetchFailed: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: error.status },
          ),
        ),
      SemanticEngineFailed: (error: SemanticEngineFailed) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: error.status },
          ),
        ),
    }),
  );

const handleRevision = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const requestUrl = new URL(request.url, "http://localhost:8787");
    const target = yield* pullTarget(requestUrl.searchParams.get("url") ?? "");
    const headOid = requestUrl.searchParams.get("headOid") ?? "";
    if (!isGitOid(headOid)) {
      return yield* new InvalidReviewRequest({
        message: "A pinned pull request revision is required.",
      });
    }
    const localGit = yield* LocalGit;
    const status = yield* localGit.checkPullRevision(
      repositoryId(target),
      target.number,
      headOid,
    );
    return HttpServerResponse.jsonUnsafe(
      Option.match(status, {
        onNone: () => ({ source: "github" as const }),
        onSome: (revision) => ({
          source: "local" as const,
          path: revision.repository.path,
          pinnedHeadOid: revision.pinnedHeadOid,
          latestHeadOid: revision.latestHeadOid,
          checkedAt: revision.checkedAt,
          current: revision.pinnedHeadOid === revision.latestHeadOid,
        }),
      }),
    );
  }).pipe(
    Effect.catchTags({
      InvalidGitHubUrl: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: 400 },
          ),
        ),
      InvalidReviewRequest: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: 400 },
          ),
        ),
      LocalGitFailed: (error: LocalGitFailed) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            { status: error.status },
          ),
        ),
    }),
  );

const platformLayer = Layer.mergeAll(
  NodeServices.layer,
  NodeHttpClient.layerUndici,
);

const applicationLayer = Layer.mergeAll(
  localRepositoryLayer,
  localGitLayer,
  characterDiffLayer,
  githubAuthLayer,
  semanticDiffLayer,
).pipe(Layer.provide(platformLayer));

const runtimeLayer = Layer.mergeAll(platformLayer, applicationLayer);

const routesLayer = Layer.mergeAll(
  HttpRouter.add("GET", "/api/settings", handleSettings),
  HttpRouter.add("PUT", "/api/settings", handleSaveSettings),
  HttpRouter.add("GET", "/api/diff", handleDiff),
  HttpRouter.add("GET", "/api/revision", handleRevision),
  HttpRouter.add("GET", "/api/commits", handleCommits),
  HttpRouter.add("GET", "/api/repositories", handleRepositories),
  HttpRouter.add("GET", "/api/repository/files", handleRepositoryFiles),
  HttpRouter.add("GET", "/api/repository/commits", handleRepositoryCommits),
  HttpRouter.add("GET", "/api/repository/pulls", handleRepositoryPullRequests),
  HttpRouter.add("GET", "/api/repository/search", handleRepositorySearch),
  HttpRouter.add("GET", "/api/repository/file", handleRepositoryFile),
  HttpRouter.add("POST", "/api/repository/clone", handleCloneRepository),
  HttpRouter.add("GET", "/api/file", handleFile),
  HttpRouter.add("GET", "/api/characters", handleCharacters),
  HttpRouter.add("GET", "/api/semantic", handleSemantic),
  HttpRouter.add("GET", "/api/moves", handleMoves),
  HttpRouter.add("GET", "/api/reviews", handleReviews),
  HttpRouter.add("POST", "/api/reviews/reply", handleReviewReply),
  HttpRouter.add("POST", "/api/reviews/submit", handleSubmitReview),
).pipe(HttpRouter.provideRequest(runtimeLayer));

const httpAppLayer = Layer.merge(
  routesLayer,
  HttpRouter.cors({ allowedOrigins: ["http://localhost:5173"] }),
);

const mainLayer = HttpRouter.serve(httpAppLayer).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port: 8787 })),
);

NodeRuntime.runMain(Layer.launch(mainLayer));
