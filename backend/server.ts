import { Data, Effect, Layer, Schema as S } from "effect";
import {
  HttpMiddleware,
  HttpRouter,
  HttpServer,
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
import {
  CharacterDiffEngine,
  CharacterDiffFailed,
  NativeGitCharacterLive,
} from "./character-diff-engine";
import {
  GitHubFetchFailed,
  InvalidGitHubUrl,
  loadFilePair,
  loadFilePairs,
  loadPullCommits,
  loadReview,
  parseGitHubUrl,
} from "./github";
import type { FileStatus } from "./github";
import { GitHubAuthLive } from "./github-auth";
import {
  LocalRepository,
  LocalRepositoryFailed,
  LocalRepositoryLive,
} from "./local-repository";
import {
  loadReviewComments,
  replyToReviewComment,
  submitPullRequestReview,
} from "./github-reviews";
import {
  AstGrepSemanticLive,
  SemanticDiffEngine,
  SemanticEngineFailed,
} from "./semantic-engine";

class InvalidFileRequest extends Data.TaggedError("InvalidFileRequest")<{
  readonly message: string;
}> {}

class InvalidReviewRequest extends Data.TaggedError("InvalidReviewRequest")<{
  readonly message: string;
}> {}

const isFileStatus = (value: string): value is FileStatus =>
  value === "modified" ||
  value === "added" ||
  value === "deleted" ||
  value === "renamed";

const fileRequest = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const requestUrl = new URL(request.url, "http://localhost:8787");
    const target = yield* parseGitHubUrl(requestUrl.searchParams.get("url") ?? "");
    const path = requestUrl.searchParams.get("path") ?? "";
    const previousPath = requestUrl.searchParams.get("previousPath") ?? "";
    const status = requestUrl.searchParams.get("status") ?? "";
    if (path === "" || !isFileStatus(status)) {
      return yield* new InvalidFileRequest({
        message: "Choose a reviewable file before loading its revisions.",
      });
    }
    return { target, path, previousPath, status };
  });

const pullTarget = (url: string) =>
  Effect.gen(function* () {
    const target = yield* parseGitHubUrl(url);
    if (target._tag !== "PullTarget") {
      return yield* new InvalidReviewRequest({
        message: "GitHub reviews are available for pull requests, not compare URLs.",
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

const decodeBody = <A, I>(
  request: HttpServerRequest.HttpServerRequest,
  schema: S.Codec<A, I>,
) =>
  request.json.pipe(
    Effect.flatMap(S.decodeUnknownEffect(schema)),
    Effect.mapError(() =>
      new InvalidReviewRequest({ message: "The review request body is invalid." }),
    ),
  );

const handleDiff = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const requestUrl = new URL(request.url, "http://localhost:8787");
    const target = yield* parseGitHubUrl(requestUrl.searchParams.get("url") ?? "");
    const review = yield* loadReview(target);
    return HttpServerResponse.jsonUnsafe(review);
  }).pipe(
    Effect.catchTags({
      InvalidGitHubUrl: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 400 }),
        ),
      GitHubFetchFailed: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: error.status }),
        ),
    }),
  );

const handleCommits = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const requestUrl = new URL(request.url, "http://localhost:8787");
    const target = yield* pullTarget(requestUrl.searchParams.get("url") ?? "");
    const commits = yield* loadPullCommits(target);
    return HttpServerResponse.jsonUnsafe({ commits });
  }).pipe(
    Effect.catchTags({
      InvalidGitHubUrl: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 400 }),
        ),
      InvalidReviewRequest: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 400 }),
        ),
      GitHubFetchFailed: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: error.status }),
        ),
    }),
  );

const localRepositoryError = (error: LocalRepositoryFailed) =>
  Effect.succeed(
    HttpServerResponse.jsonUnsafe({ error: error.message }, { status: error.status }),
  );

const handleRepositoryFiles = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const { repository } = yield* localRepositoryRequest(request);
    const local = yield* LocalRepository;
    const files = yield* local.listFiles(repository);
    return HttpServerResponse.jsonUnsafe({ files });
  }).pipe(
    Effect.catchTags({
      InvalidReviewRequest: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 400 }),
        ),
      LocalRepositoryFailed: localRepositoryError,
    }),
  );

const handleRepositorySearch = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const { requestUrl, repository } = yield* localRepositoryRequest(request);
    const query = requestUrl.searchParams.get("query")?.trim() ?? "";
    if (query === "") {
      return yield* new InvalidReviewRequest({ message: "Enter a search query." });
    }
    const local = yield* LocalRepository;
    const results = yield* local.search(repository, query);
    return HttpServerResponse.jsonUnsafe(results);
  }).pipe(
    Effect.catchTags({
      InvalidReviewRequest: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 400 }),
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
      InvalidReviewRequest: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 400 }),
        ),
      LocalRepositoryFailed: localRepositoryError,
    }),
  );

