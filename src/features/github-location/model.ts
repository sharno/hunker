import { Option, Schema as S } from "effect";
import { evo } from "foldkit/struct";

export const Model = S.Struct({
  value: S.String,
  maybeError: S.Option(S.String),
  isLoading: S.Boolean,
});
export type Model = typeof Model.Type;

export const init = (value: string, isLoading: boolean): Model =>
  Model.make({ value, maybeError: Option.none(), isLoading });

export const replaceValue = (value: string, isLoading: boolean): Model =>
  init(value, isLoading);

export const setLoading = (model: Model, isLoading: boolean): Model =>
  evo(model, { isLoading: () => isLoading });

export const showInvalidLocation = (model: Model): Model =>
  evo(model, {
    maybeError: () =>
      Option.some(
        "Paste a github.com repository, pull request, compare, commit, or file URL.",
      ),
  });
