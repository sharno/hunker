import type { SemanticChange, SemanticResult } from "./domain";
import { normalizeLine } from "./diff";

export type SemanticLine = Readonly<{
  _tag: "Line";
  kind: "add" | "remove" | "change" | "context";
  oldNumber: number | null;
  newNumber: number | null;
  oldContent: string;
  newContent: string;
  oldChanges: ReadonlyArray<SemanticChange>;
  newChanges: ReadonlyArray<SemanticChange>;
}>;

export type SemanticGap = Readonly<{
  _tag: "Gap";
  count: number;
}>;

export type SemanticRow = SemanticLine | SemanticGap;

const changeMaps = (result: SemanticResult) => {
  const oldChanges = new Map<number, ReadonlyArray<SemanticChange>>();
  const newChanges = new Map<number, ReadonlyArray<SemanticChange>>();
  for (const chunk of result.chunks) {
    for (const line of chunk) {
      if (line.lhs !== undefined) oldChanges.set(line.lhs.lineNumber, line.lhs.changes);
      if (line.rhs !== undefined) newChanges.set(line.rhs.lineNumber, line.rhs.changes);
    }
  }
  return { oldChanges, newChanges };
};

const lineAt = (lines: ReadonlyArray<string>, index: number | null) =>
  index === null ? "" : (lines[index] ?? "");

const changedKind = (
  oldNumber: number | null,
  newNumber: number | null,
  changed: boolean,
): SemanticLine["kind"] =>
  oldNumber === null
    ? "add"
    : newNumber === null
      ? "remove"
      : changed
        ? "change"
        : "context";

const contextualize = (
  lines: ReadonlyArray<SemanticLine>,
  context: number,
): ReadonlyArray<SemanticRow> => {
  const changed = lines
    .map((line, index) => (line.kind === "context" ? -1 : index))
    .filter(index => index >= 0);
  if (changed.length === 0) return [];

  const visible = new Set<number>();
  for (const index of changed) {
    const from = Math.max(0, index - context);
    const to = Math.min(lines.length - 1, index + context);
    for (let cursor = from; cursor <= to; cursor += 1) visible.add(cursor);
  }

  const rows: Array<SemanticRow> = [];
  let previous = -1;
  for (const index of [...visible].sort((left, right) => left - right)) {
    if (previous >= 0 && index > previous + 1) {
      rows.push({ _tag: "Gap", count: index - previous - 1 });
    }
    const line = lines[index];
    if (line !== undefined) rows.push(line);
    previous = index;
  }
  return rows;
};

export const toSemanticRows = (
  result: SemanticResult,
  ignoreWhitespace: boolean,
  context = 3,
): ReadonlyArray<SemanticRow> => {
  const oldLines = result.oldText.split("\n");
  const newLines = result.newText.split("\n");
  const maps = changeMaps(result);
  const lines = result.alignedLines.map(([oldNumber, newNumber]) => {
    const oldContent = lineAt(oldLines, oldNumber);
    const newContent = lineAt(newLines, newNumber);
    const structurallyChanged =
      oldNumber === null ||
      newNumber === null ||
      maps.oldChanges.has(oldNumber) ||
      maps.newChanges.has(newNumber);
    const whitespaceOnly =
      oldNumber !== null &&
      newNumber !== null &&
      normalizeLine(oldContent) === normalizeLine(newContent);
    const changed = structurallyChanged && !(ignoreWhitespace && whitespaceOnly);

    return {
      _tag: "Line" as const,
      kind: changedKind(oldNumber, newNumber, changed),
      oldNumber,
      newNumber,
      oldContent,
      newContent,
      oldChanges: changed && oldNumber !== null ? (maps.oldChanges.get(oldNumber) ?? []) : [],
      newChanges: changed && newNumber !== null ? (maps.newChanges.get(newNumber) ?? []) : [],
    };
  });
  return contextualize(lines, context);
};
