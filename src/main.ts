import { Effect, Match as M, Schema as S } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { Command, Http, Runtime } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { m } from "foldkit/message";
import { evo } from "foldkit/struct";

const FileChange = S.Struct({
  path: S.String,
  previousPath: S.String,
  status: S.Literals(["modified", "added", "deleted", "renamed"]),
  additions: S.Number,
  deletions: S.Number,
  patch: S.String,
  insight: S.String,
});
type FileChange = typeof FileChange.Type;

const ReviewMeta = S.Struct({
  title: S.String,
  repository: S.String,
  number: S.String,
  author: S.String,
  base: S.String,
  head: S.String,
  url: S.String,
});
type ReviewMeta = typeof ReviewMeta.Type;

const Model = S.Struct({
  phase: S.Literals(["ready", "loading", "error"]),
  error: S.String,
  prUrl: S.String,
  filter: S.String,
  meta: ReviewMeta,
  files: S.Array(FileChange),
  selectedPath: S.String,
  viewMode: S.Literals(["unified", "split"]),
  ignoreWhitespace: S.Boolean,
  semantic: S.Boolean,
  characterDiff: S.Boolean,
  reviewedPaths: S.Array(S.String),
});
type Model = typeof Model.Type;

const ChangedPrUrl = m("ChangedPrUrl", { value: S.String });
const SubmittedPrUrl = m("SubmittedPrUrl");
const LoadedReview = m("LoadedReview", {
  meta: ReviewMeta,
  files: S.Array(FileChange),
});
const FailedReview = m("FailedReview", { error: S.String });
const ChangedFilter = m("ChangedFilter", { value: S.String });
const SelectedFile = m("SelectedFile", { path: S.String });
const SelectedViewMode = m("SelectedViewMode", {
  value: S.Literals(["unified", "split"]),
});
const ToggledWhitespace = m("ToggledWhitespace");
const ToggledSemantic = m("ToggledSemantic");
const ToggledCharacterDiff = m("ToggledCharacterDiff");
const ToggledReviewed = m("ToggledReviewed", { path: S.String });

const Message = S.Union([
  ChangedPrUrl,
  SubmittedPrUrl,
  LoadedReview,
  FailedReview,
  ChangedFilter,
  SelectedFile,
  SelectedViewMode,
  ToggledWhitespace,
  ToggledSemantic,
  ToggledCharacterDiff,
  ToggledReviewed,
]);
type Message = typeof Message.Type;

type UpdateReturn = readonly [Model, ReadonlyArray<Command.Command<Message>>];

const toggleReviewed = (paths: ReadonlyArray<string>, path: string) =>
  paths.includes(path) ? paths.filter(item => item !== path) : [...paths, path];

const update = (model: Model, message: Message): UpdateReturn =>
  M.value(message).pipe(
    M.withReturnType<UpdateReturn>(),
    M.tagsExhaustive({
      ChangedPrUrl: ({ value }) => [evo(model, { prUrl: () => value }), []],
      SubmittedPrUrl: () => {
        if (model.phase === "loading" || model.prUrl.trim() === "") return [model, []];
        return [
          evo(model, { phase: () => "loading" as const, error: () => "" }),
          [FetchReview({ url: model.prUrl.trim() })],
        ];
      },
      LoadedReview: ({ meta, files }) => [
        evo(model, {
          phase: () => "ready" as const,
          meta: () => meta,
          files: () => files,
          selectedPath: () => files[0]?.path ?? "",
          reviewedPaths: () => [],
        }),
        [],
      ],
      FailedReview: ({ error }) => [
        evo(model, { phase: () => "error" as const, error: () => error }),
        [],
      ],
      ChangedFilter: ({ value }) => [evo(model, { filter: () => value }), []],
      SelectedFile: ({ path }) => [evo(model, { selectedPath: () => path }), []],
      SelectedViewMode: ({ value }) => [evo(model, { viewMode: () => value }), []],
      ToggledWhitespace: () => [
        evo(model, { ignoreWhitespace: value => !value }),
        [],
      ],
      ToggledSemantic: () => [evo(model, { semantic: value => !value }), []],
      ToggledCharacterDiff: () => [
        evo(model, { characterDiff: value => !value }),
        [],
      ],
      ToggledReviewed: ({ path }) => [
        evo(model, { reviewedPaths: paths => toggleReviewed(paths, path) }),
        [],
      ],
    }),
  );

