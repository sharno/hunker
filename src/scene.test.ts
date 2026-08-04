import { Option } from "effect";
import {
  Command,
  Mount,
  all,
  click,
  expect,
  expectAll,
  given,
  label,
  role,
  scene,
  selector,
  text,
  type as typeText,
} from "foldkit/scene";
import { fromString } from "foldkit/url";
import { describe, test } from "vitest";
import { Popover } from "@foldkit/ui";

import {
  ChangedUrl,
  FailedFetchSemantic,
  ReviewMeta,
  SucceededFetchFullFile,
  SucceededFetchGitHubReviews,
  SucceededFetchReview,
} from "./domain";
import { FetchFullFile } from "./command";
import { sampleFiles, sampleMeta } from "./sample";
import { init, update } from "./state";
import { view } from "./view/review-view";

const homeUrl = Option.getOrThrowWith(
  fromString("http://localhost/"),
  () => new Error("Could not parse the home test URL"),
);
const home = init(homeUrl)[0];
const reviewUrl = "https://github.com/example/hunker-demo/pull/42";
const reviewLocation = Option.getOrThrowWith(
  fromString("http://localhost/example/hunker-demo/pull/42"),
  () => new Error("Could not parse the review test URL"),
);
const reviewMeta = ReviewMeta.make({
  ...sampleMeta,
  repository: "example/hunker-demo",
  number: "42",
  url: reviewUrl,
});
const reviewLoading = update(home, ChangedUrl({ url: reviewLocation }))[0];
const review = update(
  reviewLoading,
  SucceededFetchReview({
    requestedUrl: reviewUrl,
    meta: reviewMeta,
    files: sampleFiles,
  }),
)[0];
const primaryFile = sampleFiles[0];
if (primaryFile === undefined)
  throw new Error("The sample review needs a file");
const comments = [
  {
    id: 100,
    rootId: 100,
    path: primaryFile.path,
    body: "Could this keep the **original parameter name**?\n\n- Preserve compatibility\n- Avoid churn in `callers`",
    author: "alice-reviewer",
    htmlUrl: `${reviewUrl}#discussion_r100`,
    createdAt: "2026-07-30T12:00:00Z",
    line: 1,
    side: "RIGHT" as const,
    resolved: false,
  },
  {
    id: 200,
    rootId: 200,
    path: primaryFile.path,
    body: "This thread has *already been handled*.",
    author: "bob-reviewer",
    htmlUrl: `${reviewUrl}#discussion_r200`,
    createdAt: "2026-07-30T13:00:00Z",
    line: 2,
    side: "RIGHT" as const,
    resolved: true,
  },
];

