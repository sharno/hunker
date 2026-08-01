# Hunker

Hunker is a focused pull-request diff viewer for reviewing human- and agent-written changes. It reduces visual noise with whitespace filtering, character-level highlighting, syntax highlighting, and syntax-aware structural diffs powered by ast-grep and tree-sitter.

The stack is Effect end to end:

- Foldkit owns the browser model, messages, update function, commands, and view.
- Tailwind CSS v4 provides utility-first styling through its Vite plugin.
- Effect HTTP powers the browser client and the local GitHub proxy.
- Effect Platform Node serves the backend API.

## Project structure

- `src/domain.ts` — schemas, model, and messages
- `src/state.ts` — update function, initialization, and HTTP command
- `src/diff.ts` — unified-diff parsing and full-file context stitching
- `src/view/diff-view.ts` — unified/side-by-side rendering and hunk interaction
- `src/view/syntax-highlight.ts` — safe syntax tokenization and character-overlay composition
- `src/view/tailwind.ts` — typed Foldkit adapter and component utility definitions
- `src/view/review-view.ts` — review workspace composition
- `src/sample.ts` — local demonstration fixture
- `backend/github-auth.ts` — environment and `gh` credential discovery
- `backend/github.ts` — GitHub URL parsing, API calls, and base/head content loading
- `backend/github-reviews.ts` — review-thread reads, replies, and review submission
- `backend/ast-grep-analysis.ts` — parser selection, AST units, and structural fingerprints
- `backend/semantic-engine.ts` — Effect service, semantic matching, and review-wide move detection
- `backend/character-diff-engine.ts` — native Git whole-file alignment and character ranges
- `backend/server.ts` — Effect HTTP route composition

## Run locally

Requires Bun, Node.js 22 or newer, and Git. ast-grep runs in the server process
through its native TypeScript package. Character diffs invoke the locally
installed Git binary through an Effect service.

```bash
bun install
bun run dev
```

Open [http://localhost:5173](http://localhost:5173). The API runs on port `8787` and Vite proxies `/api` to it.

Loading a review replaces the local address with a shareable route such as
`http://localhost:5173/radarlabs/server/pull/7848`. Opening that route in another
tab or reloading it fetches the review automatically. The query string records
the selected file, full/file scope, layout, whitespace, semantic, character-diff,
syntax-highlighting, review, and sidebar settings, so copying the address restores the same review view. Use
the Refresh button in the review header to discard cached semantic results and
pull the latest diff from GitHub without losing those settings.

Files and individual hunks can be collapsed independently. The Full file action
loads the base and head versions through the authenticated Effect backend and
fills in context omitted by GitHub's patch; Patch only returns to the compact
review without another network request.

Syntax highlighting is enabled by default and can be toggled from the review
controls. Lowlight produces a token tree that Foldkit renders as safe spans, so
syntax colors compose with character-diff overlays without injecting HTML.
Hunker registers only its supported grammars, including JavaScript, TypeScript,
Python, Rust, OpenTofu/HCL, Go, shell, JSON, YAML, HTML, CSS, SQL, C/C++, Java,
and Markdown.

Character highlighting is calculated from the complete base and head files,
not from adjacent patch lines. The backend runs Git's histogram diff with
porcelain word-diff output and a one-character token regex, then returns typed
line pairings and character ranges to the renderer. This lets unified and
side-by-side views share the same alignment, handles multi-line replacements,
and composes with the whitespace setting. Results are cached by file contents
and never expose temporary paths to the browser.

GitHub review threads can be shown or hidden inline, and that choice is recorded
in the review URL. Hunker can reply to an existing thread and submit Comment,
Approve, or Request changes reviews through the same server-side GitHub
credential used for private repositories. GitHub tokens need pull-request write
permission for replies and review submission. Individual threads are collapsible;
resolved GitHub threads are labeled and start collapsed so completed discussions
do not dominate the diff.

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

1. Fetches that file at the PR base and head SHAs with the server-side GitHub credential.
2. Parses both versions in-process with ast-grep's tree-sitter grammars.
3. Matches declarations by exact AST fingerprint, then by name and structural shape.
4. Emits typed Inserted, Deleted, Updated, and Renamed changes while retaining GitHub's patch as the rendering source of truth.

Formatting-only changes produce identical syntax fingerprints and collapse to a short “No syntax changes” result. Parse failures and unsupported languages are explicit result states; Hunker keeps the regular GitHub patch visible instead of failing the review. JavaScript, TypeScript, TSX, Python, Rust, and native OpenTofu/HCL are currently supported.

Full diff mode renders every changed file in one scroll and lazily builds a virtual syntax forest from all changed JavaScript, TypeScript, Python, Rust, and native OpenTofu/HCL files. Unique declarations are matched across every old and new tree, including edited moves matched by structural shape. Moves are summarized with source and destination lines and highlighted in purple in both locations. Generated lockfiles are excluded from review-wide analysis.
