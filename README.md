# Hunker

Hunker is a focused pull-request diff viewer for reviewing human- and agent-written changes. It reduces visual noise with whitespace filtering, character-level highlighting, and syntax-aware structural diffs powered by Difftastic.

The stack is Effect end to end:

- Foldkit owns the browser model, messages, update function, commands, and view.
- Effect HTTP powers the browser client and the local GitHub proxy.
- Effect Platform Node serves the backend API.

## Project structure

- `src/domain.ts` — schemas, model, and messages
- `src/state.ts` — update function, initialization, and HTTP command
- `src/diff.ts` — unified-diff parsing and patch fallback
- `src/semantic.ts` — Difftastic alignment and context-window projection
- `src/view/diff-view.ts` — unified and side-by-side line rendering
- `src/view/review-view.ts` — review workspace composition
- `src/sample.ts` — local demonstration fixture
- `backend/github-auth.ts` — environment and `gh` credential discovery
- `backend/github.ts` — GitHub URL parsing, API calls, and base/head content loading
- `backend/difftastic.ts` — scoped Difftastic process and JSON decoding
- `backend/server.ts` — Effect HTTP route composition

## Run locally

Requires Bun, Node.js 22 or newer, and Difftastic 0.69 or newer.

```bash
brew install difftastic
bun install
bun run dev
```

Open [http://localhost:5173](http://localhost:5173). The API runs on port `8787` and Vite proxies `/api` to it.

## Useful commands

```bash
bun run build       # strict typecheck and production frontend build
bun run typecheck   # TypeScript only
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
2. Writes both versions into an automatically cleaned-up temporary directory.
3. Runs `difft --display json` through Effect's child-process service.
4. Decodes the result into the typed Hunker domain and renders it in unified or side-by-side mode.

Difftastic's JSON output is currently marked unstable upstream, so `backend/difftastic.ts` is the compatibility boundary to update if its schema changes. If Difftastic cannot analyze a file, Hunker keeps the regular GitHub patch visible and shows the semantic error without failing the review.
