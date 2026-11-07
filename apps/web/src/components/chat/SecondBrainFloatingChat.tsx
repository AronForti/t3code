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
  type EnvironmentId,
  type ModelSelection,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  ArrowUpIcon,
  BrainIcon,
  CheckIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FilmIcon,
  FolderOpenIcon,
  Link2Icon,
  Loader2Icon,
  PaperclipIcon,
  SearchIcon,
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
  type ReactNode,
} from "react";

import { readLocalApi } from "../../localApi";
import { cn, newMessageId, newProjectId, newThreadId } from "../../lib/utils";
import {
  resolveDefaultProviderModelSelection,
  resolveProjectDefaultProviderModelSelection,
} from "../../providerInstances";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import {
  buildSecondBrainFloatingTurnPrompt,
  classifySecondBrainPathOrUrl,
  DEFAULT_SECOND_BRAIN_VAULT_PATH,
  detectSecondBrainContentItems,
  type SecondBrainAttachedFile,
  type SecondBrainDetectedContentKind,
  type SecondBrainOperationMode,
  useSecondBrainStore,
} from "../../secondBrainStore";
import {
  readProjects,
  useThreadProjection,
  useThreadShell,
  waitForProject,
} from "../../state/entities";
import { usePrimaryEnvironment } from "../../state/environments";
import { projectEnvironment } from "../../state/projects";
import { environmentServerConfigsAtom } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import ChatMarkdown from "../ChatMarkdown";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useOpenSecondBrainVault } from "./useOpenSecondBrainVault";
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

function resolveTurnModelSelection(input: {
  readonly projectId: ProjectId;
  readonly serverConfig:
    | {
        readonly providers: Parameters<typeof resolveProjectDefaultProviderModelSelection>[0];
        readonly settings: Parameters<typeof resolveProjectDefaultProviderModelSelection>[1];
      }
    | null
    | undefined;
}): ModelSelection {
  const providers = input.serverConfig?.providers ?? [];
  const settings = input.serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS;
  const resolved = resolveNewThreadModelSelection({
    defaultSelection: resolveProjectDefaultProviderModelSelection(
      providers,
      settings,
      input.projectId,
    ),
    fallbackSelection: settings.fallbackModelSelection ?? null,
    providers,
    settings,
    projectId: input.projectId,
    now: Date.now(),
  });
  const selection =
    resolved.selection ?? resolveDefaultProviderModelSelection(providers, undefined);
  if (selection) return selection;
  throw new Error("Nessun provider AI attivo trovato per eseguire il Second Brain.");
}

type PanelOperation = Extract<SecondBrainOperationMode, "ingest" | "query" | "lint">;

const PANEL_OPERATIONS: ReadonlyArray<{
  readonly mode: PanelOperation;
  readonly label: string;
  readonly placeholder: string;
  readonly icon: typeof UploadIcon;
}> = [
  {
    mode: "ingest",
    label: "Integra fonte",
    placeholder: "Incolla un link o trascina un PDF/video…",
    icon: UploadIcon,
  },
  {
    mode: "query",
    label: "Chiedi al brain",
    placeholder: "Cosa vuoi sapere dal tuo Second Brain?",
    icon: SearchIcon,
  },
  {
    mode: "lint",
    label: "Riordina wiki",
    placeholder: "Facoltativo: cosa controllare in particolare",
    icon: WrenchIcon,
  },
];

const panelOperation = (mode: SecondBrainOperationMode): PanelOperation =>
  mode === "query" || mode === "lint" ? mode : "ingest";

type JobStatus = "running" | "done" | "failed";

interface SecondBrainJob {
  readonly threadId: ThreadId;
  readonly operation: PanelOperation;
  readonly title: string;
  readonly status: JobStatus;
  readonly answer: string | null;
}

const MAX_JOBS = 5;

