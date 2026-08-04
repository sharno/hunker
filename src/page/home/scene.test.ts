import { inertHtml as ih } from "foldkit/html";
import {
  all,
  expect,
  expectAll,
  given,
  label,
  role,
  scene,
  type as typeText,
  withViewInputs,
} from "foldkit/scene";
import { describe, test } from "vitest";

import { Repositories, empty } from "./model";
import { update } from "./update";
import { view } from "./view";

const repositoryView = withViewInputs(view, {
  settingsHref: "/settings",
  renderLocationForm: () => ih.empty,
});

const catalog = {
  configuredRoot: "/Users/example/src",
  temporaryRoot: "/tmp/hunker/repositories",
  repositories: [
    {
      owner: "example",
      name: "hunker",
      path: "/Users/example/src/hunker",
      source: "configured" as const,
    },
    {
      owner: "effect-ts",
      name: "effect",
      path: "/tmp/hunker/repositories/effect-ts/effect",
      source: "temporary" as const,
    },
  ],
};

const loaded = {
  ...empty(),
  repositories: Repositories.Success({ data: catalog }),
};

describe("repository homepage", () => {
  test("shows repositories from both local roots with canonical links", () => {
    scene(
      { update, view: repositoryView() },
      given(loaded),
      expect(role("heading", { name: "Repositories", level: 1 })).toExist(),
      expect(role("link", { name: /example\/hunker/ })).toHaveAttr(
        "href",
        "/example/hunker",
      ),
      expect(role("link", { name: /effect-ts\/effect/ })).toHaveAttr(
        "href",
        "/effect-ts/effect",
      ),
      expectAll(all.role("link")).toHaveCount(3),
    );
  });

  test("filters repositories through the rendered search input", () => {
    scene(
      { update, view: repositoryView() },
      given(loaded),
      typeText(label("Filter repositories"), "effect"),
      expect(role("link", { name: /example\/hunker/ })).toBeAbsent(),
      expect(role("link", { name: /effect-ts\/effect/ })).toExist(),
    );
  });
});
