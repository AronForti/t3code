import type { UserMcpServer } from "@t3tools/contracts";
import { ExternalLinkIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  catalogEntry,
  draftFromServer,
  EMPTY_MCP_SERVER_DRAFT,
  MCP_CATALOG,
  missingSetupValues,
  parseMcpServerDraft,
  uniqueCatalogName,
  type McpServerDraft,
} from "./McpServersSettings.logic";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

interface EditorState {
  readonly draft: McpServerDraft;
  /** Name of the server being edited; null adds a new one. */
  readonly original: string | null;
}

export function McpServersSettingsPanel() {
  const servers = useScopedSettings((settings) => settings.mcpServers);
  const updateSettings = useUpdateScopedSettings();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const names = new Set(servers.map((server) => server.name));

  const save = (next: ReadonlyArray<UserMcpServer>) => updateSettings({ mcpServers: [...next] });
  const replace = (original: string | null, server: UserMcpServer) =>
    save(
      original === null
        ? [...servers, server]
        : servers.map((current) => (current.name === original ? server : current)),
    );

  return (
    <SettingsPageContainer>
      <SettingsSection id="mcp-installed" title="Installed servers">
        {servers.length === 0 ? (
          <SettingsRow
            title="No MCP servers yet"
            description="Install one from the catalog below or add your own. New sessions of every provider pick them up."
          />
        ) : (
          servers.map((server) => (
            <InstalledServerRow
              key={server.name}
              server={server}
              onToggle={(enabled) => replace(server.name, { ...server, enabled })}
              onEdit={() => setEditor({ draft: draftFromServer(server), original: server.name })}
              onRemove={() => save(servers.filter((current) => current.name !== server.name))}
            />
          ))
        )}
      </SettingsSection>

      <SettingsSection
        id="mcp-catalog"
        title="Catalog"
        headerAction={
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditor({ draft: EMPTY_MCP_SERVER_DRAFT, original: null })}
          >
            <PlusIcon />
            Custom server
          </Button>
        }
      >
        {MCP_CATALOG.map((entry) => {
          const installed = servers.some((server) => server.catalogId === entry.id);
          return (
            <SettingsRow
              key={entry.id}
              title={entry.title}
              description={
                <>
                  {entry.description}{" "}
                  <a
                    href={entry.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 underline underline-offset-2"
                  >
                    Setup
                    <ExternalLinkIcon className="size-3" />
                  </a>
                </>
              }
              control={
                <Button
                  size="sm"
                  variant={installed ? "ghost" : "default"}
                  onClick={() =>
                    setEditor({
                      draft: draftFromServer({
                        ...entry.server,
                        name: uniqueCatalogName(entry.server.name, names),
                      }),
                      original: null,
                    })
                  }
                >
                  {installed ? "Add another" : "Install"}
                </Button>
              }
            />
          );
        })}
      </SettingsSection>

      {editor ? (
        <McpServerEditor
          editor={editor}
          otherNames={new Set([...names].filter((name) => name !== editor.original))}
          onClose={() => setEditor(null)}
          onSave={(server) => {
            replace(editor.original, server);
            setEditor(null);
          }}
        />
      ) : null}
    </SettingsPageContainer>
  );
}

function InstalledServerRow({
  server,
  onToggle,
  onEdit,
  onRemove,
}: {
  server: UserMcpServer;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const missing = missingSetupValues(server);
  const target =
    server.transport.type === "stdio"
      ? [server.transport.command, ...server.transport.args].join(" ")
      : server.transport.url;
  return (
    <SettingsRow
      title={
        <span className="inline-flex items-center gap-2">
          {server.name}
          <Badge variant="outline">{server.transport.type}</Badge>
          {missing.length > 0 ? <Badge variant="warning">Needs {missing.join(", ")}</Badge> : null}
        </span>
      }
      description={<code className="break-all text-xs">{target}</code>}
      control={
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onEdit}>
            Edit
          </Button>
          <Button size="sm" variant="ghost-destructive" onClick={onRemove}>
            Remove
          </Button>
          <Switch
            checked={server.enabled}
            onCheckedChange={(checked) => onToggle(Boolean(checked))}
            aria-label={`Enable ${server.name}`}
          />
        </div>
      }
    />
  );
}

function McpServerEditor({
  editor,
  otherNames,
  onClose,
  onSave,
}: {
  editor: EditorState;
  otherNames: ReadonlySet<string>;
  onClose: () => void;
  onSave: (server: UserMcpServer) => void;
}) {
  const [draft, setDraft] = useState(editor.draft);
  const [error, setError] = useState<string | null>(null);
  const entry = catalogEntry(draft.catalogId);
  const set = (patch: Partial<McpServerDraft>) => setDraft((current) => ({ ...current, ...patch }));
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = parseMcpServerDraft(draft, otherNames);
            if ("error" in parsed) setError(parsed.error);
            else onSave(parsed.server);
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {editor.original === null ? `Install ${entry?.title ?? "MCP server"}` : "Edit server"}
            </DialogTitle>
            <DialogDescription>
              {entry?.setup ??
                "Runs for Claude, Codex, Cursor and ACP agents such as Antigravity. Values are stored in this environment's settings."}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <label className="block space-y-1.5 text-sm">
              <span>Name</span>
              <Input
                autoFocus
                required
                value={draft.name}
                onChange={(event) => set({ name: event.target.value })}
                placeholder="my-server"
              />
            </label>
            <ToggleGroup
              aria-label="Transport"
              variant="segmented"
              value={[draft.type]}
              onValueChange={(next) => {
                if (next[0] === "stdio" || next[0] === "http") set({ type: next[0] });
              }}
            >
              <Toggle value="stdio">Command (stdio)</Toggle>
              <Toggle value="http">URL (HTTP)</Toggle>
            </ToggleGroup>
            {draft.type === "stdio" ? (
              <>
                <label className="block space-y-1.5 text-sm">
                  <span>Command</span>
                  <Input
                    value={draft.command}
                    onChange={(event) => set({ command: event.target.value })}
                    placeholder="npx"
                  />
                </label>
                <label className="block space-y-1.5 text-sm">
                  <span>Arguments, one per line</span>
                  <Textarea
                    value={draft.args}
                    onChange={(event) => set({ args: event.target.value })}
                    placeholder={"-y\n@scope/mcp-server"}
                  />
                </label>
                <label className="block space-y-1.5 text-sm">
                  <span>Environment, KEY=value per line</span>
                  <Textarea
                    value={draft.env}
                    onChange={(event) => set({ env: event.target.value })}
                    placeholder="API_KEY=…"
                  />
                </label>
              </>
            ) : (
              <>
                <label className="block space-y-1.5 text-sm">
                  <span>URL</span>
                  <Input
                    value={draft.url}
                    onChange={(event) => set({ url: event.target.value })}
                    placeholder="https://example.com/mcp"
                  />
                </label>
                <label className="block space-y-1.5 text-sm">
                  <span>Headers, Name: value per line</span>
                  <Textarea
                    value={draft.headers}
                    onChange={(event) => set({ headers: event.target.value })}
                    placeholder="Authorization: Bearer …"
                  />
                </label>
              </>
            )}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
