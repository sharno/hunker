import { Runtime } from "foldkit";

import { Model } from "./domain";
import { init, update } from "./state";
import { view } from "./view/review-view";

export const makeReviewElement = (container: HTMLElement) =>
  Runtime.makeElement({ Model, init, update, view, container });
