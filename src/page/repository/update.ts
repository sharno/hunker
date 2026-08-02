import { Array, Match as M, Option, Schema as S } from "effect";
import { AsyncData, Command, Update } from "foldkit";
import { evo } from "foldkit/struct";

import {
  locationToAppRoute,
  repositoryCommitsRouter,
  repositoryFileRouter,
  repositoryPullsRouter,
  repositoryRouter,
} from "../../app-route";
import type { AppRoute } from "../../app-route";
import {
  RepositorySearchMode,
  type RepositorySearchMode as RepositorySearchModeType,
} from "../../features/code-search";
import {
  PullRequestFilter,
  type PullRequestFilter as PullRequestFilterType,
  type RepositoryPullRequest,
} from "../../features/repository-pulls";
import type { Message } from "./message";
import {
  CloneRepository,
  FetchRepositoryCommits,
  FetchRepositoryFile,
  FetchRepositoryFiles,
  FetchRepositoryPullRequests,
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
  PullRequests,
  Search,
  type SearchMatch as RepositorySearchMatchType,
} from "./model";
import { directoryPaths, revealFileInTree } from "../../file-tree";

export type RepositoryRoute = Readonly<{ owner: string; name: string }>;
export type RepositoryOptions = Readonly<{
  query: string;
  searchMode: RepositorySearchModeType;
  file: string;
  tab: "files" | "pulls" | "commits";
  pullRequestFilter: PullRequestFilterType;
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
      RepositoryPulls: ({ owner, repository }) =>
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
    pullRequestFilter: Option.getOrElse(
      S.decodeUnknownOption(PullRequestFilter)(params.get("state") ?? "open"),
      (): "open" => "open",
    ),
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
      RepositoryPulls: () => ({
        ...legacy,
        file: "",
        tab: "pulls",
      }),
      RepositoryCommits: () => ({
        ...legacy,
        file: "",
        tab: "commits",
      }),
      RepositoryCommitsRef: () => ({
        ...legacy,
        file: "",
        tab: "commits",
      }),
      RepositoryFile: ({ path }) => ({
        ...legacy,
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
    pullRequestFilter: "open",
  },
) => {
  const params = new URLSearchParams();
  if (options.tab === "files" && options.query !== "")
    params.set("q", options.query);
  if (options.tab === "files" && options.searchMode !== "literal")
    params.set("search", options.searchMode);
  if (options.tab === "pulls" && options.pullRequestFilter !== "open")
    params.set("state", options.pullRequestFilter);
  const search = params.size === 0 ? "" : `?${params.toString()}`;
  const location =
    options.tab === "pulls"
      ? repositoryPullsRouter({
          owner: repository.owner,
          repository: repository.name,
        })
      : options.tab === "commits"
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
      pullRequestFilter: model.pullRequestFilter,
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
  const samePullRequestList =
    sameRepository && model.pullRequestFilter === options.pullRequestFilter;
  const current = sameRepository
    ? evo(model, {
        query: () => options.query,
        searchMode: () => options.searchMode,
        pullRequestFilter: () => options.pullRequestFilter,
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
        pullRequestFilter: options.pullRequestFilter,
        query: options.query,
        searchMode: options.searchMode,
        selectedPath: options.file,
        collapsedFolders: [],
        files: options.tab === "pulls" ? Files.Idle() : Files.Loading(),
        search:
          options.tab !== "files" || options.query === ""
            ? Search.Idle()
            : Search.Loading(),
        file:
          options.tab !== "files" || options.file === ""
            ? FileContent.Idle()
            : FileContent.Loading(),
        clone: CloneState.Idle(),
        commits: options.tab === "commits" ? Commits.Loading() : Commits.Idle(),
        pullRequests:
          options.tab === "pulls"
            ? PullRequests.Loading()
            : PullRequests.Idle(),
      });
  const maybeFilesCommand: Option.Option<Command.Command<Message>> =
    options.tab === "pulls" ||
    (sameRepository &&
      (AsyncData.hasData(current.files) || AsyncData.isPending(current.files)))
      ? Option.none()
      : Option.some(
          FetchRepositoryFiles({
            repository: `${route.owner}/${route.name}`,
          }),
        );
  const maybeSearchCommand: Option.Option<Command.Command<Message>> =
    options.tab !== "files" ||
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
    options.tab !== "files" ||
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
  const maybePullRequestsCommand: Option.Option<Command.Command<Message>> =
    options.tab !== "pulls" ||
    (samePullRequestList &&
      (AsyncData.isPending(current.pullRequests) ||
        AsyncData.hasData(current.pullRequests)))
      ? Option.none()
      : Option.some(
          FetchRepositoryPullRequests({
            repository: `${route.owner}/${route.name}`,
            state: options.pullRequestFilter,
            page: 1,
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
      pullRequests: (state) =>
        Option.isSome(maybePullRequestsCommand)
          ? PullRequests.Loading()
          : state,
    }),
    [
      ...Array.fromOption(maybeFilesCommand),
      ...Array.fromOption(maybeSearchCommand),
      ...Array.fromOption(maybeFileCommand),
      ...Array.fromOption(maybeCommitsCommand),
      ...Array.fromOption(maybePullRequestsCommand),
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
  tab: "files" | "pulls" | "commits",
): RepositoryUpdate => {
  if (
    model.tab === tab &&
    !(tab === "commits" && AsyncData.isFailure(model.commits)) &&
    !(tab === "pulls" && AsyncData.isFailure(model.pullRequests))
  ) {
    return [model, []];
  }
  const shouldLoadFiles =
    tab !== "pulls" &&
    !AsyncData.isPending(model.files) &&
    !AsyncData.hasData(model.files);
  const shouldLoadCommits =
    tab === "commits" &&
    !AsyncData.isPending(model.commits) &&
    !AsyncData.hasData(model.commits);
  const shouldLoadPullRequests =
    tab === "pulls" &&
    !AsyncData.isPending(model.pullRequests) &&
    !AsyncData.hasData(model.pullRequests);
  return synchronizeRepositoryUrl(
    evo(model, {
      tab: () => tab,
      files: (state) => (shouldLoadFiles ? Files.Loading() : state),
      commits: (state) => (shouldLoadCommits ? Commits.Loading() : state),
      pullRequests: (state) =>
        shouldLoadPullRequests ? PullRequests.Loading() : state,
    }),
    [
      ...(shouldLoadFiles
        ? [FetchRepositoryFiles({ repository: repositoryName(model) })]
        : []),
      ...(shouldLoadCommits
        ? [FetchRepositoryCommits({ repository: repositoryName(model) })]
        : []),
      ...(shouldLoadPullRequests
        ? [
            FetchRepositoryPullRequests({
              repository: repositoryName(model),
              state: model.pullRequestFilter,
              page: 1,
            }),
          ]
        : []),
    ],
  );
};

const selectPullRequestFilter = (
  model: Model,
  state: PullRequestFilterType,
): RepositoryUpdate => {
  if (
    model.pullRequestFilter === state &&
    !AsyncData.isFailure(model.pullRequests)
  ) {
    return [model, []];
  }
  const next = evo(model, {
    tab: (): "pulls" => "pulls",
    pullRequestFilter: () => state,
    pullRequests: () => PullRequests.Loading(),
  });
  return synchronizeRepositoryUrl(next, [
    FetchRepositoryPullRequests({
      repository: repositoryName(next),
      state,
      page: 1,
    }),
  ]);
};

const loadMorePullRequests = (model: Model): RepositoryUpdate => {
  const data = Option.getOrUndefined(AsyncData.getData(model.pullRequests));
  if (
    data === undefined ||
    !data.hasMore ||
    AsyncData.isPending(model.pullRequests)
  ) {
    return [model, []];
  }
  return [
    evo(model, {
      pullRequests: () => PullRequests.Refreshing({ data }),
    }),
    [
      FetchRepositoryPullRequests({
        repository: repositoryName(model),
        state: model.pullRequestFilter,
        page: data.page + 1,
      }),
    ],
  ];
};

const mergePullRequests = (
  current: ReadonlyArray<RepositoryPullRequest>,
  incoming: ReadonlyArray<RepositoryPullRequest>,
) => {
  const byNumber = new Map(
    current.map((pullRequest) => [pullRequest.number, pullRequest]),
  );
  for (const pullRequest of incoming) {
    byNumber.set(pullRequest.number, pullRequest);
  }
  return [...byNumber.values()];
};

const pullRequestsLoaded = (
  model: Model,
  input: Readonly<{
    repository: string;
    state: PullRequestFilterType;
    page: number;
    hasMore: boolean;
    pullRequests: ReadonlyArray<RepositoryPullRequest>;
  }>,
): RepositoryUpdate => {
  if (
    repositoryName(model) !== input.repository ||
    model.pullRequestFilter !== input.state
  ) {
    return [model, []];
  }
  const current = Option.getOrUndefined(AsyncData.getData(model.pullRequests));
  if (input.page !== 1 && input.page !== (current?.page ?? 0) + 1) {
    return [model, []];
  }
  return [
    evo(model, {
      pullRequests: () =>
        PullRequests.Success({
          data: {
            state: input.state,
            page: input.page,
            hasMore: input.hasMore,
            pullRequests:
              input.page === 1 || current === undefined
                ? input.pullRequests
                : mergePullRequests(current.pullRequests, input.pullRequests),
          },
        }),
    }),
    [],
  ];
};

const pullRequestsFailed = (
  model: Model,
  repository: string,
  state: PullRequestFilterType,
  page: number,
  error: string,
): RepositoryUpdate => {
  if (
    repositoryName(model) !== repository ||
    model.pullRequestFilter !== state
  ) {
    return [model, []];
  }
  const current = Option.getOrUndefined(AsyncData.getData(model.pullRequests));
  if (page > 1 && current !== undefined && page === current.page + 1) {
    return [
      evo(model, {
        pullRequests: () => PullRequests.Stale({ data: current, error }),
      }),
      [],
    ];
  }
  return [
    evo(model, { pullRequests: () => PullRequests.Failure({ error }) }),
    [],
  ];
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
      SelectedPullRequestFilter: ({ state }) =>
        selectPullRequestFilter(model, state),
      ClickedLoadMorePullRequests: () => loadMorePullRequests(model),
      SucceededFetchRepositoryPullRequests: (input) =>
        pullRequestsLoaded(model, input),
      FailedFetchRepositoryPullRequests: ({ repository, state, page, error }) =>
        pullRequestsFailed(model, repository, state, page, error),
      SucceededFetchRepositoryCommits: (input) => commitsLoaded(model, input),
      FailedFetchRepositoryCommits: ({ repository, error }) =>
        commitsFailed(model, repository, error),
    }),
  );
