import { Array, Option } from "effect";
import { AsyncData, Submodel } from "foldkit";
import { createLazy } from "foldkit/html";
import type { Html, HtmlBuilder } from "foldkit/html";

import { button, input } from "../../view/control";
import {
  ClickedCloseRepositoryFile,
  ClickedCloneRepository,
  type Message,
  SelectedRepositoryFile,
  SelectedRepositorySearchMode,
  SelectedRepositoryTab,
  SubmittedRepositorySearch,
  ToggledRepositoryFolder,
  UpdatedRepositoryQuery,
} from "./message";
import type { RepositorySearchMode } from "../../features/code-search";
import type {
  Commit,
  File as RepositoryFile,
  Model,
  SearchMatch as RepositorySearchMatch,
} from "./model";
import { syntaxHighlightedContent } from "../../view/syntax-highlight";
import { fileTreeView } from "../../view/file-tree-view";
import { commitRouter } from "../../app-route";
import { repositoryPullRequestsView } from "./pulls-view";
import { withTailwind } from "../../view/tailwind";

export type ViewInputs = Readonly<{
  homeHref: string;
  settingsHref: string;
  renderLocationForm: () => Html;
}>;

const formatSize = (bytes: number) =>
  bytes < 1_024
    ? `${bytes} B`
    : bytes < 1_048_576
      ? `${Math.round(bytes / 1_024)} KB`
      : `${(bytes / 1_048_576).toFixed(1)} MB`;

const authoredDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
};

const repositorySearchMode = (value: string): RepositorySearchMode =>
  value === "regex" ? "regex" : value === "fuzzy" ? "fuzzy" : "literal";

const searchDescription = (mode: RepositorySearchMode) =>
  mode === "fuzzy"
    ? "FFF is ranking approximate filename and content matches locally."
    : mode === "regex"
      ? "ripgrep is applying the expression across the local repository."
      : "ripgrep is matching exact text across the local repository.";

const searchKind = (mode: RepositorySearchMode) =>
  mode === "fuzzy" ? "fuzzy" : mode === "regex" ? "regex" : "literal";

const repositoryCommitRow = (
  model: Model,
  commit: Commit,
  h: HtmlBuilder<Message>,
): Html =>
  h.a(
    [
      h.Key(commit.sha),
      h.Class("commit-row repository-commit-row"),
      h.Href(
        commitRouter({
          owner: model.owner,
          repository: model.name,
          sha: commit.sha,
        }),
      ),
    ],
    [
      h.span(
        [h.Class("commit-avatar")],
        [commit.authorName.slice(0, 2).toUpperCase()],
      ),
      h.span(
        [h.Class("commit-copy")],
        [
          h.strong([], [commit.subject]),
          h.small(
            [],
            [
              `${commit.authorName} committed ${authoredDate(commit.authoredAt)}`,
            ],
          ),
        ],
      ),
      h.code([h.Class("commit-sha")], [commit.sha.slice(0, 7)]),
      h.span([h.Class("commit-open-arrow")], ["→"]),
    ],
  );

const repositoryCommitsView = (model: Model, h: HtmlBuilder<Message>): Html => {
  if (AsyncData.isPending(model.commits)) {
    return h.section(
      [h.Class("commits-state"), h.Role("status")],
      [
        h.span([h.Class("semantic-icon")], ["◌"]),
        h.strong([], ["Loading commits…"]),
        h.span([], ["Reading the checked-out Git history locally."]),
      ],
    );
  }
  if (AsyncData.isFailure(model.commits)) {
    return h.section(
      [h.Class("commits-state is-error"), h.Role("alert")],
      [
        h.span([h.Class("semantic-icon")], ["!"]),
        h.strong([], ["Could not load commits"]),
        h.span([], [model.commits.error]),
        button(
          h,
          [
            h.Type("button"),
            h.Class("context-button"),
            h.OnClick(SelectedRepositoryTab({ tab: "commits" })),
          ],
          ["Retry"],
        ),
      ],
    );
  }
  const data = Option.getOrUndefined(AsyncData.getData(model.commits));
  if (data === undefined) return h.empty;
  return h.section(
    [h.Class("commits-browser repository-commits-browser")],
    [
      h.div(
        [h.Class("commits-heading")],
        [
          h.div(
            [],
            [
              h.h2(
                [],
                [
                  `${data.commits.length} ${data.commits.length === 1 ? "commit" : "commits"}`,
                ],
              ),
              h.p(
                [],
                [
                  `On ${data.ref}${data.shallow ? " · shallow history" : ""}. Select a commit to review its diff.`,
                ],
              ),
            ],
          ),
          h.span([], ["Newest → oldest"]),
        ],
      ),
      data.commits.length === 0
        ? h.div([h.Class("commits-empty")], ["No commits found at HEAD."])
        : h.div(
            [h.Class("commit-list")],
            data.commits.map((commit) => repositoryCommitRow(model, commit, h)),
          ),
    ],
  );
};

