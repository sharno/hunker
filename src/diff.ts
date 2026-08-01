import { FileChange } from "./domain";
import type { FileChange as FileChangeType } from "./domain";

export type DiffLine = Readonly<{
  kind: "add" | "remove" | "context" | "hunk";
  content: string;
  oldNumber: number | null;
  newNumber: number | null;
}>;

export const normalizeLine = (line: string) =>
  line.replace(/^[-+ ]/, "").replace(/\s+/g, "").trim();

const semanticInsight = (
  patch: string,
  status: FileChangeType["status"],
  previousPath: string,
): string => {
  if (status === "renamed") return `Renamed from ${previousPath}`;
  if (status === "added") return "New behavior introduced";
  if (status === "deleted") return "Dead path removed";

  const lines = patch.split("\n");
  const removed = lines.filter(line => line.startsWith("-")).map(normalizeLine);
  const added = lines.filter(line => line.startsWith("+")).map(normalizeLine);
  const moved = removed.filter(line => line.length > 12 && added.includes(line));
  if (moved.length >= 2) return `${moved.length} unchanged lines moved`;

  const removedSymbol = patch.match(
    /^-\s*(?:export\s+)?(?:const|function|class|interface|type)\s+(\w+)/m,
  )?.[1];
  const addedSymbol = patch.match(
    /^\+\s*(?:export\s+)?(?:const|function|class|interface|type)\s+(\w+)/m,
  )?.[1];
  if (
    removedSymbol !== undefined &&
    addedSymbol !== undefined &&
    removedSymbol !== addedSymbol
  ) {
    return `${removedSymbol} renamed to ${addedSymbol}`;
  }
  if (/^\+.*(?:test|describe|expect)\(/m.test(patch)) return "Coverage added";
  return "Behavior changed";
};

export const parseGitDiff = (diff: string): ReadonlyArray<FileChangeType> => {
  const chunks = diff.split(/^diff --git /m).filter(Boolean);
  return chunks.map(chunk => {
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
      line => line.startsWith("+") && !line.startsWith("+++"),
    ).length;
    const deletions = lines.filter(
      line => line.startsWith("-") && !line.startsWith("---"),
    ).length;
    return FileChange.make({
      path,
      previousPath: renameFrom,
      status,
      additions,
      deletions,
      patch,
      insight: semanticInsight(patch, status, renameFrom),
    });
  });
};

export const toDiffLines = (
  patch: string,
  ignoreWhitespace: boolean,
): ReadonlyArray<DiffLine> => {
  const raw = patch.split("\n");
  const result: Array<DiffLine> = [];
  let oldNumber = 0;
  let newNumber = 0;

  for (let index = 0; index < raw.length; index += 1) {
    const line = raw[index] ?? "";
    if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);
      oldNumber = Number(match?.[1] ?? 0);
      newNumber = Number(match?.[2] ?? 0);
      result.push({ kind: "hunk", content: line, oldNumber: null, newNumber: null });
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
      result.push({ kind: "add", content: line.slice(1), oldNumber: null, newNumber });
      newNumber += 1;
    } else if (line.startsWith("-")) {
      result.push({ kind: "remove", content: line.slice(1), oldNumber, newNumber: null });
      oldNumber += 1;
    } else {
      result.push({
        kind: "context",
        content: line.startsWith(" ") ? line.slice(1) : line,
        oldNumber,
        newNumber,
      });
      oldNumber += 1;
      newNumber += 1;
    }
  }
  return result;
};
