import { Match as M } from "effect";
import { Update } from "foldkit";
import { evo } from "foldkit/struct";

import type { AppResources } from "../../../resources";
import { Fetch, Pull, Switch } from "./command";
import type { Message } from "./message";
import {
  Blocked,
  Failed,
  Loading,
  type Model,
  Pulling,
  Ready,
  Refreshing,
  Resting,
  type Status,
  Succeeded,
  Switching,
} from "./model";

type Return = Update.Return<Model, Message, AppResources>;

const isBusy = (model: Model) =>
  model.state._tag === "Loading" ||
  (model.state._tag === "Ready" &&
    (model.state.action._tag === "Refreshing" ||
      model.state.action._tag === "Switching" ||
      model.state.action._tag === "Pulling"));

const currentBranch = (model: Model) =>
  model.state._tag !== "Ready" ||
  model.state.status.checkout._tag === "DetachedHead"
    ? undefined
    : model.state.status.checkout.name;

export const load = (model: Model, repository: string): Return => {
  if (
    repository === "" ||
    (model.state._tag !== "Idle" && model.state.repository === repository)
  ) {
    return [model, []];
  }
  return [
    evo(model, { state: () => Loading({ repository }) }),
    [Fetch({ repository })],
  ];
};

const requestRefresh = (model: Model): Return => {
  if (isBusy(model) || model.state._tag === "Idle") return [model, []];
  if (model.state._tag === "Failed") {
    return [
      evo(model, {
        state: (state) =>
          state._tag === "Failed"
            ? Loading({ repository: state.repository })
            : state,
      }),
      [Fetch({ repository: model.state.repository })],
    ];
  }
  if (model.state._tag !== "Ready") return [model, []];
  return [
    evo(model, {
      state: (state) =>
        state._tag === "Ready"
          ? Ready({ ...state, action: Refreshing() })
          : state,
    }),
    [Fetch({ repository: model.state.repository })],
  ];
};

const requestSwitch = (model: Model, branch: string): Return => {
  if (
    isBusy(model) ||
    model.state._tag !== "Ready" ||
    currentBranch(model) === branch ||
    !model.state.status.branches.some((candidate) => candidate.name === branch)
  ) {
    return [model, []];
  }
  return [
    evo(model, {
      state: (state) =>
        state._tag === "Ready"
          ? Ready({ ...state, action: Switching({ branch }) })
          : state,
    }),
    [Switch({ repository: model.state.repository, branch })],
  ];
};

const requestPull = (model: Model): Return => {
  if (
    isBusy(model) ||
    model.state._tag !== "Ready" ||
    model.state.status.checkout._tag !== "TrackingBranch" ||
    model.state.status.checkout.behind === 0
  ) {
    return [model, []];
  }
  return [
    evo(model, {
      state: (state) =>
        state._tag === "Ready" ? Ready({ ...state, action: Pulling() }) : state,
    }),
    [Pull({ repository: model.state.repository })],
  ];
};

const fetched = (model: Model, repository: string, status: Status): Return =>
  model.state._tag !== "Idle" && model.state.repository === repository
    ? [
        evo(model, {
          state: () => Ready({ repository, status, action: Resting() }),
        }),
        [],
      ]
    : [model, []];

const fetchFailed = (
  model: Model,
  repository: string,
  error: string,
): Return => {
  if (model.state._tag === "Idle" || model.state.repository !== repository) {
    return [model, []];
  }
  return model.state._tag === "Ready"
    ? [
        evo(model, {
          state: (state) =>
            state._tag === "Ready"
              ? Ready({
                  ...state,
                  action: Blocked({ operation: "refresh", message: error }),
                })
              : state,
        }),
        [],
      ]
    : [evo(model, { state: () => Failed({ repository, error }) }), []];
};

export const update = (model: Model, message: Message): Return =>
  M.value(message).pipe(
    M.withReturnType<Return>(),
    M.tagsExhaustive({
      Ticked: () => requestRefresh(model),
      ClickedRefresh: () => requestRefresh(model),
      SelectedBranch: ({ branch }) => requestSwitch(model, branch),
      ClickedPull: () => requestPull(model),
      SucceededFetch: ({ repository, status }) =>
        fetched(model, repository, status),
      FailedFetch: ({ repository, error }) =>
        fetchFailed(model, repository, error),
      SucceededSwitch: ({ repository, branch, status }) =>
        model.state._tag !== "Idle" && model.state.repository === repository
          ? [
              evo(model, {
                state: () =>
                  Ready({
                    repository,
                    status,
                    action: Succeeded({ message: `Switched to ${branch}.` }),
                  }),
              }),
              [],
            ]
          : [model, []],
      FailedSwitch: ({ repository, error }) =>
        model.state._tag === "Ready" && model.state.repository === repository
          ? [
              evo(model, {
                state: (state) =>
                  state._tag === "Ready"
                    ? Ready({
                        ...state,
                        action: Blocked({
                          operation: "switch",
                          message: error,
                        }),
                      })
                    : state,
              }),
              [],
            ]
          : [model, []],
      SucceededPull: ({ repository, pulledCommits, status }) =>
        model.state._tag === "Ready" && model.state.repository === repository
          ? [
              evo(model, {
                state: () =>
                  Ready({
                    repository,
                    status,
                    action: Succeeded({
                      message:
                        pulledCommits === 0
                          ? "Already up to date."
                          : `Pulled ${pulledCommits} ${pulledCommits === 1 ? "commit" : "commits"}.`,
                    }),
                  }),
              }),
              [],
            ]
          : [model, []],
      FailedPull: ({ repository, error }) =>
        model.state._tag === "Ready" && model.state.repository === repository
          ? [
              evo(model, {
                state: (state) =>
                  state._tag === "Ready"
                    ? Ready({
                        ...state,
                        action: Blocked({
                          operation: "pull",
                          message: error,
                        }),
                      })
                    : state,
              }),
              [],
            ]
          : [model, []],
    }),
  );
