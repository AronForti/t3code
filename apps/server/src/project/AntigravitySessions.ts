// @effect-diagnostics nodeBuiltinImport:off -- node:sqlite reads Antigravity's native session databases read-only.
import * as NodeSqlite from "node:sqlite";
import * as NodeURL from "node:url";

// Field numbers from the runtime's trajectory protos (exa.cortex_pb).
const STEP_TYPE_USER_INPUT = 14;
const STEP_TYPE_PLANNER_RESPONSE = 15;
const STEP_METADATA = 5;
const METADATA_CREATED_AT = 1;
const TIMESTAMP_SECONDS = 1;
const TIMESTAMP_NANOS = 2;
const STEP_USER_INPUT = 19;
const USER_INPUT_TEXT = 2;
const STEP_PLANNER_RESPONSE = 20;
const PLANNER_RESPONSE_TEXT = 1;
const TRAJECTORY_WORKSPACE = 1;
const WORKSPACE_FOLDER_URI = 1;
const TRAJECTORY_WORKSPACE_URI = 7;

export const ANTIGRAVITY_CONVERSATION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ProtoValue = number | Uint8Array;

function protoFields(bytes: Uint8Array): ReadonlyArray<readonly [number, ProtoValue]> {
  const fields: Array<readonly [number, ProtoValue]> = [];
  let offset = 0;
  const varint = () => {
    let value = 0;
    for (let shift = 0; shift < 64; shift += 7) {
      const byte = bytes[offset++];
      if (byte === undefined) throw new Error("Truncated varint");
      value += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) return value;
    }
    throw new Error("Overlong varint");
  };
  while (offset < bytes.length) {
    const key = varint();
    const wire = key % 8;
    const field = Math.floor(key / 8);
    if (wire === 0) fields.push([field, varint()]);
    else if (wire === 1) offset += 8;
    else if (wire === 5) offset += 4;
    else if (wire === 2) {
      const length = varint();
      if (offset + length > bytes.length) throw new Error("Truncated field");
      fields.push([field, bytes.subarray(offset, offset + length)]);
      offset += length;
    } else throw new Error("Unsupported wire type");
  }
  return fields;
}

const textDecoder = new TextDecoder("utf-8", { fatal: true });

const bytesField = (bytes: Uint8Array | undefined, field: number) => {
  if (bytes === undefined) return undefined;
  for (const [number, value] of protoFields(bytes)) {
    if (number === field && value instanceof Uint8Array) return value;
  }
  return undefined;
};

const numberField = (bytes: Uint8Array | undefined, field: number) => {
  if (bytes === undefined) return undefined;
  for (const [number, value] of protoFields(bytes)) {
    if (number === field && typeof value === "number") return value;
  }
  return undefined;
};

const textField = (bytes: Uint8Array | undefined, field: number) => {
  const value = bytesField(bytes, field);
  return value === undefined ? undefined : textDecoder.decode(value);
};

function folderPath(uri: string | undefined): string | null {
  if (uri === undefined || !uri.startsWith("file:")) return null;
  try {
    return NodeURL.fileURLToPath(uri);
  } catch {
    return null;
  }
}

function openReadOnly<A>(databasePath: string, read: (database: NodeSqlite.DatabaseSync) => A) {
  const database = new NodeSqlite.DatabaseSync(databasePath, { readOnly: true });
  try {
    return read(database);
  } finally {
    database.close();
  }
}

/** The folder a conversation worked in, or null for conversations outside any project folder. */
export function readAntigravityWorkspace(databasePath: string): string | null {
  return openReadOnly(databasePath, (database) => {
    const row = database.prepare("SELECT data FROM trajectory_metadata_blob LIMIT 1").get();
    const data = row?.data;
    if (!(data instanceof Uint8Array)) return null;
    return (
      folderPath(textField(data, TRAJECTORY_WORKSPACE_URI)) ??
      folderPath(textField(bytesField(data, TRAJECTORY_WORKSPACE), WORKSPACE_FOLDER_URI))
    );
  });
}

export interface AntigravityConversationMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAtMs: number | null;
}

/** User prompts and the agent's final replies; tool calls and reasoning stay in the native record. */
export function readAntigravityMessages(
  databasePath: string,
): ReadonlyArray<AntigravityConversationMessage> {
  return openReadOnly(databasePath, (database) => {
    const rows = database
      .prepare("SELECT step_type, step_payload FROM steps WHERE step_type IN (?, ?) ORDER BY idx")
      .all(STEP_TYPE_USER_INPUT, STEP_TYPE_PLANNER_RESPONSE);
    const messages: Array<AntigravityConversationMessage> = [];
    for (const row of rows) {
      const payload = row.step_payload;
      if (!(payload instanceof Uint8Array)) continue;
      try {
        const isUser = row.step_type === STEP_TYPE_USER_INPUT;
        const text = isUser
          ? textField(bytesField(payload, STEP_USER_INPUT), USER_INPUT_TEXT)
          : textField(bytesField(payload, STEP_PLANNER_RESPONSE), PLANNER_RESPONSE_TEXT);
        if (text === undefined || text.trim().length === 0) continue;
        const createdAt = bytesField(bytesField(payload, STEP_METADATA), METADATA_CREATED_AT);
        const seconds = numberField(createdAt, TIMESTAMP_SECONDS);
        const nanos = numberField(createdAt, TIMESTAMP_NANOS) ?? 0;
        messages.push({
          role: isUser ? "user" : "assistant",
          text,
          createdAtMs: seconds === undefined ? null : seconds * 1000 + Math.floor(nanos / 1e6),
        });
      } catch {
        // A step this reader cannot decode is left out of the visible history.
      }
    }
    return messages;
  });
}

export interface AntigravityConversationSummary {
  readonly title: string | null;
  readonly lastModifiedMs: number | null;
}

// Go's time format: "2026-11-07 17:16:47.9150843+00:00".
function parseSummaryTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const iso = value
    .trim()
    .replace(" ", "T")
    .replace(/(\.\d{3})\d+/, "$1");
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The Antigravity app's own index of its conversations. Its modification time is the last
 * activity; the database files are touched whenever the app merely opens them.
 */
export function readAntigravitySummaries(
  summariesPath: string,
): ReadonlyMap<string, AntigravityConversationSummary> {
  try {
    return openReadOnly(summariesPath, (database) => {
      const summaries = new Map<string, AntigravityConversationSummary>();
      for (const row of database
        .prepare("SELECT conversation_id, title, last_modified_time FROM conversation_summaries")
        .all()) {
        if (typeof row.conversation_id !== "string") continue;
        summaries.set(row.conversation_id, {
          title: typeof row.title === "string" && row.title.trim() !== "" ? row.title : null,
          lastModifiedMs: parseSummaryTime(row.last_modified_time),
        });
      }
      return summaries;
    });
  } catch {
    return new Map();
  }
}

/** A consistent single-file copy, safe while the Antigravity app still writes the source. */
export function snapshotAntigravityConversation(databasePath: string, targetPath: string): void {
  openReadOnly(databasePath, (database) => {
    database.exec(`VACUUM INTO '${targetPath.replaceAll("'", "''")}'`);
  });
}
