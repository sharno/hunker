import { Data, Effect, Layer } from "effect";
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

import { DifftasticFailed, runDifftastic } from "./difftastic";
import { isGeneratedDiffPath, parseGitDiff } from "../src/diff";
import {
  GitHubFetchFailed,
  InvalidGitHubUrl,
  loadFilePair,
  loadFilePairs,
  loadReview,
  parseGitHubUrl,
} from "./github";
import type { FileStatus } from "./github";
import { GitHubAuthLive } from "./github-auth";
import { MoveDetectionFailed, runMovedCodeDetection } from "./moved-code";

class InvalidSemanticRequest extends Data.TaggedError("InvalidSemanticRequest")<{
  readonly message: string;
}> {}

const isFileStatus = (value: string): value is FileStatus =>
  value === "modified" ||
  value === "added" ||
  value === "deleted" ||
  value === "renamed";

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

const handleSemantic = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const requestUrl = new URL(request.url, "http://localhost:8787");
    const target = yield* parseGitHubUrl(requestUrl.searchParams.get("url") ?? "");
    const path = requestUrl.searchParams.get("path") ?? "";
    const previousPath = requestUrl.searchParams.get("previousPath") ?? "";
    const status = requestUrl.searchParams.get("status") ?? "";
    if (path === "" || !isFileStatus(status)) {
      return yield* new InvalidSemanticRequest({
        message: "Choose a reviewable file before requesting semantic analysis.",
      });
    }

    const { oldText, newText } = yield* loadFilePair(
      target,
      path,
      previousPath,
      status,
    );
    const result = yield* runDifftastic(path, oldText, newText);
    return HttpServerResponse.jsonUnsafe(result);
  }).pipe(
    Effect.catchTags({
      InvalidGitHubUrl: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 400 }),
        ),
      InvalidSemanticRequest: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 400 }),
        ),
      GitHubFetchFailed: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: error.status }),
        ),
      DifftasticFailed: error =>
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
    const moves = yield* runMovedCodeDetection(pairs);
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
      MoveDetectionFailed: (error: MoveDetectionFailed) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: error.status }),
        ),
    }),
  );

const Routes = Layer.mergeAll(
  HttpRouter.add("GET", "/api/diff", handleDiff),
  HttpRouter.add("GET", "/api/semantic", handleSemantic),
  HttpRouter.add("GET", "/api/moves", handleMoves),
).pipe(
  Layer.provide(NodeHttpClient.layerUndici),
  Layer.provide(NodeServices.layer),
  Layer.provide(GitHubAuthLive),
);

const HttpAppLive = Layer.unwrap(
  HttpRouter.toHttpEffect(Routes).pipe(
    Effect.map(HttpServer.serve(HttpMiddleware.cors({ allowedOrigins: ["http://localhost:5173"] }))),
  ),
);

const Main = HttpAppLive.pipe(
  HttpServer.withLogAddress,
  Layer.provide(NodeHttpServer.layer(createServer, { port: 8787 })),
  Layer.provide(NodeHttpClient.layerUndici),
  Layer.provide(NodeServices.layer),
  Layer.provide(GitHubAuthLive),
);

NodeRuntime.runMain(Layer.launch(Main));
