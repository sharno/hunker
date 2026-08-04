import { expect, test } from "vitest";

import { toFullDiffLines } from "./diff";

test("fills omitted file context around multiple patch hunks", () => {
  const patch = `@@ -3 +3 @@
-const value = "old";
+const value = "new";
@@ -6 +6 @@
-const tail = "old";
+const tail = "new";
`;
  const oldText = `// header
const alpha = 1;
const value = "old";
const middleA = 2;
const middleB = 3;
const tail = "old";
export { alpha };
`;
  const newText = `// header
const alpha = 1;
const value = "new";
const middleA = 2;
const middleB = 3;
const tail = "new";
export { alpha };
`;

  const lines = toFullDiffLines(patch, oldText, newText, false);

  expect(lines.map((line) => line.content)).toEqual([
    "// header",
    "const alpha = 1;",
    "@@ -3 +3 @@",
    'const value = "old";',
    'const value = "new";',
    "const middleA = 2;",
    "const middleB = 3;",
    "@@ -6 +6 @@",
    'const tail = "old";',
    'const tail = "new";',
    "export { alpha };",
  ]);
  expect(
    lines.filter((line) => line.hunkId === null).map((line) => line.newNumber),
  ).toEqual([1, 2, 4, 5, 7]);
});
