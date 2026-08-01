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
`,
} as const;

export const semanticResponse = {
  path: "src/greet.ts",
  language: "TypeScript",
  status: "changed",
  oldText:
    'export function greet(name: string) {\n  const message = "hello " + name;\n  return message;\n}\n',
  newText:
    "export function greet(person: string) {\n  return `hello ${person}`;\n}\n",
  alignedLines: [
    [0, 0],
    [1, null],
    [2, 1],
    [3, 2],
    [4, 3],
  ],
  chunks: [
    [
      {
        lhs: {
          lineNumber: 0,
          changes: [{ start: 22, end: 26, content: "name", highlight: "normal" }],
        },
        rhs: {
          lineNumber: 0,
          changes: [{ start: 22, end: 28, content: "person", highlight: "normal" }],
        },
      },
      {
        lhs: {
          lineNumber: 1,
          changes: [
            {
              start: 2,
              end: 34,
              content: 'const message = "hello " + name;',
              highlight: "normal",
            },
          ],
        },
      },
      {
        lhs: {
          lineNumber: 2,
          changes: [{ start: 9, end: 16, content: "message", highlight: "normal" }],
        },
        rhs: {
          lineNumber: 1,
          changes: [
            {
              start: 9,
              end: 26,
              content: "`hello ${person}`",
              highlight: "string",
            },
          ],
        },
      },
    ],
  ],
} as const;
