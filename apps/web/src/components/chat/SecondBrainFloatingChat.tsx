import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  findProjectByPath,
  inferProjectTitleFromPath,
} from "@t3tools/client-runtime/state/projects";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/shell";
import { stripSecondBrainInstructions } from "@t3tools/client-runtime/user-message";
import {
  DEFAULT_SERVER_SETTINGS,
  ThreadId,
  type ModelSelection,
  type ProjectId,
} from "@t3tools/contracts";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  ArrowUpIcon,
  BrainIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FilmIcon,
  FolderOpenIcon,
  Link2Icon,
  Loader2Icon,
  Maximize2Icon,
  MessageSquareIcon,
  Minimize2Icon,
  PaperclipIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  SquareIcon,
  UploadIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { readLocalApi } from "../../localApi";
import { cn, newMessageId, newProjectId, newThreadId } from "../../lib/utils";
import {
  resolveDefaultProviderModelSelection,
  resolveProjectDefaultProviderModelSelection,
} from "../../providerInstances";
import {
  buildSecondBrainFloatingTurnPrompt,
  classifySecondBrainPathOrUrl,
  DEFAULT_SECOND_BRAIN_VAULT_PATH,
  detectSecondBrainContentItems,
  type SecondBrainAttachedFile,
  type SecondBrainDetectedContentKind,
  type SecondBrainFloatingViewMode,
  type SecondBrainOperationMode,
  useSecondBrainStore,
} from "../../secondBrainStore";
import {
  readProjects,
  readThreadShell,
  useProjects,
  useQuietThreadShells,
  useThreadProjection,
  useThreadShell,
  waitForProject,
} from "../../state/entities";
import { usePrimaryEnvironment } from "../../state/environments";
import { projectEnvironment } from "../../state/projects";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import ChatMarkdown from "../ChatMarkdown";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { splitTransferredFiles } from "./workspaceFileDrop";

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

function renderDetectedIcon(kind: SecondBrainDetectedContentKind) {
  switch (kind) {
    case "pdf":
      return <FileTextIcon className="size-3 shrink-0 text-error" />;
    case "video":
      return <FilmIcon className="size-3 shrink-0 text-warning" />;
    case "link":
      return <Link2Icon className="size-3 shrink-0 text-info" />;
    case "file":
    default:
      return <PaperclipIcon className="size-3 shrink-0 text-success" />;
  }
}

function renderDetectedKindBadge(kind: SecondBrainDetectedContentKind): string {
  switch (kind) {
    case "pdf":
      return "PDF";
    case "video":
      return "Video";
    case "link":
      return "Link";
    case "file":
    default:
      return "File";
  }
}

function resolveTurnModelSelectionAndTimestamp(input: {
  readonly projectId: ProjectId;
  readonly existingSelection: ModelSelection | undefined;
  readonly serverConfig:
    | {
        readonly providers: Parameters<typeof resolveProjectDefaultProviderModelSelection>[0];
        readonly settings: Parameters<typeof resolveProjectDefaultProviderModelSelection>[1];
      }
    | null
    | undefined;
}): { readonly modelSelection: ModelSelection; readonly createdAt: string } {
  const nowMs = Date.now();
  const createdAt = new Date(nowMs).toISOString();
  if (input.existingSelection) {
    return { modelSelection: input.existingSelection, createdAt };
  }
  const providers = input.serverConfig?.providers ?? [];
  const settings = input.serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS;

  const projectDefault = resolveProjectDefaultProviderModelSelection(
    providers,
    settings,
    input.projectId,
  );
  const resolved = resolveNewThreadModelSelection({
    defaultSelection: projectDefault,
    fallbackSelection: settings.fallbackModelSelection ?? null,
    providers,
    settings,
    projectId: input.projectId,
    now: nowMs,
  });
  if (resolved.selection) {
    return { modelSelection: resolved.selection, createdAt };
  }

  const fallback = resolveDefaultProviderModelSelection(providers, undefined);
  if (fallback) {
    return { modelSelection: fallback, createdAt };
  }

  throw new Error("Nessun provider AI attivo trovato per eseguire il Second Brain.");
}

