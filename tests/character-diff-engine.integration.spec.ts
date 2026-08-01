import { expect, test } from "@playwright/test";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";

import {
  CharacterDiffEngine,
  type CharacterDiffInput,
  NativeGitCharacterLive,
} from "../backend/character-diff-engine";

const runCharacterDiff = (input: CharacterDiffInput) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const engine = yield* CharacterDiffEngine;
      return yield* engine.analyzeFile(input);
    }).pipe(
      Effect.provide(NativeGitCharacterLive),
      Effect.provide(NodeServices.layer),
    ),
  );

const slices = (
  source: string,
  ranges: ReadonlyArray<Readonly<{ start: number; end: number }>>,
) => ranges.map(range => source.slice(range.start, range.end));

test("native Git aligns whole-file character changes with their actual lines", async () => {
  const oldLines = [
    "  throttledOn: (idString: string | null, key: DynamicConfigKey) => {",
    "    const percent = parseInt((dconfig as any)[key], 10) || 0;",
  ];
  const newLines = [
    "  throttledOn: (idString: string | null, key: DynamicConfigKey, options: DConfigOptions = DConfigOnlyOptions) => {",
    "    const percent = dconfig.getInteger(key, options);",
  ];
  const result = await runCharacterDiff({
    path: "src/config.ts",
    oldText: `${oldLines.join("\n")}\n`,
    newText: `${newLines.join("\n")}\n`,
    ignoreWhitespace: false,
  });

  expect(result.rows.map(row => [row.oldLine, row.newLine])).toEqual([
    [1, 1],
    [2, 2],
  ]);
  expect(slices(newLines[0] ?? "", result.rows[0]?.newRanges ?? [])).toEqual([
    ", options: DConfigOptions = DConfigOnlyOptions",
  ]);
  expect(result.rows[0]?.oldRanges).toEqual([]);
  expect(slices(newLines[1] ?? "", result.rows[1]?.newRanges ?? []).join(""))
    .toContain("options");
  expect(slices(oldLines[1] ?? "", result.rows[1]?.oldRanges ?? []).join(""))
    .toContain("parseInt((");
});

test("native Git can suppress whitespace-only changes", async () => {
  const result = await runCharacterDiff({
    path: "src/answer.ts",
    oldText: "export const answer=42;\n",
    newText: "export  const answer = 42;\n",
    ignoreWhitespace: true,
  });

  expect(result.rows).toEqual([]);
});
