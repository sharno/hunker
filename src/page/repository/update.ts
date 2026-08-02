import { Array, Match as M, Option } from "effect";
import { AsyncData, Command, Update } from "foldkit";
import { evo } from "foldkit/struct";

import { locationToAppRoute, repositoryRouter } from "../../app-route";
import type { Message } from "./message";
import {
  CloneRepository,
  FetchRepositoryFile,
  FetchRepositoryFiles,
  NavigateRepository,
  SearchRepository,
} from "./command";
import {
  Clone as CloneState,
  FileContent,
  Files,
  type File as RepositoryFileType,
  type Model,
  Model as ModelSchema,
  Search,
  type SearchMatch as RepositorySearchMatchType,
} from "./model";
import { directoryPaths, revealFileInTree } from "../../file-tree";

export type RepositoryRoute = Readonly<{ owner: string; name: string }>;
export type RepositoryOptions = Readonly<{ query: string; file: string }>;

export const repositoryRouteFromPathname = (
  pathname: string,
): RepositoryRoute | undefined =>
  M.value(locationToAppRoute(pathname)).pipe(
    M.tag("Repository", ({ owner, repository }) =>
      Option.all({
        owner: Option.liftThrowable(decodeURIComponent)(owner),
        name: Option.liftThrowable(decodeURIComponent)(repository),
      }).pipe(Option.getOrUndefined),
    ),
    M.orElse(() => undefined),
  );

export const repositoryOptionsFromSearch = (
  search: string,
): RepositoryOptions => {
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
  return `${repositoryRouter({
    owner: repository.owner,
    repository: repository.name,
  })}${search}`;
};

type RepositoryUpdate = Update.Return<Model, Message>;

const repositoryName = (model: Model) => `${model.owner}/${model.name}`;

const synchronizeRepositoryUrl = (
  model: Model,
  commands: ReadonlyArray<Command.Command<Message>>,
): RepositoryUpdate => {
  const href = localRepositoryUrl(
    { owner: model.owner, name: model.name },
    { query: model.query, file: model.selectedPath },
  );
  return [model, [...commands, NavigateRepository({ href })]];
};

export const load = (
  model: Model,
  route: RepositoryRoute,
  options: RepositoryOptions,
): RepositoryUpdate => {
  const sameRepository =
    model.owner === route.owner && model.name === route.name;
  const current = sameRepository
    ? evo(model, {
        query: () => options.query,
        selectedPath: () => options.file,
        collapsedFolders: (folders) =>
          options.file === ""
            ? folders
            : revealFileInTree(folders, options.file),
      })
    : ModelSchema.make({
        owner: route.owner,
        name: route.name,
        query: options.query,
        selectedPath: options.file,
        collapsedFolders: [],
        files: Files.Loading(),
        search: options.query === "" ? Search.Idle() : Search.Loading(),
        file: options.file === "" ? FileContent.Idle() : FileContent.Loading(),
        clone: CloneState.Idle(),
      });
  const maybeFilesCommand: Option.Option<Command.Command<Message>> =
    sameRepository &&
    (AsyncData.hasData(current.files) || AsyncData.isPending(current.files))
      ? Option.none()
      : Option.some(
          FetchRepositoryFiles({
            repository: `${route.owner}/${route.name}`,
          }),
        );
  const maybeSearchCommand: Option.Option<Command.Command<Message>> =
    options.query === "" ||
    (sameRepository &&
      (AsyncData.isPending(current.search) ||
        Option.exists(
          AsyncData.getData(current.search),
          (data) => data.query === options.query,
        )))
      ? Option.none()
      : Option.some(
          SearchRepository({
            repository: `${route.owner}/${route.name}`,
            query: options.query,
          }),
        );
  const maybeFileCommand: Option.Option<Command.Command<Message>> =
    options.file === "" ||
    (sameRepository &&
      (AsyncData.isPending(current.file) ||
        Option.exists(
          AsyncData.getData(current.file),
          (data) => data.path === options.file,
        )))
      ? Option.none()
      : Option.some(
          FetchRepositoryFile({
            repository: `${route.owner}/${route.name}`,
            path: options.file,
          }),
        );
  return [
    evo(current, {
      search: (state) =>
        Option.isSome(maybeSearchCommand) ? Search.Loading() : state,
      file: (state) =>
        Option.isSome(maybeFileCommand) ? FileContent.Loading() : state,
    }),
    [
      ...Array.fromOption(maybeFilesCommand),
      ...Array.fromOption(maybeSearchCommand),
      ...Array.fromOption(maybeFileCommand),
    ],
  ];
};

const filesLoaded = (
  model: Model,
  repository: string,
  files: ReadonlyArray<RepositoryFileType>,
): RepositoryUpdate =>
  repositoryName(model) !== repository
    ? [model, []]
    : [
        evo(model, {
          files: () => Files.Success({ data: files }),
          collapsedFolders: (folders) =>
            AsyncData.isLoading(model.files)
              ? revealFileInTree(
                  directoryPaths(files, (file) => file.path),
                  model.selectedPath,
                )
              : folders,
        }),
        [],
      ];

const filesFailed = (
  model: Model,
  repository: string,
  error: string,
  missing: boolean,
): RepositoryUpdate =>
  repositoryName(model) !== repository
    ? [model, []]
    : [
        evo(model, {
          files: () => Files.Failure({ error: { message: error, missing } }),
        }),
        [],
      ];

