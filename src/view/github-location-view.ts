import type { Html, HtmlBuilder } from "foldkit/html";

import { GotGitHubLocationMessage } from "../domain";
import type { Message, Model } from "../domain";
import * as GitHubLocation from "../features/github-location";

export const githubLocationForm = (
  model: Model,
  slotId: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.submodel({
    slotId,
    view: GitHubLocation.view,
    model: model.githubLocation,
    toParentMessage: (message) => GotGitHubLocationMessage({ message }),
  });
