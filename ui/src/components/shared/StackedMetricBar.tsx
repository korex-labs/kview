import React from "react";
import { Box, Tooltip } from "@mui/material";
import { GAUGE_BORDER_RADIUS, GAUGE_HEIGHT } from "../../theme/sxTokens";

export type BarSegment = {
  label: string;
  value: number;
  color: string;
};

export default function StackedMetricBar({ segments }: { segments: BarSegment[] }) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value || 0), 0);
  if (total <= 0) {
    return (
      <Box
        sx={{
          height: GAUGE_HEIGHT,
          borderRadius: GAUGE_BORDER_RADIUS,
          border: "1px solid var(--panel-border)",
          backgroundColor: "rgba(0,0,0,0.05)",
        }}
      />
    );
  }
  return (
    <Box
      sx={{
        display: "flex",
        width: "100%",
        height: GAUGE_HEIGHT,
        overflow: "hidden",
        borderRadius: GAUGE_BORDER_RADIUS,
        border: "1px solid var(--panel-border)",
        backgroundColor: "rgba(0,0,0,0.04)",
      }}
    >
      {segments
        .filter((segment) => segment.value > 0)
        .map((segment) => (
          <Tooltip key={segment.label} title={`${segment.label}: ${segment.value}`}>
            <Box
              sx={{
                width: `${(segment.value / total) * 100}%`,
                backgroundColor: segment.color,
                minWidth: segment.value > 0 ? 8 : 0,
              }}
            />
          </Tooltip>
        ))}
    </Box>
  );
}
