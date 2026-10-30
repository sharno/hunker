import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// The real-server spec and its Playwright web server share these paths.
export const e2ePort = process.env.HUNKER_E2E_PORT ?? "5175";
const fixtureRoot = join(tmpdir(), `hunker-e2e-${e2ePort}`);
export const repositoriesRoot = join(fixtureRoot, "repositories");
export const cacheRoot = join(fixtureRoot, "cache");
export const configFile = join(fixtureRoot, "settings.json");
export const checkout = join(repositoriesRoot, "acme", "widgets");
const origin = join(fixtureRoot, "origin", "widgets.git");
const seed = join(fixtureRoot, "seed");

// Git without the developer's configuration, for the fixture and the server.
export const gitEnvironment = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
};

export const needleLine = 150;

type Commit = {
  message: string;
  date: string;
  files: Record<string, string>;
};

const longFile = Array.from({ length: 200 }, (_, index) =>
  index + 1 === needleLine
    ? `pub const NEEDLE_LINE: usize = ${needleLine}; // needle`
    : `pub const LINE_${index + 1}: usize = ${index + 1};`,
).join("\n");

const library = `//! Widgets for Hunker's end-to-end tests.

pub struct Widget {
    pub name: String,
}

pub fn find(widgets: &[Widget]) -> Option<&Widget> {
    widgets.iter().find(|widget| widget.name == "needle")
}
`;

const history: Commit[] = [
  {
    message: "Add widgets",
    date: "2026-01-01T10:00:00Z",
    files: {
      "README.md": "# Widgets\n",
      "docs/guide.md": "Read the source.\n",
      "src/lib.rs": library,
      "src/long.rs": `${longFile}\n`,
    },
  },
  {
    message: "Add a greeting",
    date: "2026-01-02T10:00:00Z",
    files: {
      "src/lib.rs": `${library}\npub fn greeting() -> &'static str {\n    "hello"\n}\n`,
    },
  },
];

// Pushed to origin after the checkout was cloned, so the checkout is behind.
const upstream: Commit = {
  message: "Add a changelog",
  date: "2026-01-03T10:00:00Z",
  files: { "CHANGELOG.md": "## 0.1.0\n" },
};

export const longBranch =
  "feature/an-unusually-long-branch-name-that-widens-narrow-layouts";

// A local-only branch for the branch switcher.
const feature: Commit = {
  message: "Add tabs",
  date: "2026-01-04T10:00:00Z",
  files: { "src/tabs.rs": "pub fn tabs() {}\n" },
};

function git(cwd: string, args: string[], date?: string): void {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore",
    env: {
      ...process.env,
      ...gitEnvironment,
      GIT_AUTHOR_NAME: "Hunker Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.com",
      GIT_COMMITTER_NAME: "Hunker Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.com",
      ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
    },
  });
}

function commit(cwd: string, { message, date, files }: Commit): void {
  Object.entries(files).forEach(([path, content]) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  });
  git(cwd, ["add", "--all"]);
  git(cwd, ["commit", "--quiet", "--message", message], date);
}

/**
 * Rebuilds `acme/widgets` from scratch: `main` is one commit behind its
 * origin, `feature/tabs` is a local branch one commit ahead of `main`, and
 * a branch with a long name widens the branch select.
 * Fixed dates keep every OID the same across rebuilds, so a running server's
 * immutable caches stay valid.
 */
export function buildFixture(): void {
  rmSync(fixtureRoot, { recursive: true, force: true });
  mkdirSync(cacheRoot, { recursive: true });
  mkdirSync(dirname(origin), { recursive: true });
  git(fixtureRoot, [
    "init",
    "--quiet",
    "--bare",
    "--initial-branch=main",
    origin,
  ]);
  git(fixtureRoot, ["init", "--quiet", "--initial-branch=main", seed]);
  git(seed, ["remote", "add", "origin", origin]);
  history.forEach((entry) => commit(seed, entry));
  git(seed, ["push", "--quiet", "origin", "main"]);
  mkdirSync(dirname(checkout), { recursive: true });
  git(fixtureRoot, ["clone", "--quiet", origin, checkout]);
  commit(seed, upstream);
  git(seed, ["push", "--quiet", "origin", "main"]);
  git(checkout, ["switch", "--quiet", "--create", "feature/tabs"]);
  commit(checkout, feature);
  git(checkout, ["switch", "--quiet", "main"]);
  // The branch select is as wide as its longest option.
  git(checkout, ["branch", longBranch]);
}
