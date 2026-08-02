import { homedir, tmpdir } from "node:os";

import {
  Clock,
  Config,
  Context,
  Data,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import type { PullCommit } from "./github";
import type { FileDescriptor } from "./github";

export type RepositoryId = Readonly<{ owner: string; name: string }>;

export type LocalGitRepository = Readonly<{
  path: string;
  kind: "checkout" | "cache";
}>;

export type PinnedRevision = Readonly<{
  baseOid: string;
  headOid: string;
}>;

export type LocalDiff = PinnedRevision &
  Readonly<{
    repository: LocalGitRepository;
    diff: string;
  }>;

export type PullRevisionStatus = Readonly<{
  repository: LocalGitRepository;
  pinnedHeadOid: string;
  latestHeadOid: string;
  checkedAt: number;
}>;

type LoadDiffInput = PinnedRevision &
  Readonly<{
    repository: RepositoryId;
    pullNumber?: string;
  }>;

type LoadFilePairInput = LoadDiffInput & FileDescriptor;

type LocalGitShape = Readonly<{
  find: (
    repository: RepositoryId,
  ) => Effect.Effect<Option.Option<LocalGitRepository>, LocalGitFailed>;
  loadDiff: (
    input: LoadDiffInput,
  ) => Effect.Effect<Option.Option<LocalDiff>, LocalGitFailed>;
  loadFilePair: (
    input: LoadFilePairInput,
  ) => Effect.Effect<
    Option.Option<Readonly<{ oldText: string; newText: string }>>,
    LocalGitFailed
  >;
  loadCommits: (
    input: LoadDiffInput,
  ) => Effect.Effect<Option.Option<ReadonlyArray<PullCommit>>, LocalGitFailed>;
  checkPullRevision: (
    repository: RepositoryId,
    pullNumber: string,
    pinnedHeadOid: string,
  ) => Effect.Effect<Option.Option<PullRevisionStatus>, LocalGitFailed>;
}>;

export class LocalGitFailed extends Data.TaggedError("LocalGitFailed")<{
  readonly message: string;
  readonly status: number;
}> {}

export class LocalGit extends Context.Service<LocalGit, LocalGitShape>()(
  "hunker/LocalGit",
) {}

const validSegment = /^[a-zA-Z0-9._-]+$/;
const validOid = /^[0-9a-f]{40,64}$/i;
const fetchIntervalMs = 120_000;

const failure = (message: string, status = 500) =>
  new LocalGitFailed({ message, status });

const validateRepository = (repository: RepositoryId) =>
  validSegment.test(repository.owner) && validSegment.test(repository.name);

const validatePath = (path: string) =>
  path !== "" && !path.startsWith("/") && !path.includes("\0");

export const layer = Layer.effect(
  LocalGit,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const configuredRoot = yield* Config.string("HUNKER_REPOS_ROOT").pipe(
      Config.withDefault(paths.join(homedir(), "src")),
    );
    const repositoriesRoot = paths.resolve(
      configuredRoot.startsWith("~/")
        ? paths.join(homedir(), configuredRoot.slice(2))
        : configuredRoot,
    );
    const configuredCacheRoot = yield* Config.string("HUNKER_CACHE_ROOT").pipe(
      Config.withDefault(paths.join(tmpdir(), "hunker", "repositories")),
    );
    const cacheRoot = paths.resolve(configuredCacheRoot);
    const lastFetch = new Map<string, number>();

    const runGit = (
      repositoryPath: string,
      arguments_: ReadonlyArray<string>,
    ) =>
      Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* spawner.spawn(
            ChildProcess.make("git", arguments_, { cwd: repositoryPath }),
          );
          const [stdout, stderr, exitCode] = yield* Effect.all(
            [
              Stream.mkString(Stream.decodeText(handle.stdout)),
              Stream.mkString(Stream.decodeText(handle.stderr)),
              handle.exitCode,
            ],
            { concurrency: "unbounded" },
          );
          return { stdout, stderr, status: Number(exitCode) };
        }),
      ).pipe(
        Effect.mapError(error =>
          failure(`Could not run Git in ${repositoryPath}: ${String(error)}`, 502),
        ),
      );

    const runGitChecked = (
      repositoryPath: string,
      arguments_: ReadonlyArray<string>,
    ) =>
      runGit(repositoryPath, arguments_).pipe(
        Effect.flatMap(result =>
          result.status === 0
            ? Effect.succeed(result.stdout)
            : Effect.fail(
                failure(
                  result.stderr.trim() ||
                    result.stdout.trim() ||
                    `Git ${arguments_[0] ?? "command"} exited with status ${result.status}.`,
                  502,
                ),
              ),
        ),
      );

    const find = (repository: RepositoryId) =>
      Effect.gen(function* () {
        if (!validateRepository(repository)) {
          return yield* failure("That repository name is not valid.", 400);
        }
        const candidates: ReadonlyArray<LocalGitRepository> = [
          {
            path: paths.resolve(repositoriesRoot, repository.name),
            kind: "checkout",
          },
          {
            path: paths.resolve(repositoriesRoot, repository.owner, repository.name),
            kind: "checkout",
          },
          {
            path: paths.resolve(cacheRoot, repository.owner, repository.name),
            kind: "cache",
          },
        ];
        for (const candidate of candidates) {
          const exists = yield* fs.exists(candidate.path).pipe(
            Effect.mapError(() => failure(`Could not inspect ${candidate.path}.`)),
          );
          if (!exists) continue;
          const inspected = yield* runGit(candidate.path, ["rev-parse", "--git-dir"]);
          if (inspected.status === 0) return Option.some(candidate);
        }
        return Option.none();
      });

    const hasObject = (repositoryPath: string, oid: string) =>
      validOid.test(oid)
        ? runGit(repositoryPath, ["cat-file", "-e", `${oid}^{commit}`]).pipe(
            Effect.map(result => result.status === 0),
          )
        : Effect.succeed(false);

    const fetchPull = (
      repository: LocalGitRepository,
      pullNumber: string,
      force: boolean,
    ) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const previous = lastFetch.get(repository.path) ?? 0;
        if (!force && now - previous < fetchIntervalMs) return now;
        yield* runGitChecked(repository.path, ["fetch", "--prune", "origin"]);
        lastFetch.set(repository.path, now);
        yield* runGitChecked(repository.path, [
          "fetch",
          "origin",
          `+refs/pull/${pullNumber}/head:refs/hunker/pull/${pullNumber}/head`,
        ]);
        return now;
      });

    const prepare = (input: LoadDiffInput) =>
      Effect.gen(function* () {
        if (!validOid.test(input.baseOid) || !validOid.test(input.headOid)) {
          return Option.none<LocalGitRepository>();
        }
        const located = yield* find(input.repository);
        if (Option.isNone(located)) return located;
        const repository = located.value;
        const [hasBase, hasHead] = yield* Effect.all([
          hasObject(repository.path, input.baseOid),
          hasObject(repository.path, input.headOid),
        ]);
        if (input.pullNumber !== undefined) {
          yield* fetchPull(repository, input.pullNumber, !hasBase || !hasHead).pipe(
            Effect.catch(error =>
              Effect.logWarning(error.message).pipe(Effect.as(undefined)),
            ),
          );
        }
        const [preparedBase, preparedHead] = yield* Effect.all([
          hasObject(repository.path, input.baseOid),
          hasObject(repository.path, input.headOid),
        ]);
        return preparedBase && preparedHead ? located : Option.none();
      });

    const loadDiff = (input: LoadDiffInput) =>
      Effect.gen(function* () {
        const repository = yield* prepare(input);
        if (Option.isNone(repository)) return Option.none<LocalDiff>();
        const diff = yield* runGitChecked(repository.value.path, [
          "diff",
          "--find-renames",
          "--no-ext-diff",
          "--no-color",
          "--full-index",
          input.baseOid,
          input.headOid,
          "--",
        ]);
        return Option.some({
          repository: repository.value,
          baseOid: input.baseOid,
          headOid: input.headOid,
          diff,
        });
      });

    const showFile = (repositoryPath: string, oid: string, path: string) =>
      validatePath(path)
        ? runGitChecked(repositoryPath, ["show", `${oid}:${path}`])
        : Effect.fail(failure("That file path is not valid.", 400));

    const loadFilePair = (input: LoadFilePairInput) =>
      Effect.gen(function* () {
        const repository = yield* prepare(input);
        if (Option.isNone(repository)) {
          return Option.none<Readonly<{ oldText: string; newText: string }>>();
        }
        const oldPath =
          input.status === "renamed" && input.previousPath !== ""
            ? input.previousPath
            : input.path;
        const oldText =
          input.status === "added"
            ? ""
            : yield* showFile(repository.value.path, input.baseOid, oldPath);
        const newText =
          input.status === "deleted"
            ? ""
            : yield* showFile(repository.value.path, input.headOid, input.path);
        return Option.some({ oldText, newText });
      });

    const loadCommits = (input: LoadDiffInput) =>
      Effect.gen(function* () {
        const repository = yield* prepare(input);
        if (Option.isNone(repository)) {
          return Option.none<ReadonlyArray<PullCommit>>();
        }
        const output = yield* runGitChecked(repository.value.path, [
          "log",
          "--reverse",
          "--format=%H%x1f%B%x1f%an%x1f%aI%x1e",
          `${input.baseOid}..${input.headOid}`,
          "--",
        ]);
        const commits = output
          .split("\x1e")
          .map(record => record.trim())
          .filter(record => record !== "")
          .flatMap(record => {
            const [sha, message, author, authoredAt] = record.split("\x1f");
            if (sha === undefined || message === undefined) return [];
            return [
              {
                sha,
                message: message.trimEnd(),
                author: author ?? "Git user",
                avatarUrl: "",
                authoredAt: authoredAt ?? "",
                htmlUrl: `https://github.com/${input.repository.owner}/${input.repository.name}/commit/${sha}`,
              },
            ];
          });
        return Option.some(commits);
      });

    const checkPullRevision = (
      repositoryId: RepositoryId,
      pullNumber: string,
      pinnedHeadOid: string,
    ) =>
      Effect.gen(function* () {
        const repository = yield* find(repositoryId);
        if (Option.isNone(repository)) return Option.none<PullRevisionStatus>();
        const checkedAt = yield* fetchPull(repository.value, pullNumber, false);
        const latestHeadOid = (
          yield* runGitChecked(repository.value.path, [
            "rev-parse",
            `refs/hunker/pull/${pullNumber}/head^{commit}`,
          ])
        ).trim();
        return Option.some({
          repository: repository.value,
          pinnedHeadOid,
          latestHeadOid,
          checkedAt,
        });
      });

    return LocalGit.of({
      find,
      loadDiff,
      loadFilePair,
      loadCommits,
      checkPullRevision,
    });
  }),
);
