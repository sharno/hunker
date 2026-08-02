import type { Html, HtmlBuilder } from "foldkit/html";

import {
  ChangedFilter,
  ClosedToolbarMenus,
  RefreshedReview,
  RequestedRevisionCheck,
  SelectedFile,
  SelectedInlineDiffMode,
  SelectedReviewTab,
  SelectedReviewScope,
  SelectedViewMode,
  ToggledFileCollapse,
  ToggledFullFile,
  ToggledGitHubReviews,
  ToggledReviewed,
  ToggledSemantic,
  ToggledSidebar,
  ToggledSyntaxHighlighting,
  ToggledToolbarMenu,
  ToggledWhitespace,
} from "../domain";
import type {
  FileChange,
  Message,
  Model,
  MovedBlock,
  SemanticChange,
  SemanticResult,
} from "../domain";
import { toDiffLines, toFullDiffLines } from "../diff";
import { localRepositoryUrl } from "../features/repository";
import { isPullRequestUrl } from "../review-route";
import { splitDiffView, unifiedDiffView } from "./diff-view";
import type { MovedRanges } from "./diff-view";
import {
  commitDetailHeader,
  commitDiffStateView,
  commitListView,
} from "./commits-view";
import {
  detachedReviewThreads,
  reviewComposerView,
} from "./github-review-view";
import { repositoryView } from "./repository-view";
import { githubLocationForm } from "./github-location-view";

const buttonClass = (active: boolean) =>
  `segmented-button${active ? " is-active" : ""}`;

const hasLoadedReview = (model: Model) =>
  model.phase === "ready" && model.prUrl !== "" && model.meta.url === model.prUrl;

const reviewTarget = (url: string) => {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\//, "");
  } catch {
    return url;
  }
};

const reviewLoadingView = (model: Model, h: HtmlBuilder<Message>) =>
  h.section([h.Class("review-loading"), h.Role("status")], [
    h.div([h.Class("review-loading-card")], [
      h.span([h.Class("review-loading-spinner")], [""]),
      h.div([h.Class("review-loading-copy")], [
        h.strong([], ["Loading the latest change…"]),
        h.code([], [reviewTarget(model.prUrl)]),
        h.span([], ["Resolving metadata and an immutable diff revision."]),
      ]),
    ]),
  ]);

const reviewErrorView = (model: Model, h: HtmlBuilder<Message>) =>
  h.section([h.Class("review-load-error")], [
    h.strong([], ["Could not load this change"]),
    h.span([], ["No previous review data is being shown."]),
  ]);

const toggleButton = (
  label: string,
  active: boolean,
  message: Message,
  h: HtmlBuilder<Message>,
) =>
  h.button(
    [
      h.Type("button"),
      h.Class(`filter-toggle${active ? " is-active" : ""}`),
      h.AriaPressed(String(active)),
      h.OnClick(message),
    ],
    [h.span([h.Class("toggle-dot")], [""]), label],
  );

const statusGlyph = (status: FileChange["status"]) =>
  status === "added"
    ? "A"
    : status === "deleted"
      ? "D"
      : status === "renamed"
        ? "R"
        : "M";

const fileRow = (
  file: FileChange,
  model: Model,
  h: HtmlBuilder<Message>,
): Html => {
  const reviewed = model.reviewedPaths.includes(file.path);
  return h.button(
    [
      h.Key(file.path),
      h.Type("button"),
      h.Class(`file-row${file.path === model.selectedPath ? " is-selected" : ""}`),
      h.OnClick(SelectedFile({ path: file.path })),
    ],
    [
      h.span([h.Class(`file-status status-${file.status}`)], [
        reviewed ? "✓" : statusGlyph(file.status),
      ]),
      h.span([h.Class("file-copy")], [
        h.span([h.Class("file-name")], [file.path.split("/").at(-1) ?? file.path]),
        h.span([h.Class("file-dir")], [
          file.path.includes("/")
            ? file.path.slice(0, file.path.lastIndexOf("/"))
            : "root",
        ]),
      ]),
      h.span([h.Class("file-delta")], [
        h.span([h.Class("plus")], [`+${file.additions}`]),
        h.span([h.Class("minus")], [`−${file.deletions}`]),
      ]),
    ],
  );
};

