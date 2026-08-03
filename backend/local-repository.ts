import { FileFinder } from "@ff-labs/fff-node";
import {
  Context,
  Data,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Schema as S,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  compileTextSearch,
  type RepositorySearchMode,
} from "../src/features/code-search";
import { loadSettings, resolveConfiguredPath } from "./settings";

export type RepositoryFile = Readonly<{
  path: string;
  size: number;
  gitStatus: string;
}>;

export type RepositorySearchMatch = Readonly<{
  path: string;
  line: number;
  column: number;
  lineContent: string;
  contextBefore: ReadonlyArray<string>;
  contextAfter: ReadonlyArray<string>;
  ranges: ReadonlyArray<readonly [number, number]>;
  definition: boolean;
}>;

export type RepositoryCommit = Readonly<{
  sha: string;
  parents: ReadonlyArray<string>;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  subject: string;
}>;

export type RepositoryCommits = Readonly<{
  ref: string;
  shallow: boolean;
  commits: ReadonlyArray<RepositoryCommit>;
}>;

type RepositoryId = Readonly<{ owner: string; name: string }>;
export type RepositoryCloneDestination = "temporary" | "configured";
export type LocalRepositorySummary = Readonly<{
  owner: string;
  name: string;
  path: string;
  source: RepositoryCloneDestination;
}>;
export type LocalRepositories = Readonly<{
  configuredRoot: string;
  temporaryRoot: string;
  repositories: ReadonlyArray<LocalRepositorySummary>;
}>;

type LocalRepositoryShape = Readonly<{
  listRepositories: () => Effect.Effect<
    LocalRepositories,
    LocalRepositoryFailed
  >;
  listFiles: (
    repository: RepositoryId,
  ) => Effect.Effect<ReadonlyArray<RepositoryFile>, LocalRepositoryFailed>;
  search: (
    repository: RepositoryId,
    query: string,
    mode: RepositorySearchMode,
  ) => Effect.Effect<
    Readonly<{
      files: ReadonlyArray<RepositoryFile>;
      matches: ReadonlyArray<RepositorySearchMatch>;
    }>,
    LocalRepositoryFailed
  >;
  readFile: (
    repository: RepositoryId,
    relativePath: string,
  ) => Effect.Effect<
    Readonly<{ path: string; content: string; truncated: boolean }>,
    LocalRepositoryFailed
  >;
  listCommits: (
    repository: RepositoryId,
  ) => Effect.Effect<RepositoryCommits, LocalRepositoryFailed>;
  clone: (
    repository: RepositoryId,
    destination: RepositoryCloneDestination,
  ) => Effect.Effect<Readonly<{ path: string }>, LocalRepositoryFailed>;
}>;

export class LocalRepositoryFailed extends Data.TaggedError(
  "LocalRepositoryFailed",
)<{
  readonly message: string;
  readonly status: number;
}> {}

export class LocalRepository extends Context.Service<
  LocalRepository,
  LocalRepositoryShape
>()("hunker/LocalRepository") {}

const validSegment = /^[a-zA-Z0-9._-]+$/;
const maxFileCharacters = 500_000;
const fileSource = (
  path: string,
  lines: ReadonlyArray<string>,
): readonly [string, ReadonlyArray<string>] => [path, lines];

const RipgrepText = S.Struct({ text: S.String });
const RipgrepSubmatch = S.Struct({
  match: RipgrepText,
  start: S.Number,
  end: S.Number,
});
const RipgrepMatch = S.Struct({
  type: S.Literals(["match"]),
  data: S.Struct({
    path: RipgrepText,
    lines: RipgrepText,
    line_number: S.Number,
    submatches: S.Array(RipgrepSubmatch),
  }),
});

const parseJson = (value: string): unknown => JSON.parse(value);
const decodeRipgrepMatch = (line: string) =>
  Option.liftThrowable(parseJson)(line).pipe(
    Option.flatMap(S.decodeUnknownOption(RipgrepMatch)),
  );
const characterOffset = (value: string, byteOffset: number) =>
  Buffer.from(value).subarray(0, byteOffset).toString("utf8").length;
