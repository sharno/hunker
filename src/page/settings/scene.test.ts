import {
  Command,
  click,
  expect,
  given,
  role,
  scene,
  selector,
  submit,
  text,
  type as typeText,
  withViewInputs,
} from "foldkit/scene";
import { describe, test } from "vitest";

import { SaveSettings } from "./command";
import { SucceededSaveSettings } from "./message";
import { Load, empty } from "./model";
import { update } from "./update";
import { view } from "./view";
import { defaultHunkerSettings } from "../../settings";

const configPath = "/tmp/hunker-test-settings.json";
const settingsView = withViewInputs(view, { homeHref: "/" });
const loaded = {
  ...empty(),
  load: Load.Success({
    data: { settings: defaultHunkerSettings, configPath },
  }),
};

describe("settings page", () => {
  test("edits and saves server-backed review defaults", () => {
    const savedSettings = {
      ...defaultHunkerSettings,
      repositoriesRoot: "/Users/example/projects",
      reviewScope: "full" as const,
      viewMode: "unified" as const,
      ignoreWhitespace: !defaultHunkerSettings.ignoreWhitespace,
    };

    scene(
      { update, view: settingsView() },
      given(loaded),
      expect(role("heading", { name: "Settings" })).toExist(),
      expect(selector("code")).toHaveText(configPath),
      typeText(
        selector("#settings-repositories-root"),
        savedSettings.repositoriesRoot,
      ),
      click(role("button", { name: "Full diff" })),
      click(role("button", { name: "Unified" })),
      click(role("button", { name: /^Ignore whitespace/ })),
      submit(selector("form")),
      Command.expectExact(SaveSettings({ settings: savedSettings })),
      Command.resolve(
        SaveSettings,
        SucceededSaveSettings({
          document: { settings: savedSettings, configPath },
        }),
      ),
      expect(text("Saved")).toExist(),
    );
  });
});
