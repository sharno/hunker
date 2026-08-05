import { Array, Match as M, Option } from "effect";
import { AsyncData, Command, Route, Runtime, Update, Url } from "foldkit";
import { evo } from "foldkit/struct";
import { Popover } from "@foldkit/ui";

import {
  NotFoundRoute,
  reviewRouteToGitHubUrl,
  urlToAppRoute,
} from "./app-route";
import type { AppRoute } from "./app-route";
import {
  FetchCharacterDiff,
  FetchFullFile,
  FetchGitHubReviews,
  FetchMoves,
  FetchReview,
  FetchSemantic,
  CanonicalizeLocation,
  LoadExternalLocation,
  PostPullRequestReview,
  PostReviewReply,
  VisitSemanticMove,
  VisitLocation,
} from "./command";
import {
  ChangedUrl,
  CharacterDiffState,
  CommitDiff,
  FullFileState,
  GitHubReviews,
  GotDiffOptionsPopoverMessage,
  GotGitHubLocationMessage,
  GotInlineCommentMessage,
  GotHomeMessage,
  GotOpenReviewPopoverMessage,
  GotRepositoryMessage,
  GotSettingsMessage,
  Model,
  PullCommits,
  ClickedLink,
  ReplyFailed,
  ReplyLoading,
  ReviewFailed,
  ReviewIdle,
  ReviewLoading,
  ReviewMoves,
  ReviewReady,
  ReviewMeta,
  ReviewRevisionAvailable,
  ReviewRevisionChecking,
  ReviewRevisionCurrent,
  ReviewRevisionFailed,
  ReviewRevisionIdle,
  ReviewSubmission,
  SemanticRequestFailed,
  SemanticRequestIdle,
  SemanticRequestLoading,
} from "./domain";
import type { FileChange, Message, Model as ModelType } from "./domain";
import { hunkKey } from "./diff";
import { revealFileInTree } from "./file-tree";
import {
  commitGitHubUrl,
  FetchCommitDiff,
  FetchCommits,
} from "./features/commits";
import { CheckReviewRevision } from "./features/revision";
import * as Repository from "./page/repository";
import * as Settings from "./page/settings";
import * as Home from "./page/home";
import type { AppResources } from "./resources";
import type { HunkerSettings } from "./settings";
import {
  defaultReviewOptions,
  hasLegacyReviewSettings,
  isPullRequestUrl,
  localLocationFromGitHubUrl,
  localReviewUrl,
  reviewOptionsFromRoute,
  reviewOptionsFromSettings,
  reviewRouteFromAppRoute,
  type ReviewOptions,
} from "./review-route";
import * as GitHubLocation from "./features/github-location";
import * as InlineComment from "./features/inline-comment";

type UpdateReturn = Update.Return<ModelType, Message, AppResources>;
type AppCommands = Update.Commands<Message, AppResources>;

const initialDiffOptionsPopover = () =>
  Popover.init({ id: "diff-options-popover" });
const initialOpenReviewPopover = () =>
  Popover.init({ id: "open-review-popover" });

const toggleMembership = <A>(values: ReadonlyArray<A>, value: A) =>
  values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];

const setMembership = <A>(
  values: ReadonlyArray<A>,
  value: A,
  included: boolean,
) =>
  included
    ? values.includes(value)
      ? values
      : [...values, value]
    : values.filter((item) => item !== value);

const activeDiffUrl = (model: ModelType) =>
  model.reviewTab === "commits" && model.selectedCommit !== ""
    ? commitGitHubUrl(model.meta, model.selectedCommit)
    : model.meta.url;

const isReviewLocation = (model: ModelType) =>
  reviewRouteFromAppRoute(model.location) !== undefined;

const reviewUrlAtLocation = (model: ModelType): string | undefined => {
  const route = reviewRouteFromAppRoute(model.location);
  return route === undefined ? undefined : reviewRouteToGitHubUrl(route);
};

const activeRevision = (model: ModelType) =>
  model.reviewTab === "commits" && model.selectedCommit !== ""
    ? { baseOid: "", headOid: "" }
    : {
        baseOid: model.meta.backing.baseOid,
        headOid: model.meta.backing.headOid,
      };

const isCurrentReviewRequest = (model: ModelType, requestedUrl: string) =>
  model.reviewState._tag === "Loading" &&
  model.reviewState.url === requestedUrl;

const isCurrentPullRequest = (model: ModelType, requestedUrl: string) =>
  model.reviewState._tag === "Ready" &&
  model.reviewState.url === requestedUrl &&
  model.meta.url === requestedUrl;

const isCurrentDiffRequest = (model: ModelType, requestedUrl: string) =>
  model.reviewState._tag === "Ready" && activeDiffUrl(model) === requestedUrl;

const requestSemantic = (model: ModelType, file: FileChange): UpdateReturn => {
  const alreadyLoaded = model.semanticResults.some(
    (result) => result.path === file.path,
  );
  const alreadyLoading =
    model.semanticRequest._tag === "Loading" &&
    model.semanticRequest.path === file.path;
  if (
    !isReviewLocation(model) ||
    model.reviewState._tag !== "Ready" ||
    !model.semantic ||
    alreadyLoaded ||
    alreadyLoading
  ) {
    return [model, []];
  }
  return [
    evo(model, {
      semanticRequest: () => SemanticRequestLoading({ path: file.path }),
    }),
    [
      FetchSemantic({
        url: activeDiffUrl(model),
        ...activeRevision(model),
        path: file.path,
        previousPath: file.previousPath,
        status: file.status,
      }),
    ],
  ];
};

const requestMoves = (model: ModelType): UpdateReturn => {
  if (
    !isReviewLocation(model) ||
    model.reviewState._tag !== "Ready" ||
    !model.semantic ||
    model.reviewTab !== "files" ||
    AsyncData.isPending(model.reviewMoves) ||
    AsyncData.hasData(model.reviewMoves)
  ) {
    return [model, []];
  }
  return [
    evo(model, { reviewMoves: () => ReviewMoves.Loading() }),
    [FetchMoves({ url: activeDiffUrl(model), ...activeRevision(model) })],
  ];
};

const requestGitHubReviews = (model: ModelType): UpdateReturn => {
  if (
    !isReviewLocation(model) ||
    model.reviewState._tag !== "Ready" ||
    !model.showGitHubReviews ||
    model.reviewTab !== "files" ||
    !isPullRequestUrl(model.meta.url) ||
    AsyncData.isPending(model.githubReviews) ||
    AsyncData.hasData(model.githubReviews)
  ) {
    return [model, []];
  }
  return [
    evo(model, { githubReviews: () => GitHubReviews.Loading() }),
    [FetchGitHubReviews({ url: model.meta.url })],
  ];
};

