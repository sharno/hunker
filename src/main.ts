import { Runtime, Subscription } from "foldkit";

import { Model } from "./domain";
import type { Message } from "./domain";
import { toolbarSubscriptions } from "./features/toolbar";
import { revisionSubscriptions } from "./features/revision";
import { init, routing, update } from "./state";
import { view } from "./view/review-view";
import { withTailwind } from "./view/tailwind";

const documentTitle = (model: typeof Model.Type): string => {
  if (model.phase._tag === "Loading" && model.prUrl !== "") {
    return "Loading review · Hunker";
  }
  if (
    model.phase._tag === "Ready" &&
    model.prUrl !== "" &&
    model.meta.url === model.prUrl
  ) {
    return `${model.meta.repository} #${model.meta.number} · Hunker`;
  }
  return "Hunker";
};

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
        title: documentTitle(model),
        body: view(model, styled),
      };
    },
  });
