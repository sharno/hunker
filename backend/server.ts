import { Config, Data, Effect, Layer, Match as M, Option } from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpMiddleware,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { createServer } from "node:http";

import { NodeHttpClient, NodeHttpServer, NodeRuntime } from "@effect/platform-node";

type PullTarget = Readonly<{
  _tag: "PullTarget";
  owner: string;
  repo: string;
  number: string;
}>;

type CompareTarget = Readonly<{
  _tag: "CompareTarget";
  owner: string;
  repo: string;
  range: string;
}>;

type GitHubTarget = PullTarget | CompareTarget;

class InvalidGitHubUrl extends Data.TaggedError("InvalidGitHubUrl")<{
  readonly message: string;
}> {}

class GitHubFetchFailed extends Data.TaggedError("GitHubFetchFailed")<{
  readonly message: string;
  readonly status: number;
}> {}

const parseGitHubUrl = (input: string): Effect.Effect<GitHubTarget, InvalidGitHubUrl> => {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return Effect.fail(
      new InvalidGitHubUrl({ message: "Paste a GitHub pull request or compare URL." }),
    );
  }

  if (url.hostname !== "github.com") {
    return Effect.fail(
      new InvalidGitHubUrl({ message: "Hunker currently accepts github.com URLs." }),
    );
  }

  const [owner, repo, resource, id] = url.pathname.split("/").filter(Boolean);
  if (owner === undefined || repo === undefined || id === undefined) {
    return Effect.fail(
      new InvalidGitHubUrl({ message: "Paste a complete GitHub pull request or compare URL." }),
    );
  }
  if (resource === "pull" && /^\d+$/.test(id)) {
    return Effect.succeed<GitHubTarget>({ _tag: "PullTarget", owner, repo, number: id });
  }
  if (resource === "compare" && id.length > 2) {
    return Effect.succeed<GitHubTarget>({ _tag: "CompareTarget", owner, repo, range: id });
  }
  return Effect.fail(
    new InvalidGitHubUrl({ message: "Paste a GitHub pull request or compare URL." }),
  );
};

const githubHeaders = {
  accept: "application/vnd.github+json",
  "user-agent": "hunker-diff-reviewer",
  "x-github-api-version": "2022-11-28",
};

const executeGitHub = (url: string, accept: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const token = yield* Config.string("GITHUB_TOKEN").pipe(Config.option);
    const authorization = Option.match(token, {
      onNone: () => ({}),
      onSome: value => ({ authorization: `Bearer ${value}` }),
    });
    const request = HttpClientRequest.get(url).pipe(
      HttpClientRequest.setHeaders({ ...githubHeaders, ...authorization, accept }),
    );
    const response = yield* client.execute(request);
    if (response.status < 200 || response.status >= 300) {
      return yield* new GitHubFetchFailed({
        status: response.status,
        message:
          response.status === 404
            ? "That change is private or could not be found."
            : `GitHub returned ${response.status}. Try again in a moment.`,
      });
    }
    return response;
  });

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const stringField = (record: Readonly<Record<string, unknown>>, key: string, fallback: string) =>
  typeof record[key] === "string" ? record[key] : fallback;

const loadReview = (target: GitHubTarget) =>
  Effect.gen(function* () {
    const webUrl = M.value(target).pipe(
      M.tagsExhaustive({
        PullTarget: ({ owner, repo, number }) =>
          `https://github.com/${owner}/${repo}/pull/${number}`,
        CompareTarget: ({ owner, repo, range }) =>
          `https://github.com/${owner}/${repo}/compare/${range}`,
      }),
    );
    const diffUrl = M.value(target).pipe(
      M.tagsExhaustive({
        PullTarget: ({ owner, repo, number }) =>
          `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`,
        CompareTarget: ({ owner, repo, range }) =>
          `https://api.github.com/repos/${owner}/${repo}/compare/${range}`,
      }),
    );
    const diffResponse = yield* executeGitHub(
      diffUrl,
      "application/vnd.github.diff",
    );
    const diff = yield* diffResponse.text;

    if (target._tag === "CompareTarget") {
      const [base = "base", head = "head"] = target.range.split("...");
      return {
        title: target.range,
        repository: `${target.owner}/${target.repo}`,
        number: "compare",
        author: "GitHub",
        base,
        head,
        url: webUrl,
        diff,
      };
    }

    const metadataResponse = yield* executeGitHub(
      `https://api.github.com/repos/${target.owner}/${target.repo}/pulls/${target.number}`,
      "application/vnd.github+json",
    );
    const metadata = asRecord(yield* metadataResponse.json);
    const user = asRecord(metadata.user);
    const base = asRecord(metadata.base);
    const head = asRecord(metadata.head);

    return {
      title: stringField(metadata, "title", `Pull request #${target.number}`),
      repository: `${target.owner}/${target.repo}`,
      number: target.number,
      author: stringField(user, "login", "GitHub"),
      base: stringField(base, "ref", "base"),
      head: stringField(head, "ref", "head"),
      url: webUrl,
      diff,
    };
  });

const handleDiff = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const requestUrl = new URL(request.url, "http://localhost:8787");
    const target = yield* parseGitHubUrl(requestUrl.searchParams.get("url") ?? "");
    const review = yield* loadReview(target);
    return HttpServerResponse.jsonUnsafe(review);
  }).pipe(
    Effect.catchTags({
      InvalidGitHubUrl: error =>
        Effect.succeed(HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 400 })),
      GitHubFetchFailed: error =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ error: error.message }, { status: error.status }),
        ),
    }),
  );

const Routes = HttpRouter.add("GET", "/api/diff", handleDiff).pipe(
  Layer.provide(NodeHttpClient.layerUndici),
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
);

NodeRuntime.runMain(Layer.launch(Main));
