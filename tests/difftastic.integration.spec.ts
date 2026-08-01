import { expect, test } from "@playwright/test";
import { Effect } from "effect";

import { NodeServices } from "@effect/platform-node";

import { runDifftastic } from "../backend/difftastic";

test("runs the real Difftastic process and decodes its structural alignment", async () => {
  const result = await Effect.runPromise(
    runDifftastic(
      "src/greet.ts",
      'export function greet(name: string) {\n  const message = "hello " + name;\n  return message;\n}\n',
      "export function greet(person: string) {\n  return `hello ${person}`;\n}\n",
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  expect(result.language).toBe("TypeScript");
  expect(result.status).toBe("changed");
  expect(result.alignedLines.length).toBeGreaterThan(0);
  expect(result.chunks.length).toBeGreaterThan(0);
  expect(result.chunks.flat().some(line => line.lhs !== undefined)).toBe(true);
  expect(result.chunks.flat().some(line => line.rhs !== undefined)).toBe(true);
});

test("normalizes Difftastic's compact created-file response", async () => {
  const result = await Effect.runPromise(
    runDifftastic("src/new.ts", "", "export const answer = 42;\n").pipe(
      Effect.provide(NodeServices.layer),
    ),
  );

  expect(result.status).toBe("created");
  expect(result.alignedLines).toEqual([
    [null, 0],
    [null, 1],
  ]);
});
