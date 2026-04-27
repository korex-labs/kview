import React from "react";
import { Box } from "@mui/material";

/**
 * Responsive grid layout for settings fields.
 *
 * Variants:
 *   "two"  — two equal columns; good for paired fields.
 *   "three" — three equal columns; good for TTL grids (caps at 3 on wide screens).
 *   "auto"  — auto-fit with a 220 px minimum; good for mixed-width content.
 *
 * Using a fixed variant instead of freeform gridTemplateColumns prevents the
 * 22-field TTL grid from spreading across 8+ columns on large monitors.
 */

const columnTemplates: Record<string, string> = {
  two: "repeat(2, 1fr)",
  three: "repeat(3, 1fr)",
  auto: "repeat(auto-fit, minmax(220px, 1fr))",
};

type Props = {
  variant?: "two" | "three" | "auto";
  children: React.ReactNode;
};

export default function SettingGrid({ variant = "auto", children }: Props) {
  return (
    <Box
      sx={{
        display: "grid",
        gap: 1,
        gridTemplateColumns: columnTemplates[variant],
      }}
    >
      {children}
    </Box>
  );
}
