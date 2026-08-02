import { Option } from "effect";
import {
  expectNoOutMessage,
  expectOutMessage,
  given,
  message,
  model,
  story,
} from "foldkit/story";
import { describe, expect, test } from "vitest";

import { SubmittedForm, SubmittedLocation, UpdatedInput } from "./message";
import { init } from "./model";
import { update } from "./update";

describe("GitHub location update", () => {
  test("editing clears errors without emitting parent output", () => {
    story(
      update,
      given(init("", false)),
      message(UpdatedInput({ value: "https://github.com/foldkit/foldkit" })),
      model((model) => {
        expect(model.value).toBe("https://github.com/foldkit/foldkit");
        expect(model.maybeError).toStrictEqual(Option.none());
      }),
      expectNoOutMessage(),
    );
  });

  test("submitting emits the trimmed location to the parent", () => {
    story(
      update,
      given(init("  https://github.com/foldkit/foldkit  ", false)),
      message(SubmittedForm()),
      expectOutMessage(
        SubmittedLocation({ value: "https://github.com/foldkit/foldkit" }),
      ),
    );
  });
});
