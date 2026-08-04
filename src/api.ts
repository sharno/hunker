import { Data, Option, Schema as S } from "effect";
import { HttpClientError } from "effect/unstable/http";

const ErrorResponse = S.Struct({ error: S.String });

export class ApiRequestFailed extends Data.TaggedError("ApiRequestFailed")<{
  readonly message: string;
}> {}

export const responseFailure = (value: unknown, fallback: string) =>
  new ApiRequestFailed({ message: responseError(value, fallback) });

export const responseError = (value: unknown, fallback: string): string =>
  Option.match(S.decodeUnknownOption(ErrorResponse)(value), {
    onNone: () => fallback,
    onSome: ({ error }) => error,
  });

export const requestError = (error: unknown, fallback: string): string => {
  if (
    HttpClientError.isHttpClientError(error) &&
    error.reason._tag === "TransportError"
  ) {
    return "Hunker’s local backend is offline. Start it with `bun run dev`, then retry.";
  }
  return error instanceof Error ? error.message : fallback;
};
