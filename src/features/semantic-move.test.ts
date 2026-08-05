import { describe, expect, test } from "vitest";

import { MovedBlock } from "../model";
import {
  semanticMoveAnchor,
  semanticMoveId,
  semanticMoveTone,
} from "./semantic-move";

const move = MovedBlock.make({
  fromPath: "src/old.ts",
  toPath: "src/new.ts",
  fromLine: 10,
  toLine: 30,
  fromLineCount: 4,
  toLineCount: 5,
  preview: "function calculate()",
  kind: "function_declaration",
  label: "calculate",
  confidence: 0.8,
  changed: true,
});

describe("semantic move identity", () => {
  test("gives both endpoints a stable shared identity and color", () => {
    expect(semanticMoveAnchor(move, "source")).toBe(
      `semantic-move-${semanticMoveId(move)}-source`,
    );
    expect(semanticMoveAnchor(move, "destination")).toBe(
      `semantic-move-${semanticMoveId(move)}-destination`,
    );
    expect(semanticMoveTone(move)).toBeGreaterThanOrEqual(0);
    expect(semanticMoveTone(move)).toBeLessThan(3);
  });
});
