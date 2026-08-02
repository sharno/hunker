import { Data, Effect, Match as M, Option, Schema as S } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

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
      new InvalidGitHubUrl({
        message: "Hunker currently accepts github.com URLs.",
      }),
    );
  }

  const [owner, repo, resource, id] = url.pathname.split("/").filter(Boolean);
  if (owner === undefined || repo === undefined || id === undefined) {
    return Effect.fail(
      new InvalidGitHubUrl({
        message: "Paste a complete GitHub pull request or compare URL.",
      }),
    );
  }
  if (resource === "pull" && /^\d+$/.test(id)) {
    return Effect.succeed<GitHubTarget>({
      _tag: "PullTarget",
      owner,
      repo,
      number: id,
    });
  }
  if (resource === "compare" && id.length > 2) {
    return Effect.succeed<GitHubTarget>({
      _tag: "CompareTarget",
      owner,
      repo,
      range: id,
    });
  }
  if (resource === "commit" && /^[0-9a-f]{7,64}$/i.test(id)) {
    return Effect.succeed<GitHubTarget>({
      _tag: "CommitTarget",
      owner,
      repo,
      sha: id,
    });
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
      onSome: (value) => ({ authorization: `Bearer ${value}` }),
    });
    const authenticatedRequest = request.pipe(
      HttpClientRequest.setHeaders({
        ...githubHeaders,
        ...authorization,
        accept,
      }),
    );
    const response = yield* client.execute(authenticatedRequest);
    if (response.status < 200 || response.status >= 300) {
      return yield* new GitHubFetchFailed({
        status: response.status,
        message: githubErrorMessage(
          response.status,
          auth.source === "anonymous",
        ),
      });
    }
    return response;
  });

export const executeGitHub = (url: string, accept: string) =>
  executeGitHubRequest(HttpClientRequest.get(url), accept);

const GitHubUser = S.Struct({
  login: S.String,
  avatar_url: S.optional(S.String),
});

const GitHubCommitAuthor = S.Struct({
  name: S.String,
  date: S.optional(S.String),
});

const GitHubRef = S.Struct({
  ref: S.String,
  sha: S.String,
});

const PullMetadataResponse = S.Struct({
  title: S.String,
  user: S.NullOr(GitHubUser),
  base: GitHubRef,
  head: GitHubRef,
});

const CompareMetadataResponse = S.Struct({
  base_commit: S.Struct({ sha: S.String }),
  commits: S.Array(S.Struct({ sha: S.String })),
});

const CommitMetadataResponse = S.Struct({
  sha: S.String,
  commit: S.Struct({
    message: S.String,
    author: S.NullOr(GitHubCommitAuthor),
  }),
  author: S.NullOr(GitHubUser),
  parents: S.Array(S.Struct({ sha: S.String })),
});

const PullCommitResponse = S.Struct({
  sha: S.String,
  commit: S.Struct({
    message: S.String,
    author: S.NullOr(GitHubCommitAuthor),
  }),
  author: S.NullOr(GitHubUser),
  html_url: S.String,
});

const PullCommitsResponse = S.Array(PullCommitResponse);

const decodeGitHubJson = <A>(
  schema: S.Schema<A> & { readonly DecodingServices: never },
  value: unknown,
  subject: string,
) =>
  S.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(
      () =>
        new GitHubFetchFailed({
          status: 502,
          message: `GitHub returned malformed ${subject} data.`,
        }),
    ),
  );

const githubAuthor = (
  user: S.Schema.Type<typeof GitHubUser> | null,
  commitAuthor: S.Schema.Type<typeof GitHubCommitAuthor> | null,
) => user?.login || commitAuthor?.name || "GitHub user";

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

const webUrl = (target: GitHubTarget) =>
  M.value(target).pipe(
    M.tagsExhaustive({
      PullTarget: ({ owner, repo, number }) =>
        `https://github.com/${owner}/${repo}/pull/${number}`,
      CompareTarget: ({ owner, repo, range }) =>
        `https://github.com/${owner}/${repo}/compare/${range}`,
      CommitTarget: ({ owner, repo, sha }) =>
        `https://github.com/${owner}/${repo}/commit/${sha}`,
    }),
  );

export type ReviewMetadata = Readonly<{
  title: string;
  repository: string;
  number: string;
  author: string;
  base: string;
  head: string;
  url: string;
  baseOid: string;
  headOid: string;
  headRef: string;
}>;

