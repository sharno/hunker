import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NodeServices } from "@effect/platform-node";
import { expect, test } from "@playwright/test";
import { ConfigProvider, Effect, Layer, Option } from "effect";

import { LocalGit, layer as localGitLayer } from "../backend/local-git";

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
  use: (service: LocalGit["Service"]) => Effect.Effect<A, unknown>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* LocalGit;
      return yield* use(service);
    }).pipe(
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
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
