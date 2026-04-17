import React from "react";
import { Box } from "@mui/material";
import { GAUGE_BORDER_RADIUS, GAUGE_HEIGHT } from "../../theme/sxTokens";

export default function MetricGauge({
  value,
  color,
  trackColor = "rgba(0,0,0,0.08)",
}: {
  value: number;
  color: string;
  trackColor?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <Box
      sx={{
        position: "relative",
        width: "100%",
        height: GAUGE_HEIGHT,
        borderRadius: GAUGE_BORDER_RADIUS,
        overflow: "hidden",
        border: "1px solid var(--panel-border)",
        backgroundColor: trackColor,
      }}
    >
      <Box
        sx={{
          width: `${clamped}%`,
          height: "100%",
          borderRadius: GAUGE_BORDER_RADIUS,
          backgroundColor: color,
        }}
      />
    </Box>
  );
}
