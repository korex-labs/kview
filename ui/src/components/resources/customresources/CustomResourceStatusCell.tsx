import React from "react";
import { Box, Tooltip } from "@mui/material";
import ListSignalChip from "../../shared/ListSignalChip";

export default function CustomResourceStatusCell({
  severity,
  summary,
}: {
  severity?: string | null;
  summary?: string | null;
}) {
  const text = String(summary || "").trim();
  const chip = <ListSignalChip severity={severity} />;
  if (!text) {
    return <Box sx={{ display: "flex", alignItems: "center", height: "100%" }}>{chip}</Box>;
  }
  return (
    <Tooltip title={text}>
      <Box sx={{ display: "flex", alignItems: "center", height: "100%", minWidth: 0 }}>
        {chip}
      </Box>
    </Tooltip>
  );
}
