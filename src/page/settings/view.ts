import { Option } from "effect";
import { AsyncData, Submodel } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

import { button, input } from "../../view/control";
import type { Message } from "./message";
import {
  SelectedSettingsInlineDiffMode,
  SelectedSettingsReviewScope,
  SelectedSettingsViewMode,
  SubmittedSettings,
  ToggledSettingsGitHubReviews,
  ToggledSettingsSemantic,
  ToggledSettingsSidebar,
  ToggledSettingsSyntaxHighlighting,
  ToggledSettingsWhitespace,
  UpdatedCacheRoot,
  UpdatedRepositoriesRoot,
} from "./message";
import type { Model } from "./model";
import { withTailwind } from "../../view/tailwind";

export type ViewInputs = Readonly<{ homeHref: string }>;

const choice = (
  label: string,
  active: boolean,
  message: Message,
  h: HtmlBuilder<Message>,
): Html =>
  button(
    h,
    [
      h.Type("button"),
      h.Class(`settings-choice${active ? " is-active" : ""}`),
      h.AriaPressed(String(active)),
      h.OnClick(message),
    ],
    [label],
  );

const toggle = (
  label: string,
  description: string,
  active: boolean,
  message: Message,
  h: HtmlBuilder<Message>,
): Html =>
  button(
    h,
    [
      h.Type("button"),
      h.Class(`settings-toggle${active ? " is-active" : ""}`),
      h.AriaPressed(String(active)),
      h.OnClick(message),
    ],
    [
      h.span([], [h.strong([], [label]), h.small([], [description])]),
      h.span([h.Class("settings-switch")], [h.i([], [""])]),
    ],
  );

