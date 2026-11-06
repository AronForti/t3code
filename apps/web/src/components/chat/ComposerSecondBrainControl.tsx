import {
  BrainIcon,
  CheckIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
} from "lucide-react";
import { memo, useState } from "react";

import { readLocalApi } from "../../localApi";
import {
  DEFAULT_SECOND_BRAIN_VAULT_PATH,
  SECOND_BRAIN_OPERATIONS,
  type SecondBrainOperationMode,
  useSecondBrainStore,
} from "../../secondBrainStore";
import { cn } from "~/lib/utils";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerControl, ComposerControlIcon, type ComposerControlSize } from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";

function openInObsidian(vaultPath: string): void {
  const normalizedPath = vaultPath.trim() || DEFAULT_SECOND_BRAIN_VAULT_PATH;
  const obsidianUri = `obsidian://open?path=${encodeURIComponent(normalizedPath)}`;
  const api = readLocalApi();
  if (api) {
    void api.shell.openExternal(obsidianUri);
    return;
  }
  window.open(obsidianUri, "_blank", "noopener,noreferrer");
}

function openVaultInExplorer(vaultPath: string): void {
  const normalizedPath = vaultPath.trim() || DEFAULT_SECOND_BRAIN_VAULT_PATH;
  const api = readLocalApi();
  if (api) {
    void api.shell.openInEditor(normalizedPath, "explorer");
  }
}