const requestCharacterDiff = (
  model: ModelType,
  file: FileChange,
): UpdateReturn => {
  if (
    !isReviewLocation(model) ||
    model.reviewState._tag !== "Ready" ||
    model.inlineDiffMode === "off"
  ) {
    return [model, []];
  }
  const mode = model.inlineDiffMode;
  const requested = model.characterDiffStates.some(
    (entry) =>
      entry.path === file.path &&
      entry.ignoreWhitespace === model.ignoreWhitespace &&
      entry.mode === mode &&
      !AsyncData.isFailure(entry.state),
  );
  if (requested) {
    return [model, []];
  }
  return [
    evo(model, {
      characterDiffStates: (states) => [
        ...states,
        {
          path: file.path,
          ignoreWhitespace: model.ignoreWhitespace,
          mode,
          state: CharacterDiffState.Loading(),
        },
      ],
    }),
    [
      FetchCharacterDiff({
        url: activeDiffUrl(model),
        ...activeRevision(model),
        path: file.path,
        previousPath: file.previousPath,
        status: file.status,
        ignoreWhitespace: model.ignoreWhitespace,
        mode,
      }),
    ],
  ];
};

const requestCharacterDiffs = (model: ModelType): UpdateReturn => {
  const maybeSelected = Array.findFirst(
    model.files,
    (file) => file.path === model.selectedPath,
  );
  const files =
    model.reviewScope === "full"
      ? model.files
      : Array.fromOption(maybeSelected);
  return Update.combine(
    model,
    Array.map(
      files,
      (file) => (current: ModelType) => requestCharacterDiff(current, file),
    ),
  );
};

const requestSelectedSemantic = (model: ModelType): UpdateReturn =>
  Option.match(
    Array.findFirst(model.files, (file) => file.path === model.selectedPath),
    {
      onNone: () => [model, []],
      onSome: (file) => requestSemantic(model, file),
    },
  );

const requestSelectedIntelligence = (model: ModelType): UpdateReturn =>
  Update.combine(model, [
    requestSelectedSemantic,
    requestMoves,
    requestGitHubReviews,
    requestCharacterDiffs,
  ]);

const resetDiffAnalysis = (model: ModelType): ModelType =>
  evo(model, {
    semanticResults: () => [],
    semanticRequest: () => SemanticRequestIdle(),
    reviewMoves: () => ReviewMoves.Idle(),
    characterDiffStates: () => [],
    collapsedPaths: () => [],
    collapsedHunks: () => [],
    fullFileStates: () => [],
  });

const requestCommits = (model: ModelType): UpdateReturn => {
  if (
    !isReviewLocation(model) ||
    model.reviewState._tag !== "Ready" ||
    !isPullRequestUrl(model.meta.url) ||
    AsyncData.isPending(model.commits) ||
    AsyncData.hasData(model.commits)
  ) {
    return [model, []];
  }
  return [
    evo(model, { commits: () => PullCommits.Loading() }),
    [
      FetchCommits({
        url: model.meta.url,
        baseOid: model.meta.backing.baseOid,
        headOid: model.meta.backing.headOid,
      }),
    ],
  ];
};

const requestCommitDiff = (model: ModelType, sha: string): UpdateReturn => {
  if (
    !isReviewLocation(model) ||
    sha === "" ||
    !isPullRequestUrl(model.meta.url)
  ) {
    return [model, []];
  }
  if (AsyncData.isPending(model.commitDiff)) {
    return [model, []];
  }
  const cached = Option.getOrUndefined(AsyncData.getData(model.commitDiff));
  if (cached?.sha === sha) {
    const files = cached.files;
    const selectedPath = files.some((file) => file.path === model.selectedPath)
      ? model.selectedPath
      : (files[0]?.path ?? "");
    const ready = resetDiffAnalysis(
      evo(model, {
        selectedCommit: () => sha,
        files: () => files,
        selectedPath: () => selectedPath,
        collapsedFileTreeFolders: (folders) =>
          revealFileInTree(folders, selectedPath),
      }),
    );
    return requestSelectedIntelligence(ready);
  }
  return [
    resetDiffAnalysis(
      evo(model, {
        selectedCommit: () => sha,
        commitDiff: () => CommitDiff.Loading(),
      }),
    ),
    [FetchCommitDiff({ repository: model.meta.repository, sha })],
  ];
};

const requestReviewLocation = (model: ModelType): UpdateReturn => {
  if (model.reviewTab === "files") return requestSelectedIntelligence(model);
  const [withCommits, commitCommands] = requestCommits(model);
  if (model.selectedCommit === "" || !AsyncData.hasData(withCommits.commits)) {
    return [withCommits, commitCommands];
  }
  const commits = AsyncData.getOrElse(withCommits.commits, () => []);
  if (!commits.some((commit) => commit.sha === model.selectedCommit)) {
    return canonicalizeReviewUrl(
      evo(withCommits, {
        selectedCommit: () => "",
        commitDiff: () => CommitDiff.Idle(),
      }),
      commitCommands,
    );
  }
  const [withDiff, diffCommands] = requestCommitDiff(
    withCommits,
    model.selectedCommit,
  );
  return [withDiff, [...commitCommands, ...diffCommands]];
};

const beginReviewLoad = (model: ModelType, url: string): ModelType =>
  evo(model, {
    reviewState: () => ReviewLoading({ url }),
    githubLocation: () => GitHubLocation.replaceValue(url, true),
    reviewRevision: () => ReviewRevisionIdle(),
    filter: () => "",
    filterMode: (): "literal" => "literal",
    files: () => [],
    pullRequestFiles: () => [],
    semanticResults: () => [],
    semanticRequest: () => SemanticRequestIdle(),
    reviewMoves: () => ReviewMoves.Idle(),
    characterDiffStates: () => [],
    reviewedPaths: () => [],
    collapsedFileTreeFolders: () => [],
    collapsedPaths: () => [],
    collapsedHunks: () => [],
    fullFileStates: () => [],
    githubReviews: () => GitHubReviews.Idle(),
    collapsedReviewThreads: () => [],
    replyDrafts: () => [],
    replyStates: () => [],
    inlineComment: () => InlineComment.empty(),
    reviewBody: () => "",
    reviewSubmission: () => ReviewSubmission.Idle(),
    commits: () => PullCommits.Idle(),
    commitDiff: () => CommitDiff.Idle(),
    diffOptionsPopover: initialDiffOptionsPopover,
    openReviewPopover: initialOpenReviewPopover,
  });

