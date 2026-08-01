import { Effect, Match as M, Option, Schema as S } from "effect";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
} from "effect/unstable/http";
import { Command, Http, Navigation, Runtime, Url } from "foldkit";
import { evo } from "foldkit/struct";

import {
  ChangedFilter,
  ChangedBrowserUrl,
  ChangedToolbarCompact,
  ChangedPrUrl,
  ChangedReplyDraft,
  ChangedRepositoryQuery,
  ChangedReviewBody,
  ClosedRepositoryFile,
  ClosedToolbarMenus,
  CharacterDiffResult,
  CompletedNavigation,
  FailedCommitDiff,
  FailedCommits,
  FailedCharacterDiff,
  FailedFullFile,
  FailedGitHubReviews,
  FailedMoves,
  FailedReply,
  FailedReview,
  FailedReviewSubmission,
  FailedRepositoryFile,
  FailedRepositoryFiles,
  FailedRepositorySearch,
  FailedSemantic,
  GitHubReviewComment,
  LoadedCharacterDiff,
  LoadedCommitDiff,
  LoadedCommits,
  LoadedFullFile,
  LoadedGitHubReviews,
  LoadedMoves,
  LoadedReview,
  LoadedRepositoryFile,
  LoadedRepositoryFiles,
  LoadedRepositorySearch,
  LoadedSemantic,
  Model,
  MovedBlock,
  PostedReply,
  PostedReview,
  RefreshedReview,
  RequestedNavigation,
  SelectedFile,
  SelectedCommit,
  SelectedReviewTab,
  SelectedRepositoryFile,
  SelectedReviewScope,
  SelectedViewMode,
  SemanticResult,
  SubmittedReply,
  SubmittedReview,
  SubmittedRepositorySearch,
  ReturnedToCommitList,
  SelectedInlineDiffMode,
  ToggledFileCollapse,
  ToggledFullFile,
  ToggledGitHubReviews,
  ToggledReviewThreadCollapse,
  ToggledHunkCollapse,
  ToggledReviewed,
  ToggledSemantic,
  ToggledSidebar,
  ToggledSyntaxHighlighting,
  ToggledToolbarMenu,
  ToggledWhitespace,
} from "./domain";
import type {
  FileChange,
  Message,
  Model as ModelType,
  ReviewMeta,
} from "./domain";
import { hunkKey, parseGitDiff } from "./diff";
import {
  commitGitHubUrl,
  FetchCommitDiff,
  FetchCommits,
} from "./features/commits";
import {
  changeRepositoryQuery,
  closeRepositoryFile,
  loadRepositoryLocation,
  repositoryFileFailed,
  repositoryFileLoaded,
  repositoryFilesFailed,
  repositoryFilesLoaded,
  repositoryOptionsFromSearch,
  repositoryRouteFromPathname,
  repositorySearchFailed,
  repositorySearchLoaded,
  selectRepositoryFile,
  submitRepositorySearch,
} from "./features/repository";
import {
  defaultReviewOptions,
  githubUrlFromPathname,
  localReviewUrl,
  reviewOptionsFromSearch,
  type ReviewOptions,
} from "./review-route";
import { sampleFiles, sampleMeta } from "./sample";

type UpdateReturn = readonly [ModelType, ReadonlyArray<Command.Command<Message>>];
type ApiReview = Readonly<ReviewMeta & { diff: string }>;

const toggleMembership = <A>(values: ReadonlyArray<A>, value: A) =>
  values.includes(value) ? values.filter(item => item !== value) : [...values, value];

const setMembership = <A>(
  values: ReadonlyArray<A>,
  value: A,
  included: boolean,
) =>
  included
    ? values.includes(value)
      ? values
      : [...values, value]
    : values.filter(item => item !== value);

const isApiReview = (value: unknown): value is ApiReview => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return ["title", "repository", "number", "author", "base", "head", "url", "diff"].every(
    key => typeof record[key] === "string",
  );
};

const fetchErrorMessage = (error: unknown): string => {
  if (
    HttpClientError.isHttpClientError(error) &&
    error.reason._tag === "TransportError"
  ) {
    return "Hunker’s local backend is offline. Start it with `bun run dev`, then retry.";
  }
  return error instanceof Error ? error.message : "Could not load that change.";
};

const responseError = (value: unknown, fallback: string) =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Record<string, unknown>).error === "string"
    ? String((value as Record<string, unknown>).error)
    : fallback;

const FetchReview = Command.define("FetchReview", {
  args: { url: S.String },
  messages: [LoadedReview, FailedReview],
  execute: ({ url }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const cacheBust = yield* Effect.sync(() => Date.now().toString());
      const request = HttpClientRequest.get(
        `/api/diff?url=${encodeURIComponent(url)}&refresh=${cacheBust}`,
      );
      const response = yield* client.execute(request);
      const data: unknown = yield* response.json;

      if (response.status < 200 || response.status >= 300) {
        return yield* Effect.fail(
          new Error(responseError(data, "Could not load that change.")),
        );
      }
      if (!isApiReview(data)) {
        return yield* Effect.fail(new Error("GitHub returned an unexpected response."));
      }

      const { diff, ...meta } = data;
      const files = parseGitDiff(diff);
      if (files.length === 0) {
        return yield* Effect.fail(new Error("This change has no reviewable text diff."));
      }
      return LoadedReview({ requestedUrl: url, meta, files });
    }).pipe(
      Effect.catch(error =>
        Effect.succeed(FailedReview({ requestedUrl: url, error: fetchErrorMessage(error) })),
      ),
      Effect.provide(Http.layer),
    ),
});

const Navigate = Command.define("Navigate", {
  args: {
    href: S.String,
    method: S.Literals(["push", "replace", "load"]),
  },
  messages: [CompletedNavigation],
  execute: ({ href, method }) =>
    (method === "load"
      ? Navigation.load(href)
      : method === "replace"
        ? Navigation.replaceUrl(href)
        : Navigation.pushUrl(href)
    ).pipe(
      Effect.as(CompletedNavigation()),
    ),
});