const matchRange = (start: number, end: number): readonly [number, number] => [
  start,
  end,
];
const relativeRipgrepPath = (path: string) =>
  path.startsWith("./") ? path.slice(2) : path;

export const cloneArguments = (
  repository: RepositoryId,
  target: string,
): ReadonlyArray<string> => [
  "repo",
  "clone",
  `${repository.owner}/${repository.name}`,
  target,
  "--",
  "--depth=1",
  "--single-branch",
  "--filter=blob:none",
  "--no-tags",
];

export const parseGitHubRemote = (remote: string): RepositoryId | undefined => {
  const match = remote
    .trim()
    .match(
      /^(?:git@github\.com:|https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?$/,
    );
  const owner = match?.[1];
  const name = match?.[2];
  return owner === undefined || name === undefined
    ? undefined
    : { owner, name };
};

const failure = (message: string, status = 500) =>
  new LocalRepositoryFailed({ message, status });

export const layer = Layer.effect(
  LocalRepository,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const finders = new Map<string, FileFinder>();
    const currentSettings = loadSettings.pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, paths),
    );
    const configuredPath = (value: string) =>
      resolveConfiguredPath(value).pipe(
        Effect.provideService(Path.Path, paths),
      );

    const runGit = (
      repositoryPath: string,
      arguments_: ReadonlyArray<string>,
    ) =>
      Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* spawner.spawn(
            ChildProcess.make("git", arguments_, { cwd: repositoryPath }),
          );
          const [output, exitCode] = yield* Effect.all(
            [Stream.mkString(Stream.decodeText(handle.all)), handle.exitCode],
            { concurrency: "unbounded" },
          );
          if (exitCode !== ChildProcessSpawner.ExitCode(0)) {
            return yield* failure(
              output.trim() ||
                `Git ${arguments_[0] ?? "command"} exited with status ${exitCode}.`,
              502,
            );
          }
          return output;
        }),
      ).pipe(
        Effect.mapError((error) =>
          error instanceof LocalRepositoryFailed
            ? error
            : failure(`Could not run Git: ${String(error)}`, 502),
        ),
      );

    const runRipgrep = (
      repositoryPath: string,
      arguments_: ReadonlyArray<string>,
      invalidPatternIsClientError = false,
    ) =>
      Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* spawner.spawn(
            ChildProcess.make("rg", arguments_, { cwd: repositoryPath }),
          );
          const [output, exitCode] = yield* Effect.all(
            [Stream.mkString(Stream.decodeText(handle.all)), handle.exitCode],
            { concurrency: "unbounded" },
          );
          if (
            exitCode === ChildProcessSpawner.ExitCode(0) ||
            exitCode === ChildProcessSpawner.ExitCode(1)
          ) {
            return output;
          }
          return yield* failure(
            output.trim() || `ripgrep exited with status ${exitCode}.`,
            invalidPatternIsClientError ? 400 : 502,
          );
        }),
      ).pipe(
        Effect.mapError((error) =>
          error instanceof LocalRepositoryFailed
            ? error
            : failure(`Could not run ripgrep: ${String(error)}`, 502),
        ),
      );

    const directoriesAt = (root: string) =>
      Effect.gen(function* () {
        const exists = yield* fs
          .exists(root)
          .pipe(Effect.mapError(() => failure(`Could not inspect ${root}.`)));
        if (!exists) return [];
        const entries = yield* fs
          .readDirectory(root)
          .pipe(Effect.mapError(() => failure(`Could not inspect ${root}.`)));
        const inspected = yield* Effect.forEach(
          entries,
          (entry) =>
            fs.stat(paths.resolve(root, entry)).pipe(
              Effect.map((info) => (info.type === "Directory" ? entry : "")),
              Effect.catch(() => Effect.succeed("")),
            ),
          { concurrency: 16 },
        );
        return inspected.filter((entry) => entry !== "").toSorted();
      });

    const isGitRepository = (repositoryPath: string) =>
      fs
        .exists(paths.resolve(repositoryPath, ".git"))
        .pipe(
          Effect.mapError(() =>
            failure(`Could not inspect ${repositoryPath}.`),
          ),
        );

    const repositorySummary = (
      repositoryPath: string,
      fallback: RepositoryId,
      source: RepositoryCloneDestination,
    ) =>
      runGit(repositoryPath, ["config", "--get", "remote.origin.url"]).pipe(
        Effect.map(
          (remote) =>
            parseGitHubRemote(remote) ?? {
              owner: fallback.owner,
              name: fallback.name,
            },
        ),
        Effect.catch(() => Effect.succeed(fallback)),
        Effect.map(({ owner, name }) => ({
          owner,
          name,
          path: repositoryPath,
          source,
        })),
      );

    const repositoriesUnder = (
      root: string,
      source: RepositoryCloneDestination,
    ) =>
      Effect.gen(function* () {
        const topLevel = yield* directoriesAt(root);
        const groups = yield* Effect.forEach(
          topLevel,
          (entry) =>
            Effect.gen(function* () {
              const direct = paths.resolve(root, entry);
              if (yield* isGitRepository(direct)) {
                return [
                  yield* repositorySummary(
                    direct,
                    { owner: "local", name: entry },
                    source,
                  ),
                ];
              }
              const nested = yield* directoriesAt(direct);
              return yield* Effect.forEach(
                nested,
                (name) =>
                  Effect.gen(function* () {
                    const repositoryPath = paths.resolve(direct, name);
                    return (yield* isGitRepository(repositoryPath))
                      ? yield* repositorySummary(
                          repositoryPath,
                          { owner: entry, name },
                          source,
                        )
                      : undefined;
                  }),
                { concurrency: 8 },
              ).pipe(
                Effect.map((repositories) =>
                  repositories.filter(
                    (repository): repository is LocalRepositorySummary =>
                      repository !== undefined,
                  ),
                ),
              );
            }),
          { concurrency: 8 },
        );
        return groups.flat();
      });

    const listRepositories = () =>
      Effect.gen(function* () {
        const { settings } = yield* currentSettings.pipe(
          Effect.mapError((error) => failure(error.message)),
        );
        const configuredRoot = yield* configuredPath(settings.repositoriesRoot);
        const temporaryRoot = yield* configuredPath(settings.cacheRoot);
        const [configured, temporary] = yield* Effect.all(
          [
            repositoriesUnder(configuredRoot, "configured"),
            repositoriesUnder(temporaryRoot, "temporary"),
          ],
          { concurrency: "unbounded" },
        );
        const unique = new Map<string, LocalRepositorySummary>();
        for (const repository of [...configured, ...temporary]) {
          const key = `${repository.owner}/${repository.name}`.toLowerCase();
          if (!unique.has(key)) unique.set(key, repository);
        }
        return {
          configuredRoot,
          temporaryRoot,
          repositories: [...unique.values()].toSorted((left, right) =>
            `${left.owner}/${left.name}`.localeCompare(
              `${right.owner}/${right.name}`,
            ),
          ),
        };
      });

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const finder of finders.values()) finder.destroy();
        finders.clear();
      }),
    );

    const repositoryPath = (repository: RepositoryId) =>
      Effect.gen(function* () {
        if (
          !validSegment.test(repository.owner) ||
          !validSegment.test(repository.name)
        ) {
          return yield* failure("That repository name is not valid.", 400);
        }
        const { settings } = yield* currentSettings.pipe(
          Effect.mapError((error) => failure(error.message)),
        );
        const repositoriesRoot = yield* configuredPath(
          settings.repositoriesRoot,
        );
        const cacheRoot = yield* configuredPath(settings.cacheRoot);
        const flat = paths.resolve(repositoriesRoot, repository.name);
        const nested = paths.resolve(
          repositoriesRoot,
          repository.owner,
          repository.name,
        );
        const temporary = paths.resolve(
          cacheRoot,
          repository.owner,
          repository.name,
        );
        const flatExists = yield* fs
          .exists(flat)
          .pipe(
            Effect.mapError(() =>
              failure(`Could not inspect ${repositoriesRoot}.`),
            ),
          );
        if (flatExists) return flat;
        const nestedExists = yield* fs
          .exists(nested)
          .pipe(
            Effect.mapError(() =>
              failure(`Could not inspect ${repositoriesRoot}.`),
            ),
          );
        if (nestedExists) return nested;
        const temporaryExists = yield* fs
          .exists(temporary)
          .pipe(
            Effect.mapError(() => failure(`Could not inspect ${cacheRoot}.`)),
          );
        if (temporaryExists) return temporary;
        return yield* failure(
          `Local repository not found. Expected ${flat}, ${nested}, or ${temporary}.`,
          404,
        );
      });

    const clone = (
      repository: RepositoryId,
      destination: RepositoryCloneDestination,
    ) =>
      Effect.gen(function* () {
        if (
          !validSegment.test(repository.owner) ||
          !validSegment.test(repository.name)
        ) {
          return yield* failure("That repository name is not valid.", 400);
        }
        const { settings } = yield* currentSettings.pipe(
          Effect.mapError((error) => failure(error.message)),
        );
        const repositoriesRoot = yield* configuredPath(
          settings.repositoriesRoot,
        );
        const cacheRoot = yield* configuredPath(settings.cacheRoot);
        const root =
          destination === "configured" ? repositoriesRoot : cacheRoot;
        const target =
          destination === "configured"
            ? paths.resolve(root, repository.name)
            : paths.resolve(root, repository.owner, repository.name);
        const targetExists = yield* fs
          .exists(target)
          .pipe(Effect.mapError(() => failure(`Could not inspect ${target}.`)));
        if (targetExists) return { path: target };
        yield* fs
          .makeDirectory(paths.dirname(target), { recursive: true })
          .pipe(
            Effect.mapError(() =>
              failure(`Could not create ${paths.dirname(target)}.`),
            ),
          );
        const handle = yield* spawner
          .spawn(
            ChildProcess.make("gh", cloneArguments(repository, target), {
              cwd: paths.dirname(target),
            }),
          )
          .pipe(
            Effect.mapError((error) =>
              failure(`Could not start gh: ${String(error)}`),
            ),
          );
        const [output, exitCode] = yield* Effect.all(
          [Stream.mkString(Stream.decodeText(handle.all)), handle.exitCode],
          { concurrency: "unbounded" },
        ).pipe(
          Effect.mapError((error) =>
            failure(`Could not clone the repository: ${String(error)}`),
          ),
        );
        if (exitCode !== ChildProcessSpawner.ExitCode(0)) {
          return yield* failure(
            output.trim() || "GitHub CLI could not clone this repository.",
            502,
          );
        }
        return { path: target };
      }).pipe(Effect.scoped);

    const finderFor = (repository: RepositoryId) =>
      Effect.gen(function* () {
        const root = yield* repositoryPath(repository);
        const cached = finders.get(root);
        if (cached !== undefined && !cached.isDestroyed)
          return { root, finder: cached };
        const created = yield* Effect.try({
          try: () => FileFinder.create({ basePath: root, aiMode: true }),
          catch: (error) =>
            failure(`FFF could not index ${root}: ${String(error)}`),
        });
        if (!created.ok)
          return yield* failure(
            `FFF could not index ${root}: ${created.error}`,
          );
        finders.set(root, created.value);
        const scanned = yield* Effect.tryPromise({
          try: () => created.value.waitForScan(15_000),
          catch: (error) =>
            failure(`FFF could not scan ${root}: ${String(error)}`),
        });
        if (!scanned.ok)
          return yield* failure(`FFF could not scan ${root}: ${scanned.error}`);
        return { root, finder: created.value };
      });

    const validatedFilePath = (root: string, relativePath: string) =>
      Effect.gen(function* () {
        const absolute = paths.resolve(root, relativePath);
        if (
          relativePath === "" ||
          !absolute.startsWith(`${root}${paths.sep}`)
        ) {
          return yield* failure(
            "That file is outside the configured repository.",
            400,
          );
        }
        const canonicalRoot = yield* fs
          .realPath(root)
          .pipe(Effect.mapError(() => failure(`Could not inspect ${root}.`)));
        const canonicalFile = yield* fs
          .realPath(absolute)
          .pipe(
            Effect.mapError(() =>
              failure(`Could not read ${relativePath}.`, 404),
            ),
          );
        if (!canonicalFile.startsWith(`${canonicalRoot}${paths.sep}`)) {
          return yield* failure(
            "That file is outside the configured repository.",
            400,
          );
        }
        return canonicalFile;
      });

    const listFiles = (repository: RepositoryId) =>
      Effect.gen(function* () {
        const { finder } = yield* finderFor(repository);
        const result = yield* Effect.try({
          try: () => finder.glob("**/*", { pageSize: 20_000 }),
          catch: (error) =>
            failure(`FFF file listing failed: ${String(error)}`),
        });
        if (!result.ok)
          return yield* failure(`FFF file listing failed: ${result.error}`);
        return result.value.items.map((item) => ({
          path: item.relativePath,
          size: item.size,
          gitStatus: item.gitStatus,
        }));
      });

    const fuzzySearch = (repository: RepositoryId, query: string) =>
      Effect.gen(function* () {
        const { root, finder } = yield* finderFor(repository);
        const files = yield* Effect.try({
          try: () => finder.fileSearch(query, { pageSize: 24 }),
          catch: (error) =>
            failure(`FFF filename search failed: ${String(error)}`),
        });
        if (!files.ok)
          return yield* failure(`FFF filename search failed: ${files.error}`);
        const grep = yield* Effect.try({
          try: () =>
            finder.grep(query, {
              mode: "fuzzy",
              pageSize: 36,
              maxMatchesPerFile: 4,
              beforeContext: 2,
              afterContext: 2,
              classifyDefinitions: true,
              timeBudgetMs: 250,
            }),
          catch: (error) =>
            failure(`FFF content search failed: ${String(error)}`),
        });
        if (!grep.ok)
          return yield* failure(`FFF content search failed: ${grep.error}`);
        const matchedPaths = [
          ...new Set(grep.value.items.map((match) => match.relativePath)),
        ];
        const sources = new Map(
          yield* Effect.forEach(
            matchedPaths,
            (path) =>
              validatedFilePath(root, path).pipe(
                Effect.flatMap(fs.readFileString),
                Effect.map((content) => fileSource(path, content.split("\n"))),
                Effect.catch(() => Effect.succeed(fileSource(path, []))),
              ),
            { concurrency: 8 },
          ),
        );
        return {
          files: files.value.items.map((item) => ({
            path: item.relativePath,
            size: item.size,
            gitStatus: item.gitStatus,
          })),
          matches: grep.value.items.map((match) => {
            const lines = sources.get(match.relativePath) ?? [];
            const index = match.lineNumber - 1;
            return {
              path: match.relativePath,
              line: match.lineNumber,
              column: match.col,
              lineContent: match.lineContent,
              contextBefore: lines.slice(Math.max(0, index - 2), index),
              contextAfter: lines.slice(index + 1, index + 3),
              ranges: match.matchRanges,
              definition: match.isDefinition ?? false,
            };
          }),
        };
      });

    const textSearch = (
      repository: RepositoryId,
      query: string,
      mode: Exclude<RepositorySearchMode, "fuzzy">,
    ) =>
      Effect.gen(function* () {
        const root = yield* repositoryPath(repository);
        const expression = compileTextSearch(query, mode);
        if (expression._tag === "Invalid") {
          return yield* failure(expression.error, 400);
        }
        const [rawFiles, rawMatches] = yield* Effect.all([
          runRipgrep(root, ["--files", "--hidden", "--glob", "!.git"]),
          runRipgrep(
            root,
            [
              "--json",
              "--line-number",
              "--column",
              "--max-count",
              "4",
              "--max-filesize",
              "2M",
              "--hidden",
              "--glob",
              "!.git",
              "--smart-case",
              ...(mode === "literal" ? ["--fixed-strings"] : []),
              "--",
              query,
              ".",
            ],
            mode === "regex",
          ),
        ]);
        const filenamePaths = rawFiles
          .split("\n")
          .filter((path) => path !== "" && expression.matches(path))
          .slice(0, 24);
        const files = yield* Effect.forEach(
          filenamePaths,
          (path) =>
            fs.stat(paths.resolve(root, path)).pipe(
              Effect.map((info) => ({
                path,
                size: Number(info.size),
                gitStatus: "clean",
              })),
              Effect.catch(() =>
                Effect.succeed({ path, size: 0, gitStatus: "clean" }),
              ),
            ),
          { concurrency: 8 },
        );
        const decodedMatches = rawMatches
          .split("\n")
          .flatMap((line) => Option.toArray(decodeRipgrepMatch(line)))
          .slice(0, 100);
        const matchedPaths = [
          ...new Set(
            decodedMatches.map((match) =>
              relativeRipgrepPath(match.data.path.text),
            ),
          ),
        ];
        const sources = new Map(
          yield* Effect.forEach(
            matchedPaths,
            (path) =>
              validatedFilePath(root, path).pipe(
                Effect.flatMap(fs.readFileString),
                Effect.map((content) => fileSource(path, content.split("\n"))),
                Effect.catch(() => Effect.succeed(fileSource(path, []))),
              ),
            { concurrency: 8 },
          ),
        );
        return {
          files,
          matches: decodedMatches.map(({ data }) => {
            const path = relativeRipgrepPath(data.path.text);
            const lineContent = data.lines.text.replace(/\r?\n$/, "");
            const lines = sources.get(path) ?? [];
            const index = data.line_number - 1;
            const ranges = data.submatches.map((submatch) =>
              matchRange(
                characterOffset(lineContent, submatch.start),
                characterOffset(lineContent, submatch.end),
              ),
            );
            return {
              path,
              line: data.line_number,
              column: (ranges[0]?.[0] ?? 0) + 1,
              lineContent,
              contextBefore: lines.slice(Math.max(0, index - 2), index),
              contextAfter: lines.slice(index + 1, index + 3),
              ranges,
              definition: false,
            };
          }),
        };
      });

    const search = (
      repository: RepositoryId,
      query: string,
      mode: RepositorySearchMode,
    ) =>
      mode === "fuzzy"
        ? fuzzySearch(repository, query)
        : textSearch(repository, query, mode);

    const readFile = (repository: RepositoryId, relativePath: string) =>
      Effect.gen(function* () {
        const root = yield* repositoryPath(repository);
        const absolute = yield* validatedFilePath(root, relativePath);
        const content = yield* fs
          .readFileString(absolute)
          .pipe(
            Effect.mapError(() =>
              failure(`Could not read ${relativePath}.`, 404),
            ),
          );
        return {
          path: relativePath,
          content: content.slice(0, maxFileCharacters),
          truncated: content.length > maxFileCharacters,
        };
      });

    const listCommits = (repository: RepositoryId) =>
      Effect.gen(function* () {
        const root = yield* repositoryPath(repository);
        const [rawCommits, rawRef, rawShallow] = yield* Effect.all([
          runGit(root, [
            "log",
            "-100",
            "--no-show-signature",
            "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e",
            "HEAD",
          ]),
          runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
          runGit(root, ["rev-parse", "--is-shallow-repository"]),
        ]);
        const commits = rawCommits
          .split("\x1e")
          .map((record) => record.trim())
          .filter((record) => record !== "")
          .map((record) => {
            const [
              sha = "",
              parents = "",
              authorName = "",
              authorEmail = "",
              authoredAt = "",
              subject = "",
            ] = record.split("\x1f");
            return {
              sha,
              parents: parents.split(" ").filter((parent) => parent !== ""),
              authorName,
              authorEmail,
              authoredAt,
              subject,
            };
          });
        return {
          ref: rawRef.trim(),
          shallow: rawShallow.trim() === "true",
          commits,
        };
      });

    return LocalRepository.of({
      listRepositories,
      listFiles,
      search,
      readFile,
      listCommits,
      clone,
    });
  }),
);