type ApiReview = Readonly<ReviewMeta & { diff: string }>;

const isApiReview = (value: unknown): value is ApiReview => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return ["title", "repository", "number", "author", "base", "head", "url", "diff"].every(
    key => typeof record[key] === "string",
  );
};

const FetchReview = Command.define("FetchReview", {
  args: { url: S.String },
  messages: [LoadedReview, FailedReview],
  execute: ({ url }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const request = HttpClientRequest.get(`/api/diff?url=${encodeURIComponent(url)}`);
      const response = yield* client.execute(request);
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        const error =
          typeof data === "object" && data !== null &&
          typeof (data as Record<string, unknown>).error === "string"
            ? String((data as Record<string, unknown>).error)
            : "Could not load that change.";
        return yield* Effect.fail(new Error(error));
      }
      if (!isApiReview(data)) {
        return yield* Effect.fail(new Error("GitHub returned an unexpected response."));
      }

      const { diff, ...meta } = data;
      const files = parseGitDiff(diff);
      if (files.length === 0) {
        return yield* Effect.fail(new Error("This change has no reviewable text diff."));
      }
      return LoadedReview({ meta, files });
    }).pipe(
      Effect.catch(error =>
        Effect.succeed(
          FailedReview({
            error: error instanceof Error ? error.message : "Could not load that change.",
          }),
        ),
      ),
      Effect.provide(Http.layer),
    ),
});

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

const normalizeLine = (line: string) => line.replace(/^[-+ ]/, "").replace(/\s+/g, "").trim();

