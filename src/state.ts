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
  ChangedPrUrl,
  ChangedReplyDraft,
  ChangedReviewBody,
  CompletedNavigation,
  FailedFullFile,
  FailedGitHubReviews,
  FailedMoves,
  FailedReply,
  FailedReview,
  FailedReviewSubmission,
  FailedSemantic,
  GitHubReviewComment,
  LoadedFullFile,
  LoadedGitHubReviews,
  LoadedMoves,
  LoadedReview,
  LoadedSemantic,
  Model,
  MovedBlock,
  PostedReply,
  PostedReview,
  RefreshedReview,
  RequestedNavigation,
  SelectedFile,
  SelectedReviewScope,
  SelectedViewMode,
  SemanticResult,
  SubmittedReply,
  SubmittedReview,
  ToggledCharacterDiff,
  ToggledFileCollapse,
  ToggledFullFile,
  ToggledGitHubReviews,
  ToggledHunkCollapse,
  ToggledReviewed,
  ToggledSemantic,
  ToggledSidebar,
  ToggledSyntaxHighlighting,
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
  defaultReviewOptions,
  githubUrlFromPathname,
  localReviewUrl,
  reviewOptionsFromSearch,
  type ReviewOptions,
} from "./review-route";
import { sampleFiles, sampleMeta } from "./sample";

type UpdateReturn = readonly [ModelType, ReadonlyArray<Command.Command<Message>>];
type ApiReview = Readonly<ReviewMeta & { diff: string }>;

const toggleMembership = (paths: ReadonlyArray<string>, path: string) =>
  paths.includes(path) ? paths.filter(item => item !== path) : [...paths, path];

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
      return LoadedReview({ meta, files });
    }).pipe(
      Effect.catch(error =>
        Effect.succeed(FailedReview({ error: fetchErrorMessage(error) })),
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
      return LoadedSemantic({ path, result });
    }).pipe(
      Effect.catch(error =>
        Effect.succeed(FailedSemantic({ path, error: fetchErrorMessage(error) })),
      ),
      Effect.provide(Http.layer),
    ),
});

const MoveResponse = S.Struct({ moves: S.Array(MovedBlock) });
const FullFileResponse = S.Struct({ oldText: S.String, newText: S.String });
const GitHubReviewsResponse = S.Struct({ comments: S.Array(GitHubReviewComment) });
const GitHubReplyResponse = S.Struct({ comment: GitHubReviewComment });

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
      return LoadedFullFile({ path, ...pair });
    }).pipe(
      Effect.catch(error =>
        Effect.succeed(FailedFullFile({ path, error: fetchErrorMessage(error) })),
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
      return LoadedGitHubReviews({ comments: decoded.comments });
    }).pipe(
      Effect.catch(error =>
        Effect.succeed(FailedGitHubReviews({ error: fetchErrorMessage(error) })),
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
      return LoadedMoves({ moves: decoded.moves });
    }).pipe(
      Effect.catch(error =>
        Effect.succeed(FailedMoves({ error: fetchErrorMessage(error) })),
      ),
      Effect.provide(Http.layer),
    ),
});

const requestSemantic = (model: ModelType, file: FileChange): UpdateReturn => {
  const alreadyLoaded = model.semanticResults.some(result => result.path === file.path);
  const alreadyLoading =
    model.semanticRequest._tag === "Loading" && model.semanticRequest.path === file.path;
  if (
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
        url: model.meta.url,
        path: file.path,
        previousPath: file.previousPath,
        status: file.status,
      }),
    ],
  ];
};

const requestMoves = (model: ModelType): UpdateReturn => {
  if (
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
    [FetchMoves({ url: model.meta.url })],
  ];
};

