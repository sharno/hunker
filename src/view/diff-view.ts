import type { Html, HtmlBuilder } from "foldkit/html";

import { button } from "./control";
import {
  GotInlineCommentMessage,
  SelectedSemanticMoveTarget,
  ToggledHunkCollapse,
} from "../domain";
import type { CharacterDiffRow, CharacterRange, Message } from "../domain";
import { hunkKey } from "../diff";
import type { DiffLine, HunkDiffLine } from "../diff";
import * as InlineComment from "../features/inline-comment";
import { inlineReviewThreads } from "./github-review-view";
import type { GitHubReviewInteraction } from "./github-review-view";
import { syntaxHighlightedContent } from "./syntax-highlight";

export type MovedRanges = Readonly<{
  moves: ReadonlyArray<SemanticMoveDecoration>;
  semanticOld: ReadonlyArray<Readonly<{ start: number; count: number }>>;
  semanticNew: ReadonlyArray<Readonly<{ start: number; count: number }>>;
}>;

export type SemanticMoveDecoration = Readonly<{
  anchor: string;
  targetAnchor: string;
  targetPath: string;
  targetLine: number;
  side: "old" | "new";
  start: number;
  count: number;
  label: string;
  changed: boolean;
  tone: number;
}>;

export type DiffInteraction = Readonly<{
  path: string;
  collapsedHunks: ReadonlyArray<string>;
  syntaxHighlighting: boolean;
  characterRows: ReadonlyArray<CharacterDiffRow>;
  reviews: GitHubReviewInteraction;
  inlineComment: Readonly<{
    model: InlineComment.ModelType;
    pullUrl: string;
    commitId: string;
    enabled: boolean;
  }>;
}>;

const inlineTarget = (
  line: DiffLine | undefined,
  side: "LEFT" | "RIGHT",
  interaction: DiffInteraction,
): InlineComment.TargetType | undefined => {
  if (
    !interaction.inlineComment.enabled ||
    interaction.inlineComment.pullUrl === "" ||
    interaction.inlineComment.commitId === "" ||
    line === undefined ||
    line.kind === "hunk" ||
    line.hunkId === null
  ) {
    return undefined;
  }
  const number = side === "LEFT" ? line.oldNumber : line.newNumber;
  return number === null
    ? undefined
    : {
        pullUrl: interaction.inlineComment.pullUrl,
        commitId: interaction.inlineComment.commitId,
        path: interaction.path,
        line: number,
        side,
      };
};

const inlineCommentView = (
  target: InlineComment.TargetType,
  mode: "trigger" | "composer",
  slot: string,
  interaction: DiffInteraction,
  h: HtmlBuilder<Message>,
) =>
  h.submodel({
    slotId: `inline-comment-${slot}-${mode}`,
    model: interaction.inlineComment.model,
    view: InlineComment.view,
    viewInputs: { target, mode },
    toParentMessage: (message) => GotInlineCommentMessage({ message }),
  });

const diffLineSlot = (
  layout: "unified" | "split-left" | "split-right",
  path: string,
  line: DiffLine,
) =>
  `${layout}-${encodeURIComponent(path)}-${line.hunkId ?? "full"}-${line.kind}-${line.oldNumber ?? "none"}-${line.newNumber ?? "none"}`;

const isInMovedRange = (
  line: number | null,
  ranges: ReadonlyArray<Readonly<{ start: number; count: number }>>,
) =>
  line !== null &&
  ranges.some(
    (range) => line >= range.start && line < range.start + range.count,
  );

const semanticMoveFor = (
  line: number | null,
  side: "old" | "new",
  moved: MovedRanges,
) =>
  line === null
    ? undefined
    : moved.moves.find(
        (move) =>
          move.side === side &&
          line >= move.start &&
          line < move.start + move.count,
      );

const semanticMoveClasses = (
  move: SemanticMoveDecoration | undefined,
  line: number | null,
) => {
  if (move === undefined || line === null) return "";
  const start = line === move.start ? " move-start" : "";
  const end = line === move.start + move.count - 1 ? " move-end" : "";
  return ` line-move move-tone-${move.tone}${start}${end}`;
};

const semanticMoveBadge = (
  move: SemanticMoveDecoration | undefined,
  line: number | null,
  h: HtmlBuilder<Message>,
): Html => {
  if (move === undefined || line !== move.start) return h.empty;
  const direction = move.side === "old" ? "to" : "from";
  const name = `Show where ${move.label} moved ${direction} ${move.targetPath} line ${move.targetLine}`;
  return button(
    h,
    [
      h.Type("button"),
      h.Class("semantic-move-jump"),
      h.AriaLabel(name),
      h.Title(name),
      h.OnClick(
        SelectedSemanticMoveTarget({
          path: move.targetPath,
          anchor: move.targetAnchor,
        }),
      ),
    ],
    [
      h.span(
        [h.Class("semantic-move-icon")],
        [move.side === "old" ? "↗" : "↙"],
      ),
      h.strong([], [`Moved ${direction}`]),
      h.span([], [`${move.targetPath}:${move.targetLine}`]),
      move.changed
        ? h.span([h.Class("semantic-move-edited")], ["edited"])
        : h.empty,
    ],
  );
};

