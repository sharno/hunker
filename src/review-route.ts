import { Match as M, Option } from "effect";

import {
  PullRoute,
  commitRouter,
  locationToAppRoute,
  pullCommitRouter,
  pullCommitsRouter,
  pullFileRouter,
  pullFilesRouter,
  repositoryCommitsRouter,
  repositoryFileRouter,
  repositoryPullsRouter,
  repositoryRouter,
  reviewRouteToGitHubUrl,
  reviewRouteToLocalPath,
} from "./app-route";
import type {
  AppRoute,
  CommitRoute as CommitRouteType,
  CompareRoute,
  PullRoute as PullRouteType,
} from "./app-route";
import type { HunkerSettings } from "./settings";

export type ReviewRoute = PullRouteType | CompareRoute | CommitRouteType;

export type ReviewOptions = Readonly<{
  reviewScope: "file" | "full";
  viewMode: "unified" | "split";
  ignoreWhitespace: boolean;
  semantic: boolean;
  inlineDiffMode: "token" | "character" | "off";
  syntaxHighlighting: boolean;
  sidebarCollapsed: boolean;
  showGitHubReviews: boolean;
  selectedPath: string;
  reviewTab: "files" | "commits";
  selectedCommit: string;
}>;

export const defaultReviewOptions: ReviewOptions = {
  reviewScope: "file",
  viewMode: "split",
  ignoreWhitespace: true,
  semantic: true,
  inlineDiffMode: "token",
  syntaxHighlighting: true,
  sidebarCollapsed: false,
  showGitHubReviews: true,
  selectedPath: "",
  reviewTab: "files",
  selectedCommit: "",
};

export const reviewOptionsFromSettings = (
  settings: HunkerSettings,
): ReviewOptions => ({
  reviewScope: settings.reviewScope,
  viewMode: settings.viewMode,
  ignoreWhitespace: settings.ignoreWhitespace,
  semantic: settings.semantic,
  inlineDiffMode: settings.inlineDiffMode,
  syntaxHighlighting: settings.syntaxHighlighting,
  sidebarCollapsed: settings.sidebarCollapsed,
  showGitHubReviews: settings.showGitHubReviews,
  selectedPath: "",
  reviewTab: "files",
  selectedCommit: "",
});

const pullBase = (route: {
  readonly owner: string;
  readonly repository: string;
  readonly number: number;
}) =>
  PullRoute({
    owner: route.owner,
    repository: route.repository,
    number: route.number,
  });

export const reviewRouteFromAppRoute = (
  route: AppRoute,
): ReviewRoute | undefined =>
  M.value(route).pipe(
    M.withReturnType<ReviewRoute | undefined>(),
    M.tags({
      Pull: (value) => value,
      PullFiles: pullBase,
      PullFile: pullBase,
      PullCommits: pullBase,
      PullCommit: pullBase,
      Compare: (value) => (value.range.length > 2 ? value : undefined),
      Commit: (value) =>
        /^[0-9a-f]{7,64}$/i.test(value.sha) ? value : undefined,
    }),
    M.orElse(() => undefined),
  );

export const reviewRouteFromPathname = (
  pathname: string,
): ReviewRoute | undefined =>
  reviewRouteFromAppRoute(locationToAppRoute(pathname));

export const githubUrlFromPathname = (pathname: string) => {
  const route = reviewRouteFromPathname(pathname);
  return route === undefined ? undefined : reviewRouteToGitHubUrl(route);
};

export const isPullRequestUrl = (input: string) => {
  const maybeUrl = Option.liftThrowable((value: string) => new URL(value))(
    input,
  );
  return Option.exists(
    maybeUrl,
    (url) => reviewRouteFromPathname(url.pathname)?._tag === "Pull",
  );
};

export const localPathFromGitHubUrl = (input: string) => {
  const maybePath = Option.liftThrowable((value: string) => new URL(value))(
    input,
  ).pipe(
    Option.filter((url) => url.hostname === "github.com"),
    Option.flatMapNullishOr((url) => reviewRouteFromPathname(url.pathname)),
    Option.map(reviewRouteToLocalPath),
  );
  return Option.getOrUndefined(maybePath);
};

const normalizedGitHubUrl = (input: string) => {
  const trimmed = input.trim();
  if (trimmed.startsWith("github.com/")) return `https://${trimmed}`;
  return trimmed;
};

const decodeSegment = (segment: string) =>
  Option.getOrElse(
    Option.liftThrowable(decodeURIComponent)(segment),
    () => segment,
  );

const withHash = (path: string, hash: string) => `${path}${hash}`;

export const localLocationFromGitHubUrl = (
  input: string,
  options: ReviewOptions = defaultReviewOptions,
) => {
  const url = Option.getOrUndefined(
    Option.liftThrowable((value: string) => new URL(value))(
      normalizedGitHubUrl(input),
    ),
  );
  if (url === undefined || url.hostname !== "github.com") return undefined;
  const [owner, repository, resource, identifier, ...remaining] = url.pathname
    .split("/")
    .filter(Boolean)
    .map(decodeSegment);
  if (owner === undefined || repository === undefined) return undefined;

  if (
    resource === "pull" &&
    identifier !== undefined &&
    /^\d+$/.test(identifier)
  ) {
    const number = Number(identifier);
    const [section, detail] = remaining;
    const path =
      section === "commits" &&
      detail !== undefined &&
      /^[0-9a-f]{7,64}$/i.test(detail)
        ? pullCommitRouter({ owner, repository, number, sha: detail })
        : section === "commits"
          ? pullCommitsRouter({ owner, repository, number })
          : section === "files"
            ? pullFilesRouter({ owner, repository, number })
            : localReviewUrl(
                `https://github.com/${owner}/${repository}/pull/${number}`,
                options,
              );
    return path === undefined ? undefined : withHash(path, url.hash);
  }
  if (
    resource === "compare" &&
    identifier !== undefined &&
    identifier.length > 2
  ) {
    return withHash(
      localReviewUrl(
        `https://github.com/${owner}/${repository}/compare/${identifier}`,
        options,
      ) ?? "",
      url.hash,
    );
  }
  if (
    resource === "commit" &&
    identifier !== undefined &&
    /^[0-9a-f]{7,64}$/i.test(identifier)
  ) {
    return withHash(
      commitRouter({ owner, repository, sha: identifier }),
      url.hash,
    );
  }
  if (resource === "commits") {
    return withHash(repositoryCommitsRouter({ owner, repository }), url.hash);
  }
  if (resource === "pulls") {
    return withHash(repositoryPullsRouter({ owner, repository }), url.hash);
  }
  if (resource === "blob" && identifier !== undefined && remaining.length > 0) {
    return withHash(
      repositoryFileRouter({
        owner,
        repository,
        ref: identifier,
        path: remaining.join("/"),
      }),
      url.hash,
    );
  }
  return withHash(repositoryRouter({ owner, repository }), url.hash);
};