const FetchSemantic = Command.define("FetchSemantic", {
  args: {
    url: S.String,
    path: S.String,
    previousPath: S.String,
    status: S.Literals(["modified", "added", "deleted", "renamed"]),
  },
  messages: [LoadedSemantic, FailedSemantic],
  execute: ({ url, path, previousPath, status }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const query = new URLSearchParams({ url, path, previousPath, status });
      const response = yield* client.execute(
        HttpClientRequest.get(`/api/semantic?${query.toString()}`),
      );
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        return yield* Effect.fail(
          new Error(responseError(data, "Could not run semantic analysis.")),
        );
      }
      const result = yield* S.decodeUnknownEffect(SemanticResult)(data);
      return LoadedSemantic({ requestedUrl: url, path, result });
    }).pipe(
      Effect.catch(error =>
        Effect.succeed(
          FailedSemantic({ requestedUrl: url, path, error: fetchErrorMessage(error) }),
        ),
      ),
      Effect.provide(Http.layer),
    ),
});

const MoveResponse = S.Struct({ moves: S.Array(MovedBlock) });
const FullFileResponse = S.Struct({ oldText: S.String, newText: S.String });
const GitHubReviewsResponse = S.Struct({ comments: S.Array(GitHubReviewComment) });
const GitHubReplyResponse = S.Struct({ comment: GitHubReviewComment });

const FetchCharacterDiff = Command.define("FetchCharacterDiff", {
  args: {
    url: S.String,
    path: S.String,
    previousPath: S.String,
    status: S.Literals(["modified", "added", "deleted", "renamed"]),
    ignoreWhitespace: S.Boolean,
    mode: S.Literals(["token", "character"]),
  },
  messages: [LoadedCharacterDiff, FailedCharacterDiff],
  execute: ({ url, path, previousPath, status, ignoreWhitespace, mode }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const query = new URLSearchParams({
        url,
        path,
        previousPath,
        status,
        whitespace: ignoreWhitespace ? "ignore" : "show",
        mode,
      });
      const response = yield* client.execute(
        HttpClientRequest.get(`/api/characters?${query.toString()}`),
      );
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        return yield* Effect.fail(
          new Error(responseError(data, "Could not calculate character changes.")),
        );
      }
      const result = yield* S.decodeUnknownEffect(CharacterDiffResult)(data);
      return LoadedCharacterDiff({ requestedUrl: url, result });
    }).pipe(
      Effect.catch(error =>
        Effect.succeed(
          FailedCharacterDiff({
            requestedUrl: url,
            path,
            ignoreWhitespace,
            mode,
            error: fetchErrorMessage(error),
          }),
        ),
      ),
      Effect.provide(Http.layer),
    ),
});

const FetchFullFile = Command.define("FetchFullFile", {
  args: {
    url: S.String,
    path: S.String,
    previousPath: S.String,
    status: S.Literals(["modified", "added", "deleted", "renamed"]),
  },
  messages: [LoadedFullFile, FailedFullFile],
  execute: ({ url, path, previousPath, status }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const query = new URLSearchParams({ url, path, previousPath, status });
      const response = yield* client.execute(
        HttpClientRequest.get(`/api/file?${query.toString()}`),
      );
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        return yield* Effect.fail(
          new Error(responseError(data, "Could not load the complete file.")),
        );
      }
      const pair = yield* S.decodeUnknownEffect(FullFileResponse)(data);
      return LoadedFullFile({ requestedUrl: url, path, ...pair });
    }).pipe(
      Effect.catch(error =>
        Effect.succeed(
          FailedFullFile({ requestedUrl: url, path, error: fetchErrorMessage(error) }),
        ),
      ),
      Effect.provide(Http.layer),
    ),
});

const FetchGitHubReviews = Command.define("FetchGitHubReviews", {
  args: { url: S.String },
  messages: [LoadedGitHubReviews, FailedGitHubReviews],
  execute: ({ url }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const response = yield* client.execute(
        HttpClientRequest.get(`/api/reviews?url=${encodeURIComponent(url)}`),
      );
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        return yield* Effect.fail(
          new Error(responseError(data, "Could not load GitHub reviews.")),
        );
      }
      const decoded = yield* S.decodeUnknownEffect(GitHubReviewsResponse)(data);
      return LoadedGitHubReviews({ requestedUrl: url, comments: decoded.comments });
    }).pipe(
      Effect.catch(error =>
        Effect.succeed(
          FailedGitHubReviews({ requestedUrl: url, error: fetchErrorMessage(error) }),
        ),
      ),
      Effect.provide(Http.layer),
    ),
});

const PostReviewReply = Command.define("PostReviewReply", {
  args: { url: S.String, commentId: S.Number, body: S.String },
  messages: [PostedReply, FailedReply],
  execute: ({ url, commentId, body }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const request = HttpClientRequest.post("/api/reviews/reply").pipe(
        HttpClientRequest.bodyJsonUnsafe({ url, commentId, body }),
      );
      const response = yield* client.execute(request);
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        return yield* Effect.fail(new Error(responseError(data, "Could not post reply.")));
      }
      const decoded = yield* S.decodeUnknownEffect(GitHubReplyResponse)(data);
      return PostedReply({ comment: decoded.comment });
    }).pipe(
      Effect.catch(error =>
        Effect.succeed(FailedReply({ commentId, error: fetchErrorMessage(error) })),
      ),
      Effect.provide(Http.layer),
    ),
});