const reviewOptions = (model: ModelType): ReviewOptions => ({
  reviewScope: model.reviewScope,
  viewMode: model.viewMode,
  ignoreWhitespace: model.ignoreWhitespace,
  semantic: model.semantic,
  inlineDiffMode: model.inlineDiffMode,
  syntaxHighlighting: model.syntaxHighlighting,
  sidebarCollapsed: model.sidebarCollapsed,
  showGitHubReviews: model.showGitHubReviews,
  selectedPath: model.selectedPath,
  reviewTab: model.reviewTab,
  selectedCommit: model.selectedCommit,
});

const locationDefaults = (model: ModelType): ReviewOptions => ({
  ...reviewOptions(model),
  selectedPath: "",
  reviewTab: "files",
  selectedCommit: "",
});

const applyReviewOptions = (
  model: ModelType,
  options: ReviewOptions,
): ModelType =>
  evo(model, {
    reviewScope: () => options.reviewScope,
    viewMode: () => options.viewMode,
    ignoreWhitespace: () => options.ignoreWhitespace,
    semantic: () => options.semantic,
    inlineDiffMode: () => options.inlineDiffMode,
    syntaxHighlighting: () => options.syntaxHighlighting,
    sidebarCollapsed: () => options.sidebarCollapsed,
    showGitHubReviews: () => options.showGitHubReviews,
    selectedPath: () => options.selectedPath,
    collapsedFileTreeFolders: (folders) =>
      options.selectedPath === ""
        ? folders
        : revealFileInTree(folders, options.selectedPath),
    reviewTab: () => options.reviewTab,
    selectedCommit: () => options.selectedCommit,
  });

const applySettings = (model: ModelType, settings: HunkerSettings): ModelType =>
  applyReviewOptions(model, {
    ...reviewOptionsFromSettings(settings),
    selectedPath: model.selectedPath,
    reviewTab: model.reviewTab,
    selectedCommit: model.selectedCommit,
  });

const persistReviewSettings = (
  model: ModelType,
  commands: AppCommands,
): UpdateReturn => {
  const [settings, settingsCommands] = Settings.save(model.settings, {
    ...model.settings.draft,
    reviewScope: model.reviewScope,
    viewMode: model.viewMode,
    ignoreWhitespace: model.ignoreWhitespace,
    semantic: model.semantic,
    inlineDiffMode: model.inlineDiffMode,
    syntaxHighlighting: model.syntaxHighlighting,
    sidebarCollapsed: model.sidebarCollapsed,
    showGitHubReviews: model.showGitHubReviews,
  });
  return [
    evo(model, {
      settings: () => settings,
      legacyReviewSettings: () => false,
    }),
    [
      ...commands,
      ...Command.mapMessages(settingsCommands, (message) =>
        GotSettingsMessage({ message }),
      ),
    ],
  ];
};

const canonicalizeReviewUrl = (
  model: ModelType,
  commands: AppCommands,
): UpdateReturn => {
  if (
    reviewUrlAtLocation(model) !== model.meta.url ||
    model.reviewState._tag !== "Ready" ||
    model.reviewState.url !== model.meta.url
  ) {
    return [model, commands];
  }
  const href = localReviewUrl(model.meta.url, reviewOptions(model));
  return href === undefined
    ? [model, commands]
    : [model, [...commands, CanonicalizeLocation({ href })]];
};

const visitReviewUrl = (
  model: ModelType,
  commands: AppCommands,
): UpdateReturn => {
  if (
    reviewUrlAtLocation(model) !== model.meta.url ||
    model.reviewState._tag !== "Ready" ||
    model.reviewState.url !== model.meta.url
  ) {
    return [model, commands];
  }
  const href = localReviewUrl(model.meta.url, reviewOptions(model));
  return href === undefined
    ? [model, commands]
    : [model, [...commands, VisitLocation({ href })]];
};

const changeReviewLocation = (
  model: ModelType,
  route: AppRoute,
  search: string,
): UpdateReturn => {
  const reviewRoute = reviewRouteFromAppRoute(route);
  if (reviewRoute === undefined) {
    return showNotFound(
      evo(model, {
        location: () => NotFoundRoute({ path: `Invalid ${route._tag} route` }),
      }),
    );
  }
  const reviewUrl = reviewRouteToGitHubUrl(reviewRoute);
  const options = reviewOptionsFromRoute(
    route,
    search,
    locationDefaults(model),
  );
  const tabChanged = options.reviewTab !== model.reviewTab;
  const withOptions = applyReviewOptions(model, options);
  const locatedOptions = evo(withOptions, {
    legacyReviewSettings: () => hasLegacyReviewSettings(search),
  });
  if (
    model.reviewState._tag === "Loading" &&
    reviewUrl === model.reviewState.url
  ) {
    return [locatedOptions, []];
  }
  if (
    (model.reviewState._tag !== "Idle" &&
      reviewUrl === model.reviewState.url) ||
    (model.reviewState._tag === "Ready" && reviewUrl === model.meta.url)
  ) {
    const located =
      tabChanged && options.reviewTab === "files"
        ? resetDiffAnalysis(
            evo(locatedOptions, {
              files: () => model.pullRequestFiles,
              commitDiff: () => CommitDiff.Idle(),
            }),
          )
        : locatedOptions;
    return requestReviewLocation(located);
  }
  return [
    beginReviewLoad(locatedOptions, reviewUrl),
    AsyncData.isPending(model.settings.load)
      ? []
      : [FetchReview({ url: reviewUrl })],
  ];
};

const showNotFound = (model: ModelType): UpdateReturn => [model, []];

const loadRepositoryLocation = (
  model: ModelType,
  route: Repository.RepositoryRoute,
  options: Repository.RepositoryOptions,
): UpdateReturn => {
  const [repositoryBrowser, commands] = Repository.load(
    model.repositoryBrowser,
    route,
    options,
  );
  return [
    evo(model, {
      githubLocation: () =>
        GitHubLocation.replaceValue(
          `https://github.com/${route.owner}/${route.name}`,
          false,
        ),
      repositoryBrowser: () => repositoryBrowser,
    }),
    Command.mapMessages(commands, (message) =>
      GotRepositoryMessage({ message }),
    ),
  ];
};

