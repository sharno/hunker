import { expect, test } from "@playwright/test";

import { decodeResolvedThreadsPage } from "../backend/github-reviews";

test("decodes resolved GitHub review threads and their pagination cursor", () => {
  expect(
    decodeResolvedThreadsPage({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                {
                  isResolved: true,
                  comments: { nodes: [{ fullDatabaseId: "100" }] },
                },
                {
                  isResolved: false,
                  comments: { nodes: [{ fullDatabaseId: "200" }] },
                },
              ],
              pageInfo: { hasNextPage: true, endCursor: "next-page" },
            },
          },
        },
      },
    }),
  ).toEqual({
    resolutions: [
      [100, true],
      [200, false],
    ],
    nextCursor: "next-page",
  });
});
