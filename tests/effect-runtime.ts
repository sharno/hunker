import { Effect, Layer, ManagedRuntime } from "effect";

export const runWithLayer = async <R, ER, A, E>(
  layer: Layer.Layer<R, ER>,
  effect: Effect.Effect<A, E, R>,
): Promise<A> => {
  await using runtime = ManagedRuntime.make(layer);
  const result = await runtime.runPromise(effect);
  return result;
};
