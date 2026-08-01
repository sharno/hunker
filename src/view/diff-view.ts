import type { Html, HtmlBuilder } from "foldkit/html";

import { ToggledHunkCollapse } from "../domain";
import type { Message } from "../domain";
import { hunkKey } from "../diff";
import type { DiffLine, HunkDiffLine } from "../diff";
import { inlineReviewThreads } from "./github-review-view";
import type { GitHubReviewInteraction } from "./github-review-view";
import { syntaxHighlightedContent } from "./syntax-highlight";

export type MovedRanges = Readonly<{
  old: ReadonlyArray<Readonly<{ start: number; count: number }>>;
  new: ReadonlyArray<Readonly<{ start: number; count: number }>>;
  semanticOld: ReadonlyArray<Readonly<{ start: number; count: number }>>;
  semanticNew: ReadonlyArray<Readonly<{ start: number; count: number }>>;
}>;

export type DiffInteraction = Readonly<{
  path: string;
  collapsedHunks: ReadonlyArray<string>;
  syntaxHighlighting: boolean;
  reviews: GitHubReviewInteraction;
}>;

const isInMovedRange = (
  line: number | null,
  ranges: ReadonlyArray<Readonly<{ start: number; count: number }>>,
) =>
  line !== null && ranges.some(range => line >= range.start && line < range.start + range.count);

const sharedPrefixLength = (left: string, right: string) => {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) {
    index += 1;
  }
  return index;
};

const sharedSuffixLength = (left: string, right: string, prefix: number) => {
  let index = 0;
  while (
    index < left.length - prefix &&
    index < right.length - prefix &&
    left[left.length - 1 - index] === right[right.length - 1 - index]
  ) {
    index += 1;
  }
  return index;
};

const codeContent = (
  line: DiffLine,
  paired: DiffLine | undefined,
  characterDiff: boolean,
  interaction: DiffInteraction,
  h: HtmlBuilder<Message>,
): ReadonlyArray<string | Html> => {
  if (
    !characterDiff ||
    paired === undefined ||
    line.kind === "context" ||
    line.kind === "hunk"
  ) {
    return syntaxHighlightedContent(
      interaction.path,
      line.content,
      interaction.syntaxHighlighting,
      undefined,
      h,
    );
  }
  const prefix = sharedPrefixLength(line.content, paired.content);
  const suffix = sharedSuffixLength(line.content, paired.content, prefix);
  if (prefix + suffix >= line.content.length) {
    return syntaxHighlightedContent(
      interaction.path,
      line.content,
      interaction.syntaxHighlighting,
      undefined,
      h,
    );
  }
  const end = suffix === 0 ? line.content.length : line.content.length - suffix;
  return syntaxHighlightedContent(
    interaction.path,
    line.content,
    interaction.syntaxHighlighting,
    { start: prefix, end },
    h,
  );
};

const isCollapsedHunk = (line: DiffLine, interaction: DiffInteraction) =>
  line.hunkId !== null &&
  interaction.collapsedHunks.includes(hunkKey(interaction.path, line.hunkId));

const visibleLines = (
  lines: ReadonlyArray<DiffLine>,
  interaction: DiffInteraction,
) =>
  lines.filter(
    line => line.kind === "hunk" || line.hunkId === null || !isCollapsedHunk(line, interaction),
  );

const hunkHeader = (
  line: HunkDiffLine,
  interaction: DiffInteraction,
  h: HtmlBuilder<Message>,
) => {
  const collapsed = isCollapsedHunk(line, interaction);
  return h.div(
    [h.Key(`${interaction.path}-${line.hunkId}`), h.Class("diff-line line-hunk")],
    [
      h.span([h.Class("line-number old")], [""]),
      h.span([h.Class("line-number new")], [""]),
      h.span([h.Class("line-marker")], [""]),
      h.button(
        [
          h.Type("button"),
          h.Class("hunk-toggle"),
          h.AriaExpanded(!collapsed),
          h.AriaLabel(
            `${collapsed ? "Expand" : "Collapse"} hunk ${line.content} in ${interaction.path}`,
          ),
          h.OnClick(
            ToggledHunkCollapse({
              path: interaction.path,
              hunkId: line.hunkId,
            }),
          ),
        ],
        [
          h.span([h.Class("collapse-chevron")], [collapsed ? "›" : "⌄"]),
          h.code([], [line.content]),
          collapsed ? h.span([h.Class("collapsed-label")], ["hunk collapsed"]) : h.empty,
        ],
      ),
    ],
  );
};

