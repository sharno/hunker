import {
  expect,
  given,
  role,
  scene,
  selector,
  within,
  withViewInputs,
} from "foldkit/scene";
import { describe, test } from "vitest";

import { init, showInvalidLocation } from "./model";
import { update } from "./update";
import { type Layout, view } from "./view";

const layouts: ReadonlyArray<Layout> = [
  "pr-loader",
  "toolbar-pr-loader",
  "repository-github-loader",
];

describe("GitHub location view", () => {
  test("applies each toolbar layout to the rendered form", () => {
    for (const layout of layouts) {
      const sceneView = withViewInputs(view, { layout });
      scene(
        { update, view: sceneView() },
        given(init("https://github.com/foldkit/foldkit", false)),
        expect(selector(`form.${layout}.github-location-form`)).toExist(),
        expect(
          within(selector(`form.${layout}`), selector("#github-location")),
        ).toExist(),
        expect(
          within(
            selector(`form.${layout}`),
            selector(".github-location-submit"),
          ),
        ).toExist(),
      );
    }
  });

  test("keeps the submit button and error styling inside the two-column form", () => {
    const sceneView = withViewInputs(view, {
      layout: "repository-github-loader",
    });
    scene(
      { update, view: sceneView() },
      given(showInvalidLocation(init("not a GitHub URL", false))),
      expect(selector("form.repository-github-loader.is-error")).toExist(),
      expect(role("button", { name: "Open" })).toHaveClass(
        "github-location-submit",
      ),
      expect(role("button", { name: "Open" })).toHaveClass("bg-lime"),
      expect(role("alert")).toHaveClass("github-location-error"),
      expect(role("alert")).toHaveClass("col-span-full"),
    );
  });
});
