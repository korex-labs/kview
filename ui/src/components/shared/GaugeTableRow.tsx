import React from "react";
import { Box } from "@mui/material";
import InfoHint from "./InfoHint";

export default function GaugeTableRow({
  label,
  hint,
  bar,
  summary,
}: {
  label: string;
  hint?: string;
  bar: React.ReactNode;
  summary: React.ReactNode;
}) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 0.75 }}>
      <Box sx={{ flex: "0 0 28%", fontWeight: 600, fontSize: 14, overflowWrap: "anywhere" }}>
        {hint ? (
          <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
            <span>{label}</span>
            <InfoHint title={hint} />
          </Box>
        ) : (
          label
        )}
      </Box>
      <Box sx={{ flex: "1 1 0", minWidth: 0 }}>
        {bar}
      </Box>
      <Box sx={{ flex: "0 0 24%", textAlign: "right", fontSize: 12, color: "text.secondary", overflowWrap: "anywhere" }}>
        {summary}
      </Box>
    </Box>
  );
}
