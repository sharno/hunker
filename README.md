# Hunker

Hunker is a focused pull-request diff viewer for reviewing human- and
agent-written changes. It reduces visual noise with whitespace filtering, token-
or character-level highlighting, syntax highlighting, and syntax-aware
structural diffs powered by ast-grep and tree-sitter.

The browser is Effect-first and the local backend is native Rust:

- Foldkit owns the browser model, messages, update function, commands, and view.
- Tailwind CSS v4 provides utility-first styling through its Vite plugin.
- Effect HTTP powers the browser client.
- Axum and Tokio serve the typed local API; Serde decodes every external JSON
  boundary.

## Project structure

- `src/model.ts`, `src/message.ts`, `src/state.ts` — application-level review
  state machine and route orchestration
- `src/page/repository/` — self-contained Foldkit Submodel with its own model,
  messages, commands, update, view modules (including the repository PR list),
  namespace, and story tests
- `src/page/settings/` — server-backed settings Submodel and settings page
- `src/features/github-location/` — reusable GitHub-location Submodel
- `src/features/commits.ts` — commit-list and commit-diff commands
- `src/features/revision.ts` — local PR freshness command and two-minute
  subscription
- `src/file-tree.ts` — shared typed file/folder hierarchy and ancestor expansion
- `src/diff.ts` — unified-diff parsing and full-file context stitching
- `src/view/commits-view.ts` — PR commit timeline and selected-commit workspace
- `src/view/file-tree-view.ts` — shared collapsible tree renderer for repository
  and review files
- `src/view/diff-view.ts` — unified/side-by-side rendering and hunk interaction
- `src/view/syntax-highlight.ts` — safe syntax tokenization and
  character-overlay composition
- `src/view/tailwind.ts` — typed Foldkit adapter and component utility
  definitions
- `src/view/review-view.ts` — review workspace composition
- `src/sample.ts` — local demonstration fixture
- `server/src/github.rs` — GitHub URL parsing, private authentication, API
  decoding, review threads, comments, replies, and review submission
- `server/src/local.rs` — OID-pinned Git backing, repository discovery, native
  FFF/ripgrep search, safe file reads, clone, branch, and pull operations
- `server/src/semantic.rs` — native ast-grep parsers, structural fingerprints,
  semantic changes, and review-wide move detection
- `server/src/character_diff.rs` — native Git whole-file alignment and inline
  token/character ranges
- `server/src/settings.rs` — Serde-validated, atomically persisted settings
- `server/src/main.rs` — Axum route composition for the frontend API contract

The review workflow remains the application-level Foldkit Model because it
coordinates routing and cross-cutting review state. Page-sized features become
Submodels only when they own an independent state machine; stateless diff, tree,
Markdown, and syntax renderers remain ordinary shared modules.

## Run locally

Requires Bun, Node.js 22 or newer, Rust 1.97 or newer, Git, GitHub CLI, and
ripgrep. ast-grep and FFF run through their native Rust crates. Inline diffs and
exact/regex repository search invoke the locally installed Git and ripgrep
binaries.

```bash
bun install
bun run dev
```

