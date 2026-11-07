import { BrainIcon } from "lucide-react";
import { memo } from "react";

import { useSecondBrainStore } from "../../secondBrainStore";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerControl, ComposerControlIcon, type ComposerControlSize } from "./ComposerControl";

/** On/off only; mode and vault live in the Second Brain panel. */
export const ComposerSecondBrainControl = memo(function ComposerSecondBrainControl(props: {
  size?: ComposerControlSize;
}) {
  const size = props.size ?? "sm";
  const enabled = useSecondBrainStore((state) => state.enabled);
  const toggleEnabled = useSecondBrainStore((state) => state.toggleEnabled);
  const label = enabled ? "Disattiva Second Brain" : "Attiva Second Brain";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ComposerControl
            size={size}
            type="button"
            data-chat-composer-second-brain="true"
            aria-pressed={enabled}
            aria-label={label}
            onClick={toggleEnabled}
            className={cn("shrink-0", enabled && "bg-primary/14! text-primary")}
          />
        }
      >
        <ComposerControlIcon
          icon={BrainIcon}
          size={size}
          className={cn(enabled && "text-primary opacity-100")}
        />
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
});
