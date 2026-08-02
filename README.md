# Hunker

Hunker is a focused pull-request diff viewer for reviewing human- and agent-written changes. It reduces visual noise with whitespace filtering, token- or character-level highlighting, syntax highlighting, and syntax-aware structural diffs powered by ast-grep and tree-sitter.

The stack is Effect end to end:

- Foldkit owns the browser model, messages, update function, commands, and view.
- Tailwind CSS v4 provides utility-first styling through its Vite plugin.
- Effect HTTP powers the browser client and the local GitHub proxy.
- Effect Platform Node serves the backend API.

## Project structure

- `src/domain.ts` — schemas, model, and messages
- `src/state.ts` — root review reducer and route orchestration
- `src/features/commits.ts` — commit-list and commit-diff commands
- `src/features/revision.ts` — local PR freshness command and two-minute subscription
- `src/features/repository.ts` — local-repository routes, commands, and reducer transitions
- `src/diff.ts` — unified-diff parsing and full-file context stitching
- `src/view/commits-view.ts` — PR commit timeline and selected-commit workspace
- `src/view/repository-view.ts` — FFF-backed local file browser and search results
- `src/view/diff-view.ts` — unified/side-by-side rendering and hunk interaction
- `src/view/syntax-highlight.ts` — safe syntax tokenization and character-overlay composition
- `src/view/tailwind.ts` — typed Foldkit adapter and component utility definitions
- `src/view/review-view.ts` — review workspace composition
- `src/sample.ts` — local demonstration fixture
- `backend/github-auth.ts` — environment and `gh` credential discovery
- `backend/github.ts` — GitHub URL parsing, API calls, and base/head content loading
- `backend/github-reviews.ts` — review-thread reads, replies, and review submission
- `backend/local-git.ts` — OID-pinned Git diffs, blobs, commits, and PR-ref freshness
- `backend/review-backing.ts` — local-object selection and pinned GitHub fallback
- `backend/local-repository.ts` — scoped local clone discovery, FFF indexes, and file reads
- `backend/ast-grep-analysis.ts` — parser selection, AST units, and structural fingerprints
- `backend/semantic-engine.ts` — Effect service, semantic matching, and review-wide move detection
- `backend/character-diff-engine.ts` — native Git whole-file alignment and inline token/character ranges
- `backend/server.ts` — Effect HTTP route composition

## Run locally

Requires Bun, Node.js 22 or newer, and Git. ast-grep runs in the server process
through its native TypeScript package. Inline diffs invoke the locally installed
Git binary through an Effect service.

```bash
bun install
bun run dev
```