const semanticInsight = (
  patch: string,
  status: FileChange["status"],
  previousPath: string,
  path: string,
): string => {
  if (status === "renamed") return `Renamed from ${previousPath}`;
  if (status === "added") return "New behavior introduced";
  if (status === "deleted") return "Dead path removed";

  const lines = patch.split("\n");
  const removed = lines.filter(line => line.startsWith("-")).map(normalizeLine);
  const added = lines.filter(line => line.startsWith("+")).map(normalizeLine);
  const moved = removed.filter(line => line.length > 12 && added.includes(line));
  if (moved.length >= 2) return `${moved.length} unchanged lines moved`;

  const removedSymbol = patch.match(/^-\s*(?:export\s+)?(?:const|function|class|interface|type)\s+(\w+)/m)?.[1];
  const addedSymbol = patch.match(/^\+\s*(?:export\s+)?(?:const|function|class|interface|type)\s+(\w+)/m)?.[1];
  if (removedSymbol !== undefined && addedSymbol !== undefined && removedSymbol !== addedSymbol) {
    return `${removedSymbol} renamed to ${addedSymbol}`;
  }
  if (/^\+.*(?:test|describe|expect)\(/m.test(patch)) return "Coverage added";
  return "Behavior changed";
};

function parseGitDiff(diff: string): ReadonlyArray<FileChange> {
  const chunks = diff.split(/^diff --git /m).filter(Boolean);
  return chunks.map(chunk => {
    const header = chunk.match(/^a\/(.+?) b\/(.+)$/m);
    const fallbackPath = header?.[2] ?? "unknown";
    const renameFrom = chunk.match(/^rename from (.+)$/m)?.[1] ?? "";
    const renameTo = chunk.match(/^rename to (.+)$/m)?.[1];
    const path = renameTo ?? fallbackPath;
    const status: FileChange["status"] = chunk.includes("new file mode")
      ? "added"
      : chunk.includes("deleted file mode")
        ? "deleted"
        : renameFrom !== ""
          ? "renamed"
          : "modified";
    const patchStart = chunk.indexOf("@@");
    const patch = patchStart >= 0 ? chunk.slice(patchStart) : chunk;
    const lines = patch.split("\n");
    const additions = lines.filter(line => line.startsWith("+") && !line.startsWith("+++")).length;
    const deletions = lines.filter(line => line.startsWith("-") && !line.startsWith("---")).length;
    return FileChange.make({
      path,
      previousPath: renameFrom,
      status,
      additions,
      deletions,
      patch,
      insight: semanticInsight(patch, status, renameFrom, path),
    });
  });
}

const sampleFiles = parseGitDiff(SAMPLE_DIFF);
const sampleMeta = ReviewMeta.make({
  title: "Bound agent retries and surface timeout context",
  repository: "radarlabs/server",
  number: "8421",
  author: "agent/runtime-refactor",
  base: "main",
  head: "feature/bounded-agent-retries",
  url: "https://github.com/radarlabs/server/pull/8421",
});

const init: Runtime.ElementInit<Model, Message> = () => [
  Model.make({
    phase: "ready",
    error: "",
    prUrl: "",
    filter: "",
    meta: sampleMeta,
    files: sampleFiles,
    selectedPath: sampleFiles[0]?.path ?? "",
    viewMode: "split",
    ignoreWhitespace: true,
    semantic: true,
    characterDiff: true,
    reviewedPaths: [],
  }),
  [],
];

const buttonClass = (active: boolean) => `segmented-button${active ? " is-active" : ""}`;

const toggleButton = (
  label: string,
  active: boolean,
  message: Message,
  h: HtmlBuilder<Message>,
) =>
  h.button(
    [
      h.Type("button"),
      h.Class(`filter-toggle${active ? " is-active" : ""}`),
      h.AriaPressed(String(active)),
      h.OnClick(message),
    ],
    [h.span([h.Class("toggle-dot")], [""]), label],
  );

const statusGlyph = (status: FileChange["status"]) =>
  status === "added" ? "A" : status === "deleted" ? "D" : status === "renamed" ? "R" : "M";

const fileRow = (file: FileChange, model: Model, h: HtmlBuilder<Message>): Html => {
  const reviewed = model.reviewedPaths.includes(file.path);
  return h.button(
    [
      h.Key(file.path),
      h.Type("button"),
      h.Class(`file-row${file.path === model.selectedPath ? " is-selected" : ""}`),
      h.OnClick(SelectedFile({ path: file.path })),
    ],
    [
      h.span([h.Class(`file-status status-${file.status}`)], [reviewed ? "✓" : statusGlyph(file.status)]),
      h.span([h.Class("file-copy")], [
        h.span([h.Class("file-name")], [file.path.split("/").at(-1) ?? file.path]),
        h.span([h.Class("file-dir")], [file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "root"]),
      ]),
      h.span([h.Class("file-delta")], [
        h.span([h.Class("plus")], [`+${file.additions}`]),
        h.span([h.Class("minus")], [`−${file.deletions}`]),
      ]),
    ],
  );
};

type DiffLine = Readonly<{
  kind: "add" | "remove" | "context" | "hunk";
  content: string;
  oldNumber: number | null;
  newNumber: number | null;
}>;

const toDiffLines = (patch: string, ignoreWhitespace: boolean): ReadonlyArray<DiffLine> => {
  const raw = patch.split("\n");
  const result: Array<DiffLine> = [];
  let oldNumber = 0;
  let newNumber = 0;

  for (let index = 0; index < raw.length; index += 1) {
    const line = raw[index] ?? "";
    if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);
      oldNumber = Number(match?.[1] ?? 0);
      newNumber = Number(match?.[2] ?? 0);
      result.push({ kind: "hunk", content: line, oldNumber: null, newNumber: null });
      continue;
    }
    const next = raw[index + 1];
    if (
      ignoreWhitespace && line.startsWith("-") && next?.startsWith("+") &&
      normalizeLine(line) === normalizeLine(next)
    ) {
      oldNumber += 1;
      newNumber += 1;
      index += 1;
      continue;
    }
    if (line.startsWith("+")) {
      result.push({ kind: "add", content: line.slice(1), oldNumber: null, newNumber });
      newNumber += 1;
    } else if (line.startsWith("-")) {
      result.push({ kind: "remove", content: line.slice(1), oldNumber, newNumber: null });
      oldNumber += 1;
    } else {
      result.push({ kind: "context", content: line.startsWith(" ") ? line.slice(1) : line, oldNumber, newNumber });
      oldNumber += 1;
      newNumber += 1;
    }
  }
  return result;
};