const scopePicker = (
  model: Model,
  showLabel: boolean,
  h: HtmlBuilder<Message>,
) =>
  h.div([h.Class("control-group scope-picker")], [
    showLabel ? h.span([h.Class("control-label")], ["Scope"]) : h.empty,
    h.div([h.Class("segmented")], [
      h.button(
        [
          h.Type("button"),
          h.Class(buttonClass(model.reviewScope === "file")),
          h.OnClick(SelectedReviewScope({ value: "file" })),
        ],
        ["One file"],
      ),
      h.button(
        [
          h.Type("button"),
          h.Class(buttonClass(model.reviewScope === "full")),
          h.OnClick(SelectedReviewScope({ value: "full" })),
        ],
        ["Full diff"],
      ),
    ]),
  ]);

const viewPicker = (
  model: Model,
  showLabel: boolean,
  h: HtmlBuilder<Message>,
) =>
  h.div([h.Class("control-group view-picker")], [
    showLabel ? h.span([h.Class("control-label")], ["View"]) : h.empty,
    h.div([h.Class("segmented")], [
      h.button(
        [
          h.Type("button"),
          h.Class(buttonClass(model.viewMode === "unified")),
          h.OnClick(SelectedViewMode({ value: "unified" })),
        ],
        ["Unified"],
      ),
      h.button(
        [
          h.Type("button"),
          h.Class(buttonClass(model.viewMode === "split")),
          h.OnClick(SelectedViewMode({ value: "split" })),
        ],
        ["Side by side"],
      ),
    ]),
  ]);

const intelligenceControls = (model: Model, h: HtmlBuilder<Message>) => [
  toggleButton("Ignore whitespace", model.ignoreWhitespace, ToggledWhitespace(), h),
  toggleButton("Semantic", model.semantic, ToggledSemantic(), h),
  h.div([h.Class("inline-diff-picker")], [
    h.span([h.Class("control-label")], ["Inline diff"]),
    h.div([h.Class("segmented")], [
      ...(["token", "character", "off"] as const).map(mode =>
        h.button(
          [
            h.Type("button"),
            h.Class(buttonClass(model.inlineDiffMode === mode)),
            h.OnClick(SelectedInlineDiffMode({ value: mode })),
          ],
          [mode === "token" ? "Token" : mode === "character" ? "Character" : "Off"],
        ),
      ),
    ]),
  ]),
  toggleButton("Syntax", model.syntaxHighlighting, ToggledSyntaxHighlighting(), h),
  model.prUrl === "" || !isPullRequestUrl(model.meta.url) || model.reviewTab !== "files"
    ? h.empty
    : toggleButton(
        model.githubReviews._tag === "Ready"
          ? `GitHub reviews ${model.githubReviews.comments.filter(comment => comment.id === comment.rootId).length}`
          : "GitHub reviews",
        model.showGitHubReviews,
        ToggledGitHubReviews(),
        h,
      ),
];

