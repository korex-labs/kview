import React from "react";
import { Box, Chip, IconButton, Tooltip } from "@mui/material";
import RestartAltIcon from "@mui/icons-material/RestartAlt";

type Props = {
  state: "inherited" | "overridden";
  onReset?: () => void;
};

export default function ScopeTag({ state, onReset }: Props) {
  if (state === "overridden") {
    return (
      <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.25 }}>
        <Chip
          label="context"
          size="small"
          color="info"
          variant="outlined"
          sx={{ height: 18, fontSize: "0.65rem", "& .MuiChip-label": { px: 0.75 } }}
        />
        {onReset && (
          <Tooltip title="Reset to global">
            <IconButton size="small" onClick={onReset} aria-label="Reset to global" sx={{ p: 0.25 }}>
              <RestartAltIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    );
  }
  return (
    <Chip
      label="global"
      size="small"
      variant="outlined"
      sx={{
        height: 18,
        fontSize: "0.65rem",
        color: "text.disabled",
        borderColor: "divider",
        "& .MuiChip-label": { px: 0.75 },
      }}
    />
  );
}
