import { Option, Schema as S, Stream } from "effect";
import { Subscription } from "foldkit";

import type { Message as AppMessage, Model as AppModel } from "../../../domain";
import { GotRepositoryMessage } from "../../../message";
import { GotSourceControlMessage } from "../message";
import { Ticked } from "./message";

const isRepositoryLocation = (model: AppModel) =>
  model.location._tag === "Repository" ||
  model.location._tag === "RepositoryPulls" ||
  model.location._tag === "RepositoryCommits" ||
  model.location._tag === "RepositoryCommitsRef" ||
  model.location._tag === "RepositoryFile";

const poll = Stream.tick("2 minutes").pipe(
  Stream.drop(1),
  Stream.map(() =>
    GotRepositoryMessage({
      message: GotSourceControlMessage({ message: Ticked() }),
    }),
  ),
);

export const sourceControlSubscriptions = Subscription.make<
  AppModel,
  AppMessage
>()((entry) => ({
  repositorySourceControlPoll: entry(
    { repository: S.Option(S.String) },
    {
      modelToDependencies: (model) => ({
        repository:
          isRepositoryLocation(model) &&
          model.repositoryBrowser.sourceControl.state._tag === "Ready"
            ? Option.some(
                model.repositoryBrowser.sourceControl.state.repository,
              )
            : Option.none(),
      }),
      dependenciesToStream: ({ repository }) =>
        Option.isSome(repository) ? poll : Stream.empty,
    },
  ),
}));
