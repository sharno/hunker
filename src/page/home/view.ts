import { Option } from "effect";
import { AsyncData, Submodel } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

import { localRepositoryUrl } from "../repository";
import { input } from "../../view/control";
import { withTailwind } from "../../view/tailwind";
import { UpdatedRepositoryFilter } from "./message";
import type { Message } from "./message";
import type { Model, Repository } from "./model";

export type ViewInputs = Readonly<{
  settingsHref: string;
  renderLocationForm: () => Html;
}>;

const repositoryName = (repository: Repository) =>
  `${repository.owner}/${repository.name}`;

const repositoryCard = (
  repository: Repository,
  h: HtmlBuilder<Message>,
): Html =>
  h.a(
    [
      h.Class("home-repository-card"),
      h.Href(
        localRepositoryUrl({ owner: repository.owner, name: repository.name }),
      ),
    ],
    [
      h.span(
        [h.Class("home-repository-icon")],
        [repository.name.slice(0, 2).toUpperCase()],
      ),
      h.span(
        [h.Class("home-repository-copy")],
        [
          h.strong([], [repositoryName(repository)]),
          h.code([], [repository.path]),
        ],
      ),
      h.span(
        [h.Class(`home-repository-source is-${repository.source}`)],
        [repository.source === "configured" ? "Repos root" : "Temporary"],
      ),
      h.span([h.Class("commit-open-arrow")], ["→"]),
    ],
  );

const repositorySection = (
  title: string,
  root: string,
  repositories: ReadonlyArray<Repository>,
  h: HtmlBuilder<Message>,
): Html =>
  h.section(
    [h.Class("home-repository-section")],
    [
      h.div(
        [h.Class("home-repository-section-heading")],
        [
          h.div([], [h.h2([], [title]), h.code([], [root])]),
          h.span([], [String(repositories.length)]),
        ],
      ),
      repositories.length === 0
        ? h.div(
            [h.Class("home-repository-empty")],
            ["No matching repositories in this location."],
          )
        : h.div(
            [h.Class("home-repository-grid")],
            repositories.map((repository) => repositoryCard(repository, h)),
          ),
    ],
  );

export const view = Submodel.defineView<Model, Message, ViewInputs>(
  (model, viewInputs, html) => {
    const h = withTailwind(html);
    const catalog = Option.getOrUndefined(
      AsyncData.getData(model.repositories),
    );
    const error = Option.getOrUndefined(AsyncData.getError(model.repositories));
    const normalizedQuery = model.query.trim().toLowerCase();
    const visible = (catalog?.repositories ?? []).filter((repository) =>
      `${repositoryName(repository)} ${repository.path}`
        .toLowerCase()
        .includes(normalizedQuery),
    );
    const configured = visible.filter(
      (repository) => repository.source === "configured",
    );
    const temporary = visible.filter(
      (repository) => repository.source === "temporary",
    );
    return h.main(
      [h.Class("home-shell")],
      [
        h.header(
          [h.Class("home-toolbar")],
          [
            h.div(
              [h.Class("compact-brand")],
              [
                h.span([h.Class("brand-mark")], ["H"]),
                h.span([h.Class("brand-name")], ["hunker"]),
              ],
            ),
            viewInputs.renderLocationForm(),
            h.a(
              [
                h.Class("topbar-settings-link"),
                h.Href(viewInputs.settingsHref),
              ],
              ["Settings"],
            ),
          ],
        ),
        h.div(
          [h.Class("home-heading")],
          [
            h.div(
              [],
              [
                h.span([], ["LOCAL WORKSPACE"]),
                h.h1([], ["Repositories"]),
                h.p(
                  [],
                  [
                    "Browse permanent checkouts and Hunker’s shallow temporary clones.",
                  ],
                ),
              ],
            ),
            input("home-repository-filter", h, [
              h.Type("search"),
              h.Value(model.query),
              h.Placeholder("Filter repositories or paths"),
              h.AriaLabel("Filter repositories"),
              h.OnInput((value) => UpdatedRepositoryFilter({ value })),
            ]),
          ],
        ),
        AsyncData.isPending(model.repositories)
          ? h.div(
              [h.Class("home-repository-state"), h.Role("status")],
              [h.strong([], ["Discovering local repositories…"])],
            )
          : error !== undefined
            ? h.div(
                [h.Class("home-repository-state is-error"), h.Role("alert")],
                [
                  h.strong([], ["Could not discover repositories"]),
                  h.span([], [error]),
                ],
              )
            : catalog === undefined
              ? h.empty
              : h.div(
                  [h.Class("home-repository-sections")],
                  [
                    repositorySection(
                      "Repositories root",
                      catalog.configuredRoot,
                      configured,
                      h,
                    ),
                    repositorySection(
                      "Temporary clones",
                      catalog.temporaryRoot,
                      temporary,
                      h,
                    ),
                  ],
                ),
      ],
    );
  },
);