const requestGitHubReviews = (model: ModelType): UpdateReturn => {
  if (
    !model.showGitHubReviews ||
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

const requestSelectedIntelligence = (model: ModelType): UpdateReturn => {
  const selected = model.files.find(file => file.path === model.selectedPath);
  const [withSemantic, semanticCommands] =
    selected === undefined ? [model, []] : requestSemantic(model, selected);
  const [withMoves, moveCommands] = requestMoves(withSemantic);
  const [withReviews, reviewCommands] = requestGitHubReviews(withMoves);
  return [withReviews, [...semanticCommands, ...moveCommands, ...reviewCommands]];
};

const beginReviewLoad = (model: ModelType, url: string): ModelType =>
  evo(model, {
    phase: () => "loading" as const,
    error: () => "",
    prUrl: () => url,
    semanticResults: () => [],
    semanticRequest: () => ({ _tag: "Idle" as const }),
    reviewMoves: () => ({ _tag: "Idle" as const }),
    reviewedPaths: () => [],
    collapsedPaths: () => [],
    collapsedHunks: () => [],
    fullFileStates: () => [],
    githubReviews: () => ({ _tag: "Idle" as const }),
    replyDrafts: () => [],
    replyStates: () => [],
    reviewBody: () => "",
    reviewSubmission: () => ({ _tag: "Idle" as const }),
  });

const sampleModel = (model: ModelType): ModelType =>
  evo(model, {
    phase: () => "ready" as const,
    error: () => "",
    prUrl: () => "",
    meta: () => sampleMeta,
    files: () => sampleFiles,
    selectedPath: () => sampleFiles[0]?.path ?? "",
    reviewedPaths: () => [],
    semanticResults: () => [],
    semanticRequest: () => ({ _tag: "Idle" as const }),
    reviewMoves: () => ({ _tag: "Idle" as const }),
    collapsedPaths: () => [],
    collapsedHunks: () => [],
    fullFileStates: () => [],
    githubReviews: () => ({ _tag: "Idle" as const }),
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
  characterDiff: model.characterDiff,
  syntaxHighlighting: model.syntaxHighlighting,
  sidebarCollapsed: model.sidebarCollapsed,
  showGitHubReviews: model.showGitHubReviews,
  selectedPath: model.selectedPath,
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
    characterDiff: () => options.characterDiff,
    syntaxHighlighting: () => options.syntaxHighlighting,
    sidebarCollapsed: () => options.sidebarCollapsed,
    showGitHubReviews: () => options.showGitHubReviews,
    selectedPath: () => options.selectedPath,
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
        });
        return [
          beginReviewLoad(model, url),
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
      ChangedBrowserUrl: ({ pathname, search }) => {
        if (pathname === "/") return [sampleModel(model), []];
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
        const withOptions = applyReviewOptions(model, reviewOptionsFromSearch(search));
        if (url === model.prUrl || url === model.meta.url) {
          return requestSelectedIntelligence(withOptions);
        }
        return [beginReviewLoad(withOptions, url), [FetchReview({ url })]];
      },
      RequestedNavigation: ({ href, external }) => [
        model,
        [Navigate({ href, method: external ? "load" : "push" })],
      ],
      CompletedNavigation: () => [model, []],
      LoadedReview: ({ meta, files }) => {
        const next = evo(model, {
          phase: () => "ready" as const,
          prUrl: () => meta.url,
          meta: () => meta,
          files: () => files,
          selectedPath: selectedPath =>
            files.some(file => file.path === selectedPath)
              ? selectedPath
              : (files[0]?.path ?? ""),
          reviewedPaths: () => [],
          semanticRequest: () => ({ _tag: "Idle" as const }),
          reviewMoves: () => ({ _tag: "Idle" as const }),
          collapsedPaths: () => [],
          collapsedHunks: () => [],
          fullFileStates: () => [],
          githubReviews: () => ({ _tag: "Idle" as const }),
          replyDrafts: () => [],
          replyStates: () => [],
          reviewBody: () => "",
          reviewSubmission: () => ({ _tag: "Idle" as const }),
        });
        const [loaded, commands] = requestSelectedIntelligence(next);
        return synchronizeReviewUrl(loaded, commands);
      },
      FailedReview: ({ error }) => [
        evo(model, { phase: () => "error" as const, error: () => error }),
        [],
      ],
      LoadedSemantic: ({ path, result }) => [
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
      ],
      FailedSemantic: ({ path, error }) => [
        evo(model, {
          semanticRequest: request =>
            request._tag === "Loading" && request.path === path
              ? ({ _tag: "Failed" as const, path, error })
              : request,
        }),
        [],
      ],
      LoadedMoves: ({ moves }) => [
        evo(model, { reviewMoves: () => ({ _tag: "Ready" as const, moves }) }),
        [],
      ],
      FailedMoves: ({ error }) => [
        evo(model, { reviewMoves: () => ({ _tag: "Failed" as const, error }) }),
        [],
      ],
      LoadedFullFile: ({ path, oldText, newText }) => {
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
      FailedFullFile: ({ path, error }) => {
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
      LoadedGitHubReviews: ({ comments }) => [
        evo(model, {
          githubReviews: () => ({ _tag: "Ready" as const, comments }),
        }),
        [],
      ],
      FailedGitHubReviews: ({ error }) => [
        evo(model, {
          githubReviews: () => ({ _tag: "Failed" as const, error }),
        }),
        [],
      ],
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
        const file = next.files.find(item => item.path === path);
        const result = file === undefined ? ([next, []] as const) : requestSemantic(next, file);
        return synchronizeReviewUrl(result[0], result[1]);
      },
      SelectedReviewScope: ({ value }) => {
        const next = evo(model, { reviewScope: () => value });
        const result = value === "full" ? requestMoves(next) : ([next, []] as const);
        return synchronizeReviewUrl(result[0], result[1]);
      },
      SelectedViewMode: ({ value }) =>
        synchronizeReviewUrl(evo(model, { viewMode: () => value }), []),
      ToggledWhitespace: () =>
        synchronizeReviewUrl(
          evo(model, { ignoreWhitespace: value => !value }),
          [],
        ),
      ToggledSemantic: () => {
        const next = evo(model, { semantic: value => !value });
        const [updated, commands] = requestSelectedIntelligence(next);
        return synchronizeReviewUrl(updated, commands);
      },
      ToggledCharacterDiff: () =>
        synchronizeReviewUrl(
          evo(model, { characterDiff: value => !value }),
          [],
        ),
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
      ToggledReviewed: ({ path }) => [
        evo(model, { reviewedPaths: paths => toggleMembership(paths, path) }),
        [],
      ],
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
              url: model.meta.url,
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
    phase: prUrl === "" ? "ready" : "loading",
    error: "",
    prUrl,
    filter: "",
    meta: sampleMeta,
    files: sampleFiles,
    selectedPath: options.selectedPath || sampleFiles[0]?.path || "",
    sidebarCollapsed: options.sidebarCollapsed,
    reviewScope: options.reviewScope,
    viewMode: options.viewMode,
    ignoreWhitespace: options.ignoreWhitespace,
    semantic: options.semantic,
    characterDiff: options.characterDiff,
    syntaxHighlighting: options.syntaxHighlighting,
    reviewedPaths: [],
    semanticResults: [],
    semanticRequest: { _tag: "Idle" },
    reviewMoves: { _tag: "Idle" },
    collapsedPaths: [],
    collapsedHunks: [],
    fullFileStates: [],
    showGitHubReviews: options.showGitHubReviews,
    githubReviews: { _tag: "Idle" },
    replyDrafts: [],
    replyStates: [],
    reviewBody: "",
    reviewSubmission: { _tag: "Idle" },
  });

export const init: Runtime.RoutingApplicationInit<ModelType, Message> = url => {
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