const PostPullRequestReview = Command.define("PostPullRequestReview", {
  args: {
    url: S.String,
    body: S.String,
    event: S.Literals(["COMMENT", "APPROVE", "REQUEST_CHANGES"]),
  },
  messages: [PostedReview, FailedReviewSubmission],
  execute: ({ url, body, event }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const request = HttpClientRequest.post("/api/reviews/submit").pipe(
        HttpClientRequest.bodyJsonUnsafe({ url, body, event }),
      );
      const response = yield* client.execute(request);
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        return yield* Effect.fail(
          new Error(responseError(data, "Could not submit the GitHub review.")),
        );
      }
      return PostedReview({ event });
    }).pipe(
      Effect.catch(error =>
        Effect.succeed(FailedReviewSubmission({ error: fetchErrorMessage(error) })),
      ),
      Effect.provide(Http.layer),
    ),
});

const FetchMoves = Command.define("FetchMoves", {
  args: { url: S.String },
  messages: [LoadedMoves, FailedMoves],
  execute: ({ url }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const response = yield* client.execute(
        HttpClientRequest.get(`/api/moves?url=${encodeURIComponent(url)}`),
      );
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        return yield* Effect.fail(
          new Error(responseError(data, "Could not scan this review for moved code.")),
        );
      }
      const decoded = yield* S.decodeUnknownEffect(MoveResponse)(data);
      return LoadedMoves({ requestedUrl: url, moves: decoded.moves });
    }).pipe(
      Effect.catch(error =>
        Effect.succeed(FailedMoves({ requestedUrl: url, error: fetchErrorMessage(error) })),
      ),
      Effect.provide(Http.layer),
    ),
});

const activeDiffUrl = (model: ModelType) =>
  model.reviewTab === "commits" && model.selectedCommit !== ""
    ? commitGitHubUrl(model.meta, model.selectedCommit)
    : model.meta.url;

const isCurrentReviewRequest = (model: ModelType, requestedUrl: string) =>
  model.phase === "loading" && model.prUrl === requestedUrl;

const isCurrentPullRequest = (model: ModelType, requestedUrl: string) =>
  model.phase === "ready" &&
  model.prUrl === requestedUrl &&
  model.meta.url === requestedUrl;

const isCurrentDiffRequest = (model: ModelType, requestedUrl: string) =>
  model.phase === "ready" && activeDiffUrl(model) === requestedUrl;

const requestSemantic = (model: ModelType, file: FileChange): UpdateReturn => {
  const alreadyLoaded = model.semanticResults.some(result => result.path === file.path);
  const alreadyLoading =
    model.semanticRequest._tag === "Loading" && model.semanticRequest.path === file.path;
  if (
    model.phase !== "ready" ||
    !model.semantic ||
    model.prUrl.trim() === "" ||
    alreadyLoaded ||
    alreadyLoading
  ) {
    return [model, []];
  }
  return [
    evo(model, {
      semanticRequest: () => ({ _tag: "Loading" as const, path: file.path }),
    }),
    [
      FetchSemantic({
        url: activeDiffUrl(model),
        path: file.path,
        previousPath: file.previousPath,
        status: file.status,
      }),
    ],
  ];
};

const requestMoves = (model: ModelType): UpdateReturn => {
  if (
    model.phase !== "ready" ||
    !model.semantic ||
    model.reviewScope !== "full" ||
    model.prUrl.trim() === "" ||
    model.reviewMoves._tag === "Loading" ||
    model.reviewMoves._tag === "Ready"
  ) {
    return [model, []];
  }
  return [
    evo(model, { reviewMoves: () => ({ _tag: "Loading" as const }) }),
    [FetchMoves({ url: activeDiffUrl(model) })],
  ];
};

const requestGitHubReviews = (model: ModelType): UpdateReturn => {
  if (
    model.phase !== "ready" ||
    !model.showGitHubReviews ||
    model.reviewTab !== "files" ||
    model.meta.number === "compare" ||
    model.prUrl.trim() === "" ||
    model.githubReviews._tag === "Loading" ||
    model.githubReviews._tag === "Ready"
  ) {
    return [model, []];
  }
  return [
    evo(model, { githubReviews: () => ({ _tag: "Loading" as const }) }),
    [FetchGitHubReviews({ url: model.meta.url })],
  ];
};

const requestCharacterDiff = (
  model: ModelType,
  file: FileChange,
): UpdateReturn => {
  if (
    model.phase !== "ready" ||
    model.inlineDiffMode === "off" ||
    model.prUrl.trim() === ""
  ) {
    return [model, []];
  }
  const mode = model.inlineDiffMode;
  const requested = model.characterDiffStates.some(state => {
    if (state._tag === "Failed") return false;
    return state._tag === "Ready"
      ? state.result.path === file.path &&
          state.result.ignoreWhitespace === model.ignoreWhitespace &&
          state.result.mode === mode
      : state.path === file.path &&
          state.ignoreWhitespace === model.ignoreWhitespace &&
          state.mode === mode;
  });
  if (requested) {
    return [model, []];
  }
  return [
    evo(model, {
      characterDiffStates: states => [
        ...states,
        {
          _tag: "Loading" as const,
          path: file.path,
          ignoreWhitespace: model.ignoreWhitespace,
          mode,
        },
      ],
    }),
    [
      FetchCharacterDiff({
        url: activeDiffUrl(model),
        path: file.path,
        previousPath: file.previousPath,
        status: file.status,
        ignoreWhitespace: model.ignoreWhitespace,
        mode,
      }),
    ],
  ];
};

const requestCharacterDiffs = (model: ModelType): UpdateReturn => {
  const selected = model.files.find(file => file.path === model.selectedPath);
  const files = model.reviewScope === "full" ? model.files : selected === undefined ? [] : [selected];
  return files.reduce<UpdateReturn>(
    ([current, commands], file) => {
      const [next, requested] = requestCharacterDiff(current, file);
      return [next, [...commands, ...requested]];
    },
    [model, []],
  );
};

