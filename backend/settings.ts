import { homedir, tmpdir } from "node:os";

import { Config, Data, Effect, FileSystem, Path, Schema as S } from "effect";

import {
  HunkerSettings,
  SettingsDocument,
  defaultHunkerSettings,
} from "../src/settings";
export { HunkerSettings } from "../src/settings";

export class SettingsFailed extends Data.TaggedError("SettingsFailed")<{
  readonly message: string;
}> {}

const failed = (message: string) => new SettingsFailed({ message });

const configurationPath = Effect.gen(function* () {
  const paths = yield* Path.Path;
  const configured = yield* Config.string("HUNKER_CONFIG_FILE").pipe(
    Config.withDefault(
      paths.join(homedir(), ".config", "hunker", "settings.json"),
    ),
  );
  return paths.resolve(
    configured.startsWith("~/")
      ? paths.join(homedir(), configured.slice(2))
      : configured,
  );
});

const defaultSettings = Effect.gen(function* () {
  const paths = yield* Path.Path;
  const repositoriesRoot = yield* Config.string("HUNKER_REPOS_ROOT").pipe(
    Config.withDefault(paths.join(homedir(), "src")),
  );
  const cacheRoot = yield* Config.string("HUNKER_CACHE_ROOT").pipe(
    Config.withDefault(paths.join(tmpdir(), "hunker", "repositories")),
  );
  return HunkerSettings.make({
    ...defaultHunkerSettings,
    repositoriesRoot,
    cacheRoot,
  });
});

const decodeSettings = (content: string) =>
  Effect.try({
    try: (): unknown => JSON.parse(content),
    catch: () => failed("Hunker’s settings file is not valid JSON."),
  }).pipe(
    Effect.flatMap(S.decodeUnknownEffect(HunkerSettings)),
    Effect.mapError((error) =>
      error instanceof SettingsFailed
        ? error
        : failed(`Hunker’s settings file is invalid: ${error.message}`),
    ),
  );

export const loadSettings = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const configPath = yield* configurationPath;
  const exists = yield* fs
    .exists(configPath)
    .pipe(Effect.mapError(() => failed(`Could not inspect ${configPath}.`)));
  const settings = exists
    ? yield* fs.readFileString(configPath).pipe(
        Effect.mapError(() => failed(`Could not read ${configPath}.`)),
        Effect.flatMap(decodeSettings),
      )
    : yield* defaultSettings;
  return SettingsDocument.make({ settings, configPath });
});

export const saveSettings = (settings: HunkerSettings) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const configPath = yield* configurationPath;
    const temporaryPath = `${configPath}.tmp`;
    yield* fs
      .makeDirectory(paths.dirname(configPath), { recursive: true })
      .pipe(
        Effect.mapError(() =>
          failed(`Could not create ${paths.dirname(configPath)}.`),
        ),
      );
    yield* fs
      .writeFileString(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`)
      .pipe(Effect.mapError(() => failed(`Could not write ${temporaryPath}.`)));
    yield* fs
      .rename(temporaryPath, configPath)
      .pipe(Effect.mapError(() => failed(`Could not replace ${configPath}.`)));
    return SettingsDocument.make({ settings, configPath });
  });

export const resolveConfiguredPath = (value: string) =>
  Effect.gen(function* () {
    const paths = yield* Path.Path;
    return paths.resolve(
      value.startsWith("~/") ? paths.join(homedir(), value.slice(2)) : value,
    );
  });
