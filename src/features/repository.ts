import { Effect, Schema as S } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { Command, Http, Navigation } from "foldkit";
import { evo } from "foldkit/struct";

import {
  ClonedRepository,
  FailedRepositoryClone,
  FailedRepositoryFile,
  FailedRepositoryFiles,
  FailedRepositorySearch,
  CompletedNavigation,
  LoadedRepositoryFile,
  LoadedRepositoryFiles,
  LoadedRepositorySearch,
  RepositoryFile,
  RepositorySearchMatch,
} from "../domain";
import type { Message, Model } from "../domain";
import type {
  RepositoryFile as RepositoryFileType,
  RepositorySearchMatch as RepositorySearchMatchType,
} from "../domain";

const responseError = (value: unknown, fallback: string) =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Record<string, unknown>).error === "string"
    ? String((value as Record<string, unknown>).error)
    : fallback;

export type RepositoryRoute = Readonly<{ owner: string; name: string }>;
export type RepositoryOptions = Readonly<{ query: string; file: string }>;

export const repositoryRouteFromPathname = (
  pathname: string,
): RepositoryRoute | undefined => {
  let segments: ReadonlyArray<string>;
  try {
    segments = pathname
      .split("/")
      .filter(Boolean)
      .map(segment => decodeURIComponent(segment));
  } catch {
    return undefined;
  }
  const [prefix, owner, name, ...remaining] = segments;
  return prefix === "repo" &&
    owner !== undefined &&
    name !== undefined &&
    remaining.length === 0
    ? { owner, name }
    : undefined;
};

export const repositoryOptionsFromSearch = (search: string): RepositoryOptions => {
  const params = new URLSearchParams(search);
  return { query: params.get("q") ?? "", file: params.get("file") ?? "" };
};

export const localRepositoryUrl = (
  repository: RepositoryRoute,
  options: RepositoryOptions = { query: "", file: "" },
) => {
  const params = new URLSearchParams();
  if (options.query !== "") params.set("q", options.query);
  if (options.file !== "") params.set("file", options.file);
  const search = params.size === 0 ? "" : `?${params.toString()}`;
  return `/repo/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}${search}`;
};

const filesResponse = S.Struct({ files: S.Array(RepositoryFile) });
const searchResponse = S.Struct({
  files: S.Array(RepositoryFile),
  matches: S.Array(RepositorySearchMatch),
});
const fileResponse = S.Struct({
  path: S.String,
  content: S.String,
  truncated: S.Boolean,
});
const cloneResponse = S.Struct({ path: S.String });

export const FetchRepositoryFiles = Command.define("FetchRepositoryFiles", {
  args: { repository: S.String },
  messages: [LoadedRepositoryFiles, FailedRepositoryFiles],
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
        return yield* Effect.fail(
          {
            _tag: "RepositoryFilesRequestFailed" as const,
            message: responseError(data, "Could not list local repository files."),
            missing: response.status === 404,
          },
        );
      }
      const decoded = yield* S.decodeUnknownEffect(filesResponse)(data);
      return LoadedRepositoryFiles({ repository, files: decoded.files });
    }).pipe(
      Effect.catch(error =>
        Effect.succeed(
          FailedRepositoryFiles({
            repository,
            error:
              typeof error === "object" &&
              error !== null &&
              "message" in error &&
              typeof error.message === "string"
                ? error.message
                : "Could not list files.",
            missing:
              typeof error === "object" &&
              error !== null &&
              "missing" in error &&
              error.missing === true,
          }),
        ),
      ),
      Effect.provide(Http.layer),
    ),
});

