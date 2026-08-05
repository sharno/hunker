import {
  click,
  expect,
  given,
  label,
  role,
  scene,
  type,
  withViewInputs,
} from "foldkit/scene";
import { describe, test } from "vitest";

import { Editing, Model, type Target, empty } from "./model";
import { update } from "./update";
import { view } from "./view";

const target: Target = {
  pullUrl: "https://github.com/example/hunker/pull/42",
  commitId: "2222222222222222222222222222222222222222",
  path: "src/review.ts",
  line: 18,
  side: "RIGHT",
};

describe("inline comment view", () => {
  test("renders a compact Markdown composer and validates its body", () => {
    const sceneView = withViewInputs(view, { target, mode: "composer" });
    scene(
      { update, view: sceneView() },
      given(Model.make({ state: Editing({ target, body: "" }) })),
      expect(
        label("Review comment for src/review.ts changed line 18"),
      ).toExist(),
      expect(role("button", { name: "Comment" })).toBeDisabled(),
      type(
        label("Review comment for src/review.ts changed line 18"),
        "Please keep `reviewId` stable.",
      ),
      expect(role("button", { name: "Comment" })).toBeEnabled(),
    );
  });

  test("opens from the line gutter", () => {
    const sceneView = withViewInputs(view, { target, mode: "trigger" });
    scene(
      { update, view: sceneView() },
      given(empty()),
      click(
        role("button", {
          name: "Add comment on src/review.ts changed line 18",
        }),
      ),
      expect(
        role("button", {
          name: "Add comment on src/review.ts changed line 18",
        }),
      ).toHaveClass("is-active"),
    );
  });
});
