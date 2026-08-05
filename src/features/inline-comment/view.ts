import { Submodel } from "foldkit";

import { button, textarea } from "../../view/control";
import { withTailwind } from "../../view/tailwind";
import {
  CancelledInlineComment,
  OpenedInlineComment,
  SubmittedInlineComment,
  UpdatedInlineCommentBody,
  type Message,
} from "./message";
import { type Model, type Target, sameTarget } from "./model";

export type ViewInputs = Readonly<{
  target: Target;
  mode: "trigger" | "composer";
}>;

const label = (target: Target) =>
  `Add comment on ${target.path} ${target.side === "LEFT" ? "base" : "changed"} line ${target.line}`;

export const view = Submodel.defineView<Model, Message, ViewInputs>(
  (model, { target, mode }, html) => {
    const h = withTailwind(html);
    const active =
      model.state._tag !== "Closed" && sameTarget(model.state.target, target);
    if (mode === "trigger") {
      return button(
        h,
        [
          h.Type("button"),
          h.Class(`inline-comment-trigger${active ? " is-active" : ""}`),
          h.AriaLabel(label(target)),
          h.Title(label(target)),
          h.Disabled(model.state._tag === "Posting"),
          h.OnClick(OpenedInlineComment({ target })),
        ],
        ["+"],
      );
    }
    if (!active) return h.empty;
    const posting = model.state._tag === "Posting";
    const body = model.state.body;
    return h.form(
      [
        h.Class("inline-comment-composer"),
        h.OnSubmit(SubmittedInlineComment()),
      ],
      [
        h.div(
          [h.Class("inline-comment-heading")],
          [
            h.strong([], [`Comment on line ${target.line}`]),
            h.span([], [target.side === "LEFT" ? "base" : "changed"]),
          ],
        ),
        textarea(`inline-comment-${target.side}-${target.line}`, h, [
          h.Value(body),
          h.Rows(3),
          h.Autofocus(true),
          h.Disabled(posting),
          h.Placeholder("Leave a GitHub review comment (Markdown supported)"),
          h.AriaLabel(
            `Review comment for ${target.path} ${target.side === "LEFT" ? "base" : "changed"} line ${target.line}`,
          ),
          h.OnInput((value) => UpdatedInlineCommentBody({ body: value })),
        ]),
        h.div(
          [h.Class("inline-comment-actions")],
          [
            model.state._tag === "PostFailed"
              ? h.span(
                  [h.Class("github-review-error"), h.Role("alert")],
                  [model.state.error],
                )
              : h.span(
                  [],
                  ["Posts immediately through local gh authentication."],
                ),
            h.div(
              [],
              [
                button(
                  h,
                  [
                    h.Type("button"),
                    h.Disabled(posting),
                    h.OnClick(CancelledInlineComment()),
                  ],
                  ["Cancel"],
                ),
                button(
                  h,
                  [
                    h.Type("submit"),
                    h.Class("inline-comment-submit"),
                    h.Disabled(posting || body.trim() === ""),
                  ],
                  [posting ? "Posting…" : "Comment"],
                ),
              ],
            ),
          ],
        ),
      ],
    );
  },
);
