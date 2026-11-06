import { COMPACT_COMMAND_PATTERN } from "@t3tools/client-runtime/state/context-window";
import { create } from "zustand";

export type SecondBrainOperationMode = "auto" | "query" | "ingest" | "lint";

export const DEFAULT_SECOND_BRAIN_VAULT_PATH = "C:\\Users\\aronf\\Documents\\Aron Wiki";
const SECOND_BRAIN_STORAGE_KEY = "t3code:second-brain-v1";

interface SecondBrainOperationMetadata {
  readonly mode: SecondBrainOperationMode;
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
}

export const SECOND_BRAIN_OPERATIONS: ReadonlyArray<SecondBrainOperationMetadata> = [
  {
    mode: "auto",
    label: "Auto (Memoria Condivisa)",
    shortLabel: "Auto",
    description:
      "Consulta automaticamente la wiki per contesto e aggiorna le pagine quando emergono nuove conoscenze o decisioni.",
  },
  {
    mode: "query",
    label: "Leggi (Query Wiki)",
    shortLabel: "Leggi",
    description:
      "Interroga la wiki partendo da index.md, cita le pagine usate e salva analisi o decisioni rilevanti.",
  },
  {
    mode: "ingest",
    label: "Carica (Ingest Fonte)",
    shortLabel: "Carica",
    description:
      "Integra nuove fonti, note o informazioni nella wiki aggiornando sources, entities, concepts, index.md e log.md.",
  },
  {
    mode: "lint",
    label: "Riordina (Health Check)",
    shortLabel: "Riordina",
    description:
      "Controlla integrità, contraddizioni, pagine orfane e link mancanti con check_wiki.py e aggiorna reviews/.",
  },
] as const;

export interface SecondBrainPromptConfig {
  readonly enabled: boolean;
  readonly operation: SecondBrainOperationMode;
  readonly vaultPath: string;
}

interface PersistedSecondBrainState {
  enabled?: boolean;
  operation?: SecondBrainOperationMode;
  vaultPath?: string;
}

function isSecondBrainOperationMode(value: unknown): value is SecondBrainOperationMode {
  return value === "auto" || value === "query" || value === "ingest" || value === "lint";
}

function readPersistedSecondBrainState(): SecondBrainPromptConfig {
  if (typeof window === "undefined") {
    return {
      enabled: false,
      operation: "auto",
      vaultPath: DEFAULT_SECOND_BRAIN_VAULT_PATH,
    };
  }
  try {
    const raw = window.localStorage.getItem(SECOND_BRAIN_STORAGE_KEY);
    if (!raw) {
      return {
        enabled: false,
        operation: "auto",
        vaultPath: DEFAULT_SECOND_BRAIN_VAULT_PATH,
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
    };
  } catch {
    return {
      enabled: false,
      operation: "auto",
      vaultPath: DEFAULT_SECOND_BRAIN_VAULT_PATH,
    };
  }
}

function writePersistedSecondBrainState(state: SecondBrainPromptConfig): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      SECOND_BRAIN_STORAGE_KEY,
      JSON.stringify({
        enabled: state.enabled,
        operation: state.operation,
        vaultPath: state.vaultPath,
      }),
    );
  } catch {
    // Ignore storage quota or private mode errors.
  }
}

interface SecondBrainStoreState extends SecondBrainPromptConfig {
  readonly setEnabled: (enabled: boolean) => void;
  readonly toggleEnabled: () => void;
  readonly setOperation: (operation: SecondBrainOperationMode, enableOnSelect?: boolean) => void;
  readonly setVaultPath: (vaultPath: string) => void;
}

export const useSecondBrainStore = create<SecondBrainStoreState>((set, get) => {
  const initial = readPersistedSecondBrainState();
  return {
    ...initial,
    setEnabled: (enabled) => {
      const next: SecondBrainPromptConfig = {
        enabled,
        operation: get().operation,
        vaultPath: get().vaultPath,
      };
      writePersistedSecondBrainState(next);
      set({ enabled });
    },
    toggleEnabled: () => {
      const enabled = !get().enabled;
      const next: SecondBrainPromptConfig = {
        enabled,
        operation: get().operation,
        vaultPath: get().vaultPath,
      };
      writePersistedSecondBrainState(next);
      set({ enabled });
    },
    setOperation: (operation, enableOnSelect = true) => {
      const enabled = enableOnSelect ? true : get().enabled;
      const next: SecondBrainPromptConfig = {
        enabled,
        operation,
        vaultPath: get().vaultPath,
      };
      writePersistedSecondBrainState(next);
      set({ enabled, operation });
    },
    setVaultPath: (rawVaultPath) => {
      const vaultPath = rawVaultPath.trim() || DEFAULT_SECOND_BRAIN_VAULT_PATH;
      const next: SecondBrainPromptConfig = {
        enabled: get().enabled,
        operation: get().operation,
        vaultPath,
      };
      writePersistedSecondBrainState(next);
      set({ vaultPath });
    },
  };
});

function readSecondBrainPromptConfig(): SecondBrainPromptConfig {
  const { enabled, operation, vaultPath } = useSecondBrainStore.getState();
  return { enabled, operation, vaultPath };
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
        "### Modalità Attiva: CARICA / INGEST (Integrazione Conoscenza nel Second Brain)",
        `1. **Allineamento allo schema**: leggi \`${vaultPath}\\AGENTS.md\` e \`${vaultPath}\\wiki\\index.md\` prima di scrivere.`,
        `2. **Immutabilità di raw/**: non modificare mai i file originali in \`${vaultPath}\\raw\\\`.`,
        `3. **Aggiornamento multiprospettiva della wiki**: crea o aggiorna la scheda fonte in \`${vaultPath}\\wiki\\sources\\\` (se applicabile) e aggiorna/crea le pagine collegate in \`${vaultPath}\\wiki\\entities\\\`, \`${vaultPath}\\wiki\\concepts\\\`, \`${vaultPath}\\wiki\\analyses\\\` o \`${vaultPath}\\wiki\\decisions\\\` usando frontmatter YAML completo (\`title\`, \`type\`, \`created\`, \`updated\`, \`tags\`, \`sources\`, \`confidence\`, \`status\`, \`summary\`) e \`[[wikilinks]]\` di Obsidian.`,
        `4. **Indice, Log e Verifica**: aggiorna \`${vaultPath}\\wiki\\index.md\`, aggiungi una voce \`## [YYYY-MM-DD] ingest | <Titolo>\` in \`${vaultPath}\\wiki\\log.md\`, aggiorna \`${vaultPath}\\wiki\\schema\\source-register.json\` se la fonte proviene da \`raw/\`, ed esegui \`python "${vaultPath}\\tools\\check_wiki.py"\` se disponibile.`,
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
