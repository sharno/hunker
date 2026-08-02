import { Match as M, Option } from "effect";
import { Update } from "foldkit";
import { evo } from "foldkit/struct";

import type { Model } from "./model";
import { type Message, type OutMessage, SubmittedLocation } from "./message";

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>;
const withUpdateReturn = M.withReturnType<UpdateReturn>();

export const update = (model: Model, message: Message): UpdateReturn =>
  M.value(message).pipe(
    withUpdateReturn,
    M.tagsExhaustive({
      UpdatedInput: ({ value }) => [
        evo(model, {
          value: () => value,
          maybeError: () => Option.none(),
        }),
        [],
        Option.none(),
      ],
      SubmittedForm: () => {
        const value = model.value.trim();
        if (model.isLoading || value === "") {
          return [model, [], Option.none()];
        }
        return [model, [], Option.some(SubmittedLocation({ value }))];
      },
    }),
  );
