import React from "react";
import { Box } from "@mui/material";
import BuildOutlinedIcon from "@mui/icons-material/BuildOutlined";
import HelpOutlineOutlinedIcon from "@mui/icons-material/HelpOutlineOutlined";
import { AppIconButton } from "./AppActions";

export default function SignalHintIcons({ likelyCause, suggestedAction }: { likelyCause?: string; suggestedAction?: string }) {
  if (!likelyCause && !suggestedAction) return null;
  return (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.25, ml: 0.5, verticalAlign: "middle" }}>
      {likelyCause ? (
        <AppIconButton tooltip={`Likely cause: ${likelyCause}`} label="Likely cause" sx={{ p: 0.2 }}>
          <HelpOutlineOutlinedIcon fontSize="inherit" />
        </AppIconButton>
      ) : null}
      {suggestedAction ? (
        <AppIconButton tooltip={`Next step: ${suggestedAction}`} label="Suggested action" sx={{ p: 0.2 }}>
          <BuildOutlinedIcon fontSize="inherit" />
        </AppIconButton>
      ) : null}
    </Box>
  );
}