describe("review view", () => {
  test("the sample review exposes its primary review controls", () => {
    scene(
      { update, view },
      given(review),
      expect(
        role("heading", {
          name: "Bound agent retries and surface timeout context",
        }),
      ).toExist(),
      expect(role("button", { name: /Diff options/ })).toExist(),
      expect(role("button", { name: "Files" })).toExist(),
      expect(role("button", { name: "Commits" })).toExist(),
    );
  });

  test("opening diff options reveals the intelligence controls", () => {
    scene(
      { update, view },
      given(review),
      click(role("button", { name: /Diff options/ })),
      expect(text("Diff intelligence")).toExist(),
      expect(role("button", { name: "Ignore whitespace" })).toExist(),
      expect(role("button", { name: "Semantic" })).toExist(),
      Mount.resolve(Popover.AnchorPopover, Popover.CompletedAnchorPopover()),
      Mount.resolve(
        Popover.PortalPopoverBackdrop,
        Popover.CompletedPortalPopoverBackdrop(),
      ),
    );
  });

  test("searches changed paths and code without a browser", () => {
    scene(
      { update, view },
      given(review),
      expectAll(all.selector(".file-row")).toHaveCount(sampleFiles.length),
      typeText(label("Search pull request paths and changes"), "legacy"),
      expectAll(all.selector(".file-row")).toHaveCount(1),
      expect(selector(".sidebar-heading")).toContainText("1/5"),
      typeText(
        label("Search pull request paths and changes"),
        "no such change",
      ),
      expectAll(all.selector(".file-row")).toHaveCount(0),
      expect(selector(".sidebar-heading")).toContainText("0/5"),
    );
  });

  test("collapses files and automatically collapses reviewed files", () => {
    scene(
      { update, view },
      given(review),
      click(
        role("button", {
          name: `Collapse ${primaryFile.path}`,
        }),
      ),
      expect(selector(".diff-panel")).toHaveClass("is-collapsed"),
      click(role("button", { name: `Expand ${primaryFile.path}` })),
      click(role("button", { name: "Mark reviewed" })),
      expect(selector(".diff-panel")).toHaveClass("is-collapsed"),
      expect(role("button", { name: "✓ Reviewed" })).toExist(),
      click(role("button", { name: "✓ Reviewed" })),
      expect(selector(".diff-panel")).not.toHaveClass("is-collapsed"),
    );
  });

  test("expands a patch to the full file through a declared Command", () => {
    scene(
      { update, view },
      given(review),
      click(
        role("button", {
          name: `Expand ${primaryFile.path} to full file`,
        }),
      ),
      Command.resolve(
        FetchFullFile,
        SucceededFetchFullFile({
          requestedUrl: reviewUrl,
          path: primaryFile.path,
          oldText: [
            'import { Schedule } from "effect"',
            "export const withRetry = <A, E, R>(effect: Effect.Effect<A, E, R>) =>",
            '  effect.pipe(Effect.retry(Schedule.exponential("100 millis")))',
            "",
            "export const shouldRetry = (status: number) =>",
            "  status === 408 || status === 429 || status >= 500",
            "export const untouchedFooter = true;",
          ].join("\n"),
          newText: [
            'import { Schedule } from "effect"',
            "export const withAgentRetry = <A, E, R>(effect: Effect.Effect<A, E, R>) =>",
            "  effect.pipe(Effect.retry(Schedule.recurs(4)))",
            "",
            "export const shouldRetry = (status: number) =>",
            "  status === 408 || status === 429 || status < 600",
            "export const untouchedFooter = true;",
          ].join("\n"),
        }),
      ),
      expect(selector(".diff-panel")).toContainText("untouchedFooter"),
      expect(selector(".diff-footer")).toContainText("End of file"),
      click(
        role("button", {
          name: `Show patch only for ${primaryFile.path}`,
        }),
      ),
      expect(selector(".diff-footer")).toContainText("End of patch"),
    );
  });

  test("renders resolved GitHub comments collapsed and toggles either thread", () => {
    const withComments = update(
      review,
      SucceededFetchGitHubReviews({
        requestedUrl: reviewUrl,
        comments,
      }),
    )[0];
    scene(
      { update, view },
      given(withComments),
      expectAll(all.selector(".github-review-thread")).toHaveCount(2),
      expect(text("Resolved")).toExist(),
      expect(selector(".github-review-resolved")).toHaveText("Resolved"),
      expect(selector(".github-review-thread.is-collapsed")).toContainText(
        "already been handled",
      ),
      click(
        role("button", {
          name: "Expand review thread from bob-reviewer",
        }),
      ),
      expect(selector(".github-comment-markdown em")).toHaveText(
        "already been handled",
      ),
      expect(selector(".github-comment-markdown strong")).toHaveText(
        "original parameter name",
      ),
      expectAll(all.selector(".github-comment-markdown li")).toHaveCount(2),
    );
  });

  test("keeps the patch visible when semantic analysis fails", () => {
    const failed = update(
      review,
      FailedFetchSemantic({
        requestedUrl: reviewUrl,
        path: primaryFile.path,
        error: "The semantic engine could not analyze this file.",
      }),
    )[0];
    scene(
      { update, view },
      given(failed),
      expect(selector(".semantic-banner.is-error")).toContainText(
        "Syntax analysis unavailable",
      ),
      expect(selector(".diff-lines")).toContainText("withAgentRetry"),
    );
  });
});
