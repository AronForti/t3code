import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Providers prefix tool names with it (`mcp__<name>__tool`), so keep it identifier-safe. */
export const UserMcpServerName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[A-Za-z0-9_-]+$/),
);
export type UserMcpServerName = typeof UserMcpServerName.Type;

const StringMap = Schema.Record(Schema.String, Schema.String).pipe(
  Schema.withDecodingDefault(Effect.succeed({})),
);

export const UserMcpServerTransport = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("stdio"),
    command: TrimmedNonEmptyString,
    args: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
    env: StringMap,
  }),
  Schema.Struct({
    type: Schema.Literal("http"),
    url: TrimmedNonEmptyString,
    headers: StringMap,
  }),
]);
export type UserMcpServerTransport = typeof UserMcpServerTransport.Type;

export const UserMcpServer = Schema.Struct({
  name: UserMcpServerName,
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  /** Catalog entry it was installed from, so the UI can show its icon and setup notes. */
  catalogId: Schema.optionalKey(TrimmedNonEmptyString),
  transport: UserMcpServerTransport,
});
export type UserMcpServer = typeof UserMcpServer.Type;

export const UserMcpServers = Schema.Array(UserMcpServer);
export type UserMcpServers = typeof UserMcpServers.Type;

/** T3's own server name; a user entry with it would shadow the orchestration tools. */
export const RESERVED_MCP_SERVER_NAMES: ReadonlySet<string> = new Set([
  "t3-code",
  "t3-code-direct",
]);

export function enabledUserMcpServers(
  servers: ReadonlyArray<UserMcpServer>,
): ReadonlyArray<UserMcpServer> {
  const seen = new Set<string>();
  return servers.filter((server) => {
    if (!server.enabled || RESERVED_MCP_SERVER_NAMES.has(server.name) || seen.has(server.name)) {
      return false;
    }
    seen.add(server.name);
    return true;
  });
}