const compactReviewToolbar = (model: Model, h: HtmlBuilder<Message>): Html => {
  const activeOptions = [
    model.ignoreWhitespace,
    model.semantic,
    model.inlineDiffMode !== "off",
    model.syntaxHighlighting,
    isPullRequestUrl(model.meta.url) &&
      model.reviewTab === "files" &&
      model.showGitHubReviews,
  ].filter(Boolean).length;
  return h.header(
    [
      h.Class(
        `compact-review-toolbar ${model.toolbarCompact ? "is-compact" : "is-expanded"}`,
      ),
    ],
    [
      h.div([h.Class("compact-brand")], [
        h.span([h.Class("brand-mark")], ["H"]),
        h.span([h.Class("brand-name")], ["hunker"]),
      ]),
      h.a(
        [
          h.Class("toolbar-review-identity"),
          h.Href(model.meta.url),
          h.Target("_blank"),
          h.Rel("noreferrer"),
          h.Title("Open pull request on GitHub"),
        ],
        [
          h.strong([], [`${model.meta.repository} #${model.meta.number}`]),
          h.span([], [model.meta.title]),
        ],
      ),
    h.nav([h.Class("toolbar-primary-controls"), h.AriaLabel("Review display")], [
      model.reviewTab === "files" || model.selectedCommit !== ""
        ? scopePicker(model, false, h)
        : h.empty,
      model.reviewTab === "files" || model.selectedCommit !== ""
        ? viewPicker(model, false, h)
        : h.empty,
    ]),
    model.toolbarMenu === "none"
      ? h.empty
      : h.button(
          [
            h.Type("button"),
            h.Class("toolbar-backdrop"),
            h.AriaLabel("Close toolbar menu"),
            h.OnClick(ClosedToolbarMenus()),
          ],
          [],
        ),
    h.div([h.Class("toolbar-actions")], [
      h.div(
        [
          h.Class(
            `toolbar-menu toolbar-options${model.toolbarMenu === "options" ? " is-open" : ""}`,
          ),
        ],
        [
          h.button(
            [
              h.Type("button"),
              h.Class("toolbar-menu-button"),
              h.AriaExpanded(model.toolbarMenu === "options"),
              h.OnClick(ToggledToolbarMenu({ value: "options" })),
            ],
            ["Diff options", h.span([], [String(activeOptions)])],
          ),
          model.toolbarMenu === "options"
            ? h.div([h.Class("toolbar-options-panel")], [
                h.div([h.Class("toolbar-panel-heading")], [
                  h.strong([], ["Diff intelligence"]),
                  h.span([], ["Tune what Hunker emphasizes in this review."]),
                ]),
                h.div(
                  [h.Class("toolbar-filter-grid")],
                  intelligenceControls(model, h),
                ),
              ])
            : h.empty,
        ],
      ),
      !isPullRequestUrl(model.meta.url)
        ? h.empty
        : h.div([h.Class("segmented review-tab-picker")], [
            h.button(
              [
                h.Type("button"),
                h.Class(buttonClass(model.reviewTab === "files")),
                h.OnClick(SelectedReviewTab({ value: "files" })),
              ],
              ["Files"],
            ),
            h.button(
              [
                h.Type("button"),
                h.Class(buttonClass(model.reviewTab === "commits")),
                h.OnClick(SelectedReviewTab({ value: "commits" })),
              ],
              ["Commits"],
            ),
          ]),
      h.div(
        [
          h.Class(
            `toolbar-menu toolbar-open-review${model.toolbarMenu === "open-review" ? " is-open" : ""}`,
          ),
        ],
        [
          h.button(
            [
              h.Type("button"),
              h.Class("toolbar-menu-button"),
              h.AriaExpanded(model.toolbarMenu === "open-review"),
              h.OnClick(ToggledToolbarMenu({ value: "open-review" })),
            ],
            ["Open GitHub link"],
          ),
          model.toolbarMenu === "open-review"
            ? h.div([h.Class("toolbar-loader-panel")], [
                githubLocationForm(model, "toolbar-pr-loader", h),
              ])
            : h.empty,
        ],
      ),
      h.button(
        [
          h.Type("button"),
          h.Class("toolbar-refresh"),
          h.Title(
            model.meta.backing.source === "local"
              ? "Fetch and load the latest local Git revision"
              : "Pull the latest diff from GitHub",
          ),
          h.AriaLabel(
            model.meta.backing.source === "local"
              ? "Refresh diff from local Git"
              : "Refresh diff from GitHub",
          ),
          h.Disabled(model.phase === "loading"),
          h.OnClick(RefreshedReview()),
        ],
        [
          h.span([h.Class(model.phase === "loading" ? "is-spinning" : "")], ["↻"]),
          h.span([h.Class("toolbar-refresh-label")], [
            model.phase === "loading" ? "Refreshing…" : "Refresh",
          ]),
        ],
      ),
    ]),
  ]);
};

const topBarView = (model: Model, h: HtmlBuilder<Message>): Html =>
  hasLoadedReview(model)
    ? compactReviewToolbar(model, h)
    : h.header([h.Class("topbar")], [
        h.div([h.Class("brand")], [
          h.span([h.Class("brand-mark")], ["H"]),
          h.span([h.Class("brand-name")], ["hunker"]),
          h.span([h.Class("brand-tagline")], [
            "review the change, not the noise",
          ]),
        ]),
        githubLocationForm(model, "pr-loader", h),
        h.div([h.Class("shortcut-hint")], [
          h.kbd([], ["⌘"]),
          h.kbd([], ["K"]),
          " Quick open",
        ]),
      ]);

