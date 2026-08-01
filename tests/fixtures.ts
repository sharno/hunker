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

export const reviewCommentsResponse = {
  comments: [
    {
      id: 100,
      rootId: 100,
      path: "src/greet.ts",
      body: "Could this keep the original parameter name?",
      author: "alice-reviewer",
      htmlUrl: "https://github.com/example/hunker-demo/pull/42#discussion_r100",
      createdAt: "2026-07-30T12:00:00Z",
      line: 1,
      side: "RIGHT",
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
    },
  ],
} as const;
