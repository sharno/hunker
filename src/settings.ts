import { Schema as S } from "effect";

export const HunkerSettings = S.Struct({
  repositoriesRoot: S.String,
  cacheRoot: S.String,
  reviewScope: S.Literals(["file", "full"]),
  viewMode: S.Literals(["unified", "split"]),
  ignoreWhitespace: S.Boolean,
  semantic: S.Boolean,
  inlineDiffMode: S.Literals(["token", "character", "off"]),
  syntaxHighlighting: S.Boolean,
  sidebarCollapsed: S.Boolean,
  showGitHubReviews: S.Boolean,
});
export type HunkerSettings = typeof HunkerSettings.Type;

export const SettingsDocument = S.Struct({
  settings: HunkerSettings,
  configPath: S.String,
});
export type SettingsDocument = typeof SettingsDocument.Type;

export const defaultHunkerSettings = HunkerSettings.make({
  repositoriesRoot: "~/src",
  cacheRoot: "/tmp/hunker/repositories",
  reviewScope: "file",
  viewMode: "split",
  ignoreWhitespace: true,
  semantic: true,
  inlineDiffMode: "token",
  syntaxHighlighting: true,
  sidebarCollapsed: false,
  showGitHubReviews: true,
});