const characterRangesFor = (
  line: DiffLine,
  rows: ReadonlyArray<CharacterDiffRow>,
): ReadonlyArray<CharacterRange> => {
  if (line.kind === "hunk" || line.kind === "context") return [];
  const lineNumber = line.kind === "add" ? line.newNumber : line.oldNumber;
  const row = rows.find((candidate) =>
    line.kind === "add"
      ? candidate.newLine === lineNumber
      : candidate.oldLine === lineNumber,
  );
  return line.kind === "add" ? (row?.newRanges ?? []) : (row?.oldRanges ?? []);
};

const codeContent = (
  line: DiffLine,
  characterDiff: boolean,
  interaction: DiffInteraction,
  h: HtmlBuilder<Message>,
): ReadonlyArray<string | Html> => {
  if (!characterDiff || line.kind === "context" || line.kind === "hunk") {
    return syntaxHighlightedContent(
      interaction.path,
      line.content,
      interaction.syntaxHighlighting,
      [],
      h,
    );
  }
  return syntaxHighlightedContent(
    interaction.path,
    line.content,
    interaction.syntaxHighlighting,
    characterRangesFor(line, interaction.characterRows),
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
    (line) =>
      line.kind === "hunk" ||
      line.hunkId === null ||
      !isCollapsedHunk(line, interaction),
  );

const hunkHeader = (
  line: HunkDiffLine,
  interaction: DiffInteraction,
  h: HtmlBuilder<Message>,
) => {
  const collapsed = isCollapsedHunk(line, interaction);
  return h.div(
    [
      h.Key(`${interaction.path}-${line.hunkId}`),
      h.Class("diff-line line-hunk"),
    ],
    [
      h.span([h.Class("line-number old")], [""]),
      h.span([h.Class("line-number new")], [""]),
      h.span([h.Class("line-marker")], [""]),
      button(
        h,
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
          collapsed
            ? h.span([h.Class("collapsed-label")], ["hunk collapsed"])
            : h.empty,
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
    visibleLines(lines, interaction).flatMap((line, index) => {
      if (line.kind === "hunk") return [hunkHeader(line, interaction, h)];
      const target = inlineTarget(
        line,
        line.kind === "remove" ? "LEFT" : "RIGHT",
        interaction,
      );
      const moveSide = line.kind === "add" ? "new" : "old";
      const moveLine = moveSide === "new" ? line.newNumber : line.oldNumber;
      const semanticMove = semanticMoveFor(moveLine, moveSide, moved);
      const slot = diffLineSlot("unified", interaction.path, line);
      const diffLine = h.div(
        [
          h.Key(`${index}-${line.kind}`),
          ...(semanticMove !== undefined && moveLine === semanticMove.start
            ? [h.Id(semanticMove.anchor)]
            : []),
          h.Class(
            `diff-line line-${line.kind}${semanticMoveClasses(semanticMove, moveLine)}${
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
          h.span(
            [h.Class("line-number old")],
            [line.oldNumber?.toString() ?? ""],
          ),
          h.span(
            [h.Class("line-number new")],
            [line.newNumber?.toString() ?? ""],
          ),
          h.span(
            [h.Class("line-marker")],
            [
              line.kind === "add" ? "+" : line.kind === "remove" ? "−" : "",
              target === undefined
                ? h.empty
                : inlineCommentView(target, "trigger", slot, interaction, h),
            ],
          ),
          h.code(
            [h.Class("line-code")],
            [
              semanticMoveBadge(semanticMove, moveLine, h),
              ...codeContent(line, characterDiff, interaction, h),
            ],
          ),
        ],
      );
      return [
        diffLine,
        ...(target === undefined
          ? []
          : [inlineCommentView(target, "composer", slot, interaction, h)]),
      ].concat(
        inlineReviewThreads(
          interaction.path,
          line.oldNumber,
          line.newNumber,
          interaction.reviews,
          h,
        ),
      );
    }),
  );

type SplitRow = Readonly<{ left?: DiffLine; right?: DiffLine }>;

// NOTE: Alignment uses function-local scratch buffers for a linear pass; the
// returned rows are fresh values and no mutation reaches the view or Model.
const splitRows = (
  lines: ReadonlyArray<DiffLine>,
  characterRows: ReadonlyArray<CharacterDiffRow>,
): ReadonlyArray<SplitRow> => {
  const rows: Array<SplitRow> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) continue;
    if (line.kind !== "remove" && line.kind !== "add") {
      rows.push({ left: line, right: line });
      continue;
    }

    const block: Array<DiffLine> = [];
    while (index < lines.length) {
      const candidate = lines[index];
      if (candidate?.kind !== "remove" && candidate?.kind !== "add") break;
      block.push(candidate);
      index += 1;
    }
    index -= 1;
    const oldLines = new Map(
      block.flatMap((candidate) =>
        candidate.kind === "remove" && candidate.oldNumber !== null
          ? [[candidate.oldNumber, candidate] as const]
          : [],
      ),
    );
    const newLines = new Map(
      block.flatMap((candidate) =>
        candidate.kind === "add" && candidate.newNumber !== null
          ? [[candidate.newNumber, candidate] as const]
          : [],
      ),
    );
    const consumedOld = new Set<number>();
    const consumedNew = new Set<number>();
    for (const pairing of characterRows) {
      const left =
        pairing.oldLine === null || consumedOld.has(pairing.oldLine)
          ? undefined
          : oldLines.get(pairing.oldLine);
      const right =
        pairing.newLine === null || consumedNew.has(pairing.newLine)
          ? undefined
          : newLines.get(pairing.newLine);
      if (left === undefined && right === undefined) continue;
      rows.push({ left, right });
      if (left !== undefined && pairing.oldLine !== null) {
        consumedOld.add(pairing.oldLine);
      }
      if (right !== undefined && pairing.newLine !== null) {
        consumedNew.add(pairing.newLine);
      }
    }
    const remainingOld = block.filter(
      (candidate) =>
        candidate.kind === "remove" &&
        candidate.oldNumber !== null &&
        !consumedOld.has(candidate.oldNumber),
    );
    const remainingNew = block.filter(
      (candidate) =>
        candidate.kind === "add" &&
        candidate.newNumber !== null &&
        !consumedNew.has(candidate.newNumber),
    );
    for (
      let remainder = 0;
      remainder < Math.max(remainingOld.length, remainingNew.length);
      remainder += 1
    ) {
      rows.push({
        left: remainingOld[remainder],
        right: remainingNew[remainder],
      });
    }
  }
  return rows;
};

const splitCell = (
  line: DiffLine | undefined,
  side: "left" | "right",
  characterDiff: boolean,
  moved: MovedRanges,
  interaction: DiffInteraction,
  h: HtmlBuilder<Message>,
) => {
  if (line === undefined) {
    return h.div([h.Class(`split-cell ${side} empty-cell`)], [""]);
  }
  const target = inlineTarget(
    line,
    side === "left" ? "LEFT" : "RIGHT",
    interaction,
  );
  const moveSide = side === "left" ? "old" : "new";
  const moveLine = moveSide === "old" ? line.oldNumber : line.newNumber;
  const semanticMove = semanticMoveFor(moveLine, moveSide, moved);
  const slot = diffLineSlot(
    side === "left" ? "split-left" : "split-right",
    interaction.path,
    line,
  );
  return h.div(
    [
      ...(semanticMove !== undefined && moveLine === semanticMove.start
        ? [h.Id(semanticMove.anchor)]
        : []),
      h.Class(
        `split-cell ${side} line-${line.kind}${semanticMoveClasses(semanticMove, moveLine)}${
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
      h.span(
        [h.Class("line-number")],
        [(side === "left" ? line.oldNumber : line.newNumber)?.toString() ?? ""],
      ),
      h.span(
        [h.Class("line-marker")],
        [
          line.kind === "add" ? "+" : line.kind === "remove" ? "−" : "",
          target === undefined
            ? h.empty
            : inlineCommentView(target, "trigger", slot, interaction, h),
        ],
      ),
      h.code(
        [h.Class("line-code")],
        [
          semanticMoveBadge(semanticMove, moveLine, h),
          ...codeContent(line, characterDiff, interaction, h),
        ],
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
    splitRows(
      visibleLines(lines, interaction),
      interaction.characterRows,
    ).flatMap((row, index) => {
      if (row.left?.kind === "hunk") {
        return [hunkHeader(row.left, interaction, h)];
      }
      const splitRow = h.div(
        [h.Key(`split-${index}`), h.Class("split-row")],
        [
          splitCell(row.left, "left", characterDiff, moved, interaction, h),
          splitCell(row.right, "right", characterDiff, moved, interaction, h),
        ],
      );
      const leftTarget = inlineTarget(row.left, "LEFT", interaction);
      const rightTarget = inlineTarget(row.right, "RIGHT", interaction);
      const leftSlot =
        row.left === undefined
          ? undefined
          : diffLineSlot("split-left", interaction.path, row.left);
      const rightSlot =
        row.right === undefined
          ? undefined
          : diffLineSlot("split-right", interaction.path, row.right);
      return [
        splitRow,
        ...(leftTarget === undefined || leftSlot === undefined
          ? []
          : [
              inlineCommentView(
                leftTarget,
                "composer",
                leftSlot,
                interaction,
                h,
              ),
            ]),
        ...(rightTarget === undefined || rightSlot === undefined
          ? []
          : [
              inlineCommentView(
                rightTarget,
                "composer",
                rightSlot,
                interaction,
                h,
              ),
            ]),
      ].concat(
        inlineReviewThreads(
          interaction.path,
          row.left?.oldNumber ?? null,
          row.right?.newNumber ?? null,
          interaction.reviews,
          h,
        ),
      );
    }),
  );
