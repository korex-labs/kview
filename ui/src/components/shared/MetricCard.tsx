import React from "react";
import { Box, Paper, Typography } from "@mui/material";
import { METRIC_CARD_MIN_WIDTH } from "../../theme/sxTokens";
import InfoHint from "./InfoHint";

export default function MetricCard({
  label,
  value,
  color = "default",
  hint,
}: {
  label: string;
  value: React.ReactNode;
  color?: "success" | "warning" | "error" | "info" | "default";
  hint?: string;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, minWidth: METRIC_CARD_MIN_WIDTH, flex: `1 1 ${METRIC_CARD_MIN_WIDTH}px` }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        {hint ? <InfoHint title={hint} /> : null}
      </Box>
      <Typography variant="h5" sx={{ mt: 0.5, color: color === "default" ? undefined : `${color}.main` }}>
        {value}
      </Typography>
    </Paper>
  );
}
