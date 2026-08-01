import { Effect, Schema as S } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { Command, Http, Navigation } from "foldkit";
import { evo } from "foldkit/struct";

import {
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
          new Error(responseError(data, "Could not list local repository files.")),
        );
      }
      const decoded = yield* S.decodeUnknownEffect(filesResponse)(data);
      return LoadedRepositoryFiles({ files: decoded.files });
    }).pipe(
      Effect.catch(error =>
        Effect.succeed(
          FailedRepositoryFiles({
            error: error instanceof Error ? error.message : "Could not list files.",
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
      return LoadedRepositorySearch({ query, ...decoded });
    }).pipe(
      Effect.catch(error =>
        Effect.succeed(
          FailedRepositorySearch({
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
      return LoadedRepositoryFile(decoded);
    }).pipe(
      Effect.catch(error =>
        Effect.succeed(
          FailedRepositoryFile({
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
  files: ReadonlyArray<RepositoryFileType>,
): RepositoryUpdate => [
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
  error: string,
): RepositoryUpdate => [
  evo(model, {
    repositoryBrowser: browser => ({
      ...browser,
      files: { _tag: "Failed" as const, error },
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
    query: string;
    files: ReadonlyArray<RepositoryFileType>;
    matches: ReadonlyArray<RepositorySearchMatchType>;
  }>,
): RepositoryUpdate =>
  model.page === "repository" && model.repositoryBrowser.query === input.query
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
  query: string,
  error: string,
): RepositoryUpdate =>
  model.page === "repository" && model.repositoryBrowser.query === query
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
  input: Readonly<{ path: string; content: string; truncated: boolean }>,
): RepositoryUpdate =>
  model.page === "repository" && model.repositoryBrowser.selectedPath === input.path
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
  path: string,
  error: string,
): RepositoryUpdate =>
  model.page === "repository" && model.repositoryBrowser.selectedPath === path
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
