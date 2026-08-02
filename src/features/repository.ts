import { Array, Effect, Match as M, Option, Schema as S } from "effect";
import { AsyncData, Command, Navigation, Update } from "foldkit";
import { evo } from "foldkit/struct";

import { locationToAppRoute, repositoryRouter } from "../app-route";
import * as GitHubLocation from "./github-location";
import {
  CompletedNavigate,
  RepositoryClone,
  RepositoryFileContent,
  RepositoryFiles,
  RepositorySearch,
} from "../domain";
import type { Message, Model } from "../domain";
import type {
  RepositoryFile as RepositoryFileType,
  RepositorySearchMatch as RepositorySearchMatchType,
} from "../domain";
import {
  CloneRepository,
  FetchRepositoryFile,
  FetchRepositoryFiles,
  SearchRepository,
} from "./repository-command";

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

const NavigateRepository = Command.define("NavigateRepository", {
  args: { href: S.String },
  messages: [CompletedNavigate],
  execute: ({ href }) =>
    Navigation.replaceUrl(href).pipe(Effect.as(CompletedNavigate())),
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
        repositoryBrowser: (browser) =>
          evo(browser, {
            query: () => options.query,
            selectedPath: () => options.file,
          }),
      })
    : evo(model, {
        page: () => "repository" as const,
        githubLocation: () =>
          GitHubLocation.replaceValue(
            `https://github.com/${route.owner}/${route.name}`,
            false,
          ),
        repositoryBrowser: () => ({
          owner: route.owner,
          name: route.name,
          query: options.query,
          selectedPath: options.file,
          files: RepositoryFiles.Loading(),
          search:
            options.query === ""
              ? RepositorySearch.Idle()
              : RepositorySearch.Loading(),
          file:
            options.file === ""
              ? RepositoryFileContent.Idle()
              : RepositoryFileContent.Loading(),
          clone: RepositoryClone.Idle(),
        }),
      });
  const browser = current.repositoryBrowser;
  const maybeFilesCommand: Option.Option<Command.Command<Message>> =
    sameRepository &&
    (AsyncData.hasData(browser.files) || AsyncData.isPending(browser.files))
      ? Option.none()
      : Option.some(
          FetchRepositoryFiles({
            repository: `${route.owner}/${route.name}`,
          }),
        );
  const maybeSearchCommand: Option.Option<Command.Command<Message>> =
    options.query === "" ||
    (sameRepository &&
      (AsyncData.isPending(browser.search) ||
        Option.exists(
          AsyncData.getData(browser.search),
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
      (AsyncData.isPending(browser.file) ||
        Option.exists(
          AsyncData.getData(browser.file),
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
      repositoryBrowser: (value) =>
        evo(value, {
          search: () =>
            Option.isSome(maybeSearchCommand)
              ? RepositorySearch.Loading()
              : value.search,
          file: () =>
            Option.isSome(maybeFileCommand)
              ? RepositoryFileContent.Loading()
              : value.file,
        }),
    }),
    [
      ...Array.fromOption(maybeFilesCommand),
      ...Array.fromOption(maybeSearchCommand),
      ...Array.fromOption(maybeFileCommand),
    ],
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
          repositoryBrowser: (browser) =>
            evo(browser, {
              files: () => RepositoryFiles.Success({ data: files }),
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
          repositoryBrowser: (browser) =>
            evo(browser, {
              files: () =>
                RepositoryFiles.Failure({
                  error: { message: error, missing },
                }),
            }),
        }),
        [],
      ];

export const requestRepositoryClone = (
  model: Model,
  destination: "temporary" | "configured",
): RepositoryUpdate => {
  if (
    model.page !== "repository" ||
    AsyncData.isPending(model.repositoryBrowser.clone)
  ) {
    return [model, []];
  }
  const next = evo(model, {
    repositoryBrowser: (browser) =>
      evo(browser, {
        clone: () => RepositoryClone.Loading(),
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
    !AsyncData.isPending(model.repositoryBrowser.clone)
  ) {
    return [model, []];
  }
  const next = evo(model, {
    repositoryBrowser: (browser) =>
      evo(browser, {
        files: () => RepositoryFiles.Loading(),
        clone: () => RepositoryClone.Success({ data: { path } }),
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
          repositoryBrowser: (browser) =>
            evo(browser, {
              clone: () => RepositoryClone.Failure({ error }),
            }),
        }),
        [],
      ];

export const changeRepositoryQuery = (
  model: Model,
  value: string,
): RepositoryUpdate => [
  evo(model, {
    repositoryBrowser: (browser) => evo(browser, { query: () => value }),
  }),
  [],
];

export const submitRepositorySearch = (model: Model): RepositoryUpdate => {
  const query = model.repositoryBrowser.query.trim();
  if (query === "") {
    return synchronizeRepositoryUrl(
      evo(model, {
        repositoryBrowser: (browser) =>
          evo(browser, {
            query: () => "",
            search: () => RepositorySearch.Idle(),
          }),
      }),
      [],
    );
  }
  const next = evo(model, {
    repositoryBrowser: (browser) =>
      evo(browser, {
        query: () => query,
        search: () => RepositorySearch.Loading(),
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
          repositoryBrowser: (browser) =>
            evo(browser, {
              search: () =>
                RepositorySearch.Success({
                  data: {
                    query: input.query,
                    files: input.files,
                    matches: input.matches,
                  },
                }),
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
          repositoryBrowser: (browser) =>
            evo(browser, {
              search: () => RepositorySearch.Failure({ error }),
            }),
        }),
        [],
      ]
    : [model, []];

export const selectRepositoryFile = (
  model: Model,
  path: string,
): RepositoryUpdate => {
  const next = evo(model, {
    repositoryBrowser: (browser) =>
      evo(browser, {
        selectedPath: () => path,
        file: () => RepositoryFileContent.Loading(),
      }),
  });
  return synchronizeRepositoryUrl(next, [
    FetchRepositoryFile({ repository: repositoryName(next), path }),
  ]);
};

export const closeRepositoryFile = (model: Model): RepositoryUpdate =>
  synchronizeRepositoryUrl(
    evo(model, {
      repositoryBrowser: (browser) =>
        evo(browser, {
          selectedPath: () => "",
          file: () => RepositoryFileContent.Idle(),
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
          repositoryBrowser: (browser) =>
            evo(browser, {
              file: () =>
                RepositoryFileContent.Success({
                  data: {
                    path: input.path,
                    content: input.content,
                    truncated: input.truncated,
                  },
                }),
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
          repositoryBrowser: (browser) =>
            evo(browser, {
              file: () => RepositoryFileContent.Failure({ error }),
            }),
        }),
        [],
      ]
    : [model, []];
