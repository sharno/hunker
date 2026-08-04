# Hunker agent guidance

- Use Effect v4 for application effects, services, errors, and data validation.
- Decode external data at its boundary with Effect Schema and keep the decoded
  type through the rest of the program. Do not add `isRecord`, `asRecord`,
  `Record<string, unknown>` shape shims, ad hoc object/property probing, or
  unchecked assertions to recover missing types. Improve the schema or domain
  model instead.
- Consult the pinned source before guessing library APIs or conventions:
  - Effect: `vendor/effect`, especially `vendor/effect/packages/effect/src`
  - Foldkit: `vendor/foldkit`
- Organize growing Foldkit code by page or feature. A stateful feature folder
  owns its `model.ts`, `message.ts`, `command.ts`, `update.ts`, `view.ts`, and
  colocated tests, and exposes a namespace through `index.ts`.
- Use a Foldkit Submodel when a feature owns a distinct state machine whose
  messages primarily update its own model slice. Keep stateless render helpers
  as ordinary view functions and shared pure logic in domain or shared modules;
  Submodel boundaries are not a substitute for file organization.
- Parent code must delegate child state changes through the Submodel's `update`
  or public helper and map child Commands through a `Got*Message` wrapper. Do
  not mutate a child's model slice directly.
- Foldkit Message bindings must exactly match their `m()` tags, and Command
  bindings must exactly match their `Command.define` names. Treat these names as
  stable DevTools identities rather than local aliases.
- For no-argument Foldkit Commands, omit `args`, provide the Effect directly as
  `execute`, and invoke the Command with no object argument.
- Update nested Foldkit records with a nested `evo`; spreading a nested record
  inside a parent `evo` updater escapes the strict Model update path and is
  rejected by the Foldkit Oxlint rule.
- Use Foldkit `restString` for canonical URL resources that own a
  slash-delimited path, and order more-specific routes before their parent route
  in `oneOf`.
- Use `Navigation.pushUrl` for user-visible location changes such as opening a
  file, tab, search result, or commit. Reserve `Navigation.replaceUrl` for
  canonicalization and non-navigational configuration synchronization, and
  cover Back behavior with a real-browser test.
- When Submodel `viewInputs` need parent-owned interactive markup, pass a
  top-level slot callback that builds the `Html`. Do not pass already-rendered
  `Html` containing nested event functions; Foldkit can only auto-scope
  top-level callbacks to the parent boundary.
- Apply project `HtmlBuilder` adapters inside every Foldkit Submodel view.
  Foldkit intentionally supplies its singleton builder at each child boundary,
  so a builder wrapped by the parent does not propagate into the child.
- Treat a Foldkit Submodel `slotId` as component identity only; it does not
  become a DOM class. Pass visual variants through typed `viewInputs`, apply the
  variant class at the child view root, and cover that rendered class contract
  with a Scene test.
- Record durable Effect, Foldkit, tooling, and architecture discoveries in this
  file as they are learned. Keep the guidance general and remove or correct it
  when the vendored sources prove it wrong.
- Treat structured subprocess output as an external boundary: decode each record
  with Effect Schema, model command-specific exit statuses (for example, a
  search command's no-match status), and normalize tool paths to the app's
  canonical repository-relative form before they enter domain state.
- Keep independent repository-page data sources independent in state and view
  logic. A GitHub-backed tab must not be blocked by a missing local clone, and a
  local Git failure should only replace views that actually depend on it.
- For paginated Foldkit data, keep accumulated rows visible with `Refreshing`
  while the next page loads and use `Stale` for a later-page failure. Correlate
  responses with the repository, filter, and page before appending them.
- Use Bun for dependency management and scripts.
- Keep the project on TypeScript 7 and strict typing. Do not introduce `any`.
- Use Oxfmt for formatting and Oxlint with type-aware linting. Do not add
  Prettier or competing formatter configuration.
- Keep Effect's Oxlint integration reproducible with `@effect/tsgo`, the
  `effecttsgo` plugin, and the `effect-tsgo patch --no-typescript --oxlint`
  prepare hook. The Effect patch validates that the installed `oxlint` and
  `oxlint-tsgolint` versions are compatible; rerun the hook after dependency
  installation or tooling upgrades.
- Do not use lint-disable or TypeScript-suppression comments to paper over an
  architectural or typing mismatch in first-party code. Move Effect Layers to
  the owning Foldkit runtime's `resources`, use a properly disposed
  `ManagedRuntime` at imperative test boundaries, or improve the domain type so
  the rule passes without suppression.
- Capture dependencies used by lazy service methods when constructing the
  service. A `ConfigProvider` Layer controls Layer construction, but an Effect
  stored in a service and executed later runs in its caller's fiber context;
  provide the captured provider to that Effect instead of assuming the Layer's
  build context will be retained.
- Test Foldkit state machines with colocated `story.test.ts` files and rendered
  user flows with colocated `scene.test.ts` files. Keep Playwright deliberately
  thin: browser history and reload, real transport wiring, computed CSS/layout,
  and browser-only behavior. Pure domain and backend integration tests belong in
  Vitest, not under the Playwright test directory.
- Scope test `ManagedRuntime`s to the Layer fixture. Reuse one suite runtime for
  a stable Layer and dispose it in `afterAll`; construct per-fixture runtimes
  when a Layer captures test-specific configuration such as temporary paths.
- Run `bun run format:check`, `bun run lint`, `bun run test`, `bun run build`,
  and `bun run test:integration` before pushing.
