import { Match as M, Option, Schema as S, pipe } from "effect";
import { Route, Url } from "foldkit";
import { int, literal, r, restString, slash, string } from "foldkit/route";

export const HomeRoute = r("Home");
export const PullRoute = r("Pull", {
  owner: S.String,
  repository: S.String,
  number: S.Number,
});
export const PullFilesRoute = r("PullFiles", {
  owner: S.String,
  repository: S.String,
  number: S.Number,
});
export const PullFileRoute = r("PullFile", {
  owner: S.String,
  repository: S.String,
  number: S.Number,
  path: S.String,
});
export const PullCommitsRoute = r("PullCommits", {
  owner: S.String,
  repository: S.String,
  number: S.Number,
});
export const PullCommitRoute = r("PullCommit", {
  owner: S.String,
  repository: S.String,
  number: S.Number,
  sha: S.String,
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
export const RepositoryCommitsRoute = r("RepositoryCommits", {
  owner: S.String,
  repository: S.String,
});
export const RepositoryCommitsRefRoute = r("RepositoryCommitsRef", {
  owner: S.String,
  repository: S.String,
  ref: S.String,
});
export const RepositoryFileRoute = r("RepositoryFile", {
  owner: S.String,
  repository: S.String,
  ref: S.String,
  path: S.String,
});
export const SettingsRoute = r("Settings");
export const NotFoundRoute = r("NotFound", { path: S.String });

export const AppRoute = S.Union([
  HomeRoute,
  PullRoute,
  PullFilesRoute,
  PullFileRoute,
  PullCommitsRoute,
  PullCommitRoute,
  CompareRoute,
  CommitRoute,
  RepositoryRoute,
  RepositoryCommitsRoute,
  RepositoryCommitsRefRoute,
  RepositoryFileRoute,
  SettingsRoute,
  NotFoundRoute,
]);
export type AppRoute = typeof AppRoute.Type;
export type PullRoute = typeof PullRoute.Type;
export type PullFilesRoute = typeof PullFilesRoute.Type;
export type PullFileRoute = typeof PullFileRoute.Type;
export type PullCommitsRoute = typeof PullCommitsRoute.Type;
export type PullCommitRoute = typeof PullCommitRoute.Type;
export type CompareRoute = typeof CompareRoute.Type;
export type CommitRoute = typeof CommitRoute.Type;
export type RepositoryRoute = typeof RepositoryRoute.Type;
export type RepositoryCommitsRoute = typeof RepositoryCommitsRoute.Type;
export type RepositoryCommitsRefRoute = typeof RepositoryCommitsRefRoute.Type;
export type RepositoryFileRoute = typeof RepositoryFileRoute.Type;

export const homeRouter = pipe(Route.root, Route.mapTo(HomeRoute));

const repositoryPrefix = pipe(string("owner"), slash(string("repository")));

const pullPrefix = pipe(
  repositoryPrefix,
  slash(literal("pull")),
  slash(int("number")),
);

export const pullCommitRouter = pipe(
  pullPrefix,
  slash(literal("commits")),
  slash(string("sha")),
  Route.mapTo(PullCommitRoute),
);

export const pullCommitsRouter = pipe(
  pullPrefix,
  slash(literal("commits")),
  Route.mapTo(PullCommitsRoute),
);

export const pullFileRouter = pipe(
  pullPrefix,
  slash(literal("files")),
  slash(restString("path")),
  Route.mapTo(PullFileRoute),
);

export const pullFilesRouter = pipe(
  pullPrefix,
  slash(literal("files")),
  Route.mapTo(PullFilesRoute),
);

export const pullRouter = pipe(pullPrefix, Route.mapTo(PullRoute));

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

export const legacyRepositoryRouter = pipe(
  literal("repo"),
  slash(string("owner")),
  slash(string("repository")),
  Route.mapTo(RepositoryRoute),
);

export const repositoryFileRouter = pipe(
  repositoryPrefix,
  slash(literal("blob")),
  slash(string("ref")),
  slash(restString("path")),
  Route.mapTo(RepositoryFileRoute),
);

export const repositoryCommitsRouter = pipe(
  repositoryPrefix,
  slash(literal("commits")),
  Route.mapTo(RepositoryCommitsRoute),
);

export const repositoryCommitsRefRouter = pipe(
  repositoryPrefix,
  slash(literal("commits")),
  slash(restString("ref")),
  Route.mapTo(RepositoryCommitsRefRoute),
);

export const repositoryRouter = pipe(
  repositoryPrefix,
  Route.mapTo(RepositoryRoute),
);

export const settingsRouter = pipe(
  literal("settings"),
  Route.mapTo(SettingsRoute),
);

const routeParser = Route.oneOf(
  settingsRouter,
  pullCommitRouter,
  pullCommitsRouter,
  pullFileRouter,
  pullFilesRouter,
  pullRouter,
  compareRouter,
  commitRouter,
  repositoryFileRouter,
  repositoryCommitsRefRouter,
  repositoryCommitsRouter,
  legacyRepositoryRouter,
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
  route:
    | PullRoute
    | PullFilesRoute
    | PullFileRoute
    | PullCommitsRoute
    | PullCommitRoute
    | CompareRoute
    | CommitRoute,
): string =>
  M.value(route).pipe(
    M.withReturnType<string>(),
    M.tagsExhaustive({
      Pull: ({ owner, repository, number }) =>
        `https://github.com/${owner}/${repository}/pull/${number}`,
      PullFiles: ({ owner, repository, number }) =>
        `https://github.com/${owner}/${repository}/pull/${number}`,
      PullFile: ({ owner, repository, number }) =>
        `https://github.com/${owner}/${repository}/pull/${number}`,
      PullCommits: ({ owner, repository, number }) =>
        `https://github.com/${owner}/${repository}/pull/${number}`,
      PullCommit: ({ owner, repository, number }) =>
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
