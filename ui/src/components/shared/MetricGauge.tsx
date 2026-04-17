import React from "react";
import { Box } from "@mui/material";

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
        height: 18,
        borderRadius: 999,
        overflow: "hidden",
        border: "1px solid var(--panel-border)",
        backgroundColor: trackColor,
      }}
    >
      <Box
        sx={{
          width: `${clamped}%`,
          height: "100%",
          borderRadius: 999,
          backgroundColor: color,
        }}
      />
    </Box>
  );
}