export const CloneRepository = Command.define("CloneRepository", {
  args: {
    repository: S.String,
    destination: S.Literals(["temporary", "configured"]),
  },
  messages: [ClonedRepository, FailedRepositoryClone],
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
        return yield* Effect.fail(
          new Error(responseError(data, "Could not clone this repository.")),
        );
      }
      const decoded = yield* S.decodeUnknownEffect(cloneResponse)(data);
      return ClonedRepository({ repository, ...decoded });
    }).pipe(
      Effect.catch(error =>
        Effect.succeed(
          FailedRepositoryClone({
            repository,
            error: error instanceof Error ? error.message : "Could not clone repository.",
          }),
        ),
      ),
      Effect.provide(Http.layer),
    ),
});

export const SearchRepository = Command.define("SearchRepository", {
  args: { repository: S.String, query: S.String },
  messages: [LoadedRepositorySearch, FailedRepositorySearch],
  execute: ({ repository, query }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const params = new URLSearchParams({ repository, query });
      const response = yield* client.execute(
        HttpClientRequest.get(`/api/repository/search?${params.toString()}`),
      );
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        return yield* Effect.fail(
          new Error(responseError(data, "Could not search the local repository.")),
        );
      }
      const decoded = yield* S.decodeUnknownEffect(searchResponse)(data);
      return LoadedRepositorySearch({ repository, query, ...decoded });
    }).pipe(
      Effect.catch(error =>
        Effect.succeed(
          FailedRepositorySearch({
            repository,
            query,
            error: error instanceof Error ? error.message : "Could not search files.",
          }),
        ),
      ),
      Effect.provide(Http.layer),
    ),
});

export const FetchRepositoryFile = Command.define("FetchRepositoryFile", {
  args: { repository: S.String, path: S.String },
  messages: [LoadedRepositoryFile, FailedRepositoryFile],
  execute: ({ repository, path }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const params = new URLSearchParams({ repository, path });
      const response = yield* client.execute(
        HttpClientRequest.get(`/api/repository/file?${params.toString()}`),
      );
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        return yield* Effect.fail(
          new Error(responseError(data, `Could not read ${path}.`)),
        );
      }
      const decoded = yield* S.decodeUnknownEffect(fileResponse)(data);
      return LoadedRepositoryFile({ repository, ...decoded });
    }).pipe(
      Effect.catch(error =>
        Effect.succeed(
          FailedRepositoryFile({
            repository,
            path,
            error: error instanceof Error ? error.message : `Could not read ${path}.`,
          }),
        ),
      ),
      Effect.provide(Http.layer),
    ),
});

type RepositoryUpdate = readonly [Model, ReadonlyArray<Command.Command<Message>>];

const NavigateRepository = Command.define("NavigateRepository", {
  args: { href: S.String },
  messages: [CompletedNavigation],
  execute: ({ href }) =>
    Navigation.replaceUrl(href).pipe(Effect.as(CompletedNavigation())),
});

const repositoryName = (model: Model) =>
  `${model.repositoryBrowser.owner}/${model.repositoryBrowser.name}`;

const synchronizeRepositoryUrl = (
  model: Model,
  commands: ReadonlyArray<Command.Command<Message>>,
): RepositoryUpdate => {
  const browser = model.repositoryBrowser;
  const href = localRepositoryUrl(
    { owner: browser.owner, name: browser.name },
    { query: browser.query, file: browser.selectedPath },
  );
  return [model, [...commands, NavigateRepository({ href })]];
};