export const ComposerSecondBrainControl = memo(function ComposerSecondBrainControl(props: {
  size?: ComposerControlSize;
}) {
  const size = props.size ?? "sm";
  const enabled = useSecondBrainStore((state) => state.enabled);
  const operation = useSecondBrainStore((state) => state.operation);
  const vaultPath = useSecondBrainStore((state) => state.vaultPath);
  const toggleEnabled = useSecondBrainStore((state) => state.toggleEnabled);
  const setOperation = useSecondBrainStore((state) => state.setOperation);
  const setVaultPath = useSecondBrainStore((state) => state.setVaultPath);

  const [menuOpen, setMenuOpen] = useState(false);
  const [editingVault, setEditingVault] = useState(false);
  const [vaultDraft, setVaultDraft] = useState(vaultPath);
  const composerFloatingLayerProps = useComposerMenuProps();

  const activeOp =
    SECOND_BRAIN_OPERATIONS.find((item) => item.mode === operation) ?? SECOND_BRAIN_OPERATIONS[0]!;

  const toggleTooltip = enabled
    ? `Second Brain attivo (${activeOp.label}). Clicca per disattivare`
    : "Attiva Second Brain (LLM Wiki condivisa con Obsidian per tutti i provider)";

  return (
    <div
      data-chat-composer-second-brain="true"
      className={cn(
        "inline-flex shrink-0 items-center rounded-(--control-radius)",
        enabled && "bg-primary/14 text-primary ring-1 ring-inset ring-primary/30",
      )}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <ComposerControl
              size={size}
              type="button"
              aria-pressed={enabled}
              aria-label={toggleTooltip}
              onClick={toggleEnabled}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-r-none pe-1",
                enabled && "bg-transparent! text-primary hover:bg-primary/15!",
              )}
            />
          }
        >
          <ComposerControlIcon
            icon={BrainIcon}
            size={size}
            className={cn(enabled ? "text-primary opacity-100" : undefined)}
          />
          <span
            data-composer-control-label
            className={size === "xs" ? "sr-only" : "sr-only sm:not-sr-only"}
          >
            {enabled ? `Brain · ${activeOp.shortLabel}` : "Brain"}
          </span>
        </TooltipTrigger>
        <TooltipPopup side="top">{toggleTooltip}</TooltipPopup>
      </Tooltip>

      <Menu
        open={menuOpen}
        onOpenChange={(nextOpen) => {
          setMenuOpen(nextOpen);
          if (nextOpen) {
            setVaultDraft(vaultPath);
            setEditingVault(false);
          }
        }}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                render={
                  <ComposerControl
                    size={size}
                    type="button"
                    aria-label="Opzioni Second Brain e Obsidian"
                    className={cn(
                      "rounded-l-none px-1",
                      enabled && "bg-transparent! text-primary hover:bg-primary/15!",
                    )}
                  />
                }
              />
            }
          >
            <ChevronDownIcon className="size-3.5 opacity-75" />
          </TooltipTrigger>
          <TooltipPopup side="top">Opzioni Second Brain & Obsidian</TooltipPopup>
        </Tooltip>

        <MenuPopup align="end" {...composerFloatingLayerProps} className="w-80">
          <div className="p-1">
            <div className="flex items-center justify-between gap-2 border-b border-border/60 px-2 pb-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <BrainIcon className="size-3.5 text-primary" />
                  <span>Second Brain · LLM Wiki</span>
                </div>
                <p className="truncate text-2xs text-muted-foreground">
                  Memoria condivisa tra tutti i provider
                </p>
              </div>
              <button
                type="button"
                onClick={toggleEnabled}
                className={cn(
                  "shrink-0 cursor-pointer rounded-full px-2.5 py-0.5 text-2xs font-semibold transition-colors",
                  enabled
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {enabled ? "Attivo" : "Disattivo"}
              </button>
            </div>

            <div className="mt-1.5 grid gap-1">
              <div className="px-2 py-0.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                Modalità Operativa
              </div>
              {SECOND_BRAIN_OPERATIONS.map((item) => {
                const selected = operation === item.mode;
                return (
                  <button
                    key={item.mode}
                    type="button"
                    onClick={() => {
                      setOperation(item.mode as SecondBrainOperationMode, true);
                      setMenuOpen(false);
                    }}
                    className={cn(
                      "flex w-full cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent",
                      selected && enabled && "bg-primary/10",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                        selected && enabled
                          ? "border-primary bg-primary text-primary-foreground"
                          : selected
                            ? "border-foreground/50 text-foreground"
                            : "border-border text-transparent",
                      )}
                    >
                      <CheckIcon className="size-2.5 stroke-2" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-foreground">
                        {item.label}
                      </span>
                      <span className="block text-2xs leading-snug text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-2 border-t border-border/60 pt-2">
              <div className="px-2 py-0.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                Obsidian Vault
              </div>
              <div className="mt-1 flex items-center gap-1 px-1">
                <button
                  type="button"
                  onClick={() => {
                    openInObsidian(vaultPath);
                    setMenuOpen(false);
                  }}
                  className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-primary/12 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
                >
                  <ExternalLinkIcon className="size-3.5" />
                  <span>Apri in Obsidian</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    openVaultInExplorer(vaultPath);
                    setMenuOpen(false);
                  }}
                  aria-label="Apri cartella Vault in Esplora File"
                  className="flex cursor-pointer items-center justify-center gap-1 rounded-lg bg-muted/70 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                >
                  <FolderOpenIcon className="size-3.5" />
                  <span>Cartella</span>
                </button>
              </div>

              <div className="mt-1.5 px-2">
                {editingVault ? (
                  <div className="flex flex-col gap-1.5">
                    <input
                      type="text"
                      value={vaultDraft}
                      onChange={(event) => setVaultDraft(event.target.value)}
                      placeholder={DEFAULT_SECOND_BRAIN_VAULT_PATH}
                      className="w-full rounded-md border border-border bg-background px-2 py-1 text-2xs text-foreground focus:outline-2 focus:outline-ring"
                    />
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setVaultDraft(vaultPath);
                          setEditingVault(false);
                        }}
                        className="cursor-pointer rounded px-2 py-0.5 text-2xs text-muted-foreground hover:bg-accent"
                      >
                        Annulla
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setVaultPath(vaultDraft);
                          setEditingVault(false);
                        }}
                        className="cursor-pointer rounded bg-primary px-2 py-0.5 text-2xs font-medium text-primary-foreground"
                      >
                        Salva
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-2xs text-muted-foreground">{vaultPath}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setVaultDraft(vaultPath);
                        setEditingVault(true);
                      }}
                      className="shrink-0 cursor-pointer text-2xs text-primary hover:underline"
                    >
                      Cambia
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </MenuPopup>
      </Menu>
    </div>
  );
});
