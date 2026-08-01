export const reviewUrl = "https://github.com/example/hunker-demo/pull/42";

export const reviewResponse = {
  title: "Use a template literal for greetings",
  repository: "example/hunker-demo",
  number: "42",
  author: "review-agent",
  base: "main",
  head: "feature/greeting",
  url: reviewUrl,
  diff: `diff --git a/src/greet.ts b/src/greet.ts
index 1111111..2222222 100644
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1,4 +1,3 @@
-export function greet(name: string) {
-  const message = "hello " + name;
-  return message;
+export function greet(person: string) {
+  return \`hello \${person}\`;
 }
diff --git a/src/message.ts b/src/message.ts
new file mode 100644
--- /dev/null
+++ b/src/message.ts
@@ -0,0 +1,2 @@
+export const greetingPrefix = "hello";
+export const greetingTarget = "world";
`,
} as const;

export const movesResponse = {
  moves: [
    {
      fromPath: "src/greet.ts",
      toPath: "src/message.ts",
      fromLine: 1,
      toLine: 1,
      lineCount: 2,
      preview: "export const greetingPrefix = \"hello\";",
      kind: "lexical_declaration",
      label: "greetingPrefix",
      confidence: 1,
      changed: false,
    },
  ],
} as const;

export const semanticResponse = {
  _tag: "Parsed",
  path: "src/greet.ts",
  language: "TypeScript",
  semanticEqual: false,
  changes: [
    {
      _tag: "Updated",
      kind: "function_declaration",
      label: "greet",
      oldRange: { startLine: 1, endLine: 4, startColumn: 8, endColumn: 2 },
      newRange: { startLine: 1, endLine: 3, startColumn: 8, endColumn: 2 },
      confidence: 1,
    },
  ],
} as const;

const characterRows = {
  "src/greet.ts": [
    {
      oldLine: 1,
      newLine: 1,
      oldRanges: [{ start: 22, end: 26 }],
      newRanges: [{ start: 22, end: 28 }],
    },
    {
      oldLine: 2,
      newLine: 2,
      oldRanges: [{ start: 2, end: 35 }],
      newRanges: [{ start: 2, end: 27 }],
    },
    {
      oldLine: 3,
      newLine: null,
      oldRanges: [{ start: 2, end: 17 }],
      newRanges: [],
    },
  ],
  "src/message.ts": [
    {
      oldLine: null,
      newLine: 1,
      oldRanges: [],
      newRanges: [{ start: 0, end: 38 }],
    },
    {
      oldLine: null,
      newLine: 2,
      oldRanges: [],
      newRanges: [{ start: 0, end: 38 }],
    },
  ],
} as const;

export const characterDiffResponse = (
  path: string,
  ignoreWhitespace: boolean,
  mode: "token" | "character",
) => ({
  path,
  ignoreWhitespace,
  mode,
  rows: characterRows[path as keyof typeof characterRows] ?? [],
});

export const reviewCommentsResponse = {
  comments: [
    {
      id: 100,
      rootId: 100,
      path: "src/greet.ts",
      body: [
        "Could this keep the **original parameter name**?",
        "",
        "- Preserve API compatibility",
        "- Avoid churn in `callers`",
        "",
        "See [the style guide](https://example.com/style) and [do not run this](javascript:alert(1)).",
        "",
        "<script>window.markdownWasUnsafe = true</script>",
      ].join("\n"),
      author: "alice-reviewer",
      htmlUrl: "https://github.com/example/hunker-demo/pull/42#discussion_r100",
      createdAt: "2026-07-30T12:00:00Z",
      line: 1,
      side: "RIGHT",
      resolved: false,
    },
    {
      id: 101,
      rootId: 100,
      path: "src/greet.ts",
      body: "The rename makes the template clearer.",
      author: "review-agent",
      htmlUrl: "https://github.com/example/hunker-demo/pull/42#discussion_r101",
      createdAt: "2026-07-30T12:05:00Z",
      line: 1,
      side: "RIGHT",
      resolved: false,
    },
    {
      id: 200,
      rootId: 200,
      path: "src/greet.ts",
      body: "This thread has *already been handled* and can stay out of the way.",
      author: "bob-reviewer",
      htmlUrl: "https://github.com/example/hunker-demo/pull/42#discussion_r200",
      createdAt: "2026-07-30T13:00:00Z",
      line: 2,
      side: "RIGHT",
      resolved: true,
    },
  ],
} as const;
