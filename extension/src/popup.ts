// Renders the background worker's status and sends setting changes to it; the
// worker owns storage, probing, and the redirect rules.
import {
  assertNever,
  hunkerUrl,
  parsePort,
  parseScope,
  type Reply,
  type Request,
  type Settings,
  type Status,
} from "./model";

const element = <T extends HTMLElement>(id: string, type: new () => T): T => {
  const found = document.getElementById(id);
  if (!(found instanceof type)) {
    throw new Error(`popup.html has no ${type.name} #${id}`);
  }
  return found;
};

const status = element("status", HTMLParagraphElement);
const open = element("open", HTMLButtonElement);
const controls = element("controls", HTMLFieldSetElement);
const port = element("port", HTMLInputElement);
const scopes = [
  ...document.querySelectorAll<HTMLInputElement>('input[name="scope"]'),
];

const send = (request: Request) =>
  chrome.runtime.sendMessage<Request, Reply>(request);

const describe = ({ settings, server }: Status): string => {
  const address = `127.0.0.1:${settings.port}`;
  switch (server.kind) {
    case "Running":
      return `Hunker ${server.version} is running on ${address}.`;
    case "NotHunker":
      return `Another server answers on ${address}, so GitHub links open normally.`;
    case "Unreachable":
      return `Hunker isn't running on ${address}, so GitHub links open normally. Start it with hunker or brew services start hunker.`;
    default:
      return assertNever(server);
  }
};

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

const render = (state: Status) => {
  status.textContent = describe(state);
  status.dataset.server = state.server.kind;
  port.value = String(state.settings.port);
  for (const input of scopes) {
    input.checked = input.value === state.settings.scope;
  }
  const tabId = tab?.id;
  const target =
    state.server.kind === "Running" && tab?.url !== undefined
      ? hunkerUrl(tab.url, state.settings.port)
      : undefined;
  open.disabled = target === undefined || tabId === undefined;
  open.onclick =
    target === undefined || tabId === undefined
      ? null
      : () =>
          void chrome.tabs
            .update(tabId, { url: target })
            .then(() => window.close());
  controls.disabled = false;
};

// Controls stay disabled while a request is in flight, so a late response
// never overwrites a newer choice.
const exchange = async (request: Request) => {
  controls.disabled = true;
  open.disabled = true;
  const reply = await send(request);
  if (reply.kind === "Applied") {
    render(reply.status);
  } else {
    status.textContent = `Hunker could not apply this change: ${reply.message}`;
    controls.disabled = false;
  }
};

// The form is the boundary: read it back into Settings, and skip a change
// while the port field holds something that is not a port.
const chosen = (): Settings | undefined => {
  const scope = parseScope(scopes.find((input) => input.checked)?.value);
  const chosenPort = parsePort(port.valueAsNumber);
  return scope === undefined || chosenPort === undefined
    ? undefined
    : { scope, port: chosenPort };
};

const configure = async () => {
  const settings = chosen();
  if (settings !== undefined) {
    await exchange({ kind: "Configure", settings });
  }
};

for (const input of [...scopes, port]) {
  input.addEventListener("change", () => void configure());
}

await exchange({ kind: "Refresh" });
