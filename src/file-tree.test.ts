import { expect, test } from "vitest";

import {
  buildFileTree,
  directoryPaths,
  parentFolderPaths,
  revealFileInTree,
} from "./file-tree";

test("builds a directory-first tree with descendant file counts", () => {
  const tree = buildFileTree(
    [
      { path: "README.md" },
      { path: "src/view/app.ts" },
      { path: "src/index.ts" },
      { path: "docs/guide.md" },
    ],
    (file) => file.path,
  );

  expect(tree.map((node) => [node._tag, node.name])).toEqual([
    ["Directory", "docs"],
    ["Directory", "src"],
    ["File", "README.md"],
  ]);
  const source = tree[1];
  expect(source?._tag).toBe("Directory");
  if (source?._tag !== "Directory") return;
  expect(source.fileCount).toBe(2);
  expect(source.children.map((node) => node.name)).toEqual([
    "view",
    "index.ts",
  ]);
});

test("reveals every ancestor when a nested file is selected", () => {
  expect(
    directoryPaths(
      [
        { path: "README.md" },
        { path: "src/view/app.ts" },
        { path: "src/index.ts" },
        { path: "docs/guide.md" },
      ],
      (file) => file.path,
    ),
  ).toEqual(["docs", "src", "src/view"]);
  expect(parentFolderPaths("src/view/app.ts")).toEqual(["src", "src/view"]);
  expect(
    revealFileInTree(["docs", "src", "src/view"], "src/view/app.ts"),
  ).toEqual(["docs"]);
});