const FLOATING_MODES: ReadonlyArray<{
  readonly mode: SecondBrainOperationMode;
  readonly label: string;
  readonly placeholder: string;
  readonly icon: typeof UploadIcon;
}> = [
  {
    mode: "ingest",
    label: "Integra Fonte",
    placeholder:
      "Incolla un link (Web/YouTube), trascina un PDF/video o scrivi una nota e premi Invio...",
    icon: UploadIcon,
  },
  {
    mode: "query",
    label: "Chiedi al Brain",
    placeholder:
      "Fai una domanda diretta al tuo Second Brain (es. 'Riassumi le decisioni su...')...",
    icon: SearchIcon,
  },
  {
    mode: "lint",
    label: "Riordina Wiki",
    placeholder:
      "Premi Invio per lanciare il controllo integrità (check_wiki.py) o indica cosa riordinare...",
    icon: WrenchIcon,
  },
  {
    mode: "auto",
    label: "Chat Libera",
    placeholder: "Dialoga liberamente con il Second Brain o incolla contenuti da integrare...",
    icon: SparklesIcon,
  },
];

export function SecondBrainFloatingChat() {
  const navigate = useNavigate();
  const isUsageRoute = useLocation({ select: (location) => location.pathname === "/usage" });
  const floatingOpen = useSecondBrainStore((state) => state.floatingOpen);
  const setFloatingOpen = useSecondBrainStore((state) => state.setFloatingOpen);
  const toggleFloatingOpen = useSecondBrainStore((state) => state.toggleFloatingOpen);
  const floatingViewMode = useSecondBrainStore((state) => state.floatingViewMode);
  const setFloatingViewMode = useSecondBrainStore((state) => state.setFloatingViewMode);
  const floatingOperation = useSecondBrainStore((state) => state.floatingOperation);
  const setFloatingOperation = useSecondBrainStore((state) => state.setFloatingOperation);
  const vaultPath = useSecondBrainStore((state) => state.vaultPath);
  const dedicatedThreadId = useSecondBrainStore((state) => state.dedicatedThreadId);
  const setDedicatedThreadId = useSecondBrainStore((state) => state.setDedicatedThreadId);

  const primaryEnvironment = usePrimaryEnvironment();
  const environmentId = primaryEnvironment?.environmentId ?? null;
  const projects = useProjects();
  const allThreadShells = useQuietThreadShells();

  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const startThreadTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });
  const interruptTurn = useAtomCommand(threadEnvironment.interruptTurn, { reportFailure: false });

  const [inputText, setInputText] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<ReadonlyArray<SecondBrainAttachedFile>>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const vaultProject = environmentId
    ? (findProjectByPath(
        projects.filter((project) => project.environmentId === environmentId),
        vaultPath,
      ) ?? null)
    : null;

  const vaultProjectThreads =
    environmentId && vaultProject
      ? allThreadShells
          .filter(
            (shell) =>
              shell.environmentId === environmentId &&
              shell.projectId === vaultProject.id &&
              shell.deletedAt === null &&
              shell.archivedAt === null,
          )
          .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      : [];

  const resolvedThreadId = ((): ThreadId | null => {
    if (dedicatedThreadId) {
      const candidateId = ThreadId.make(dedicatedThreadId);
      const existsInVault = vaultProjectThreads.some((shell) => shell.id === candidateId);
      if (existsInVault || !vaultProject) {
        return candidateId;
      }
    }
    return vaultProjectThreads[0]?.id ?? null;
  })();

  const activeThreadRef =
    environmentId && resolvedThreadId ? scopeThreadRef(environmentId, resolvedThreadId) : null;

  const activeThreadShell = useThreadShell(activeThreadRef);
  const activeThreadData = useThreadProjection(activeThreadRef);
  const isThreadWorking = threadRuntimeIsActive(activeThreadShell?.runtime);

  const rawMessages = activeThreadData?.projection.messages ?? [];
  const messages = rawMessages.filter((msg) => msg.role === "user" || msg.role === "assistant");

  const latestActiveToolLabel = ((): string | null => {
    if (!isThreadWorking || !activeThreadData) return null;
    const items = activeThreadData.projection.visibleTurnItems;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index]?.item;
      if (!item) continue;
      if (item.type === "command_execution") {
        return `Comando: ${item.command.slice(0, 60)}`;
      }
      if (item.type === "file_change") {
        return "Aggiornamento file nella Wiki...";
      }
      if (item.type === "dynamic_tool") {
        return `Strumento: ${item.toolName}`;
      }
    }
    return "Elaborazione nel Second Brain...";
  })();

  const detectedItems = detectSecondBrainContentItems(inputText, attachedFiles);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- global keyboard shortcut Ctrl+Shift+B / Cmd+Shift+B to toggle the floating Second Brain side chat
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "b"
      ) {
        event.preventDefault();
        event.stopPropagation();
        toggleFloatingOpen();
        return;
      }
      if (
        event.key === "Escape" &&
        floatingOpen &&
        event.target instanceof Node &&
        document.querySelector("[data-second-brain-floating]")?.contains(event.target)
      ) {
        event.preventDefault();
        event.stopPropagation();
        setFloatingOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [floatingOpen, setFloatingOpen, toggleFloatingOpen]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- focuses the quick-ingest input when the floating Second Brain panel opens
  useEffect(() => {
    if (!floatingOpen) return;
    const timer = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 40);
    return () => window.clearTimeout(timer);
  }, [floatingOpen]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- scrolls the floating Second Brain chat when opened or switched to chat view
  useEffect(() => {
    if (!floatingOpen || floatingViewMode === "bar") return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [floatingOpen, floatingViewMode]);

  const stageFilesFromFileList = (files: Iterable<File>) => {
    const getPathForFile = window.desktopBridge?.getPathForFile;
    const added: SecondBrainAttachedFile[] = [];
    const fallbackNames: string[] = [];

    for (const file of files) {
      const localPath = getPathForFile?.(file)?.trim() ?? "";
      if (localPath.length > 0) {
        added.push({
          id: newMessageId(),
          name: file.name || localPath.split(/[\\/]/).at(-1) || "file",
          path: localPath,
          kind: classifySecondBrainPathOrUrl(localPath),
        });
      } else if (file.name) {
        fallbackNames.push(file.name);
      }
    }

    if (added.length > 0) {
      setAttachedFiles((current) => {
        const existingPaths = new Set(current.map((item) => item.path.toLowerCase()));
        const unique = added.filter((item) => !existingPaths.has(item.path.toLowerCase()));
        return [...current, ...unique];
      });
      if (floatingOperation !== "ingest") {
        setFloatingOperation("ingest");
      }
    } else if (fallbackNames.length > 0) {
      setInputText((current) =>
        current.trim().length > 0
          ? `${current}\n${fallbackNames.join("\n")}`
          : fallbackNames.join("\n"),
      );
    }
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    if (
      !event.dataTransfer.types.includes("Files") &&
      !event.dataTransfer.types.includes("text/uri-list")
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(false);
    if (!floatingOpen) {
      setFloatingOpen(true);
    }

    const { files, folders } = splitTransferredFiles(event.dataTransfer);
    const allFiles = [...files, ...folders];
    if (allFiles.length > 0) {
      stageFilesFromFileList(allFiles);
      return;
    }

    const uriList =
      event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain");
    if (uriList && uriList.trim().length > 0) {
      setInputText((current) =>
        current.trim().length > 0 ? `${current}\n${uriList.trim()}` : uriList.trim(),
      );
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (event.clipboardData.files && event.clipboardData.files.length > 0) {
      const files = Array.from(event.clipboardData.files);
      const getPathForFile = window.desktopBridge?.getPathForFile;
      if (files.some((file) => Boolean(getPathForFile?.(file)))) {
        event.preventDefault();
        stageFilesFromFileList(files);
      }
    }
  };

  const ensureVaultProjectId = async (): Promise<ProjectId> => {
    if (!environmentId) {
      throw new Error("Ambiente locale non connesso.");
    }
    const existing = findProjectByPath(
      readProjects().filter((project) => project.environmentId === environmentId),
      vaultPath,
    );
    if (existing) {
      return existing.id;
    }
    const projectId = newProjectId();
    const result = await createProject({
      environmentId,
      input: {
        projectId,
        title: inferProjectTitleFromPath(vaultPath) || "Aron Wiki",
        workspaceRoot: vaultPath,
        createWorkspaceRootIfMissing: false,
        defaultModelSelection: null,
      },
    });
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      throw error instanceof Error
        ? error
        : new Error("Impossibile registrare il progetto Second Brain.");
    }
    await waitForProject({ environmentId, projectId });
    return projectId;
  };

  const handleSend = async (overrideMode?: SecondBrainOperationMode) => {
    const modeToUse = overrideMode ?? floatingOperation;
    const trimmed = inputText.trim();
    const canSendEmpty = modeToUse === "lint";

    if (isSending || !environmentId) return;
    if (trimmed.length === 0 && attachedFiles.length === 0 && !canSendEmpty) return;

    setIsSending(true);
    try {
      const projectId = await ensureVaultProjectId();
      const targetThreadId = resolvedThreadId ?? newThreadId();
      const existingShell = readThreadShell(scopeThreadRef(environmentId, targetThreadId));
      const { modelSelection, createdAt } = resolveTurnModelSelectionAndTimestamp({
        projectId,
        existingSelection: existingShell?.modelSelection,
        serverConfig: primaryEnvironment?.serverConfig,
      });

      const { outgoingText, titleSeed } = buildSecondBrainFloatingTurnPrompt({
        rawText: inputText,
        attachedFiles,
        operation: modeToUse,
        vaultPath,
      });

      const turnResult = await startThreadTurn({
        environmentId,
        input: {
          threadId: targetThreadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: outgoingText,
            attachments: [],
          },
          modelSelection,
          titleSeed,
          runtimeMode: "full-access",
          interactionMode: "default",
          dispatchMode: "auto",
          ...(existingShell === null
            ? {
                bootstrap: {
                  createThread: {
                    projectId,
                    title: titleSeed,
                    modelSelection,
                    runtimeMode: "full-access",
                    interactionMode: "default",
                    branch: null,
                    worktreePath: null,
                    createdAt,
                  },
                },
              }
            : {}),
          createdAt,
        },
      });

      if (turnResult._tag === "Failure") {
        const error = squashAtomCommandFailure(turnResult);
        throw error instanceof Error ? error : new Error("Invio al Second Brain non riuscito.");
      }

      setDedicatedThreadId(targetThreadId);
      setInputText("");
      setAttachedFiles([]);
      if (floatingViewMode === "bar") {
        setFloatingViewMode("chat");
      }
      window.setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      }, 80);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Errore Second Brain",
        description: error instanceof Error ? error.message : "Impossibile inviare il comando.",
      });
    } finally {
      setIsSending(false);
    }
  };

  const handleStopTurn = async () => {
    if (!environmentId || !resolvedThreadId) return;
    await interruptTurn({
      environmentId,
      input: { threadId: resolvedThreadId },
    });
  };

  const handleNewSession = () => {
    const freshId = newThreadId();
    setDedicatedThreadId(freshId);
    setInputText("");
    setAttachedFiles([]);
    textareaRef.current?.focus();
  };

  const handleOpenInMainView = () => {
    if (!activeThreadRef || !activeThreadShell) return;
    setFloatingOpen(false);
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(activeThreadRef),
    });
  };

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void handleSend();
    }
  };

  if (isUsageRoute) return null;

  const activeModeMeta =
    FLOATING_MODES.find((item) => item.mode === floatingOperation) ?? FLOATING_MODES[0]!;
  const hasSendableInput =
    inputText.trim().length > 0 || attachedFiles.length > 0 || floatingOperation === "lint";

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.mp4,.mkv,.mov,.webm,.avi,.mp3,.wav,.m4a,.md,.txt,.docx,.pptx,.xlsx,.csv,.json,.html,*/*"
        className="hidden"
        onChange={(event) => {
          if (event.target.files && event.target.files.length > 0) {
            stageFilesFromFileList(Array.from(event.target.files));
            event.target.value = "";
          }
        }}
      />

      {!floatingOpen ? (
        <div
          data-second-brain-floating-trigger=""
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("Files")) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setIsDragActive(true);
            }
          }}
          onDragLeave={() => setIsDragActive(false)}
          onDrop={handleDrop}
          className="pointer-events-auto fixed right-3 bottom-14 z-40"
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={() => setFloatingOpen(true)}
                  aria-label="Apri Second Brain Side Chat & Quick Ingest (Ctrl+Shift+B)"
                  className={cn(
                    "group flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-md backdrop-blur-md transition-all hover:scale-[1.03]",
                    isDragActive
                      ? "border-primary bg-primary/20 text-primary ring-2 ring-inset ring-primary/40"
                      : isThreadWorking
                        ? "border-primary/50 bg-background/90 text-primary shadow-primary/10"
                        : "border-border/70 bg-background/85 text-foreground hover:border-primary/40 hover:bg-background",
                  )}
                />
              }
            >
              <span className="relative flex items-center justify-center">
                <BrainIcon className="size-4 text-primary" />
                {isThreadWorking ? (
                  <span className="absolute -top-0.5 -right-0.5 flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex size-2 rounded-full bg-primary" />
                  </span>
                ) : null}
              </span>
              <span>Second Brain</span>
              {isThreadWorking ? (
                <Loader2Icon className="size-3 animate-spin text-primary" />
              ) : null}
            </TooltipTrigger>
            <TooltipPopup side="left">
              Second Brain · Incolla PDF, link o video (Ctrl+Shift+B)
            </TooltipPopup>
          </Tooltip>
        </div>
      ) : (
        <section
          data-second-brain-floating=""
          data-side-chat-pane=""
          aria-label="Second Brain Side Chat e Quick Ingest"
          onDragEnter={(event) => {
            if (event.dataTransfer.types.includes("Files")) {
              event.preventDefault();
              setIsDragActive(true);
            }
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("Files")) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setIsDragActive(true);
            }
          }}
          onDragLeave={(event) => {
            if (
              event.relatedTarget instanceof Node &&
              event.currentTarget.contains(event.relatedTarget)
            ) {
              return;
            }
            setIsDragActive(false);
          }}
          onDrop={handleDrop}
          className={cn(
            "pointer-events-auto fixed right-3 bottom-14 z-50 flex flex-col overflow-hidden rounded-2xl border border-border/80 bg-background/95 shadow-2xl backdrop-blur-xl transition-all duration-200",
            floatingViewMode === "bar"
              ? "w-[min(460px,calc(100vw-1.5rem))]"
              : floatingViewMode === "expanded"
                ? "h-[min(76vh,680px)] w-[min(600px,calc(100vw-1.5rem))]"
                : "h-[min(62vh,520px)] w-[min(440px,calc(100vw-1.5rem))]",
            isDragActive && "ring-2 ring-inset ring-primary",
          )}
        >
          {/* Drag Overlay */}
          {isDragActive ? (
            <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-background/90 text-center backdrop-blur-xs">
              <div className="flex size-12 items-center justify-center rounded-full bg-primary/15 text-primary">
                <UploadIcon className="size-6" />
              </div>
              <p className="text-sm font-semibold text-foreground">
                Rilascia PDF, video o documenti qui
              </p>
              <p className="text-xs text-muted-foreground">
                Verranno acquisiti e integrati direttamente in Aron Wiki
              </p>
            </div>
          ) : null}

          {/* Top Header */}
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <BrainIcon className="size-3.5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-semibold text-foreground">
                    Second Brain
                  </span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-2xs font-medium",
                      isThreadWorking
                        ? "bg-primary/15 text-primary"
                        : "bg-success/15 text-success-foreground",
                    )}
                  >
                    {isThreadWorking ? (
                      <>
                        <Loader2Icon className="size-2.5 animate-spin" />
                        <span>Attivo</span>
                      </>
                    ) : (
                      <span>Pronto</span>
                    )}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-0.5">
              {/* View Mode Switcher: Barra | Chat | Ampia */}
              <div className="mr-1 inline-flex items-center rounded-lg border border-border/60 bg-background/60 p-0.5">
                {(
                  [
                    { id: "bar", label: "Barra" },
                    { id: "chat", label: "Chat" },
                    { id: "expanded", label: "Ampia" },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFloatingViewMode(tab.id as SecondBrainFloatingViewMode)}
                    className={cn(
                      "cursor-pointer rounded-md px-1.5 py-0.5 text-2xs font-medium transition-colors",
                      floatingViewMode === tab.id
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      onClick={handleNewSession}
                      aria-label="Nuova sessione Second Brain"
                      className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    />
                  }
                >
                  <PlusIcon className="size-3.5" />
                </TooltipTrigger>
                <TooltipPopup side="bottom">Nuova sessione Second Brain</TooltipPopup>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      onClick={() => openInObsidian(vaultPath)}
                      aria-label="Apri Vault in Obsidian"
                      className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    />
                  }
                >
                  <ExternalLinkIcon className="size-3.5" />
                </TooltipTrigger>
                <TooltipPopup side="bottom">Apri in Obsidian</TooltipPopup>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      onClick={() => openVaultInExplorer(vaultPath)}
                      aria-label="Apri cartella Vault in Esplora File"
                      className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    />
                  }
                >
                  <FolderOpenIcon className="size-3.5" />
                </TooltipTrigger>
                <TooltipPopup side="bottom">Apri cartella Aron Wiki</TooltipPopup>
              </Tooltip>

              {activeThreadShell ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        onClick={handleOpenInMainView}
                        aria-label="Apri conversazione a tutto schermo"
                        className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      />
                    }
                  >
                    {floatingViewMode === "expanded" ? (
                      <Minimize2Icon className="size-3.5" />
                    ) : (
                      <Maximize2Icon className="size-3.5" />
                    )}
                  </TooltipTrigger>
                  <TooltipPopup side="bottom">Apri thread Second Brain completo</TooltipPopup>
                </Tooltip>
              ) : null}

              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      onClick={() => setFloatingOpen(false)}
                      aria-label="Chiudi finestra fluttuante Second Brain (Esc)"
                      className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    />
                  }
                >
                  <XIcon className="size-3.5" />
                </TooltipTrigger>
                <TooltipPopup side="bottom">Chiudi (Esc)</TooltipPopup>
              </Tooltip>
            </div>
          </header>

          {/* Operation Mode Bar + Session Selector */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-1.5 border-b border-border/50 bg-background/60 px-3 py-1.5">
            <div className="flex flex-wrap items-center gap-1">
              {FLOATING_MODES.map((item) => {
                const Icon = item.icon;
                const active = floatingOperation === item.mode;
                return (
                  <button
                    key={item.mode}
                    type="button"
                    onClick={() => setFloatingOperation(item.mode)}
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium transition-colors",
                      active
                        ? "bg-primary/15 text-primary ring-1 ring-inset ring-primary/35"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>

            {vaultProjectThreads.length > 1 ? (
              <select
                aria-label="Seleziona sessione Second Brain"
                value={resolvedThreadId ?? ""}
                onChange={(event) => {
                  const nextId = event.target.value;
                  setDedicatedThreadId(nextId || null);
                }}
                className="max-w-36 truncate rounded-md border border-border/60 bg-background px-1.5 py-0.5 text-2xs text-muted-foreground focus:outline-none"
              >
                {vaultProjectThreads.slice(0, 12).map((thread) => (
                  <option key={thread.id} value={thread.id}>
                    {thread.title || "Sessione Brain"}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          {/* Chat Timeline (visible in "chat" and "expanded" modes) */}
          {floatingViewMode !== "bar" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-2.5">
              {messages.length === 0 ? (
                <div className="my-auto flex flex-col items-center justify-center gap-2.5 px-4 py-6 text-center">
                  <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                    <BrainIcon className="size-5" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-foreground">
                      Interfaccia Diretta Second Brain
                    </p>
                    <p className="text-2xs leading-relaxed text-muted-foreground">
                      Incolla un <strong>link web</strong>, un <strong>video YouTube</strong>, il
                      percorso di un <strong>PDF</strong> (o trascinalo qui) e premi{" "}
                      <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-2xs">
                        Invio
                      </kbd>{" "}
                      per integrarlo subito in <code className="text-foreground">Aron Wiki</code>.
                    </p>
                  </div>
                  <div className="mt-1 flex flex-wrap justify-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-border/70 bg-muted/40 px-2.5 py-1 text-2xs font-medium text-foreground transition-colors hover:bg-accent"
                    >
                      <PaperclipIcon className="size-3 text-primary" />
                      <span>Scegli PDF / Video</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFloatingOperation("query");
                        setInputText(
                          "Mostrami una panoramica aggiornata di index.md e degli ultimi ingressi nel Second Brain.",
                        );
                        textareaRef.current?.focus();
                      }}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-border/70 bg-muted/40 px-2.5 py-1 text-2xs font-medium text-foreground transition-colors hover:bg-accent"
                    >
                      <MessageSquareIcon className="size-3 text-primary" />
                      <span>Stato della Wiki</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSend("lint")}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-border/70 bg-muted/40 px-2.5 py-1 text-2xs font-medium text-foreground transition-colors hover:bg-accent"
                    >
                      <WrenchIcon className="size-3 text-primary" />
                      <span>Esegui Health Check</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {messages.map((message) => {
                    if (message.role === "user") {
                      const cleanText = stripSecondBrainInstructions(message.text).trim();
                      return (
                        <div key={message.id} className="flex flex-col items-end gap-1">
                          <div className="max-w-[88%] rounded-2xl rounded-br-sm bg-primary/14 px-3 py-2 text-xs text-foreground ring-1 ring-inset ring-primary/25">
                            <p className="whitespace-pre-wrap break-words leading-relaxed">
                              {cleanText || message.text}
                            </p>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div key={message.id} className="flex flex-col items-start gap-1">
                        <div className="flex items-center gap-1.5 px-1 text-2xs font-medium text-primary">
                          <BrainIcon className="size-3" />
                          <span>Second Brain</span>
                        </div>
                        <div className="w-full rounded-2xl rounded-tl-sm border border-border/60 bg-muted/25 px-3 py-2 text-xs text-foreground">
                          <ChatMarkdown
                            text={
                              message.text ||
                              (message.streaming ? "Elaborazione in corso..." : "(risposta vuota)")
                            }
                            cwd={vaultPath}
                            threadRef={activeThreadRef ?? undefined}
                            isStreaming={Boolean(message.streaming)}
                          />
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>
          ) : null}

          {/* Live Working Status Banner */}
          {isThreadWorking ? (
            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/50 bg-primary/8 px-3 py-1.5 text-2xs text-primary">
              <div className="flex min-w-0 items-center gap-1.5">
                <Loader2Icon className="size-3 shrink-0 animate-spin" />
                <span className="truncate font-medium">
                  {latestActiveToolLabel ?? "Il Second Brain sta elaborando..."}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void handleStopTurn()}
                className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-destructive/15 px-2 py-0.5 text-2xs font-semibold text-destructive transition-colors hover:bg-destructive/25"
              >
                <SquareIcon className="size-2.5 fill-current" />
                <span>Stop</span>
              </button>
            </div>
          ) : null}

          {/* Quick-Ingest & Chat Input Footer */}
          <div className="shrink-0 border-t border-border/60 bg-background p-2.5">
            {/* Detected Content Badges (PDF, Video, Link, File) */}
            {detectedItems.length > 0 ? (
              <div className="mb-2 flex flex-wrap items-center gap-1">
                {detectedItems.map((item) => (
                  <span
                    key={item.key}
                    className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/70 bg-muted/60 px-2 py-0.5 text-2xs text-foreground"
                  >
                    {renderDetectedIcon(item.kind)}
                    <span className="font-semibold uppercase opacity-75">
                      {renderDetectedKindBadge(item.kind)}:
                    </span>
                    <span className="max-w-48 truncate">{item.label}</span>
                    {item.removableFileId ? (
                      <button
                        type="button"
                        onClick={() =>
                          setAttachedFiles((current) =>
                            current.filter((file) => file.id !== item.removableFileId),
                          )
                        }
                        aria-label={`Rimuovi ${item.label}`}
                        className="ml-0.5 cursor-pointer rounded-xs p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <XIcon className="size-2.5" />
                      </button>
                    ) : null}
                  </span>
                ))}
              </div>
            ) : null}

            <div className="flex items-end gap-1.5 rounded-xl border border-border/80 bg-muted/20 p-1.5 focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-inset focus-within:ring-primary/30">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      aria-label="Allega PDF, Video o Documento locale"
                      className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    />
                  }
                >
                  <PaperclipIcon className="size-4" />
                </TooltipTrigger>
                <TooltipPopup side="top">
                  Scegli un PDF, un video o un file dal computer
                </TooltipPopup>
              </Tooltip>

              <textarea
                ref={textareaRef}
                rows={2}
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                onPaste={handlePaste}
                onKeyDown={handleInputKeyDown}
                placeholder={activeModeMeta.placeholder}
                className="max-h-28 min-h-[38px] flex-1 resize-none bg-transparent px-1 py-1 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none"
              />

              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      disabled={!hasSendableInput || isSending || !environmentId}
                      onClick={() => void handleSend()}
                      aria-label="Invia al Second Brain (Invio)"
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors",
                        hasSendableInput && !isSending && environmentId
                          ? "cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90"
                          : "cursor-not-allowed bg-muted text-muted-foreground opacity-50",
                      )}
                    />
                  }
                >
                  {isSending ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : (
                    <ArrowUpIcon className="size-4" />
                  )}
                </TooltipTrigger>
                <TooltipPopup side="top">
                  {floatingOperation === "ingest"
                    ? "Integra subito nel Second Brain (Invio)"
                    : "Invia al Second Brain (Invio)"}
                </TooltipPopup>
              </Tooltip>
            </div>

            <div className="mt-1.5 flex items-center justify-between px-1 text-3xs text-muted-foreground">
              <span>
                <strong>Invio</strong> per{" "}
                {floatingOperation === "ingest" ? "integrare" : "inviare"} ·{" "}
                <strong>Shift+Invio</strong> a capo · <strong>Trascina</strong> PDF/video
              </span>
              <span className="truncate">Vault: Aron Wiki</span>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
