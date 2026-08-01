import type { Html, HtmlBuilder } from "foldkit/html";

import { ChangedPrUrl, SubmittedPrUrl } from "../domain";
import type { Message, Model } from "../domain";

export const githubLocationForm = (
  model: Model,
  className: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.form(
    [
      h.Class(`${className}${model.githubInputError === "" ? "" : " is-error"}`),
      h.OnSubmit(SubmittedPrUrl()),
      h.Title(model.githubInputError),
    ],
    [
      h.span([h.Class("github-glyph")], ["⌘"]),
      h.input([
        h.Type("text"),
        h.Value(model.githubInput),
        h.Placeholder("Paste any GitHub URL"),
        h.AriaLabel("GitHub URL"),
        h.OnInput(value => ChangedPrUrl({ value })),
      ]),
      h.button(
        [h.Type("submit"), h.Class("load-button"), h.Disabled(model.phase === "loading")],
        [model.phase === "loading" ? "Opening…" : "Open"],
      ),
    ],
  );