const optionBoolean = (
  value: string | null,
  enabledValue: string,
  disabledValue: string,
  fallback: boolean,
) =>
  value === enabledValue ? true : value === disabledValue ? false : fallback;

const legacyReviewSettingKeys = [
  "scope",
  "view",
  "whitespace",
  "semantic",
  "inline",
  "characters",
  "syntax",
  "sidebar",
  "reviews",
] as const;

export const hasLegacyReviewSettings = (search: string): boolean => {
  const params = new URLSearchParams(search);
  return legacyReviewSettingKeys.some((key) => params.has(key));
};

// Query parsing remains for compatibility with old shared Hunker links. New
// links encode only review location in their pathname.
export const reviewOptionsFromSearch = (
  search: string,
  defaults: ReviewOptions = defaultReviewOptions,
): ReviewOptions => {
  const params = new URLSearchParams(search);
  const scope = params.get("scope");
  const view = params.get("view");
  const inline = params.get("inline");
  const tab = params.get("tab");
  const legacyCharacters = params.get("characters");
  const inlineDiffMode =
    inline === "token" || inline === "character" || inline === "off"
      ? inline
      : legacyCharacters === "on"
        ? "character"
        : legacyCharacters === "off"
          ? "off"
          : defaults.inlineDiffMode;
  return {
    reviewScope:
      scope === "full" || scope === "file" ? scope : defaults.reviewScope,
    viewMode: view === "unified" || view === "split" ? view : defaults.viewMode,
    ignoreWhitespace: optionBoolean(
      params.get("whitespace"),
      "ignore",
      "show",
      defaults.ignoreWhitespace,
    ),
    semantic: optionBoolean(
      params.get("semantic"),
      "on",
      "off",
      defaults.semantic,
    ),
    inlineDiffMode,
    syntaxHighlighting: optionBoolean(
      params.get("syntax"),
      "on",
      "off",
      defaults.syntaxHighlighting,
    ),
    sidebarCollapsed: optionBoolean(
      params.get("sidebar"),
      "collapsed",
      "expanded",
      defaults.sidebarCollapsed,
    ),
    showGitHubReviews: optionBoolean(
      params.get("reviews"),
      "show",
      "hide",
      defaults.showGitHubReviews,
    ),
    selectedPath: params.get("file") ?? defaults.selectedPath,
    reviewTab:
      tab === "commits"
        ? "commits"
        : tab === "files"
          ? "files"
          : defaults.reviewTab,
    selectedCommit: params.get("commit") ?? defaults.selectedCommit,
  };
};

export const reviewOptionsFromRoute = (
  route: AppRoute,
  search: string,
  defaults: ReviewOptions = defaultReviewOptions,
): ReviewOptions => {
  const legacy = reviewOptionsFromSearch(search, defaults);
  return M.value(route).pipe(
    M.withReturnType<ReviewOptions>(),
    M.tags({
      Pull: () => legacy,
      PullFiles: () => ({
        ...legacy,
        reviewTab: "files",
        selectedCommit: "",
      }),
      PullFile: ({ path }) => ({
        ...legacy,
        reviewTab: "files",
        selectedPath: path,
        selectedCommit: "",
      }),
      PullCommits: () => ({
        ...legacy,
        reviewTab: "commits",
        selectedPath: "",
        selectedCommit: "",
      }),
      PullCommit: ({ sha }) => ({
        ...legacy,
        reviewTab: "commits",
        selectedPath: "",
        selectedCommit: sha,
      }),
    }),
    M.orElse(() => legacy),
  );
};

export const localReviewUrl = (githubUrl: string, options: ReviewOptions) => {
  const route = Option.getOrUndefined(
    Option.liftThrowable((value: string) => new URL(value))(githubUrl).pipe(
      Option.flatMapNullishOr((url) => reviewRouteFromPathname(url.pathname)),
    ),
  );
  if (route === undefined) return undefined;
  return M.value(route).pipe(
    M.withReturnType<string>(),
    M.tagsExhaustive({
      Pull: ({ owner, repository, number }) =>
        options.reviewTab === "commits"
          ? options.selectedCommit === ""
            ? pullCommitsRouter({ owner, repository, number })
            : pullCommitRouter({
                owner,
                repository,
                number,
                sha: options.selectedCommit,
              })
          : options.selectedPath === ""
            ? pullFilesRouter({ owner, repository, number })
            : pullFileRouter({
                owner,
                repository,
                number,
                path: options.selectedPath,
              }),
      Compare: (value) => reviewRouteToLocalPath(value),
      Commit: (value) => reviewRouteToLocalPath(value),
    }),
  );
};
