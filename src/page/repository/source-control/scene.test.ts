import {
  Command,
  change,
  click,
  expect,
  given,
  label,
  role,
  scene,
  selector,
} from "foldkit/scene";
import { describe, test } from "vitest";

import { Pull, Switch } from "./command";
import { FailedPull, SucceededSwitch } from "./message";
import {
  Model,
  Ready,
  RemoteCurrent,
  Resting,
  Status,
  TrackingBranch,
} from "./model";
import { update } from "./update";
import { view } from "./view";

const repository = "example/hunker-demo";
const status = Status.make({
  path: "/tmp/hunker-demo",
  checkout: TrackingBranch({
    name: "main",
    oid: "1111111111111111111111111111111111111111",
    upstream: "origin/main",
    ahead: 1,
    behind: 2,
  }),
  branches: [
    { name: "main", local: true, remote: true },
    { name: "feature/source-control", local: false, remote: true },
  ],
  changes: { staged: 1, unstaged: 2, untracked: 3 },
  remote: RemoteCurrent({ checkedAt: 1 }),
});
const ready = Model.make({
  state: Ready({ repository, status, action: Resting() }),
});

describe("repository source control", () => {
  test("shows branch, incoming commits, and working-tree counts", () => {
    scene(
      { update, view },
      given(ready),
      expect(label("Checked-out repository branch")).toHaveValue("main"),
      expect(selector(".source-control-count.is-ahead")).toHaveText("1 ↑"),
      expect(selector(".source-control-count.is-behind")).toHaveText("2 ↓"),
      expect(selector(".source-control-changes")).toContainText("1 staged"),
      expect(role("button", { name: "Pull 2 ↓" })).toExist(),
    );
  });

  test("switches branches and renders Git pull refusals", () => {
    const switched = Status.make({
      ...status,
      checkout: TrackingBranch({
        name: "feature/source-control",
        oid: "2222222222222222222222222222222222222222",
        upstream: "origin/feature/source-control",
        ahead: 0,
        behind: 1,
      }),
    });
    scene(
      { update, view },
      given(ready),
      change(label("Checked-out repository branch"), "feature/source-control"),
      Command.resolve(
        Switch,
        SucceededSwitch({
          repository,
          branch: "feature/source-control",
          status: switched,
        }),
      ),
      expect(label("Checked-out repository branch")).toHaveValue(
        "feature/source-control",
      ),
      click(role("button", { name: "Pull 1 ↓" })),
      Command.resolve(
        Pull,
        FailedPull({
          repository,
          error: "Your staged changes would be overwritten by merge.",
        }),
      ),
      expect(role("alert")).toContainText(
        "Your staged changes would be overwritten by merge.",
      ),
    );
  });
});
