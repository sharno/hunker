import { Clock, Effect, Schema as S, Semaphore } from "effect";

import {
  DetachedHead,
  RemoteCurrent,
  RemoteUnavailable,
  type Status,
  TrackingBranch,
  UntrackedBranch,
} from "../src/page/repository/source-control/model";
import type { LocalRepositoryFailed, RepositoryId } from "./local-repository";

export type GitResult = Readonly<{
  output: string;
  succeeded: boolean;
  exitCode: number;
}>;

type Dependencies = Readonly<{
  repositoryPath: (
    repository: RepositoryId,
  ) => Effect.Effect<string, LocalRepositoryFailed>;
  runGit: (
    workingDirectory: string,
    arguments_: ReadonlyArray<string>,
  ) => Effect.Effect<string, LocalRepositoryFailed>;
  runGitResult: (
    workingDirectory: string,
    arguments_: ReadonlyArray<string>,
  ) => Effect.Effect<GitResult, LocalRepositoryFailed>;
  invalidateFiles: (root: string) => Effect.Effect<void>;
  failure: (message: string, status?: number) => LocalRepositoryFailed;
}>;

const GitBranchRecord = S.Struct({
  name: S.NonEmptyString,
  oid: S.NonEmptyString,
});
const GitBranchRecords = S.Array(GitBranchRecord);
const GitPathList = S.Array(S.NonEmptyString);
const AheadBehind = S.Tuple([S.Number, S.Number]);

