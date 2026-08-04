import { Effect, Schema as S } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { Command } from "foldkit";

import { provideBrowserHttp, requestError, responseFailure } from "../api";
import {
  FailedFetchCommitDiff,
  FailedFetchCommits,
  FileChange,
  SucceededFetchCommitDiff,
  SucceededFetchCommits,
  PullCommit,
} from "../domain";
import type { Message, ReviewMeta } from "../domain";
import { parseGitDiff } from "../diff";

const commitsResponse = S.Struct({ commits: S.Array(PullCommit) });
const reviewResponse = S.Struct({
  title: S.String,
  repository: S.String,
  number: S.String,
  author: S.String,
  base: S.String,
  head: S.String,
  url: S.String,
  backing: S.Struct({
    source: S.Literals(["github", "local"]),
    baseOid: S.String,
    headOid: S.String,
    headRef: S.String,
    path: S.String,
  }),
  diff: S.String,
});

export const commitGitHubUrl = (meta: ReviewMeta, sha: string) =>
  `https://github.com/${meta.repository}/commit/${sha}`;

export const FetchCommits = Command.define("FetchCommits", {
  args: { url: S.String, baseOid: S.String, headOid: S.String },
  messages: [SucceededFetchCommits, FailedFetchCommits],
  execute: ({ url, baseOid, headOid }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const query = new URLSearchParams({ url, baseOid, headOid });
      const response = yield* client.execute(
        HttpClientRequest.get(`/api/commits?${query.toString()}`),
      );
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        return yield* responseFailure(
          data,
          "Could not load this pull request's commits.",
        );
      }
      const decoded = yield* S.decodeUnknownEffect(commitsResponse)(data);
      return SucceededFetchCommits({
        requestedUrl: url,
        commits: decoded.commits,
      });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          FailedFetchCommits({
            requestedUrl: url,
            error: requestError(error, "Could not load commits."),
          }),
        ),
      ),
      provideBrowserHttp,
    ),
});

export const FetchCommitDiff = Command.define("FetchCommitDiff", {
  args: { repository: S.String, sha: S.String },
  messages: [SucceededFetchCommitDiff, FailedFetchCommitDiff],
  execute: ({ repository, sha }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const url = `https://github.com/${repository}/commit/${sha}`;
      const response = yield* client.execute(
        HttpClientRequest.get(`/api/diff?url=${encodeURIComponent(url)}`),
      );
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        return yield* responseFailure(
          data,
          "Could not load this commit's diff.",
        );
      }
      const decoded = yield* S.decodeUnknownEffect(reviewResponse)(data);
      const files: ReadonlyArray<FileChange> = parseGitDiff(decoded.diff);
      return SucceededFetchCommitDiff({ sha, files });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          FailedFetchCommitDiff({
            sha,
            error: requestError(error, "Could not load commit diff."),
          }),
        ),
      ),
      provideBrowserHttp,
    ),
});

export type CommitCommand = Command.Command<Message>;
