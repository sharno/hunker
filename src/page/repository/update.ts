import { Array, Match as M, Option, Schema as S } from "effect";
import { AsyncData, Command, Update } from "foldkit";
import { evo } from "foldkit/struct";

import {
  locationToAppRoute,
  repositoryCommitsRouter,
  repositoryFileRouter,
  repositoryRouter,
} from "../../app-route";
import type { AppRoute } from "../../app-route";
import {
  RepositorySearchMode,
  type RepositorySearchMode as RepositorySearchModeType,
} from "../../features/code-search";
import type { Message } from "./message";
import {
  CloneRepository,
  FetchRepositoryCommits,
  FetchRepositoryFile,
  FetchRepositoryFiles,
  NavigateRepository,
  SearchRepository,
} from "./command";
import {
  Clone as CloneState,
  type Commit,
  Commits,
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
export type RepositoryOptions = Readonly<{
  query: string;
  searchMode: RepositorySearchModeType;
  file: string;
  tab: "files" | "commits";
}>;

const decodeRepositoryRoute = (owner: string, repository: string) =>
  Option.all({
    owner: Option.liftThrowable(decodeURIComponent)(owner),
    name: Option.liftThrowable(decodeURIComponent)(repository),
  }).pipe(Option.getOrUndefined);

export const repositoryRouteFromPathname = (
  pathname: string,
): RepositoryRoute | undefined => {
  return M.value(locationToAppRoute(pathname)).pipe(
    M.withReturnType<RepositoryRoute | undefined>(),
    M.tags({
      Repository: ({ owner, repository }) =>
        decodeRepositoryRoute(owner, repository),
      RepositoryCommits: ({ owner, repository }) =>
        decodeRepositoryRoute(owner, repository),
      RepositoryCommitsRef: ({ owner, repository }) =>
        decodeRepositoryRoute(owner, repository),
      RepositoryFile: ({ owner, repository }) =>
        decodeRepositoryRoute(owner, repository),
    }),
    M.orElse(() => undefined),
  );
};

export const repositoryOptionsFromSearch = (
  search: string,
): RepositoryOptions => {
  const params = new URLSearchParams(search);
  return {
    query: params.get("q") ?? "",
    searchMode: Option.getOrElse(
      S.decodeUnknownOption(RepositorySearchMode)(
        params.get("search") ?? "literal",
      ),
      (): "literal" => "literal",
    ),
    file: params.get("file") ?? "",
    tab: params.get("view") === "commits" ? "commits" : "files",
  };
};

export const repositoryOptionsFromRoute = (
  route: AppRoute,
  search: string,
): RepositoryOptions => {
  const legacy = repositoryOptionsFromSearch(search);
  return M.value(route).pipe(
    M.withReturnType<RepositoryOptions>(),
    M.tags({
      Repository: () => legacy,
      RepositoryCommits: () => ({
        query: legacy.query,
        searchMode: legacy.searchMode,
        file: "",
        tab: "commits",
      }),
      RepositoryCommitsRef: () => ({
        query: legacy.query,
        searchMode: legacy.searchMode,
        file: "",
        tab: "commits",
      }),
      RepositoryFile: ({ path }) => ({
        query: legacy.query,
        searchMode: legacy.searchMode,
        file: path,
        tab: "files",
      }),
    }),
    M.orElse(() => legacy),
  );
};

export const localRepositoryUrl = (
  repository: RepositoryRoute,
  options: RepositoryOptions = {
    query: "",
    searchMode: "literal",
    file: "",
    tab: "files",
  },
) => {
  const params = new URLSearchParams();
  if (options.query !== "") params.set("q", options.query);
  if (options.searchMode !== "literal")
    params.set("search", options.searchMode);
  const search = params.size === 0 ? "" : `?${params.toString()}`;
  const location =
    options.tab === "commits"
      ? repositoryCommitsRouter({
          owner: repository.owner,
          repository: repository.name,
        })
      : options.file !== ""
        ? repositoryFileRouter({
            owner: repository.owner,
            repository: repository.name,
            ref: "HEAD",
            path: options.file,
          })
        : repositoryRouter({
            owner: repository.owner,
            repository: repository.name,
          });
  return `${location}${search}`;
};

type RepositoryUpdate = Update.Return<Model, Message>;

const repositoryName = (model: Model) => `${model.owner}/${model.name}`;

const synchronizeRepositoryUrl = (
  model: Model,
  commands: ReadonlyArray<Command.Command<Message>>,
): RepositoryUpdate => {
  const href = localRepositoryUrl(
    { owner: model.owner, name: model.name },
    {
      query: model.query,
      searchMode: model.searchMode,
      file: model.selectedPath,
      tab: model.tab,
    },
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
  const sameSearch =
    sameRepository &&
    model.query === options.query &&
    model.searchMode === options.searchMode;
  const current = sameRepository
    ? evo(model, {
        query: () => options.query,
        searchMode: () => options.searchMode,
        selectedPath: () => options.file,
        tab: () => options.tab,
        collapsedFolders: (folders) =>
          options.file === ""
            ? folders
            : revealFileInTree(folders, options.file),
      })
    : ModelSchema.make({
        owner: route.owner,
        name: route.name,
        tab: options.tab,
        query: options.query,
        searchMode: options.searchMode,
        selectedPath: options.file,
        collapsedFolders: [],
        files: Files.Loading(),
        search: options.query === "" ? Search.Idle() : Search.Loading(),
        file: options.file === "" ? FileContent.Idle() : FileContent.Loading(),
        clone: CloneState.Idle(),
        commits: options.tab === "commits" ? Commits.Loading() : Commits.Idle(),
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
    (sameSearch &&
      (AsyncData.isPending(current.search) ||
        Option.exists(
          AsyncData.getData(current.search),
          (data) =>
            data.query === options.query && data.mode === options.searchMode,
        )))
      ? Option.none()
      : Option.some(
          SearchRepository({
            repository: `${route.owner}/${route.name}`,
            query: options.query,
            mode: options.searchMode,
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
  const maybeCommitsCommand: Option.Option<Command.Command<Message>> =
    options.tab !== "commits" ||
    (sameRepository &&
      (AsyncData.isPending(current.commits) ||
        AsyncData.hasData(current.commits)))
      ? Option.none()
      : Option.some(
          FetchRepositoryCommits({
            repository: `${route.owner}/${route.name}`,
          }),
        );
  return [
    evo(current, {
      search: (state) =>
        Option.isSome(maybeSearchCommand) ? Search.Loading() : state,
      file: (state) =>
        Option.isSome(maybeFileCommand) ? FileContent.Loading() : state,
      commits: (state) =>
        Option.isSome(maybeCommitsCommand) ? Commits.Loading() : state,
    }),
    [
      ...Array.fromOption(maybeFilesCommand),
      ...Array.fromOption(maybeSearchCommand),
      ...Array.fromOption(maybeFileCommand),
      ...Array.fromOption(maybeCommitsCommand),
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
    commits: () =>
      model.tab === "commits" ? Commits.Loading() : model.commits,
  });
  return [
    next,
    [
      FetchRepositoryFiles({ repository: repositoryName(next) }),
      ...(model.tab === "commits"
        ? [FetchRepositoryCommits({ repository: repositoryName(next) })]
        : []),
    ],
  ];
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
    SearchRepository({
      repository: repositoryName(next),
      query,
      mode: next.searchMode,
    }),
  ]);
};

const selectSearchMode = (
  model: Model,
  searchMode: RepositorySearchModeType,
): RepositoryUpdate => {
  if (model.searchMode === searchMode) return [model, []];
  const query = model.query.trim();
  const next = evo(model, {
    query: () => query,
    searchMode: () => searchMode,
    search: () => (query === "" ? Search.Idle() : Search.Loading()),
  });
  return synchronizeRepositoryUrl(
    next,
    query === ""
      ? []
      : [
          SearchRepository({
            repository: repositoryName(next),
            query,
            mode: searchMode,
          }),
        ],
  );
};

const searchLoaded = (
  model: Model,
  input: Readonly<{
    repository: string;
    query: string;
    mode: RepositorySearchModeType;
    files: ReadonlyArray<RepositoryFileType>;
    matches: ReadonlyArray<RepositorySearchMatchType>;
  }>,
): RepositoryUpdate =>
  repositoryName(model) === input.repository &&
  model.query === input.query &&
  model.searchMode === input.mode
    ? [
        evo(model, {
          search: () =>
            Search.Success({
              data: {
                query: input.query,
                mode: input.mode,
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
  mode: RepositorySearchModeType,
  error: string,
): RepositoryUpdate =>
  repositoryName(model) === repository &&
  model.query === query &&
  model.searchMode === mode
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

const selectTab = (
  model: Model,
  tab: "files" | "commits",
): RepositoryUpdate => {
  if (
    model.tab === tab &&
    !(tab === "commits" && AsyncData.isFailure(model.commits))
  ) {
    return [model, []];
  }
  const shouldLoadCommits =
    tab === "commits" &&
    !AsyncData.isPending(model.commits) &&
    !AsyncData.hasData(model.commits);
  return synchronizeRepositoryUrl(
    evo(model, {
      tab: () => tab,
      commits: (state) => (shouldLoadCommits ? Commits.Loading() : state),
    }),
    shouldLoadCommits
      ? [FetchRepositoryCommits({ repository: repositoryName(model) })]
      : [],
  );
};

const commitsLoaded = (
  model: Model,
  input: Readonly<{
    repository: string;
    ref: string;
    shallow: boolean;
    commits: ReadonlyArray<Commit>;
  }>,
): RepositoryUpdate =>
  repositoryName(model) === input.repository
    ? [
        evo(model, {
          commits: () =>
            Commits.Success({
              data: {
                ref: input.ref,
                shallow: input.shallow,
                commits: input.commits,
              },
            }),
        }),
        [],
      ]
    : [model, []];

const commitsFailed = (
  model: Model,
  repository: string,
  error: string,
): RepositoryUpdate =>
  repositoryName(model) === repository
    ? [evo(model, { commits: () => Commits.Failure({ error }) }), []]
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
      SelectedRepositorySearchMode: ({ mode }) => selectSearchMode(model, mode),
      SubmittedRepositorySearch: () => submitSearch(model),
      SucceededSearchRepository: (input) => searchLoaded(model, input),
      FailedSearchRepository: ({ repository, query, mode, error }) =>
        searchFailed(model, repository, query, mode, error),
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
      SelectedRepositoryTab: ({ tab }) => selectTab(model, tab),
      SucceededFetchRepositoryCommits: (input) => commitsLoaded(model, input),
      FailedFetchRepositoryCommits: ({ repository, error }) =>
        commitsFailed(model, repository, error),
    }),
  );
