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

export type CommitTarget = Readonly<{
  _tag: "CommitTarget";
  owner: string;
  repo: string;
  sha: string;
}>;

export type GitHubTarget = PullTarget | CompareTarget | CommitTarget;

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
      new InvalidGitHubUrl({
        message: "Paste a GitHub pull request, compare, or commit URL.",
      }),
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
  if (resource === "commit" && /^[0-9a-f]{7,64}$/i.test(id)) {
    return Effect.succeed<GitHubTarget>({ _tag: "CommitTarget", owner, repo, sha: id });
  }
  return Effect.fail(
    new InvalidGitHubUrl({
      message: "Paste a GitHub pull request, compare, or commit URL.",
    }),
  );
};

const githubHeaders = {
  accept: "application/vnd.github+json",
  "user-agent": "hunker-diff-reviewer",
  "x-github-api-version": "2022-11-28",
};

const githubErrorMessage = (status: number, anonymous: boolean) => {
  if (status === 404) {
    return anonymous
      ? "That change may be private. Run gh auth login or set GITHUB_TOKEN."
      : "That change could not be found or your GitHub account cannot access it.";
  }
  if (status === 401) {
    return "GitHub rejected the local credential. Run gh auth login again.";
  }
  if (status === 403) {
    return "GitHub denied this request. Check that the local token has pull-request access and try again.";
  }
  if (status === 422) {
    return "GitHub rejected this review action. Refresh the PR and try again.";
  }
  return `GitHub returned ${status}. Try again in a moment.`;
};

export const executeGitHubRequest = (
  request: HttpClientRequest.HttpClientRequest,
  accept: string,
) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const auth = yield* GitHubAuth;
    const authorization = Option.match(auth.token, {
      onNone: () => ({}),
      onSome: value => ({ authorization: `Bearer ${value}` }),
    });
    const authenticatedRequest = request.pipe(
      HttpClientRequest.setHeaders({ ...githubHeaders, ...authorization, accept }),
    );
    const response = yield* client.execute(authenticatedRequest);
    if (response.status < 200 || response.status >= 300) {
      return yield* new GitHubFetchFailed({
        status: response.status,
        message: githubErrorMessage(response.status, auth.source === "anonymous"),
      });
    }
    return response;
  });

export const executeGitHub = (url: string, accept: string) =>
  executeGitHubRequest(HttpClientRequest.get(url), accept);

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
      CommitTarget: ({ owner, repo, sha }) =>
        `https://api.github.com/repos/${owner}/${repo}/commits/${sha}`,
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
        CommitTarget: ({ owner, repo, sha }) =>
          `https://github.com/${owner}/${repo}/commit/${sha}`,
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
    if (target._tag === "CommitTarget") {
      const commit = asRecord(metadata.commit);
      const commitAuthor = asRecord(commit.author);
      const user = asRecord(metadata.author);
      const parents = Array.isArray(metadata.parents) ? metadata.parents : [];
      const parent = asRecord(parents[0]);
      const message = stringField(commit, "message", `Commit ${target.sha.slice(0, 7)}`);
      return {
        title: message.split("\n")[0] ?? message,
        repository: `${target.owner}/${target.repo}`,
        number: target.sha.slice(0, 7),
        author:
          stringField(user, "login", "") ||
          stringField(commitAuthor, "name", "GitHub user"),
        base: stringField(parent, "sha", ""),
        head: stringField(metadata, "sha", target.sha),
        url: webUrl,
        diff,
      };
    }
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

export type PullCommit = Readonly<{
  sha: string;
  message: string;
  author: string;
  avatarUrl: string;
  authoredAt: string;
  htmlUrl: string;
}>;

const decodePullCommit = (value: unknown): PullCommit | undefined => {
  const item = asRecord(value);
  const sha = stringField(item, "sha", "");
  if (sha === "") return undefined;
  const commit = asRecord(item.commit);
  const authored = asRecord(commit.author);
  const user = asRecord(item.author);
  return {
    sha,
    message: stringField(commit, "message", `Commit ${sha.slice(0, 7)}`),
    author:
      stringField(user, "login", "") || stringField(authored, "name", "GitHub user"),
    avatarUrl: stringField(user, "avatar_url", ""),
    authoredAt: stringField(authored, "date", ""),
    htmlUrl: stringField(item, "html_url", ""),
  };
};

export const decodePullCommits = (value: unknown): ReadonlyArray<PullCommit> =>
  Array.isArray(value)
    ? value.flatMap(item => {
        const commit = decodePullCommit(item);
        return commit === undefined ? [] : [commit];
      })
    : [];

export const loadPullCommits = (target: PullTarget) =>
  Effect.gen(function* () {
    const commits: Array<PullCommit> = [];
    let page = 1;
    let hasNextPage = true;
    while (hasNextPage) {
      const response = yield* executeGitHub(
        `https://api.github.com/repos/${target.owner}/${target.repo}/pulls/${target.number}/commits?per_page=100&page=${page}`,
        "application/vnd.github+json",
      );
      const value: unknown = yield* response.json;
      const rawCount = Array.isArray(value) ? value.length : 0;
      commits.push(...decodePullCommits(value));
      hasNextPage = rawCount === 100;
      page += 1;
    }
    return commits;
  });

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
        if (target._tag === "CommitTarget") {
          const parents = Array.isArray(metadata.parents) ? metadata.parents : [];
          return {
            base: stringField(asRecord(parents[0]), "sha", ""),
            head: stringField(metadata, "sha", target.sha),
          };
        }
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

export type FileDescriptor = Readonly<{
  path: string;
  previousPath: string;
  status: FileStatus;
}>;

const loadFilePairWithRefs = (
  target: GitHubTarget,
  refs: Readonly<{ base: string; head: string }>,
  file: FileDescriptor,
) =>
  Effect.gen(function* () {
    const oldPath =
      file.status === "renamed" && file.previousPath !== ""
        ? file.previousPath
        : file.path;
    const oldText =
      file.status === "added"
        ? ""
        : yield* loadFileContent(target, oldPath, refs.base);
    const newText =
      file.status === "deleted"
        ? ""
        : yield* loadFileContent(target, file.path, refs.head);
    return { ...file, oldText, newText };
  });

export const loadFilePair = (
  target: GitHubTarget,
  path: string,
  previousPath: string,
  status: FileStatus,
) =>
  Effect.gen(function* () {
    const refs = yield* loadTargetRefs(target);
    const { oldText, newText } = yield* loadFilePairWithRefs(target, refs, {
      path,
      previousPath,
      status,
    });
    return { oldText, newText };
  });

export const loadFilePairs = (
  target: GitHubTarget,
  files: ReadonlyArray<FileDescriptor>,
) =>
  Effect.gen(function* () {
    const refs = yield* loadTargetRefs(target);
    return yield* Effect.forEach(
      files,
      file => loadFilePairWithRefs(target, refs, file),
      { concurrency: 6 },
    );
  });