const requestSelectedIntelligence = (model: ModelType): UpdateReturn => {
  const selected = model.files.find(file => file.path === model.selectedPath);
  const [withSemantic, semanticCommands] =
    selected === undefined ? [model, []] : requestSemantic(model, selected);
  const [withMoves, moveCommands] = requestMoves(withSemantic);
  const [withReviews, reviewCommands] = requestGitHubReviews(withMoves);
  const [withCharacters, characterCommands] = requestCharacterDiffs(withReviews);
  return [
    withCharacters,
    [...semanticCommands, ...moveCommands, ...reviewCommands, ...characterCommands],
  ];
};

const resetDiffAnalysis = (model: ModelType): ModelType =>
  evo(model, {
    semanticResults: () => [],
    semanticRequest: () => ({ _tag: "Idle" as const }),
    reviewMoves: () => ({ _tag: "Idle" as const }),
    characterDiffStates: () => [],
    collapsedPaths: () => [],
    collapsedHunks: () => [],
    fullFileStates: () => [],
  });

const requestCommits = (model: ModelType): UpdateReturn => {
  if (
    model.phase !== "ready" ||
    model.meta.number === "compare" ||
    model.commits._tag === "Loading" ||
    model.commits._tag === "Ready"
  ) {
    return [model, []];
  }
  return [
    evo(model, { commits: () => ({ _tag: "Loading" as const }) }),
    [FetchCommits({ url: model.meta.url })],
  ];
};

const requestCommitDiff = (model: ModelType, sha: string): UpdateReturn => {
  if (sha === "" || model.meta.number === "compare") return [model, []];
  if (model.commitDiff._tag === "Loading" && model.commitDiff.sha === sha) {
    return [model, []];
  }
  if (model.commitDiff._tag === "Ready" && model.commitDiff.sha === sha) {
    const files = model.commitDiff.files;
    const ready = resetDiffAnalysis(
      evo(model, {
        selectedCommit: () => sha,
        files: () => files,
      }),
    );
    return requestSelectedIntelligence(ready);
  }
  return [
    resetDiffAnalysis(
      evo(model, {
        selectedCommit: () => sha,
        commitDiff: () => ({ _tag: "Loading" as const, sha }),
      }),
    ),
    [FetchCommitDiff({ repository: model.meta.repository, sha })],
  ];
};

const requestReviewLocation = (model: ModelType): UpdateReturn => {
  if (model.reviewTab === "files") return requestSelectedIntelligence(model);
  const [withCommits, commitCommands] = requestCommits(model);
  if (model.selectedCommit === "" || withCommits.commits._tag !== "Ready") {
    return [withCommits, commitCommands];
  }
  if (!withCommits.commits.commits.some(commit => commit.sha === model.selectedCommit)) {
    return synchronizeReviewUrl(
      evo(withCommits, {
        selectedCommit: () => "",
        commitDiff: () => ({ _tag: "Idle" as const }),
      }),
      commitCommands,
    );
  }
  const [withDiff, diffCommands] = requestCommitDiff(
    withCommits,
    model.selectedCommit,
  );
  return [withDiff, [...commitCommands, ...diffCommands]];
};

const beginReviewLoad = (model: ModelType, url: string): ModelType =>
  evo(model, {
    phase: () => "loading" as const,
    error: () => "",
    prUrl: () => url,
    filter: () => "",
    files: () => [],
    pullRequestFiles: () => [],
    semanticResults: () => [],
    semanticRequest: () => ({ _tag: "Idle" as const }),
    reviewMoves: () => ({ _tag: "Idle" as const }),
    characterDiffStates: () => [],
    reviewedPaths: () => [],
    collapsedPaths: () => [],
    collapsedHunks: () => [],
    fullFileStates: () => [],
    githubReviews: () => ({ _tag: "Idle" as const }),
    collapsedReviewThreads: () => [],
    replyDrafts: () => [],
    replyStates: () => [],
    reviewBody: () => "",
    reviewSubmission: () => ({ _tag: "Idle" as const }),
    commits: () => ({ _tag: "Idle" as const }),
    commitDiff: () => ({ _tag: "Idle" as const }),
    toolbarMenu: () => "none" as const,
  });

const sampleModel = (model: ModelType): ModelType =>
  evo(model, {
    page: () => "review" as const,
    phase: () => "ready" as const,
    error: () => "",
    prUrl: () => "",
    meta: () => sampleMeta,
    files: () => sampleFiles,
    pullRequestFiles: () => sampleFiles,
    reviewTab: () => "files" as const,
    commits: () => ({ _tag: "Idle" as const }),
    selectedCommit: () => "",
    commitDiff: () => ({ _tag: "Idle" as const }),
    toolbarMenu: () => "none" as const,
    selectedPath: () => sampleFiles[0]?.path ?? "",
    reviewedPaths: () => [],
    semanticResults: () => [],
    semanticRequest: () => ({ _tag: "Idle" as const }),
    reviewMoves: () => ({ _tag: "Idle" as const }),
    characterDiffStates: () => [],
    collapsedPaths: () => [],
    collapsedHunks: () => [],
    fullFileStates: () => [],
    githubReviews: () => ({ _tag: "Idle" as const }),
    collapsedReviewThreads: () => [],
    replyDrafts: () => [],
    replyStates: () => [],
    reviewBody: () => "",
    reviewSubmission: () => ({ _tag: "Idle" as const }),
    showGitHubReviews: () => true,
    syntaxHighlighting: () => true,
  });

const reviewOptions = (model: ModelType): ReviewOptions => ({
  reviewScope: model.reviewScope,
  viewMode: model.viewMode,
  ignoreWhitespace: model.ignoreWhitespace,
  semantic: model.semantic,
  inlineDiffMode: model.inlineDiffMode,
  syntaxHighlighting: model.syntaxHighlighting,
  sidebarCollapsed: model.sidebarCollapsed,
  showGitHubReviews: model.showGitHubReviews,
  selectedPath: model.selectedPath,
  reviewTab: model.reviewTab,
  selectedCommit: model.selectedCommit,
});

