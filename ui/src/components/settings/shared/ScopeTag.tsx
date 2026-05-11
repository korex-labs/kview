import React from "react";
import { Box, Chip, Tooltip } from "@mui/material";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import { AppIconButton } from "../../shared/AppActions";

type Props = {
  state: "inherited" | "overridden";
  onReset?: () => void;
  tooltip?: string;
};

export default function ScopeTag({ state, onReset, tooltip }: Props) {
  if (state === "overridden") {
    const chip = (
      <Chip
        label="custom"
        size="small"
        color="info"
        variant="outlined"
        sx={{ height: 18, fontSize: "0.65rem", "& .MuiChip-label": { px: 0.75 } }}
      />
    );
    return (
      <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.25 }}>
        {tooltip ? <Tooltip title={tooltip}>{chip}</Tooltip> : chip}
        {onReset && (
          <AppIconButton tooltip="Reset to global" label="Reset to global" onClick={onReset} sx={{ p: 0.25 }}>
            <RestartAltIcon sx={{ fontSize: 14 }} />
          </AppIconButton>
        )}
      </Box>
    );
  }
  return null;
}
