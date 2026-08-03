import { Schema as S } from "effect";
import { AsyncData } from "foldkit";

export const Repository = S.Struct({
  owner: S.String,
  name: S.String,
  path: S.String,
  source: S.Literals(["configured", "temporary"]),
});
export type Repository = typeof Repository.Type;

export const RepositoryCatalog = S.Struct({
  configuredRoot: S.String,
  temporaryRoot: S.String,
  repositories: S.Array(Repository),
});
export type RepositoryCatalog = typeof RepositoryCatalog.Type;

export const Repositories = AsyncData.Schema(RepositoryCatalog, S.String);

export const Model = S.Struct({
  repositories: Repositories.schema,
  query: S.String,
});
export type Model = typeof Model.Type;

export const empty = (): Model =>
  Model.make({ repositories: Repositories.Idle(), query: "" });
