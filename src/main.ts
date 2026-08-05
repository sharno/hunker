import { Runtime, Subscription } from "foldkit";

import { Model } from "./domain";
import type { Message } from "./domain";
import { toolbarSubscriptions } from "./features/toolbar";
import { revisionSubscriptions } from "./features/revision";
import { sourceControlSubscriptions } from "./page/repository/source-control/subscription";
import { init, routing, update } from "./state";
import { appResources } from "./resources";
import { view } from "./view/review-view";
import { withTailwind } from "./view/tailwind";
import { reviewRouteFromAppRoute } from "./review-route";

const documentTitle = (model: typeof Model.Type): string => {
  if (reviewRouteFromAppRoute(model.location) === undefined) return "Hunker";
  if (model.reviewState._tag === "Loading") {
    return "Loading review · Hunker";
  }
  if (
    model.reviewState._tag === "Ready" &&
    model.meta.url === model.reviewState.url
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
      sourceControlSubscriptions,
    ),
    resources: appResources,
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
