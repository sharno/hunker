import { Command, given, message, model, story } from "foldkit/story";
import { describe, expect, test } from "vitest";

import {
  CloneRepository,
  FetchRepositoryFile,
  FetchRepositoryFiles,
  FetchRepositoryPullRequests,
  NavigateRepository,
  SearchRepository,
} from "./command";
import {
  ClickedCloneRepository,
  ClickedLoadMorePullRequests,
  CompletedNavigate,
  SelectedRepositoryFile,
  SelectedRepositorySearchMode,
  SubmittedRepositorySearch,
  SucceededCloneRepository,
  SucceededFetchRepositoryFile,
  SucceededFetchRepositoryFiles,
  SucceededFetchRepositoryPullRequests,
  SucceededSearchRepository,
  ToggledRepositoryFolder,
  UpdatedRepositoryQuery,
} from "./message";
import { Files, Model, PullRequests, SearchMatch, empty } from "./model";
import { update } from "./update";

const repository = "example/hunker-demo";
const files = [
  { path: "src/greet.ts", size: 143, gitStatus: "clean" },
  { path: "README.md", size: 512, gitStatus: "clean" },
];
const primaryRepositoryFile = files[0];
if (primaryRepositoryFile === undefined)
  throw new Error("The repository fixture needs a source file");

const loaded = Model.make({
  ...empty(),
  owner: "example",
  name: "hunker-demo",
  files: Files.Success({ data: files }),
});

describe("repository browser update", () => {
  test("owns repository search input state", () => {
    story(
      update,
      given(empty()),
      message(UpdatedRepositoryQuery({ value: "semantic diff" })),
      model((state) => {
        expect(state.query).toBe("semantic diff");
      }),
    );
  });

  test("owns its nested folder expansion state", () => {
    story(
      update,
      given(empty()),
      message(ToggledRepositoryFolder({ path: "src/page" })),
      model((state) => {
        expect(state.collapsedFolders).toStrictEqual(["src/page"]);
      }),
      message(ToggledRepositoryFolder({ path: "src/page" })),
      model((state) => {
        expect(state.collapsedFolders).toStrictEqual([]);
      }),
    );
  });

  test("clones a missing repository and reloads its file index", () => {
    const missing = Model.make({
      ...loaded,
      files: Files.Failure({
        error: { message: "Local repository not found.", missing: true },
      }),
    });

    story(
      update,
      given(missing),
      message(ClickedCloneRepository({ destination: "temporary" })),
      Command.expectExact(
        CloneRepository({ repository, destination: "temporary" }),
      ),
      Command.resolve(
        CloneRepository,
        SucceededCloneRepository({ repository, path: "/tmp/hunker-demo" }),
      ),
      Command.expectExact(FetchRepositoryFiles({ repository })),
      Command.resolve(
        FetchRepositoryFiles,
        SucceededFetchRepositoryFiles({ repository, files }),
      ),
      model((state) => {
        expect(state.files).toStrictEqual(Files.Success({ data: files }));
      }),
    );
  });

  test("ignores a late file response from a repository that is no longer open", () => {
    story(
      update,
      given(loaded),
      message(
        SucceededFetchRepositoryFiles({
          repository: "example/previous",
          files: [{ path: "stale.ts", size: 1, gitStatus: "clean" }],
        }),
      ),
      model((state) => {
        expect(state.files).toStrictEqual(Files.Success({ data: files }));
      }),
    );
  });

  test("paginates pull requests while preserving the current page", () => {
    const firstPull = {
      number: 42,
      title: "Refine the diff viewer",
      author: "review-agent",
      avatarUrl: "",
      state: "open" as const,
      draft: false,
      updatedAt: "2026-08-02T12:00:00Z",
      base: "main",
      head: "feature/review",
      labels: ["frontend"],
    };
    const secondPull = {
      ...firstPull,
      number: 41,
      title: "Browse repositories",
    };
    const pulls = Model.make({
      ...loaded,
      tab: "pulls",
      pullRequests: PullRequests.Success({
        data: {
          state: "open",
          page: 1,
          hasMore: true,
          pullRequests: [firstPull],
        },
      }),
    });

    story(
      update,
      given(pulls),
      message(ClickedLoadMorePullRequests()),
      Command.expectExact(
        FetchRepositoryPullRequests({ repository, state: "open", page: 2 }),
      ),
      model((state) => {
        expect(state.pullRequests._tag).toBe("Refreshing");
      }),
      Command.resolve(
        FetchRepositoryPullRequests,
        SucceededFetchRepositoryPullRequests({
          repository,
          state: "open",
          page: 2,
          hasMore: false,
          pullRequests: [secondPull],
        }),
      ),
      model((state) => {
        expect(state.pullRequests._tag).toBe("Success");
        if (state.pullRequests._tag !== "Success") return;
        expect(state.pullRequests.data.pullRequests).toStrictEqual([
          firstPull,
          secondPull,
        ]);
      }),
    );
  });

  test("searches, opens a matching file, and returns to results", () => {
    const match = SearchMatch.make({
      path: "src/greet.ts",
      line: 2,
      column: 10,
      lineContent: "  return `hello ${person}`;",
      contextBefore: ["export function greet(person: string) {"],
      contextAfter: ["}"],
      ranges: [[10, 15]],
      definition: false,
    });
    const content =
      "export function greet(person: string) {\n  return `hello ${person}`;\n}\n";

    story(
      update,
      given(loaded),
      message(SelectedRepositorySearchMode({ mode: "fuzzy" })),
      Command.resolve(NavigateRepository, CompletedNavigate()),
      message(UpdatedRepositoryQuery({ value: "gret person" })),
      message(SubmittedRepositorySearch()),
      Command.expectExact(
        SearchRepository({
          repository,
          query: "gret person",
          mode: "fuzzy",
        }),
        NavigateRepository({
          href: "/example/hunker-demo?q=gret+person&search=fuzzy",
        }),
      ),
      Command.resolveAll(
        [
          SearchRepository,
          SucceededSearchRepository({
            repository,
            query: "gret person",
            mode: "fuzzy",
            files: [primaryRepositoryFile],
            matches: [match],
          }),
        ],
        [NavigateRepository, CompletedNavigate()],
      ),
      message(SelectedRepositoryFile({ path: "src/greet.ts" })),
      Command.resolveAll(
        [
          FetchRepositoryFile,
          SucceededFetchRepositoryFile({
            repository,
            path: "src/greet.ts",
            content,
            truncated: false,
          }),
        ],
        [NavigateRepository, CompletedNavigate()],
      ),
      model((state) => {
        expect(state.selectedPath).toBe("src/greet.ts");
        expect(state.file._tag).toBe("Success");
      }),
    );
  });
});
