import React from "react";
import { Box, IconButton, Tooltip } from "@mui/material";
import BuildOutlinedIcon from "@mui/icons-material/BuildOutlined";
import HelpOutlineOutlinedIcon from "@mui/icons-material/HelpOutlineOutlined";

export default function SignalHintIcons({ likelyCause, suggestedAction }: { likelyCause?: string; suggestedAction?: string }) {
  if (!likelyCause && !suggestedAction) return null;
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.25, ml: 0.5, verticalAlign: "middle" }}>
      {likelyCause ? (
        <Tooltip title={`Likely cause: ${likelyCause}`}>
          <IconButton size="small" sx={{ p: 0.2 }}>
            <HelpOutlineOutlinedIcon fontSize="inherit" />
          </IconButton>
        </Tooltip>
      ) : null}
      {suggestedAction ? (
        <Tooltip title={`Next step: ${suggestedAction}`}>
          <IconButton size="small" sx={{ p: 0.2 }}>
            <BuildOutlinedIcon fontSize="inherit" />
          </IconButton>
        </Tooltip>
      ) : null}
    </Box>
  );
}
