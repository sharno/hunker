import { inertHtml as ih } from "foldkit/html";
import {
  Command,
  all,
  click,
  expect,
  expectAll,
  given,
  label,
  role,
  scene,
  selector,
  submit,
  text,
  type as typeText,
  withViewInputs,
} from "foldkit/scene";
import { describe, test } from "vitest";

import {
  CloneRepository,
  CanonicalizeRepositoryLocation,
  FetchRepositoryCommits,
  FetchRepositoryFile,
  FetchRepositoryFiles,
  FetchRepositoryPullRequests,
  SearchRepository,
  VisitRepositoryLocation,
} from "./command";
import {
  CompletedNavigate,
  SucceededCloneRepository,
  SucceededFetchRepositoryCommits,
  SucceededFetchRepositoryFile,
  SucceededFetchRepositoryFiles,
  SucceededFetchRepositoryPullRequests,
  SucceededSearchRepository,
} from "./message";
import { Files, Model, SearchMatch, empty } from "./model";
import { update } from "./update";
import { view } from "./view";
import {
  FailedFetch as FailedFetchSourceControl,
  Fetch as FetchSourceControl,
} from "./source-control";

const repository = "example/hunker-demo";
const files = [
  { path: "src/greet.ts", size: 143, gitStatus: "clean" },
  { path: "src/message.ts", size: 82, gitStatus: "clean" },
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
  collapsedFolders: ["src"],
});
const repositoryView = withViewInputs(view, {
  homeHref: "/",
  settingsHref: "/settings",
  renderLocationForm: () => ih.empty,
});

describe("repository browser", () => {
  test("expands the nested file tree through its accessible folder control", () => {
    scene(
      { update, view: repositoryView() },
      given(loaded),
      expectAll(all.selector(".repository-file-row")).toHaveCount(1),
      click(role("button", { name: "Expand src" })),
      expectAll(all.selector(".repository-file-row")).toHaveCount(3),
      expect(text("greet.ts")).toExist(),
      click(role("button", { name: "Collapse src" })),
      expect(text("greet.ts")).toBeAbsent(),
    );
  });

  test("searches with FFF, opens a match, and returns to the results", () => {
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

    scene(
      { update, view: repositoryView() },
      given(loaded),
      typeText(label("Search repository files and contents"), "gret person"),
      submit(selector(".repository-search")),
      Command.resolveAll(
        [
          SearchRepository,
          SucceededSearchRepository({
            repository,
            query: "gret person",
            mode: "literal",
            files: [primaryRepositoryFile],
            matches: [match],
          }),
        ],
        [VisitRepositoryLocation, CompletedNavigate()],
      ),
      expect(selector(".repository-search-match")).toContainText(
        "return `hello ${person}`",
      ),
      click(selector(".repository-search-match")),
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
        [VisitRepositoryLocation, CompletedNavigate()],
      ),
      expect(role("button", { name: "← Search results" })).toExist(),
      expect(selector(".repository-file-view")).toContainText("src/greet.ts"),
      click(role("button", { name: "← Search results" })),
      Command.resolve(VisitRepositoryLocation, CompletedNavigate()),
      expect(selector(".repository-search-match")).toExist(),
    );
  });

  test("switches search modes without opening a native select menu", () => {
    scene(
      { update, view: repositoryView() },
      given(loaded),
      expect(selector(".repository-search select")).toBeAbsent(),
      expect(
        role("button", { name: "Literal text search", pressed: true }),
      ).toExist(),
      click(role("button", { name: "Regular expression search" })),
      Command.resolve(CanonicalizeRepositoryLocation, CompletedNavigate()),
      expect(
        role("button", { name: "Regular expression search", pressed: true }),
      ).toExist(),
      expect(label("Search repository files and contents")).toHaveAttr(
        "placeholder",
        "Search with a regular expression",
      ),
      click(role("button", { name: "Fuzzy FFF search" })),
      Command.resolve(CanonicalizeRepositoryLocation, CompletedNavigate()),
      expect(
        role("button", { name: "Fuzzy FFF search", pressed: true }),
      ).toExist(),
      expect(label("Search repository files and contents")).toHaveAttr(
        "placeholder",
        "Find approximate matches",
      ),
    );
  });

  test("clones a missing repository from the rendered offer", () => {
    const missing = Model.make({
      ...loaded,
      files: Files.Failure({
        error: { message: "Local repository not found.", missing: true },
      }),
    });

    scene(
      { update, view: repositoryView() },
      given(missing),
      expect(
        role("heading", { name: "Clone this repository for local browsing" }),
      ).toExist(),
      click(role("button", { name: "Clone to /tmp" })),
      Command.resolve(
        CloneRepository,
        SucceededCloneRepository({ repository, path: "/tmp/hunker-demo" }),
      ),
      Command.resolveAll(
        [
          FetchRepositoryFiles,
          SucceededFetchRepositoryFiles({ repository, files }),
        ],
        [
          FetchSourceControl,
          FailedFetchSourceControl({
            repository,
            error: "Source control unavailable in this fixture.",
          }),
        ],
      ),
      expect(role("navigation", { name: "Repository files" })).toExist(),
    );
  });

  test("paginates the pull-request list through rendered controls", () => {
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
      title: "Add repository browsing",
    };

    scene(
      { update, view: repositoryView() },
      given(loaded),
      click(role("button", { name: "Pull requests" })),
      Command.resolveAll(
        [
          FetchRepositoryPullRequests,
          SucceededFetchRepositoryPullRequests({
            repository,
            state: "open",
            page: 1,
            hasMore: true,
            pullRequests: [firstPull],
          }),
        ],
        [VisitRepositoryLocation, CompletedNavigate()],
      ),
      expect(role("link", { name: /Refine the diff viewer/ })).toHaveAttr(
        "href",
        "/example/hunker-demo/pull/42",
      ),
      click(role("button", { name: "Load more" })),
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
      expectAll(all.selector(".repository-pull-row")).toHaveCount(2),
    );
  });

  test("opens the local commit list with canonical commit-review links", () => {
    const sha = "abcdef1234567890abcdef1234567890abcdef12";
    scene(
      { update, view: repositoryView() },
      given(loaded),
      click(role("button", { name: "Commits" })),
      Command.resolveAll(
        [
          FetchRepositoryCommits,
          SucceededFetchRepositoryCommits({
            repository,
            ref: "main",
            shallow: false,
            commits: [
              {
                sha,
                parents: [],
                authorName: "Octo Cat",
                authorEmail: "octo@example.com",
                authoredAt: "2026-08-02T12:00:00Z",
                subject: "Add repository commit history",
              },
            ],
          }),
        ],
        [VisitRepositoryLocation, CompletedNavigate()],
      ),
      expect(
        role("link", { name: /Add repository commit history/ }),
      ).toHaveAttr("href", `/example/hunker-demo/commit/${sha}`),
      expect(selector(".commits-heading")).toContainText("On main"),
    );
  });
});
