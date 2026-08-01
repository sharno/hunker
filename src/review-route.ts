export type ReviewRoute =
  | Readonly<{ _tag: "Pull"; owner: string; repository: string; number: string }>
  | Readonly<{ _tag: "Compare"; owner: string; repository: string; range: string }>;

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
