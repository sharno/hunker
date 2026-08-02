import { Schema as S } from "effect";
import { AsyncData } from "foldkit";

import {
  HunkerSettings,
  SettingsDocument,
  defaultHunkerSettings,
} from "../../settings";

export const Load = AsyncData.Schema(SettingsDocument, S.String);
export const Save = AsyncData.Schema(SettingsDocument, S.String);

export const Model = S.Struct({
  load: Load.schema,
  draft: HunkerSettings,
  save: Save.schema,
});
export type Model = typeof Model.Type;

export const empty = (): Model =>
  Model.make({
    load: Load.Idle(),
    draft: defaultHunkerSettings,
    save: Save.Idle(),
  });