const reviewHeaderView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const [repositoryOwner = "", repositoryName = ""] = model.meta.repository.split("/");
  const totalAdditions = model.pullRequestFiles.reduce(
    (sum, file) => sum + file.additions,
    0,
  );
  const totalDeletions = model.pullRequestFiles.reduce(
    (sum, file) => sum + file.deletions,
    0,
  );
  const progress =
    model.pullRequestFiles.length === 0
      ? 0
      : Math.round(
          (model.reviewedPaths.length / model.pullRequestFiles.length) * 100,
        );

  return h.section([h.Class("review-header")], [
    h.div([h.Class("review-title-block")], [
      h.div([h.Class("repo-line")], [
        repositoryOwner === "" || repositoryName === ""
          ? h.span([h.Class("repo-name")], [model.meta.repository])
          : h.a(
              [
                h.Class("repo-name"),
                h.Href(
                  localRepositoryUrl({ owner: repositoryOwner, name: repositoryName }),
                ),
                h.Title("Browse local repository"),
              ],
              [model.meta.repository],
            ),
        h.span([h.Class("pr-number")], [`#${model.meta.number}`]),
        h.span([h.Class("agent-badge")], ["AGENT PR"]),
        model.meta.backing.source === "local"
          ? h.button(
              [
                h.Type("button"),
                h.Class("review-backing is-local"),
                h.Title(
                  `${model.meta.backing.path} @ ${model.meta.backing.headOid}. Check for a newer PR revision.`,
                ),
                h.Disabled(model.reviewRevision._tag === "Checking"),
                h.OnClick(RequestedRevisionCheck()),
              ],
              ["LOCAL GIT"],
            )
          : h.span(
              [
                h.Class("review-backing is-github"),
                h.Title(`GitHub @ ${model.meta.backing.headOid}`),
              ],
              ["GITHUB"],
            ),
        model.reviewRevision._tag === "Available"
          ? h.button(
              [
                h.Type("button"),
                h.Class("revision-available"),
                h.Title(
                  `Pinned at ${model.meta.backing.headOid}; ${model.reviewRevision.latestHeadOid} is available`,
                ),
                h.OnClick(RefreshedReview()),
              ],
              ["New revision available · refresh"],
            )
          : model.reviewRevision._tag === "Checking"
            ? h.span([h.Class("revision-checking")], ["checking…"])
            : h.empty,
      ]),
      h.h1([], [model.meta.title]),
      h.div([h.Class("branch-line")], [
        h.span([], [`${model.meta.author} wants to merge`]),
        h.code([], [model.meta.head]),
        h.span([], ["into"]),
        h.code([], [model.meta.base]),
      ]),
    ]),
    h.div([h.Class("review-stats")], [
      h.div([h.Class("stat-block")], [
        h.strong([], [String(model.pullRequestFiles.length)]),
        h.span([], ["files"]),
      ]),
      h.div([h.Class("stat-block plus")], [
        h.strong([], [`+${totalAdditions}`]),
        h.span([], ["added"]),
      ]),
      h.div([h.Class("stat-block minus")], [
        h.strong([], [`−${totalDeletions}`]),
        h.span([], ["removed"]),
      ]),
      h.div([h.Class("progress-block")], [
        h.div([h.Class("progress-label")], [
          h.span([], ["Review progress"]),
          h.strong([], [`${progress}%`]),
        ]),
        h.div([h.Class("progress-track")], [
          h.span(
            [h.Class("progress-fill"), h.Style({ width: `${progress}%` })],
            [""],
          ),
        ]),
      ]),
    ]),
  ]);
};

const controlsView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.section([h.Class("controlbar")], [
    scopePicker(model, true, h),
    h.div([h.Class("control-divider")], [""]),
    viewPicker(model, true, h),
    h.div([h.Class("control-divider")], [""]),
    h.div([h.Class("control-group filters")], [
      h.span([h.Class("control-label")], ["Diff intelligence"]),
      ...intelligenceControls(model, h),
    ]),
    h.div([h.Class("control-spacer")], [""]),
    h.div([h.Class("legend")], [
      h.span([], [h.i([h.Class("legend-add")], [""]), "addition"]),
      h.span([], [h.i([h.Class("legend-remove")], [""]), "deletion"]),
      h.span([], [h.i([h.Class("legend-move")], [""]), "semantic move"]),
    ]),
  ]);

const githubReviewStatusView = (model: Model, h: HtmlBuilder<Message>): Html => {
  if (
    model.reviewTab !== "files" ||
    !model.showGitHubReviews ||
    model.prUrl === ""
  ) return h.empty;
  return model.githubReviews._tag === "Loading"
    ? h.div([h.Class("github-reviews-status")], ["Loading GitHub review threads…"])
    : model.githubReviews._tag === "Failed"
      ? h.div([h.Class("github-reviews-status is-error"), h.Role("alert")], [
          h.strong([], ["Could not load GitHub reviews"]),
          h.span([], [model.githubReviews.error]),
        ])
      : h.empty;
};

