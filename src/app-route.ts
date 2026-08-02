import { Match as M, Option, Schema as S, pipe } from "effect";
import { Route, Url } from "foldkit";
import { int, literal, r, slash, string } from "foldkit/route";

export const HomeRoute = r("Home");
export const PullRoute = r("Pull", {
  owner: S.String,
  repository: S.String,
  number: S.Number,
});
export const CompareRoute = r("Compare", {
  owner: S.String,
  repository: S.String,
  range: S.String,
});
export const CommitRoute = r("Commit", {
  owner: S.String,
  repository: S.String,
  sha: S.String,
});
export const RepositoryRoute = r("Repository", {
  owner: S.String,
  repository: S.String,
});
export const NotFoundRoute = r("NotFound", { path: S.String });

export const AppRoute = S.Union([
  HomeRoute,
  PullRoute,
  CompareRoute,
  CommitRoute,
  RepositoryRoute,
  NotFoundRoute,
]);
export type AppRoute = typeof AppRoute.Type;
export type PullRoute = typeof PullRoute.Type;
export type CompareRoute = typeof CompareRoute.Type;
export type CommitRoute = typeof CommitRoute.Type;
export type RepositoryRoute = typeof RepositoryRoute.Type;

export const homeRouter = pipe(Route.root, Route.mapTo(HomeRoute));

const repositoryPrefix = pipe(string("owner"), slash(string("repository")));

export const pullRouter = pipe(
  repositoryPrefix,
  slash(literal("pull")),
  slash(int("number")),
  Route.mapTo(PullRoute),
);

export const compareRouter = pipe(
  repositoryPrefix,
  slash(literal("compare")),
  slash(string("range")),
  Route.mapTo(CompareRoute),
);

export const commitRouter = pipe(
  repositoryPrefix,
  slash(literal("commit")),
  slash(string("sha")),
  Route.mapTo(CommitRoute),
);

export const repositoryRouter = pipe(
  literal("repo"),
  slash(string("owner")),
  slash(string("repository")),
  Route.mapTo(RepositoryRoute),
);

const routeParser = Route.oneOf(
  pullRouter,
  compareRouter,
  commitRouter,
  repositoryRouter,
  homeRouter,
);

export const urlToAppRoute = Route.parseUrlWithFallback(
  routeParser,
  NotFoundRoute,
);

export const locationToAppRoute = (pathname: string, search = ""): AppRoute =>
  Option.match(Url.fromString(`http://hunker.local${pathname}${search}`), {
    onNone: () => NotFoundRoute({ path: pathname }),
    onSome: urlToAppRoute,
  });

export const reviewRouteToGitHubUrl = (
  route: PullRoute | CompareRoute | CommitRoute,
): string =>
  M.value(route).pipe(
    M.withReturnType<string>(),
    M.tagsExhaustive({
      Pull: ({ owner, repository, number }) =>
        `https://github.com/${owner}/${repository}/pull/${number}`,
      Compare: ({ owner, repository, range }) =>
        `https://github.com/${owner}/${repository}/compare/${range}`,
      Commit: ({ owner, repository, sha }) =>
        `https://github.com/${owner}/${repository}/commit/${sha}`,
    }),
  );

export const reviewRouteToLocalPath = (
  route: PullRoute | CompareRoute | CommitRoute,
): string =>
  M.value(route).pipe(
    M.withReturnType<string>(),
    M.tagsExhaustive({
      Pull: ({ owner, repository, number }) =>
        pullRouter({ owner, repository, number }),
      Compare: ({ owner, repository, range }) =>
        compareRouter({ owner, repository, range }),
      Commit: ({ owner, repository, sha }) =>
        commitRouter({ owner, repository, sha }),
    }),
  );
