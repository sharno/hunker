# Hunker

Hunker is a focused pull-request diff viewer for reviewing human- and agent-written changes. It reduces visual noise with whitespace filtering, character-level highlighting, semantic summaries, and moved-code detection.

The stack is Effect end to end:

- Foldkit owns the browser model, messages, update function, commands, and view.
- Effect HTTP powers the browser client and the local GitHub proxy.
- Effect Platform Node serves the backend API.

## Run locally

Requires Bun and Node.js 22 or newer.

```bash
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

Public GitHub pull request and compare URLs work without credentials. Set `GITHUB_TOKEN` before starting Hunker to review private repositories and raise GitHub API limits.
