# Hunker

Hunker is a focused pull-request diff viewer for reviewing human- and agent-written changes. It reduces visual noise with whitespace filtering, character-level highlighting, and syntax-aware structural diffs powered by ast-grep and tree-sitter.

The stack is Effect end to end:

- Foldkit owns the browser model, messages, update function, commands, and view.
- Effect HTTP powers the browser client and the local GitHub proxy.
- Effect Platform Node serves the backend API.

## Project structure

- `src/domain.ts` — schemas, model, and messages
- `src/state.ts` — update function, initialization, and HTTP command
- `src/diff.ts` — unified-diff parsing and patch fallback
- `src/view/diff-view.ts` — unified and side-by-side line rendering
- `src/view/review-view.ts` — review workspace composition
- `src/sample.ts` — local demonstration fixture
- `backend/github-auth.ts` — environment and `gh` credential discovery
- `backend/github.ts` — GitHub URL parsing, API calls, and base/head content loading
- `backend/ast-grep-analysis.ts` — parser selection, AST units, and structural fingerprints
- `backend/semantic-engine.ts` — Effect service, semantic matching, and review-wide move detection
- `backend/server.ts` — Effect HTTP route composition

## Run locally

Requires Bun and Node.js 22 or newer. ast-grep runs in the server process through its native TypeScript package, so no separate diff binary is required.

```bash
bun install
bun run dev
```

Open [http://localhost:5173](http://localhost:5173). The API runs on port `8787` and Vite proxies `/api` to it.

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

Formatting-only changes produce identical syntax fingerprints and collapse to a short “No syntax changes” result. Parse failures and unsupported languages are explicit result states; Hunker keeps the regular GitHub patch visible instead of failing the review. JavaScript, TypeScript, and TSX are currently supported.

Full diff mode renders every changed file in one scroll and lazily builds a virtual syntax forest from all changed JavaScript and TypeScript files. Unique declarations are matched across every old and new tree, including edited moves matched by structural shape. Moves are summarized with source and destination lines and highlighted in purple in both locations. Generated lockfiles are excluded from review-wide analysis.
