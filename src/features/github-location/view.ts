import { Option } from "effect";
import { Submodel } from "foldkit";
import { Input, Button } from "@foldkit/ui";

import type { Message } from "./message";
import { SubmittedForm, UpdatedInput } from "./message";
import type { Model } from "./model";

export const view = Submodel.defineView<Model, Message>((model, h) =>
  h.form(
    [
      h.Class(
        `github-location-form${Option.isSome(model.maybeError) ? " is-error" : ""}`,
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
          h.span([h.Class("github-location-error"), h.Role("alert")], [error]),
      }),
    ],
  ),
);
