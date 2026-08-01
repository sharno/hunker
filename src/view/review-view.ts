import type { Html, HtmlBuilder } from "foldkit/html";

import {
  ChangedFilter,
  ChangedPrUrl,
  SelectedFile,
  SelectedViewMode,
  SubmittedPrUrl,
  ToggledCharacterDiff,
  ToggledReviewed,
  ToggledSemantic,
  ToggledWhitespace,
} from "../domain";
import type { FileChange, Message, Model, SemanticResult } from "../domain";
import { toDiffLines } from "../diff";
import { toSemanticRows } from "../semantic";
import {
  semanticSplitDiffView,
  semanticUnifiedDiffView,
  splitDiffView,
  unifiedDiffView,
} from "./diff-view";

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
  const title =
    result !== undefined
      ? `${result.language} structural diff`
      : loading
        ? "Difftastic is analyzing this file…"
        : failed
          ? "Difftastic analysis unavailable"
          : file.insight;
  const detail =
    result !== undefined
      ? `${result.chunks.length} semantic change ${result.chunks.length === 1 ? "group" : "groups"}; formatting and syntax-aware alignment are handled server-side.`
      : failed
        ? request.error
        : loading
          ? "Fetching base and head contents, then parsing their syntax trees."
          : "Load a GitHub PR to replace this sample insight with Difftastic analysis.";

  return h.div([h.Class(`semantic-banner${failed ? " is-error" : ""}`)], [
    h.span([h.Class("semantic-icon")], [loading ? "◌" : failed ? "!" : "◎"]),
    h.div([], [h.strong([], [title]), h.span([], [detail])]),
    h.span([h.Class("confidence")], [result === undefined ? "semantic" : "difftastic"]),
  ]);
};

const diffPanelView = (
  file: FileChange,
  model: Model,
  h: HtmlBuilder<Message>,
): Html => {
  const reviewed = model.reviewedPaths.includes(file.path);
  const lines = toDiffLines(file.patch, model.ignoreWhitespace);
  const semanticResult = model.semanticResults.find(result => result.path === file.path);
  const semanticRows =
    semanticResult === undefined
      ? []
      : toSemanticRows(semanticResult, model.ignoreWhitespace);
  const semanticDiff = semanticResult !== undefined && semanticRows.length > 0;

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
    model.semantic ? semanticBannerView(file, model, semanticResult, h) : h.empty,
    model.semantic && semanticDiff
      ? model.viewMode === "unified"
        ? semanticUnifiedDiffView(semanticRows, model.characterDiff, h)
        : semanticSplitDiffView(semanticRows, model.characterDiff, h)
      : model.viewMode === "unified"
        ? unifiedDiffView(lines, model.characterDiff, h)
        : splitDiffView(lines, model.characterDiff, h),
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

  return h.main([h.Class("app-shell")], [
    topBarView(model, h),
    model.phase === "error"
      ? h.div([h.Class("error-banner"), h.Role("alert")], [model.error])
      : h.empty,
    reviewHeaderView(model, h),
    controlsView(model, h),
    h.div([h.Class("workspace")], [
      fileSidebarView(model, visibleFiles, h),
      selected === undefined
        ? h.section([h.Class("empty-state")], ["No text files to review."])
        : diffPanelView(selected, model, h),
    ]),
  ]);
};