export function SecondBrainFloatingChat() {
  const navigate = useNavigate();
  const isUsageRoute = useLocation({ select: (location) => location.pathname === "/usage" });
  const floatingOpen = useSecondBrainStore((state) => state.floatingOpen);
  const setFloatingOpen = useSecondBrainStore((state) => state.setFloatingOpen);
  const toggleFloatingOpen = useSecondBrainStore((state) => state.toggleFloatingOpen);
  const operation = panelOperation(useSecondBrainStore((state) => state.floatingOperation));
  const setOperation = useSecondBrainStore((state) => state.setFloatingOperation);
  const vaultPath = useSecondBrainStore((state) => state.vaultPath);

  const environmentId = usePrimaryEnvironment()?.environmentId ?? null;
  const openVaultInExplorer = useOpenSecondBrainVault();
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const startThreadTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });
  const archiveThread = useOrchestrationCommand(threadEnvironment.archive, {
    reportFailure: false,
  });

  const [inputText, setInputText] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<ReadonlyArray<SecondBrainAttachedFile>>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [jobs, setJobs] = useState<ReadonlyArray<SecondBrainJob>>([]);

  const finishedJobs = useRef(new Set<ThreadId>());
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const runningCount = jobs.filter((job) => job.status === "running").length;
  const detectedItems = detectSecondBrainContentItems(inputText, attachedFiles);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- global Ctrl+Shift+B shortcut and Escape to close, listened on window
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

  const stageFiles = (files: Iterable<File>) => {
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
        const existing = new Set(current.map((item) => item.path.toLowerCase()));
        return [...current, ...added.filter((item) => !existing.has(item.path.toLowerCase()))];
      });
      setOperation("ingest");
    } else if (fallbackNames.length > 0) {
      setInputText((current) => [current.trim(), ...fallbackNames].filter(Boolean).join("\n"));
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
    setFloatingOpen(true);
    const { files, folders } = splitTransferredFiles(event.dataTransfer);
    if (files.length + folders.length > 0) {
      stageFiles([...files, ...folders]);
      return;
    }
    const uriList =
      event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain");
    if (uriList.trim().length > 0) {
      setInputText((current) => [current.trim(), uriList.trim()].filter(Boolean).join("\n"));
      setOperation("ingest");
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files ?? []);
    if (files.some((file) => Boolean(window.desktopBridge?.getPathForFile?.(file)))) {
      event.preventDefault();
      stageFiles(files);
    }
  };

  const ensureVaultProjectId = async (target: EnvironmentId): Promise<ProjectId> => {
    const existing = findProjectByPath(
      readProjects().filter((project) => project.environmentId === target),
      vaultPath,
    );
    if (existing) return existing.id;
    const projectId = newProjectId();
    const result = await createProject({
      environmentId: target,
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
    await waitForProject({ environmentId: target, projectId });
    return projectId;
  };

  const hasSendableInput =
    inputText.trim().length > 0 || attachedFiles.length > 0 || operation === "lint";

  const handleSend = async () => {
    if (isSending || !environmentId || !hasSendableInput) return;
    setIsSending(true);
    try {
      const projectId = await ensureVaultProjectId(environmentId);
      const threadId = newThreadId();
      const createdAt = new Date().toISOString();
      const modelSelection = resolveTurnModelSelection({
        projectId,
        serverConfig: appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId),
      });
      const { outgoingText, titleSeed } = buildSecondBrainFloatingTurnPrompt({
        rawText: inputText,
        attachedFiles,
        operation,
        vaultPath,
      });
      const result = await startThreadTurn({
        environmentId,
        input: {
          threadId,
          message: { messageId: newMessageId(), role: "user", text: outgoingText, attachments: [] },
          modelSelection,
          titleSeed,
          runtimeMode: "full-access",
          interactionMode: "default",
          dispatchMode: "auto",
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
          createdAt,
        },
      });
      if (result._tag === "Failure") {
        const error = squashAtomCommandFailure(result);
        throw error instanceof Error ? error : new Error("Invio al Second Brain non riuscito.");
      }
      setJobs((current) =>
        [
          { threadId, operation, title: titleSeed, status: "running" as const, answer: null },
          ...current,
        ].slice(0, MAX_JOBS),
      );
      setInputText("");
      setAttachedFiles([]);
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

  const archive = (threadId: ThreadId) => {
    if (!environmentId) return;
    void archiveThread({ environmentId, input: { threadId } });
  };

  const finishJob = (threadId: ThreadId, status: JobStatus, answer: string | null) => {
    const job = jobs.find((candidate) => candidate.threadId === threadId);
    if (!job || finishedJobs.current.has(threadId)) return;
    finishedJobs.current.add(threadId);
    setJobs((current) =>
      current.map((candidate) =>
        candidate.threadId === threadId ? { ...candidate, status, answer } : candidate,
      ),
    );
    // Successful ingest and lint runs leave nothing to read; failures stay for inspection.
    if (status === "done" && job.operation !== "query") archive(threadId);
  };

  const dismissJob = (job: SecondBrainJob) => {
    setJobs((current) => current.filter((candidate) => candidate.threadId !== job.threadId));
    if (job.status !== "running" && (job.operation === "query" || job.status === "failed")) {
      archive(job.threadId);
    }
  };

  const openJob = (job: SecondBrainJob) => {
    if (!environmentId) return;
    setFloatingOpen(false);
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, job.threadId)),
    });
  };

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void handleSend();
    }
  };

  if (isUsageRoute) return null;

  const activeMeta = PANEL_OPERATIONS.find((item) => item.mode === operation)!;

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files && event.target.files.length > 0) {
            stageFiles(Array.from(event.target.files));
            event.target.value = "";
          }
        }}
      />
      {environmentId
        ? jobs.map((job) =>
            job.status === "running" ? (
              <JobWatcher
                key={job.threadId}
                environmentId={environmentId}
                threadId={job.threadId}
                onFinished={(status, answer) => finishJob(job.threadId, status, answer)}
              />
            ) : null,
          )
        : null}

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
                  aria-label="Apri Second Brain (Ctrl+Shift+B)"
                  className={cn(
                    "flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium shadow-md backdrop-blur-md",
                    isDragActive
                      ? "border-primary bg-primary/20 text-primary"
                      : "border-border/70 bg-background/85 text-foreground hover:border-primary/40",
                  )}
                />
              }
            >
              <BrainIcon className="size-3.5 text-primary" />
              <span>Brain</span>
              {runningCount > 0 ? (
                <Loader2Icon className="size-3 animate-spin text-primary" />
              ) : null}
            </TooltipTrigger>
            <TooltipPopup side="left">Second Brain · trascina qui PDF o link</TooltipPopup>
          </Tooltip>
        </div>
      ) : (
        <section
          data-second-brain-floating=""
          aria-label="Second Brain"
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
            "pointer-events-auto fixed right-3 bottom-14 z-50 flex w-[min(340px,calc(100vw-1.5rem))] flex-col gap-2 rounded-xl border border-border/80 bg-background/95 p-2 shadow-xl backdrop-blur-xl",
            isDragActive && "ring-2 ring-inset ring-primary",
          )}
        >
          <header className="flex items-center gap-1.5 px-0.5">
            <BrainIcon className="size-3.5 text-primary" />
            <span className="flex-1 text-xs font-semibold">Second Brain</span>
            <IconButton label="Apri in Obsidian" onClick={() => openInObsidian(vaultPath)}>
              <ExternalLinkIcon className="size-3.5" />
            </IconButton>
            <IconButton
              label="Apri cartella del vault"
              onClick={() => openVaultInExplorer(vaultPath)}
            >
              <FolderOpenIcon className="size-3.5" />
            </IconButton>
            <IconButton label="Chiudi (Esc)" onClick={() => setFloatingOpen(false)}>
              <XIcon className="size-3.5" />
            </IconButton>
          </header>

          <div role="radiogroup" aria-label="Azione" className="grid grid-cols-3 gap-1">
            {PANEL_OPERATIONS.map((item) => {
              const Icon = item.icon;
              const selected = item.mode === operation;
              return (
                <button
                  key={item.mode}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    setOperation(item.mode);
                    textareaRef.current?.focus();
                  }}
                  className={cn(
                    "flex cursor-pointer flex-col items-center gap-0.5 rounded-lg border px-1 py-1.5 text-2xs font-medium",
                    selected
                      ? "border-primary/50 bg-primary/12 text-primary"
                      : "border-border/60 text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                  {item.label}
                </button>
              );
            })}
          </div>

          {detectedItems.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {detectedItems.map((item) => (
                <span
                  key={item.key}
                  className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-2xs"
                >
                  {renderDetectedIcon(item.kind)}
                  <span className="max-w-52 truncate">{item.label}</span>
                  {item.removableFileId ? (
                    <button
                      type="button"
                      onClick={() =>
                        setAttachedFiles((current) =>
                          current.filter((file) => file.id !== item.removableFileId),
                        )
                      }
                      aria-label={`Rimuovi ${item.label}`}
                      className="cursor-pointer text-muted-foreground hover:text-foreground"
                    >
                      <XIcon className="size-2.5" />
                    </button>
                  ) : null}
                </span>
              ))}
            </div>
          ) : null}

          <div className="flex items-end gap-1 rounded-lg border border-border/80 bg-muted/20 p-1 focus-within:border-primary/60">
            {operation === "ingest" ? (
              <IconButton label="Scegli un file" onClick={() => fileInputRef.current?.click()}>
                <PaperclipIcon className="size-3.5" />
              </IconButton>
            ) : null}
            <textarea
              ref={textareaRef}
              autoFocus
              rows={1}
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
              onPaste={handlePaste}
              onKeyDown={handleInputKeyDown}
              placeholder={activeMeta.placeholder}
              className="max-h-24 min-h-7 flex-1 resize-none bg-transparent px-1 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <button
              type="button"
              disabled={!hasSendableInput || isSending || !environmentId}
              onClick={() => void handleSend()}
              aria-label={`${activeMeta.label} (Invio)`}
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-md",
                hasSendableInput && !isSending && environmentId
                  ? "cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90"
                  : "cursor-not-allowed bg-muted text-muted-foreground opacity-50",
              )}
            >
              {isSending ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <ArrowUpIcon className="size-3.5" />
              )}
            </button>
          </div>

          {jobs.length > 0 ? (
            <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
              {jobs.map((job) => (
                <JobRow
                  key={job.threadId}
                  job={job}
                  vaultPath={vaultPath}
                  onOpen={() => openJob(job)}
                  onDismiss={() => dismissJob(job)}
                />
              ))}
            </ul>
          ) : null}
        </section>
      )}
    </>
  );
}

