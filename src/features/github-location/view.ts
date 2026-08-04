import { Option } from "effect";
import { Submodel } from "foldkit";
import { Input, Button } from "@foldkit/ui";

import { withTailwind } from "../../view/tailwind";
import type { Message } from "./message";
import { SubmittedForm, UpdatedInput } from "./message";
import type { Model } from "./model";

export type Layout =
  | "pr-loader"
  | "toolbar-pr-loader"
  | "repository-github-loader";
export type ViewInputs = Readonly<{ layout: Layout }>;

export const view = Submodel.defineView<Model, Message, ViewInputs>(
  (model, viewInputs, html) => {
    const h = withTailwind(html);
    return h.form(
      [
        h.Class(
          `github-location-form ${viewInputs.layout}${Option.isSome(model.maybeError) ? " is-error" : ""}`,
        ),
        h.OnSubmit(SubmittedForm()),
      ],
      [
        Input.view(
          {
            id: "github-location",
            type: "url",
            value: model.value,
            placeholder: "Paste any GitHub URL",
            isInvalid: Option.isSome(model.maybeError),
            onInput: (value) => UpdatedInput({ value }),
            toView: (attributes) =>
              h.input([
                ...attributes.input,
                h.Autocomplete("off"),
                h.AriaLabel("GitHub URL"),
              ]),
          },
          h,
        ),
        Button.view(
          {
            type: "submit",
            isDisabled: model.isLoading,
            toView: (attributes) =>
              h.button(
                [...attributes.button, h.Class("github-location-submit")],
                [model.isLoading ? "Loading…" : "Open"],
              ),
          },
          h,
        ),
        Option.match(model.maybeError, {
          onNone: () => h.empty,
          onSome: (error) =>
            h.span(
              [h.Class("github-location-error"), h.Role("alert")],
              [error],
            ),
        }),
      ],
    );
  },
);