export const loadRepositoryLocation = (
  model: Model,
  route: RepositoryRoute,
  options: RepositoryOptions,
): RepositoryUpdate => {
  const sameRepository =
    model.page === "repository" &&
    model.repositoryBrowser.owner === route.owner &&
    model.repositoryBrowser.name === route.name;
  const current = sameRepository
    ? evo(model, {
        repositoryBrowser: browser => ({
          ...browser,
          query: options.query,
          selectedPath: options.file,
        }),
      })
    : evo(model, {
        page: () => "repository" as const,
        githubInput: () => `https://github.com/${route.owner}/${route.name}`,
        githubInputError: () => "",
        repositoryBrowser: () => ({
          owner: route.owner,
          name: route.name,
          query: options.query,
          selectedPath: options.file,
          files: { _tag: "Loading" as const },
          search: options.query === ""
            ? { _tag: "Idle" as const }
            : { _tag: "Loading" as const, query: options.query },
          file: options.file === ""
            ? { _tag: "Idle" as const }
            : { _tag: "Loading" as const, path: options.file },
          clone: { _tag: "Idle" as const },
        }),
      });
  const browser = current.repositoryBrowser;
  const filesCommand =
    sameRepository &&
    (browser.files._tag === "Ready" || browser.files._tag === "Loading")
      ? []
      : [FetchRepositoryFiles({ repository: `${route.owner}/${route.name}` })];
  const searchCommand =
    options.query === "" ||
    (sameRepository &&
      browser.search._tag !== "Idle" &&
      browser.search.query === options.query)
      ? []
      : [
          SearchRepository({
            repository: `${route.owner}/${route.name}`,
            query: options.query,
          }),
        ];
  const fileCommand =
    options.file === "" ||
    (sameRepository && browser.file._tag !== "Idle" && browser.file.path === options.file)
      ? []
      : [
          FetchRepositoryFile({
            repository: `${route.owner}/${route.name}`,
            path: options.file,
          }),
        ];
  return [
    evo(current, {
      repositoryBrowser: value => ({
        ...value,
        search:
          options.query !== "" && searchCommand.length > 0
            ? { _tag: "Loading" as const, query: options.query }
            : value.search,
        file:
          options.file !== "" && fileCommand.length > 0
            ? { _tag: "Loading" as const, path: options.file }
            : value.file,
      }),
    }),
    [...filesCommand, ...searchCommand, ...fileCommand],
  ];
};

export const repositoryFilesLoaded = (
  model: Model,
  repository: string,
  files: ReadonlyArray<RepositoryFileType>,
): RepositoryUpdate =>
  model.page !== "repository" || repositoryName(model) !== repository
    ? [model, []]
    : [
        evo(model, {
          repositoryBrowser: browser => ({
            ...browser,
            files: { _tag: "Ready" as const, files },
          }),
        }),
        [],
      ];

export const repositoryFilesFailed = (
  model: Model,
  repository: string,
  error: string,
  missing: boolean,
): RepositoryUpdate =>
  model.page !== "repository" || repositoryName(model) !== repository
    ? [model, []]
    : [
        evo(model, {
          repositoryBrowser: browser => ({
            ...browser,
            files: { _tag: "Failed" as const, error, missing },
          }),
        }),
        [],
      ];

export const requestRepositoryClone = (
  model: Model,
  destination: "temporary" | "configured",
): RepositoryUpdate => {
  if (model.page !== "repository" || model.repositoryBrowser.clone._tag === "Loading") {
    return [model, []];
  }
  const next = evo(model, {
    repositoryBrowser: browser => ({
      ...browser,
      clone: { _tag: "Loading" as const, destination },
    }),
  });
  return [
    next,
    [CloneRepository({ repository: repositoryName(next), destination })],
  ];
};

export const repositoryCloned = (
  model: Model,
  repository: string,
  path: string,
): RepositoryUpdate => {
  if (
    model.page !== "repository" ||
    repositoryName(model) !== repository ||
    model.repositoryBrowser.clone._tag !== "Loading"
  ) {
    return [model, []];
  }
  const next = evo(model, {
    repositoryBrowser: browser => ({
      ...browser,
      files: { _tag: "Loading" as const },
      clone: { _tag: "Ready" as const, path },
    }),
  });
  return [next, [FetchRepositoryFiles({ repository: repositoryName(next) })]];
};

export const repositoryCloneFailed = (
  model: Model,
  repository: string,
  error: string,
): RepositoryUpdate =>
  model.page !== "repository" || repositoryName(model) !== repository
    ? [model, []]
    : [
        evo(model, {
          repositoryBrowser: browser => ({
            ...browser,
            clone: { _tag: "Failed" as const, error },
          }),
        }),
        [],
      ];