const sharedPrefixLength = (left: string, right: string) => {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1;
  return index;
};

const sharedSuffixLength = (left: string, right: string, prefix: number) => {
  let index = 0;
  while (
    index < left.length - prefix && index < right.length - prefix &&
    left[left.length - 1 - index] === right[right.length - 1 - index]
  ) index += 1;
  return index;
};

const codeContent = (
  line: DiffLine,
  paired: DiffLine | undefined,
  characterDiff: boolean,
  h: HtmlBuilder<Message>,
): ReadonlyArray<string | Html> => {
  if (!characterDiff || paired === undefined || line.kind === "context" || line.kind === "hunk") {
    return [line.content || " "];
  }
  const prefix = sharedPrefixLength(line.content, paired.content);
  const suffix = sharedSuffixLength(line.content, paired.content, prefix);
  if (prefix + suffix >= line.content.length) return [line.content || " "];
  const end = suffix === 0 ? line.content.length : line.content.length - suffix;
  return [
    line.content.slice(0, prefix),
    h.span([h.Class("char-change")], [line.content.slice(prefix, end)]),
    suffix === 0 ? "" : line.content.slice(-suffix),
  ];
};

const unifiedDiff = (lines: ReadonlyArray<DiffLine>, model: Model, h: HtmlBuilder<Message>) =>
  h.div(
    [h.Class("diff-lines unified-lines")],
    lines.map((line, index) => {
      const paired = line.kind === "remove" && lines[index + 1]?.kind === "add"
        ? lines[index + 1]
        : line.kind === "add" && lines[index - 1]?.kind === "remove"
          ? lines[index - 1]
          : undefined;
      return h.div(
        [h.Key(`${index}-${line.kind}`), h.Class(`diff-line line-${line.kind}`)],
        [
          h.span([h.Class("line-number old")], [line.oldNumber?.toString() ?? ""]),
          h.span([h.Class("line-number new")], [line.newNumber?.toString() ?? ""]),
          h.span([h.Class("line-marker")], [line.kind === "add" ? "+" : line.kind === "remove" ? "−" : ""]),
          h.code([h.Class("line-code")], codeContent(line, paired, model.characterDiff, h)),
        ],
      );
    }),
  );

type SplitRow = Readonly<{ left?: DiffLine; right?: DiffLine }>;

const splitRows = (lines: ReadonlyArray<DiffLine>): ReadonlyArray<SplitRow> => {
  const rows: Array<SplitRow> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) continue;
    const next = lines[index + 1];
    if (line.kind === "remove" && next?.kind === "add") {
      rows.push({ left: line, right: next });
      index += 1;
    } else if (line.kind === "remove") rows.push({ left: line });
    else if (line.kind === "add") rows.push({ right: line });
    else rows.push({ left: line, right: line });
  }
  return rows;
};

const splitCell = (
  line: DiffLine | undefined,
  paired: DiffLine | undefined,
  side: "left" | "right",
  model: Model,
  h: HtmlBuilder<Message>,
) => {
  if (line === undefined) return h.div([h.Class(`split-cell ${side} empty-cell`)], [""]);
  return h.div(
    [h.Class(`split-cell ${side} line-${line.kind}`)],
    [
      h.span([h.Class("line-number")], [(side === "left" ? line.oldNumber : line.newNumber)?.toString() ?? ""]),
      h.span([h.Class("line-marker")], [line.kind === "add" ? "+" : line.kind === "remove" ? "−" : ""]),
      h.code([h.Class("line-code")], codeContent(line, paired, model.characterDiff, h)),
    ],
  );
};

const splitDiff = (lines: ReadonlyArray<DiffLine>, model: Model, h: HtmlBuilder<Message>) =>
  h.div(
    [h.Class("diff-lines split-lines")],
    splitRows(lines).map((row, index) =>
      h.div(
        [h.Key(`split-${index}`), h.Class("split-row")],
        [
          splitCell(row.left, row.right?.kind === "add" ? row.right : undefined, "left", model, h),
          splitCell(row.right, row.left?.kind === "remove" ? row.left : undefined, "right", model, h),
        ],
      ),
    ),
  );

