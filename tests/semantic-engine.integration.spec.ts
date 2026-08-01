import { expect, test } from "@playwright/test";
import { Effect } from "effect";

import {
  AstGrepSemanticLive,
  SemanticDiffEngine,
  type FilePair,
} from "../backend/semantic-engine";

const runFile = (file: FilePair) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const engine = yield* SemanticDiffEngine;
      return yield* engine.analyzeFile(file);
    }).pipe(Effect.provide(AstGrepSemanticLive)),
  );

const runReview = (files: ReadonlyArray<FilePair>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const engine = yield* SemanticDiffEngine;
      return yield* engine.analyzeReview(files);
    }).pipe(Effect.provide(AstGrepSemanticLive)),
  );

test("classifies a changed TypeScript declaration", async () => {
  const result = await runFile({
    path: "src/greet.ts",
    previousPath: "",
    status: "modified",
    oldText:
      'export function greet(name: string) {\n  const message = "hello " + name;\n  return message;\n}\n',
    newText:
      "export function greet(person: string) {\n  return `hello ${person}`;\n}\n",
  });

  expect(result._tag).toBe("Parsed");
  if (result._tag !== "Parsed") return;
  expect(result.language).toBe("TypeScript");
  expect(result.semanticEqual).toBe(false);
  expect(result.changes).toEqual([
    expect.objectContaining({
      _tag: "Updated",
      kind: "function_declaration",
      label: "greet",
    }),
  ]);
});

test("recognizes formatting-only changes as semantically equal", async () => {
  const result = await runFile({
    path: "src/answer.ts",
    previousPath: "",
    status: "modified",
    oldText: "export const answer=42;\n",
    newText: "export const answer = 42;\n",
  });

  expect(result).toEqual(
    expect.objectContaining({
      _tag: "Parsed",
      semanticEqual: true,
      changes: [],
    }),
  );
});

test("recognizes a declaration rename from its AST shape", async () => {
  const result = await runFile({
    path: "src/greet.ts",
    previousPath: "",
    status: "modified",
    oldText: "export function greet(name: string) { return name; }\n",
    newText: "export function welcome(person: string) { return person; }\n",
  });

  expect(result._tag).toBe("Parsed");
  if (result._tag !== "Parsed") return;
  expect(result.changes).toEqual([
    expect.objectContaining({
      _tag: "Renamed",
      oldLabel: "greet",
      newLabel: "welcome",
    }),
  ]);
});

test("detects a declaration moved between files without a subprocess", async () => {
  const moved = `export function calculateTotal(values: number[]) {
  const subtotal = values.reduce((sum, value) => sum + value, 0);
  const tax = subtotal * 0.2;
  return subtotal + tax;
}
`;
  const result = await runReview([
    {
      path: "src/total.ts",
      previousPath: "",
      status: "modified",
      oldText: `export const retained = true;\n\n${moved}`,
      newText: "export const retained = true;\n",
    },
    {
      path: "src/billing.ts",
      previousPath: "",
      status: "modified",
      oldText: 'export const moduleName = "billing";\n',
      newText: `export const moduleName = "billing";\n\n${moved}`,
    },
  ]);

  expect(result).toEqual([
    {
      fromPath: "src/total.ts",
      toPath: "src/billing.ts",
      fromLine: 3,
      toLine: 3,
      lineCount: 5,
      preview: "function calculateTotal(values: number[]) {",
      kind: "function_declaration",
      label: "calculateTotal",
      confidence: 1,
      changed: false,
    },
  ]);
});

test("does not mistake declarations shifted by an insertion for moves", async () => {
  const before = `export const first = 1;
export const second = 2;
export const third = 3;
`;
  const after = `export const inserted = 0;
${before}`;
  const result = await runReview([
    {
      path: "src/constants.ts",
      previousPath: "",
      status: "modified",
      oldText: before,
      newText: after,
    },
  ]);

  expect(result).toEqual([]);
});
