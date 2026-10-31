// Settings, server state, and the GitHub paths Hunker renders. The route table
// drives both the redirect rules and the popup's "Open this page" action.

export type Scope = "Off" | "Reviews" | "Everything";
// A TCP port; only parsePort and the default construct one.
export type Port = number;

export interface Settings {
  readonly scope: Scope;
  readonly port: Port;
}

export type Server =
  | { readonly kind: "Running"; readonly version: string }
  | { readonly kind: "NotHunker" }
  | { readonly kind: "Unreachable" };

export interface Status {
  readonly settings: Settings;
  readonly server: Server;
}

export type Request =
  | { readonly kind: "Refresh" }
  | { readonly kind: "Configure"; readonly settings: Settings };

// The worker always answers, so the popup never waits on a failed change.
export type Reply =
  | { readonly kind: "Applied"; readonly status: Status }
  | { readonly kind: "Failed"; readonly message: string };

const scopes: readonly Scope[] = ["Off", "Reviews", "Everything"];

export const parseScope = (value: unknown): Scope | undefined =>
  scopes.find((scope) => scope === value);

export const parsePort = (value: unknown): Port | undefined =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value > 0 &&
  value < 65_536
    ? value
    : undefined;

export const defaults: Settings = { scope: "Reviews", port: 5173 };

export const decodeSettings = (stored: Record<string, unknown>): Settings => ({
  scope: parseScope(stored.scope) ?? defaults.scope,
  port: parsePort(stored.port) ?? defaults.port,
});

export const assertNever = (value: never): never => {
  throw new Error(`Unhandled variant ${JSON.stringify(value)}`);
};

export const origin = (port: Port) => `http://127.0.0.1:${port}`;

type Kind = "Review" | "Code";

// Paths after github.com/<owner>/<repository>/, in the RE2 subset that
// declarativeNetRequest accepts. Only shapes Hunker's router parses belong here.
export const routes: readonly { readonly kind: Kind; readonly path: string }[] =
  [
    {
      kind: "Review",
      path: "pull/[0-9]+(?:/files|/commits(?:/[0-9a-f]+)?)?",
    },
    { kind: "Review", path: "compare/[^/?#]+" },
    { kind: "Review", path: "commit/[0-9a-f]+" },
    { kind: "Code", path: "blob/[^?#]+" },
    { kind: "Code", path: "tree/[^/?#]+" },
    { kind: "Code", path: "commits(?:/[^?#]+)?" },
    { kind: "Code", path: "pulls" },
  ];

export const kinds: Record<Scope, readonly Kind[]> = {
  Off: [],
  Reviews: ["Review"],
  Everything: ["Review", "Code"],
};

// Captures the path after github.com so a substitution can move it to Hunker.
export const pattern = (path: string) =>
  `^https://github\\.com/([^/?#]+/[^/?#]+/(?:${path})/?(?:[?#].*)?)$`;

export const hunkerUrl = (url: string, port: Port): string | undefined => {
  const path = routes
    .map((route) => new RegExp(pattern(route.path)).exec(url)?.[1])
    .find((match) => match !== undefined);
  return path === undefined ? undefined : `${origin(port)}/${path}`;
};
