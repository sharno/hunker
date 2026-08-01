import { Data, Effect, FileSystem, Schema as S } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { SemanticResult } from "../src/domain";

const RawChange = S.Struct({
  start: S.Number,
  end: S.Number,
  content: S.String,
  highlight: S.String,
});

const RawSide = S.Struct({
  line_number: S.Number,
  changes: S.Array(RawChange),
});

const RawChunkLine = S.Struct({
  lhs: S.optional(RawSide),
  rhs: S.optional(RawSide),
});

const RawDifftasticResult = S.Struct({
  aligned_lines: S.optional(
    S.Array(S.Tuple([S.NullOr(S.Number), S.NullOr(S.Number)])),
  ),
  chunks: S.optional(S.Array(S.Array(RawChunkLine))),
  language: S.String,
  path: S.String,
  status: S.String,
});

class DifftasticFailed extends Data.TaggedError("DifftasticFailed")<{
  readonly message: string;
  readonly status: number;
}> {}

const suffixFor = (path: string) => {
  const filename = path.split("/").at(-1) ?? path;
  const extensionIndex = filename.lastIndexOf(".");
  return extensionIndex > 0 ? filename.slice(extensionIndex) : ".txt";
};

const parseOutput = (output: string) =>
  Effect.try({
    try: () => JSON.parse(output) as unknown,
    catch: () =>
      new DifftasticFailed({
        message: "Difftastic returned output Hunker could not understand.",
        status: 502,
      }),
  }).pipe(
    Effect.flatMap(S.decodeUnknownEffect(RawDifftasticResult)),
    Effect.mapError(error =>
      error instanceof DifftasticFailed
        ? error
        : new DifftasticFailed({
            message: "Difftastic’s JSON format was not recognized.",
            status: 502,
          }),
    ),
  );

export const runDifftastic = (
  path: string,
  oldText: string,
  newText: string,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "hunker-difft-" });
    const suffix = suffixFor(path);
    const oldPath = `${directory}/before${suffix}`;
    const newPath = `${directory}/after${suffix}`;
    yield* fs.writeFileString(oldPath, oldText);
    yield* fs.writeFileString(newPath, newText);

    const command = ChildProcess.make(
      "difft",
      ["--display", "json", "--color", "never", "--context", "3", oldPath, newPath],
      { env: { DFT_UNSTABLE: "yes" }, extendEnv: true },
    );
    const output = yield* spawner.string(command).pipe(
      Effect.mapError(
        () =>
          new DifftasticFailed({
            message: "Difftastic is not installed. Run `brew install difftastic`.",
            status: 503,
          }),
      ),
    );
    const raw = yield* parseOutput(output);
    const alignedLines =
      raw.aligned_lines ??
      (raw.status === "created"
        ? newText.split("\n").map((_, index) => [null, index] as const)
        : raw.status === "deleted"
          ? oldText.split("\n").map((_, index) => [index, null] as const)
          : []);

    return SemanticResult.make({
      path,
      language: raw.language,
      status: raw.status,
      oldText,
      newText,
      alignedLines,
      chunks: (raw.chunks ?? []).map(chunk =>
        chunk.map(line => ({
          ...(line.lhs === undefined
            ? {}
            : {
                lhs: {
                  lineNumber: line.lhs.line_number,
                  changes: line.lhs.changes,
                },
              }),
          ...(line.rhs === undefined
            ? {}
            : {
                rhs: {
                  lineNumber: line.rhs.line_number,
                  changes: line.rhs.changes,
                },
              }),
        })),
      ),
    });
  }).pipe(Effect.scoped);

export { DifftasticFailed };
