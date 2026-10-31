// Owns the redirect rules. They exist only while Hunker answers on the
// configured port, so GitHub links never lead to a dead or foreign server.
import {
  decodeSettings,
  kinds,
  origin,
  pattern,
  routes,
  type Reply,
  type Request,
  type Server,
  type Settings,
  type Status,
} from "./model";

const probeAlarm = "probe";

// Navigations started from Hunker ("Open on GitHub") or from GitHub itself
// stay on GitHub; links arriving from anywhere else open in Hunker.
const excludedInitiatorDomains = ["127.0.0.1", "localhost", "github.com"];

const rules = (settings: Settings): chrome.declarativeNetRequest.Rule[] =>
  routes.flatMap((route, index) =>
    kinds[settings.scope].includes(route.kind)
      ? [
          {
            id: index + 1,
            priority: 1,
            action: {
              type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
              redirect: { regexSubstitution: `${origin(settings.port)}/\\1` },
            },
            condition: {
              regexFilter: pattern(route.path),
              resourceTypes: [
                chrome.declarativeNetRequest.ResourceType.MAIN_FRAME,
              ],
              excludedInitiatorDomains,
            },
          },
        ]
      : [],
  );

const decodeAbout = (value: unknown): Server =>
  typeof value === "object" &&
  value !== null &&
  "application" in value &&
  value.application === "hunker" &&
  "version" in value &&
  typeof value.version === "string"
    ? { kind: "Running", version: value.version }
    : { kind: "NotHunker" };

// Only a failed connection is Unreachable; any answer that does not decode as
// Hunker (an error status, or a dev server's HTML) is another server.
const probe = async (settings: Settings): Promise<Server> => {
  const response = await fetch(`${origin(settings.port)}/api/about`, {
    signal: AbortSignal.timeout(2000),
  }).catch(() => undefined);
  if (response === undefined) {
    return { kind: "Unreachable" };
  }
  const body: unknown = response.ok
    ? await response.json().catch(() => undefined)
    : undefined;
  return decodeAbout(body);
};

const apply = async (): Promise<Status> => {
  const settings = decodeSettings(await chrome.storage.local.get());
  const server = await probe(settings);
  const installed = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: installed.map((rule) => rule.id),
    addRules: server.kind === "Running" ? rules(settings) : [],
  });
  return { settings, server };
};

// Alarms, startup, and the popup can all ask at once; apply one at a time so
// a stale probe never replaces the rules of a newer one.
let latest: Promise<Status> | undefined;
const sync = (): Promise<Status> => {
  latest = (latest ?? Promise.resolve()).then(apply, apply);
  return latest;
};

const handle = async (request: Request): Promise<Reply> => {
  try {
    if (request.kind === "Configure") {
      await chrome.storage.local.set(request.settings);
    }
    return { kind: "Applied", status: await sync() };
  } catch (error) {
    return { kind: "Failed", message: String(error) };
  }
};

const start = async () => {
  await chrome.alarms.create(probeAlarm, { periodInMinutes: 0.5 });
  await sync();
};

chrome.runtime.onInstalled.addListener(() => void start());
chrome.runtime.onStartup.addListener(() => void start());
chrome.alarms.onAlarm.addListener(() => void sync());
chrome.runtime.onMessage.addListener(
  (request: Request, _sender, respond: (reply: Reply) => void) => {
    void handle(request).then(respond);
    return true;
  },
);
