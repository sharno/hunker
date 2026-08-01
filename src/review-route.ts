export type ReviewRoute =
  | Readonly<{ _tag: "Pull"; owner: string; repository: string; number: string }>
  | Readonly<{ _tag: "Compare"; owner: string; repository: string; range: string }>
  | Readonly<{ _tag: "Commit"; owner: string; repository: string; sha: string }>;

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
  if (resource === "commit" && /^[0-9a-f]{7,64}$/i.test(identifier)) {
    return { _tag: "Commit", owner, repository, sha: identifier };
  }
  return undefined;
};

export const githubUrlFromPathname = (pathname: string) => {
  const route = reviewRouteFromPathname(pathname);
  if (route === undefined) return undefined;
  if (route._tag === "Pull") {
    return `https://github.com/${route.owner}/${route.repository}/pull/${route.number}`;
  }
  if (route._tag === "Compare") {
    return `https://github.com/${route.owner}/${route.repository}/compare/${route.range}`;
  }
  return `https://github.com/${route.owner}/${route.repository}/commit/${route.sha}`;
};

export const isPullRequestUrl = (input: string) => {
  try {
    const url = new URL(input);
    return reviewRouteFromPathname(url.pathname)?._tag === "Pull";
  } catch {
    return false;
  }
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
  const resource =
    route._tag === "Pull" ? "pull" : route._tag === "Compare" ? "compare" : "commit";
  const identifier =
    route._tag === "Pull" ? route.number : route._tag === "Compare" ? route.range : route.sha;
  return `/${encodeURIComponent(route.owner)}/${encodeURIComponent(route.repository)}/${resource}/${encodeURIComponent(identifier)}`;
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
  let url: URL;
  try {
    url = new URL(normalizedGitHubUrl(input));
  } catch {
    return undefined;
  }
  if (url.hostname !== "github.com") return undefined;
  const [owner, repository, resource, identifier, ...remaining] = url.pathname
    .split("/")
    .filter(Boolean)
    .map(decodeSegment);
  if (owner === undefined || repository === undefined) return undefined;

  if (resource === "pull" && identifier !== undefined && /^\d+$/.test(identifier)) {
    const commitIndex = remaining.indexOf("commits");
    const selectedCommit = commitIndex >= 0 ? (remaining[commitIndex + 1] ?? "") : "";
    return localReviewUrl(
      `https://github.com/${owner}/${repository}/pull/${identifier}`,
      selectedCommit === ""
        ? { ...options, selectedCommit: "" }
        : { ...options, reviewTab: "commits", selectedCommit },
    );
  }
  if (resource === "compare" && identifier !== undefined && identifier.length > 2) {
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
    resource === "blob" && identifier !== undefined && remaining.length > 0
      ? remaining.join("/")
      : "";
  return `/repo/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}${
    selectedFile === "" ? "" : `?file=${encodeURIComponent(selectedFile)}`
  }`;
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
    ignoreWhitespace: optionBoolean(params.get("whitespace"), "ignore", "show", true),
    semantic: optionBoolean(params.get("semantic"), "on", "off", true),
    inlineDiffMode,
    syntaxHighlighting: optionBoolean(params.get("syntax"), "on", "off", true),
    sidebarCollapsed: optionBoolean(
      params.get("sidebar"),
      "collapsed",
      "expanded",
      false,
    ),
    showGitHubReviews: optionBoolean(params.get("reviews"), "show", "hide", true),
    selectedPath: params.get("file") ?? "",
    reviewTab: tab === "commits" ? "commits" : "files",
    selectedCommit: params.get("commit") ?? "",
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
