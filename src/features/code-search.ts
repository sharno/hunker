import { Schema as S } from "effect";

export const TextSearchMode = S.Literals(["literal", "regex"]);
export type TextSearchMode = typeof TextSearchMode.Type;

export const RepositorySearchMode = S.Literals(["literal", "regex", "fuzzy"]);
export type RepositorySearchMode = typeof RepositorySearchMode.Type;

export type CompiledTextSearch =
  | Readonly<{
      _tag: "Valid";
      matches: (value: string) => boolean;
    }>
  | Readonly<{
      _tag: "Invalid";
      error: string;
    }>;

const isCaseSensitive = (query: string) => query.toLocaleLowerCase() !== query;

export const compileTextSearch = (
  query: string,
  mode: TextSearchMode,
): CompiledTextSearch => {
  if (mode === "literal") {
    const needle = isCaseSensitive(query) ? query : query.toLocaleLowerCase();
    return {
      _tag: "Valid",
      matches: isCaseSensitive(query)
        ? (value) => value.includes(needle)
        : (value) => value.toLocaleLowerCase().includes(needle),
    };
  }
  try {
    const expression = new RegExp(query, isCaseSensitive(query) ? "u" : "iu");
    return { _tag: "Valid", matches: (value) => expression.test(value) };
  } catch (error) {
    return {
      _tag: "Invalid",
      error: error instanceof Error ? error.message : "Invalid expression.",
    };
  }
};
