import { describe, expect, test } from "vitest";

import {
  localRepositoryUrl,
  repositoryOptionsFromSearch,
  repositoryRouteFromPathname,
} from "./update";

describe("repository routes", () => {
  test("round-trips GitHub-shaped paths and browser options", () => {
    expect(repositoryRouteFromPathname("/radarlabs/server")).toEqual({
      owner: "radarlabs",
      name: "server",
    });
    expect(repositoryRouteFromPathname("/repo/radarlabs/server")).toEqual({
      owner: "radarlabs",
      name: "server",
    });
    expect(repositoryRouteFromPathname("/radarlabs/server/pulls")).toEqual({
      owner: "radarlabs",
      name: "server",
    });
    expect(
      repositoryRouteFromPathname("/radarlabs/server/commits/main"),
    ).toEqual({ owner: "radarlabs", name: "server" });
    expect(
      repositoryRouteFromPathname("/repo/%E0%A4%A/server"),
    ).toBeUndefined();
    expect(
      localRepositoryUrl(
        { owner: "radarlabs", name: "server" },
        {
          query: "config key",
          searchMode: "regex",
          pullRequestFilter: "open",
          file: "src/config.ts",
          tab: "files",
        },
      ),
    ).toBe(
      "/radarlabs/server/blob/HEAD/src/config.ts?q=config+key&search=regex",
    );
    expect(
      localRepositoryUrl(
        { owner: "radarlabs", name: "server" },
        {
          query: "",
          searchMode: "literal",
          pullRequestFilter: "all",
          file: "",
          tab: "pulls",
        },
      ),
    ).toBe("/radarlabs/server/pulls?state=all");
    expect(
      repositoryOptionsFromSearch("?q=config+key&file=src%2Fconfig.ts"),
    ).toEqual({
      query: "config key",
      searchMode: "literal",
      file: "src/config.ts",
      tab: "files",
      pullRequestFilter: "open",
    });
    expect(repositoryOptionsFromSearch("?view=commits").tab).toBe("commits");
    expect(repositoryOptionsFromSearch("?search=fuzzy").searchMode).toBe(
      "fuzzy",
    );
  });
});
