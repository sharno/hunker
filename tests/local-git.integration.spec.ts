import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NodeServices } from "@effect/platform-node";
import { expect, test } from "@playwright/test";
import { ConfigProvider, Effect, Layer, Option } from "effect";

import {
  LocalGit,
  LocalGitFailed,
  layer as localGitLayer,
} from "../backend/local-git";
import {
  LocalRepository,
  LocalRepositoryFailed,
  cloneArguments,
  layer as localRepositoryLayer,
  parseGitHubRemote,
} from "../backend/local-repository";

const git = (cwd: string, ...arguments_: ReadonlyArray<string>) =>
  execFileSync("git", arguments_, { cwd, encoding: "utf8" }).trim();

const commit = (repository: string, message: string, content: string) => {
  writeFileSync(join(repository, "message.txt"), content);
  git(repository, "add", "message.txt");
  git(repository, "commit", "-m", message);
  return git(repository, "rev-parse", "HEAD");
};

const runLocalGit = <A>(
  repositoriesRoot: string,
  use: (service: LocalGit["Service"]) => Effect.Effect<A, LocalGitFailed>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* LocalGit;
      return yield* use(service);
    }).pipe(
      // This test helper is the application entry point for the test runtime.
      // oxlint-disable-next-line effecttsgo/strict-effect-provide
      Effect.provide(localGitLayer.pipe(Layer.provide(NodeServices.layer))),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown({
          HUNKER_REPOS_ROOT: repositoriesRoot,
          HUNKER_CACHE_ROOT: join(repositoriesRoot, ".cache"),
        }),
      ),
    ),
  );

const runLocalRepository = <A>(
  repositoriesRoot: string,
  cacheRoot: string,
  use: (
    service: LocalRepository["Service"],
  ) => Effect.Effect<A, LocalRepositoryFailed>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* LocalRepository;
      return yield* use(service);
    }).pipe(
      // This test helper is the application entry point for the test runtime.
      // oxlint-disable-next-line effecttsgo/strict-effect-provide
      Effect.provide(
        localRepositoryLayer.pipe(Layer.provide(NodeServices.layer)),
      ),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown({
          HUNKER_REPOS_ROOT: repositoriesRoot,
          HUNKER_CACHE_ROOT: cacheRoot,
          HUNKER_CONFIG_FILE: join(repositoriesRoot, "missing-settings.json"),
        }),
      ),
    ),
  );

test("creates shallow partial clones without tags or unrelated branches", () => {
  expect(cloneArguments({ owner: "acme", name: "demo" }, "/tmp/demo")).toEqual([
    "repo",
    "clone",
    "acme/demo",
    "/tmp/demo",
    "--",
    "--depth=1",
    "--single-branch",
    "--filter=blob:none",
    "--no-tags",
  ]);
});

test("parses GitHub repository remotes", () => {
  expect(parseGitHubRemote("git@github.com:acme/demo.git")).toEqual({
    owner: "acme",
    name: "demo",
  });
  expect(parseGitHubRemote("https://github.com/acme/demo")).toEqual({
    owner: "acme",
    name: "demo",
  });
  expect(parseGitHubRemote("file:///tmp/demo.git")).toBeUndefined();
});