const handleSemantic = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const { target, path, previousPath, status } = yield* fileRequest(request);
    const pair = yield* loadFilePair(
      target,
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
      InvalidGitHubUrl: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 400 }),
        ),
      InvalidFileRequest: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 400 }),
        ),
      GitHubFetchFailed: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: error.status }),
        ),
    }),
  );

const handleFile = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const { target, path, previousPath, status } = yield* fileRequest(request);
    const pair = yield* loadFilePair(target, path, previousPath, status);
    return HttpServerResponse.jsonUnsafe(pair);
  }).pipe(
    Effect.catchTags({
      InvalidGitHubUrl: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 400 }),
        ),
      InvalidFileRequest: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 400 }),
        ),
      GitHubFetchFailed: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: error.status }),
        ),
    }),
  );

const handleCharacters = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const requestUrl = new URL(request.url, "http://localhost:8787");
    const { target, path, previousPath, status } = yield* fileRequest(request);
    const pair = yield* loadFilePair(target, path, previousPath, status);
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
      InvalidGitHubUrl: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 400 }),
        ),
      InvalidFileRequest: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 400 }),
        ),
      GitHubFetchFailed: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: error.status }),
        ),
      CharacterDiffFailed: (error: CharacterDiffFailed) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: error.status }),
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
      InvalidGitHubUrl: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 400 }),
        ),
      InvalidReviewRequest: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 400 }),
        ),
      GitHubFetchFailed: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: error.status }),
        ),
    }),
  );

const handleReviewReply = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const input = yield* decodeBody(request, ReplyBody);
    if (input.body.trim() === "") {
      return yield* new InvalidReviewRequest({ message: "Write a reply before posting." });
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
      InvalidGitHubUrl: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 400 }),
        ),
      InvalidReviewRequest: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 400 }),
        ),
      GitHubFetchFailed: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: error.status }),
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
      InvalidGitHubUrl: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 400 }),
        ),
      InvalidReviewRequest: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 400 }),
        ),
      GitHubFetchFailed: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: error.status }),
        ),
    }),
  );

const handleMoves = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const requestUrl = new URL(request.url, "http://localhost:8787");
    const target = yield* parseGitHubUrl(requestUrl.searchParams.get("url") ?? "");
    const review = yield* loadReview(target);
    const files = parseGitDiff(review.diff).filter(
      file => file.patch.includes("@@") && !isGeneratedDiffPath(file.path),
    );
    const pairs = yield* loadFilePairs(target, files);
    const semantic = yield* SemanticDiffEngine;
    const moves = yield* semantic.analyzeReview(pairs);
    return HttpServerResponse.jsonUnsafe({ moves });
  }).pipe(
    Effect.catchTags({
      InvalidGitHubUrl: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 400 }),
        ),
      GitHubFetchFailed: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: error.status }),
        ),
      SemanticEngineFailed: (error: SemanticEngineFailed) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: error.status }),
        ),
    }),
  );

const Routes = Layer.mergeAll(
  HttpRouter.add("GET", "/api/diff", handleDiff),
  HttpRouter.add("GET", "/api/commits", handleCommits),
  HttpRouter.add("GET", "/api/repository/files", handleRepositoryFiles),
  HttpRouter.add("GET", "/api/repository/search", handleRepositorySearch),
  HttpRouter.add("GET", "/api/repository/file", handleRepositoryFile),
  HttpRouter.add("GET", "/api/file", handleFile),
  HttpRouter.add("GET", "/api/characters", handleCharacters),
  HttpRouter.add("GET", "/api/semantic", handleSemantic),
  HttpRouter.add("GET", "/api/moves", handleMoves),
  HttpRouter.add("GET", "/api/reviews", handleReviews),
  HttpRouter.add("POST", "/api/reviews/reply", handleReviewReply),
  HttpRouter.add("POST", "/api/reviews/submit", handleSubmitReview),
).pipe(
  Layer.provide(LocalRepositoryLive),
  Layer.provide(NativeGitCharacterLive),
  Layer.provide(NodeHttpClient.layerUndici),
  Layer.provide(GitHubAuthLive),
  Layer.provide(AstGrepSemanticLive),
  Layer.provide(NodeServices.layer),
);

const HttpAppLive = Layer.unwrap(
  HttpRouter.toHttpEffect(Routes).pipe(
    Effect.map(HttpServer.serve(HttpMiddleware.cors({ allowedOrigins: ["http://localhost:5173"] }))),
  ),
);

const Main = HttpAppLive.pipe(
  HttpServer.withLogAddress,
  Layer.provide(NodeHttpServer.layer(createServer, { port: 8787 })),
  Layer.provide(LocalRepositoryLive),
  Layer.provide(NodeHttpClient.layerUndici),
  Layer.provide(GitHubAuthLive),
  Layer.provide(AstGrepSemanticLive),
  Layer.provide(NativeGitCharacterLive),
  Layer.provide(NodeServices.layer),
);

NodeRuntime.runMain(Layer.launch(Main));