const fileSidebarView = (
  model: Model,
  visibleFiles: ReadonlyArray<FileChange>,
  h: HtmlBuilder<Message>,
): Html =>
  h.aside(
    [
      h.Class(
        `file-sidebar${hasLoadedReview(model) ? model.toolbarCompact ? " with-compact-toolbar" : " with-expanded-toolbar" : ""}`,
      ),
    ],
    [
    h.div([h.Class("sidebar-heading")], [
      h.strong([], [model.reviewTab === "commits" ? "Commit files" : "Changed files"]),
      h.span([], [String(model.files.length)]),
      h.button(
        [
          h.Type("button"),
          h.Class("sidebar-toggle"),
          h.AriaLabel(
            model.sidebarCollapsed ? "Expand file sidebar" : "Collapse file sidebar",
          ),
          h.AriaExpanded(!model.sidebarCollapsed),
          h.Title(model.sidebarCollapsed ? "Expand file sidebar" : "Collapse file sidebar"),
          h.OnClick(ToggledSidebar()),
        ],
        [model.sidebarCollapsed ? "›" : "‹"],
      ),
    ]),
    h.div([h.Class("file-search")], [
      h.span([], ["⌕"]),
      h.input([
        h.Type("search"),
        h.Value(model.filter),
        h.Placeholder("Filter files"),
        h.AriaLabel("Filter changed files"),
        h.OnInput(value => ChangedFilter({ value })),
      ]),
    ]),
    h.nav(
      [h.Class("file-list"), h.AriaLabel("Changed files")],
      visibleFiles.map(file => fileRow(file, model, h)),
    ),
    h.div([h.Class("sidebar-tip")], [
      h.span([h.Class("tip-icon")], ["↕"]),
      h.span([], [
        "Use ",
        h.kbd([], ["J"]),
        " / ",
        h.kbd([], ["K"]),
        " to move between files",
      ]),
    ]),
    ],
  );

const semanticBannerView = (
  file: FileChange,
  model: Model,
  result: SemanticResult | undefined,
  h: HtmlBuilder<Message>,
): Html => {
  const request = model.semanticRequest;
  const loading = request._tag === "Loading" && request.path === file.path;
  const failed = request._tag === "Failed" && request.path === file.path;
  if (result !== undefined) {
    if (result._tag === "Parsed") return h.empty;
    const parseFailed = result._tag === "ParseFailed";
    return h.div([h.Class(`semantic-banner${parseFailed ? " is-error" : ""}`)], [
      h.span([h.Class("semantic-icon")], [parseFailed ? "!" : "◎"]),
      h.div([], [
        h.strong([], [parseFailed ? "Syntax analysis unavailable" : "Syntax analysis skipped"]),
        h.span([], [result.reason]),
      ]),
      h.span([h.Class("confidence")], ["patch fallback"]),
    ]);
  }
  if (!loading && !failed) return h.empty;
  const title = loading
    ? "ast-grep is analyzing this file…"
    : "Syntax analysis unavailable";
  const detail = failed
    ? request.error
    : "Fetching both revisions and comparing their syntax trees.";

  return h.div([h.Class(`semantic-banner${failed ? " is-error" : ""}`)], [
    h.span([h.Class("semantic-icon")], [loading ? "◌" : failed ? "!" : "◎"]),
    h.div([], [h.strong([], [title]), h.span([], [detail])]),
    h.span([h.Class("confidence")], [loading ? "working" : "fallback"]),
  ]);
};