const loadSettingsPage = (model: ModelType): UpdateReturn => {
  const shouldLoad =
    AsyncData.isIdle(model.settings.load) ||
    AsyncData.isFailure(model.settings.load);
  return [
    model,
    shouldLoad
      ? Command.mapMessages([Settings.FetchSettings()], (message) =>
          GotSettingsMessage({ message }),
        )
      : [],
  ];
};

const loadHomeLocation = (model: ModelType): UpdateReturn => {
  const [home, commands] = Home.load(model.home);
  return [
    evo(model, { home: () => home }),
    Command.mapMessages(commands, (message) => GotHomeMessage({ message })),
  ];
};

const applyLocationTransition = (
  model: ModelType,
  transition: Route.Transition.Transition<AppRoute>,
  search: string,
): UpdateReturn => {
  const route = transition.nextRoute;
  const located = evo(model, { location: () => route });
  return M.value(route).pipe(
    M.withReturnType<UpdateReturn>(),
    M.tagsExhaustive({
      Home: () => loadHomeLocation(located),
      Settings: () => loadSettingsPage(located),
      Repository: ({ owner, repository }) =>
        loadRepositoryLocation(
          located,
          { owner, name: repository },
          Repository.repositoryOptionsFromRoute(route, search),
        ),
      RepositoryPulls: ({ owner, repository }) =>
        loadRepositoryLocation(
          located,
          { owner, name: repository },
          Repository.repositoryOptionsFromRoute(route, search),
        ),
      RepositoryCommits: ({ owner, repository }) =>
        loadRepositoryLocation(
          located,
          { owner, name: repository },
          Repository.repositoryOptionsFromRoute(route, search),
        ),
      RepositoryCommitsRef: ({ owner, repository }) =>
        loadRepositoryLocation(
          located,
          { owner, name: repository },
          Repository.repositoryOptionsFromRoute(route, search),
        ),
      RepositoryFile: ({ owner, repository }) =>
        loadRepositoryLocation(
          located,
          { owner, name: repository },
          Repository.repositoryOptionsFromRoute(route, search),
        ),
      Pull: () => changeReviewLocation(located, route, search),
      PullFiles: () => changeReviewLocation(located, route, search),
      PullFile: () => changeReviewLocation(located, route, search),
      PullCommits: () => changeReviewLocation(located, route, search),
      PullCommit: () => changeReviewLocation(located, route, search),
      Compare: () => changeReviewLocation(located, route, search),
      Commit: () => changeReviewLocation(located, route, search),
      NotFound: () => showNotFound(located),
    }),
  );
};

const requestRevisionCheck = (model: ModelType): UpdateReturn => {
  if (
    !isReviewLocation(model) ||
    model.reviewState._tag !== "Ready" ||
    model.meta.backing.source !== "local" ||
    !isPullRequestUrl(model.meta.url) ||
    model.reviewRevision._tag === "Checking"
  ) {
    return [model, []];
  }
  return [
    evo(model, {
      reviewRevision: () => ReviewRevisionChecking(),
    }),
    [
      CheckReviewRevision({
        url: model.meta.url,
        headOid: model.meta.backing.headOid,
      }),
    ],
  ];
};