export const makeRepositorySourceControl = (dependencies: Dependencies) =>
  Effect.gen(function* () {
    const remoteBranches = new Map<string, ReadonlyArray<string>>();
    const remoteHealth = new Map<string, Status["remote"]>();
    const locks = new Map<string, Semaphore.Semaphore>();

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        remoteBranches.clear();
        remoteHealth.clear();
        locks.clear();
      }),
    );

    const decodeBranchRecords = (output: string) =>
      S.decodeUnknownEffect(GitBranchRecords)(
        output
          .split("\n")
          .filter((line) => line !== "")
          .map((line) => {
            const [name = "", oid = ""] = line.split("\0");
            return { name, oid };
          }),
      ).pipe(
        Effect.mapError(() =>
          dependencies.failure("Git returned an invalid branch listing.", 502),
        ),
      );

    const decodeRemoteBranches = (output: string) =>
      S.decodeUnknownEffect(GitBranchRecords)(
        output
          .split("\n")
          .filter((line) => line !== "")
          .map((line) => {
            const [oid = "", ref = ""] = line.split("\t");
            return { name: ref.replace(/^refs\/heads\//, ""), oid };
          }),
      ).pipe(
        Effect.mapError(() =>
          dependencies.failure(
            "Git returned an invalid remote branch listing.",
            502,
          ),
        ),
      );

    const decodePaths = (output: string) =>
      S.decodeUnknownEffect(GitPathList)(
        output.split("\0").filter((path) => path !== ""),
      ).pipe(
        Effect.mapError(() =>
          dependencies.failure(
            "Git returned an invalid working tree status.",
            502,
          ),
        ),
      );

    const decodeAheadBehind = (output: string) => {
      const [ahead, behind] = output.trim().split(/\s+/).map(Number);
      return S.decodeUnknownEffect(AheadBehind)([ahead, behind]).pipe(
        Effect.mapError(() =>
          dependencies.failure(
            "Git returned invalid ahead/behind counts.",
            502,
          ),
        ),
      );
    };

    const runGitAction = (
      workingDirectory: string,
      arguments_: ReadonlyArray<string>,
    ) =>
      dependencies
        .runGitResult(workingDirectory, arguments_)
        .pipe(
          Effect.flatMap((result) =>
            result.succeeded
              ? Effect.succeed(result.output)
              : Effect.fail(
                  dependencies.failure(
                    result.output.trim() ||
                      `Git ${arguments_[0] ?? "command"} refused the operation.`,
                    409,
                  ),
                ),
          ),
        );

    const inspect = (repository: RepositoryId, refreshRemote: boolean) =>
      Effect.gen(function* () {
        const root = yield* dependencies.repositoryPath(repository);
        const checkedAt = yield* Clock.currentTimeMillis;
        const fetchResult = refreshRemote
          ? yield* dependencies.runGitResult(root, [
              "fetch",
              "--prune",
              "--quiet",
              "origin",
            ])
          : undefined;
        const remoteResult = refreshRemote
          ? yield* dependencies.runGitResult(root, [
              "ls-remote",
              "--heads",
              "origin",
            ])
          : undefined;
        if (remoteResult?.succeeded === true) {
          const records = yield* decodeRemoteBranches(remoteResult.output);
          remoteBranches.set(
            root,
            records.map((record) => record.name),
          );
        }

        const [
          rawLocalBranches,
          rawOid,
          symbolicBranch,
          staged,
          unstaged,
          untracked,
        ] = yield* Effect.all(
          [
            dependencies.runGit(root, [
              "for-each-ref",
              "--format=%(refname:short)%00%(objectname)",
              "refs/heads",
            ]),
            dependencies.runGit(root, ["rev-parse", "HEAD"]),
            dependencies.runGitResult(root, [
              "symbolic-ref",
              "--quiet",
              "--short",
              "HEAD",
            ]),
            dependencies.runGit(root, [
              "diff",
              "--cached",
              "--name-only",
              "-z",
            ]),
            dependencies.runGit(root, ["diff", "--name-only", "-z"]),
            dependencies.runGit(root, [
              "ls-files",
              "--others",
              "--exclude-standard",
              "-z",
            ]),
          ],
          { concurrency: "unbounded" },
        );
        const localBranches = yield* decodeBranchRecords(rawLocalBranches);
        const [stagedPaths, unstagedPaths, untrackedPaths] = yield* Effect.all(
          [decodePaths(staged), decodePaths(unstaged), decodePaths(untracked)],
          { concurrency: "unbounded" },
        );
        const knownRemoteBranches = remoteBranches.get(root) ?? [];
        const localNames = new Set(localBranches.map((branch) => branch.name));
        const remoteNames = new Set(knownRemoteBranches);
        const branches = [...new Set([...localNames, ...remoteNames])]
          .toSorted((left, right) => left.localeCompare(right))
          .map((name) => ({
            name,
            local: localNames.has(name),
            remote: remoteNames.has(name),
          }));
        const oid = rawOid.trim();
        const checkout = symbolicBranch.succeeded
          ? yield* Effect.gen(function* () {
              const name = symbolicBranch.output.trim();
              const upstreamResult = yield* dependencies.runGitResult(root, [
                "for-each-ref",
                "--format=%(upstream:short)",
                `refs/heads/${name}`,
              ]);
              const upstream = upstreamResult.output.trim();
              if (!upstreamResult.succeeded || upstream === "") {
                return UntrackedBranch({ name, oid });
              }
              const countsResult = yield* dependencies.runGitResult(root, [
                "rev-list",
                "--left-right",
                "--count",
                "HEAD...@{upstream}",
              ]);
              const [ahead, behind] = countsResult.succeeded
                ? yield* decodeAheadBehind(countsResult.output)
                : [0, 0];
              return TrackingBranch({ name, oid, upstream, ahead, behind });
            })
          : DetachedHead({ oid });
        const remoteErrors = [fetchResult, remoteResult]
          .flatMap((result) =>
            result === undefined || result.succeeded
              ? []
              : [
                  result.output.trim() ||
                    `Git remote command exited with status ${result.exitCode}.`,
                ],
          )
          .filter((message) => message !== "");
        const remote = refreshRemote
          ? remoteErrors.length === 0
            ? RemoteCurrent({ checkedAt })
            : RemoteUnavailable({
                checkedAt,
                error: remoteErrors.join("\n"),
              })
          : (remoteHealth.get(root) ?? RemoteCurrent({ checkedAt }));
        if (refreshRemote) remoteHealth.set(root, remote);
        return {
          path: root,
          checkout,
          branches,
          changes: {
            staged: stagedPaths.length,
            unstaged: unstagedPaths.length,
            untracked: untrackedPaths.length,
          },
          remote,
        };
      });

    const withLock = <A>(
      repository: RepositoryId,
      effect: Effect.Effect<A, LocalRepositoryFailed>,
    ) =>
      Effect.gen(function* () {
        const root = yield* dependencies.repositoryPath(repository);
        const lock = yield* Effect.sync(() => {
          const current = locks.get(root);
          if (current !== undefined) return current;
          const created = Semaphore.makeUnsafe(1);
          locks.set(root, created);
          return created;
        });
        return yield* lock.withPermit(effect);
      });

    const sourceControl = (repository: RepositoryId) =>
      withLock(repository, inspect(repository, true));

    const switchBranch = (repository: RepositoryId, branch: string) =>
      withLock(
        repository,
        Effect.gen(function* () {
          const root = yield* dependencies.repositoryPath(repository);
          yield* runGitAction(root, ["check-ref-format", "--branch", branch]);
          const current = yield* inspect(repository, true);
          const target = current.branches.find(
            (candidate) => candidate.name === branch,
          );
          if (target === undefined) {
            return yield* dependencies.failure(
              `Branch ${branch} was not found.`,
              404,
            );
          }
          if (target.local) {
            yield* runGitAction(root, ["switch", "--", branch]);
          } else {
            const fetchRefSpec = `+refs/heads/${branch}:refs/remotes/origin/${branch}`;
            const configuredFetch = yield* dependencies.runGitResult(root, [
              "config",
              "--get-all",
              "remote.origin.fetch",
            ]);
            if (!configuredFetch.output.split("\n").includes(fetchRefSpec)) {
              yield* runGitAction(root, [
                "config",
                "--add",
                "remote.origin.fetch",
                fetchRefSpec,
              ]);
            }
            yield* runGitAction(root, [
              "fetch",
              "origin",
              `refs/heads/${branch}:refs/remotes/origin/${branch}`,
              "--depth=1",
            ]);
            yield* runGitAction(root, [
              "switch",
              "--track",
              "-c",
              branch,
              "--",
              `origin/${branch}`,
            ]);
          }
          yield* dependencies.invalidateFiles(root);
          return yield* inspect(repository, false);
        }),
      );

    const pull = (repository: RepositoryId) =>
      withLock(
        repository,
        Effect.gen(function* () {
          const root = yield* dependencies.repositoryPath(repository);
          const current = yield* inspect(repository, true);
          if (current.checkout._tag === "DetachedHead") {
            return yield* dependencies.failure(
              "Cannot pull while HEAD is detached. Switch to a branch first.",
              409,
            );
          }
          if (current.checkout._tag === "UntrackedBranch") {
            return yield* dependencies.failure(
              `Branch ${current.checkout.name} does not track a remote branch.`,
              409,
            );
          }
          if (current.checkout.behind === 0) {
            return { status: current, pulledCommits: 0 };
          }
          const before = current.checkout.oid;
          yield* runGitAction(root, ["pull", "--ff-only"]);
          const after = (yield* dependencies.runGit(root, [
            "rev-parse",
            "HEAD",
          ])).trim();
          const pulledCommits = Number(
            (yield* dependencies.runGit(root, [
              "rev-list",
              "--count",
              `${before}..${after}`,
            ])).trim(),
          );
          yield* dependencies.invalidateFiles(root);
          return {
            status: yield* inspect(repository, false),
            pulledCommits: Number.isSafeInteger(pulledCommits)
              ? pulledCommits
              : 0,
          };
        }),
      );

    return { sourceControl, switchBranch, pull };
  });
