import React from "react";
import { Box, LinearProgress, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import type { Theme } from "@mui/material/styles";
import { GAUGE_BORDER_RADIUS, GAUGE_HEIGHT, GAUGE_TRACK_BG } from "../../theme/sxTokens";

export type GaugeTone = "success" | "warning" | "error" | "info" | "primary" | "default";

function gaugeColor(theme: Theme, tone: GaugeTone): string {
  switch (tone) {
    case "success":
      return theme.palette.success.main;
    case "warning":
      return theme.palette.warning.main;
    case "error":
      return theme.palette.error.main;
    case "info":
      return theme.palette.info.main;
    case "primary":
      return theme.palette.primary.main;
    default:
      return theme.palette.text.secondary;
  }
}

export default function GaugeBar({
  value,
  tone = "success",
  label,
  height = GAUGE_HEIGHT,
}: {
  value: number;
  tone?: GaugeTone;
  label?: React.ReactNode;
  height?: number;
}) {
  const theme = useTheme();
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const color = gaugeColor(theme, tone);

  return (
    <Box sx={{ position: "relative", display: "flex", alignItems: "center" }}>
      <LinearProgress
        variant="determinate"
        value={clamped}
        sx={{
          width: "100%",
          height,
          borderRadius: GAUGE_BORDER_RADIUS,
          border: "1px solid var(--panel-border)",
          backgroundColor: GAUGE_TRACK_BG,
          "& .MuiLinearProgress-bar": {
            backgroundColor: color,
            borderRadius: GAUGE_BORDER_RADIUS,
          },
        }}
      />
      {label != null ? (
        <Typography
          variant="caption"
          sx={{
            position: "absolute",
            width: "100%",
            textAlign: "center",
            fontSize: 12,
            fontWeight: 600,
            color: clamped >= 50 ? theme.palette.getContrastText(color) : "text.primary",
            lineHeight: `${height}px`,
          }}
        >
          {label}
        </Typography>
      ) : null}
    </Box>
  );
}