const applyReviewOptions = (
  model: ModelType,
  options: ReviewOptions,
): ModelType =>
  evo(model, {
    reviewScope: () => options.reviewScope,
    viewMode: () => options.viewMode,
    ignoreWhitespace: () => options.ignoreWhitespace,
    semantic: () => options.semantic,
    inlineDiffMode: () => options.inlineDiffMode,
    syntaxHighlighting: () => options.syntaxHighlighting,
    sidebarCollapsed: () => options.sidebarCollapsed,
    showGitHubReviews: () => options.showGitHubReviews,
    selectedPath: () => options.selectedPath,
    reviewTab: () => options.reviewTab,
    selectedCommit: () => options.selectedCommit,
  });

const synchronizeReviewUrl = (
  model: ModelType,
  commands: ReadonlyArray<Command.Command<Message>>,
): UpdateReturn => {
  if (model.phase !== "ready" || model.prUrl !== model.meta.url) {
    return [model, commands];
  }
  const href = localReviewUrl(model.meta.url, reviewOptions(model));
  return href === undefined
    ? [model, commands]
    : [model, [...commands, Navigate({ href, method: "replace" })]];
};

export const update = (model: ModelType, message: Message): UpdateReturn =>
  M.value(message).pipe(
    M.withReturnType<UpdateReturn>(),
    M.tagsExhaustive({
      ChangedPrUrl: ({ value }) => [evo(model, { prUrl: () => value }), []],
      SubmittedPrUrl: () => {
        if (model.phase === "loading" || model.prUrl.trim() === "") return [model, []];
        const url = model.prUrl.trim();
        const href = localReviewUrl(url, {
          ...reviewOptions(model),
          selectedPath: "",
          reviewTab: "files",
          selectedCommit: "",
        });
        const fresh = evo(model, {
          reviewTab: () => "files" as const,
          selectedCommit: () => "",
        });
        return [
          beginReviewLoad(fresh, url),
          [
            FetchReview({ url }),
            ...(href === undefined ? [] : [Navigate({ href, method: "push" })]),
          ],
        ];
      },
      RefreshedReview: () => {
        if (model.phase === "loading" || model.prUrl.trim() === "") return [model, []];
        const url = model.meta.url || model.prUrl.trim();
        return [beginReviewLoad(model, url), [FetchReview({ url })]];
      },
      ToggledToolbarMenu: ({ value }) => [
        evo(model, {
          toolbarMenu: current => current === value ? "none" : value,
        }),
        [],
      ],
      ClosedToolbarMenus: () => [
        evo(model, { toolbarMenu: () => "none" as const }),
        [],
      ],
      ChangedToolbarCompact: ({ value }) =>
        value === model.toolbarCompact
          ? [model, []]
          : [evo(model, { toolbarCompact: () => value }), []],
      ChangedBrowserUrl: ({ pathname, search }) => {
        if (pathname === "/") return [sampleModel(model), []];
        const repositoryRoute = repositoryRouteFromPathname(pathname);
        if (repositoryRoute !== undefined) {
          return loadRepositoryLocation(
            model,
            repositoryRoute,
            repositoryOptionsFromSearch(search),
          );
        }
        const url = githubUrlFromPathname(pathname);
        if (url === undefined) {
          return [
            evo(model, {
              phase: () => "error" as const,
              error: () => "That Hunker review URL is not recognized.",
            }),
            [],
          ];
        }
        const options = reviewOptionsFromSearch(search);
        const tabChanged = options.reviewTab !== model.reviewTab;
        const withOptions = applyReviewOptions(model, options);
        if (url === model.prUrl && model.phase === "loading") {
          return [withOptions, []];
        }
        if (url === model.prUrl || url === model.meta.url) {
          const located =
            tabChanged && options.reviewTab === "files"
              ? resetDiffAnalysis(
                  evo(withOptions, {
                    files: () => model.pullRequestFiles,
                    commitDiff: () => ({ _tag: "Idle" as const }),
                  }),
                )
              : withOptions;
          return requestReviewLocation(located);
        }
        return [beginReviewLoad(withOptions, url), [FetchReview({ url })]];
      },
      RequestedNavigation: ({ href, external }) => [
        model,
        [Navigate({ href, method: external ? "load" : "push" })],
      ],
      CompletedNavigation: () => [model, []],
      LoadedReview: ({ requestedUrl, meta, files }) => {
        if (!isCurrentReviewRequest(model, requestedUrl)) return [model, []];
        const next = evo(model, {
          page: () => "review" as const,
          phase: () => "ready" as const,
          prUrl: () => meta.url,
          meta: () => meta,
          files: () => files,
          pullRequestFiles: () => files,
          selectedPath: selectedPath =>
            files.some(file => file.path === selectedPath)
              ? selectedPath
              : (files[0]?.path ?? ""),
          reviewedPaths: () => [],
          semanticResults: () => [],
          semanticRequest: () => ({ _tag: "Idle" as const }),
          reviewMoves: () => ({ _tag: "Idle" as const }),
          characterDiffStates: () => [],
          collapsedPaths: () => [],
          collapsedHunks: () => [],
          fullFileStates: () => [],
          githubReviews: () => ({ _tag: "Idle" as const }),
          collapsedReviewThreads: () => [],
          replyDrafts: () => [],
          replyStates: () => [],
          reviewBody: () => "",
          reviewSubmission: () => ({ _tag: "Idle" as const }),
        });
        const [loaded, commands] = requestReviewLocation(next);
        return synchronizeReviewUrl(loaded, commands);
      },
      FailedReview: ({ requestedUrl, error }) =>
        isCurrentReviewRequest(model, requestedUrl)
          ? [
              evo(model, { phase: () => "error" as const, error: () => error }),
              [],
            ]
          : [model, []],
      LoadedCommits: ({ requestedUrl, commits }) => {
        if (!isCurrentPullRequest(model, requestedUrl)) return [model, []];
        const loaded = evo(model, {
          commits: () => ({ _tag: "Ready" as const, commits }),
        });
        if (loaded.reviewTab !== "commits" || loaded.selectedCommit === "") {
          return [loaded, []];
        }
        if (!commits.some(commit => commit.sha === loaded.selectedCommit)) {
          return synchronizeReviewUrl(
            evo(loaded, {
              selectedCommit: () => "",
              commitDiff: () => ({ _tag: "Idle" as const }),
            }),
            [],
          );
        }
        const [withDiff, commands] = requestCommitDiff(
          loaded,
          loaded.selectedCommit,
        );
        return synchronizeReviewUrl(withDiff, commands);
      },
      FailedCommits: ({ requestedUrl, error }) =>
        isCurrentPullRequest(model, requestedUrl)
          ? [
              evo(model, {
                commits: () => ({ _tag: "Failed" as const, error }),
              }),
              [],
            ]
          : [model, []],
      LoadedCommitDiff: ({ sha, files }) => {
        if (
          model.reviewTab !== "commits" ||
          model.selectedCommit !== sha ||
          model.commitDiff._tag !== "Loading" ||
          model.commitDiff.sha !== sha
        ) {
          return [model, []];
        }
        const next = evo(model, {
          files: () => files,
          commitDiff: () => ({ _tag: "Ready" as const, sha, files }),
          selectedPath: selectedPath =>
            files.some(file => file.path === selectedPath)
              ? selectedPath
              : (files[0]?.path ?? ""),
        });
        const [loaded, commands] = requestSelectedIntelligence(next);
        return synchronizeReviewUrl(loaded, commands);
      },
      FailedCommitDiff: ({ sha, error }) =>
        model.reviewTab === "commits" && model.selectedCommit === sha
          ? [
              evo(model, {
                commitDiff: () => ({ _tag: "Failed" as const, sha, error }),
              }),
              [],
            ]
          : [model, []],
      LoadedRepositoryFiles: ({ files }) => repositoryFilesLoaded(model, files),
      FailedRepositoryFiles: ({ error }) => repositoryFilesFailed(model, error),
      ChangedRepositoryQuery: ({ value }) => changeRepositoryQuery(model, value),
      SubmittedRepositorySearch: () => submitRepositorySearch(model),
      LoadedRepositorySearch: input => repositorySearchLoaded(model, input),
      FailedRepositorySearch: ({ query, error }) =>
        repositorySearchFailed(model, query, error),
      SelectedRepositoryFile: ({ path }) => selectRepositoryFile(model, path),
      ClosedRepositoryFile: () => closeRepositoryFile(model),
      LoadedRepositoryFile: input => repositoryFileLoaded(model, input),
      FailedRepositoryFile: ({ path, error }) =>
        repositoryFileFailed(model, path, error),
      LoadedSemantic: ({ requestedUrl, path, result }) =>
        isCurrentDiffRequest(model, requestedUrl)
          ? [
              evo(model, {
                semanticResults: results => [
                  ...results.filter(item => item.path !== path),
                  result,
                ],
                semanticRequest: request =>
                  request._tag === "Loading" && request.path === path
                    ? ({ _tag: "Idle" as const })
                    : request,
              }),
              [],
            ]
          : [model, []],
      FailedSemantic: ({ requestedUrl, path, error }) =>
        isCurrentDiffRequest(model, requestedUrl)
          ? [
              evo(model, {
                semanticRequest: request =>
                  request._tag === "Loading" && request.path === path
                    ? ({ _tag: "Failed" as const, path, error })
                    : request,
              }),
              [],
            ]
          : [model, []],
      LoadedMoves: ({ requestedUrl, moves }) =>
        isCurrentDiffRequest(model, requestedUrl)
          ? [
              evo(model, {
                reviewMoves: () => ({ _tag: "Ready" as const, moves }),
              }),
              [],
            ]
          : [model, []],
      FailedMoves: ({ requestedUrl, error }) =>
        isCurrentDiffRequest(model, requestedUrl)
          ? [
              evo(model, {
                reviewMoves: () => ({ _tag: "Failed" as const, error }),
              }),
              [],
            ]
          : [model, []],
      LoadedCharacterDiff: ({ requestedUrl, result }) =>
        isCurrentDiffRequest(model, requestedUrl)
          ? [
              evo(model, {
                characterDiffStates: states => [
                  ...states.filter(state =>
                    state._tag === "Ready"
                      ? state.result.path !== result.path ||
                        state.result.ignoreWhitespace !== result.ignoreWhitespace ||
                        state.result.mode !== result.mode
                      : state.path !== result.path ||
                        state.ignoreWhitespace !== result.ignoreWhitespace ||
                        state.mode !== result.mode,
                  ),
                  { _tag: "Ready" as const, result },
                ],
              }),
              [],
            ]
          : [model, []],
      FailedCharacterDiff: ({ requestedUrl, path, ignoreWhitespace, mode, error }) =>
        isCurrentDiffRequest(model, requestedUrl)
          ? [
              evo(model, {
                characterDiffStates: states => [
                  ...states.filter(state =>
                    state._tag === "Ready"
                      ? state.result.path !== path ||
                        state.result.ignoreWhitespace !== ignoreWhitespace ||
                        state.result.mode !== mode
                      : state.path !== path ||
                        state.ignoreWhitespace !== ignoreWhitespace ||
                        state.mode !== mode,
                  ),
                  {
                    _tag: "Failed" as const,
                    path,
                    ignoreWhitespace,
                    mode,
                    error,
                  },
                ],
              }),
              [],
            ]
          : [model, []],
      LoadedFullFile: ({ requestedUrl, path, oldText, newText }) => {
        if (!isCurrentDiffRequest(model, requestedUrl)) return [model, []];
        const requested = model.fullFileStates.some(
          state => state.path === path && state._tag === "Loading",
        );
        return requested
          ? [
              evo(model, {
                fullFileStates: states => [
                  ...states.filter(state => state.path !== path),
                  { _tag: "Ready" as const, path, oldText, newText },
                ],
              }),
              [],
            ]
          : [model, []];
      },
      FailedFullFile: ({ requestedUrl, path, error }) => {
        if (!isCurrentDiffRequest(model, requestedUrl)) return [model, []];
        const requested = model.fullFileStates.some(
          state => state.path === path && state._tag === "Loading",
        );
        return requested
          ? [
              evo(model, {
                fullFileStates: states => [
                  ...states.filter(state => state.path !== path),
                  { _tag: "Failed" as const, path, error },
                ],
              }),
              [],
            ]
          : [model, []];
      },
      LoadedGitHubReviews: ({ requestedUrl, comments }) =>
        isCurrentPullRequest(model, requestedUrl)
          ? [
              evo(model, {
                githubReviews: () => ({ _tag: "Ready" as const, comments }),
                collapsedReviewThreads: () =>
                  comments
                    .filter(comment => comment.id === comment.rootId && comment.resolved)
                    .map(comment => comment.id),
              }),
              [],
            ]
          : [model, []],
      FailedGitHubReviews: ({ requestedUrl, error }) =>
        isCurrentPullRequest(model, requestedUrl)
          ? [
              evo(model, {
                githubReviews: () => ({ _tag: "Failed" as const, error }),
              }),
              [],
            ]
          : [model, []],
      ChangedReplyDraft: ({ commentId, body }) => [
        evo(model, {
          replyDrafts: drafts => [
            ...drafts.filter(draft => draft.commentId !== commentId),
            { commentId, body },
          ],
          replyStates: states => states.filter(state => state.commentId !== commentId),
        }),
        [],
      ],
      SubmittedReply: ({ commentId }) => {
        const body = model.replyDrafts.find(
          draft => draft.commentId === commentId,
        )?.body.trim();
        const loading = model.replyStates.some(
          state => state.commentId === commentId && state._tag === "Loading",
        );
        if (body === undefined || body === "" || loading) return [model, []];
        return [
          evo(model, {
            replyStates: states => [
              ...states.filter(state => state.commentId !== commentId),
              { _tag: "Loading" as const, commentId },
            ],
          }),
          [PostReviewReply({ url: model.meta.url, commentId, body })],
        ];
      },
      PostedReply: ({ comment }) => [
        evo(model, {
          githubReviews: reviews =>
            reviews._tag === "Ready"
              ? {
                  _tag: "Ready" as const,
                  comments: [...reviews.comments, comment],
                }
              : reviews,
          replyDrafts: drafts =>
            drafts.filter(draft => draft.commentId !== comment.rootId),
          replyStates: states =>
            states.filter(state => state.commentId !== comment.rootId),
        }),
        [],
      ],
      FailedReply: ({ commentId, error }) => [
        evo(model, {
          replyStates: states => [
            ...states.filter(state => state.commentId !== commentId),
            { _tag: "Failed" as const, commentId, error },
          ],
        }),
        [],
      ],
      ChangedReviewBody: ({ body }) => [
        evo(model, {
          reviewBody: () => body,
          reviewSubmission: () => ({ _tag: "Idle" as const }),
        }),
        [],
      ],
      SubmittedReview: ({ event }) => {
        const body = model.reviewBody.trim();
        if (
          model.reviewSubmission._tag === "Loading" ||
          model.meta.number === "compare" ||
          (event !== "APPROVE" && body === "")
        ) {
          return [model, []];
        }
        return [
          evo(model, {
            reviewSubmission: () => ({ _tag: "Loading" as const, event }),
          }),
          [PostPullRequestReview({ url: model.meta.url, body, event })],
        ];
      },
      PostedReview: ({ event }) => [
        evo(model, {
          reviewBody: () => "",
          reviewSubmission: () => ({ _tag: "Succeeded" as const, event }),
        }),
        [],
      ],
      FailedReviewSubmission: ({ error }) => [
        evo(model, {
          reviewSubmission: () => ({ _tag: "Failed" as const, error }),
        }),
        [],
      ],
      ChangedFilter: ({ value }) => [evo(model, { filter: () => value }), []],
      SelectedFile: ({ path }) => {
        const next = evo(model, {
          selectedPath: () => path,
          reviewScope: () => "file" as const,
        });
        const result = requestSelectedIntelligence(next);
        return synchronizeReviewUrl(result[0], result[1]);
      },
      SelectedReviewTab: ({ value }) => {
        if (value === "files") {
          const files = model.pullRequestFiles;
          const next = resetDiffAnalysis(
            evo(model, {
              reviewTab: () => "files" as const,
              selectedCommit: () => "",
              commitDiff: () => ({ _tag: "Idle" as const }),
              files: () => files,
              selectedPath: selectedPath =>
                files.some(file => file.path === selectedPath)
                  ? selectedPath
                  : (files[0]?.path ?? ""),
            }),
          );
          const [loaded, commands] = requestSelectedIntelligence(next);
          return synchronizeReviewUrl(loaded, commands);
        }
        const next = resetDiffAnalysis(
          evo(model, {
            reviewTab: () => "commits" as const,
            selectedCommit: () => "",
            commitDiff: () => ({ _tag: "Idle" as const }),
          }),
        );
        const [loaded, commands] = requestCommits(next);
        return synchronizeReviewUrl(loaded, commands);
      },
      SelectedCommit: ({ sha }) => {
        const [next, commands] = requestCommitDiff(model, sha);
        return synchronizeReviewUrl(next, commands);
      },
      ReturnedToCommitList: () =>
        synchronizeReviewUrl(
          resetDiffAnalysis(
            evo(model, {
              selectedCommit: () => "",
              commitDiff: () => ({ _tag: "Idle" as const }),
            }),
          ),
          [],
        ),
      SelectedReviewScope: ({ value }) => {
        const next = evo(model, { reviewScope: () => value });
        const result = requestSelectedIntelligence(next);
        return synchronizeReviewUrl(result[0], result[1]);
      },
      SelectedViewMode: ({ value }) =>
        synchronizeReviewUrl(evo(model, { viewMode: () => value }), []),
      ToggledWhitespace: () => {
        const next = evo(model, { ignoreWhitespace: value => !value });
        const [updated, commands] = requestSelectedIntelligence(next);
        return synchronizeReviewUrl(updated, commands);
      },
      ToggledSemantic: () => {
        const next = evo(model, { semantic: value => !value });
        const [updated, commands] = requestSelectedIntelligence(next);
        return synchronizeReviewUrl(updated, commands);
      },
      SelectedInlineDiffMode: ({ value }) => {
        const next = evo(model, { inlineDiffMode: () => value });
        const [updated, commands] = requestSelectedIntelligence(next);
        return synchronizeReviewUrl(updated, commands);
      },
      ToggledSyntaxHighlighting: () =>
        synchronizeReviewUrl(
          evo(model, { syntaxHighlighting: value => !value }),
          [],
        ),
      ToggledSidebar: () =>
        synchronizeReviewUrl(
          evo(model, { sidebarCollapsed: value => !value }),
          [],
        ),
      ToggledGitHubReviews: () => {
        const next = evo(model, { showGitHubReviews: value => !value });
        const [updated, commands] = requestGitHubReviews(next);
        return synchronizeReviewUrl(updated, commands);
      },
      ToggledReviewThreadCollapse: ({ threadId }) => [
        evo(model, {
          collapsedReviewThreads: threads => toggleMembership(threads, threadId),
        }),
        [],
      ],
      ToggledReviewed: ({ path }) => {
        const reviewed = model.reviewedPaths.includes(path);
        return [
          evo(model, {
            reviewedPaths: paths => setMembership(paths, path, !reviewed),
            collapsedPaths: paths => setMembership(paths, path, !reviewed),
          }),
          [],
        ];
      },
      ToggledFileCollapse: ({ path }) => [
        evo(model, { collapsedPaths: paths => toggleMembership(paths, path) }),
        [],
      ],
      ToggledHunkCollapse: ({ path, hunkId }) => [
        evo(model, {
          collapsedHunks: hunks => toggleMembership(hunks, hunkKey(path, hunkId)),
        }),
        [],
      ],
      ToggledFullFile: ({ path }) => {
        const state = model.fullFileStates.find(item => item.path === path);
        if (state?._tag === "Ready" || state?._tag === "Loading") {
          return [
            evo(model, {
              fullFileStates: states => states.filter(item => item.path !== path),
            }),
            [],
          ];
        }
        const file = model.files.find(item => item.path === path);
        if (file === undefined || model.meta.url === "") return [model, []];
        const next = evo(model, {
          fullFileStates: states => [
            ...states.filter(item => item.path !== path),
            { _tag: "Loading" as const, path },
          ],
        });
        return [
          next,
          [
            FetchFullFile({
              url: activeDiffUrl(model),
              path,
              previousPath: file.previousPath,
              status: file.status,
            }),
          ],
        ];
      },
    }),
  );