const view = (model: Model, h: HtmlBuilder<Message>): Html => {
  const selected = model.files.find(file => file.path === model.selectedPath) ?? model.files[0];
  const query = model.filter.trim().toLowerCase();
  const visibleFiles = query === "" ? model.files : model.files.filter(file => file.path.toLowerCase().includes(query));
  const totalAdditions = model.files.reduce((sum, file) => sum + file.additions, 0);
  const totalDeletions = model.files.reduce((sum, file) => sum + file.deletions, 0);
  const progress = model.files.length === 0 ? 0 : Math.round((model.reviewedPaths.length / model.files.length) * 100);

  return h.main([h.Class("app-shell")], [
    h.header([h.Class("topbar")], [
      h.div([h.Class("brand")], [
        h.span([h.Class("brand-mark")], ["S"]),
        h.span([h.Class("brand-name")], ["hunker"]),
        h.span([h.Class("brand-tagline")], ["review the change, not the noise"]),
      ]),
      h.form([h.Class("pr-loader"), h.OnSubmit(SubmittedPrUrl())], [
        h.span([h.Class("github-glyph")], ["⌘"]),
        h.input([
          h.Type("url"),
          h.Value(model.prUrl),
          h.Placeholder("Paste a GitHub PR or compare URL"),
          h.AriaLabel("GitHub pull request URL"),
          h.OnInput(value => ChangedPrUrl({ value })),
        ]),
        h.button(
          [h.Type("submit"), h.Class("load-button"), h.Disabled(model.phase === "loading")],
          [model.phase === "loading" ? "Fetching…" : "Review"],
        ),
      ]),
      h.div([h.Class("shortcut-hint")], [h.kbd([], ["⌘"]), h.kbd([], ["K"]), " Quick open"]),
    ]),
    model.phase === "error"
      ? h.div([h.Class("error-banner"), h.Role("alert")], [model.error])
      : h.empty,
    h.section([h.Class("review-header")], [
      h.div([h.Class("review-title-block")], [
        h.div([h.Class("repo-line")], [
          h.span([h.Class("repo-name")], [model.meta.repository]),
          h.span([h.Class("pr-number")], [`#${model.meta.number}`]),
          h.span([h.Class("agent-badge")], ["AGENT PR"]),
        ]),
        h.h1([], [model.meta.title]),
        h.div([h.Class("branch-line")], [
          h.span([], [`${model.meta.author} wants to merge`]),
          h.code([], [model.meta.head]),
          h.span([], ["into"]),
          h.code([], [model.meta.base]),
        ]),
      ]),
      h.div([h.Class("review-stats")], [
        h.div([h.Class("stat-block")], [h.strong([], [String(model.files.length)]), h.span([], ["files"])]),
        h.div([h.Class("stat-block plus")], [h.strong([], [`+${totalAdditions}`]), h.span([], ["added"])]),
        h.div([h.Class("stat-block minus")], [h.strong([], [`−${totalDeletions}`]), h.span([], ["removed"])]),
        h.div([h.Class("progress-block")], [
          h.div([h.Class("progress-label")], [h.span([], ["Review progress"]), h.strong([], [`${progress}%`])]),
          h.div([h.Class("progress-track")], [h.span([h.Class("progress-fill"), h.Style({ width: `${progress}%` })], [""])]),
        ]),
      ]),
    ]),
    h.section([h.Class("controlbar")], [
      h.div([h.Class("control-group view-picker")], [
        h.span([h.Class("control-label")], ["View"]),
        h.div([h.Class("segmented")], [
          h.button(
            [h.Type("button"), h.Class(buttonClass(model.viewMode === "unified")), h.OnClick(SelectedViewMode({ value: "unified" }))],
            ["Unified"],
          ),
          h.button(
            [h.Type("button"), h.Class(buttonClass(model.viewMode === "split")), h.OnClick(SelectedViewMode({ value: "split" }))],
            ["Side by side"],
          ),
        ]),
      ]),
      h.div([h.Class("control-divider")], [""]),
      h.div([h.Class("control-group filters")], [
        h.span([h.Class("control-label")], ["Diff intelligence"]),
        toggleButton("Ignore whitespace", model.ignoreWhitespace, ToggledWhitespace(), h),
        toggleButton("Semantic", model.semantic, ToggledSemantic(), h),
        toggleButton("Character diff", model.characterDiff, ToggledCharacterDiff(), h),
      ]),
      h.div([h.Class("control-spacer")], [""]),
      h.div([h.Class("legend")], [
        h.span([], [h.i([h.Class("legend-add")], [""]), "addition"]),
        h.span([], [h.i([h.Class("legend-remove")], [""]), "deletion"]),
        h.span([], [h.i([h.Class("legend-move")], [""]), "semantic move"]),
      ]),
    ]),
    h.div([h.Class("workspace")], [
      h.aside([h.Class("file-sidebar")], [
        h.div([h.Class("sidebar-heading")], [
          h.strong([], ["Changed files"]),
          h.span([], [String(model.files.length)]),
        ]),
        h.div([h.Class("file-search")], [
          h.span([], ["⌕"]),
          h.input([
            h.Type("search"),
            h.Value(model.filter),
            h.Placeholder("Filter files"),
            h.AriaLabel("Filter changed files"),
            h.OnInput(value => ChangedFilter({ value })),
          ]),
        ]),
        h.nav([h.Class("file-list"), h.AriaLabel("Changed files")], visibleFiles.map(file => fileRow(file, model, h))),
        h.div([h.Class("sidebar-tip")], [
          h.span([h.Class("tip-icon")], ["↕"]),
          h.span([], ["Use ", h.kbd([], ["J"]), " / ", h.kbd([], ["K"]), " to move between files"]),
        ]),
      ]),
      selected === undefined
        ? h.section([h.Class("empty-state")], ["No text files to review."])
        : h.section([h.Class("diff-panel")], [
            h.div([h.Class("file-header")], [
              h.div([h.Class("file-path")], [
                h.span([h.Class(`file-status status-${selected.status}`)], [statusGlyph(selected.status)]),
                h.span([], [
                  h.span([h.Class("path-dir")], [selected.path.includes("/") ? `${selected.path.slice(0, selected.path.lastIndexOf("/") + 1)}` : ""]),
                  h.strong([], [selected.path.split("/").at(-1) ?? selected.path]),
                ]),
              ]),
              h.div([h.Class("file-actions")], [
                h.button([h.Type("button"), h.Class("icon-button"), h.Title("Copy file path")], ["⧉"]),
                h.button([h.Type("button"), h.Class("icon-button"), h.Title("Open file")], ["↗"]),
                h.button(
                  [
                    h.Type("button"),
                    h.Class(`reviewed-button${model.reviewedPaths.includes(selected.path) ? " is-reviewed" : ""}`),
                    h.OnClick(ToggledReviewed({ path: selected.path })),
                  ],
                  [model.reviewedPaths.includes(selected.path) ? "✓ Reviewed" : "Mark reviewed"],
                ),
              ]),
            ]),
            model.semantic
              ? h.div([h.Class("semantic-banner")], [
                  h.span([h.Class("semantic-icon")], ["◎"]),
                  h.div([], [
                    h.strong([], [selected.insight]),
                    h.span([], [
                      selected.insight.includes("moved")
                        ? "Matched normalized statements across hunks. The implementation is unchanged."
                        : "Hunker grouped this as the primary behavioral change in the file.",
                    ]),
                  ]),
                  h.span([h.Class("confidence")], ["high confidence"]),
                ])
              : h.empty,
            model.viewMode === "unified"
              ? unifiedDiff(toDiffLines(selected.patch, model.ignoreWhitespace), model, h)
              : splitDiff(toDiffLines(selected.patch, model.ignoreWhitespace), model, h),
            h.div([h.Class("diff-footer")], [
              h.span([], ["End of file"]),
              h.button([h.Type("button"), h.Class("comment-button")], ["＋ Add a review comment"]),
            ]),
          ]),
    ]),
  ]);
};

export const makeReviewElement = (container: HTMLElement) =>
  Runtime.makeElement({ Model, init, update, view, container });
