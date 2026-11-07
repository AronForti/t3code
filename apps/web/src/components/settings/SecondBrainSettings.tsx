import type { ModelSelection } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { useNavigate } from "@tanstack/react-router";

import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  providerInstanceEntriesFor,
  resolveDefaultProviderModelSelection,
  resolveProjectDefaultProviderModelSelection,
} from "../../providerInstances";
import { type SecondBrainPanelAction, useSecondBrainStore } from "../../secondBrainStore";
import { useEnvironmentProviders } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { useScopedSettings } from "./useScopedSettings";

const ACTIONS: ReadonlyArray<{
  readonly action: SecondBrainPanelAction;
  readonly title: string;
  readonly description: string;
}> = [
  {
    action: "ingest",
    title: "Integra fonte",
    description: "Legge PDF, link e video e aggiorna le pagine della wiki.",
  },
  {
    action: "query",
    title: "Chiedi al brain",
    description: "Risponde alle domande consultando la wiki.",
  },
  {
    action: "lint",
    title: "Riordina wiki",
    description: "Controlla link, pagine orfane e incoerenze con check_wiki.py.",
  },
];

export function SecondBrainSettingsPanel() {
  return (
    <SettingsPageContainer>
      <SettingsSection id="second-brain-models" title="Modelli per azione">
        {ACTIONS.map((item) => (
          <ActionModelRow key={item.action} {...item} />
        ))}
      </SettingsSection>
    </SettingsPageContainer>
  );
}

function ActionModelRow(props: {
  readonly action: SecondBrainPanelAction;
  readonly title: string;
  readonly description: string;
}) {
  const navigate = useNavigate();
  const { target } = useSettingsScope();
  const settings = useScopedSettings();
  const providersByEnvironment = useEnvironmentProviders();
  const environmentId = target?.environmentId ?? null;
  const providers =
    (environmentId ? providersByEnvironment.get(environmentId) : undefined) ??
    EMPTY_SERVER_PROVIDERS;
  const stored = useSecondBrainStore((state) => state.actionModels[props.action]);
  const setActionModel = useSecondBrainStore((state) => state.setActionModel);

  const available = stored ? resolveDefaultProviderModelSelection(providers, stored) : null;
  const usable = available?.instanceId === stored?.instanceId ? available : null;
  const selection =
    usable ?? resolveProjectDefaultProviderModelSelection(providers, settings, null);
  const entries = providerInstanceEntriesFor(providers, settings, null);
  const activeEntry = entries.find((entry) => entry.instanceId === selection?.instanceId);
  const modelOptions = getCustomModelOptionsByInstance(
    settings,
    providers,
    selection?.instanceId,
    selection?.model,
  );
  const set = (value: ModelSelection | null) => setActionModel(props.action, value);

  return (
    <SettingsRow
      title={props.title}
      description={props.description}
      status={
        stored === undefined
          ? "Usa il modello predefinito del progetto Aron Wiki."
          : usable === null
            ? "Il provider scelto non è disponibile: viene usato il modello del progetto."
            : null
      }
      resetAction={
        stored !== undefined ? (
          <SettingResetButton label="modello" onClick={() => set(null)} />
        ) : null
      }
      control={
        selection && activeEntry ? (
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            <ProviderModelPicker
              environmentId={environmentId}
              activeInstanceId={selection.instanceId}
              model={selection.model}
              lockedProvider={null}
              instanceEntries={entries}
              modelOptionsByInstance={modelOptions}
              triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
              onOpenProviderSetup={(instanceId) => {
                if (environmentId)
                  void navigate({
                    to: "/settings/providers",
                    search: { environmentId, instanceId },
                  });
              }}
              onInstanceModelChange={(instanceId, model) =>
                set(createModelSelection(instanceId, model))
              }
            />
            <TraitsPicker
              provider={activeEntry.driverKind}
              models={activeEntry.models}
              model={selection.model}
              modelOptions={selection.options ?? []}
              allowPromptInjectedEffort={false}
              planModeEnabled={settings.planModeEnabled}
              triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
              onModelOptionsChange={(options) =>
                set(createModelSelection(selection.instanceId, selection.model, options))
              }
            />
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">Nessun provider disponibile</span>
        )
      }
    />
  );
}