const movementSummaryView = (model: Model, h: HtmlBuilder<Message>): Html => {
  if (!model.semantic || model.reviewScope !== "full") return h.empty;
  const state = model.reviewMoves;
  if (state._tag === "Idle") return h.empty;
  if (state._tag === "Loading") {
    return h.section([h.Class("movement-summary is-loading")], [
      h.span([h.Class("semantic-icon")], ["◌"]),
      h.div([], [
        h.strong([], ["Scanning the full PR for moved code…"]),
        h.span([], ["ast-grep is matching declarations across the review's syntax forest."]),
      ]),
    ]);
  }
  if (state._tag === "Failed") {
    return h.section([h.Class("movement-summary is-error")], [
      h.span([h.Class("semantic-icon")], ["!"]),
      h.div([], [
        h.strong([], ["Whole-review move scan unavailable"]),
        h.span([], [state.error]),
      ]),
    ]);
  }
  if (state.moves.length === 0) {
    return h.section([h.Class("movement-summary")], [
      h.span([h.Class("semantic-icon")], ["✓"]),
      h.div([], [
        h.strong([], ["No moved code blocks found"]),
        h.span([], ["No declaration was relocated across the changed syntax trees."]),
      ]),
    ]);
  }
  return h.section([h.Class("movement-summary has-moves")], [
    h.div([h.Class("movement-summary-heading")], [
      h.span([h.Class("semantic-icon")], ["↗"]),
      h.div([], [
        h.strong([], [
          `${state.moves.length} moved code ${state.moves.length === 1 ? "block" : "blocks"}`,
        ]),
        h.span([], ["These declarations moved between syntax trees; edited moves are marked."]),
      ]),
    ]),
    h.div(
      [h.Class("movement-list")],
      state.moves.map((move, index) =>
        h.div([h.Key(`${move.fromPath}-${move.fromLine}-${index}`), h.Class("movement-row")], [
          h.span([h.Class("movement-count")], [
            `${move.lineCount} lines${move.changed ? " · edited" : ""}`,
          ]),
          h.code([], [`${move.fromPath}:${move.fromLine}`]),
          h.span([h.Class("movement-arrow")], ["→"]),
          h.code([], [`${move.toPath}:${move.toLine}`]),
          h.span([h.Class("movement-preview")], [
            `${move.label} · ${move.preview}`,
          ]),
        ]),
      ),
    ),
  ]);
};

