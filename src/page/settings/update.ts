import { Match as M } from "effect";
import { AsyncData, Update } from "foldkit";
import { evo } from "foldkit/struct";

import { SaveSettings } from "./command";
import type { Message } from "./message";
import { Load, type Model, Save } from "./model";
import type { HunkerSettings } from "../../settings";

type SettingsUpdate = Update.Return<Model, Message>;

const sameSettings = (left: HunkerSettings, right: HunkerSettings): boolean =>
  left.repositoriesRoot === right.repositoriesRoot &&
  left.cacheRoot === right.cacheRoot &&
  left.reviewScope === right.reviewScope &&
  left.viewMode === right.viewMode &&
  left.ignoreWhitespace === right.ignoreWhitespace &&
  left.semantic === right.semantic &&
  left.inlineDiffMode === right.inlineDiffMode &&
  left.syntaxHighlighting === right.syntaxHighlighting &&
  left.sidebarCollapsed === right.sidebarCollapsed &&
  left.showGitHubReviews === right.showGitHubReviews;

export const save = (model: Model, draft = model.draft): SettingsUpdate =>
  AsyncData.isPending(model.save)
    ? [evo(model, { draft: () => draft }), []]
    : [
        evo(model, { draft: () => draft, save: () => Save.Loading() }),
        [SaveSettings({ settings: draft })],
      ];

export const update = (model: Model, message: Message): SettingsUpdate =>
  M.value(message).pipe(
    M.withReturnType<SettingsUpdate>(),
    M.tagsExhaustive({
      SucceededFetchSettings: ({ document }) => [
        evo(model, {
          load: () => Load.Success({ data: document }),
          draft: () => document.settings,
        }),
        [],
      ],
      FailedFetchSettings: ({ error }) => [
        evo(model, { load: () => Load.Failure({ error }) }),
        [],
      ],
      UpdatedRepositoriesRoot: ({ value }) => [
        evo(model, {
          draft: (draft) => evo(draft, { repositoriesRoot: () => value }),
          save: () => Save.Idle(),
        }),
        [],
      ],
      UpdatedCacheRoot: ({ value }) => [
        evo(model, {
          draft: (draft) => evo(draft, { cacheRoot: () => value }),
          save: () => Save.Idle(),
        }),
        [],
      ],
      SelectedSettingsReviewScope: ({ value }) => [
        evo(model, {
          draft: (draft) => evo(draft, { reviewScope: () => value }),
          save: () => Save.Idle(),
        }),
        [],
      ],
      SelectedSettingsViewMode: ({ value }) => [
        evo(model, {
          draft: (draft) => evo(draft, { viewMode: () => value }),
          save: () => Save.Idle(),
        }),
        [],
      ],
      ToggledSettingsWhitespace: () => [
        evo(model, {
          draft: (draft) =>
            evo(draft, {
              ignoreWhitespace: (ignoreWhitespace) => !ignoreWhitespace,
            }),
          save: () => Save.Idle(),
        }),
        [],
      ],
      ToggledSettingsSemantic: () => [
        evo(model, {
          draft: (draft) => evo(draft, { semantic: (semantic) => !semantic }),
          save: () => Save.Idle(),
        }),
        [],
      ],
      SelectedSettingsInlineDiffMode: ({ value }) => [
        evo(model, {
          draft: (draft) => evo(draft, { inlineDiffMode: () => value }),
          save: () => Save.Idle(),
        }),
        [],
      ],
      ToggledSettingsSyntaxHighlighting: () => [
        evo(model, {
          draft: (draft) =>
            evo(draft, {
              syntaxHighlighting: (syntaxHighlighting) => !syntaxHighlighting,
            }),
          save: () => Save.Idle(),
        }),
        [],
      ],
      ToggledSettingsSidebar: () => [
        evo(model, {
          draft: (draft) =>
            evo(draft, {
              sidebarCollapsed: (sidebarCollapsed) => !sidebarCollapsed,
            }),
          save: () => Save.Idle(),
        }),
        [],
      ],
      ToggledSettingsGitHubReviews: () => [
        evo(model, {
          draft: (draft) =>
            evo(draft, {
              showGitHubReviews: (showGitHubReviews) => !showGitHubReviews,
            }),
          save: () => Save.Idle(),
        }),
        [],
      ],
      SubmittedSettings: () => save(model),
      SucceededSaveSettings: ({ document }) => {
        const saved = evo(model, {
          load: () => Load.Success({ data: document }),
          save: () => Save.Success({ data: document }),
        });
        return sameSettings(model.draft, document.settings)
          ? [saved, []]
          : save(saved, model.draft);
      },
      FailedSaveSettings: ({ error }) => [
        evo(model, { save: () => Save.Failure({ error }) }),
        [],
      ],
    }),
  );