const requestClone = (
  model: Model,
  destination: "temporary" | "configured",
): RepositoryUpdate => {
  if (AsyncData.isPending(model.clone)) return [model, []];
  const next = evo(model, {
    clone: () => CloneState.Loading(),
  });
  return [
    next,
    [CloneRepository({ repository: repositoryName(next), destination })],
  ];
};

const cloned = (
  model: Model,
  repository: string,
  path: string,
): RepositoryUpdate => {
  if (
    repositoryName(model) !== repository ||
    !AsyncData.isPending(model.clone)
  ) {
    return [model, []];
  }
  const next = evo(model, {
    files: () => Files.Loading(),
    clone: () => CloneState.Success({ data: { path } }),
  });
  return [next, [FetchRepositoryFiles({ repository: repositoryName(next) })]];
};

const cloneFailed = (
  model: Model,
  repository: string,
  error: string,
): RepositoryUpdate =>
  repositoryName(model) !== repository
    ? [model, []]
    : [evo(model, { clone: () => CloneState.Failure({ error }) }), []];

const changeQuery = (model: Model, value: string): RepositoryUpdate => [
  evo(model, { query: () => value }),
  [],
];

const submitSearch = (model: Model): RepositoryUpdate => {
  const query = model.query.trim();
  if (query === "") {
    return synchronizeRepositoryUrl(
      evo(model, {
        query: () => "",
        search: () => Search.Idle(),
      }),
      [],
    );
  }
  const next = evo(model, {
    query: () => query,
    search: () => Search.Loading(),
  });
  return synchronizeRepositoryUrl(next, [
    SearchRepository({ repository: repositoryName(next), query }),
  ]);
};

const searchLoaded = (
  model: Model,
  input: Readonly<{
    repository: string;
    query: string;
    files: ReadonlyArray<RepositoryFileType>;
    matches: ReadonlyArray<RepositorySearchMatchType>;
  }>,
): RepositoryUpdate =>
  repositoryName(model) === input.repository && model.query === input.query
    ? [
        evo(model, {
          search: () =>
            Search.Success({
              data: {
                query: input.query,
                files: input.files,
                matches: input.matches,
              },
            }),
        }),
        [],
      ]
    : [model, []];

const searchFailed = (
  model: Model,
  repository: string,
  query: string,
  error: string,
): RepositoryUpdate =>
  repositoryName(model) === repository && model.query === query
    ? [evo(model, { search: () => Search.Failure({ error }) }), []]
    : [model, []];

const selectFile = (model: Model, path: string): RepositoryUpdate => {
  const next = evo(model, {
    selectedPath: () => path,
    collapsedFolders: (folders) => revealFileInTree(folders, path),
    file: () => FileContent.Loading(),
  });
  return synchronizeRepositoryUrl(next, [
    FetchRepositoryFile({ repository: repositoryName(next), path }),
  ]);
};

const closeFile = (model: Model): RepositoryUpdate =>
  synchronizeRepositoryUrl(
    evo(model, {
      selectedPath: () => "",
      file: () => FileContent.Idle(),
    }),
    [],
  );

const fileLoaded = (
  model: Model,
  input: Readonly<{
    repository: string;
    path: string;
    content: string;
    truncated: boolean;
  }>,
): RepositoryUpdate =>
  repositoryName(model) === input.repository &&
  model.selectedPath === input.path
    ? [
        evo(model, {
          file: () =>
            FileContent.Success({
              data: {
                path: input.path,
                content: input.content,
                truncated: input.truncated,
              },
            }),
        }),
        [],
      ]
    : [model, []];

const fileFailed = (
  model: Model,
  repository: string,
  path: string,
  error: string,
): RepositoryUpdate =>
  repositoryName(model) === repository && model.selectedPath === path
    ? [evo(model, { file: () => FileContent.Failure({ error }) }), []]
    : [model, []];

export const update = (model: Model, message: Message): RepositoryUpdate =>
  M.value(message).pipe(
    M.withReturnType<RepositoryUpdate>(),
    M.tagsExhaustive({
      CompletedNavigate: () => [model, []],
      SucceededFetchRepositoryFiles: ({ repository, files }) =>
        filesLoaded(model, repository, files),
      FailedFetchRepositoryFiles: ({ repository, error, missing }) =>
        filesFailed(model, repository, error, missing),
      ClickedCloneRepository: ({ destination }) =>
        requestClone(model, destination),
      SucceededCloneRepository: ({ repository, path }) =>
        cloned(model, repository, path),
      FailedCloneRepository: ({ repository, error }) =>
        cloneFailed(model, repository, error),
      UpdatedRepositoryQuery: ({ value }) => changeQuery(model, value),
      SubmittedRepositorySearch: () => submitSearch(model),
      SucceededSearchRepository: (input) => searchLoaded(model, input),
      FailedSearchRepository: ({ repository, query, error }) =>
        searchFailed(model, repository, query, error),
      SelectedRepositoryFile: ({ path }) => selectFile(model, path),
      ClickedCloseRepositoryFile: () => closeFile(model),
      SucceededFetchRepositoryFile: (input) => fileLoaded(model, input),
      FailedFetchRepositoryFile: ({ repository, path, error }) =>
        fileFailed(model, repository, path, error),
      ToggledRepositoryFolder: ({ path }) => [
        evo(model, {
          collapsedFolders: (folders) =>
            folders.includes(path)
              ? folders.filter((folder) => folder !== path)
              : [...folders, path],
        }),
        [],
      ],
    }),
  );
