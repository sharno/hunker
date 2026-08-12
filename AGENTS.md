# Hunker agent guidance

## Architecture

- The browser application is Elm 0.19.2 under `elm/src`; Rust/Axum owns the
  local API and serves the compiled Elm and Tailwind assets from the same
  process. Do not introduce a second frontend runtime or development server.
- Keep exactly one routed application state. Boot states own their pending
  `Route`; ready page constructors own their typed location. Do not cache the
  route beside the page model. Browser Back, Forward, cold loads, and pasted
  GitHub URLs must enter the same exhaustive route transition.
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
- A ready review owns one opaque ordered file index. Do not keep parallel file
  lists, prepared-patch dictionaries, or sentinel copies in the page model.
- Review analysis owns the prepared `FileIndex` it decorates. Disabled,
  in-flight, failed, and complete analysis states each carry the corresponding
  index so a snapshot and its word ranges cannot update independently.
- Carry repository and immutable OID together in one opaque revision identity
  for Elm file and search requests. Do not pass positional repository/OID string
  pairs through feature state.
- A ready review also owns one immutable `Hunker.Review.Session.Id`. Full-file,
  collaboration, and analysis requests must carry that identity through their
  opaque feature modules so a response started on one PR cannot mutate another.
- Main exclusively owns settings and serializes/coalesces persistence. Pages
  emit settings-change intents; they do not issue `/api/settings` requests or
  cache an independent settings document.
- Keep settings persistence in the opaque `Hunker.Settings.Sync` state machine.
  Revision, sent settings, latest desired settings, config path, and save error
  belong to one ADT; do not reintroduce parallel synchronization fields in
  `Main`.
- Decode non-2xx JSON bodies into `Hunker.ApiError` inside `Hunker.Effect` and
  preserve that typed error through page state. Do not replace a server message
  with a status-only string or flatten errors before rendering.
- A repository page owns exactly one active `RepositoryView`. Route changes and
  clone completion reconstruct that view with named request identities so late
  file, search, commit, or pull responses cannot populate a different tab.
- Each `RepositoryView` constructor owns its route-specific location together
  with its state. Derive the canonical `RepositoryLocation` from that ADT; do
  not store a parallel page location or tab discriminator.
- Keep repository file/search, pull-list, and source-control transitions in
  `Hunker.Repository.*`; the page coordinates effects and routing instead of
  rebuilding those state machines as one flat record.
- Model local repository availability independently from the active repository
  view. Only `LocalMissing` owns clone state and only `LocalReady` owns an
  immutable OID-keyed file/source-control snapshot; GitHub-backed pull-request
  lists remain usable in every local availability state. Do not represent a
  failed lookup as a cloneable missing repository.

## Elm UI and tests

- Format every Elm source and test with `elm-format`.
- Test state-machine and view branches through `avh4/elm-program-test`, mapping
  the real `Hunker.Effect.Effect` into simulated effects. Do not create a second
  test-only update function.
- Keep Playwright deliberately thin: history/deep-route fallback, real Fetch
  transport, CSS/layout/sticky behavior, and browser-specific interactions. Pure
  route, diff, tree, and state behavior belongs in Elm tests.
- Keep Playwright on its dedicated `HUNKER_TEST_PORT`; never stop, replace, or
  reuse the developer's terminal-managed server. Reusing it can also exercise
  stale embedded Elm/CSS after a rebuild and produce misleading failures.
- URLs encode location (repository, tab, PR, commit, selected file), never
  display preferences. Save review preferences through `/api/settings`.
- A canonical URL change does not move the browser viewport. When a location
  selects an already-rendered full-diff file or semantic target, issue an
  explicit scroll effect after the route transition and account for sticky
  navigation. Cover the final panel position with a real-browser test.
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
- Index syntax highlights and fold coverage by line while decoding the typed
  source presentation. Per-line rendering must not scan a file-wide annotation
  list.
- Preserve native browser Find on large diffs. Use bounded DOM chunks with
  `content-visibility: auto` to defer layout and paint while keeping every line
  searchable; do not window diff text out of the DOM.
- Size sticky viewport scroll regions from their actual visible top rather than
  a static toolbar offset. Dynamic headers make the available height change as
  the page scrolls; update a CSS variable without routing scroll events through
  Elm state.
