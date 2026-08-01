import { BrowserStream } from "@effect/platform-browser";
import { Schema as S, Stream } from "effect";
import { Subscription } from "foldkit";

import { ChangedToolbarCompact } from "../domain";
import type { Message, Model } from "../domain";

const compactAfter = 80;

const toolbarScroll = Stream.suspend(() =>
  Stream.concat(
    Stream.succeed(undefined),
    BrowserStream.fromEventListenerWindow("scroll", {
      passive: true,
      bufferSize: 1,
    }).pipe(Stream.map(() => undefined)),
  ).pipe(
    Stream.map(() => window.scrollY > compactAfter),
    Stream.changes,
    Stream.map(value => ChangedToolbarCompact({ value })),
  ),
);

export const toolbarSubscriptions = Subscription.make<Model, Message>()(entry => ({
  toolbarScroll: entry(
    { active: S.Boolean },
    {
      modelToDependencies: model => ({
        active:
          model.page === "review" &&
          model.phase === "ready" &&
          model.prUrl !== "",
      }),
      dependenciesToStream: ({ active }) => active ? toolbarScroll : Stream.empty,
    },
  ),
}));