const settingsForm = (model: Model, h: HtmlBuilder<Message>): Html => {
  const document = Option.getOrUndefined(AsyncData.getData(model.load));
  const saving = AsyncData.isPending(model.save);
  return h.form(
    [h.Class("settings-form"), h.OnSubmit(SubmittedSettings())],
    [
      h.section(
        [h.Class("settings-section")],
        [
          h.div(
            [h.Class("settings-section-heading")],
            [
              h.span([], ["01"]),
              h.div(
                [],
                [
                  h.h2([], ["Local repositories"]),
                  h.p(
                    [],
                    [
                      "Control where Hunker discovers repositories and stores temporary shallow clones.",
                    ],
                  ),
                ],
              ),
            ],
          ),
          h.label(
            [h.Class("settings-field")],
            [
              h.span([], ["Repositories root"]),
              input("settings-repositories-root", h, [
                h.Value(model.draft.repositoriesRoot),
                h.Placeholder("~/src"),
                h.OnInput((value) => UpdatedRepositoriesRoot({ value })),
              ]),
              h.small(
                [],
                [
                  "Hunker checks both owner/repository and repository directly under this folder.",
                ],
              ),
            ],
          ),
          h.label(
            [h.Class("settings-field")],
            [
              h.span([], ["Temporary clone root"]),
              input("settings-cache-root", h, [
                h.Value(model.draft.cacheRoot),
                h.Placeholder("/tmp/hunker/repositories"),
                h.OnInput((value) => UpdatedCacheRoot({ value })),
              ]),
              h.small(
                [],
                ["Shallow clones created with “Clone to /tmp” live here."],
              ),
            ],
          ),
        ],
      ),
      h.section(
        [h.Class("settings-section")],
        [
          h.div(
            [h.Class("settings-section-heading")],
            [
              h.span([], ["02"]),
              h.div(
                [],
                [
                  h.h2([], ["Review defaults"]),
                  h.p(
                    [],
                    [
                      "These preferences apply to every PR, compare, and commit view without cluttering shared URLs.",
                    ],
                  ),
                ],
              ),
            ],
          ),
          h.div(
            [h.Class("settings-choice-row")],
            [
              h.span([], ["Diff scope"]),
              h.div(
                [h.Class("settings-choices")],
                [
                  choice(
                    "One file",
                    model.draft.reviewScope === "file",
                    SelectedSettingsReviewScope({ value: "file" }),
                    h,
                  ),
                  choice(
                    "Full diff",
                    model.draft.reviewScope === "full",
                    SelectedSettingsReviewScope({ value: "full" }),
                    h,
                  ),
                ],
              ),
            ],
          ),
          h.div(
            [h.Class("settings-choice-row")],
            [
              h.span([], ["Layout"]),
              h.div(
                [h.Class("settings-choices")],
                [
                  choice(
                    "Unified",
                    model.draft.viewMode === "unified",
                    SelectedSettingsViewMode({ value: "unified" }),
                    h,
                  ),
                  choice(
                    "Side by side",
                    model.draft.viewMode === "split",
                    SelectedSettingsViewMode({ value: "split" }),
                    h,
                  ),
                ],
              ),
            ],
          ),
          h.div(
            [h.Class("settings-choice-row")],
            [
              h.span([], ["Inline changes"]),
              h.div(
                [h.Class("settings-choices")],
                [
                  choice(
                    "Words",
                    model.draft.inlineDiffMode === "token",
                    SelectedSettingsInlineDiffMode({ value: "token" }),
                    h,
                  ),
                  choice(
                    "Characters",
                    model.draft.inlineDiffMode === "character",
                    SelectedSettingsInlineDiffMode({ value: "character" }),
                    h,
                  ),
                  choice(
                    "Off",
                    model.draft.inlineDiffMode === "off",
                    SelectedSettingsInlineDiffMode({ value: "off" }),
                    h,
                  ),
                ],
              ),
            ],
          ),
          h.div(
            [h.Class("settings-toggle-grid")],
            [
              toggle(
                "Ignore whitespace",
                "Remove formatting-only noise.",
                model.draft.ignoreWhitespace,
                ToggledSettingsWhitespace(),
                h,
              ),
              toggle(
                "Semantic analysis",
                "Detect syntax-aware changes and moves.",
                model.draft.semantic,
                ToggledSettingsSemantic(),
                h,
              ),
              toggle(
                "Syntax highlighting",
                "Color source code by language.",
                model.draft.syntaxHighlighting,
                ToggledSettingsSyntaxHighlighting(),
                h,
              ),
              toggle(
                "GitHub reviews",
                "Load review threads inline by default.",
                model.draft.showGitHubReviews,
                ToggledSettingsGitHubReviews(),
                h,
              ),
              toggle(
                "Collapsed sidebar",
                "Start reviews with more horizontal room.",
                model.draft.sidebarCollapsed,
                ToggledSettingsSidebar(),
                h,
              ),
            ],
          ),
        ],
      ),
      h.footer(
        [h.Class("settings-footer")],
        [
          h.div(
            [],
            [
              h.span([], ["Saved on this Hunker server"]),
              h.code([], [document?.configPath ?? "Loading config path…"]),
            ],
          ),
          AsyncData.isFailure(model.save)
            ? h.span(
                [h.Class("settings-save-status is-error"), h.Role("alert")],
                [model.save.error],
              )
            : AsyncData.hasData(model.save)
              ? h.span([h.Class("settings-save-status")], ["Saved"])
              : h.empty,
          button(
            h,
            [h.Type("submit"), h.Class("settings-save"), h.Disabled(saving)],
            [saving ? "Saving…" : "Save settings"],
          ),
        ],
      ),
    ],
  );
};

export const view = Submodel.defineView<Model, Message, ViewInputs>(
  (model, viewInputs, html) => {
    const h = withTailwind(html);
    return h.main(
      [h.Class("settings-shell")],
      [
        h.header(
          [h.Class("settings-toolbar")],
          [
            h.a(
              [h.Class("compact-brand"), h.Href(viewInputs.homeHref)],
              [
                h.span([h.Class("brand-mark")], ["H"]),
                h.span([h.Class("brand-name")], ["hunker"]),
              ],
            ),
            h.span([], ["Local settings"]),
            h.a([h.Href(viewInputs.homeHref)], ["Done"]),
          ],
        ),
        h.div(
          [h.Class("settings-heading")],
          [
            h.span([], ["HUNKER / CONFIG"]),
            h.h1([], ["Settings"]),
            h.p(
              [],
              [
                "Preferences live with the local server, so clean URLs mean the same location in every browser.",
              ],
            ),
          ],
        ),
        AsyncData.isPending(model.load) || AsyncData.isIdle(model.load)
          ? h.section(
              [h.Class("settings-state"), h.Role("status")],
              [h.strong([], ["Loading local settings…"])],
            )
          : AsyncData.isFailure(model.load)
            ? h.section(
                [h.Class("settings-state is-error"), h.Role("alert")],
                [
                  h.strong([], ["Could not load settings"]),
                  h.span([], [model.load.error]),
                ],
              )
            : settingsForm(model, h),
      ],
    );
  },
);