function IconButton(props: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={props.onClick}
            aria-label={props.label}
            className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="top">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

const FAILED_RUN_STATUSES = new Set(["failed", "cancelled", "interrupted", "rolled_back"]);
const TERMINAL_RUN_STATUSES = new Set(["completed", ...FAILED_RUN_STATUSES]);

/** Watches one job's thread and reports once when its turn ends. Renders nothing. */
function JobWatcher(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly onFinished: (status: JobStatus, answer: string | null) => void;
}) {
  const threadRef = scopeThreadRef(props.environmentId, props.threadId);
  const runtime = useThreadShell(threadRef)?.runtime;
  const projection = useThreadProjection(threadRef)?.projection;
  // Each job owns a fresh thread, so any terminal run status is this job's turn ending.
  const finished =
    !threadRuntimeIsActive(runtime) && TERMINAL_RUN_STATUSES.has(runtime?.status ?? "");
  const status: JobStatus = FAILED_RUN_STATUSES.has(runtime?.status ?? "") ? "failed" : "done";
  const lastAssistant = projection?.messages.findLast((message) => message.role === "assistant");
  const answer = lastAssistant ? stripSecondBrainInstructions(lastAssistant.text).trim() : null;
  const { onFinished } = props;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reports the server-side turn ending to the panel, which archives the thread
  useEffect(() => {
    if (finished) onFinished(status, answer || null);
  }, [finished, status, answer, onFinished]);
  return null;
}

