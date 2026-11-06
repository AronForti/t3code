import {
  RESERVED_MCP_SERVER_NAMES,
  UserMcpServer,
  type UserMcpServer as UserMcpServerType,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export interface McpCatalogEntry {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** What the user must do outside T3 before the tools work. */
  readonly setup: string;
  readonly docsUrl: string;
  readonly server: UserMcpServerType;
}

export const MCP_CATALOG: ReadonlyArray<McpCatalogEntry> = [
  {
    id: "figma-desktop",
    title: "Figma",
    description: "Read frames, components, variables and screenshots from the open Figma file.",
    setup:
      "In the Figma desktop app, open a Design file, switch to Dev Mode and enable the desktop MCP server in the inspect panel.",
    docsUrl: "https://help.figma.com/hc/en-us/articles/32132100833559",
    server: {
      name: "figma",
      enabled: true,
      catalogId: "figma-desktop",
      transport: { type: "http", url: "http://127.0.0.1:3845/mcp", headers: {} },
    },
  },
  {
    id: "blender",
    title: "Blender",
    description: "Inspect and edit the open Blender scene, and run Python inside Blender.",
    setup:
      "Install uv, add the blender-mcp addon (addon.py) in Blender, then press “Connect” in its sidebar tab.",
    docsUrl: "https://github.com/ahujasid/blender-mcp",
    server: {
      name: "blender",
      enabled: true,
      catalogId: "blender",
      transport: { type: "stdio", command: "uvx", args: ["blender-mcp"], env: {} },
    },
  },
  {
    id: "google-slides",
    title: "Google Slides",
    description: "Create, read and edit Google Slides presentations.",
    setup:
      "Install uv and create a Google Cloud OAuth client (Desktop app) with the Slides API enabled. Paste its client ID and secret below; the first call opens a browser sign-in.",
    docsUrl: "https://github.com/taylorwilsdon/google_workspace_mcp",
    server: {
      name: "google-slides",
      enabled: true,
      catalogId: "google-slides",
      transport: {
        type: "stdio",
        command: "uvx",
        args: ["workspace-mcp", "--tools", "slides"],
        env: { GOOGLE_OAUTH_CLIENT_ID: "", GOOGLE_OAUTH_CLIENT_SECRET: "" },
      },
    },
  },
];

export function catalogEntry(id: string | undefined): McpCatalogEntry | undefined {
  return id === undefined ? undefined : MCP_CATALOG.find((entry) => entry.id === id);
}

export interface McpServerDraft {
  readonly name: string;
  readonly enabled: boolean;
  readonly catalogId: string | undefined;
  readonly type: "stdio" | "http";
  readonly command: string;
  /** One argument per line, so arguments may contain spaces. */
  readonly args: string;
  /** `KEY=value` per line. */
  readonly env: string;
  readonly url: string;
  /** `Name: value` per line. */
  readonly headers: string;
}

export function draftFromServer(server: UserMcpServerType): McpServerDraft {
  const { transport } = server;
  return {
    name: server.name,
    enabled: server.enabled,
    catalogId: server.catalogId,
    type: transport.type,
    command: transport.type === "stdio" ? transport.command : "",
    args: transport.type === "stdio" ? transport.args.join("\n") : "",
    env:
      transport.type === "stdio"
        ? Object.entries(transport.env)
            .map(([key, value]) => `${key}=${value}`)
            .join("\n")
        : "",
    url: transport.type === "http" ? transport.url : "",
    headers:
      transport.type === "http"
        ? Object.entries(transport.headers)
            .map(([key, value]) => `${key}: ${value}`)
            .join("\n")
        : "",
  };
}

export const EMPTY_MCP_SERVER_DRAFT: McpServerDraft = {
  name: "",
  enabled: true,
  catalogId: undefined,
  type: "stdio",
  command: "",
  args: "",
  env: "",
  url: "",
  headers: "",
};

const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

function parsePairs(
  text: string,
  separator: "=" | ":",
): { readonly pairs: Record<string, string> } | { readonly error: string } {
  const pairs: Record<string, string> = {};
  for (const line of lines(text)) {
    const index = line.indexOf(separator);
    const key = index < 0 ? "" : line.slice(0, index).trim();
    if (key.length === 0) {
      return {
        error: `“${line}” needs the form ${separator === "=" ? "KEY=value" : "Name: value"}.`,
      };
    }
    pairs[key] = line.slice(index + 1).trim();
  }
  return { pairs };
}

const decodeServer = Schema.decodeUnknownOption(UserMcpServer);

export function parseMcpServerDraft(
  draft: McpServerDraft,
  otherNames: ReadonlySet<string>,
): { readonly server: UserMcpServerType } | { readonly error: string } {
  const name = draft.name.trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) {
    return { error: "Use letters, digits, - or _ for the name." };
  }
  if (RESERVED_MCP_SERVER_NAMES.has(name)) return { error: `“${name}” is reserved by T3 Code.` };
  if (otherNames.has(name)) return { error: `A server named “${name}” is already installed.` };
  let transport: UserMcpServerType["transport"];
  if (draft.type === "stdio") {
    if (draft.command.trim().length === 0) return { error: "Enter the command to run." };
    const env = parsePairs(draft.env, "=");
    if ("error" in env) return env;
    transport = {
      type: "stdio",
      command: draft.command.trim(),
      args: lines(draft.args),
      env: env.pairs,
    };
  } else {
    if (!/^https?:\/\/\S+$/.test(draft.url.trim())) return { error: "Enter an http(s) URL." };
    const headers = parsePairs(draft.headers, ":");
    if ("error" in headers) return headers;
    transport = { type: "http", url: draft.url.trim(), headers: headers.pairs };
  }
  const decoded = decodeServer({
    name,
    enabled: draft.enabled,
    ...(draft.catalogId === undefined ? {} : { catalogId: draft.catalogId }),
    transport,
  });
  return decoded._tag === "Some" ? { server: decoded.value } : { error: "Invalid server." };
}

/** Catalog servers whose required environment values are still blank. */
export function missingSetupValues(server: UserMcpServerType): ReadonlyArray<string> {
  if (server.transport.type !== "stdio") return [];
  return Object.entries(server.transport.env)
    .filter(([, value]) => value.trim().length === 0)
    .map(([key]) => key);
}

export function uniqueCatalogName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let index = 2; ; index += 1) {
    const candidate = `${base}-${index}`;
    if (!taken.has(candidate)) return candidate;
  }
}
