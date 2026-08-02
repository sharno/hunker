import { given, message, model, story } from "foldkit/story";
import { describe, expect, test } from "vitest";

import { ToggledRepositoryFolder, UpdatedRepositoryQuery } from "./message";
import { empty } from "./model";
import { update } from "./update";

describe("repository browser update", () => {
  test("owns repository search input state", () => {
    story(
      update,
      given(empty()),
      message(UpdatedRepositoryQuery({ value: "semantic diff" })),
      model((state) => {
        expect(state.query).toBe("semantic diff");
      }),
    );
  });

  test("owns its nested folder expansion state", () => {
    story(
      update,
      given(empty()),
      message(ToggledRepositoryFolder({ path: "src/page" })),
      model((state) => {
        expect(state.collapsedFolders).toStrictEqual(["src/page"]);
      }),
      message(ToggledRepositoryFolder({ path: "src/page" })),
      model((state) => {
        expect(state.collapsedFolders).toStrictEqual([]);
      }),
    );
  });
});
