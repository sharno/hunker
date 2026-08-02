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
- When Submodel `viewInputs` need parent-owned interactive markup, pass a
  top-level slot callback that builds the `Html`. Do not pass already-rendered
  `Html` containing nested event functions; Foldkit can only auto-scope
  top-level callbacks to the parent boundary.
- Record durable Effect, Foldkit, tooling, and architecture discoveries in this
  file as they are learned. Keep the guidance general and remove or correct it
  when the vendored sources prove it wrong.
- Use Bun for dependency management and scripts.
- Keep the project on TypeScript 7 and strict typing. Do not introduce `any`.
- Use Oxfmt for formatting and Oxlint with type-aware linting. Do not add
  Prettier or competing formatter configuration.
- Run `bun run format:check`, `bun run lint`, `bun run test`, `bun run build`,
  and `bun run test:integration` before pushing.
