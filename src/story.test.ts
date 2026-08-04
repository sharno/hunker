import { Option } from "effect";
import { Command, given, message, model, story } from "foldkit/story";
import { fromString } from "foldkit/url";
import { describe, expect, test } from "vitest";

import {
  ChangedUrl,
  ClickedRefreshReview,
  CompletedNavigate,
  FailedFetchReview,
  GotSettingsMessage,
  ReviewFailed,
  ReviewMeta,
  SelectedCommit,
  SelectedReviewTab,
  SubmittedReply,
  SubmittedReview,
  SucceededFetchCommitDiff,
  SucceededFetchCommits,
  SucceededFetchFullFile,
  SucceededFetchGitHubReviews,
  SucceededFetchReview,
  SucceededPostPullRequestReview,
  SucceededPostReviewReply,
  ToggledFileCollapse,
  ToggledFullFile,
  ToggledHunkCollapse,
  ToggledReviewed,
  ToggledSidebar,
  UpdatedReplyDraft,
  UpdatedReviewBody,
} from "./domain";
import { sampleFiles, sampleMeta } from "./sample";
import {
  CanonicalizeLocation,
  FetchFullFile,
  FetchReview,
  PostPullRequestReview,
  PostReviewReply,
  VisitLocation,
} from "./command";
import { hunkKey } from "./diff";
import { FetchCommitDiff, FetchCommits } from "./features/commits";
import { init, update } from "./state";
import * as Settings from "./page/settings";
import { defaultHunkerSettings } from "./settings";

const urlOrThrow = (raw: string) =>
  Option.getOrThrowWith(
    fromString(raw),
    () => new Error(`Could not parse test URL: ${raw}`),
  );

const pendingHome = init(urlOrThrow("http://localhost/"))[0];
const home = update(
  pendingHome,
  GotSettingsMessage({
    message: Settings.SucceededFetchSettings({
      document: {
        settings: defaultHunkerSettings,
        configPath: "/tmp/hunker-story-settings.json",
      },
    }),
  }),
)[0];
const reviewUrl = "https://github.com/example/hunker-demo/pull/42";
const localReviewUrl =
  "http://localhost/example/hunker-demo/pull/42?semantic=off&inline=off&reviews=hide";
const reviewMeta = ReviewMeta.make({
  ...sampleMeta,
  repository: "example/hunker-demo",
  number: "42",
  url: reviewUrl,
});
const primaryFile = sampleFiles[0];
if (primaryFile === undefined)
  throw new Error("The sample review needs a file");
const reviewLoading = update(
  home,
  ChangedUrl({ url: urlOrThrow(localReviewUrl) }),
)[0];
const review = update(
  reviewLoading,
  SucceededFetchReview({
    requestedUrl: reviewUrl,
    meta: reviewMeta,
    files: sampleFiles,
  }),
)[0];
const commit = {
  sha: "1111111111111111111111111111111111111111",
  message: "Introduce retry helper",
  author: "review-agent",
  avatarUrl: "",
  authoredAt: "2026-07-30T14:00:00Z",
  htmlUrl:
    "https://github.com/example/hunker-demo/commit/1111111111111111111111111111111111111111",
};
const reviewComments = [
  {
    id: 100,
    rootId: 100,
    path: primaryFile.path,
    body: "Could this keep the **original name**?",
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
    body: "Already handled.",
    author: "bob-reviewer",
    htmlUrl: `${reviewUrl}#discussion_r200`,
    createdAt: "2026-07-30T13:00:00Z",
    line: 2,
    side: "RIGHT" as const,
    resolved: true,
  },
];