const diffPanelView = (
  file: FileChange,
  model: Model,
  moves: ReadonlyArray<MovedBlock>,
  h: HtmlBuilder<Message>,
): Html => {
  const reviewed = model.reviewedPaths.includes(file.path);
  const collapsed = model.collapsedPaths.includes(file.path);
  const fullFileState = model.fullFileStates.find(state => state.path === file.path);
  const lines =
    fullFileState?._tag === "Ready"
      ? toFullDiffLines(
          file.patch,
          fullFileState.oldText,
          fullFileState.newText,
          model.ignoreWhitespace,
        )
      : toDiffLines(file.patch, model.ignoreWhitespace);
  const semanticResult = model.semanticResults.find(result => result.path === file.path);
  const characterDiffState = model.characterDiffStates.find(
    state => {
      const statePath = state._tag === "Ready" ? state.result.path : state.path;
      const ignoresWhitespace =
        state._tag === "Ready"
          ? state.result.ignoreWhitespace
          : state.ignoreWhitespace;
      const mode = state._tag === "Ready" ? state.result.mode : state.mode;
      return (
        statePath === file.path &&
        ignoresWhitespace === model.ignoreWhitespace &&
        mode === model.inlineDiffMode
      );
    },
  );
  const parsedSemantic =
    semanticResult?._tag === "Parsed" ? semanticResult : undefined;
  const rangeFor = (side: "old" | "new") =>
    parsedSemantic?.changes.flatMap(change => {
      const range =
        side === "old"
          ? change._tag === "Inserted"
            ? undefined
            : change.oldRange
          : change._tag === "Deleted"
            ? undefined
            : change.newRange;
      if (range === undefined) return [];
      return [{ start: range.startLine, count: range.endLine - range.startLine + 1 }];
    }) ?? [];
  const movedRanges: MovedRanges = {
    old: moves
      .filter(move => move.fromPath === file.path)
      .map(move => ({ start: move.fromLine, count: move.lineCount })),
    new: moves
      .filter(move => move.toPath === file.path)
      .map(move => ({ start: move.toLine, count: move.lineCount })),
    semanticOld: rangeFor("old"),
    semanticNew: rangeFor("new"),
  };

  const semanticChangeText = (change: SemanticChange) => {
    const kind = change.kind.replaceAll("_", " ");
    if (change._tag === "Renamed") {
      return `Renamed ${kind} ${change.oldLabel} → ${change.newLabel}`;
    }
    return `${change._tag} ${kind} ${change.label}`;
  };

  const interaction = {
    path: file.path,
    collapsedHunks: model.collapsedHunks,
    syntaxHighlighting: model.syntaxHighlighting,
    characterRows:
      characterDiffState?._tag === "Ready" ? characterDiffState.result.rows : [],
    reviews: {
      comments:
        model.reviewTab === "files" &&
        model.showGitHubReviews &&
        model.githubReviews._tag === "Ready"
          ? model.githubReviews.comments
          : [],
      replyDrafts: model.replyDrafts,
      replyStates: model.replyStates,
      collapsedThreads: model.collapsedReviewThreads,
    },
  };
  const semanticOnly =
    model.semantic &&
    parsedSemantic?.semanticEqual === true &&
    fullFileState?._tag !== "Ready";

  return h.section([h.Class(`diff-panel${collapsed ? " is-collapsed" : ""}`)], [
    h.div([h.Class("file-header")], [
      h.button(
        [
          h.Type("button"),
          h.Class("file-header-collapse-target"),
          h.AriaExpanded(!collapsed),
          h.AriaLabel(`${collapsed ? "Expand" : "Collapse"} ${file.path}`),
          h.Title(`${collapsed ? "Expand" : "Collapse"} file diff`),
          h.OnClick(ToggledFileCollapse({ path: file.path })),
        ],
        [],
      ),
      h.div([h.Class("file-path")], [
        h.span([h.Class("file-collapse-chevron")], [collapsed ? "›" : "⌄"]),
        h.span([h.Class(`file-status status-${file.status}`)], [statusGlyph(file.status)]),
        h.span([], [
          h.span([h.Class("path-dir")], [
            file.path.includes("/")
              ? file.path.slice(0, file.path.lastIndexOf("/") + 1)
              : "",
          ]),
          h.strong([], [file.path.split("/").at(-1) ?? file.path]),
        ]),
      ]),
      h.div([h.Class("file-actions")], [
        h.button(
          [
            h.Type("button"),
            h.Class("context-button"),
            h.Disabled(fullFileState?._tag === "Loading"),
            h.AriaLabel(
              fullFileState?._tag === "Ready"
                ? `Show patch only for ${file.path}`
                : fullFileState?._tag === "Failed"
                  ? `Retry full file for ${file.path}`
                  : `Expand ${file.path} to full file`,
            ),
            h.OnClick(ToggledFullFile({ path: file.path })),
          ],
          [
            fullFileState?._tag === "Ready"
              ? "Patch only"
              : fullFileState?._tag === "Loading"
                ? "Loading file…"
                : fullFileState?._tag === "Failed"
                  ? "Retry full file"
                  : "Full file",
          ],
        ),
        model.semantic && parsedSemantic !== undefined
          ? h.span([h.Class("semantic-engine-badge")], [
              `ast-grep · ${parsedSemantic.language}`,
            ])
          : h.empty,
        h.button(
          [h.Type("button"), h.Class("icon-button"), h.Title("Copy file path")],
          ["⧉"],
        ),
        h.button(
          [h.Type("button"), h.Class("icon-button"), h.Title("Open file")],
          ["↗"],
        ),
        model.reviewTab === "files" ? h.button(
          [
            h.Type("button"),
            h.Class(`reviewed-button${reviewed ? " is-reviewed" : ""}`),
            h.OnClick(ToggledReviewed({ path: file.path })),
          ],
          [reviewed ? "✓ Reviewed" : "Mark reviewed"],
        ) : h.empty,
      ]),
    ]),
    collapsed
      ? h.empty
      : h.div([h.Class("file-body")], [
          moves.length === 0
            ? h.empty
            : h.div(
                [h.Class("file-movements")],
                moves.map((move, index) =>
                  h.span([h.Key(`file-move-${index}`)], [
                    `${move.lineCount} lines moved ${move.fromPath}:${move.fromLine} → ${move.toPath}:${move.toLine}`,
                  ]),
                ),
              ),
          fullFileState?._tag === "Failed"
            ? h.div([h.Class("file-context-error"), h.Role("alert")], [
                h.strong([], ["Could not load the complete file"]),
                h.span([], [fullFileState.error]),
              ])
            : h.empty,
          model.inlineDiffMode !== "off" && characterDiffState?._tag === "Failed"
            ? h.div([h.Class("file-context-error"), h.Role("alert")], [
                h.strong([], ["Could not calculate inline changes"]),
                h.span([], [characterDiffState.error]),
              ])
            : h.empty,
          model.semantic ? semanticBannerView(file, model, semanticResult, h) : h.empty,
          model.semantic && parsedSemantic !== undefined && parsedSemantic.changes.length > 0
            ? h.div(
                [h.Class("semantic-findings")],
                parsedSemantic.changes.map((change, index) =>
                  h.span([h.Key(`semantic-change-${index}`)], [semanticChangeText(change)]),
                ),
              )
            : h.empty,
          ...detachedReviewThreads(
            file.path,
            semanticOnly ? [] : lines,
            interaction.reviews,
            h,
          ),
          semanticOnly
            ? h.div([h.Class("semantic-equal")], [
                h.strong([], ["No syntax changes"]),
                h.span([], ["Only formatting or comments changed in this file."]),
              ])
            : model.viewMode === "unified"
              ? unifiedDiffView(
                  lines,
                  model.inlineDiffMode !== "off",
                  movedRanges,
                  interaction,
                  h,
                )
              : splitDiffView(
                  lines,
                  model.inlineDiffMode !== "off",
                  movedRanges,
                  interaction,
                  h,
                ),
          h.div([h.Class("diff-footer")], [
            h.span([], [fullFileState?._tag === "Ready" ? "End of file" : "End of patch"]),
            model.reviewTab === "files"
              ? h.button([h.Type("button"), h.Class("comment-button")], [
                  "＋ Add a review comment",
                ])
              : h.empty,
          ]),
        ]),
  ]);
};

