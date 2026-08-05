import { Command, given, message, model, story } from "foldkit/story";
import { describe, expect, test } from "vitest";

import { Pull, Switch } from "./command";
import {
  ClickedPull,
  FailedPull,
  SelectedBranch,
  SucceededFetch,
  SucceededPull,
  SucceededSwitch,
} from "./message";
import {
  Model,
  Ready,
  RemoteCurrent,
  Resting,
  Status,
  TrackingBranch,
  empty,
} from "./model";
import { load, update } from "./update";

const repository = "example/hunker-demo";
const status = Status.make({
  path: "/tmp/hunker-demo",
  checkout: TrackingBranch({
    name: "main",
    oid: "1111111111111111111111111111111111111111",
    upstream: "origin/main",
    ahead: 0,
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

describe("repository source control update", () => {
  test("loads source control for a local repository", () => {
    const [loading, commands] = load(empty(), repository);
    expect(loading.state).toMatchObject({ _tag: "Loading", repository });
    expect(commands).toHaveLength(1);
    story(
      update,
      given(loading),
      message(SucceededFetch({ repository, status })),
      model((state) => {
        expect(state).toStrictEqual(ready);
      }),
    );
  });

  test("switches to a known remote branch", () => {
    const switched = Status.make({
      ...status,
      checkout: TrackingBranch({
        name: "feature/source-control",
        oid: "2222222222222222222222222222222222222222",
        upstream: "origin/feature/source-control",
        ahead: 0,
        behind: 0,
      }),
      branches: status.branches.map((branch) =>
        branch.name === "feature/source-control"
          ? { ...branch, local: true }
          : branch,
      ),
    });
    story(
      update,
      given(ready),
      message(SelectedBranch({ branch: "feature/source-control" })),
      Command.expectExact(
        Switch({ repository, branch: "feature/source-control" }),
      ),
      Command.resolve(
        Switch,
        SucceededSwitch({
          repository,
          branch: "feature/source-control",
          status: switched,
        }),
      ),
      model((state) => {
        expect(state.state._tag).toBe("Ready");
        if (state.state._tag !== "Ready") return;
        expect(state.state.status).toStrictEqual(switched);
        expect(state.state.action).toMatchObject({ _tag: "Succeeded" });
      }),
    );
  });

  test("keeps status visible when Git blocks a pull", () => {
    story(
      update,
      given(ready),
      message(ClickedPull()),
      Command.expectExact(Pull({ repository })),
      Command.resolve(
        Pull,
        FailedPull({
          repository,
          error: "Your local changes would be overwritten by merge.",
        }),
      ),
      model((state) => {
        expect(state.state._tag).toBe("Ready");
        if (state.state._tag !== "Ready") return;
        expect(state.state.status).toStrictEqual(status);
        expect(state.state.action).toMatchObject({
          _tag: "Blocked",
          operation: "pull",
        });
      }),
    );
  });

  test("records how many commits a pull applied", () => {
    const current = Status.make({
      ...status,
      checkout: TrackingBranch({
        name: "main",
        oid: "3333333333333333333333333333333333333333",
        upstream: "origin/main",
        ahead: 0,
        behind: 0,
      }),
    });
    story(
      update,
      given(ready),
      message(ClickedPull()),
      Command.resolve(
        Pull,
        SucceededPull({ repository, pulledCommits: 2, status: current }),
      ),
      model((state) => {
        expect(state.state._tag).toBe("Ready");
        if (state.state._tag !== "Ready") return;
        expect(state.state.action).toMatchObject({
          _tag: "Succeeded",
          message: "Pulled 2 commits.",
        });
      }),
    );
  });
});
