import { Effect, Match as M, Schema as S } from "effect";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
} from "effect/unstable/http";
import { Command, Http, Runtime } from "foldkit";
import { evo } from "foldkit/struct";

import {
  ChangedFilter,
  ChangedPrUrl,
  FailedMoves,
  FailedReview,
  FailedSemantic,
  LoadedMoves,
  LoadedReview,
  LoadedSemantic,
  Model,
  MovedBlock,
  SelectedFile,
  SelectedReviewScope,
  SelectedViewMode,
  SemanticResult,
  ToggledCharacterDiff,
  ToggledReviewed,
  ToggledSemantic,
  ToggledWhitespace,
} from "./domain";
import type {
  FileChange,
  Message,
  Model as ModelType,
  ReviewMeta,
} from "./domain";
import { parseGitDiff } from "./diff";
import { sampleFiles, sampleMeta } from "./sample";

type UpdateReturn = readonly [ModelType, ReadonlyArray<Command.Command<Message>>];
type ApiReview = Readonly<ReviewMeta & { diff: string }>;

const toggleReviewed = (paths: ReadonlyArray<string>, path: string) =>
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
      const request = HttpClientRequest.get(`/api/diff?url=${encodeURIComponent(url)}`);
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

const requestSelectedIntelligence = (model: ModelType): UpdateReturn => {
  const selected = model.files.find(file => file.path === model.selectedPath);
  const [withSemantic, semanticCommands] =
    selected === undefined ? [model, []] : requestSemantic(model, selected);
  const [withMoves, moveCommands] = requestMoves(withSemantic);
  return [withMoves, [...semanticCommands, ...moveCommands]];
};

export const update = (model: ModelType, message: Message): UpdateReturn =>
  M.value(message).pipe(
    M.withReturnType<UpdateReturn>(),
    M.tagsExhaustive({
      ChangedPrUrl: ({ value }) => [evo(model, { prUrl: () => value }), []],
      SubmittedPrUrl: () => {
        if (model.phase === "loading" || model.prUrl.trim() === "") return [model, []];
        return [
          evo(model, {
            phase: () => "loading" as const,
            error: () => "",
            semanticResults: () => [],
            semanticRequest: () => ({ _tag: "Idle" as const }),
            reviewMoves: () => ({ _tag: "Idle" as const }),
          }),
          [FetchReview({ url: model.prUrl.trim() })],
        ];
      },
      LoadedReview: ({ meta, files }) => {
        const next = evo(model, {
          phase: () => "ready" as const,
          meta: () => meta,
          files: () => files,
          selectedPath: () => files[0]?.path ?? "",
          reviewedPaths: () => [],
          semanticRequest: () => ({ _tag: "Idle" as const }),
          reviewMoves: () => ({ _tag: "Idle" as const }),
        });
        return requestSelectedIntelligence(next);
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
      ChangedFilter: ({ value }) => [evo(model, { filter: () => value }), []],
      SelectedFile: ({ path }) => {
        const next = evo(model, {
          selectedPath: () => path,
          reviewScope: () => "file" as const,
        });
        const file = next.files.find(item => item.path === path);
        return file === undefined ? [next, []] : requestSemantic(next, file);
      },
      SelectedReviewScope: ({ value }) => {
        const next = evo(model, { reviewScope: () => value });
        return value === "full" ? requestMoves(next) : [next, []];
      },
      SelectedViewMode: ({ value }) => [evo(model, { viewMode: () => value }), []],
      ToggledWhitespace: () => [
        evo(model, { ignoreWhitespace: value => !value }),
        [],
      ],
      ToggledSemantic: () => {
        const next = evo(model, { semantic: value => !value });
        return requestSelectedIntelligence(next);
      },
      ToggledCharacterDiff: () => [
        evo(model, { characterDiff: value => !value }),
        [],
      ],
      ToggledReviewed: ({ path }) => [
        evo(model, { reviewedPaths: paths => toggleReviewed(paths, path) }),
        [],
      ],
    }),
  );

export const init: Runtime.ElementInit<ModelType, Message> = () => [
  Model.make({
    phase: "ready",
    error: "",
    prUrl: "",
    filter: "",
    meta: sampleMeta,
    files: sampleFiles,
    selectedPath: sampleFiles[0]?.path ?? "",
    reviewScope: "file",
    viewMode: "split",
    ignoreWhitespace: true,
    semantic: true,
    characterDiff: true,
    reviewedPaths: [],
    semanticResults: [],
    semanticRequest: { _tag: "Idle" },
    reviewMoves: { _tag: "Idle" },
  }),
  [],
];
