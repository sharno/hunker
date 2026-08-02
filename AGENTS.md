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
- Use Bun for dependency management and scripts.
- Keep the project on TypeScript 7 and strict typing. Do not introduce `any`.
- Use Oxfmt for formatting and Oxlint with type-aware linting. Do not add
  Prettier or competing formatter configuration.
- Run `bun run format:check`, `bun run lint`, `bun run test`, `bun run build`,
  and `bun run test:integration` before pushing.
