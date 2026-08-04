import type { Html, HtmlBuilder } from "foldkit/html";

import { button } from "./control";

export type SearchModeChoice<Mode extends string> = Readonly<{
  mode: Mode;
  symbol: string;
  label: string;
}>;

export const searchModePicker = <Message, Mode extends string>(
  selected: Mode,
  choices: ReadonlyArray<SearchModeChoice<Mode>>,
  onSelect: (mode: Mode) => Message,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [
      h.Class("search-mode-picker"),
      h.Role("group"),
      h.AriaLabel("Search mode"),
    ],
    choices.map((choice) =>
      button(
        h,
        [
          h.Key(choice.mode),
          h.Type("button"),
          h.Class(
            `search-mode-button${selected === choice.mode ? " is-active" : ""}`,
          ),
          h.AriaLabel(choice.label),
          h.AriaPressed(String(selected === choice.mode)),
          h.Title(choice.label),
          h.OnClick(onSelect(choice.mode)),
        ],
        [choice.symbol],
      ),
    ),
  );
