import type { Html, HtmlBuilder } from "foldkit/html";

import { GotGitHubLocationMessage } from "../domain";
import type { Message, Model } from "../domain";
import * as GitHubLocation from "../features/github-location";

export const githubLocationForm = (
  model: Model,
  layout: GitHubLocation.Layout,
  h: HtmlBuilder<Message>,
): Html =>
  h.submodel({
    slotId: `github-location-${layout}`,
    view: GitHubLocation.view,
    model: model.githubLocation,
    viewInputs: { layout },
    toParentMessage: (message) => GotGitHubLocationMessage({ message }),
  });
