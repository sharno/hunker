import { BrowserStream } from "@effect/platform-browser";
import { Option, Schema as S, Stream } from "effect";
import { Subscription } from "foldkit";

import { UpdatedToolbarCompact } from "../domain";
import type { Message, Model } from "../domain";
import { reviewRouteFromAppRoute } from "../review-route";

const TOOLBAR_COMPACT_AFTER = 80;

const toolbarScroll = Stream.suspend(() =>
  Stream.concat(
    Stream.succeed(undefined),
    BrowserStream.fromEventListenerWindow("scroll", {
      passive: true,
      bufferSize: 1,
    }).pipe(Stream.map(() => undefined)),
  ).pipe(
    Stream.map(() => window.scrollY > TOOLBAR_COMPACT_AFTER),
    Stream.changes,
    Stream.map((value) => UpdatedToolbarCompact({ value })),
  ),
);

export const toolbarSubscriptions = Subscription.make<Model, Message>()(
  (entry) => ({
    toolbarScroll: entry(
      { maybeActive: S.Option(S.Null) },
      {
        modelToDependencies: (model) => ({
          maybeActive:
            reviewRouteFromAppRoute(model.location) !== undefined &&
            model.reviewState._tag === "Ready"
              ? Option.some(null)
              : Option.none(),
        }),
        dependenciesToStream: ({ maybeActive }) =>
          Option.match(maybeActive, {
            onNone: () => Stream.empty,
            onSome: () => toolbarScroll,
          }),
      },
    ),
  }),
);