export const update = (
  model: ModelType,
  receivedMessage: Message,
): UpdateReturn =>
  M.value(receivedMessage).pipe(
    M.withReturnType<UpdateReturn>(),
    M.tagsExhaustive({
      GotGitHubLocationMessage: ({ message }) => {
        const [githubLocation, commands, maybeOutMessage] =
          GitHubLocation.update(model.githubLocation, message);
        const next = evo(model, {
          githubLocation: () => githubLocation,
        });
        const mappedCommands = Command.mapMessages(commands, (mappedMessage) =>
          GotGitHubLocationMessage({ message: mappedMessage }),
        );
        return Option.match(maybeOutMessage, {
          onNone: () => [next, mappedCommands],
          onSome: ({ value }) => {
            const href = localLocationFromGitHubUrl(value, {
              ...reviewOptions(model),
              selectedPath: "",
              reviewTab: "files",
              selectedCommit: "",
            });
            if (href === undefined) {
              return [
                evo(next, {
                  githubLocation: GitHubLocation.showInvalidLocation,
                }),
                mappedCommands,
              ];
            }
            const [openReviewPopover, closeCommands] = Popover.close(
              next.openReviewPopover,
            );
            return [
              evo(next, {
                openReviewPopover: () => openReviewPopover,
              }),
              [
                ...mappedCommands,
                ...Command.mapMessages(closeCommands, (mappedMessage) =>
                  GotOpenReviewPopoverMessage({ message: mappedMessage }),
                ),
                VisitLocation({ href }),
              ],
            ];
          },
        });
      },
      GotRepositoryMessage: ({ message }) => {
        const [repositoryBrowser, commands] = Repository.update(
          model.repositoryBrowser,
          message,
        );
        return [
          evo(model, { repositoryBrowser: () => repositoryBrowser }),
          Command.mapMessages(commands, (childMessage) =>
            GotRepositoryMessage({ message: childMessage }),
          ),
        ];
      },
      GotHomeMessage: ({ message }) => {
        const [home, commands] = Home.update(model.home, message);
        return [
          evo(model, { home: () => home }),
          Command.mapMessages(commands, (childMessage) =>
            GotHomeMessage({ message: childMessage }),
          ),
        ];
      },
      GotSettingsMessage: ({ message }) => {
        const wasLoading = AsyncData.isPending(model.settings.load);
        const [settings, commands] = Settings.update(model.settings, message);
        const mappedCommands = Command.mapMessages(commands, (childMessage) =>
          GotSettingsMessage({ message: childMessage }),
        );
        const withSettings = evo(model, { settings: () => settings });
        if (message._tag === "SucceededFetchSettings") {
          const configured = withSettings.legacyReviewSettings
            ? withSettings
            : applySettings(withSettings, message.document.settings);
          if (
            wasLoading &&
            isReviewLocation(configured) &&
            configured.reviewState._tag === "Loading"
          ) {
            return [
              configured,
              [
                ...mappedCommands,
                FetchReview({ url: configured.reviewState.url }),
              ],
            ];
          }
          if (
            isReviewLocation(configured) &&
            configured.reviewState._tag === "Ready"
          ) {
            const [loaded, intelligenceCommands] =
              requestSelectedIntelligence(configured);
            return [loaded, [...mappedCommands, ...intelligenceCommands]];
          }
          return [configured, mappedCommands];
        }
        if (message._tag === "SucceededSaveSettings") {
          const configured = applySettings(withSettings, settings.draft);
          if (
            isReviewLocation(configured) &&
            configured.reviewState._tag === "Ready"
          ) {
            const [loaded, intelligenceCommands] =
              requestSelectedIntelligence(configured);
            return [loaded, [...mappedCommands, ...intelligenceCommands]];
          }
          return [configured, mappedCommands];
        }
        if (
          message._tag === "FailedFetchSettings" &&
          wasLoading &&
          isReviewLocation(withSettings) &&
          withSettings.reviewState._tag === "Loading"
        ) {
          return [
            withSettings,
            [
              ...mappedCommands,
              FetchReview({ url: withSettings.reviewState.url }),
            ],
          ];
        }
        return [withSettings, mappedCommands];
      },
      ClickedRefreshReview: () => {
        if (
          model.reviewState._tag === "Idle" ||
          model.reviewState._tag === "Loading"
        )
          return [model, []];
        const url =
          model.reviewState._tag === "Ready"
            ? model.meta.url
            : model.reviewState.url;
        return [beginReviewLoad(model, url), [FetchReview({ url })]];
      },
      TickedRevisionPoll: () => requestRevisionCheck(model),
      ClickedCheckReviewRevision: () => requestRevisionCheck(model),
      GotDiffOptionsPopoverMessage: ({ message }) => {
        const [diffOptionsPopover, commands] = Popover.update(
          model.diffOptionsPopover,
          message,
        );
        return [
          evo(model, { diffOptionsPopover: () => diffOptionsPopover }),
          Command.mapMessages(commands, (mappedMessage) =>
            GotDiffOptionsPopoverMessage({ message: mappedMessage }),
          ),
        ];
      },
      GotOpenReviewPopoverMessage: ({ message }) => {
        const [openReviewPopover, commands] = Popover.update(
          model.openReviewPopover,
          message,
        );
        return [
          evo(model, { openReviewPopover: () => openReviewPopover }),
          Command.mapMessages(commands, (mappedMessage) =>
            GotOpenReviewPopoverMessage({ message: mappedMessage }),
          ),
        ];
      },
      UpdatedToolbarCompact: ({ value }) =>
        value === model.toolbarCompact
          ? [model, []]
          : [evo(model, { toolbarCompact: () => value }), []],
      ChangedUrl: ({ url }) => {
        const search = Option.getOrElse(url.search, () => "");
        const route = urlToAppRoute(url);
        return applyLocationTransition(
          model,
          Route.Transition.make(model.location, route),
          search,
        );
      },
      ClickedLink: ({ request }) =>
        M.value(request).pipe(
          M.withReturnType<UpdateReturn>(),
          M.tagsExhaustive({
            Internal: ({ url }) => [
              model,
              [VisitLocation({ href: Url.toString(url) })],
            ],
            External: ({ href }) => [model, [LoadExternalLocation({ href })]],
          }),
        ),
      CompletedNavigate: () => [model, []],
      SucceededFetchReview: ({ requestedUrl, meta, files }) => {
        if (!isCurrentReviewRequest(model, requestedUrl)) return [model, []];
        const next = evo(model, {
          reviewState: () => ReviewReady({ url: meta.url }),
          githubLocation: () => GitHubLocation.replaceValue(meta.url, false),
          meta: () => meta,
          reviewRevision: () => ReviewRevisionIdle(),
          files: () => files,
          pullRequestFiles: () => files,
          selectedPath: (selectedPath) =>
            files.some((file) => file.path === selectedPath)
              ? selectedPath
              : (files[0]?.path ?? ""),
          reviewedPaths: () => [],
          collapsedFileTreeFolders: () => [],
          semanticResults: () => [],
          semanticRequest: () => SemanticRequestIdle(),
          reviewMoves: () => ReviewMoves.Idle(),
          characterDiffStates: () => [],
          collapsedPaths: () => [],
          collapsedHunks: () => [],
          fullFileStates: () => [],
          githubReviews: () => GitHubReviews.Idle(),
          collapsedReviewThreads: () => [],
          replyDrafts: () => [],
          replyStates: () => [],
          inlineComment: () => InlineComment.empty(),
          reviewBody: () => "",
          reviewSubmission: () => ReviewSubmission.Idle(),
        });
        const [loaded, commands] = requestReviewLocation(next);
        return canonicalizeReviewUrl(loaded, commands);
      },
      FailedFetchReview: ({ requestedUrl, error }) =>
        isCurrentReviewRequest(model, requestedUrl)
          ? [
              evo(model, {
                reviewState: () => ReviewFailed({ url: requestedUrl, error }),
                githubLocation: (location) =>
                  GitHubLocation.setLoading(location, false),
              }),
              [],
            ]
          : [model, []],
      SucceededCheckReviewRevision: ({
        requestedUrl,
        pinnedHeadOid,
        latestHeadOid,
        checkedAt,
        current,
      }) =>
        model.reviewState._tag === "Ready" &&
        model.meta.url === requestedUrl &&
        model.meta.backing.source === "local" &&
        model.meta.backing.headOid === pinnedHeadOid
          ? [
              evo(model, {
                reviewRevision: () =>
                  current
                    ? ReviewRevisionCurrent({ checkedAt })
                    : ReviewRevisionAvailable({ latestHeadOid, checkedAt }),
              }),
              [],
            ]
          : [model, []],
      FailedCheckReviewRevision: ({ requestedUrl, error }) =>
        model.reviewState._tag === "Ready" &&
        model.meta.url === requestedUrl &&
        model.meta.backing.source === "local"
          ? [
              evo(model, {
                reviewRevision: () => ReviewRevisionFailed({ error }),
              }),
              [],
            ]
          : [model, []],
      SucceededFetchCommits: ({ requestedUrl, commits }) => {
        if (!isCurrentPullRequest(model, requestedUrl)) return [model, []];
        const loaded = evo(model, {
          commits: () => PullCommits.Success({ data: commits }),
        });
        if (loaded.reviewTab !== "commits" || loaded.selectedCommit === "") {
          return [loaded, []];
        }
        if (!commits.some((commit) => commit.sha === loaded.selectedCommit)) {
          return canonicalizeReviewUrl(
            evo(loaded, {
              selectedCommit: () => "",
              commitDiff: () => CommitDiff.Idle(),
            }),
            [],
          );
        }
        const [withDiff, commands] = requestCommitDiff(
          loaded,
          loaded.selectedCommit,
        );
        return canonicalizeReviewUrl(withDiff, commands);
      },
      FailedFetchCommits: ({ requestedUrl, error }) =>
        isCurrentPullRequest(model, requestedUrl)
          ? [
              evo(model, {
                commits: () => PullCommits.Failure({ error }),
              }),
              [],
            ]
          : [model, []],
      SucceededFetchCommitDiff: ({ sha, files }) => {
        if (
          model.reviewTab !== "commits" ||
          model.selectedCommit !== sha ||
          !AsyncData.isPending(model.commitDiff)
        ) {
          return [model, []];
        }
        const selectedPath = files.some(
          (file) => file.path === model.selectedPath,
        )
          ? model.selectedPath
          : (files[0]?.path ?? "");
        const next = evo(model, {
          files: () => files,
          commitDiff: () => CommitDiff.Success({ data: { sha, files } }),
          selectedPath: () => selectedPath,
          collapsedFileTreeFolders: (folders) =>
            revealFileInTree(folders, selectedPath),
        });
        const [loaded, commands] = requestSelectedIntelligence(next);
        return canonicalizeReviewUrl(loaded, commands);
      },
      FailedFetchCommitDiff: ({ sha, error }) =>
        model.reviewTab === "commits" && model.selectedCommit === sha
          ? [
              evo(model, {
                commitDiff: () => CommitDiff.Failure({ error }),
              }),
              [],
            ]
          : [model, []],
      SucceededFetchSemantic: ({ requestedUrl, path, result }) =>
        isCurrentDiffRequest(model, requestedUrl)
          ? [
              evo(model, {
                semanticResults: (results) => [
                  ...results.filter((item) => item.path !== path),
                  result,
                ],
                semanticRequest: (request) =>
                  request._tag === "Loading" && request.path === path
                    ? SemanticRequestIdle()
                    : request,
              }),
              [],
            ]
          : [model, []],
      FailedFetchSemantic: ({ requestedUrl, path, error }) =>
        isCurrentDiffRequest(model, requestedUrl)
          ? [
              evo(model, {
                semanticRequest: (request) =>
                  request._tag === "Loading" && request.path === path
                    ? SemanticRequestFailed({ path, error })
                    : request,
              }),
              [],
            ]
          : [model, []],
      SucceededFetchMoves: ({ requestedUrl, moves }) =>
        isCurrentDiffRequest(model, requestedUrl)
          ? [
              evo(model, {
                reviewMoves: () => ReviewMoves.Success({ data: moves }),
              }),
              [],
            ]
          : [model, []],
      FailedFetchMoves: ({ requestedUrl, error }) =>
        isCurrentDiffRequest(model, requestedUrl)
          ? [
              evo(model, {
                reviewMoves: () => ReviewMoves.Failure({ error }),
              }),
              [],
            ]
          : [model, []],
      SucceededFetchCharacterDiff: ({ requestedUrl, result }) =>
        isCurrentDiffRequest(model, requestedUrl)
          ? [
              evo(model, {
                characterDiffStates: (states) => [
                  ...states.filter(
                    (entry) =>
                      entry.path !== result.path ||
                      entry.ignoreWhitespace !== result.ignoreWhitespace ||
                      entry.mode !== result.mode,
                  ),
                  {
                    path: result.path,
                    ignoreWhitespace: result.ignoreWhitespace,
                    mode: result.mode,
                    state: CharacterDiffState.Success({ data: result }),
                  },
                ],
              }),
              [],
            ]
          : [model, []],
      FailedFetchCharacterDiff: ({
        requestedUrl,
        path,
        ignoreWhitespace,
        mode,
        error,
      }) =>
        isCurrentDiffRequest(model, requestedUrl)
          ? [
              evo(model, {
                characterDiffStates: (states) => [
                  ...states.filter(
                    (entry) =>
                      entry.path !== path ||
                      entry.ignoreWhitespace !== ignoreWhitespace ||
                      entry.mode !== mode,
                  ),
                  {
                    path,
                    ignoreWhitespace,
                    mode,
                    state: CharacterDiffState.Failure({ error }),
                  },
                ],
              }),
              [],
            ]
          : [model, []],
      SucceededFetchFullFile: ({ requestedUrl, path, oldText, newText }) => {
        if (!isCurrentDiffRequest(model, requestedUrl)) return [model, []];
        const requested = model.fullFileStates.some(
          (entry) => entry.path === path && AsyncData.isPending(entry.state),
        );
        return requested
          ? [
              evo(model, {
                fullFileStates: (states) => [
                  ...states.filter((entry) => entry.path !== path),
                  {
                    path,
                    state: FullFileState.Success({
                      data: { oldText, newText },
                    }),
                  },
                ],
              }),
              [],
            ]
          : [model, []];
      },
      FailedFetchFullFile: ({ requestedUrl, path, error }) => {
        if (!isCurrentDiffRequest(model, requestedUrl)) return [model, []];
        const requested = model.fullFileStates.some(
          (entry) => entry.path === path && AsyncData.isPending(entry.state),
        );
        return requested
          ? [
              evo(model, {
                fullFileStates: (states) => [
                  ...states.filter((entry) => entry.path !== path),
                  {
                    path,
                    state: FullFileState.Failure({ error }),
                  },
                ],
              }),
              [],
            ]
          : [model, []];
      },
      SucceededFetchGitHubReviews: ({ requestedUrl, comments }) =>
        isCurrentPullRequest(model, requestedUrl)
          ? [
              evo(model, {
                githubReviews: () => GitHubReviews.Success({ data: comments }),
                collapsedReviewThreads: () =>
                  comments
                    .filter(
                      (comment) =>
                        comment.id === comment.rootId && comment.resolved,
                    )
                    .map((comment) => comment.id),
              }),
              [],
            ]
          : [model, []],
      FailedFetchGitHubReviews: ({ requestedUrl, error }) =>
        isCurrentPullRequest(model, requestedUrl)
          ? [
              evo(model, {
                githubReviews: () => GitHubReviews.Failure({ error }),
              }),
              [],
            ]
          : [model, []],
      UpdatedReplyDraft: ({ commentId, body }) => [
        evo(model, {
          replyDrafts: (drafts) => [
            ...drafts.filter((draft) => draft.commentId !== commentId),
            { commentId, body },
          ],
          replyStates: (states) =>
            states.filter((state) => state.commentId !== commentId),
        }),
        [],
      ],
      SubmittedReply: ({ commentId }) => {
        const body = model.replyDrafts
          .find((draft) => draft.commentId === commentId)
          ?.body.trim();
        const loading = model.replyStates.some(
          (state) => state.commentId === commentId && state._tag === "Loading",
        );
        if (body === undefined || body === "" || loading) return [model, []];
        return [
          evo(model, {
            replyStates: (states) => [
              ...states.filter((state) => state.commentId !== commentId),
              ReplyLoading({ commentId }),
            ],
          }),
          [PostReviewReply({ url: model.meta.url, commentId, body })],
        ];
      },
      SucceededPostReviewReply: ({ comment }) => [
        evo(model, {
          githubReviews: AsyncData.map((comments) => [...comments, comment]),
          replyDrafts: (drafts) =>
            drafts.filter((draft) => draft.commentId !== comment.rootId),
          replyStates: (states) =>
            states.filter((state) => state.commentId !== comment.rootId),
        }),
        [],
      ],
      FailedPostReviewReply: ({ commentId, error }) => [
        evo(model, {
          replyStates: (states) => [
            ...states.filter((state) => state.commentId !== commentId),
            ReplyFailed({ commentId, error }),
          ],
        }),
        [],
      ],
      GotInlineCommentMessage: ({ message: inlineMessage }) => {
        const [inlineComment, commands] = InlineComment.update(
          model.inlineComment,
          inlineMessage,
        );
        const posted =
          inlineMessage._tag === "SucceededPostInlineComment" &&
          inlineMessage.target.pullUrl === model.meta.url;
        const shouldLoadAllComments =
          posted && !AsyncData.hasData(model.githubReviews);
        return [
          evo(model, {
            inlineComment: () => inlineComment,
            githubReviews: (reviews) =>
              posted
                ? GitHubReviews.Success({
                    data: [
                      ...AsyncData.getOrElse(reviews, () => []),
                      inlineMessage.comment,
                    ],
                  })
                : reviews,
            showGitHubReviews: (visible) => (posted ? true : visible),
          }),
          [
            ...Command.mapMessages(commands, (message) =>
              GotInlineCommentMessage({ message }),
            ),
            ...(shouldLoadAllComments
              ? [FetchGitHubReviews({ url: model.meta.url })]
              : []),
          ],
        ];
      },
      UpdatedReviewBody: ({ body }) => [
        evo(model, {
          reviewBody: () => body,
          reviewSubmission: () => ReviewSubmission.Idle(),
        }),
        [],
      ],
      SubmittedReview: ({ event }) => {
        const body = model.reviewBody.trim();
        if (
          AsyncData.isPending(model.reviewSubmission) ||
          !isPullRequestUrl(model.meta.url) ||
          (event !== "APPROVE" && body === "")
        ) {
          return [model, []];
        }
        return [
          evo(model, {
            reviewSubmission: () => ReviewSubmission.Loading(),
          }),
          [PostPullRequestReview({ url: model.meta.url, body, event })],
        ];
      },
      SucceededPostPullRequestReview: ({ event }) => [
        evo(model, {
          reviewBody: () => "",
          reviewSubmission: () => ReviewSubmission.Success({ data: event }),
        }),
        [],
      ],
      FailedPostPullRequestReview: ({ error }) => [
        evo(model, {
          reviewSubmission: () => ReviewSubmission.Failure({ error }),
        }),
        [],
      ],
      UpdatedFilter: ({ value }) => [evo(model, { filter: () => value }), []],
      SelectedReviewSearchMode: ({ value }) => [
        evo(model, { filterMode: () => value }),
        [],
      ],
      SelectedFile: ({ path }) => {
        const next = evo(model, {
          selectedPath: () => path,
          collapsedFileTreeFolders: (folders) =>
            revealFileInTree(folders, path),
          reviewScope: () => "file" as const,
        });
        const result = requestSelectedIntelligence(next);
        return visitReviewUrl(result[0], result[1]);
      },
      SelectedSemanticMoveTarget: ({ path, anchor }) => {
        const next = evo(model, {
          filter: () => "",
          selectedPath: () => path,
          collapsedFileTreeFolders: (folders) =>
            revealFileInTree(folders, path),
          collapsedPaths: (paths) =>
            paths.filter((candidate) => candidate !== path),
          collapsedHunks: (hunks) =>
            hunks.filter((key) => !key.startsWith(`${path}\u0000`)),
        });
        const [loaded, commands] = requestSelectedIntelligence(next);
        const href = localReviewUrl(loaded.meta.url, reviewOptions(loaded));
        return href === undefined
          ? [loaded, commands]
          : [
              loaded,
              [
                ...commands,
                VisitSemanticMove({ href: `${href}#${anchor}`, anchor }),
              ],
            ];
      },
      SelectedReviewTab: ({ value }) => {
        if (value === "files") {
          const files = model.pullRequestFiles;
          const selectedPath = files.some(
            (file) => file.path === model.selectedPath,
          )
            ? model.selectedPath
            : (files[0]?.path ?? "");
          const next = resetDiffAnalysis(
            evo(model, {
              reviewTab: () => "files" as const,
              selectedCommit: () => "",
              commitDiff: () => CommitDiff.Idle(),
              files: () => files,
              selectedPath: () => selectedPath,
              collapsedFileTreeFolders: (folders) =>
                revealFileInTree(folders, selectedPath),
            }),
          );
          const [loaded, commands] = requestSelectedIntelligence(next);
          return visitReviewUrl(loaded, commands);
        }
        const next = resetDiffAnalysis(
          evo(model, {
            reviewTab: () => "commits" as const,
            selectedCommit: () => "",
            commitDiff: () => CommitDiff.Idle(),
          }),
        );
        const [loaded, commands] = requestCommits(next);
        return visitReviewUrl(loaded, commands);
      },
      SelectedCommit: ({ sha }) => {
        const [next, commands] = requestCommitDiff(model, sha);
        return visitReviewUrl(next, commands);
      },
      ReturnedToCommitList: () =>
        visitReviewUrl(
          resetDiffAnalysis(
            evo(model, {
              selectedCommit: () => "",
              commitDiff: () => CommitDiff.Idle(),
            }),
          ),
          [],
        ),
      SelectedReviewScope: ({ value }) => {
        const next = evo(model, { reviewScope: () => value });
        const result = requestSelectedIntelligence(next);
        return persistReviewSettings(result[0], result[1]);
      },
      SelectedViewMode: ({ value }) =>
        persistReviewSettings(evo(model, { viewMode: () => value }), []),
      ToggledWhitespace: () => {
        const next = evo(model, { ignoreWhitespace: (value) => !value });
        const [updated, commands] = requestSelectedIntelligence(next);
        return persistReviewSettings(updated, commands);
      },
      ToggledSemantic: () => {
        const next = evo(model, { semantic: (value) => !value });
        const [updated, commands] = requestSelectedIntelligence(next);
        return persistReviewSettings(updated, commands);
      },
      SelectedInlineDiffMode: ({ value }) => {
        const next = evo(model, { inlineDiffMode: () => value });
        const [updated, commands] = requestSelectedIntelligence(next);
        return persistReviewSettings(updated, commands);
      },
      ToggledSyntaxHighlighting: () =>
        persistReviewSettings(
          evo(model, { syntaxHighlighting: (value) => !value }),
          [],
        ),
      ToggledSidebar: () =>
        persistReviewSettings(
          evo(model, { sidebarCollapsed: (value) => !value }),
          [],
        ),
      ToggledFileTreeFolder: ({ path }) => [
        evo(model, {
          collapsedFileTreeFolders: (folders) =>
            toggleMembership(folders, path),
        }),
        [],
      ],
      ToggledGitHubReviews: () => {
        const next = evo(model, { showGitHubReviews: (value) => !value });
        const [updated, commands] = requestGitHubReviews(next);
        return persistReviewSettings(updated, commands);
      },
      ToggledReviewThreadCollapse: ({ threadId }) => [
        evo(model, {
          collapsedReviewThreads: (threads) =>
            toggleMembership(threads, threadId),
        }),
        [],
      ],
      ToggledReviewed: ({ path }) => {
        const reviewed = model.reviewedPaths.includes(path);
        return [
          evo(model, {
            reviewedPaths: (paths) => setMembership(paths, path, !reviewed),
            collapsedPaths: (paths) => setMembership(paths, path, !reviewed),
          }),
          [],
        ];
      },
      ToggledFileCollapse: ({ path }) => [
        evo(model, {
          collapsedPaths: (paths) => toggleMembership(paths, path),
        }),
        [],
      ],
      ToggledHunkCollapse: ({ path, hunkId }) => [
        evo(model, {
          collapsedHunks: (hunks) =>
            toggleMembership(hunks, hunkKey(path, hunkId)),
        }),
        [],
      ],
      ToggledFullFile: ({ path }) => {
        const entry = model.fullFileStates.find((item) => item.path === path);
        if (
          entry !== undefined &&
          (AsyncData.hasData(entry.state) || AsyncData.isPending(entry.state))
        ) {
          return [
            evo(model, {
              fullFileStates: (states) =>
                states.filter((item) => item.path !== path),
            }),
            [],
          ];
        }
        const file = model.files.find((item) => item.path === path);
        if (file === undefined || model.meta.url === "") return [model, []];
        const next = evo(model, {
          fullFileStates: (states) => [
            ...states.filter((item) => item.path !== path),
            { path, state: FullFileState.Loading() },
          ],
        });
        return [
          next,
          [
            FetchFullFile({
              url: activeDiffUrl(model),
              ...activeRevision(model),
              path,
              previousPath: file.previousPath,
              status: file.status,
            }),
          ],
        ];
      },
    }),
  );

