# Hunker

Hunker is a fast local pull-request and Git branch diff viewer for reviewing
human- and agent-written changes. It combines Git word alignment, syntax
highlighting, ast-grep/tree-sitter semantic changes, cross-file move detection,
whitespace filtering, and GitHub review conversations in one focused UI.

The frontend is Elm 0.19.2. The backend is Rust with Axum and Tokio. A single
Rust process compiles, embeds, and serves the optimized Elm application,
Tailwind CSS, and typed API.

## Run locally

Requirements: Bun, Node.js 22+, Rust 1.97+, Git, and GitHub CLI. ast-grep and
FFF are native Rust dependencies.

```bash
bun install
bun run dev
```

Open [http://localhost:5173](http://localhost:5173). Set `HUNKER_PORT` to use a
different port. The browser and API are same-origin; there is no separate Vite
process.

Private GitHub repositories use credentials in this order:

1. `GITHUB_TOKEN`
2. `GH_TOKEN`
3. The active local `gh auth` session
4. Anonymous access for public repositories

The token never enters the browser. Run `gh auth login` if a private repository
is unavailable.

## GitHub-shaped routes

Replace `github.com` with the Hunker host for the focused views Hunker supports:

- `/:owner/:repository`
- `/:owner/:repository/pulls`
- `/:owner/:repository/commits[/ref]`
- `/:owner/:repository/blob/:ref/:path`
- `/:owner/:repository/pull/:number/files[/:path]`
- `/:owner/:repository/pull/:number/commits[/:sha]`
- `/:owner/:repository/compare/:range`
- `/:owner/:repository/commit/:sha`

The top bar also accepts any of those GitHub URLs. URLs encode location and are
safe to copy, reload, and open in multiple tabs. Display preferences—layout,
scope, whitespace, syntax, semantic analysis, inline diff mode, sidebar, and
GitHub review visibility—are saved by the local server instead of polluting the
URL.

## Review features

- Unified and side-by-side diffs with collapsible files and hunks
- Full-file expansion without losing the pinned base/head revision
- Git whole-file token or character alignment and whitespace filtering
- Safe syntax highlighting for JavaScript/TypeScript, Python, Rust,
  OpenTofu/HCL, and common text formats
- ast-grep semantic Inserted, Deleted, Updated, and Renamed declarations
- Review-wide moved-block detection with matching colors and jump links
- PR commit timeline and immutable selected-commit diffs
- GitHub inline comments, replies, overall Comment/Approve/Request changes
  reviews, sanitized Markdown, and resolved threads collapsed by default
- Loading states keyed by request identity, so a new route never displays stale
  data from the previous review

## Local repository features

The home page lists repositories below the configured repositories root and
Hunker's temporary clone root. Repository views provide a nested file browser,
literal/regex `git grep` search at the browsed commit with hits that open at
their line, optional FFF fuzzy search, commit and pull-request lists, branch
selection, source-control status with a background fetch, and fast-forward-only
pulls.

When a repository is not local, Hunker offers a partial shallow clone into the
configured root or temporary cache. It expands branch refs and history only as
needed. Once present, reviews use immutable local Git OIDs for diffs, files, and
commits while GitHub remains the metadata and review-action source. Local PR
refs are polled every two minutes and an available revision is explicit; an
already rendered review never silently changes.

Settings live at `~/.config/hunker/settings.json`. Override the document with
`HUNKER_CONFIG_FILE`, or defaults with `HUNKER_REPOS_ROOT` and
`HUNKER_CACHE_ROOT`. See
[`docs/local-git-backing.md`](docs/local-git-backing.md) for the backing model.

## Project structure

- `elm/src/Main.elm` — `Browser.application`, route transition, and runtime
  effect interpretation boundary
- `elm/src/Hunker/Page/` — Home, Repository, Review, and Settings state machines
- `elm/src/Hunker/Domain/` — decoded API/domain ADTs
- `elm/src/Hunker/Effect.elm` — testable application-effect ADT
- `elm/src/Hunker/Diff.elm`, `FileTree.elm`, `SemanticMove.elm` — shared pure
  logic
- `elm/styles.css` — Tailwind v4 theme and semantic component layer
- `server/src/` — GitHub, local Git, semantic analysis, search, settings, API,
  and embedded frontend
- `tests/*.elm` — Elm unit and full-program tests
- `tests/browser.spec.ts` — thin browser-only boundary suite

## Commands

```bash
bun run dev               # one Rust process on localhost:5173
bun run build             # optimized embedded production binary
bun run elm:test          # Elm unit and program tests
bun run test              # Elm and Rust suites
bun run test:integration  # thin Playwright transport/history/layout suite
bun run format:check
bun run lint
bun run typecheck
```