export const unifiedDiffView = (
  lines: ReadonlyArray<DiffLine>,
  characterDiff: boolean,
  moved: MovedRanges,
  interaction: DiffInteraction,
  h: HtmlBuilder<Message>,
) =>
  h.div(
    [h.Class("diff-lines unified-lines")],
    visibleLines(lines, interaction).flatMap((line, index, renderedLines) => {
      if (line.kind === "hunk") return [hunkHeader(line, interaction, h)];
      const paired =
        line.kind === "remove" && renderedLines[index + 1]?.kind === "add"
          ? renderedLines[index + 1]
          : line.kind === "add" && renderedLines[index - 1]?.kind === "remove"
            ? renderedLines[index - 1]
            : undefined;
      const diffLine = h.div(
        [
          h.Key(`${index}-${line.kind}`),
          h.Class(
            `diff-line line-${line.kind}${
              isInMovedRange(
                line.kind === "add" ? line.newNumber : line.oldNumber,
                line.kind === "add" ? moved.new : moved.old,
              )
                ? " line-move"
                : ""
            }${
              isInMovedRange(
                line.kind === "add" ? line.newNumber : line.oldNumber,
                line.kind === "add" ? moved.semanticNew : moved.semanticOld,
              )
                ? " line-semantic"
                : ""
            }`,
          ),
        ],
        [
          h.span([h.Class("line-number old")], [line.oldNumber?.toString() ?? ""]),
          h.span([h.Class("line-number new")], [line.newNumber?.toString() ?? ""]),
          h.span([h.Class("line-marker")], [
            line.kind === "add" ? "+" : line.kind === "remove" ? "−" : "",
          ]),
          h.code(
            [h.Class("line-code")],
            codeContent(line, paired, characterDiff, interaction, h),
          ),
        ],
      );
      return [
        diffLine,
        ...inlineReviewThreads(
          interaction.path,
          line.oldNumber,
          line.newNumber,
          interaction.reviews,
          h,
        ),
      ];
    }),
  );

type SplitRow = Readonly<{ left?: DiffLine; right?: DiffLine }>;

const splitRows = (lines: ReadonlyArray<DiffLine>): ReadonlyArray<SplitRow> => {
  const rows: Array<SplitRow> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) continue;
    const next = lines[index + 1];
    if (line.kind === "remove" && next?.kind === "add") {
      rows.push({ left: line, right: next });
      index += 1;
    } else if (line.kind === "remove") {
      rows.push({ left: line });
    } else if (line.kind === "add") {
      rows.push({ right: line });
    } else {
      rows.push({ left: line, right: line });
    }
  }
  return rows;
};

const splitCell = (
  line: DiffLine | undefined,
  paired: DiffLine | undefined,
  side: "left" | "right",
  characterDiff: boolean,
  moved: MovedRanges,
  interaction: DiffInteraction,
  h: HtmlBuilder<Message>,
) => {
  if (line === undefined) {
    return h.div([h.Class(`split-cell ${side} empty-cell`)], [""]);
  }
  return h.div(
    [
      h.Class(
        `split-cell ${side} line-${line.kind}${
          isInMovedRange(
            side === "left" ? line.oldNumber : line.newNumber,
            side === "left" ? moved.old : moved.new,
          )
            ? " line-move"
            : ""
        }${
          isInMovedRange(
            side === "left" ? line.oldNumber : line.newNumber,
            side === "left" ? moved.semanticOld : moved.semanticNew,
          )
            ? " line-semantic"
            : ""
        }`,
      ),
    ],
    [
      h.span([h.Class("line-number")], [
        (side === "left" ? line.oldNumber : line.newNumber)?.toString() ?? "",
      ]),
      h.span([h.Class("line-marker")], [
        line.kind === "add" ? "+" : line.kind === "remove" ? "−" : "",
      ]),
      h.code(
        [h.Class("line-code")],
        codeContent(line, paired, characterDiff, interaction, h),
      ),
    ],
  );
};

export const splitDiffView = (
  lines: ReadonlyArray<DiffLine>,
  characterDiff: boolean,
  moved: MovedRanges,
  interaction: DiffInteraction,
  h: HtmlBuilder<Message>,
) =>
  h.div(
    [h.Class("diff-lines split-lines")],
    splitRows(visibleLines(lines, interaction)).flatMap((row, index) => {
      if (row.left?.kind === "hunk") return [hunkHeader(row.left, interaction, h)];
      const splitRow = h.div(
        [h.Key(`split-${index}`), h.Class("split-row")],
        [
          splitCell(
            row.left,
            row.right?.kind === "add" ? row.right : undefined,
            "left",
            characterDiff,
            moved,
            interaction,
            h,
          ),
          splitCell(
            row.right,
            row.left?.kind === "remove" ? row.left : undefined,
            "right",
            characterDiff,
            moved,
            interaction,
            h,
          ),
        ],
      );
      return [
        splitRow,
        ...inlineReviewThreads(
          interaction.path,
          row.left?.oldNumber ?? null,
          row.right?.newNumber ?? null,
          interaction.reviews,
          h,
        ),
      ];
    }),
  );
