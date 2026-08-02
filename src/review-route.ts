import { Array as EffectArray, Match as M, Option } from "effect";

import {
  locationToAppRoute,
  repositoryRouter,
  reviewRouteToGitHubUrl,
  reviewRouteToLocalPath,
} from "./app-route";
import type { CommitRoute, CompareRoute, PullRoute } from "./app-route";

export type ReviewRoute = PullRoute | CompareRoute | CommitRoute;

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

const decodeSegment = (segment: string) =>
  Option.getOrElse(
    Option.liftThrowable(decodeURIComponent)(segment),
    () => segment,
  );

export const reviewRouteFromPathname = (
  pathname: string,
): ReviewRoute | undefined => {
  const route = locationToAppRoute(pathname);
  return M.value(route).pipe(
    M.withReturnType<ReviewRoute | undefined>(),
    M.tags({
      Pull: (route) => route,
      Compare: (route) => (route.range.length > 2 ? route : undefined),
      Commit: (route) =>
        /^[0-9a-f]{7,64}$/i.test(route.sha) ? route : undefined,
    }),
    M.orElse(() => undefined),
  );
};

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

export const localLocationFromGitHubUrl = (
  input: string,
  options: ReviewOptions = defaultReviewOptions,
) => {
  const url = Option.getOrUndefined(
    Option.liftThrowable((value: string) => new URL(value))(
      normalizedGitHubUrl(input),
    ),
  );
  if (url === undefined) return undefined;
  if (url.hostname !== "github.com") return undefined;
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
    const commitIndex = remaining.indexOf("commits");
    const selectedCommit =
      commitIndex >= 0 ? (remaining[commitIndex + 1] ?? "") : "";
    return localReviewUrl(
      `https://github.com/${owner}/${repository}/pull/${identifier}`,
      selectedCommit === ""
        ? { ...options, selectedCommit: "" }
        : { ...options, reviewTab: "commits", selectedCommit },
    );
  }
  if (
    resource === "compare" &&
    identifier !== undefined &&
    identifier.length > 2
  ) {
    return localReviewUrl(
      `https://github.com/${owner}/${repository}/compare/${identifier}`,
      options,
    );
  }
  if (
    resource === "commit" &&
    identifier !== undefined &&
    /^[0-9a-f]{7,64}$/i.test(identifier)
  ) {
    return localReviewUrl(
      `https://github.com/${owner}/${repository}/commit/${identifier}`,
      options,
    );
  }
  const selectedFile =
    resource === "blob" && identifier !== undefined
      ? EffectArray.match(remaining, {
          onEmpty: () => "",
          onNonEmpty: (segments) => segments.join("/"),
        })
      : "";
  const repositoryPath = repositoryRouter({ owner, repository });
  return `${repositoryPath}${
    selectedFile === "" ? "" : `?file=${encodeURIComponent(selectedFile)}`
  }`;
};

const optionBoolean = (
  value: string | null,
  enabledValue: string,
  disabledValue: string,
  fallback: boolean,
) =>
  value === enabledValue ? true : value === disabledValue ? false : fallback;

export const reviewOptionsFromSearch = (search: string): ReviewOptions => {
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
          : "token";
  return {
    reviewScope: scope === "full" || scope === "file" ? scope : "file",
    viewMode: view === "unified" || view === "split" ? view : "split",
    ignoreWhitespace: optionBoolean(
      params.get("whitespace"),
      "ignore",
      "show",
      true,
    ),
    semantic: optionBoolean(params.get("semantic"), "on", "off", true),
    inlineDiffMode,
    syntaxHighlighting: optionBoolean(params.get("syntax"), "on", "off", true),
    sidebarCollapsed: optionBoolean(
      params.get("sidebar"),
      "collapsed",
      "expanded",
      false,
    ),
    showGitHubReviews: optionBoolean(
      params.get("reviews"),
      "show",
      "hide",
      true,
    ),
    selectedPath: params.get("file") ?? "",
    reviewTab: tab === "commits" ? "commits" : "files",
    selectedCommit: params.get("commit") ?? "",
  };
};

export const localReviewUrl = (githubUrl: string, options: ReviewOptions) => {
  const path = localPathFromGitHubUrl(githubUrl);
  if (path === undefined) return undefined;
  const params = new URLSearchParams({
    scope: options.reviewScope,
    view: options.viewMode,
    whitespace: options.ignoreWhitespace ? "ignore" : "show",
    semantic: options.semantic ? "on" : "off",
    inline: options.inlineDiffMode,
    syntax: options.syntaxHighlighting ? "on" : "off",
    sidebar: options.sidebarCollapsed ? "collapsed" : "expanded",
    reviews: options.showGitHubReviews ? "show" : "hide",
    tab: options.reviewTab,
  });
  if (options.selectedPath !== "") params.set("file", options.selectedPath);
  if (options.reviewTab === "commits" && options.selectedCommit !== "") {
    params.set("commit", options.selectedCommit);
  }
  return `${path}?${params.toString()}`;
};
