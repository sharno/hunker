import type { Html, HtmlBuilder } from "foldkit/html";

import {
  ChangedRepositoryQuery,
  ClosedRepositoryFile,
  RequestedRepositoryClone,
  SelectedRepositoryFile,
  SubmittedRepositorySearch,
} from "../domain";
import type {
  Message,
  Model,
  RepositoryFile,
  RepositorySearchMatch,
} from "../domain";
import { syntaxHighlightedContent } from "./syntax-highlight";
import { githubLocationForm } from "./github-location-view";

const formatSize = (bytes: number) =>
  bytes < 1_024
    ? `${bytes} B`
    : bytes < 1_048_576
      ? `${Math.round(bytes / 1_024)} KB`
      : `${(bytes / 1_048_576).toFixed(1)} MB`;

const repositoryFileButton = (
  file: RepositoryFile,
  selected: boolean,
  h: HtmlBuilder<Message>,
): Html =>
  h.button(
    [
      h.Key(file.path),
      h.Type("button"),
      h.Class(`repository-file-row${selected ? " is-selected" : ""}`),
      h.OnClick(SelectedRepositoryFile({ path: file.path })),
    ],
    [
      h.span([h.Class("repository-file-icon")], ["·/"]),
      h.span([], [file.path]),
      h.small([], [formatSize(file.size)]),
    ],
  );

const searchSnippet = (
  match: RepositorySearchMatch,
  h: HtmlBuilder<Message>,
): Html => {
  const lines = [...match.contextBefore, match.lineContent, ...match.contextAfter];
  const firstLine = Math.max(1, match.line - match.contextBefore.length);
  return h.button(
    [
      h.Key(`${match.path}:${match.line}:${match.column}`),
      h.Type("button"),
      h.Class(`repository-search-match${match.definition ? " is-definition" : ""}`),
      h.OnClick(SelectedRepositoryFile({ path: match.path })),
    ],
    [
      h.div([h.Class("repository-match-heading")], [
        h.strong([], [match.path]),
        h.code([], [`:${match.line}`]),
        match.definition ? h.span([], ["definition"]) : h.empty,
      ]),
      h.pre(
        [],
        lines.map((line, index) =>
          h.div(
            [
              h.Key(`${match.path}-${firstLine + index}`),
              h.Class(index === match.contextBefore.length ? "is-match" : ""),
            ],
            [
              h.span([], [String(firstLine + index)]),
              h.code([], [line || " "]),
            ],
          ),
        ),
      ),
    ],
  );
};

const repositorySearchResults = (
  model: Model,
  h: HtmlBuilder<Message>,
): Html => {
  const state = model.repositoryBrowser.search;
  if (state._tag === "Loading") {
    return h.div([h.Class("repository-results-state")], [
      h.strong([], [`Searching for “${state.query}”…`]),
      h.span([], ["FFF is ranking filenames and matching file contents locally."]),
    ]);
  }
  if (state._tag === "Failed") {
    return h.div([h.Class("repository-results-state is-error"), h.Role("alert")], [
      h.strong([], ["Search failed"]),
      h.span([], [state.error]),
    ]);
  }
  if (state._tag !== "Ready") return h.empty;
  return h.div([h.Class("repository-search-results")], [
    h.section([], [
      h.h2([], [`Filename matches · ${state.files.length}`]),
      state.files.length === 0
        ? h.p([], ["No fuzzy filename matches."])
        : h.div(
            [h.Class("repository-filename-results")],
            state.files.map(file =>
              repositoryFileButton(
                file,
                file.path === model.repositoryBrowser.selectedPath,
                h,
              ),
            ),
          ),
    ]),
    h.section([], [
      h.h2([], [`Content matches · ${state.matches.length}`]),
      state.matches.length === 0
        ? h.p([], ["No fuzzy content matches."])
        : h.div(
            [h.Class("repository-content-results")],
            state.matches.map(match => searchSnippet(match, h)),
          ),
    ]),
  ]);
};

const repositoryFileView = (
  model: Model,
  h: HtmlBuilder<Message>,
): Html => {
  const state = model.repositoryBrowser.file;
  if (state._tag === "Loading") {
    return h.div([h.Class("repository-results-state")], [
      h.strong([], [`Opening ${state.path}…`]),
    ]);
  }
  if (state._tag === "Failed") {
    return h.div([h.Class("repository-results-state is-error"), h.Role("alert")], [
      h.strong([], ["Could not open file"]),
      h.span([], [state.error]),
    ]);
  }
  if (state._tag !== "Ready") return h.empty;
  return h.section([h.Class("repository-file-view")], [
    h.div([h.Class("repository-file-heading")], [
      h.button(
        [
          h.Type("button"),
          h.Class("commit-back"),
          h.OnClick(ClosedRepositoryFile()),
        ],
        [model.repositoryBrowser.query === "" ? "← File list" : "← Search results"],
      ),
      h.strong([], [state.path]),
      state.truncated ? h.span([], ["First 500k characters shown"]) : h.empty,
    ]),
    h.pre([h.Class("repository-source")], [
      h.code([], syntaxHighlightedContent(state.path, state.content, true, [], h)),
    ]),
  ]);
};