const initialModel = (prUrl: string, options: ReviewOptions) =>
  Model.make({
    page: "review",
    phase: prUrl === "" ? "ready" : "loading",
    error: "",
    prUrl,
    filter: "",
    meta: sampleMeta,
    files: sampleFiles,
    pullRequestFiles: sampleFiles,
    reviewTab: options.reviewTab,
    commits: { _tag: "Idle" },
    selectedCommit: options.selectedCommit,
    commitDiff: { _tag: "Idle" },
    repositoryBrowser: {
      owner: "",
      name: "",
      query: "",
      selectedPath: "",
      files: { _tag: "Idle" },
      search: { _tag: "Idle" },
      file: { _tag: "Idle" },
    },
    toolbarMenu: "none",
    toolbarCompact: false,
    selectedPath: options.selectedPath || sampleFiles[0]?.path || "",
    sidebarCollapsed: options.sidebarCollapsed,
    reviewScope: options.reviewScope,
    viewMode: options.viewMode,
    ignoreWhitespace: options.ignoreWhitespace,
    semantic: options.semantic,
    inlineDiffMode: options.inlineDiffMode,
    syntaxHighlighting: options.syntaxHighlighting,
    reviewedPaths: [],
    semanticResults: [],
    semanticRequest: { _tag: "Idle" },
    reviewMoves: { _tag: "Idle" },
    characterDiffStates: [],
    collapsedPaths: [],
    collapsedHunks: [],
    fullFileStates: [],
    showGitHubReviews: options.showGitHubReviews,
    githubReviews: { _tag: "Idle" },
    collapsedReviewThreads: [],
    replyDrafts: [],
    replyStates: [],
    reviewBody: "",
    reviewSubmission: { _tag: "Idle" },
  });

export const init: Runtime.RoutingApplicationInit<ModelType, Message> = url => {
  const repositoryRoute = repositoryRouteFromPathname(url.pathname);
  if (repositoryRoute !== undefined) {
    const model = initialModel("", defaultReviewOptions);
    return loadRepositoryLocation(
      model,
      repositoryRoute,
      repositoryOptionsFromSearch(Option.getOrElse(url.search, () => "")),
    );
  }
  const prUrl = githubUrlFromPathname(url.pathname) ?? "";
  const options =
    prUrl === ""
      ? defaultReviewOptions
      : reviewOptionsFromSearch(Option.getOrElse(url.search, () => ""));
  const model = initialModel(prUrl, options);
  return [model, prUrl === "" ? [] : [FetchReview({ url: prUrl })]];
};

export const routing: Runtime.RoutingConfig<Message> = {
  onUrlChange: url =>
    ChangedBrowserUrl({
      pathname: url.pathname,
      search: Option.getOrElse(url.search, () => ""),
    }),
  onUrlRequest: request =>
    request._tag === "External"
      ? RequestedNavigation({ href: request.href, external: true })
      : RequestedNavigation({ href: Url.toString(request.url), external: false }),
};
