import { Chip, Tooltip } from "@mui/material";
import { ScopedCountContent, scopedCountChipSx } from "./ScopedCountChip";
import type { ResourceLiveState } from "../../utils/useResourceLive";
import type { ResourceLiveUpdate } from "../../utils/resourceLive";
import { resourceLiveDisplayState } from "../../utils/useResourceLiveSnapshot";

export default function ResourceLiveControl({ enabled, state, update, appliedRevision, onToggle, description }: {
  description?: string;
  enabled: boolean;
  state: ResourceLiveState;
  update?: ResourceLiveUpdate;
  appliedRevision?: string;
  onToggle: () => void;
}) {
  const display = enabled ? resourceLiveDisplayState(state, update, appliedRevision) : "polling";
  return (
    <Tooltip title={[update?.reason || `Live=${display}`, description].filter(Boolean).join(". ")} describeChild arrow>
      <Chip
        size="small"
        variant="outlined"
        aria-pressed={enabled}
        aria-label={`Live=${display}; ${enabled ? "disable Live and resume polling" : "enable Live"}`}
        label={<ScopedCountContent label="Live" count={display} size="small" />}
        onClick={onToggle}
        sx={scopedCountChipSx(!enabled ? "default" : display === "live" ? "success" : display === "blocked" ? "error" : "warning", "outlined", "default")}
      />
    </Tooltip>
  );
}