export const view = (model: Model, h: HtmlBuilder<Message>): Html => {
  if (model.page === "repository") return repositoryView(model, h);
  if (model.phase === "loading") {
    return h.main([h.Class("app-shell")], [
      topBarView(model, h),
      reviewLoadingView(model, h),
    ]);
  }
  if (model.phase === "error") {
    return h.main([h.Class("app-shell")], [
      topBarView(model, h),
      h.div([h.Class("error-banner"), h.Role("alert")], [model.error]),
      reviewErrorView(model, h),
    ]);
  }
  const selected =
    model.files.find(file => file.path === model.selectedPath) ?? model.files[0];
  const query = model.filter.trim().toLowerCase();
  const visibleFiles =
    query === ""
      ? model.files
      : model.files.filter(file => file.path.toLowerCase().includes(query));
  const moves = model.reviewMoves._tag === "Ready" ? model.reviewMoves.moves : [];
  const movesFor = (file: FileChange) =>
    moves.filter(move => move.fromPath === file.path || move.toPath === file.path);

  return h.main([h.Class("app-shell")], [
    topBarView(model, h),
    model.githubInputError === ""
      ? h.empty
      : h.div([h.Class("error-banner"), h.Role("alert")], [model.githubInputError]),
    reviewHeaderView(model, h),
    hasLoadedReview(model) ? h.empty : controlsView(model, h),
    githubReviewStatusView(model, h),
    model.reviewTab === "commits" && model.selectedCommit === ""
      ? commitListView(model, h)
      : h.empty,
    model.reviewTab === "commits" && model.selectedCommit !== ""
      ? commitDetailHeader(model, h)
      : h.empty,
    model.reviewTab === "commits" &&
    model.selectedCommit !== "" &&
    model.commitDiff._tag !== "Ready"
      ? commitDiffStateView(model, h)
      : h.empty,
    model.reviewTab === "commits" &&
    (model.selectedCommit === "" || model.commitDiff._tag !== "Ready")
      ? h.empty
      :
    h.div(
      [
        h.Class(
          `workspace${hasLoadedReview(model) ? model.toolbarCompact ? " with-compact-toolbar" : " with-expanded-toolbar" : ""}${model.sidebarCollapsed ? " sidebar-collapsed" : ""}`,
        ),
      ],
      [
      fileSidebarView(model, visibleFiles, h),
      model.reviewScope === "full"
        ? h.div([h.Class("review-content full-diff")], [
            movementSummaryView(model, h),
            ...visibleFiles.map(file => diffPanelView(file, model, movesFor(file), h)),
            model.reviewTab === "files" ? reviewComposerView(model, h) : h.empty,
          ])
        : selected === undefined
          ? h.section([h.Class("empty-state")], ["No text files to review."])
          : h.div([h.Class("review-content")], [
              diffPanelView(selected, model, movesFor(selected), h),
              model.reviewTab === "files" ? reviewComposerView(model, h) : h.empty,
            ]),
      ],
    ),
  ]);
};
