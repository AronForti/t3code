import { describe, expect, it } from "vite-plus/test";

import {
  draftFromServer,
  EMPTY_MCP_SERVER_DRAFT,
  MCP_CATALOG,
  parseMcpServerDraft,
} from "./McpServersSettings.logic";

describe("parseMcpServerDraft", () => {
  it("round-trips every catalog server", () => {
    for (const entry of MCP_CATALOG) {
      expect(parseMcpServerDraft(draftFromServer(entry.server), new Set())).toEqual({
        server: entry.server,
      });
    }
  });

  it("parses one argument per line and KEY=value pairs whose values contain separators", () => {
    expect(
      parseMcpServerDraft(
        {
          ...EMPTY_MCP_SERVER_DRAFT,
          name: "notion",
          command: "npx",
          args: "-y\n\n@notionhq/notion-mcp-server --flag value",
          env: 'OPENAPI_MCP_HEADERS={"Authorization":"Bearer a=b"}',
        },
        new Set(),
      ),
    ).toEqual({
      server: {
        name: "notion",
        enabled: true,
        transport: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@notionhq/notion-mcp-server --flag value"],
          env: { OPENAPI_MCP_HEADERS: '{"Authorization":"Bearer a=b"}' },
        },
      },
    });
  });

  it("rejects reserved, duplicate and malformed entries", () => {
    const http = { ...EMPTY_MCP_SERVER_DRAFT, type: "http" as const, url: "https://x.dev/mcp" };
    expect(parseMcpServerDraft({ ...http, name: "t3-code" }, new Set())).toHaveProperty("error");
    expect(parseMcpServerDraft({ ...http, name: "figma" }, new Set(["figma"]))).toHaveProperty(
      "error",
    );
    expect(parseMcpServerDraft({ ...http, name: "has space" }, new Set())).toHaveProperty("error");
    expect(
      parseMcpServerDraft({ ...http, name: "x", headers: "no separator" }, new Set()),
    ).toHaveProperty("error");
    expect(parseMcpServerDraft({ ...http, name: "x", url: "ftp://x" }, new Set())).toHaveProperty(
      "error",
    );
  });
});
