import { Schema as S } from "effect";
import { m } from "foldkit/message";

import { SettingsDocument } from "../../settings";

export const SucceededFetchSettings = m("SucceededFetchSettings", {
  document: SettingsDocument,
});
export const FailedFetchSettings = m("FailedFetchSettings", {
  error: S.String,
});
export const UpdatedRepositoriesRoot = m("UpdatedRepositoriesRoot", {
  value: S.String,
});
export const UpdatedCacheRoot = m("UpdatedCacheRoot", { value: S.String });
export const SelectedSettingsReviewScope = m("SelectedSettingsReviewScope", {
  value: S.Literals(["file", "full"]),
});
export const SelectedSettingsViewMode = m("SelectedSettingsViewMode", {
  value: S.Literals(["unified", "split"]),
});
export const ToggledSettingsWhitespace = m("ToggledSettingsWhitespace");
export const ToggledSettingsSemantic = m("ToggledSettingsSemantic");
export const SelectedSettingsInlineDiffMode = m(
  "SelectedSettingsInlineDiffMode",
  { value: S.Literals(["token", "character", "off"]) },
);
export const ToggledSettingsSyntaxHighlighting = m(
  "ToggledSettingsSyntaxHighlighting",
);
export const ToggledSettingsSidebar = m("ToggledSettingsSidebar");
export const ToggledSettingsGitHubReviews = m("ToggledSettingsGitHubReviews");
export const SubmittedSettings = m("SubmittedSettings");
export const SucceededSaveSettings = m("SucceededSaveSettings", {
  document: SettingsDocument,
});
export const FailedSaveSettings = m("FailedSaveSettings", {
  error: S.String,
});

export const Message = S.Union([
  SucceededFetchSettings,
  FailedFetchSettings,
  UpdatedRepositoriesRoot,
  UpdatedCacheRoot,
  SelectedSettingsReviewScope,
  SelectedSettingsViewMode,
  ToggledSettingsWhitespace,
  ToggledSettingsSemantic,
  SelectedSettingsInlineDiffMode,
  ToggledSettingsSyntaxHighlighting,
  ToggledSettingsSidebar,
  ToggledSettingsGitHubReviews,
  SubmittedSettings,
  SucceededSaveSettings,
  FailedSaveSettings,
]);
export type Message = typeof Message.Type;
