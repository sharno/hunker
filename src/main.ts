import { Runtime } from "foldkit";

import { Model } from "./domain";
import { init, routing, update } from "./state";
import { view } from "./view/review-view";

export const makeReviewApplication = (container: HTMLElement) =>
  Runtime.makeApplication({
    Model,
    init,
    update,
    routing,
    container,
    preserveScroll: true,
    view: (model, h) => ({
      title: model.prUrl === "" ? "Hunker" : `${model.meta.repository} #${model.meta.number} · Hunker`,
      body: view(model, h),
    }),
  });
