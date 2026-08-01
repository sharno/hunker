import { Data, Effect, Match as M, Option } from "effect";
import {
  HttpClient,
  HttpClientRequest,
} from "effect/unstable/http";

import { GitHubAuth } from "./github-auth";

export type PullTarget = Readonly<{
  _tag: "PullTarget";
  owner: string;
  repo: string;
  number: string;
}>;

export type CompareTarget = Readonly<{
  _tag: "CompareTarget";
  owner: string;
  repo: string;
  range: string;
}>;

export type GitHubTarget = PullTarget | CompareTarget;

export class InvalidGitHubUrl extends Data.TaggedError("InvalidGitHubUrl")<{
  readonly message: string;
}> {}

export class GitHubFetchFailed extends Data.TaggedError("GitHubFetchFailed")<{
  readonly message: string;
  readonly status: number;
}> {}

export const parseGitHubUrl = (
  input: string,
): Effect.Effect<GitHubTarget, InvalidGitHubUrl> => {
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

export const executeGitHub = (url: string, accept: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const auth = yield* GitHubAuth;
    const authorization = Option.match(auth.token, {
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
            ? auth.source === "anonymous"
              ? "That change may be private. Run gh auth login or set GITHUB_TOKEN."
              : "That change could not be found or your GitHub account cannot access it."
            : `GitHub returned ${response.status}. Try again in a moment.`,
      });
    }
    return response;
  });

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const stringField = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  fallback: string,
) => (typeof record[key] === "string" ? record[key] : fallback);

const apiUrl = (target: GitHubTarget) =>
  M.value(target).pipe(
    M.tagsExhaustive({
      PullTarget: ({ owner, repo, number }) =>
        `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`,
      CompareTarget: ({ owner, repo, range }) =>
        `https://api.github.com/repos/${owner}/${repo}/compare/${range}`,
    }),
  );

export const loadReview = (target: GitHubTarget) =>
  Effect.gen(function* () {
    const webUrl = M.value(target).pipe(
      M.tagsExhaustive({
        PullTarget: ({ owner, repo, number }) =>
          `https://github.com/${owner}/${repo}/pull/${number}`,
        CompareTarget: ({ owner, repo, range }) =>
          `https://github.com/${owner}/${repo}/compare/${range}`,
      }),
    );
    const diffResponse = yield* executeGitHub(apiUrl(target), "application/vnd.github.diff");
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
      apiUrl(target),
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

export type FileVersion = "base" | "head";

const loadTargetRefs = (target: GitHubTarget) =>
  target._tag === "CompareTarget"
    ? Effect.succeed(
        (() => {
          const [base = "base", head = "head"] = target.range.split("...");
          return { base, head };
        })(),
      )
    : Effect.gen(function* () {
        const response = yield* executeGitHub(apiUrl(target), "application/vnd.github+json");
        const metadata = asRecord(yield* response.json);
        return {
          base: stringField(asRecord(metadata.base), "sha", ""),
          head: stringField(asRecord(metadata.head), "sha", ""),
        };
      });

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

const loadFileContent = (target: GitHubTarget, path: string, ref: string) =>
  executeGitHub(
    `https://api.github.com/repos/${target.owner}/${target.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
    "application/vnd.github.raw+json",
  ).pipe(Effect.flatMap(response => response.text));

export type FileStatus = "modified" | "added" | "deleted" | "renamed";

export const loadFilePair = (
  target: GitHubTarget,
  path: string,
  previousPath: string,
  status: FileStatus,
) =>
  Effect.gen(function* () {
    const refs = yield* loadTargetRefs(target);
    const oldPath = status === "renamed" && previousPath !== "" ? previousPath : path;
    const oldText =
      status === "added" ? "" : yield* loadFileContent(target, oldPath, refs.base);
    const newText =
      status === "deleted" ? "" : yield* loadFileContent(target, path, refs.head);
    return { oldText, newText };
  });
