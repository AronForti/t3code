import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildProviderDockItems } from "./ProviderUsageDock";

const now = Date.parse("2026-09-03T12:00:00.000Z");

function makeProvider(overrides: Partial<ServerProvider>): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("codex"),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-09-03T11:55:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

describe("buildProviderDockItems", () => {
  it("builds dock items with remaining percentages for connected providers", () => {
    const envId = EnvironmentId.make("local");
    const presentations = new Map([
      [
        envId,
        {
          entry: { target: { label: "Local" } },
          serverConfig: {
            providers: [
              makeProvider({
                instanceId: ProviderInstanceId.make("codex"),
                driver: ProviderDriverKind.make("codex"),
                displayName: "Codex",
                usageLimits: {
                  checkedAt: "2026-09-03T11:55:00.000Z",
                  windows: [
                    {
                      id: "five_hour",
                      kind: "session",
                      label: "5h window",
                      usedPercent: 35,
                      windowDurationMins: 300,
                      resetsAt: "2026-09-03T15:00:00.000Z",
                    },
                  ],
                },
              }),
              makeProvider({
                instanceId: ProviderInstanceId.make("claude"),
                driver: ProviderDriverKind.make("claudeAgent"),
                displayName: "Claude",
                usageLimits: {
                  checkedAt: "2026-09-03T11:55:00.000Z",
                  windows: [
                    {
                      id: "session",
                      kind: "session",
                      label: "Session",
                      usedPercent: 80,
                      windowDurationMins: 300,
                      resetsAt: "2026-09-03T14:00:00.000Z",
                    },
                  ],
                },
              }),
              makeProvider({
                instanceId: ProviderInstanceId.make("antigravity"),
                driver: ProviderDriverKind.make("antigravity"),
                displayName: "Antigravity",
                usageLimits: {
                  checkedAt: "2026-09-03T11:55:00.000Z",
                  unavailable: {
                    reason: "unsupported",
                    message: "Quota telemetry is not exposed by this provider.",
                  },
                },
              }),
              // Unauthenticated provider should be excluded
              makeProvider({
                instanceId: ProviderInstanceId.make("grok"),
                driver: ProviderDriverKind.make("grok"),
                auth: { status: "unauthenticated" },
              }),
            ],
            usageLimitSources: [],
          },
        },
      ],
    ]);

    const items = buildProviderDockItems(presentations, now);
    expect(items).toHaveLength(3);

    const codex = items.find((item) => item.driver === "codex");
    expect(codex?.primaryRemainingPercent).toBe(65);
    expect(codex?.unavailableNotice).toBeNull();

    const claude = items.find((item) => item.driver === "claudeAgent");
    expect(claude?.primaryRemainingPercent).toBe(20);
    expect(claude?.unavailableNotice).toBeNull();

    const antigravity = items.find((item) => item.driver === "antigravity");
    expect(antigravity?.primaryRemainingPercent).toBeNull();
    expect(antigravity?.unavailableNotice).toContain("Quota telemetry is not exposed");
  });
});