const repositoryCloneView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const clone = model.repositoryBrowser.clone;
  const loading = clone._tag === "Loading";
  return h.section([h.Class("repository-clone-offer")], [
    h.span([h.Class("repository-clone-mark")], ["git"]),
    h.h1([], ["Clone this repository for local browsing"]),
    h.p([], [
      "Hunker could not find this repository locally. A temporary clone keeps your repos root clean; a configured clone makes it a normal local checkout.",
    ]),
    clone._tag === "Failed"
      ? h.div([h.Class("repository-clone-error"), h.Role("alert")], [clone.error])
      : h.empty,
    h.div([h.Class("repository-clone-actions")], [
      h.button(
        [
          h.Type("button"),
          h.Disabled(loading),
          h.OnClick(RequestedRepositoryClone({ destination: "temporary" })),
        ],
        [loading && clone.destination === "temporary" ? "Cloning…" : "Clone to /tmp"],
      ),
      h.button(
        [
          h.Type("button"),
          h.Disabled(loading),
          h.OnClick(RequestedRepositoryClone({ destination: "configured" })),
        ],
        [
          loading && clone.destination === "configured"
            ? "Cloning…"
            : "Clone to repos root",
        ],
      ),
    ]),
    h.small([], [
      "Private repositories use the same local gh authentication as PR loading.",
    ]),
  ]);
};

export const repositoryView = (
  model: Model,
  h: HtmlBuilder<Message>,
): Html => {
  const browser = model.repositoryBrowser;
  const files = browser.files._tag === "Ready" ? browser.files.files : [];
  return h.main([h.Class("repository-shell")], [
    h.header([h.Class("repository-toolbar")], [
      h.a([h.Class("compact-brand"), h.Href("/")], [
        h.span([h.Class("brand-mark")], ["H"]),
        h.span([h.Class("brand-name")], ["hunker"]),
      ]),
      h.div([h.Class("repository-identity")], [
        h.span([], ["Local repository"]),
        h.strong([], [`${browser.owner}/${browser.name}`]),
      ]),
      githubLocationForm(model, "repository-github-loader", h),
      h.form(
        [h.Class("repository-search"), h.OnSubmit(SubmittedRepositorySearch())],
        [
          h.span([], ["⌕"]),
          h.input([
            h.Type("search"),
            h.Value(browser.query),
            h.Placeholder("Fuzzy search files and contents"),
            h.AriaLabel("Search repository files and contents"),
            h.OnInput(value => ChangedRepositoryQuery({ value })),
          ]),
          h.button([h.Type("submit")], ["Search"]),
        ],
      ),
      h.a(
        [
          h.Class("repository-github-link"),
          h.Href(`https://github.com/${browser.owner}/${browser.name}`),
          h.Target("_blank"),
          h.Rel("noreferrer"),
        ],
        ["GitHub ↗"],
      ),
    ]),
    model.githubInputError === ""
      ? h.empty
      : h.div([h.Class("error-banner"), h.Role("alert")], [model.githubInputError]),
    browser.files._tag === "Failed" && !browser.files.missing
      ? h.div([h.Class("error-banner"), h.Role("alert")], [browser.files.error])
      : h.empty,
    h.div([h.Class("repository-workspace")], [
      h.aside([h.Class("repository-tree")], [
        h.div([h.Class("repository-tree-heading")], [
          h.strong([], ["Files"]),
          h.span([], [
            browser.files._tag === "Loading" ? "Indexing…" : String(files.length),
          ]),
        ]),
        h.nav(
          [h.AriaLabel("Repository files")],
          files.map(file =>
            repositoryFileButton(file, file.path === browser.selectedPath, h),
          ),
        ),
      ]),
      h.div([h.Class("repository-main")], [
        browser.files._tag === "Failed" && browser.files.missing
          ? repositoryCloneView(model, h)
          : browser.selectedPath !== ""
          ? repositoryFileView(model, h)
          : browser.query !== ""
            ? repositorySearchResults(model, h)
            : h.section([h.Class("repository-welcome")], [
                h.span([], ["FFF"]),
                h.h1([], [`Browse ${browser.name}`]),
                h.p([], [
                  "Choose a file from the local index, or fuzzy search filenames and code contents.",
                ]),
              ]),
      ]),
    ]),
  ]);
};
