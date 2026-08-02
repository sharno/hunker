import { Button, Input, Textarea } from "@foldkit/ui";
import type { Attribute, Html, HtmlBuilder } from "foldkit/html";

export const button = <Message>(
  h: HtmlBuilder<Message>,
  attributes: ReadonlyArray<Attribute<Message>>,
  children: ReadonlyArray<Html | string>,
): Html =>
  Button.view(
    {
      toView: (generated) =>
        h.button([...generated.button, ...attributes], children),
    },
    h,
  );

export const input = <Message>(
  id: string,
  h: HtmlBuilder<Message>,
  attributes: ReadonlyArray<Attribute<Message>>,
): Html =>
  Input.view(
    {
      id,
      toView: (generated) => h.input([...generated.input, ...attributes]),
    },
    h,
  );

export const textarea = <Message>(
  id: string,
  h: HtmlBuilder<Message>,
  attributes: ReadonlyArray<Attribute<Message>>,
): Html =>
  Textarea.view(
    {
      id,
      toView: (generated) =>
        h.textarea([...generated.textarea, ...attributes], []),
    },
    h,
  );
