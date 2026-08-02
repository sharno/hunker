import { createHash } from "node:crypto";

import { Context, Data, Effect, FileSystem, Layer, Path, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  CharacterDiffResult,
  type CharacterDiffRow,
  type CharacterRange,
} from "../src/domain";

export type CharacterDiffInput = Readonly<{
  path: string;
  oldText: string;
  newText: string;
  ignoreWhitespace: boolean;
  mode: "token" | "character";
}>;

type CharacterDiffEngineShape = Readonly<{
  analyzeFile: (
    input: CharacterDiffInput,
  ) => Effect.Effect<CharacterDiffResult, CharacterDiffFailed>;
}>;

export class CharacterDiffFailed extends Data.TaggedError(
  "CharacterDiffFailed",
)<{
  readonly message: string;
  readonly status: number;
}> {}

export class CharacterDiffEngine extends Context.Service<
  CharacterDiffEngine,
  CharacterDiffEngineShape
>()("hunker/CharacterDiffEngine") {}

type LineBuilder = {
  oldPresent: boolean;
  newPresent: boolean;
  oldOffset: number;
  newOffset: number;
  oldRanges: Array<CharacterRange>;
  newRanges: Array<CharacterRange>;
};

const emptyBuilder = (): LineBuilder => ({
  oldPresent: false,
  newPresent: false,
  oldOffset: 0,
  newOffset: 0,
  oldRanges: [],
  newRanges: [],
});

const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export const parseGitCharacterDiff = (
  output: string,
  path: string,
  ignoreWhitespace: boolean,
  mode: "token" | "character",
): CharacterDiffResult => {
  const rows: Array<CharacterDiffRow> = [];
  let oldLine = 0;
  let newLine = 0;
  let oldRemaining = 0;
  let newRemaining = 0;
  let inHunk = false;
  let builder = emptyBuilder();

  const flush = () => {
    if (!inHunk) return;
    const oldPresent =
      builder.oldPresent || (!builder.newPresent && oldRemaining > 0);
    const newPresent =
      builder.newPresent || (!builder.oldPresent && newRemaining > 0);
    if (!oldPresent && !newPresent) return;
    rows.push({
      oldLine: oldPresent ? oldLine : null,
      newLine: newPresent ? newLine : null,
      oldRanges: builder.oldRanges,
      newRanges: builder.newRanges,
    });
    if (oldPresent) {
      oldLine += 1;
      oldRemaining = Math.max(0, oldRemaining - 1);
    }
    if (newPresent) {
      newLine += 1;
      newRemaining = Math.max(0, newRemaining - 1);
    }
    builder = emptyBuilder();
  };

  for (const line of output.split("\n")) {
    const header = hunkHeader.exec(line);
    if (header !== null) {
      flush();
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
      oldRemaining = Number(header[2] ?? "1");
      newRemaining = Number(header[4] ?? "1");
      inHunk = true;
      builder = emptyBuilder();
      continue;
    }
    if (!inHunk) continue;
    if (line === "~") {
      flush();
      continue;
    }
    const marker = line[0];
    if (marker !== " " && marker !== "+" && marker !== "-") continue;
    const value = line.slice(1);
    const markRange = !ignoreWhitespace || value.trim() !== "";
    if (marker === " " || marker === "-") {
      builder.oldPresent = true;
      if (marker === "-" && markRange && value.length > 0) {
        builder.oldRanges.push({
          start: builder.oldOffset,
          end: builder.oldOffset + value.length,
        });
      }
      builder.oldOffset += value.length;
    }
    if (marker === " " || marker === "+") {
      builder.newPresent = true;
      if (marker === "+" && markRange && value.length > 0) {
        builder.newRanges.push({
          start: builder.newOffset,
          end: builder.newOffset + value.length,
        });
      }
      builder.newOffset += value.length;
    }
  }
  flush();
  return CharacterDiffResult.make({ path, ignoreWhitespace, mode, rows });
};

const contentHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const cacheKey = (input: CharacterDiffInput) =>
  `${input.path}\u0000${input.mode}\u0000${input.ignoreWhitespace ? "ignore" : "show"}\u0000${contentHash(input.oldText)}\u0000${contentHash(input.newText)}`;

export const layer = Layer.effect(
  CharacterDiffEngine,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const cache = new Map<string, CharacterDiffResult>();

    const execute = (input: CharacterDiffInput) =>
      Effect.scoped(
        Effect.gen(function* () {
          const directory = yield* fs.makeTempDirectoryScoped({
            prefix: "hunker-git-diff-",
          });
          const extension = paths.extname(input.path);
          const oldPath = paths.join(directory, `old${extension}`);
          const newPath = paths.join(directory, `new${extension}`);
          yield* Effect.all([
            fs.writeFileString(oldPath, input.oldText),
            fs.writeFileString(newPath, input.newText),
          ]);
          const arguments_ = [
            "diff",
            "--no-index",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "--text",
            "--unified=0",
            "--diff-algorithm=histogram",
            "--word-diff=porcelain",
            input.mode === "character"
              ? "--word-diff-regex=."
              : "--word-diff-regex=[[:alnum:]_]+|[^[:space:]]",
            ...(input.ignoreWhitespace ? ["--ignore-all-space"] : []),
            "--",
            oldPath,
            newPath,
          ];
          const handle = yield* spawner.spawn(
            ChildProcess.make("git", arguments_),
          );
          const [stdout, stderr, exitCode] = yield* Effect.all(
            [
              handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
              handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
              handle.exitCode,
            ],
            { concurrency: "unbounded" },
          );
          const status = Number(exitCode);
          if (status !== 0 && status !== 1) {
            return yield* new CharacterDiffFailed({
              message:
                stderr.trim() ||
                `Native Git diff exited with status ${status}.`,
              status: 502,
            });
          }
          return parseGitCharacterDiff(
            stdout,
            input.path,
            input.ignoreWhitespace,
            input.mode,
          );
        }),
      ).pipe(
        Effect.timeoutOrElse({
          duration: "3 seconds",
          orElse: () =>
            Effect.fail(
              new CharacterDiffFailed({
                message:
                  "Native Git character analysis exceeded three seconds.",
                status: 503,
              }),
            ),
        }),
        Effect.mapError((error) =>
          error instanceof CharacterDiffFailed
            ? error
            : new CharacterDiffFailed({
                message:
                  "Native Git could not calculate this file's character diff.",
                status: 502,
              }),
        ),
      );

    return CharacterDiffEngine.of({
      analyzeFile: (input) => {
        const key = cacheKey(input);
        const cached = cache.get(key);
        if (cached !== undefined) return Effect.succeed(cached);
        return execute(input).pipe(
          Effect.tap((result) => Effect.sync(() => cache.set(key, result))),
        );
      },
    });
  }),
);
