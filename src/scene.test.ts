import { Option } from "effect";
import { Mount, click, expect, given, role, scene, text } from "foldkit/scene";
import { fromString } from "foldkit/url";
import { describe, test } from "vitest";
import { Popover } from "@foldkit/ui";

import { ChangedUrl, ReviewMeta, SucceededFetchReview } from "./domain";
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
});
