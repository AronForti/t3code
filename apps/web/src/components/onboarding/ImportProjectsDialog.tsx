import type { EnvironmentId, ScopedProjectRef } from "@t3tools/contracts";
import { useState } from "react";
import { create } from "zustand";

import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useProjectScans } from "../../onboarding/useProjectScans";
import { Dialog, DialogTitle } from "../ui/dialog";
import { toastManager } from "../ui/toast";
import { WizardPanel, WizardPopup } from "../ui/wizard";
import { ImportStep, type ImportSelection } from "./WelcomeWizard";

const useImportRequest = create<{ environmentId: EnvironmentId | null }>(() => ({
  environmentId: null,
}));

/** Imports projects and their history from other agents on a computer, after setup too. */
export function openImportProjectsDialog(environmentId: EnvironmentId) {
  useImportRequest.setState({ environmentId });
}

export function ImportProjectsDialogHost() {
  const environmentId = useImportRequest((state) => state.environmentId);
  if (environmentId === null) return null;
  return <ImportProjectsDialog key={environmentId} environmentId={environmentId} />;
}

function ImportProjectsDialog({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const [environmentIds] = useState(() => [environmentId]);
  const scans = useProjectScans(environmentIds);
  // Nothing starts selected: unlike first-run setup, the user came here for specific projects.
  const [importSelection, setImportSelection] = useState<ImportSelection | null>(() => ({
    environmentIds: new Set(environmentIds),
    keys: new Set(),
  }));
  const [isImporting, setIsImporting] = useState(false);
  const openNewThread = useNewThreadHandler();
  const close = () => useImportRequest.setState({ environmentId: null });
  const isLoadingProjects =
    scans.every((scan) => scan.data === null) && scans.some((scan) => scan.isPending);

  const finish = async (
    projectRef?: ScopedProjectRef,
    importWarning?: string,
    importedThreadCount = 0,
  ) => {
    close();
    if (projectRef !== undefined) await openNewThread(projectRef).catch(() => undefined);
    if (importWarning) {
      toastManager.add({
        type: "warning",
        title: "Some history was not imported",
        description: importWarning,
        timeout: 0,
      });
    } else if (importedThreadCount > 0) {
      toastManager.add({
        type: "success",
        title: `Imported ${importedThreadCount} ${importedThreadCount === 1 ? "thread" : "threads"}`,
      });
    }
    return true;
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isImporting) close();
      }}
    >
      <WizardPopup size="wide" bottomStickOnMobile={false}>
        <DialogTitle className="sr-only">Import projects</DialogTitle>
        <WizardPanel holdHeight={isLoadingProjects}>
          <ImportStep
            scans={scans}
            importSelection={importSelection}
            onImportSelectionChange={setImportSelection}
            isImporting={isImporting}
            setIsImporting={setIsImporting}
            onDone={finish}
            skipLabel="Cancel"
          />
        </WizardPanel>
      </WizardPopup>
    </Dialog>
  );
}
