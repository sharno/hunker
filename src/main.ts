import { Runtime, Subscription } from "foldkit";

import { Model } from "./domain";
import type { Message } from "./domain";
import { toolbarSubscriptions } from "./features/toolbar";
import { revisionSubscriptions } from "./features/revision";
import { init, routing, update } from "./state";
import { view } from "./view/review-view";
import { withTailwind } from "./view/tailwind";

export const makeReviewApplication = (container: HTMLElement) =>
  Runtime.makeApplication({
    Model,
    init,
    update,
    routing,
    subscriptions: Subscription.aggregate<Model, Message>()(
      toolbarSubscriptions,
      revisionSubscriptions,
    ),
    container,
    preserveScroll: true,
    view: (model, h) => {
      const styled = withTailwind(h);
      return {
        title:
          model.phase === "loading" && model.prUrl !== ""
            ? "Loading review · Hunker"
            : model.phase === "ready" &&
                model.prUrl !== "" &&
                model.meta.url === model.prUrl
              ? `${model.meta.repository} #${model.meta.number} · Hunker`
              : "Hunker",
        body: view(model, styled),
      };
    },
  });