Open [http://localhost:5173](http://localhost:5173). The API runs on port `8787` and Vite proxies `/api` to it.

Loading a review replaces the local address with a shareable route such as
`http://localhost:5173/radarlabs/server/pull/7848`. Opening that route in another
tab or reloading it fetches the review automatically. The query string records
the selected file, full/file scope, layout, whitespace, semantic, inline-diff,
syntax-highlighting, review, sidebar, active tab, and selected commit settings,
so copying the address restores the same review view. Use the Refresh button in
the review toolbar to discard cached semantic results and load the latest diff
without losing those settings.

The Commits tab loads the PR commit timeline. Selecting a commit reuses the same
diff workspace and controls for that commit's parent-to-commit change, and the
selected SHA is recorded in the URL for refreshes and copied tabs.

Once a review loads, Hunker replaces the separate loader and controls bars with
a single 48px sticky toolbar. Scope and layout remain directly accessible;
diff intelligence and opening another PR live in compact dropdowns.

Files and individual hunks can be collapsed independently. The Full file action
loads the base and head versions through the authenticated Effect backend and
fills in context omitted by GitHub's patch; Patch only returns to the compact
review without another network request.

Syntax highlighting is enabled by default and can be toggled from the review
controls. Lowlight produces a token tree that Foldkit renders as safe spans, so
syntax colors compose with inline-diff overlays without injecting HTML.
Hunker registers only its supported grammars, including JavaScript, TypeScript,
Python, Rust, OpenTofu/HCL, Go, shell, JSON, YAML, HTML, CSS, SQL, C/C++, Java,
and Markdown.

Inline highlighting is calculated from the complete base and head files, not
from adjacent patch lines. Token mode is the default and highlights code-oriented
words and punctuation; Character mode is available for exact text edits, and Off
removes inline highlighting. The backend runs Git's histogram diff with porcelain
word-diff output, then returns typed line pairings and ranges to the renderer.
This lets unified and side-by-side views share the same alignment, handles
multi-line replacements, and composes with the whitespace setting. Results are
cached by file contents and never expose temporary paths to the browser.

GitHub review threads can be shown or hidden inline, and that choice is recorded
in the review URL. Hunker can reply to an existing thread and submit Comment,
Approve, or Request changes reviews through the same server-side GitHub
credential used for private repositories. GitHub tokens need pull-request write
permission for replies and review submission. Individual threads are collapsible;
resolved GitHub threads are labeled and start collapsed so completed discussions
do not dominate the diff. Comment bodies render GitHub-flavored Markdown through
a typed syntax tree; raw HTML is displayed as text instead of being injected.

The top bar accepts repository, pull request, compare, commit, PR-commit, and
blob URLs and opens the most specific Hunker view. The repository name links to
a local repository browser at `/repo/:owner/:repository`. By default Hunker
resolves clones below `~/src`, including both `~/src/repository` and
`~/src/owner/repository` layouts. Set `HUNKER_REPOS_ROOT` before starting the API
to use another root:

```bash
HUNKER_REPOS_ROOT=/path/to/clones bun run dev
```

Repository search is entirely local. FFF maintains a native fuzzy index for
filename ranking and content matches; Hunker adds surrounding source lines and
opens matched files with the same safe syntax highlighter used by diffs. Search
queries and selected files are stored in the repository URL. The API validates
repository and file paths against the configured root before reading them.
When a repository is unavailable, the browser offers to clone it either below
the configured repos root or into `/tmp/hunker/repositories`. Set
`HUNKER_CACHE_ROOT` to move temporary Hunker clones elsewhere. Cloning uses the
local `gh` authentication, including access to private repositories. New clones
start with only the default branch tip and use Git's partial-clone support;
missing immutable objects are fetched on demand, while the commits view deepens
the PR history progressively.

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
bun run test:integration # Playwright UI and ast-grep engine tests
bun run dev:web     # Foldkit frontend only
bun run dev:api     # Effect backend only
```

Hunker resolves GitHub credentials on the backend in this order:

1. `GITHUB_TOKEN`
2. `GH_TOKEN`
3. The active local `gh auth` session
4. Anonymous access for public repositories

The token never enters the browser. Run `gh auth login` if private repositories are not available to your current GitHub account.

## Semantic diffs

Semantic analysis is lazy and cached per file in the browser model. When you open a file with the Semantic toggle enabled, the Effect backend:

1. Reads that file at the pinned PR base and head OIDs from local Git when available, otherwise through the server-side GitHub credential.
2. Parses both versions in-process with ast-grep's tree-sitter grammars.
3. Matches declarations by exact AST fingerprint, then by name and structural shape.
4. Emits typed Inserted, Deleted, Updated, and Renamed changes while retaining GitHub's patch as the rendering source of truth.

Formatting-only changes produce identical syntax fingerprints and collapse to a short “No syntax changes” result. Parse failures and unsupported languages are explicit result states; Hunker keeps the regular GitHub patch visible instead of failing the review. JavaScript, TypeScript, TSX, Python, Rust, and native OpenTofu/HCL are currently supported.

Full diff mode renders every changed file in one scroll and lazily builds a virtual syntax forest from all changed JavaScript, TypeScript, Python, Rust, and native OpenTofu/HCL files. Unique declarations are matched across every old and new tree, including edited moves matched by structural shape. Moves are summarized with source and destination lines and highlighted in purple in both locations. Generated lockfiles are excluded from review-wide analysis.
