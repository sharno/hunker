import { FileChange } from "./domain";
import type { FileChange as FileChangeType } from "./domain";

type ContentDiffLine = Readonly<{
  kind: "add" | "remove" | "context";
  content: string;
  oldNumber: number | null;
  newNumber: number | null;
  hunkId: string | null;
}>;

export type HunkDiffLine = Readonly<{
  kind: "hunk";
  content: string;
  oldNumber: null;
  newNumber: null;
  hunkId: string;
}>;

export type DiffLine = ContentDiffLine | HunkDiffLine;

type HunkRange = Readonly<{
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}>;

export const hunkKey = (path: string, hunkId: string) =>
  `${path}\u0000${hunkId}`;

const hunkRange = (header: string): HunkRange | undefined => {
  const match = header.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  if (match === null) return undefined;
  return {
    oldStart: Number(match[1]),
    oldCount: Number(match[2] ?? 1),
    newStart: Number(match[3]),
    newCount: Number(match[4] ?? 1),
  };
};

export const normalizeLine = (line: string) =>
  line
    .replace(/^[-+ ]/, "")
    .replace(/\s+/g, "")
    .trim();

const GENERATED_DIFF_FILES = new Set([
  "bun.lock",
  "cargo.lock",
  "composer.lock",
  "go.sum",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

export const isGeneratedDiffPath = (path: string) =>
  GENERATED_DIFF_FILES.has(path.split("/").at(-1)?.toLowerCase() ?? "");

export const parseGitDiff = (diff: string): ReadonlyArray<FileChangeType> => {
  const chunks = diff.split(/^diff --git /m).filter(Boolean);
  return chunks.map((chunk) => {
    const header = chunk.match(/^a\/(.+?) b\/(.+)$/m);
    const fallbackPath = header?.[2] ?? "unknown";
    const renameFrom = chunk.match(/^rename from (.+)$/m)?.[1] ?? "";
    const renameTo = chunk.match(/^rename to (.+)$/m)?.[1];
    const path = renameTo ?? fallbackPath;
    const status: FileChangeType["status"] = chunk.includes("new file mode")
      ? "added"
      : chunk.includes("deleted file mode")
        ? "deleted"
        : renameFrom !== ""
          ? "renamed"
          : "modified";
    const patchStart = chunk.indexOf("@@");
    const patch = patchStart >= 0 ? chunk.slice(patchStart) : chunk;
    const lines = patch.split("\n");
    const additions = lines.filter(
      (line) => line.startsWith("+") && !line.startsWith("+++"),
    ).length;
    const deletions = lines.filter(
      (line) => line.startsWith("-") && !line.startsWith("---"),
    ).length;
    return FileChange.make({
      path,
      previousPath: renameFrom,
      status,
      additions,
      deletions,
      patch,
    });
  });
};

// NOTE: This linear parser mutates only function-local cursors and its private
// result buffer; no mutation or identity escapes into the Foldkit Model.
export const toDiffLines = (
  patch: string,
  ignoreWhitespace: boolean,
): ReadonlyArray<DiffLine> => {
  const patchLines = patch.split("\n");
  const raw = patch.endsWith("\n") ? patchLines.slice(0, -1) : patchLines;
  const result: Array<DiffLine> = [];
  let oldNumber = 0;
  let newNumber = 0;
  let currentHunk: string | null = null;
  let hunkIndex = 0;

  for (let index = 0; index < raw.length; index += 1) {
    const line = raw[index] ?? "";
    if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);
      oldNumber = Number(match?.[1] ?? 0);
      newNumber = Number(match?.[2] ?? 0);
      currentHunk = `hunk-${hunkIndex}`;
      hunkIndex += 1;
      result.push({
        kind: "hunk",
        content: line,
        oldNumber: null,
        newNumber: null,
        hunkId: currentHunk,
      });
      continue;
    }

    const next = raw[index + 1];
    if (
      ignoreWhitespace &&
      line.startsWith("-") &&
      next?.startsWith("+") &&
      normalizeLine(line) === normalizeLine(next)
    ) {
      oldNumber += 1;
      newNumber += 1;
      index += 1;
      continue;
    }

    if (line.startsWith("+")) {
      result.push({
        kind: "add",
        content: line.slice(1),
        oldNumber: null,
        newNumber,
        hunkId: currentHunk,
      });
      newNumber += 1;
    } else if (line.startsWith("-")) {
      result.push({
        kind: "remove",
        content: line.slice(1),
        oldNumber,
        newNumber: null,
        hunkId: currentHunk,
      });
      oldNumber += 1;
    } else {
      result.push({
        kind: "context",
        content: line.startsWith(" ") ? line.slice(1) : line,
        oldNumber,
        newNumber,
        hunkId: currentHunk,
      });
      oldNumber += 1;
      newNumber += 1;
    }
  }
  return result;
};

const sourceLines = (text: string): ReadonlyArray<string> => {
  if (text === "") return [];
  const lines = text.split("\n");
  return text.endsWith("\n") ? lines.slice(0, -1) : lines;
};

const unchangedContext = (
  oldLines: ReadonlyArray<string>,
  newLines: ReadonlyArray<string>,
  oldStart: number,
  newStart: number,
  oldEnd: number,
  newEnd: number,
): ReadonlyArray<DiffLine> => {
  const count = Math.min(oldEnd - oldStart, newEnd - newStart);
  return Array.from({ length: Math.max(0, count) }, (_, index) => ({
    kind: "context" as const,
    content:
      newLines[newStart + index - 1] ?? oldLines[oldStart + index - 1] ?? "",
    oldNumber: oldStart + index,
    newNumber: newStart + index,
    hunkId: null,
  }));
};

// NOTE: This merge is a performance-sensitive linear pass over large files;
// all cursor and buffer mutation is confined to this pure helper.
export const toFullDiffLines = (
  patch: string,
  oldText: string,
  newText: string,
  ignoreWhitespace: boolean,
): ReadonlyArray<DiffLine> => {
  const patchLines = toDiffLines(patch, ignoreWhitespace);
  const oldLines = sourceLines(oldText);
  const newLines = sourceLines(newText);
  const result: Array<DiffLine> = [];
  let oldCursor = oldLines.length === 0 ? 0 : 1;
  let newCursor = newLines.length === 0 ? 0 : 1;

  for (let index = 0; index < patchLines.length;) {
    const header = patchLines[index];
    if (header?.kind !== "hunk") {
      index += 1;
      continue;
    }
    const range = hunkRange(header.content);
    if (range === undefined) {
      result.push(header);
      index += 1;
      continue;
    }
    result.push(
      ...unchangedContext(
        oldLines,
        newLines,
        oldCursor,
        newCursor,
        range.oldStart,
        range.newStart,
      ),
      header,
    );
    index += 1;
    while (index < patchLines.length && patchLines[index]?.kind !== "hunk") {
      const line = patchLines[index];
      if (line !== undefined) result.push(line);
      index += 1;
    }
    oldCursor = range.oldStart + range.oldCount;
    newCursor = range.newStart + range.newCount;
  }

  result.push(
    ...unchangedContext(
      oldLines,
      newLines,
      oldCursor,
      newCursor,
      oldLines.length + 1,
      newLines.length + 1,
    ),
  );
  return result;
};
