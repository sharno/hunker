import { Config, Context, Effect, Layer, Option, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

type GitHubAuthSource = "environment" | "gh" | "anonymous";

type GitHubAuthShape = Readonly<{
  token: Option.Option<string>;
  source: GitHubAuthSource;
}>;

export class GitHubAuth extends Context.Service<GitHubAuth, GitHubAuthShape>()(
  "hunker/GitHubAuth",
) {}

const readGhToken = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const handle = yield* spawner.spawn(
    ChildProcess.make("gh", ["auth", "token"]),
  );
  const [output, exitCode] = yield* Effect.all(
    [Stream.mkString(Stream.decodeText(handle.stdout)), handle.exitCode],
    { concurrency: "unbounded" },
  );
  if (exitCode !== ChildProcessSpawner.ExitCode(0)) {
    return yield* Effect.fail(
      new Error(`gh exited with status ${Number(exitCode)}`),
    );
  }
  const token = output.trim();
  if (token === "")
    return yield* Effect.fail(new Error("gh returned an empty token"));
  return token;
}).pipe(Effect.scoped, Effect.option);

const resolveGitHubAuth = Effect.gen(function* () {
  const githubToken = yield* Config.string("GITHUB_TOKEN").pipe(Config.option);
  const ghToken = yield* Config.string("GH_TOKEN").pipe(Config.option);
  const environmentToken = Option.orElse(githubToken, () => ghToken);

  const auth = Option.isSome(environmentToken)
    ? GitHubAuth.of({ token: environmentToken, source: "environment" })
    : Option.match(yield* readGhToken, {
        onNone: () =>
          GitHubAuth.of({ token: Option.none(), source: "anonymous" }),
        onSome: (token) =>
          GitHubAuth.of({ token: Option.some(token), source: "gh" }),
      });

  yield* Effect.logInfo(`GitHub authentication: ${auth.source}`);
  return auth;
});

export const layer = Layer.effect(GitHubAuth, resolveGitHubAuth);
