import { DEFAULT_SECOND_BRAIN_VAULT_PATH } from "../../secondBrainStore";
import { usePrimaryEnvironment } from "../../state/environments";
import { shellEnvironment } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";

/** Opens the vault folder in the system file manager of the primary environment. */
export function useOpenSecondBrainVault(): (vaultPath: string) => void {
  const environmentId = usePrimaryEnvironment()?.environmentId ?? null;
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor);
  return (vaultPath) => {
    if (environmentId === null) return;
    const cwd = vaultPath.trim() || DEFAULT_SECOND_BRAIN_VAULT_PATH;
    void openInEditor({ environmentId, input: { cwd, editor: "file-manager" } });
  };
}
