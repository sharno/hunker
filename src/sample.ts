import { ReviewMeta } from "./domain";
import { parseGitDiff } from "./diff";

const SAMPLE_DIFF = `diff --git a/src/agent/retry.ts b/src/agent/retry.ts
index e394ff2..1fc88c1 100644
--- a/src/agent/retry.ts
+++ b/src/agent/retry.ts
@@ -8,12 +8,18 @@ import { Schedule } from "effect"
-export const withRetry = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
-  effect.pipe(Effect.retry(Schedule.exponential("100 millis")))
+export const withAgentRetry = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
+  effect.pipe(
+    Effect.retry(
+      Schedule.exponential("100 millis").pipe(
+        Schedule.compose(Schedule.recurs(4)),
+      ),
+    ),
+  )

 export const shouldRetry = (status: number) =>
-  status === 408 || status === 429 || status >= 500
+  status === 408 || status === 429 || (status >= 500 && status < 600)
diff --git a/src/agent/run.ts b/src/agent/run.ts
index 01010ab..f03030b 100644
--- a/src/agent/run.ts
+++ b/src/agent/run.ts
@@ -20,13 +20,13 @@ export const runAgent = Effect.fn("runAgent")(function* (request) {
-  const span = yield* makeSpan(request)
-  const context = yield* loadContext(request)
-  const tools = yield* resolveTools(context)
+  const context = yield* loadContext(request)
+  const tools = yield* resolveTools(context)
+  const span = yield* makeSpan(request)

-  return yield* execute({ request, span, context, tools })
+  return yield* execute({ context, request, span, tools })
 })
diff --git a/src/http/errors.ts b/src/http/errors.ts
index ab113aa..bf221bb 100644
--- a/src/http/errors.ts
+++ b/src/http/errors.ts
@@ -4,7 +4,9 @@ export class AgentTimeout extends Data.TaggedError("AgentTimeout")<{
-  readonly requestId: string
+  readonly requestId: string
+  readonly elapsedMs: number
 }> {}
+
+export const isRetryable = (error: AgentTimeout) => error.elapsedMs < 30_000
diff --git a/test/retry.test.ts b/test/retry.test.ts
new file mode 100644
--- /dev/null
+++ b/test/retry.test.ts
@@ -0,0 +1,10 @@
+import { Effect } from "effect"
+import { describe, expect, it } from "vitest"
+
+import { withAgentRetry } from "../src/agent/retry"
+
+describe("withAgentRetry", () => {
+  it("stops after the retry budget", async () => {
+    const exit = await Effect.runPromiseExit(withAgentRetry(Effect.fail("no")))
+    expect(exit._tag).toBe("Failure")
+  })
+})
diff --git a/src/agent/legacy.ts b/src/agent/legacy.ts
deleted file mode 100644
--- a/src/agent/legacy.ts
+++ /dev/null
@@ -1,4 +0,0 @@
-export const MAX_ATTEMPTS = 3
-export const RETRY_DELAY = 100
-export const LEGACY_TIMEOUT = 5_000
-export const USE_LEGACY_RETRY = false`;

export const sampleFiles = parseGitDiff(SAMPLE_DIFF);

export const sampleMeta = ReviewMeta.make({
  title: "Bound agent retries and surface timeout context",
  repository: "radarlabs/server",
  number: "8421",
  author: "agent/runtime-refactor",
  base: "main",
  head: "feature/bounded-agent-retries",
  url: "https://github.com/radarlabs/server/pull/8421",
  backing: {
    source: "github",
    baseOid: "",
    headOid: "",
    headRef: "feature/bounded-agent-retries",
    path: "",
  },
});