describe("review update", () => {
  test("ignores a review response after the route has been left", () => {
    const leftReview = update(
      reviewLoading,
      ChangedUrl({ url: urlOrThrow("http://localhost/") }),
    )[0];
    const [afterResponse, commands] = update(
      leftReview,
      SucceededFetchReview({
        requestedUrl: reviewUrl,
        meta: reviewMeta,
        files: sampleFiles,
      }),
    );

    expect(afterResponse.location._tag).toBe("Home");
    expect(afterResponse.reviewState._tag).toBe("Ready");
    expect(afterResponse.meta.url).toBe(reviewUrl);
    expect(commands).toStrictEqual([]);
  });

  test("keeps a cached review intact across a not-found route", () => {
    const notFound = update(
      review,
      ChangedUrl({ url: urlOrThrow("http://localhost/not/a/hunker/route") }),
    )[0];
    expect(notFound.location._tag).toBe("NotFound");
    expect(notFound.reviewState._tag).toBe("Ready");
    expect(notFound.meta).toStrictEqual(reviewMeta);

    const restored = update(
      notFound,
      ChangedUrl({ url: urlOrThrow(localReviewUrl) }),
    )[0];
    expect(restored.location._tag).toBe("Pull");
    expect(restored.reviewState._tag).toBe("Ready");
    expect(restored.meta).toStrictEqual(reviewMeta);
  });

  test("sidebar toggles remain pure local state transitions", () => {
    const collapsed = update(home, ToggledSidebar())[0];
    expect(collapsed.sidebarCollapsed).toBe(true);
    const expanded = update(collapsed, ToggledSidebar())[0];
    expect(expanded.sidebarCollapsed).toBe(false);
  });

  test("a review route loads and accepts the matching successful response", () => {
    story(
      update,
      given(home),
      message(ChangedUrl({ url: urlOrThrow(localReviewUrl) })),
      Command.expectExact(FetchReview),
      Command.resolve(
        FetchReview,
        SucceededFetchReview({
          requestedUrl: reviewUrl,
          meta: reviewMeta,
          files: sampleFiles,
        }),
      ),
      model((state) => {
        expect(state.reviewState._tag).toBe("Ready");
        expect(state.meta.url).toBe(reviewUrl);
        expect(state.files).toStrictEqual(sampleFiles);
      }),
      Command.resolve(CanonicalizeLocation, CompletedNavigate()),
    );
  });

  test("a review route surfaces the matching failed response", () => {
    story(
      update,
      given(home),
      message(ChangedUrl({ url: urlOrThrow(localReviewUrl) })),
      Command.resolve(
        FetchReview,
        FailedFetchReview({
          requestedUrl: reviewUrl,
          error: "GitHub was unavailable",
        }),
      ),
      model((state) => {
        expect(state.reviewState).toStrictEqual(
          ReviewFailed({ url: reviewUrl, error: "GitHub was unavailable" }),
        );
      }),
    );
  });

  test("refresh replaces ready content with an explicit loading state", () => {
    story(
      update,
      given(review),
      message(ClickedRefreshReview()),
      Command.expectExact(FetchReview({ url: reviewUrl })),
      model((state) => {
        expect(state.reviewState._tag).toBe("Loading");
        expect(state.files).toStrictEqual([]);
        expect(state.meta.title).toBe(reviewMeta.title);
      }),
      Command.resolve(
        FetchReview,
        SucceededFetchReview({
          requestedUrl: reviewUrl,
          meta: reviewMeta,
          files: sampleFiles,
        }),
      ),
      Command.resolve(CanonicalizeLocation, CompletedNavigate()),
    );
  });

  test("reviewing a file collapses it and unreviewing expands it", () => {
    const path = primaryFile.path;
    const hunkId = "first-hunk";
    story(
      update,
      given(review),
      message(ToggledFileCollapse({ path })),
      model((state) => {
        expect(state.collapsedPaths).toContain(path);
      }),
      message(ToggledHunkCollapse({ path, hunkId })),
      model((state) => {
        expect(state.collapsedHunks).toContain(hunkKey(path, hunkId));
      }),
      message(ToggledReviewed({ path })),
      model((state) => {
        expect(state.reviewedPaths).toContain(path);
        expect(state.collapsedPaths).toContain(path);
      }),
      message(ToggledReviewed({ path })),
      model((state) => {
        expect(state.reviewedPaths).not.toContain(path);
        expect(state.collapsedPaths).not.toContain(path);
      }),
    );
  });

  test("expands a patch with the complete file and collapses back locally", () => {
    story(
      update,
      given(review),
      message(ToggledFullFile({ path: primaryFile.path })),
      Command.expectExact(
        FetchFullFile({
          url: reviewUrl,
          baseOid: reviewMeta.backing.baseOid,
          headOid: reviewMeta.backing.headOid,
          path: primaryFile.path,
          previousPath: primaryFile.previousPath,
          status: primaryFile.status,
        }),
      ),
      Command.resolve(
        FetchFullFile,
        SucceededFetchFullFile({
          requestedUrl: reviewUrl,
          path: primaryFile.path,
          oldText: "before\n",
          newText: "after\n",
        }),
      ),
      model((state) => {
        expect(state.fullFileStates[0]?.state._tag).toBe("Success");
      }),
      message(ToggledFullFile({ path: primaryFile.path })),
      model((state) => {
        expect(state.fullFileStates).toStrictEqual([]);
      }),
    );
  });

  test("loads commits and opens one immutable commit diff", () => {
    const commitFiles = [primaryFile];
    story(
      update,
      given(review),
      message(SelectedReviewTab({ value: "commits" })),
      Command.expectHas(
        VisitLocation({
          href: "/example/hunker-demo/pull/42/commits",
        }),
      ),
      Command.resolveAll(
        [
          FetchCommits,
          SucceededFetchCommits({
            requestedUrl: reviewUrl,
            commits: [commit],
          }),
        ],
        [VisitLocation, CompletedNavigate()],
      ),
      message(SelectedCommit({ sha: commit.sha })),
      Command.expectHas(
        FetchCommitDiff({
          repository: reviewMeta.repository,
          sha: commit.sha,
        }),
      ),
      Command.resolveAll(
        [
          FetchCommitDiff,
          SucceededFetchCommitDiff({ sha: commit.sha, files: commitFiles }),
        ],
        [VisitLocation, CompletedNavigate()],
        [CanonicalizeLocation, CompletedNavigate()],
      ),
      model((state) => {
        expect(state.selectedCommit).toBe(commit.sha);
        expect(state.files).toStrictEqual(commitFiles);
      }),
    );
  });

  test("posts review replies and decisions through explicit Commands", () => {
    const withComments = update(
      review,
      SucceededFetchGitHubReviews({
        requestedUrl: reviewUrl,
        comments: reviewComments,
      }),
    )[0];
    const rootComment = reviewComments[0];
    if (rootComment === undefined)
      throw new Error("The review story needs a root comment");
    const postedReply = {
      ...rootComment,
      id: 101,
      rootId: 100,
      body: "Yes, the rename is intentional.",
      author: "local-reviewer",
    };

    story(
      update,
      given(withComments),
      model((state) => {
        expect(state.collapsedReviewThreads).toStrictEqual([200]);
      }),
      message(
        UpdatedReplyDraft({
          commentId: 100,
          body: "Yes, the rename is intentional.",
        }),
      ),
      message(SubmittedReply({ commentId: 100 })),
      Command.expectExact(
        PostReviewReply({
          url: reviewUrl,
          commentId: 100,
          body: "Yes, the rename is intentional.",
        }),
      ),
      Command.resolve(
        PostReviewReply,
        SucceededPostReviewReply({ comment: postedReply }),
      ),
      message(
        UpdatedReviewBody({
          body: "Please address the naming concern before merging.",
        }),
      ),
      message(SubmittedReview({ event: "REQUEST_CHANGES" })),
      Command.expectExact(
        PostPullRequestReview({
          url: reviewUrl,
          body: "Please address the naming concern before merging.",
          event: "REQUEST_CHANGES",
        }),
      ),
      Command.resolve(
        PostPullRequestReview,
        SucceededPostPullRequestReview({ event: "REQUEST_CHANGES" }),
      ),
      model((state) => {
        expect(state.reviewSubmission._tag).toBe("Success");
        expect(state.reviewBody).toBe("");
        expect(state.replyDrafts).toStrictEqual([]);
      }),
    );
  });
});
