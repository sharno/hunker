import { Match as M } from "effect";
import { Update } from "foldkit";
import { evo } from "foldkit/struct";

import type { AppResources } from "../../resources";
import { PostInlineComment } from "./command";
import type { Message } from "./message";
import {
  Closed,
  Editing,
  type Model,
  PostFailed,
  Posting,
  sameTarget,
} from "./model";

type Return = Update.Return<Model, Message, AppResources>;

export const update = (model: Model, message: Message): Return =>
  M.value(message).pipe(
    M.withReturnType<Return>(),
    M.tagsExhaustive({
      OpenedInlineComment: ({ target }) =>
        model.state._tag === "Posting" ||
        (model.state._tag !== "Closed" &&
          sameTarget(model.state.target, target))
          ? [model, []]
          : [evo(model, { state: () => Editing({ target, body: "" }) }), []],
      UpdatedInlineCommentBody: ({ body }) =>
        model.state._tag === "Editing" || model.state._tag === "PostFailed"
          ? [
              evo(model, {
                state: (state) =>
                  state._tag === "Editing" || state._tag === "PostFailed"
                    ? Editing({ target: state.target, body })
                    : state,
              }),
              [],
            ]
          : [model, []],
      CancelledInlineComment: () =>
        model.state._tag === "Posting"
          ? [model, []]
          : [evo(model, { state: () => Closed() }), []],
      SubmittedInlineComment: () => {
        if (
          model.state._tag !== "Editing" &&
          model.state._tag !== "PostFailed"
        ) {
          return [model, []];
        }
        const body = model.state.body.trim();
        if (body === "") return [model, []];
        const target = model.state.target;
        return [
          evo(model, { state: () => Posting({ target, body }) }),
          [PostInlineComment({ target, body })],
        ];
      },
      SucceededPostInlineComment: ({ target }) =>
        model.state._tag === "Posting" && sameTarget(model.state.target, target)
          ? [evo(model, { state: () => Closed() }), []]
          : [model, []],
      FailedPostInlineComment: ({ target, error }) =>
        model.state._tag === "Posting" && sameTarget(model.state.target, target)
          ? [
              evo(model, {
                state: (state) =>
                  state._tag === "Posting"
                    ? PostFailed({
                        target,
                        body: state.body,
                        error,
                      })
                    : state,
              }),
              [],
            ]
          : [model, []],
    }),
  );