const repositoryFileButton = (
  file: RepositoryFile,
  label: string,
  selected: boolean,
  h: HtmlBuilder<Message>,
): Html =>
  button(
    h,
    [
      h.Key(file.path),
      h.Type("button"),
      h.Class(`repository-file-row${selected ? " is-selected" : ""}`),
      h.OnClick(SelectedRepositoryFile({ path: file.path })),
    ],
    [
      h.span([h.Class("repository-file-icon")], ["·/"]),
      h.span([], [label]),
      h.small([], [formatSize(file.size)]),
    ],
  );

const repositoryFileTree = (
  files: ReadonlyArray<RepositoryFile>,
  selectedPath: string,
  collapsedFolders: ReadonlyArray<string>,
  h: HtmlBuilder<Message>,
): Html =>
  fileTreeView(
    {
      files,
      pathOf: (file) => file.path,
      collapsedFolders,
      onToggleFolder: (path) => ToggledRepositoryFolder({ path }),
      renderFile: (file, name, builder) =>
        repositoryFileButton(file, name, file.path === selectedPath, builder),
    },
    h,
  );

const lazyRepositoryFileTree = createLazy();

const searchSnippet = (
  match: RepositorySearchMatch,
  h: HtmlBuilder<Message>,
): Html => {
  const lines = [
    ...match.contextBefore,
    match.lineContent,
    ...match.contextAfter,
  ];
  const firstLine = Math.max(1, match.line - match.contextBefore.length);
  return button(
    h,
    [
      h.Key(`${match.path}:${match.line}:${match.column}`),
      h.Type("button"),
      h.Class(
        `repository-search-match${match.definition ? " is-definition" : ""}`,
      ),
      h.OnClick(SelectedRepositoryFile({ path: match.path })),
    ],
    [
      h.div(
        [h.Class("repository-match-heading")],
        [
          h.strong([], [match.path]),
          h.code([], [`:${match.line}`]),
          match.definition ? h.span([], ["definition"]) : h.empty,
        ],
      ),
      h.pre(
        [],
        lines
          .map((line, index) => ({ line, lineNumber: firstLine + index }))
          .map(({ line, lineNumber }) =>
            h.div(
              [
                h.Key(`${match.path}-${lineNumber}`),
                h.Class(lineNumber === match.line ? "is-match" : ""),
              ],
              [h.span([], [String(lineNumber)]), h.code([], [line || " "])],
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
  const state = model.search;
  if (AsyncData.isPending(state)) {
    return h.div(
      [h.Class("repository-results-state")],
      [
        h.strong([], [`Searching for “${model.query}”…`]),
        h.span([], [searchDescription(model.searchMode)]),
      ],
    );
  }
  if (AsyncData.isFailure(state)) {
    return h.div(
      [h.Class("repository-results-state is-error"), h.Role("alert")],
      [h.strong([], ["Search failed"]), h.span([], [state.error])],
    );
  }
  const data = Option.getOrUndefined(AsyncData.getData(state));
  if (data === undefined) return h.empty;
  return h.div(
    [h.Class("repository-search-results")],
    [
      h.section(
        [],
        [
          h.h2([], [`Filename matches · ${data.files.length}`]),
          Array.match(data.files, {
            onEmpty: () =>
              h.p([], [`No ${searchKind(data.mode)} filename matches.`]),
            onNonEmpty: (files) =>
              h.div(
                [h.Class("repository-filename-results")],
                Array.map(files, (file) =>
                  repositoryFileButton(
                    file,
                    file.path,
                    file.path === model.selectedPath,
                    h,
                  ),
                ),
              ),
          }),
        ],
      ),
      h.section(
        [],
        [
          h.h2([], [`Content matches · ${data.matches.length}`]),
          Array.match(data.matches, {
            onEmpty: () =>
              h.p([], [`No ${searchKind(data.mode)} content matches.`]),
            onNonEmpty: (matches) =>
              h.div(
                [h.Class("repository-content-results")],
                Array.map(matches, (match) => searchSnippet(match, h)),
              ),
          }),
        ],
      ),
    ],
  );
};

const repositoryFileView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const state = model.file;
  if (AsyncData.isPending(state)) {
    return h.div(
      [h.Class("repository-results-state")],
      [h.strong([], [`Opening ${model.selectedPath}…`])],
    );
  }
  if (AsyncData.isFailure(state)) {
    return h.div(
      [h.Class("repository-results-state is-error"), h.Role("alert")],
      [h.strong([], ["Could not open file"]), h.span([], [state.error])],
    );
  }
  const data = Option.getOrUndefined(AsyncData.getData(state));
  if (data === undefined) return h.empty;
  return h.section(
    [h.Class("repository-file-view")],
    [
      h.div(
        [h.Class("repository-file-heading")],
        [
          button(
            h,
            [
              h.Type("button"),
              h.Class("commit-back"),
              h.OnClick(ClickedCloseRepositoryFile()),
            ],
            [model.query === "" ? "← File list" : "← Search results"],
          ),
          h.strong([], [data.path]),
          data.truncated
            ? h.span([], ["First 500k characters shown"])
            : h.empty,
        ],
      ),
      h.pre(
        [h.Class("repository-source")],
        [
          h.code(
            [],
            syntaxHighlightedContent(data.path, data.content, true, [], h),
          ),
        ],
      ),
    ],
  );
};

const repositoryCloneView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const clone = model.clone;
  const loading = AsyncData.isPending(clone);
  const error = Option.getOrUndefined(AsyncData.getError(clone));
  return h.section(
    [h.Class("repository-clone-offer")],
    [
      h.span([h.Class("repository-clone-mark")], ["git"]),
      h.h1([], ["Clone this repository for local browsing"]),
      h.p(
        [],
        [
          "Hunker could not find this repository locally. A temporary clone keeps your repos root clean; a configured clone makes it a normal local checkout.",
        ],
      ),
      error === undefined
        ? h.empty
        : h.div([h.Class("repository-clone-error"), h.Role("alert")], [error]),
      h.div(
        [h.Class("repository-clone-actions")],
        [
          button(
            h,
            [
              h.Type("button"),
              h.Disabled(loading),
              h.OnClick(ClickedCloneRepository({ destination: "temporary" })),
            ],
            [loading ? "Cloning…" : "Clone to /tmp"],
          ),
          button(
            h,
            [
              h.Type("button"),
              h.Disabled(loading),
              h.OnClick(ClickedCloneRepository({ destination: "configured" })),
            ],
            [loading ? "Cloning…" : "Clone to repos root"],
          ),
        ],
      ),
      h.small(
        [],
        [
          "Clones start shallow and fetch older history or blobs only when a view needs them. Private repositories use the same local gh authentication as PR loading.",
        ],
      ),
    ],
  );
};

export const view = Submodel.defineView<Model, Message, ViewInputs>(
  (model, viewInputs, html) => {
    const h = withTailwind(html);
    const files = AsyncData.getOrElse(model.files, () => []);
    const filesError = Option.getOrUndefined(AsyncData.getError(model.files));
    return h.main(
      [h.Class("repository-shell")],
      [
        h.header(
          [h.Class("repository-toolbar")],
          [
            h.a(
              [h.Class("compact-brand"), h.Href(viewInputs.homeHref)],
              [
                h.span([h.Class("brand-mark")], ["H"]),
                h.span([h.Class("brand-name")], ["hunker"]),
              ],
            ),
            h.div(
              [h.Class("repository-identity")],
              [
                h.span([], ["Local repository"]),
                h.strong([], [`${model.owner}/${model.name}`]),
              ],
            ),
            h.div(
              [h.Class("segmented repository-view-tabs")],
              [
                button(
                  h,
                  [
                    h.Type("button"),
                    h.Class(
                      `segmented-button${model.tab === "files" ? " is-active" : ""}`,
                    ),
                    h.OnClick(SelectedRepositoryTab({ tab: "files" })),
                  ],
                  ["Files"],
                ),
                button(
                  h,
                  [
                    h.Type("button"),
                    h.Class(
                      `segmented-button${model.tab === "pulls" ? " is-active" : ""}`,
                    ),
                    h.OnClick(SelectedRepositoryTab({ tab: "pulls" })),
                  ],
                  ["Pull requests"],
                ),
                button(
                  h,
                  [
                    h.Type("button"),
                    h.Class(
                      `segmented-button${model.tab === "commits" ? " is-active" : ""}`,
                    ),
                    h.OnClick(SelectedRepositoryTab({ tab: "commits" })),
                  ],
                  ["Commits"],
                ),
              ],
            ),
            viewInputs.renderLocationForm(),
            h.form(
              [
                h.Class(
                  `repository-search${model.tab !== "files" ? " is-hidden" : ""}`,
                ),
                h.OnSubmit(SubmittedRepositorySearch()),
              ],
              [
                h.span([], ["⌕"]),
                h.select(
                  [
                    h.Value(model.searchMode),
                    h.AriaLabel("Repository search mode"),
                    h.OnInput((value) =>
                      SelectedRepositorySearchMode({
                        mode: repositorySearchMode(value),
                      }),
                    ),
                  ],
                  [
                    h.option([h.Value("literal")], ["Text"]),
                    h.option([h.Value("regex")], ["Regex"]),
                    h.option([h.Value("fuzzy")], ["Fuzzy · FFF"]),
                  ],
                ),
                input("repository-query", h, [
                  h.Type("search"),
                  h.Value(model.query),
                  h.Placeholder(
                    model.searchMode === "regex"
                      ? "Search with a regular expression"
                      : model.searchMode === "fuzzy"
                        ? "Find approximate matches"
                        : "Search exact text",
                  ),
                  h.AriaLabel("Search repository files and contents"),
                  h.OnInput((value) => UpdatedRepositoryQuery({ value })),
                ]),
                button(h, [h.Type("submit")], ["Search"]),
              ],
            ),
            h.a(
              [
                h.Class("repository-github-link"),
                h.Href(`https://github.com/${model.owner}/${model.name}`),
                h.Target("_blank"),
                h.Rel("noopener noreferrer"),
              ],
              ["GitHub ↗"],
            ),
            h.a(
              [
                h.Class("repository-github-link"),
                h.Href(viewInputs.settingsHref),
              ],
              ["Settings"],
            ),
          ],
        ),
        model.tab !== "pulls" && filesError !== undefined && !filesError.missing
          ? h.div(
              [h.Class("error-banner"), h.Role("alert")],
              [filesError.message],
            )
          : h.empty,
        h.div(
          [
            h.Class(
              `repository-workspace${model.tab !== "files" ? " is-commits" : ""}`,
            ),
          ],
          [
            model.tab === "files"
              ? h.aside(
                  [h.Class("repository-tree")],
                  [
                    h.div(
                      [h.Class("repository-tree-heading")],
                      [
                        h.strong([], ["Files"]),
                        h.span(
                          [],
                          [
                            AsyncData.isPending(model.files)
                              ? "Indexing…"
                              : String(files.length),
                          ],
                        ),
                      ],
                    ),
                    h.nav(
                      [h.AriaLabel("Repository files")],
                      [
                        lazyRepositoryFileTree(repositoryFileTree, [
                          files,
                          model.selectedPath,
                          model.collapsedFolders,
                          h,
                        ]),
                      ],
                    ),
                  ],
                )
              : h.empty,
            h.div(
              [h.Class("repository-main")],
              [
                model.tab === "pulls"
                  ? repositoryPullRequestsView(model, h)
                  : filesError?.missing === true
                    ? repositoryCloneView(model, h)
                    : model.tab === "commits"
                      ? repositoryCommitsView(model, h)
                      : model.selectedPath !== ""
                        ? repositoryFileView(model, h)
                        : model.query !== ""
                          ? repositorySearchResults(model, h)
                          : h.section(
                              [h.Class("repository-welcome")],
                              [
                                h.span([], ["RG"]),
                                h.h1([], [`Browse ${model.name}`]),
                                h.p(
                                  [],
                                  [
                                    "Choose a file from the local index, search exact code with ripgrep, or switch to fuzzy discovery.",
                                  ],
                                ),
                              ],
                            ),
              ],
            ),
          ],
        ),
      ],
    );
  },
);