- `Browser.application` replaces its mount node. Browser-owned observers that
  must survive Elm initialization attach to a stable ancestor such as
  `document.body`, not the detached node passed to `Elm.Main.init`.
- Key and lazy-render full-diff file panels by path. Each panel receives only
  stable file-scoped analysis, UI, and collaboration values; never pass a
  review-wide model through every panel, because an unrelated draft or collapse
  transition would reconcile the entire diff.
- Do not pass the complete settings record into a lazy file panel. Translate
  only rendering-relevant preferences into small closed ADTs, and put purely
  visual switches on an ancestor CSS class, so unrelated global settings retain
  every panel's lazy identity.
- Index semantic moves once by path, endpoint, and covered line while accepting
  an analysis snapshot. Per-line rendering must never scan review-wide move
  results.
- Derive syntax spans and AST fold regions from the Rust revision's retained
  Tree-sitter forest. Elm renders the typed character ranges and owns only the
  collapsed fold identities; do not parse source syntax in the browser.
- Compose syntax highlighting and inline word changes as independent overlays on
  one segmented source line. Enabling one must never discard the other.
- Exercise a 100+ file, 10k+ changed-line fixture before shipping review data
  pipeline changes. One route must issue one analysis request and apply one
  model update for one immutable snapshot.
- Put feature rendering in generic view modules that receive decoded data and
  typed callbacks. View modules must not import a page model or message type;
  pages remain the owners of transitions, routes, and effects.

## Rust server

- Keep the backend in `server/`, using typed Serde request/response structs and
  `AppError` at boundaries. Do not recover types with ad hoc JSON probing.
- Decode repository slugs, branch names, clone destinations, search modes,
  analysis options, and pull-request numbers into closed enums or newtypes at
  the HTTP/URL boundary. Do not reinterpret their strings inside services.
- Return named Serde response structs and tagged enums from every Axum handler;
  never use `serde_json::Value` or `json!` as an application API contract.
- Keep `Hunker.Generated.ContractFixtures` generated by Rust domain values via
  `bun run contracts:write`. Elm decoder tests must consume those fixtures, and
  `contracts:check` must run before tests so Rust/Elm wire-format drift fails
  locally and in CI.
- Group Axum transport handlers by feature under `server/src/api`. Keep local
  object reads and checkout mutations in separate `local` modules; mutation
  commands surface Git refusal as conflicts and never participate in review
  rendering.
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
- Keep revision preparation and option-dependent analysis as separate immutable
  caches. The revision cache owns the Rust-parsed file changes and lazily loaded
  file pairs; all analysis-option snapshots reuse it. Prepare each syntax tree
  once per revision and use the same forest for per-file semantics and moves.
- Keep patch presentation proportional to the diff: return highlights only for
  visible patch lines and reserve full syntax spans and fold regions for the
  explicit full-file response.
- Rust is the sole Git diff parser. `/api/diff` returns a typed review document;
  Elm must never reinterpret raw Git patch boundaries into file changes.
- Fall back from local Git to GitHub only on `Ok(None)`. A local `Err` is a real
  backing failure and must remain visible instead of silently changing sources.
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
- Keep local Git responsibilities in feature modules: `catalog` discovers and
  reads repositories, `search` owns literal/regex/FFF indexing, `review_backing`
  owns immutable revision materialization, and `source_control` owns checkout
  inspection. Shared `local.rs` contains state and public result types only.
- Keep GitHub responsibilities split the same way: `transport` owns credentials
  and HTTP errors, `review_source` loads immutable review material, `reviews`
  owns collaboration mutations, and `repository` owns repository queries. Every
  outbound body is a typed `Serialize` payload; never pass a `serde_json::Value`
  through the client.

## Tooling

- Use Bun for JavaScript tool dependencies, Elm tooling, and scripts.
- TypeScript remains only at browser-test/tooling boundaries; keep TypeScript 7,
  strict types, Oxlint type-aware checks, and Oxfmt. Do not add Prettier.
- Do not add lint-disable or suppression comments to hide first-party design or
  type problems.
- Before pushing, run `bun run format:check`, `bun run lint`,
  `bun run typecheck`, `bun run test`, `bun run build`, and
  `bun run test:integration`.
