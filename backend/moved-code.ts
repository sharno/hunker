import { Data, Effect, FileSystem } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { MovedBlock } from "../src/domain";
import type { FileDescriptor } from "./github";

export type FilePair = FileDescriptor &
  Readonly<{
    oldText: string;
    newText: string;
  }>;

export class MoveDetectionFailed extends Data.TaggedError("MoveDetectionFailed")<{
  readonly message: string;
  readonly status: number;
}> {}

type MovedLine = Readonly<{
  side: "old" | "new";
  fileIndex: number;
  line: number;
  content: string;
}>;

type MovedGroup = Readonly<{
  side: "old" | "new";
  fileIndex: number;
  line: number;
  lines: ReadonlyArray<string>;
}>;

const suffixFor = (path: string) => {
  const filename = path.split("/").at(-1) ?? path;
  const extensionIndex = filename.lastIndexOf(".");
  return extensionIndex > 0 ? filename.slice(extensionIndex) : ".txt";
};

const stripAnsi = (value: string) => value.replace(/\u001b\[[0-9;]*m/g, "");
const isOldMoved = (value: string) => /\u001b\[[0-9;]*33m/.test(value);
const isNewMoved = (value: string) => /\u001b\[[0-9;]*34m/.test(value);

const movedLinesFromGit = (output: string): ReadonlyArray<MovedLine> => {
  const result: Array<MovedLine> = [];
  let fileIndex = -1;
  let oldLine = 0;
  let newLine = 0;

  for (const rawLine of output.split("\n")) {
    const line = stripAnsi(rawLine);
    if (line.startsWith("diff --git ")) {
      const match = line.match(/\/before\/(\d{5})(?:\.[^ ]+)?\s/);
      fileIndex = Number(match?.[1] ?? -1);
      continue;
    }
    if (line.startsWith("@@")) {
      const hunk = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);
      oldLine = Number(hunk?.[1] ?? 0);
      newLine = Number(hunk?.[2] ?? 0);
      continue;
    }
    if (fileIndex < 0) continue;
    if (line.startsWith("-") && !line.startsWith("---")) {
      if (isOldMoved(rawLine)) {
        result.push({ side: "old", fileIndex, line: oldLine, content: line.slice(1) });
      }
      oldLine += 1;
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      if (isNewMoved(rawLine)) {
        result.push({ side: "new", fileIndex, line: newLine, content: line.slice(1) });
      }
      newLine += 1;
      continue;
    }
    if (line.startsWith(" ")) {
      oldLine += 1;
      newLine += 1;
    }
  }
  return result;
};

const groupMovedLines = (lines: ReadonlyArray<MovedLine>): ReadonlyArray<MovedGroup> => {
  const groups: Array<MovedGroup> = [];
  for (const line of lines) {
    const previous = groups.at(-1);
    if (
      previous !== undefined &&
      previous.side === line.side &&
      previous.fileIndex === line.fileIndex &&
      previous.line + previous.lines.length === line.line
    ) {
      groups[groups.length - 1] = { ...previous, lines: [...previous.lines, line.content] };
    } else {
      groups.push({
        side: line.side,
        fileIndex: line.fileIndex,
        line: line.line,
        lines: [line.content],
      });
    }
  }
  return groups.flatMap(group => {
    const leading = group.lines.findIndex(line => line.trim() !== "");
    if (leading < 0) return [];
    let trailing = group.lines.length;
    while (trailing > leading && group.lines[trailing - 1]?.trim() === "") {
      trailing -= 1;
    }
    return [
      {
        ...group,
        line: group.line + leading,
        lines: group.lines.slice(leading, trailing),
      },
    ];
  });
};

const groupKey = (group: MovedGroup) =>
  group.lines.map(line => line.replace(/\s+/g, "")).join("\n");

const pairMovedGroups = (
  groups: ReadonlyArray<MovedGroup>,
  files: ReadonlyArray<FilePair>,
) => {
  const additions = new Map<string, Array<MovedGroup>>();
  for (const group of groups) {
    if (group.side !== "new") continue;
    const key = groupKey(group);
    additions.set(key, [...(additions.get(key) ?? []), group]);
  }

  const moves: Array<MovedBlock> = [];
  for (const source of groups) {
    if (source.side !== "old") continue;
    if (source.lines.length < 2) continue;
    const key = groupKey(source);
    if ((key.match(/[\p{L}\p{N}]/gu) ?? []).length < 20) continue;
    const destination = additions.get(key)?.shift();
    const sourceFile = files[source.fileIndex];
    const destinationFile =
      destination === undefined ? undefined : files[destination.fileIndex];
    if (destination === undefined || sourceFile === undefined || destinationFile === undefined) {
      continue;
    }
    moves.push(
      MovedBlock.make({
        fromPath:
          sourceFile.status === "renamed" && sourceFile.previousPath !== ""
            ? sourceFile.previousPath
            : sourceFile.path,
        toPath: destinationFile.path,
        fromLine: source.line,
        toLine: destination.line,
        lineCount: source.lines.length,
        preview: source.lines.find(line => line.trim() !== "")?.trim().slice(0, 100) ?? "",
      }),
    );
  }
  return moves;
};

export const runMovedCodeDetection = (files: ReadonlyArray<FilePair>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "hunker-moves-" });
    const before = `${directory}/before`;
    const after = `${directory}/after`;
    yield* fs.makeDirectory(before);
    yield* fs.makeDirectory(after);

    yield* Effect.forEach(files, (file, index) => {
      const filename = `${String(index).padStart(5, "0")}${suffixFor(file.path)}`;
      return Effect.all([
        fs.writeFileString(`${before}/${filename}`, file.oldText),
        fs.writeFileString(`${after}/${filename}`, file.newText),
      ]);
    });

    const command = ChildProcess.make("git", [
      "-c",
      "color.diff.oldMoved=yellow",
      "-c",
      "color.diff.newMoved=blue",
      "diff",
      "--no-index",
      "--no-renames",
      "--color=always",
      "--color-moved=blocks",
      "--color-moved-ws=ignore-all-space",
      before,
      after,
    ]);
    const output = yield* spawner.string(command).pipe(
      Effect.mapError(
        () =>
          new MoveDetectionFailed({
            message: "Git moved-code detection could not run.",
            status: 503,
          }),
      ),
    );
    return pairMovedGroups(groupMovedLines(movedLinesFromGit(output)), files);
  }).pipe(Effect.scoped);