function JobRow(props: {
  readonly job: SecondBrainJob;
  readonly vaultPath: string;
  readonly onOpen: () => void;
  readonly onDismiss: () => void;
}) {
  const { job } = props;
  const label =
    job.status === "running"
      ? job.operation === "query"
        ? "Sto cercando…"
        : job.operation === "lint"
          ? "Riordino in corso…"
          : "Integrazione in corso…"
      : job.status === "done"
        ? job.operation === "query"
          ? "Risposta"
          : "Completato"
        : "Errore";
  return (
    <li className="rounded-lg border border-border/60 bg-muted/20 px-2 py-1.5 text-2xs">
      <div className="flex items-center gap-1.5">
        {job.status === "running" ? (
          <Loader2Icon className="size-3 shrink-0 animate-spin text-primary" />
        ) : job.status === "done" ? (
          <CheckIcon className="size-3 shrink-0 text-success" />
        ) : (
          <XIcon className="size-3 shrink-0 text-destructive" />
        )}
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{label}</span>
          <span className="text-muted-foreground"> · {job.title}</span>
        </span>
        {job.status !== "done" || job.operation === "query" ? (
          <button
            type="button"
            onClick={props.onOpen}
            className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
          >
            Apri
          </button>
        ) : null}
        <button
          type="button"
          onClick={props.onDismiss}
          aria-label="Chiudi"
          className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
        >
          <XIcon className="size-3" />
        </button>
      </div>
      {job.operation === "query" && job.answer ? (
        <div className="mt-1 max-h-48 overflow-y-auto text-xs">
          <ChatMarkdown text={job.answer} cwd={props.vaultPath} />
        </div>
      ) : null}
    </li>
  );
}
