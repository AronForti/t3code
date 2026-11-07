import { COMPACT_COMMAND_PATTERN } from "@t3tools/client-runtime/state/context-window";
import { ModelSelection } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { create } from "zustand";

export type SecondBrainOperationMode = "auto" | "query" | "ingest" | "lint";
export type SecondBrainPanelAction = Extract<SecondBrainOperationMode, "ingest" | "query" | "lint">;
/** Per-action model overrides; a missing action uses the vault project's default model. */
export type SecondBrainActionModels = Readonly<
  Partial<Record<SecondBrainPanelAction, ModelSelection>>
>;
export type SecondBrainDetectedContentKind = "pdf" | "video" | "link" | "file";

export interface SecondBrainAttachedFile {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly kind: SecondBrainDetectedContentKind;
}

export interface SecondBrainDetectedItem {
  readonly key: string;
  readonly kind: SecondBrainDetectedContentKind;
  readonly label: string;
  readonly value: string;
  readonly removableFileId?: string;
}

export const DEFAULT_SECOND_BRAIN_VAULT_PATH = "C:\\Users\\aronf\\Documents\\Aron Wiki";
const SECOND_BRAIN_STORAGE_KEY = "t3code:second-brain-v1";

export interface SecondBrainPromptConfig {
  readonly enabled: boolean;
  readonly operation: SecondBrainOperationMode;
  readonly vaultPath: string;
}

interface PersistedSecondBrainState {
  enabled?: boolean;
  operation?: SecondBrainOperationMode;
  vaultPath?: string;
  floatingOperation?: SecondBrainOperationMode;
  actionModels?: unknown;
}

function isSecondBrainOperationMode(value: unknown): value is SecondBrainOperationMode {
  return value === "auto" || value === "query" || value === "ingest" || value === "lint";
}

interface SecondBrainPersistedSnapshot extends SecondBrainPromptConfig {
  readonly floatingOperation: SecondBrainOperationMode;
  readonly actionModels: SecondBrainActionModels;
}

const decodeModelSelection = Schema.decodeUnknownOption(ModelSelection);

function readActionModels(value: unknown): SecondBrainActionModels {
  if (typeof value !== "object" || value === null) return {};
  const models: Partial<Record<SecondBrainPanelAction, ModelSelection>> = {};
  for (const action of ["ingest", "query", "lint"] as const) {
    const decoded = decodeModelSelection((value as Record<string, unknown>)[action]);
    if (decoded._tag === "Some") models[action] = decoded.value;
  }
  return models;
}

function readPersistedSecondBrainState(): SecondBrainPersistedSnapshot {
  if (typeof window === "undefined") {
    return {
      enabled: false,
      operation: "auto",
      vaultPath: DEFAULT_SECOND_BRAIN_VAULT_PATH,
      floatingOperation: "ingest",
      actionModels: {},
    };
  }
  try {
    const raw = window.localStorage.getItem(SECOND_BRAIN_STORAGE_KEY);
    if (!raw) {
      return {
        enabled: false,
        operation: "auto",
        vaultPath: DEFAULT_SECOND_BRAIN_VAULT_PATH,
        floatingOperation: "ingest",
        actionModels: {},
      };
    }
    const parsed = JSON.parse(raw) as PersistedSecondBrainState;
    const vaultPath =
      typeof parsed.vaultPath === "string" && parsed.vaultPath.trim().length > 0
        ? parsed.vaultPath.trim()
        : DEFAULT_SECOND_BRAIN_VAULT_PATH;
    return {
      enabled: Boolean(parsed.enabled),
      operation: isSecondBrainOperationMode(parsed.operation) ? parsed.operation : "auto",
      vaultPath,
      floatingOperation: isSecondBrainOperationMode(parsed.floatingOperation)
        ? parsed.floatingOperation
        : "ingest",
      actionModels: readActionModels(parsed.actionModels),
    };
  } catch {
    return {
      enabled: false,
      operation: "auto",
      vaultPath: DEFAULT_SECOND_BRAIN_VAULT_PATH,
      floatingOperation: "ingest",
      actionModels: {},
    };
  }
}

