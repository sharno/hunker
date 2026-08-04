import { Match as M } from "effect";
import { Update } from "foldkit";
import { evo } from "foldkit/struct";

import { FetchRepositories } from "./command";
import type { Message } from "./message";
import { Repositories, type Model } from "./model";
import type { AppResources } from "../../resources";

type HomeUpdate = Update.Return<Model, Message, AppResources>;

export const load = (model: Model): HomeUpdate => [
  evo(model, { repositories: () => Repositories.Loading() }),
  [FetchRepositories()],
];

export const update = (model: Model, message: Message): HomeUpdate =>
  M.value(message).pipe(
    M.withReturnType<HomeUpdate>(),
    M.tagsExhaustive({
      UpdatedRepositoryFilter: ({ value }) => [
        evo(model, { query: () => value }),
        [],
      ],
      SucceededFetchRepositories: ({ catalog }) => [
        evo(model, {
          repositories: () => Repositories.Success({ data: catalog }),
        }),
        [],
      ],
      FailedFetchRepositories: ({ error }) => [
        evo(model, {
          repositories: () => Repositories.Failure({ error }),
        }),
        [],
      ],
    }),
  );
