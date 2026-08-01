import type { Html, HtmlBuilder } from "foldkit/html";

import type { Message, SemanticChange } from "../domain";
import type { DiffLine } from "../diff";
import type { SemanticLine, SemanticRow } from "../semantic";

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
        [h.Key(`${index}-${line.kind}`), h.Class(`diff-line line-${line.kind}`)],
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
  h: HtmlBuilder<Message>,
) => {
  if (line === undefined) {
    return h.div([h.Class(`split-cell ${side} empty-cell`)], [""]);
  }
  return h.div(
    [h.Class(`split-cell ${side} line-${line.kind}`)],
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
            h,
          ),
          splitCell(
            row.right,
            row.left?.kind === "remove" ? row.left : undefined,
            "right",
            characterDiff,
            h,
          ),
        ],
      ),
    ),
  );

const semanticCodeContent = (
  content: string,
  changes: ReadonlyArray<SemanticChange>,
  characterDiff: boolean,
  h: HtmlBuilder<Message>,
): ReadonlyArray<string | Html> => {
  if (!characterDiff || changes.length === 0) return [content || " "];
  const nodes: Array<string | Html> = [];
  let cursor = 0;
  for (const change of [...changes].sort((left, right) => left.start - right.start)) {
    const start = Math.max(cursor, Math.min(content.length, change.start));
    const end = Math.max(start, Math.min(content.length, change.end));
    if (start > cursor) nodes.push(content.slice(cursor, start));
    if (end > start) {
      nodes.push(h.span([h.Class("char-change")], [content.slice(start, end)]));
    }
    cursor = end;
  }
  if (cursor < content.length) nodes.push(content.slice(cursor));
  return nodes.length === 0 ? [content || " "] : nodes;
};

const semanticUnifiedLine = (
  line: SemanticLine,
  side: "old" | "new",
  characterDiff: boolean,
  key: string,
  h: HtmlBuilder<Message>,
) => {
  const isOld = side === "old";
  const kind = line.kind === "context" ? "context" : isOld ? "remove" : "add";
  const content = isOld ? line.oldContent : line.newContent;
  const changes = isOld ? line.oldChanges : line.newChanges;
  return h.div([h.Key(key), h.Class(`diff-line line-${kind}`)], [
    h.span([h.Class("line-number old")], [
      line.oldNumber === null ? "" : String(line.oldNumber + 1),
    ]),
    h.span([h.Class("line-number new")], [
      line.newNumber === null ? "" : String(line.newNumber + 1),
    ]),
    h.span([h.Class("line-marker")], [
      kind === "add" ? "+" : kind === "remove" ? "−" : "",
    ]),
    h.code([h.Class("line-code")], semanticCodeContent(content, changes, characterDiff, h)),
  ]);
};

export const semanticUnifiedDiffView = (
  rows: ReadonlyArray<SemanticRow>,
  characterDiff: boolean,
  h: HtmlBuilder<Message>,
) =>
  h.div(
    [h.Class("diff-lines unified-lines semantic-lines")],
    rows.flatMap((row, index): ReadonlyArray<Html> => {
      if (row._tag === "Gap") {
        return [
          h.div([h.Key(`gap-${index}`), h.Class("semantic-gap")], [
            `⋯ ${row.count} unchanged ${row.count === 1 ? "line" : "lines"}`,
          ]),
        ];
      }
      if (row.kind === "change") {
        return [
          semanticUnifiedLine(row, "old", characterDiff, `${index}-old`, h),
          semanticUnifiedLine(row, "new", characterDiff, `${index}-new`, h),
        ];
      }
      return [
        semanticUnifiedLine(
          row,
          row.kind === "add" ? "new" : "old",
          characterDiff,
          `${index}-${row.kind}`,
          h,
        ),
      ];
    }),
  );

const semanticSplitCell = (
  line: SemanticLine,
  side: "old" | "new",
  characterDiff: boolean,
  h: HtmlBuilder<Message>,
) => {
  const isOld = side === "old";
  const absent = isOld ? line.oldNumber === null : line.newNumber === null;
  if (absent) return h.div([h.Class(`split-cell ${isOld ? "left" : "right"} empty-cell`)], []);
  const kind = line.kind === "context" ? "context" : isOld ? "remove" : "add";
  const content = isOld ? line.oldContent : line.newContent;
  const changes = isOld ? line.oldChanges : line.newChanges;
  const number = isOld ? line.oldNumber : line.newNumber;
  return h.div([h.Class(`split-cell ${isOld ? "left" : "right"} line-${kind}`)], [
    h.span([h.Class("line-number")], [number === null ? "" : String(number + 1)]),
    h.span([h.Class("line-marker")], [kind === "add" ? "+" : kind === "remove" ? "−" : ""]),
    h.code([h.Class("line-code")], semanticCodeContent(content, changes, characterDiff, h)),
  ]);
};

export const semanticSplitDiffView = (
  rows: ReadonlyArray<SemanticRow>,
  characterDiff: boolean,
  h: HtmlBuilder<Message>,
) =>
  h.div(
    [h.Class("diff-lines split-lines semantic-lines")],
    rows.map((row, index) =>
      row._tag === "Gap"
        ? h.div([h.Key(`gap-${index}`), h.Class("semantic-gap")], [
            `⋯ ${row.count} unchanged ${row.count === 1 ? "line" : "lines"}`,
          ])
        : h.div([h.Key(`semantic-${index}`), h.Class("split-row")], [
            semanticSplitCell(row, "old", characterDiff, h),
            semanticSplitCell(row, "new", characterDiff, h),
          ]),
    ),
  );