export const loadReviewMetadata = (target: GitHubTarget) =>
  Effect.gen(function* () {
    const metadataResponse = yield* executeGitHub(
      apiUrl(target),
      "application/vnd.github+json",
    );
    const metadataJson: unknown = yield* metadataResponse.json;
    if (target._tag === "CompareTarget") {
      const metadata = yield* decodeGitHubJson(
        CompareMetadataResponse,
        metadataJson,
        "compare",
      );
      const [base = "base", head = "head"] = target.range.split("...");
      const baseOid = metadata.base_commit.sha;
      return {
        title: target.range,
        repository: `${target.owner}/${target.repo}`,
        number: "compare",
        author: "GitHub",
        base,
        head,
        url: webUrl(target),
        baseOid,
        headOid: metadata.commits.at(-1)?.sha ?? baseOid,
        headRef: head,
      };
    }
    if (target._tag === "CommitTarget") {
      const metadata = yield* decodeGitHubJson(
        CommitMetadataResponse,
        metadataJson,
        "commit",
      );
      const baseOid = metadata.parents[0]?.sha ?? "";
      return {
        title:
          metadata.commit.message.split("\n")[0] ?? metadata.commit.message,
        repository: `${target.owner}/${target.repo}`,
        number: target.sha.slice(0, 7),
        author: githubAuthor(metadata.author, metadata.commit.author),
        base: baseOid,
        head: metadata.sha,
        url: webUrl(target),
        baseOid,
        headOid: metadata.sha,
        headRef: metadata.sha,
      };
    }
    const metadata = yield* decodeGitHubJson(
      PullMetadataResponse,
      metadataJson,
      "pull request",
    );

    return {
      title: metadata.title,
      repository: `${target.owner}/${target.repo}`,
      number: target.number,
      author: metadata.user?.login ?? "GitHub",
      base: metadata.base.ref,
      head: metadata.head.ref,
      url: webUrl(target),
      baseOid: metadata.base.sha,
      headOid: metadata.head.sha,
      headRef: metadata.head.ref,
    };
  });

export const loadReviewDiff = (target: GitHubTarget) =>
  executeGitHub(apiUrl(target), "application/vnd.github.diff").pipe(
    Effect.flatMap((response) => response.text),
  );

export const loadDiffAtRevision = (
  target: GitHubTarget,
  refs: Readonly<{ base: string; head: string }>,
) =>
  executeGitHub(
    `https://api.github.com/repos/${target.owner}/${target.repo}/compare/${encodeURIComponent(refs.base)}...${encodeURIComponent(refs.head)}`,
    "application/vnd.github.diff",
  ).pipe(Effect.flatMap((response) => response.text));

export const loadReview = (target: GitHubTarget) =>
  Effect.gen(function* () {
    const metadata = yield* loadReviewMetadata(target);
    const diff = yield* loadReviewDiff(target);
    return { ...metadata, diff };
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

const pullCommit = (
  item: S.Schema.Type<typeof PullCommitResponse>,
): PullCommit => {
  return {
    sha: item.sha,
    message: item.commit.message,
    author: githubAuthor(item.author, item.commit.author),
    avatarUrl: item.author?.avatar_url ?? "",
    authoredAt: item.commit.author?.date ?? "",
    htmlUrl: item.html_url,
  };
};

export const decodePullCommits = (value: unknown): ReadonlyArray<PullCommit> =>
  Option.match(S.decodeUnknownOption(PullCommitsResponse)(value), {
    onNone: () => [],
    onSome: (items) => items.map(pullCommit),
  });

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
      const pageCommits = yield* decodeGitHubJson(
        PullCommitsResponse,
        value,
        "pull request commits",
      );
      commits.push(...pageCommits.map(pullCommit));
      hasNextPage = pageCommits.length === 100;
      page += 1;
    }
    return commits;
  });

const loadTargetRefs = (target: GitHubTarget) =>
  loadReviewMetadata(target).pipe(
    Effect.map((metadata) => ({
      base: metadata.baseOid,
      head: metadata.headOid,
    })),
  );

const encodePath = (path: string) =>
  path.split("/").map(encodeURIComponent).join("/");

const loadFileContent = (target: GitHubTarget, path: string, ref: string) =>
  executeGitHub(
    `https://api.github.com/repos/${target.owner}/${target.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
    "application/vnd.github.raw+json",
  ).pipe(Effect.flatMap((response) => response.text));

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

export const loadFilePairAtRevision = (
  target: GitHubTarget,
  refs: Readonly<{ base: string; head: string }>,
  path: string,
  previousPath: string,
  status: FileStatus,
) =>
  loadFilePairWithRefs(target, refs, {
    path,
    previousPath,
    status,
  }).pipe(Effect.map(({ oldText, newText }) => ({ oldText, newText })));

export const loadFilePairs = (
  target: GitHubTarget,
  files: ReadonlyArray<FileDescriptor>,
) =>
  Effect.gen(function* () {
    const refs = yield* loadTargetRefs(target);
    return yield* Effect.forEach(
      files,
      (file) => loadFilePairWithRefs(target, refs, file),
      { concurrency: 6 },
    );
  });

export const loadFilePairsAtRevision = (
  target: GitHubTarget,
  refs: Readonly<{ base: string; head: string }>,
  files: ReadonlyArray<FileDescriptor>,
) =>
  Effect.forEach(files, (file) => loadFilePairWithRefs(target, refs, file), {
    concurrency: 6,
  });