export const changeRepositoryQuery = (model: Model, value: string): RepositoryUpdate => [
  evo(model, {
    repositoryBrowser: browser => ({ ...browser, query: value }),
  }),
  [],
];

export const submitRepositorySearch = (model: Model): RepositoryUpdate => {
  const query = model.repositoryBrowser.query.trim();
  if (query === "") {
    return synchronizeRepositoryUrl(
      evo(model, {
        repositoryBrowser: browser => ({
          ...browser,
          query: "",
          search: { _tag: "Idle" as const },
        }),
      }),
      [],
    );
  }
  const next = evo(model, {
    repositoryBrowser: browser => ({
      ...browser,
      query,
      search: { _tag: "Loading" as const, query },
    }),
  });
  return synchronizeRepositoryUrl(next, [
    SearchRepository({ repository: repositoryName(next), query }),
  ]);
};

export const repositorySearchLoaded = (
  model: Model,
  input: Readonly<{
    repository: string;
    query: string;
    files: ReadonlyArray<RepositoryFileType>;
    matches: ReadonlyArray<RepositorySearchMatchType>;
  }>,
): RepositoryUpdate =>
  model.page === "repository" &&
  repositoryName(model) === input.repository &&
  model.repositoryBrowser.query === input.query
    ? [
        evo(model, {
          repositoryBrowser: browser => ({
            ...browser,
            search: {
              _tag: "Ready" as const,
              query: input.query,
              files: input.files,
              matches: input.matches,
            },
          }),
        }),
        [],
      ]
    : [model, []];

export const repositorySearchFailed = (
  model: Model,
  repository: string,
  query: string,
  error: string,
): RepositoryUpdate =>
  model.page === "repository" &&
  repositoryName(model) === repository &&
  model.repositoryBrowser.query === query
    ? [
        evo(model, {
          repositoryBrowser: browser => ({
            ...browser,
            search: { _tag: "Failed" as const, query, error },
          }),
        }),
        [],
      ]
    : [model, []];

export const selectRepositoryFile = (model: Model, path: string): RepositoryUpdate => {
  const next = evo(model, {
    repositoryBrowser: browser => ({
      ...browser,
      selectedPath: path,
      file: { _tag: "Loading" as const, path },
    }),
  });
  return synchronizeRepositoryUrl(next, [
    FetchRepositoryFile({ repository: repositoryName(next), path }),
  ]);
};

export const closeRepositoryFile = (model: Model): RepositoryUpdate =>
  synchronizeRepositoryUrl(
    evo(model, {
      repositoryBrowser: browser => ({
        ...browser,
        selectedPath: "",
        file: { _tag: "Idle" as const },
      }),
    }),
    [],
  );

export const repositoryFileLoaded = (
  model: Model,
  input: Readonly<{
    repository: string;
    path: string;
    content: string;
    truncated: boolean;
  }>,
): RepositoryUpdate =>
  model.page === "repository" &&
  repositoryName(model) === input.repository &&
  model.repositoryBrowser.selectedPath === input.path
    ? [
        evo(model, {
          repositoryBrowser: browser => ({
            ...browser,
            file: {
              _tag: "Ready" as const,
              path: input.path,
              content: input.content,
              truncated: input.truncated,
            },
          }),
        }),
        [],
      ]
    : [model, []];

export const repositoryFileFailed = (
  model: Model,
  repository: string,
  path: string,
  error: string,
): RepositoryUpdate =>
  model.page === "repository" &&
  repositoryName(model) === repository &&
  model.repositoryBrowser.selectedPath === path
    ? [
        evo(model, {
          repositoryBrowser: browser => ({
            ...browser,
            file: { _tag: "Failed" as const, path, error },
          }),
        }),
        [],
      ]
    : [model, []];