Open [http://localhost:5173](http://localhost:5173). The API runs on port `8787`
and Vite proxies `/api` to it.

Hunker deliberately mirrors the useful parts of GitHub's URL structure. Replace
`github.com` with the Hunker host to open repository, blob, repository-commit,
pull-request, PR-files, PR-commits, compare, and commit links. Hunker canonical
paths include `/owner/repository`, `/owner/repository/commits`,
`/owner/repository/blob/ref/path`, and
`/owner/repository/pull/number/files/path`. PR comment fragments such as
`#discussion_r123` are preserved and target the matching inline thread.

URLs describe location, not personal display preferences. The selected PR file,
PR commit, repository file, or repository commits list is encoded in the path,
so copying, refreshing, and opening another tab returns to the same content.
Review scope, layout, whitespace, semantic analysis, inline diff mode, syntax
highlighting, sidebar state, and GitHub review visibility are saved on the local
server. Old option-heavy Hunker query strings remain readable and canonicalize
to the clean route after loading. Use Refresh to discard cached analysis and
load the latest diff without changing the location.

The Commits tab loads the PR commit timeline. Selecting a commit reuses the same
diff workspace and controls for that commit's parent-to-commit change, and the
selected SHA is recorded in the URL for refreshes and copied tabs.

Once a review loads, Hunker replaces the separate loader and controls bars with
a single 48px sticky toolbar. Scope and layout remain directly accessible; diff
intelligence and opening another PR live in compact dropdowns.

Repository files, PR files, and commit files use the same nested folder tree;
folders sort before files, show descendant counts, and can be collapsed
independently. Selecting a hidden file reopens its ancestors. Diff files and
individual hunks can also be collapsed independently. The Full file action loads
the base and head versions through the authenticated Rust backend and fills in
context omitted by GitHub's patch; Patch only returns to the compact review
without another network request.

Syntax highlighting is enabled by default and can be toggled from the review
controls. Lowlight produces a token tree that Foldkit renders as safe spans, so
syntax colors compose with inline-diff overlays without injecting HTML. Hunker
registers only its supported grammars, including JavaScript, TypeScript, Python,
Rust, OpenTofu/HCL, Go, shell, JSON, YAML, HTML, CSS, SQL, C/C++, Java, and
Markdown.

Inline highlighting is calculated from the complete base and head files, not
from adjacent patch lines. Token mode is the default and highlights
code-oriented words and punctuation; Character mode is available for exact text
edits, and Off removes inline highlighting. The backend runs Git's histogram
diff with porcelain word-diff output, then returns typed line pairings and
ranges to the renderer. This lets unified and side-by-side views share the same
alignment, handles multi-line replacements, and composes with the whitespace
setting. Results are cached by file contents and never expose temporary paths to
the browser.

GitHub review threads can be shown or hidden inline, and that choice is saved as
a local review preference. Hunker can reply to an existing thread and submit
Comment, Approve, or Request changes reviews through the same server-side GitHub
credential used for private repositories. GitHub tokens need pull-request write
permission for replies and review submission. Individual threads are
collapsible; resolved GitHub threads are labeled and start collapsed so
completed discussions do not dominate the diff. Comment bodies render
GitHub-flavored Markdown through a typed syntax tree; raw HTML is displayed as
text instead of being injected.

The top bar accepts repository, pull request, compare, commit, PR-commit, and
blob URLs and opens the most specific Hunker view. GitHub `/pulls` URLs map to
Hunker’s `/:owner/:repository/pulls` repository PR list. The repository name
links to a local repository browser at `/:owner/:repository`. By default Hunker
resolves clones below `~/src`, including both `~/src/repository` and
`~/src/owner/repository` layouts. Open `/settings` to change that root, the
temporary clone root, and all review defaults. Settings are validated with Serde
and saved atomically to `~/.config/hunker/settings.json`, so they follow the
local Hunker server across browsers. Set `HUNKER_CONFIG_FILE` to use another
settings document. `HUNKER_REPOS_ROOT` and `HUNKER_CACHE_ROOT` supply defaults
when no settings file exists:

```bash
HUNKER_REPOS_ROOT=/path/to/clones bun run dev
```

Repository search is entirely local. Exact text is the default and ripgrep
provides fixed-string and regular-expression modes across filenames and file
contents. FFF remains available as an explicit fuzzy mode for approximate
discovery. Hunker adds surrounding source lines and opens matched files with the
same safe syntax highlighter used by diffs. Search queries and non-default modes
remain in the query string, while selected files and the Files/Commits view use
GitHub-shaped paths. Pull-request and selected-commit searches stay scoped to
their loaded changed paths and patch text, so they also work without a local
clone. The Commits view reads up to 100 commits from the local checkout's `HEAD`
and links each immutable OID to Hunker's existing commit-diff view. The API
validates repository and file paths against the configured root before reading
them. When a repository is unavailable, the browser offers to clone it either
below the configured repos root or into `/tmp/hunker/repositories`. Set
`HUNKER_CACHE_ROOT` to move temporary Hunker clones elsewhere. Cloning uses the
local `gh` authentication, including access to private repositories. New clones
start with only the default branch tip and use Git's partial-clone support;
missing immutable objects are fetched on demand, while the commits view deepens
the PR history progressively.

The repository Pull Requests tab is GitHub-backed and does not require a local
clone. It uses the server’s local `gh` authentication for private repositories,
supports open, closed, and combined views, loads 50 recently updated PRs per
page, and links each row directly to Hunker’s review view.

After a checkout or cache clone exists, Hunker automatically uses its Git object
database for PR and commit diffs, file revisions, and commit logs. Each loaded
review is pinned to immutable base/head OIDs, so separate tabs never switch a
shared checkout or silently change an already-rendered diff. Locally backed PRs
fetch only their tracked PR ref at most every two minutes and show “New revision
available” when that ref advances. GitHub remains the source for PR metadata and
review actions and is the fallback when a local object is unavailable. The
design and remaining repository-status/worktree work are documented in
[`docs/local-git-backing.md`](docs/local-git-backing.md).

## Useful commands

```bash
bun run build       # strict typecheck and production frontend build
bun run typecheck   # TypeScript only
bun run test:integration # thin real-browser transport/history/layout suite
bun run dev:web     # Foldkit frontend only
bun run dev:api     # Rust backend only
```

Hunker resolves GitHub credentials on the backend in this order:

1. `GITHUB_TOKEN`
2. `GH_TOKEN`
3. The active local `gh auth` session
4. Anonymous access for public repositories

The token never enters the browser. Run `gh auth login` if private repositories
are not available to your current GitHub account.

## Semantic diffs

Semantic analysis is lazy and cached per file in the browser model. When you
open a file with the Semantic toggle enabled, the Rust backend:

1. Reads that file at the pinned PR base and head OIDs from local Git when
   available, otherwise through the server-side GitHub credential.
2. Parses both versions in-process with ast-grep's tree-sitter grammars.
3. Matches declarations by exact AST fingerprint, then by name and structural
   shape.
4. Emits typed Inserted, Deleted, Updated, and Renamed changes while retaining
   GitHub's patch as the rendering source of truth.

Formatting-only changes produce identical syntax fingerprints and collapse to a
short “No syntax changes” result. Parse failures and unsupported languages are
explicit result states; Hunker keeps the regular GitHub patch visible instead of
failing the review. JavaScript, TypeScript, TSX, Python, Rust, and native
OpenTofu/HCL are currently supported.

Full diff mode renders every changed file in one scroll and lazily builds a
virtual syntax forest from all changed JavaScript, TypeScript, Python, Rust, and
native OpenTofu/HCL files. Unique declarations are matched across every old and
new tree, including edited moves matched by structural shape. Moves are
summarized with source and destination lines and highlighted in purple in both
locations. Generated lockfiles are excluded from review-wide analysis.
