import { Array, Match as M, Option } from "effect";
import { AsyncData, Command, Runtime, Update, Url } from "foldkit";
import { evo } from "foldkit/struct";
import { Popover } from "@foldkit/ui";

import { reviewRouteToGitHubUrl, urlToAppRoute } from "./app-route";
import type { AppRoute } from "./app-route";
import {
  FetchCharacterDiff,
  FetchFullFile,
  FetchGitHubReviews,
  FetchMoves,
  FetchReview,
  FetchSemantic,
  Navigate,
  PostPullRequestReview,
  PostReviewReply,
} from "./command";
import {
  ChangedUrl,
  CharacterDiffState,
  CommitDiff,
  FullFileState,
  GitHubReviews,
  GotDiffOptionsPopoverMessage,
  GotGitHubLocationMessage,
  GotOpenReviewPopoverMessage,
  GotRepositoryMessage,
  GotSettingsMessage,
  Model,
  PullCommits,
  ClickedLink,
  ReplyFailed,
  ReplyLoading,
  ReviewFailed,
  ReviewLoading,
  ReviewMoves,
  ReviewReady,
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
import { sampleFiles, sampleMeta } from "./sample";
import * as GitHubLocation from "./features/github-location";

type UpdateReturn = Update.Return<ModelType, Message>;

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

const activeRevision = (model: ModelType) =>
  model.reviewTab === "commits" && model.selectedCommit !== ""
    ? { baseOid: "", headOid: "" }
    : {
        baseOid: model.meta.backing.baseOid,
        headOid: model.meta.backing.headOid,
      };

const isCurrentReviewRequest = (model: ModelType, requestedUrl: string) =>
  model.phase._tag === "Loading" && model.prUrl === requestedUrl;

const isCurrentPullRequest = (model: ModelType, requestedUrl: string) =>
  model.phase._tag === "Ready" &&
  model.prUrl === requestedUrl &&
  model.meta.url === requestedUrl;

const isCurrentDiffRequest = (model: ModelType, requestedUrl: string) =>
  model.phase._tag === "Ready" && activeDiffUrl(model) === requestedUrl;

const requestSemantic = (model: ModelType, file: FileChange): UpdateReturn => {
  const alreadyLoaded = model.semanticResults.some(
    (result) => result.path === file.path,
  );
  const alreadyLoading =
    model.semanticRequest._tag === "Loading" &&
    model.semanticRequest.path === file.path;
  if (
    model.phase._tag !== "Ready" ||
    !model.semantic ||
    model.prUrl.trim() === "" ||
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
    model.phase._tag !== "Ready" ||
    !model.semantic ||
    model.reviewScope !== "full" ||
    model.prUrl.trim() === "" ||
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
    model.phase._tag !== "Ready" ||
    !model.showGitHubReviews ||
    model.reviewTab !== "files" ||
    !isPullRequestUrl(model.meta.url) ||
    model.prUrl.trim() === "" ||
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
    model.phase._tag !== "Ready" ||
    model.inlineDiffMode === "off" ||
    model.prUrl.trim() === ""
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
    model.phase._tag !== "Ready" ||
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
  if (sha === "" || !isPullRequestUrl(model.meta.url)) return [model, []];
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
    return synchronizeReviewUrl(
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
    phase: () => ReviewLoading(),
    githubLocation: () => GitHubLocation.replaceValue(url, true),
    prUrl: () => url,
    reviewRevision: () => ReviewRevisionIdle(),
    filter: () => "",
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
    reviewBody: () => "",
    reviewSubmission: () => ReviewSubmission.Idle(),
    commits: () => PullCommits.Idle(),
    commitDiff: () => CommitDiff.Idle(),
    diffOptionsPopover: initialDiffOptionsPopover,
    openReviewPopover: initialOpenReviewPopover,
  });

const sampleModel = (model: ModelType): ModelType =>
  evo(model, {
    page: () => "review" as const,
    phase: () => ReviewReady(),
    githubLocation: () => GitHubLocation.replaceValue("", false),
    prUrl: () => "",
    meta: () => sampleMeta,
    reviewRevision: () => ReviewRevisionIdle(),
    files: () => sampleFiles,
    pullRequestFiles: () => sampleFiles,
    reviewTab: () => "files" as const,
    commits: () => PullCommits.Idle(),
    selectedCommit: () => "",
    commitDiff: () => CommitDiff.Idle(),
    diffOptionsPopover: initialDiffOptionsPopover,
    openReviewPopover: initialOpenReviewPopover,
    selectedPath: () => sampleFiles[0]?.path ?? "",
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
    reviewBody: () => "",
    reviewSubmission: () => ReviewSubmission.Idle(),
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
  commands: ReadonlyArray<Command.Command<Message>>,
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

const synchronizeReviewUrl = (
  model: ModelType,
  commands: ReadonlyArray<Command.Command<Message>>,
): UpdateReturn => {
  if (model.phase._tag !== "Ready" || model.prUrl !== model.meta.url) {
    return [model, commands];
  }
  const href = localReviewUrl(model.meta.url, reviewOptions(model));
  return href === undefined
    ? [model, commands]
    : [model, [...commands, Navigate({ href, method: "replace" })]];
};

const changeReviewLocation = (
  model: ModelType,
  route: AppRoute,
  search: string,
): UpdateReturn => {
  const reviewRoute = reviewRouteFromAppRoute(route);
  if (reviewRoute === undefined) return showNotFound(model);
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
  if (reviewUrl === model.prUrl && model.phase._tag === "Loading") {
    return [locatedOptions, []];
  }
  if (
    reviewUrl === model.prUrl ||
    (model.prUrl !== "" && reviewUrl === model.meta.url)
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

const showNotFound = (model: ModelType): UpdateReturn => [
  evo(model, {
    phase: () =>
      ReviewFailed({ error: "That Hunker review URL is not recognized." }),
  }),
  [],
];

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
      page: () => "repository" as const,
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
    evo(model, { page: () => "settings" as const }),
    shouldLoad
      ? Command.mapMessages([Settings.FetchSettings({})], (message) =>
          GotSettingsMessage({ message }),
        )
      : [],
  ];
};

const requestRevisionCheck = (model: ModelType): UpdateReturn => {
  if (
    model.page !== "review" ||
    model.phase._tag !== "Ready" ||
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
                Navigate({ href, method: "push" }),
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
            configured.page === "review" &&
            configured.phase._tag === "Loading" &&
            configured.prUrl !== ""
          ) {
            return [
              configured,
              [...mappedCommands, FetchReview({ url: configured.prUrl })],
            ];
          }
          if (
            configured.page === "review" &&
            configured.phase._tag === "Ready" &&
            configured.prUrl !== ""
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
            configured.page === "review" &&
            configured.phase._tag === "Ready" &&
            configured.prUrl !== ""
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
          withSettings.page === "review" &&
          withSettings.phase._tag === "Loading" &&
          withSettings.prUrl !== ""
        ) {
          return [
            withSettings,
            [...mappedCommands, FetchReview({ url: withSettings.prUrl })],
          ];
        }
        return [withSettings, mappedCommands];
      },
      ClickedRefreshReview: () => {
        if (model.phase._tag === "Loading" || model.prUrl.trim() === "")
          return [model, []];
        const url = model.meta.url || model.prUrl.trim();
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
        return M.value(route).pipe(
          M.withReturnType<UpdateReturn>(),
          M.tagsExhaustive({
            Home: () => [sampleModel(model), []],
            Settings: () => loadSettingsPage(model),
            Repository: ({ owner, repository }) =>
              loadRepositoryLocation(
                model,
                { owner, name: repository },
                Repository.repositoryOptionsFromRoute(route, search),
              ),
            RepositoryCommits: ({ owner, repository }) =>
              loadRepositoryLocation(
                model,
                { owner, name: repository },
                Repository.repositoryOptionsFromRoute(route, search),
              ),
            RepositoryCommitsRef: ({ owner, repository }) =>
              loadRepositoryLocation(
                model,
                { owner, name: repository },
                Repository.repositoryOptionsFromRoute(route, search),
              ),
            RepositoryFile: ({ owner, repository }) =>
              loadRepositoryLocation(
                model,
                { owner, name: repository },
                Repository.repositoryOptionsFromRoute(route, search),
              ),
            Pull: () => changeReviewLocation(model, route, search),
            PullFiles: () => changeReviewLocation(model, route, search),
            PullFile: () => changeReviewLocation(model, route, search),
            PullCommits: () => changeReviewLocation(model, route, search),
            PullCommit: () => changeReviewLocation(model, route, search),
            Compare: () => changeReviewLocation(model, route, search),
            Commit: () => changeReviewLocation(model, route, search),
            NotFound: () => showNotFound(model),
          }),
        );
      },
      ClickedLink: ({ request }) =>
        M.value(request).pipe(
          M.withReturnType<UpdateReturn>(),
          M.tagsExhaustive({
            Internal: ({ url }) => [
              model,
              [Navigate({ href: Url.toString(url), method: "push" })],
            ],
            External: ({ href }) => [
              model,
              [Navigate({ href, method: "load" })],
            ],
          }),
        ),
      CompletedNavigate: () => [model, []],
      SucceededFetchReview: ({ requestedUrl, meta, files }) => {
        if (!isCurrentReviewRequest(model, requestedUrl)) return [model, []];
        const next = evo(model, {
          page: () => "review" as const,
          phase: () => ReviewReady(),
          githubLocation: () => GitHubLocation.replaceValue(meta.url, false),
          prUrl: () => meta.url,
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
          reviewBody: () => "",
          reviewSubmission: () => ReviewSubmission.Idle(),
        });
        const [loaded, commands] = requestReviewLocation(next);
        return synchronizeReviewUrl(loaded, commands);
      },
      FailedFetchReview: ({ requestedUrl, error }) =>
        isCurrentReviewRequest(model, requestedUrl)
          ? [
              evo(model, {
                phase: () => ReviewFailed({ error }),
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
        model.phase._tag === "Ready" &&
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
        model.phase._tag === "Ready" &&
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
          return synchronizeReviewUrl(
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
        return synchronizeReviewUrl(withDiff, commands);
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
        return synchronizeReviewUrl(loaded, commands);
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
      SelectedFile: ({ path }) => {
        const next = evo(model, {
          selectedPath: () => path,
          collapsedFileTreeFolders: (folders) =>
            revealFileInTree(folders, path),
          reviewScope: () => "file" as const,
        });
        const result = requestSelectedIntelligence(next);
        return synchronizeReviewUrl(result[0], result[1]);
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
          return synchronizeReviewUrl(loaded, commands);
        }
        const next = resetDiffAnalysis(
          evo(model, {
            reviewTab: () => "commits" as const,
            selectedCommit: () => "",
            commitDiff: () => CommitDiff.Idle(),
          }),
        );
        const [loaded, commands] = requestCommits(next);
        return synchronizeReviewUrl(loaded, commands);
      },
      SelectedCommit: ({ sha }) => {
        const [next, commands] = requestCommitDiff(model, sha);
        return synchronizeReviewUrl(next, commands);
      },
      ReturnedToCommitList: () =>
        synchronizeReviewUrl(
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

const initialModel = (
  prUrl: string,
  options: ReviewOptions,
  legacyReviewSettings = false,
) =>
  Model.make({
    page: "review",
    phase: prUrl === "" ? ReviewReady() : ReviewLoading(),
    githubLocation: GitHubLocation.init(prUrl, prUrl !== ""),
    prUrl,
    filter: "",
    meta: sampleMeta,
    reviewRevision: ReviewRevisionIdle(),
    files: sampleFiles,
    pullRequestFiles: sampleFiles,
    reviewTab: options.reviewTab,
    commits: PullCommits.Idle(),
    selectedCommit: options.selectedCommit,
    commitDiff: CommitDiff.Idle(),
    repositoryBrowser: Repository.empty(),
    settings: Settings.Model.make({
      ...Settings.empty(),
      load: Settings.Load.Loading(),
    }),
    legacyReviewSettings,
    diffOptionsPopover: initialDiffOptionsPopover(),
    openReviewPopover: initialOpenReviewPopover(),
    toolbarCompact: false,
    selectedPath: options.selectedPath || sampleFiles[0]?.path || "",
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
    reviewBody: "",
    reviewSubmission: ReviewSubmission.Idle(),
  });

const initialSettingsCommand = () =>
  Command.mapMessages([Settings.FetchSettings({})], (message) =>
    GotSettingsMessage({ message }),
  );

const initialReviewLocation = (
  route: AppRoute,
  search: string,
): UpdateReturn => {
  const reviewRoute = reviewRouteFromAppRoute(route);
  if (reviewRoute === undefined) {
    return showNotFound(initialModel("", defaultReviewOptions));
  }
  const reviewUrl = reviewRouteToGitHubUrl(reviewRoute);
  return [
    initialModel(
      reviewUrl,
      reviewOptionsFromRoute(route, search, defaultReviewOptions),
      hasLegacyReviewSettings(search),
    ),
    initialSettingsCommand(),
  ];
};

export const init: Runtime.RoutingApplicationInit<ModelType, Message> = (
  url,
) => {
  const route = urlToAppRoute(url);
  const search = Option.getOrElse(url.search, () => "");
  return M.value(route).pipe(
    M.withReturnType<UpdateReturn>(),
    M.tagsExhaustive({
      Home: () => [
        initialModel("", defaultReviewOptions),
        initialSettingsCommand(),
      ],
      Settings: () => [
        evo(initialModel("", defaultReviewOptions), {
          page: () => "settings" as const,
        }),
        initialSettingsCommand(),
      ],
      Repository: ({ owner, repository }) =>
        (() => {
          const [model, commands] = loadRepositoryLocation(
            initialModel("", defaultReviewOptions),
            { owner, name: repository },
            Repository.repositoryOptionsFromRoute(route, search),
          );
          return [model, [...initialSettingsCommand(), ...commands]];
        })(),
      RepositoryCommits: ({ owner, repository }) =>
        (() => {
          const [model, commands] = loadRepositoryLocation(
            initialModel("", defaultReviewOptions),
            { owner, name: repository },
            Repository.repositoryOptionsFromRoute(route, search),
          );
          return [model, [...initialSettingsCommand(), ...commands]];
        })(),
      RepositoryCommitsRef: ({ owner, repository }) =>
        (() => {
          const [model, commands] = loadRepositoryLocation(
            initialModel("", defaultReviewOptions),
            { owner, name: repository },
            Repository.repositoryOptionsFromRoute(route, search),
          );
          return [model, [...initialSettingsCommand(), ...commands]];
        })(),
      RepositoryFile: ({ owner, repository }) =>
        (() => {
          const [model, commands] = loadRepositoryLocation(
            initialModel("", defaultReviewOptions),
            { owner, name: repository },
            Repository.repositoryOptionsFromRoute(route, search),
          );
          return [model, [...initialSettingsCommand(), ...commands]];
        })(),
      Pull: () => initialReviewLocation(route, search),
      PullFiles: () => initialReviewLocation(route, search),
      PullFile: () => initialReviewLocation(route, search),
      PullCommits: () => initialReviewLocation(route, search),
      PullCommit: () => initialReviewLocation(route, search),
      Compare: () => initialReviewLocation(route, search),
      Commit: () => initialReviewLocation(route, search),
      NotFound: () => {
        const [model, commands] = showNotFound(
          initialModel("", defaultReviewOptions),
        );
        return [model, [...initialSettingsCommand(), ...commands]];
      },
    }),
  );
};

export const routing: Runtime.RoutingConfig<Message> = {
  onUrlChange: (url) => ChangedUrl({ url }),
  onUrlRequest: (request) => ClickedLink({ request }),
};
