import type { Html, HtmlBuilder } from "foldkit/html";

import {
  ChangedFilter,
  ChangedPrUrl,
  RefreshedReview,
  SelectedFile,
  SelectedReviewScope,
  SelectedViewMode,
  SubmittedPrUrl,
  ToggledCharacterDiff,
  ToggledReviewed,
  ToggledSemantic,
  ToggledSidebar,
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
import { toDiffLines } from "../diff";
import { splitDiffView, unifiedDiffView } from "./diff-view";
import type { MovedRanges } from "./diff-view";

const buttonClass = (active: boolean) =>
  `segmented-button${active ? " is-active" : ""}`;

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

const topBarView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.header([h.Class("topbar")], [
    h.div([h.Class("brand")], [
      h.span([h.Class("brand-mark")], ["H"]),
      h.span([h.Class("brand-name")], ["hunker"]),
      h.span([h.Class("brand-tagline")], ["review the change, not the noise"]),
    ]),
    h.form([h.Class("pr-loader"), h.OnSubmit(SubmittedPrUrl())], [
      h.span([h.Class("github-glyph")], ["⌘"]),
      h.input([
        h.Type("url"),
        h.Value(model.prUrl),
        h.Placeholder("Paste a GitHub PR or compare URL"),
        h.AriaLabel("GitHub pull request URL"),
        h.OnInput(value => ChangedPrUrl({ value })),
      ]),
      h.button(
        [h.Type("submit"), h.Class("load-button"), h.Disabled(model.phase === "loading")],
        [model.phase === "loading" ? "Fetching…" : "Review"],
      ),
    ]),
    h.div([h.Class("shortcut-hint")], [
      h.kbd([], ["⌘"]),
      h.kbd([], ["K"]),
      " Quick open",
    ]),
  ]);

const reviewHeaderView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const totalAdditions = model.files.reduce((sum, file) => sum + file.additions, 0);
  const totalDeletions = model.files.reduce((sum, file) => sum + file.deletions, 0);
  const progress =
    model.files.length === 0
      ? 0
      : Math.round((model.reviewedPaths.length / model.files.length) * 100);

  return h.section([h.Class("review-header")], [
    h.div([h.Class("review-title-block")], [
      h.div([h.Class("repo-line")], [
        h.span([h.Class("repo-name")], [model.meta.repository]),
        h.span([h.Class("pr-number")], [`#${model.meta.number}`]),
        h.span([h.Class("agent-badge")], ["AGENT PR"]),
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
      model.prUrl === ""
        ? h.empty
        : h.button(
            [
              h.Type("button"),
              h.Class("refresh-button"),
              h.Title("Pull the latest diff from GitHub"),
              h.AriaLabel("Refresh diff from GitHub"),
              h.Disabled(model.phase === "loading"),
              h.OnClick(RefreshedReview()),
            ],
            [
              h.span([h.Class(model.phase === "loading" ? "is-spinning" : "")], ["↻"]),
              model.phase === "loading" ? "Refreshing…" : "Refresh",
            ],
          ),
      h.div([h.Class("stat-block")], [
        h.strong([], [String(model.files.length)]),
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
    h.div([h.Class("control-group scope-picker")], [
      h.span([h.Class("control-label")], ["Scope"]),
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
    ]),
    h.div([h.Class("control-divider")], [""]),
    h.div([h.Class("control-group view-picker")], [
      h.span([h.Class("control-label")], ["View"]),
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
    ]),
    h.div([h.Class("control-divider")], [""]),
    h.div([h.Class("control-group filters")], [
      h.span([h.Class("control-label")], ["Diff intelligence"]),
      toggleButton("Ignore whitespace", model.ignoreWhitespace, ToggledWhitespace(), h),
      toggleButton("Semantic", model.semantic, ToggledSemantic(), h),
      toggleButton(
        "Character diff",
        model.characterDiff,
        ToggledCharacterDiff(),
        h,
      ),
    ]),
    h.div([h.Class("control-spacer")], [""]),
    h.div([h.Class("legend")], [
      h.span([], [h.i([h.Class("legend-add")], [""]), "addition"]),
      h.span([], [h.i([h.Class("legend-remove")], [""]), "deletion"]),
      h.span([], [h.i([h.Class("legend-move")], [""]), "semantic move"]),
    ]),
  ]);

const fileSidebarView = (
  model: Model,
  visibleFiles: ReadonlyArray<FileChange>,
  h: HtmlBuilder<Message>,
): Html =>
  h.aside([h.Class("file-sidebar")], [
    h.div([h.Class("sidebar-heading")], [
      h.strong([], ["Changed files"]),
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
  ]);

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
  const lines = toDiffLines(file.patch, model.ignoreWhitespace);
  const semanticResult = model.semanticResults.find(result => result.path === file.path);
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

  return h.section([h.Class("diff-panel")], [
    h.div([h.Class("file-header")], [
      h.div([h.Class("file-path")], [
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
        h.button(
          [
            h.Type("button"),
            h.Class(`reviewed-button${reviewed ? " is-reviewed" : ""}`),
            h.OnClick(ToggledReviewed({ path: file.path })),
          ],
          [reviewed ? "✓ Reviewed" : "Mark reviewed"],
        ),
      ]),
    ]),
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
    model.semantic ? semanticBannerView(file, model, semanticResult, h) : h.empty,
    model.semantic && parsedSemantic !== undefined && parsedSemantic.changes.length > 0
      ? h.div(
          [h.Class("semantic-findings")],
          parsedSemantic.changes.map((change, index) =>
            h.span([h.Key(`semantic-change-${index}`)], [semanticChangeText(change)]),
          ),
        )
      : h.empty,
    model.semantic && parsedSemantic?.semanticEqual
      ? h.div([h.Class("semantic-equal")], [
          h.strong([], ["No syntax changes"]),
          h.span([], ["Only formatting or comments changed in this file."]),
        ])
      : model.viewMode === "unified"
        ? unifiedDiffView(lines, model.characterDiff, movedRanges, h)
        : splitDiffView(lines, model.characterDiff, movedRanges, h),
    h.div([h.Class("diff-footer")], [
      h.span([], ["End of file"]),
      h.button([h.Type("button"), h.Class("comment-button")], [
        "＋ Add a review comment",
      ]),
    ]),
  ]);
};

export const view = (model: Model, h: HtmlBuilder<Message>): Html => {
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
    model.phase === "error"
      ? h.div([h.Class("error-banner"), h.Role("alert")], [model.error])
      : h.empty,
    reviewHeaderView(model, h),
    controlsView(model, h),
    h.div(
      [h.Class(`workspace${model.sidebarCollapsed ? " sidebar-collapsed" : ""}`)],
      [
      fileSidebarView(model, visibleFiles, h),
      model.reviewScope === "full"
        ? h.div([h.Class("review-content full-diff")], [
            movementSummaryView(model, h),
            ...visibleFiles.map(file => diffPanelView(file, model, movesFor(file), h)),
          ])
        : selected === undefined
          ? h.section([h.Class("empty-state")], ["No text files to review."])
          : diffPanelView(selected, model, movesFor(selected), h),
      ],
    ),
  ]);
};
