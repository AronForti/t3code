// @effect-diagnostics nodeBuiltinImport:off -- node:sqlite writes native Antigravity conversation fixtures.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { expect, it } from "vite-plus/test";

import * as AntigravitySessions from "./AntigravitySessions.ts";

const varint = (value: number) => {
  const bytes: Array<number> = [];
  while (value >= 0x80) {
    bytes.push((value % 0x80) | 0x80);
    value = Math.floor(value / 0x80);
  }
  bytes.push(value);
  return bytes;
};
const number = (field: number, value: number) => [...varint(field * 8), ...varint(value)];
const bytes = (field: number, value: ReadonlyArray<number> | string) => {
  const payload = typeof value === "string" ? [...new TextEncoder().encode(value)] : value;
  return [...varint(field * 8 + 2), ...varint(payload.length), ...payload];
};
const createdAt = (seconds: number) => bytes(5, bytes(1, [...number(1, seconds), ...number(2, 0)]));

function conversation(
  rows: ReadonlyArray<readonly [number, ReadonlyArray<number>]>,
  meta: ReadonlyArray<number>,
) {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-antigravity-sessions-"));
  const databasePath = NodePath.join(directory, "conversation.db");
  const database = new NodeSqlite.DatabaseSync(databasePath);
  database.exec("CREATE TABLE trajectory_metadata_blob (id TEXT PRIMARY KEY, data BLOB)");
  database.exec(
    "CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, step_payload BLOB)",
  );
  database
    .prepare("INSERT INTO trajectory_metadata_blob VALUES ('main', ?)")
    .run(new Uint8Array(meta));
  for (const [index, [stepType, payload]] of rows.entries()) {
    database
      .prepare("INSERT INTO steps VALUES (?, ?, ?)")
      .run(index, stepType, new Uint8Array(payload));
  }
  database.close();
  return { databasePath, [Symbol.dispose]: () => NodeFS.rmSync(directory, { recursive: true }) };
}

it("reads prompts, final replies and the workspace folder of a native conversation", () => {
  using fixture = conversation(
    [
      [14, [...createdAt(1_786_099_057), ...bytes(19, bytes(2, "Build the course site"))]],
      // A planner step that only calls a tool has no reply text.
      [15, [...createdAt(1_786_099_060), ...bytes(20, bytes(3, "thinking"))]],
      [132, bytes(140, "tool output")],
      [15, [...createdAt(1_786_099_090), ...bytes(20, bytes(1, "Here is the plan."))]],
    ],
    [
      ...bytes(1, bytes(1, "file:///c:/Users/aron/Documents/site")),
      ...bytes(7, "file:///c%3A/Users/aron/Documents/site"),
    ],
  );

  expect(AntigravitySessions.readAntigravityMessages(fixture.databasePath)).toEqual([
    { role: "user", text: "Build the course site", createdAtMs: 1_786_099_057_000 },
    { role: "assistant", text: "Here is the plan.", createdAtMs: 1_786_099_090_000 },
  ]);
  expect(AntigravitySessions.readAntigravityWorkspace(fixture.databasePath)?.toLowerCase()).toMatch(
    /users[\\/]aron[\\/]documents[\\/]site$/,
  );
});

it("reports no workspace for a conversation outside any project folder", () => {
  using fixture = conversation([], bytes(18, "outside-of-project"));

  expect(AntigravitySessions.readAntigravityWorkspace(fixture.databasePath)).toBeNull();
});

it("dates conversations by the app's index, whose Go timestamps carry seven fraction digits", () => {
  using fixture = conversation([], []);
  const summariesPath = NodePath.join(NodePath.dirname(fixture.databasePath), "summaries.db");
  const database = new NodeSqlite.DatabaseSync(summariesPath);
  database.exec(
    "CREATE TABLE conversation_summaries (conversation_id TEXT, title TEXT, last_modified_time TEXT)",
  );
  database
    .prepare("INSERT INTO conversation_summaries VALUES (?, ?, ?)")
    .run(
      "f3bcb979-06f3-4eac-bd8e-60bb402c6634",
      "Course plan",
      "2026-08-09 14:47:39.7926181+00:00",
    );
  database.prepare("INSERT INTO conversation_summaries VALUES (?, '', ?)").run("untitled", "");
  database.close();

  expect(AntigravitySessions.readAntigravitySummaries(summariesPath)).toEqual(
    new Map([
      [
        "f3bcb979-06f3-4eac-bd8e-60bb402c6634",
        { title: "Course plan", lastModifiedMs: Date.parse("2026-08-09T14:47:39.792Z") },
      ],
      ["untitled", { title: null, lastModifiedMs: null }],
    ]),
  );
});
