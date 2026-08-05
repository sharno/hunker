import { Command, given, message, model, story } from "foldkit/story";
import { describe, expect, test } from "vitest";

import { PostInlineComment } from "./command";
import {
  FailedPostInlineComment,
  OpenedInlineComment,
  SubmittedInlineComment,
  SucceededPostInlineComment,
  UpdatedInlineCommentBody,
} from "./message";
import { type Target, empty } from "./model";
import { update } from "./update";

const target: Target = {
  pullUrl: "https://github.com/example/hunker/pull/42",
  commitId: "2222222222222222222222222222222222222222",
  path: "src/review.ts",
  line: 18,
  side: "RIGHT",
};

const postedComment = {
  id: 101,
  rootId: 101,
  path: target.path,
  body: "Could we keep this name?",
  author: "local-reviewer",
  htmlUrl: `${target.pullUrl}#discussion_r101`,
  createdAt: "2026-08-05T12:00:00Z",
  line: target.line,
  side: target.side,
  resolved: false,
};

describe("inline comment update", () => {
  test("posts a comment bound to the loaded pull request revision", () => {
    story(
      update,
      given(empty()),
      message(OpenedInlineComment({ target })),
      message(UpdatedInlineCommentBody({ body: "Could we keep this name?" })),
      message(OpenedInlineComment({ target })),
      model((state) => {
        expect(state.state).toMatchObject({
          _tag: "Editing",
          body: "Could we keep this name?",
        });
      }),
      message(SubmittedInlineComment()),
      Command.expectExact(
        PostInlineComment({ target, body: "Could we keep this name?" }),
      ),
      Command.resolve(
        PostInlineComment,
        SucceededPostInlineComment({ target, comment: postedComment }),
      ),
      model((state) => {
        expect(state.state._tag).toBe("Closed");
      }),
    );
  });

  test("keeps the draft when GitHub rejects the line anchor", () => {
    story(
      update,
      given(empty()),
      message(OpenedInlineComment({ target })),
      message(UpdatedInlineCommentBody({ body: "Please explain this." })),
      message(SubmittedInlineComment()),
      Command.resolve(
        PostInlineComment,
        FailedPostInlineComment({
          target,
          error:
            "GitHub rejected this review action. Refresh the PR and try again.",
        }),
      ),
      model((state) => {
        expect(state.state).toMatchObject({
          _tag: "PostFailed",
          body: "Please explain this.",
        });
      }),
    );
  });
});