const emptyReviewMeta = ReviewMeta.make({
  title: "",
  repository: "",
  number: "",
  author: "",
  base: "",
  head: "",
  url: "",
  backing: {
    source: "github",
    baseOid: "",
    headOid: "",
    headRef: "",
    path: "",
  },
});

const initialModel = (
  location: AppRoute,
  options: ReviewOptions,
  legacyReviewSettings = false,
) =>
  Model.make({
    location,
    reviewState: ReviewIdle(),
    githubLocation: GitHubLocation.init("", false),
    filter: "",
    filterMode: "literal",
    meta: emptyReviewMeta,
    reviewRevision: ReviewRevisionIdle(),
    files: [],
    pullRequestFiles: [],
    reviewTab: options.reviewTab,
    commits: PullCommits.Idle(),
    selectedCommit: options.selectedCommit,
    commitDiff: CommitDiff.Idle(),
    repositoryBrowser: Repository.empty(),
    home: Home.empty(),
    settings: Settings.Model.make({
      ...Settings.empty(),
      load: Settings.Load.Loading(),
    }),
    legacyReviewSettings,
    diffOptionsPopover: initialDiffOptionsPopover(),
    openReviewPopover: initialOpenReviewPopover(),
    toolbarCompact: false,
    selectedPath: options.selectedPath,
    sidebarCollapsed: options.sidebarCollapsed,
    collapsedFileTreeFolders: [],
    reviewScope: options.reviewScope,
    viewMode: options.viewMode,
    ignoreWhitespace: options.ignoreWhitespace,
    semantic: options.semantic,
    inlineDiffMode: options.inlineDiffMode,
    syntaxHighlighting: options.syntaxHighlighting,
    reviewedPaths: [],
    semanticResults: [],
    semanticRequest: SemanticRequestIdle(),
    reviewMoves: ReviewMoves.Idle(),
    characterDiffStates: [],
    collapsedPaths: [],
    collapsedHunks: [],
    fullFileStates: [],
    showGitHubReviews: options.showGitHubReviews,
    githubReviews: GitHubReviews.Idle(),
    collapsedReviewThreads: [],
    replyDrafts: [],
    replyStates: [],
    inlineComment: InlineComment.empty(),
    reviewBody: "",
    reviewSubmission: ReviewSubmission.Idle(),
  });

const initialSettingsCommand = () =>
  Command.mapMessages([Settings.FetchSettings()], (message) =>
    GotSettingsMessage({ message }),
  );

export const init: Runtime.RoutingApplicationInit<
  ModelType,
  Message,
  void,
  AppResources
> = (url) => {
  const route = urlToAppRoute(url);
  const search = Option.getOrElse(url.search, () => "");
  const [model, commands] = applyLocationTransition(
    initialModel(route, defaultReviewOptions),
    Route.Transition.coldLoad(route),
    search,
  );
  return [model, [...initialSettingsCommand(), ...commands]];
};

export const routing: Runtime.RoutingConfig<Message> = {
  onUrlChange: (url) => ChangedUrl({ url }),
  onUrlRequest: (request) => ClickedLink({ request }),
};
