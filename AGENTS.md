# Hunker agent guidance

## Architecture

- The browser application is Elm 0.19.2 under `elm/src`; Rust/Axum owns the
  local API and serves the compiled Elm and Tailwind assets from the same
  process. Do not introduce a second frontend runtime or development server.
- Keep `Hunker.Route.Route` as the sole authority for rendered location. Browser
  Back, Forward, cold loads, and pasted GitHub URLs must enter the same
  exhaustive route transition.
- Keep Elm domain state independent of `Browser.Navigation.Key` and `Cmd`.
  Updates return `Hunker.Effect.Effect`; the browser runtime and
  `elm-program-test` interpret that same ADT.
- Model async resources as
  `NotAsked | Loading identity | Failure identity error | Success identity value`.
  Put request identity inside the ADT and ignore responses that no longer match
  the active route.
- Decode external JSON directly into domain types in `Hunker.Domain.*`. Do not
  pass `Decode.Value`, unchecked flags, or parallel sentinel fields beyond the
  boundary.
- Organize stateful screens under `Hunker.Page.*`, transport in `Hunker.Api`,
  domain ADTs/decoders in `Hunker.Domain.*`, and shared pure rendering logic in
  focused modules such as `Hunker.Diff`, `Hunker.FileTree`, and
  `Hunker.SemanticMove`.
- Prefer ADTs and exhaustive pattern matching. If two fields can disagree,
  replace them with one type that makes the invalid combination unrepresentable.

## Elm UI and tests

- Format every Elm source and test with `elm-format`.
- Test state-machine and view branches through `avh4/elm-program-test`, mapping
  the real `Hunker.Effect.Effect` into simulated effects. Do not create a second
  test-only update function.
- Keep Playwright deliberately thin: history/deep-route fallback, real Fetch
  transport, CSS/layout/sticky behavior, and browser-specific interactions. Pure
  route, diff, tree, and state behavior belongs in Elm tests.
- URLs encode location (repository, tab, PR, commit, selected file), never
  display preferences. Save review preferences through `/api/settings`.
- Repository trees start collapsed; review trees start expanded. Selecting a
  nested file reveals its ancestors. Marking a review file reviewed also
  collapses it.
- Use a shrinkable `minmax(0, 1fr)` code track, `min-width: 0`,
  `white-space: break-spaces`, and `overflow-wrap: anywhere` for diff code.
  Verify split columns with a real-browser layout test.
- Bind GitHub inline comments to the loaded head OID, path, side, and a real
  patch line. Full-file synthetic context is not a valid GitHub anchor.
- Render GitHub Markdown with sanitization enabled. Resolved threads are tagged
  and collapsed by default.
- Cross-file move annotations use one stable identity with distinct source and
  destination anchors; color and navigation derive from that identity.
- Tailwind v4 is CSS-first in `elm/styles.css`. Keep semantic class names for
  stable state selectors, and validate the stylesheet through the Rust build.
- Prepare immutable hunks when a diff loads and index inline ranges by side and
  line before rendering. Never parse patches or linearly scan all word-diff rows
  inside a per-line view function.
- Exercise a 100+ file, 10k+ changed-line fixture before shipping review data
  pipeline changes. One route must issue one analysis request and apply one
  model update for one immutable snapshot.

## Rust server

- Keep the backend in `server/`, using typed Serde request/response structs and
  `AppError` at boundaries. Do not recover types with ad hoc JSON probing.
- `server/build.rs` compiles optimized Elm and Tailwind into `OUT_DIR`;
  `server/src/frontend.rs` embeds them. `bun install` is a prerequisite for a
  Cargo build.
- Read Git diffs, commits, and files from immutable OIDs. Worktree branch
  mutations are explicit repository actions; never switch a checkout merely to
  render a review.
- Key analysis snapshots by repository, base OID, head OID, and options. Load
  local blobs with one `git cat-file --batch` process and reuse the resulting
  file pairs for word diff, AST analysis, and whole-review move detection. Do
  not introduce per-file analysis endpoint fan-out.
- Parse Git diff boundaries only at line-start `diff --git` headers and infer
  status/rename metadata only before the first hunk. Changed source can itself
  contain diff headers and mode strings.
- Let Git decide whether checkout mutations are safe. Serialize them per
  repository, use `git switch` and fast-forward-only pulls, surface refusal, and
  refresh cached reads only after success.
- Keep independent repository data sources independent. GitHub-backed PR lists
  must not be blocked by a missing local clone.
- Decode structured subprocess output into Rust domain constructors at the
  command boundary and normalize paths before they enter application state.
- Retain one watched FFF picker per repository. Recreating it per query turns
  fuzzy search back into indexing work.
- Shallow clones expand refs/history only when a selected branch or immutable
  object requires it.

## Tooling

- Use Bun for JavaScript tool dependencies, Elm tooling, and scripts.
- TypeScript remains only at browser-test/tooling boundaries; keep TypeScript 7,
  strict types, Oxlint type-aware checks, and Oxfmt. Do not add Prettier.
- Do not add lint-disable or suppression comments to hide first-party design or
  type problems.
- Before pushing, run `bun run format:check`, `bun run lint`,
  `bun run typecheck`, `bun run test`, `bun run build`, and
  `bun run test:integration`.
