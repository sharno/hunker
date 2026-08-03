import { Schema as S } from "effect";
import { m } from "foldkit/message";

import { RepositoryCatalog } from "./model";

export const UpdatedRepositoryFilter = m("UpdatedRepositoryFilter", {
  value: S.String,
});
export const SucceededFetchRepositories = m("SucceededFetchRepositories", {
  catalog: RepositoryCatalog,
});
export const FailedFetchRepositories = m("FailedFetchRepositories", {
  error: S.String,
});

export const Message = S.Union([
  UpdatedRepositoryFilter,
  SucceededFetchRepositories,
  FailedFetchRepositories,
]);
export type Message = typeof Message.Type;