test("discovers configured and temporary repositories and prefers configured clones", async () => {
  const root = mkdtempSync(join(tmpdir(), "hunker-local-catalog-"));
  const repositoriesRoot = join(root, "repos");
  const cacheRoot = join(root, "cache");
  const configured = join(repositoriesRoot, "demo");
  const temporaryDuplicate = join(cacheRoot, "acme", "demo");
  const temporary = join(cacheRoot, "acme", "scratch");
  try {
    for (const repository of [configured, temporaryDuplicate, temporary]) {
      mkdirSync(repository, { recursive: true });
      git(repository, "init", "-b", "main");
    }
    git(configured, "remote", "add", "origin", "git@github.com:acme/demo.git");

    const catalog = await runLocalRepository(
      repositoriesRoot,
      cacheRoot,
      (service) => service.listRepositories,
    );

    expect(catalog).toEqual({
      configuredRoot: repositoriesRoot,
      temporaryRoot: cacheRoot,
      repositories: [
        {
          owner: "acme",
          name: "demo",
          path: configured,
          source: "configured",
        },
        {
          owner: "acme",
          name: "scratch",
          path: temporary,
          source: "temporary",
        },
      ],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reads pinned diffs, blobs, and commits without switching the checkout", async () => {
  const root = mkdtempSync(join(tmpdir(), "hunker-local-git-"));
  const repository = join(root, "acme", "demo");
  mkdirSync(repository, { recursive: true });
  try {
    git(repository, "init", "-b", "main");
    git(repository, "config", "user.email", "hunker@example.com");
    git(repository, "config", "user.name", "Hunker Test");
    const baseOid = commit(repository, "base", "before\n");
    const headOid = commit(repository, "head", "after\n");
    git(repository, "checkout", "--detach", baseOid);

    const result = await runLocalGit(root, (service) =>
      Effect.gen(function* () {
        const input = {
          repository: { owner: "acme", name: "demo" },
          baseOid,
          headOid,
        };
        const diff = yield* service.loadDiff(input);
        const pair = yield* service.loadFilePair({
          ...input,
          path: "message.txt",
          previousPath: "",
          status: "modified",
        });
        const commits = yield* service.loadCommits(input);
        return { diff, pair, commits };
      }),
    );

    expect(Option.getOrThrow(result.diff).diff).toContain("+after");
    expect(Option.getOrThrow(result.pair)).toEqual({
      oldText: "before\n",
      newText: "after\n",
    });
    expect(
      Option.getOrThrow(result.commits).map((item) => item.message),
    ).toEqual(["head"]);
    expect(git(repository, "rev-parse", "HEAD")).toBe(baseOid);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fetches a tracked pull ref and reports a newer immutable head", async () => {
  const root = mkdtempSync(join(tmpdir(), "hunker-local-revision-"));
  const source = join(root, "source");
  const remote = join(root, "remote.git");
  const repository = join(root, "acme", "demo");
  mkdirSync(source, { recursive: true });
  mkdirSync(join(root, "acme"), { recursive: true });
  try {
    git(source, "init", "-b", "main");
    git(source, "config", "user.email", "hunker@example.com");
    git(source, "config", "user.name", "Hunker Test");
    commit(source, "base", "base\n");
    const pinnedHeadOid = commit(source, "first revision", "first\n");
    const latestHeadOid = commit(source, "second revision", "second\n");
    execFileSync("git", ["init", "--bare", remote]);
    git(source, "remote", "add", "origin", remote);
    git(source, "push", "origin", "main");
    git(source, "push", "origin", `${latestHeadOid}:refs/pull/7/head`);
    execFileSync("git", ["clone", remote, repository]);

    const status = await runLocalGit(root, (service) =>
      service.checkPullRevision(
        { owner: "acme", name: "demo" },
        "7",
        pinnedHeadOid,
      ),
    );

    expect(Option.getOrThrow(status)).toEqual(
      expect.objectContaining({ pinnedHeadOid, latestHeadOid }),
    );
    expect(git(repository, "rev-parse", "--is-shallow-repository")).toBe(
      "false",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("hydrates exact objects for a shallow diff and deepens history for commits", async () => {
  const root = mkdtempSync(join(tmpdir(), "hunker-local-shallow-"));
  const source = join(root, "source");
  const remote = join(root, "remote.git");
  const repository = join(root, "acme", "demo");
  mkdirSync(source, { recursive: true });
  mkdirSync(join(root, "acme"), { recursive: true });
  try {
    git(source, "init", "-b", "main");
    git(source, "config", "user.email", "hunker@example.com");
    git(source, "config", "user.name", "Hunker Test");
    const baseOid = commit(source, "base", "base\n");
    git(source, "checkout", "-b", "feature");
    commit(source, "feature one", "one\n");
    const headOid = commit(source, "feature two", "two\n");
    git(source, "checkout", "main");
    const checkoutOid = commit(source, "main advanced", "main\n");
    execFileSync("git", ["init", "--bare", "--initial-branch=main", remote]);
    git(source, "remote", "add", "origin", remote);
    git(source, "push", "origin", "main");
    git(source, "push", "origin", `${headOid}:refs/pull/9/head`);
    execFileSync("git", [
      "clone",
      "--depth=1",
      "--single-branch",
      `file://${remote}`,
      repository,
    ]);

    expect(git(repository, "rev-parse", "--is-shallow-repository")).toBe(
      "true",
    );
    expect(() =>
      git(repository, "cat-file", "-e", `${baseOid}^{commit}`),
    ).toThrow();

    const result = await runLocalGit(root, (service) =>
      Effect.gen(function* () {
        const input = {
          repository: { owner: "acme", name: "demo" },
          pullNumber: "9",
          baseOid,
          headOid,
        };
        const diff = yield* service.loadDiff(input);
        const commits = yield* service.loadCommits(input);
        return { diff, commits };
      }),
    );

    expect(Option.getOrThrow(result.diff).diff).toContain("+two");
    expect(
      Option.getOrThrow(result.commits).map((item) => item.message),
    ).toEqual(["feature one", "feature two"]);
    expect(git(repository, "rev-parse", "HEAD")).toBe(checkoutOid);
    expect(git(repository, "cat-file", "-e", `${baseOid}^{commit}`)).toBe("");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