function writePersistedSecondBrainState(state: SecondBrainPersistedSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      SECOND_BRAIN_STORAGE_KEY,
      JSON.stringify({
        enabled: state.enabled,
        operation: state.operation,
        vaultPath: state.vaultPath,
        floatingOperation: state.floatingOperation,
        actionModels: state.actionModels,
      }),
    );
  } catch {
    // Ignore storage quota or private mode errors.
  }
}

interface SecondBrainStoreState extends SecondBrainPersistedSnapshot {
  readonly floatingOpen: boolean;
  readonly setEnabled: (enabled: boolean) => void;
  readonly toggleEnabled: () => void;
  readonly setOperation: (operation: SecondBrainOperationMode, enableOnSelect?: boolean) => void;
  readonly setVaultPath: (vaultPath: string) => void;
  readonly setFloatingOpen: (open: boolean) => void;
  readonly toggleFloatingOpen: () => void;
  readonly setFloatingOperation: (operation: SecondBrainOperationMode) => void;
  readonly setActionModel: (
    action: SecondBrainPanelAction,
    selection: ModelSelection | null,
  ) => void;
}

function snapshotFromStore(
  state: SecondBrainStoreState,
  overrides: Partial<SecondBrainPersistedSnapshot>,
): SecondBrainPersistedSnapshot {
  return {
    enabled: overrides.enabled ?? state.enabled,
    operation: overrides.operation ?? state.operation,
    vaultPath: overrides.vaultPath ?? state.vaultPath,
    floatingOperation: overrides.floatingOperation ?? state.floatingOperation,
    actionModels: overrides.actionModels ?? state.actionModels,
  };
}

export const useSecondBrainStore = create<SecondBrainStoreState>((set, get) => {
  const initial = readPersistedSecondBrainState();
  return {
    ...initial,
    floatingOpen: false,
    setEnabled: (enabled) => {
      const next = snapshotFromStore(get(), { enabled });
      writePersistedSecondBrainState(next);
      set({ enabled });
    },
    toggleEnabled: () => {
      const enabled = !get().enabled;
      const next = snapshotFromStore(get(), { enabled });
      writePersistedSecondBrainState(next);
      set({ enabled });
    },
    setOperation: (operation, enableOnSelect = true) => {
      const enabled = enableOnSelect ? true : get().enabled;
      const next = snapshotFromStore(get(), { enabled, operation });
      writePersistedSecondBrainState(next);
      set({ enabled, operation });
    },
    setVaultPath: (rawVaultPath) => {
      const vaultPath = rawVaultPath.trim() || DEFAULT_SECOND_BRAIN_VAULT_PATH;
      const next = snapshotFromStore(get(), { vaultPath });
      writePersistedSecondBrainState(next);
      set({ vaultPath });
    },
    setFloatingOpen: (floatingOpen) => {
      set({ floatingOpen });
    },
    toggleFloatingOpen: () => {
      set({ floatingOpen: !get().floatingOpen });
    },
    setFloatingOperation: (floatingOperation) => {
      const next = snapshotFromStore(get(), { floatingOperation });
      writePersistedSecondBrainState(next);
      set({ floatingOperation });
    },
    setActionModel: (action, selection) => {
      const { [action]: _previous, ...rest } = get().actionModels;
      const actionModels = selection === null ? rest : { ...rest, [action]: selection };
      writePersistedSecondBrainState(snapshotFromStore(get(), { actionModels }));
      set({ actionModels });
    },
  };
});

function readSecondBrainPromptConfig(): SecondBrainPromptConfig {
  const { enabled, operation, vaultPath } = useSecondBrainStore.getState();
  return { enabled, operation, vaultPath };
}

const VIDEO_URL_PATTERN =
  /(?:youtube\.com\/(?:watch\?[^\s"<>]*v=|shorts\/|live\/|embed\/)|youtu\.be\/|vimeo\.com\/|loom\.com\/share\/|twitch\.tv\/videos\/|\.(?:mp4|mkv|mov|webm|avi|m4v)(?:[?#][^\s"<>]*)?$)/i;
