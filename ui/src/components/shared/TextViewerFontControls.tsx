import React from "react";
import { Box } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import { AppIconButton } from "./AppActions";
import type { useTextViewerFontSize } from "./useTextViewerFontSize";
import { DEFAULT_TEXT_VIEWER_FONT_SIZE_PX, MIN_TEXT_VIEWER_FONT_SIZE_PX, MAX_TEXT_VIEWER_FONT_SIZE_PX } from "../../textViewerPreferences";

// Room to scroll the final line above the overlay, including scrollbar clearance.
export const TEXT_VIEWER_TAIL_PADDING = "52px";

/** A viewport-anchored overlay; callers apply tail padding to their scroll body. */
export function TextViewerFrame({ children, zoom, enabled = true }: {
  children: React.ReactNode;
  zoom: ReturnType<typeof useTextViewerFontSize>;
  enabled?: boolean;
}) {
  return (
    <Box sx={{ position: "relative", display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden",
    }}>
      {children}
      {enabled && <TextViewerFontControls {...zoom} />}
    </Box>
  );
}
export default function TextViewerFontControls({ fontSize, decrease, increase, reset }: ReturnType<typeof useTextViewerFontSize>) {
  return (
    <Box role="group" aria-label="Text viewer font size" sx={{ position: "absolute", right: 20, bottom: 20, zIndex: 2, display: "flex", alignItems: "center", gap: 0.25,
      fontSize: "14px", lineHeight: 1, bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: 1,
      "& .MuiIconButton-root": { width: 28, height: 28 },
    }}>
      <AppIconButton label="Decrease text size" tooltip="Decrease text size" onClick={decrease} disabled={fontSize <= MIN_TEXT_VIEWER_FONT_SIZE_PX}>
        <RemoveIcon fontSize="small" />
      </AppIconButton>
      <AppIconButton label="Increase text size" tooltip="Increase text size" onClick={increase} disabled={fontSize >= MAX_TEXT_VIEWER_FONT_SIZE_PX}>
        <AddIcon fontSize="small" />
      </AppIconButton>
      <AppIconButton label="Reset text size" tooltip={`Reset text size to ${DEFAULT_TEXT_VIEWER_FONT_SIZE_PX} px`} onClick={reset} disabled={fontSize === DEFAULT_TEXT_VIEWER_FONT_SIZE_PX}>
        <RestartAltIcon fontSize="small" />
      </AppIconButton>
    </Box>
  );
}
