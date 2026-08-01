export type ReviewRoute =
  | Readonly<{ _tag: "Pull"; owner: string; repository: string; number: string }>
  | Readonly<{ _tag: "Compare"; owner: string; repository: string; range: string }>;

export type ReviewOptions = Readonly<{
  reviewScope: "file" | "full";
  viewMode: "unified" | "split";
  ignoreWhitespace: boolean;
  semantic: boolean;
  characterDiff: boolean;
  syntaxHighlighting: boolean;
  sidebarCollapsed: boolean;
  showGitHubReviews: boolean;
  selectedPath: string;
}>;

export const defaultReviewOptions: ReviewOptions = {
  reviewScope: "file",
  viewMode: "split",
  ignoreWhitespace: true,
  semantic: true,
  characterDiff: true,
  syntaxHighlighting: true,
  sidebarCollapsed: false,
  showGitHubReviews: true,
  selectedPath: "",
};

const decodeSegment = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

export const reviewRouteFromPathname = (pathname: string): ReviewRoute | undefined => {
  const [owner, repository, resource, identifier, ...remaining] = pathname
    .split("/")
    .filter(Boolean)
    .map(decodeSegment);
  if (
    remaining.length > 0 ||
    owner === undefined ||
    repository === undefined ||
    identifier === undefined
  ) {
    return undefined;
  }
  if (resource === "pull" && /^\d+$/.test(identifier)) {
    return { _tag: "Pull", owner, repository, number: identifier };
  }
  if (resource === "compare" && identifier.length > 2) {
    return { _tag: "Compare", owner, repository, range: identifier };
  }
  return undefined;
};

export const githubUrlFromPathname = (pathname: string) => {
  const route = reviewRouteFromPathname(pathname);
  if (route === undefined) return undefined;
  return route._tag === "Pull"
    ? `https://github.com/${route.owner}/${route.repository}/pull/${route.number}`
    : `https://github.com/${route.owner}/${route.repository}/compare/${route.range}`;
};

export const localPathFromGitHubUrl = (input: string) => {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return undefined;
  }
  if (url.hostname !== "github.com") return undefined;
  const route = reviewRouteFromPathname(url.pathname);
  if (route === undefined) return undefined;
  const resource = route._tag === "Pull" ? "pull" : "compare";
  const identifier = route._tag === "Pull" ? route.number : route.range;
  return `/${encodeURIComponent(route.owner)}/${encodeURIComponent(route.repository)}/${resource}/${encodeURIComponent(identifier)}`;
};

const optionBoolean = (
  value: string | null,
  enabledValue: string,
  disabledValue: string,
  fallback: boolean,
) =>
  value === enabledValue
    ? true
    : value === disabledValue
      ? false
      : fallback;

export const reviewOptionsFromSearch = (search: string): ReviewOptions => {
  const params = new URLSearchParams(search);
  const scope = params.get("scope");
  const view = params.get("view");
  return {
    reviewScope: scope === "full" || scope === "file" ? scope : "file",
    viewMode: view === "unified" || view === "split" ? view : "split",
    ignoreWhitespace: optionBoolean(params.get("whitespace"), "ignore", "show", true),
    semantic: optionBoolean(params.get("semantic"), "on", "off", true),
    characterDiff: optionBoolean(params.get("characters"), "on", "off", true),
    syntaxHighlighting: optionBoolean(params.get("syntax"), "on", "off", true),
    sidebarCollapsed: optionBoolean(
      params.get("sidebar"),
      "collapsed",
      "expanded",
      false,
    ),
    showGitHubReviews: optionBoolean(params.get("reviews"), "show", "hide", true),
    selectedPath: params.get("file") ?? "",
  };
};

export const localReviewUrl = (
  githubUrl: string,
  options: ReviewOptions,
) => {
  const path = localPathFromGitHubUrl(githubUrl);
  if (path === undefined) return undefined;
  const params = new URLSearchParams({
    scope: options.reviewScope,
    view: options.viewMode,
    whitespace: options.ignoreWhitespace ? "ignore" : "show",
    semantic: options.semantic ? "on" : "off",
    characters: options.characterDiff ? "on" : "off",
    syntax: options.syntaxHighlighting ? "on" : "off",
    sidebar: options.sidebarCollapsed ? "collapsed" : "expanded",
    reviews: options.showGitHubReviews ? "show" : "hide",
  });
  if (options.selectedPath !== "") params.set("file", options.selectedPath);
  return `${path}?${params.toString()}`;
};
