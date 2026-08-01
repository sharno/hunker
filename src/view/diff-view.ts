import type { Html, HtmlBuilder } from "foldkit/html";

import type { Message } from "../domain";
import type { DiffLine } from "../diff";

export type MovedRanges = Readonly<{
  old: ReadonlyArray<Readonly<{ start: number; count: number }>>;
  new: ReadonlyArray<Readonly<{ start: number; count: number }>>;
  semanticOld: ReadonlyArray<Readonly<{ start: number; count: number }>>;
  semanticNew: ReadonlyArray<Readonly<{ start: number; count: number }>>;
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
  h: HtmlBuilder<Message>,
): ReadonlyArray<string | Html> => {
  if (
    !characterDiff ||
    paired === undefined ||
    line.kind === "context" ||
    line.kind === "hunk"
  ) {
    return [line.content || " "];
  }
  const prefix = sharedPrefixLength(line.content, paired.content);
  const suffix = sharedSuffixLength(line.content, paired.content, prefix);
  if (prefix + suffix >= line.content.length) return [line.content || " "];
  const end = suffix === 0 ? line.content.length : line.content.length - suffix;
  return [
    line.content.slice(0, prefix),
    h.span([h.Class("char-change")], [line.content.slice(prefix, end)]),
    suffix === 0 ? "" : line.content.slice(-suffix),
  ];
};

export const unifiedDiffView = (
  lines: ReadonlyArray<DiffLine>,
  characterDiff: boolean,
  moved: MovedRanges,
  h: HtmlBuilder<Message>,
) =>
  h.div(
    [h.Class("diff-lines unified-lines")],
    lines.map((line, index) => {
      const paired =
        line.kind === "remove" && lines[index + 1]?.kind === "add"
          ? lines[index + 1]
          : line.kind === "add" && lines[index - 1]?.kind === "remove"
            ? lines[index - 1]
            : undefined;
      return h.div(
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
            codeContent(line, paired, characterDiff, h),
          ),
        ],
      );
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
        codeContent(line, paired, characterDiff, h),
      ),
    ],
  );
};

export const splitDiffView = (
  lines: ReadonlyArray<DiffLine>,
  characterDiff: boolean,
  moved: MovedRanges,
  h: HtmlBuilder<Message>,
) =>
  h.div(
    [h.Class("diff-lines split-lines")],
    splitRows(lines).map((row, index) =>
      h.div(
        [h.Key(`split-${index}`), h.Class("split-row")],
        [
          splitCell(
            row.left,
            row.right?.kind === "add" ? row.right : undefined,
            "left",
            characterDiff,
            moved,
            h,
          ),
          splitCell(
            row.right,
            row.left?.kind === "remove" ? row.left : undefined,
            "right",
            characterDiff,
            moved,
            h,
          ),
        ],
      ),
    ),
  );
