import { Data, Effect, Schema as S } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { Command, Navigation } from "foldkit";

import {
  provideBrowserHttp,
  requestError,
  responseError,
  responseFailure,
} from "../../api";
import { RepositorySearchMode } from "../../features/code-search";
import {
  PullRequestFilter,
  RepositoryPullRequestsPage,
} from "../../features/repository-pulls";
import {
  CompletedNavigate,
  FailedCloneRepository,
  FailedFetchRepositoryFile,
  FailedFetchRepositoryFiles,
  FailedFetchRepositoryCommits,
  FailedFetchRepositoryPullRequests,
  FailedSearchRepository,
  SucceededCloneRepository,
  SucceededFetchRepositoryFile,
  SucceededFetchRepositoryFiles,
  SucceededFetchRepositoryCommits,
  SucceededFetchRepositoryPullRequests,
  SucceededSearchRepository,
} from "./message";
import { Commit, File, SearchMatch } from "./model";

const filesResponse = S.Struct({ files: S.Array(File) });
const searchResponse = S.Struct({
  files: S.Array(File),
  matches: S.Array(SearchMatch),
});
const fileResponse = S.Struct({
  path: S.String,
  content: S.String,
  truncated: S.Boolean,
});
const cloneResponse = S.Struct({ path: S.String });
const commitsResponse = S.Struct({
  ref: S.String,
  shallow: S.Boolean,
  commits: S.Array(Commit),
});

class RepositoryFilesRequestFailed extends Data.TaggedError(
  "RepositoryFilesRequestFailed",
)<{
  readonly message: string;
  readonly missing: boolean;
}> {}

export const FetchRepositoryFiles = Command.define("FetchRepositoryFiles", {
  args: { repository: S.String },
  messages: [SucceededFetchRepositoryFiles, FailedFetchRepositoryFiles],
  execute: ({ repository }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const response = yield* client.execute(
        HttpClientRequest.get(
          `/api/repository/files?repository=${encodeURIComponent(repository)}`,
        ),
      );
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        return yield* new RepositoryFilesRequestFailed({
          message: responseError(
            data,
            "Could not list local repository files.",
          ),
          missing: response.status === 404,
        });
      }
      const decoded = yield* S.decodeUnknownEffect(filesResponse)(data);
      return SucceededFetchRepositoryFiles({
        repository,
        files: decoded.files,
      });
    }).pipe(
      Effect.catchTag("RepositoryFilesRequestFailed", (error) =>
        Effect.succeed(
          FailedFetchRepositoryFiles({
            repository,
            error: error.message,
            missing: error.missing,
          }),
        ),
      ),
      Effect.catch((error) =>
        Effect.succeed(
          FailedFetchRepositoryFiles({
            repository,
            error: requestError(error, "Could not list files."),
            missing: false,
          }),
        ),
      ),
      provideBrowserHttp,
    ),
});

export const FetchRepositoryCommits = Command.define("FetchRepositoryCommits", {
  args: { repository: S.String },
  messages: [SucceededFetchRepositoryCommits, FailedFetchRepositoryCommits],
  execute: ({ repository }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const response = yield* client.execute(
        HttpClientRequest.get(
          `/api/repository/commits?repository=${encodeURIComponent(repository)}`,
        ),
      );
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        return yield* responseFailure(data, "Could not list local commits.");
      }
      const decoded = yield* S.decodeUnknownEffect(commitsResponse)(data);
      return SucceededFetchRepositoryCommits({ repository, ...decoded });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          FailedFetchRepositoryCommits({
            repository,
            error: requestError(error, "Could not list commits."),
          }),
        ),
      ),
      provideBrowserHttp,
    ),
});

export const FetchRepositoryPullRequests = Command.define(
  "FetchRepositoryPullRequests",
  {
    args: {
      repository: S.String,
      state: PullRequestFilter,
      page: S.Number,
    },
    messages: [
      SucceededFetchRepositoryPullRequests,
      FailedFetchRepositoryPullRequests,
    ],
    execute: ({ repository, state, page }) =>
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        const params = new URLSearchParams({
          repository,
          state,
          page: String(page),
        });
        const response = yield* client.execute(
          HttpClientRequest.get(`/api/repository/pulls?${params.toString()}`),
        );
        const data: unknown = yield* response.json;
        if (response.status < 200 || response.status >= 300) {
          return yield* responseFailure(data, "Could not list pull requests.");
        }
        const decoded = yield* S.decodeUnknownEffect(
          RepositoryPullRequestsPage,
        )(data);
        return SucceededFetchRepositoryPullRequests({
          repository,
          ...decoded,
        });
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed(
            FailedFetchRepositoryPullRequests({
              repository,
              state,
              page,
              error: requestError(error, "Could not list pull requests."),
            }),
          ),
        ),
        provideBrowserHttp,
      ),
  },
);

export const CloneRepository = Command.define("CloneRepository", {
  args: {
    repository: S.String,
    destination: S.Literals(["temporary", "configured"]),
  },
  messages: [SucceededCloneRepository, FailedCloneRepository],
  execute: ({ repository, destination }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const response = yield* client.execute(
        HttpClientRequest.post("/api/repository/clone").pipe(
          HttpClientRequest.bodyJsonUnsafe({ repository, destination }),
        ),
      );
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        return yield* responseFailure(data, "Could not clone this repository.");
      }
      const decoded = yield* S.decodeUnknownEffect(cloneResponse)(data);
      return SucceededCloneRepository({ repository, ...decoded });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          FailedCloneRepository({
            repository,
            error: requestError(error, "Could not clone repository."),
          }),
        ),
      ),
      provideBrowserHttp,
    ),
});

export const SearchRepository = Command.define("SearchRepository", {
  args: {
    repository: S.String,
    query: S.String,
    mode: RepositorySearchMode,
  },
  messages: [SucceededSearchRepository, FailedSearchRepository],
  execute: ({ repository, query, mode }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const params = new URLSearchParams({ repository, query, mode });
      const response = yield* client.execute(
        HttpClientRequest.get(`/api/repository/search?${params.toString()}`),
      );
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        return yield* responseFailure(
          data,
          "Could not search the local repository.",
        );
      }
      const decoded = yield* S.decodeUnknownEffect(searchResponse)(data);
      return SucceededSearchRepository({
        repository,
        query,
        mode,
        ...decoded,
      });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          FailedSearchRepository({
            repository,
            query,
            mode,
            error: requestError(error, "Could not search files."),
          }),
        ),
      ),
      provideBrowserHttp,
    ),
});

export const FetchRepositoryFile = Command.define("FetchRepositoryFile", {
  args: { repository: S.String, path: S.String },
  messages: [SucceededFetchRepositoryFile, FailedFetchRepositoryFile],
  execute: ({ repository, path }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const params = new URLSearchParams({ repository, path });
      const response = yield* client.execute(
        HttpClientRequest.get(`/api/repository/file?${params.toString()}`),
      );
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        return yield* responseFailure(data, `Could not read ${path}.`);
      }
      const decoded = yield* S.decodeUnknownEffect(fileResponse)(data);
      return SucceededFetchRepositoryFile({ repository, ...decoded });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          FailedFetchRepositoryFile({
            repository,
            path,
            error: requestError(error, `Could not read ${path}.`),
          }),
        ),
      ),
      provideBrowserHttp,
    ),
});

export const NavigateRepository = Command.define("NavigateRepository", {
  args: { href: S.String },
  messages: [CompletedNavigate],
  execute: ({ href }) =>
    Navigation.replaceUrl(href).pipe(Effect.as(CompletedNavigate())),
});