const PDF_PATTERN = /\.pdf(?:[?#][^\s"<>]*)?$/i;
const VIDEO_EXT_PATTERN = /\.(?:mp4|mkv|mov|webm|avi|m4v|mp3|wav|m4a|flac|ogg)$/i;

export function classifySecondBrainPathOrUrl(value: string): SecondBrainDetectedContentKind {
  const trimmed = value.trim().replace(/^["']|["']$/g, "");
  if (PDF_PATTERN.test(trimmed)) {
    return "pdf";
  }
  if (VIDEO_URL_PATTERN.test(trimmed) || VIDEO_EXT_PATTERN.test(trimmed)) {
    return "video";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return "link";
  }
  return "file";
}

function basenameOfPathOrUrl(value: string): string {
  const cleaned = value.trim().replace(/^["']|["']$/g, "");
  if (/^https?:\/\//i.test(cleaned)) {
    try {
      const url = new URL(cleaned);
      const host = url.hostname.replace(/^www\./i, "");
      const pathPart = url.pathname && url.pathname !== "/" ? url.pathname : "";
      const combined = `${host}${pathPart}`;
      return combined.length > 42 ? `${combined.slice(0, 39)}...` : combined;
    } catch {
      return cleaned.length > 42 ? `${cleaned.slice(0, 39)}...` : cleaned;
    }
  }
  const normalized = cleaned.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments.at(-1) ?? cleaned;
}

export function detectSecondBrainContentItems(
  text: string,
  attachedFiles: ReadonlyArray<SecondBrainAttachedFile> = [],
): ReadonlyArray<SecondBrainDetectedItem> {
  const items: SecondBrainDetectedItem[] = [];
  const seenValues = new Set<string>();

  for (const file of attachedFiles) {
    const normalized = file.path.trim();
    if (!normalized || seenValues.has(normalized.toLowerCase())) continue;
    seenValues.add(normalized.toLowerCase());
    items.push({
      key: `file:${file.id}`,
      kind: file.kind,
      label: file.name || basenameOfPathOrUrl(normalized),
      value: normalized,
      removableFileId: file.id,
    });
  }

  // Detect URLs in text
  const urlRegex = /https?:\/\/[^\s<>"'`]+/gi;
  for (const match of text.matchAll(urlRegex)) {
    const rawUrl = match[0].replace(/[.,;:!?)]+$/, "");
    if (!rawUrl || seenValues.has(rawUrl.toLowerCase())) continue;
    seenValues.add(rawUrl.toLowerCase());
    const kind = classifySecondBrainPathOrUrl(rawUrl);
    items.push({
      key: `url:${rawUrl}`,
      kind,
      label: basenameOfPathOrUrl(rawUrl),
      value: rawUrl,
    });
  }

  // Detect Windows paths or file:// URIs in text (quoted or unquoted with known extensions)
  const quotedWinPathRegex = /"([A-Za-z]:\\[^"\r\n]+)"/g;
  for (const match of text.matchAll(quotedWinPathRegex)) {
    const winPath = match[1]?.trim();
    if (!winPath || seenValues.has(winPath.toLowerCase())) continue;
    seenValues.add(winPath.toLowerCase());
    items.push({
      key: `path:${winPath}`,
      kind: classifySecondBrainPathOrUrl(winPath),
      label: basenameOfPathOrUrl(winPath),
      value: winPath,
    });
  }

  const unquotedWinPathRegex =
    /\b([A-Za-z]:\\(?:[^\s\\/:*?"<>|\r\n]+\\)*[^\s\\/:*?"<>|\r\n]+\.[A-Za-z0-9]{2,6})\b/g;
  for (const match of text.matchAll(unquotedWinPathRegex)) {
    const winPath = match[1]?.trim();
    if (!winPath || seenValues.has(winPath.toLowerCase())) continue;
    seenValues.add(winPath.toLowerCase());
    items.push({
      key: `path:${winPath}`,
      kind: classifySecondBrainPathOrUrl(winPath),
      label: basenameOfPathOrUrl(winPath),
      value: winPath,
    });
  }

  return items;
}

function buildOperationInstructions(
  operation: SecondBrainOperationMode,
  vaultPath: string,
): string {
  switch (operation) {
    case "query":
      return [
        "### Modalità Attiva: LEGGI / QUERY (Consultazione Second Brain)",
        `1. **Parti sempre dall'indice**: leggi prima \`${vaultPath}\\wiki\\index.md\` per identificare le pagine rilevanti.`,
        `2. **Approfondisci nella wiki**: leggi le pagine collegate in \`${vaultPath}\\wiki\\\` (entities, concepts, sources, analyses, decisions, reviews) seguendo i \`[[wikilinks]]\`. Consulta \`${vaultPath}\\raw\\\` solo se servono dettagli testuali non ancora sintetizzati nella wiki.`,
        "3. **Cita le fonti della wiki**: nella risposta indica chiaramente quali pagine della wiki hai consultato.",
        `4. **Capitalizza nuove sintesi**: se la risposta produce una nuova analisi o decisione utile nel tempo, salvala in \`${vaultPath}\\wiki\\analyses\\\` o \`${vaultPath}\\wiki\\decisions\\\`, aggiorna \`${vaultPath}\\wiki\\index.md\` e registra \`## [YYYY-MM-DD] query | <Titolo>\` in \`${vaultPath}\\wiki\\log.md\`.`,
      ].join("\n");
    case "ingest":
      return [
        "### Modalità Attiva: CARICA / INGEST (Integrazione Contenuti nel Second Brain)",
        `1. **Allineamento allo schema**: leggi \`${vaultPath}\\AGENTS.md\` e \`${vaultPath}\\wiki\\index.md\` prima di scrivere.`,
        `2. **Acquisizione multimodale in \`raw/\` (Fonti Immutabili)**:`,
        `   - **PDF o File Locali**: se l'utente fornisce un percorso locale (es. \`.pdf\`, \`.docx\`, \`.md\`, \`.txt\`, \`.csv\`, ecc.), copia il file originale in \`${vaultPath}\\raw\\\` (senza mai modificare o cancellare gli originali), calcola l'hash SHA-256 e registralo in \`${vaultPath}\\wiki\\schema\\source-register.json\`. Per i PDF leggi il documento citando sempre le pagine fisiche ed estrai eventuali testi estesi in \`${vaultPath}\\wiki\\_evidence\\\`.`,
        `   - **Video (YouTube, Vimeo, Loom o file video/audio locali)**: estrai titolo, canale/autore, descrizione e trascrizione/sottotitoli completi (usando \`yt-dlp\`, \`youtube-transcript-api\`, script Python o strumenti disponibili), salva il documento grezzo della fonte/trascrizione in \`${vaultPath}\\raw\\\` e registralo in \`source-register.json\`.`,
        `   - **Link Web / Articoli / Documentazione**: recupera il testo completo della pagina web, salva uno snapshot Markdown/testuale pulito in \`${vaultPath}\\raw\\\` e registralo in \`source-register.json\`.`,
        `3. **Aggiornamento multiprospettiva della wiki**: crea o aggiorna la scheda fonte in \`${vaultPath}\\wiki\\sources\\\` e aggiorna/crea le pagine collegate in \`${vaultPath}\\wiki\\entities\\\`, \`${vaultPath}\\wiki\\concepts\\\`, \`${vaultPath}\\wiki\\analyses\\\` o \`${vaultPath}\\wiki\\decisions\\\` usando frontmatter YAML completo (\`title\`, \`type\`, \`created\`, \`updated\`, \`tags\`, \`sources\`, \`confidence\`, \`status\`, \`summary\`) e \`[[wikilinks]]\` di Obsidian.`,
        `4. **Indice, Log e Verifica**: aggiorna \`${vaultPath}\\wiki\\index.md\`, aggiungi una voce \`## [YYYY-MM-DD] ingest | <Titolo>\` in \`${vaultPath}\\wiki\\log.md\`, ed esegui \`python "${vaultPath}\\tools\\check_wiki.py"\` per verificare l'integrità strutturale.`,
      ].join("\n");
    case "lint":
      return [
        "### Modalità Attiva: RIORDINA / LINT (Manutenzione e Health Check Second Brain)",
        `1. **Controllo automatico**: esegui \`python "${vaultPath}\\tools\\check_wiki.py"\` e leggi \`${vaultPath}\\wiki\\index.md\` e \`${vaultPath}\\wiki\\log.md\`.`,
        "2. **Ispezione qualitativa**: cerca contraddizioni tra pagine, affermazioni superate, pagine orfane (senza link in entrata), concetti menzionati ma privi di pagina propria e wikilink mancanti.",
        `3. **Correzione e Report**: correggi i problemi strutturali sicuri, crea o aggiorna un report in \`${vaultPath}\\wiki\\reviews\\\`, aggiorna \`${vaultPath}\\wiki\\index.md\` e registra \`## [YYYY-MM-DD] lint | <Titolo>\` in \`${vaultPath}\\wiki\\log.md\`.`,
      ].join("\n");
    case "auto":
    default:
      return [
        "### Modalità Attiva: AUTO (Memoria Condivisa Continua: Recupera & Accumula)",
        `1. **Recupero Contesto (Retrieve)**: prima di rispondere o agire, consulta \`${vaultPath}\\wiki\\index.md\` e leggi le pagine pertinenti in \`${vaultPath}\\wiki\\\` per sfruttare il contesto pregresso, le decisioni passate, i progetti, le entità e le preferenze dell'utente.`,
        `2. **Accumulo Conoscenza (Compound)**: se dalla richiesta dell'utente o dal lavoro svolto emergono nuove conoscenze durevoli, decisioni architetturali/operative, nuove fonti, entità, concetti o analisi non banali, aggiorna o crea spontaneamente le pagine in \`${vaultPath}\\wiki\\\` (rispettando il frontmatter YAML e i \`[[wikilinks]]\` definiti in \`${vaultPath}\\AGENTS.md\`).`,
        `3. **Tracciabilità**: ogni volta che crei o modifichi pagine nella wiki, aggiorna \`${vaultPath}\\wiki\\index.md\` e aggiungi una voce \`## [YYYY-MM-DD] ingest|query|lint | <Titolo>\` in \`${vaultPath}\\wiki\\log.md\`.`,
      ].join("\n");
  }
}

function buildSecondBrainInstructionsBlock(config: SecondBrainPromptConfig): string {
  const vaultPath = config.vaultPath.trim() || DEFAULT_SECOND_BRAIN_VAULT_PATH;
  return [
    `<t3_second_brain_instructions mode="${config.operation}" vault="${vaultPath}">`,
    "## T3 Code Second Brain (LLM Wiki & Obsidian Shared Memory)",
    `Hai accesso diretto al Second Brain condiviso dell'utente (vault Obsidian basato sul framework **LLM Wiki** di Andrej Karpathy), situato sul filesystem locale in: \`${vaultPath}\`.`,
    "Questa memoria è condivisa tra tutti gli agenti e tutti i provider di T3 Code (ChatGPT/Codex, Claude, Antigravity, ecc.).",
    "",
    "### Architettura a 3 Livelli del Vault",
    `- **Schema & Regole**: \`${vaultPath}\\AGENTS.md\`, \`${vaultPath}\\wiki\\schema\\config.md\` e \`${vaultPath}\\wiki\\schema\\guida-operativa.md\`.`,
    `- **Raw (\`${vaultPath}\\raw\\\`)**: fonti originali immutabili (sola lettura; non modificare mai file esistenti in \`raw/\`).`,
    `- **Wiki (\`${vaultPath}\\wiki\\\`)**: base di conoscenza Markdown mantenuta dagli agenti LLM e navigabile in Obsidian:`,
    `  - \`${vaultPath}\\wiki\\index.md\`: catalogo principale organizzato per categorie (\`entities/\`, \`concepts/\`, \`sources/\`, \`analyses/\`, \`reviews/\`, \`decisions/\`).`,
    `  - \`${vaultPath}\\wiki\\log.md\`: registro cronologico append-only (\`## [YYYY-MM-DD] ingest|query|lint | Titolo\`).`,
    `  - \`${vaultPath}\\wiki\\schema\\source-register.json\`: registro SHA-256 delle fonti acquisite.`,
    `  - \`${vaultPath}\\tools\\check_wiki.py\`: script di verifica strutturale della wiki.`,
    "",
    buildOperationInstructions(config.operation, vaultPath),
    "</t3_second_brain_instructions>",
  ].join("\n");
}

export function applySecondBrainPromptSuffix(
  text: string,
  config?: SecondBrainPromptConfig | null,
): string {
  const activeConfig = config === undefined ? readSecondBrainPromptConfig() : config;
  if (!activeConfig || !activeConfig.enabled) {
    return text;
  }
  const trimmed = text.trim();
  if (trimmed.length === 0 || COMPACT_COMMAND_PATTERN.test(trimmed)) {
    return text;
  }
  if (trimmed.includes("<t3_second_brain_instructions")) {
    return text;
  }
  return `${text}\n\n${buildSecondBrainInstructionsBlock(activeConfig)}`;
}

export function buildSecondBrainFloatingTurnPrompt(input: {
  readonly rawText: string;
  readonly attachedFiles: ReadonlyArray<SecondBrainAttachedFile>;
  readonly operation: SecondBrainOperationMode;
  readonly vaultPath: string;
}): {
  readonly outgoingText: string;
  readonly titleSeed: string;
} {
  const trimmedText = input.rawText.trim();
  const detectedItems = detectSecondBrainContentItems(trimmedText, input.attachedFiles);
  const effectiveOperation: SecondBrainOperationMode =
    input.operation === "auto" && detectedItems.length > 0 ? "ingest" : input.operation;

  const lines: string[] = [];

  if (effectiveOperation === "ingest") {
    if (input.attachedFiles.length > 0) {
      lines.push("Integra nel Second Brain i seguenti file locali:");
      for (const file of input.attachedFiles) {
        const kindTag =
          file.kind === "pdf" ? "PDF" : file.kind === "video" ? "Video/Audio" : "Documento/File";
        lines.push(`- [${kindTag}] \`${file.path}\``);
      }
      if (trimmedText.length > 0) {
        lines.push("", trimmedText);
      }
    } else if (
      detectedItems.length > 0 &&
      trimmedText.split(/\s+/).length <= detectedItems.length * 2
    ) {
      lines.push(
        "Acquisisci e integra nel Second Brain il seguente contenuto (salva la fonte in `raw/`, aggiorna `wiki/sources/`, `entities/`, `concepts/`, `index.md` e `log.md`):",
        trimmedText,
      );
    } else if (trimmedText.length > 0) {
      lines.push(trimmedText);
    }
  } else if (effectiveOperation === "lint" && trimmedText.length === 0) {
    lines.push(
      "Esegui un Health Check completo del Second Brain (`tools/check_wiki.py`), verifica pagine orfane, link mancanti o contraddizioni e aggiorna `wiki/reviews/`, `wiki/index.md` e `wiki/log.md`.",
    );
  } else {
    lines.push(trimmedText);
  }

  const bodyText = lines.join("\n").trim();
  const firstLabel =
    detectedItems[0]?.label ??
    (trimmedText.length > 0
      ? trimmedText.slice(0, 48)
      : effectiveOperation === "lint"
        ? "Health Check Second Brain"
        : "Second Brain");
  const titleSeed = `🧠 ${firstLabel}`;

  const instructionsBlock = buildSecondBrainInstructionsBlock({
    enabled: true,
    operation: effectiveOperation,
    vaultPath: input.vaultPath,
  });

  return {
    outgoingText: `${bodyText}\n\n${instructionsBlock}`,
    titleSeed,
  };
}
