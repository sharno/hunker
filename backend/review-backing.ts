import { Effect, Option } from "effect";

import {
  loadDiffAtRevision,
  loadFilePair,
  loadFilePairAtRevision,
  loadFilePairs,
  loadFilePairsAtRevision,
  loadReview,
  loadReviewDiff,
  loadReviewMetadata,
} from "./github";
import type { FileDescriptor, FileStatus, GitHubTarget } from "./github";
import { LocalGit, LocalGitFailed } from "./local-git";

const gitOid = /^[0-9a-f]{40,64}$/i;

export type PinnedRefs = Readonly<{ base: string; head: string }>;

export const pinnedRefs = (requestUrl: URL): Option.Option<PinnedRefs> => {
  const base = requestUrl.searchParams.get("baseOid") ?? "";
  const head = requestUrl.searchParams.get("headOid") ?? "";
  return gitOid.test(base) && gitOid.test(head)
    ? Option.some({ base, head })
    : Option.none();
};

export const isGitOid = (value: string) => gitOid.test(value);

const repositoryId = (target: GitHubTarget) => ({
  owner: target.owner,
  name: target.repo,
});

export const localFallback = <A>(
  effect: Effect.Effect<Option.Option<A>, LocalGitFailed>,
) =>
  effect.pipe(
    Effect.catch((error) =>
      Effect.logWarning(`Local Git fallback: ${error.message}`).pipe(
        Effect.as(Option.none<A>()),
      ),
    ),
  );

const localInput = (target: GitHubTarget, refs: PinnedRefs) => ({
  repository: repositoryId(target),
  baseOid: refs.base,
  headOid: refs.head,
  ...(target._tag === "PullTarget" ? { pullNumber: target.number } : {}),
});

export const loadReviewData = (target: GitHubTarget) =>
  Effect.gen(function* () {
    const metadata = yield* loadReviewMetadata(target);
    const { baseOid, headOid, headRef, ...reviewMetadata } = metadata;
    const refs = { base: baseOid, head: headOid };
    const localGit = yield* LocalGit;
    const local = yield* localFallback(
      localGit.loadDiff(localInput(target, refs)),
    );
    if (Option.isSome(local)) {
      return {
        ...reviewMetadata,
        diff: local.value.diff,
        backing: {
          source: "local" as const,
          baseOid,
          headOid,
          headRef,
          path: local.value.repository.path,
        },
      };
    }
    const diff = yield* loadReviewDiff(target);
    return {
      ...reviewMetadata,
      diff,
      backing: {
        source: "github" as const,
        baseOid,
        headOid,
        headRef,
        path: "",
      },
    };
  });

export const loadPinnedFilePair = (
  target: GitHubTarget,
  refs: Option.Option<PinnedRefs>,
  path: string,
  previousPath: string,
  status: FileStatus,
) =>
  Option.match(refs, {
    onNone: () => loadFilePair(target, path, previousPath, status),
    onSome: (revision) =>
      Effect.gen(function* () {
        const localGit = yield* LocalGit;
        const local = yield* localFallback(
          localGit.loadFilePair({
            ...localInput(target, revision),
            path,
            previousPath,
            status,
          }),
        );
        return Option.isSome(local)
          ? local.value
          : yield* loadFilePairAtRevision(
              target,
              revision,
              path,
              previousPath,
              status,
            );
      }),
  });

export const loadPinnedFilePairs = (
  target: GitHubTarget,
  refs: Option.Option<PinnedRefs>,
  files: ReadonlyArray<FileDescriptor>,
) =>
  Option.match(refs, {
    onNone: () => loadFilePairs(target, files),
    onSome: (revision) =>
      Effect.gen(function* () {
        const localGit = yield* LocalGit;
        return yield* Effect.forEach(
          files,
          (file) =>
            localFallback(
              localGit.loadFilePair({
                ...localInput(target, revision),
                ...file,
              }),
            ).pipe(
              Effect.flatMap((local) =>
                Option.isSome(local)
                  ? Effect.succeed({ ...file, ...local.value })
                  : loadFilePairsAtRevision(target, revision, [file]).pipe(
                      Effect.map(
                        (pairs) =>
                          pairs[0] ?? { ...file, oldText: "", newText: "" },
                      ),
                    ),
              ),
            ),
          { concurrency: 6 },
        );
      }),
  });

export const loadPinnedDiff = (
  target: GitHubTarget,
  refs: Option.Option<PinnedRefs>,
) =>
  Option.match(refs, {
    onNone: () => loadReview(target).pipe(Effect.map((review) => review.diff)),
    onSome: (revision) =>
      Effect.gen(function* () {
        const localGit = yield* LocalGit;
        const local = yield* localFallback(
          localGit.loadDiff(localInput(target, revision)),
        );
        return Option.isSome(local)
          ? local.value.diff
          : yield* loadDiffAtRevision(target, revision);
      }),
  });
