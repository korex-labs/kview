import React from "react";
import { Box, Chip, Typography } from "@mui/material";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";

export type Warning = {
  message: string;
  detail?: string;
};

type WarningsSectionProps = {
  warnings: Warning[];
};

/**
 * WarningsSection displays a list of advisory soft warnings.
 * Returns null if there are no warnings (no empty box shown).
 * Warnings are non-blocking, informational insights derived from resource state.
 */
export default function WarningsSection({ warnings }: WarningsSectionProps) {
  if (warnings.length === 0) return null;

  return (
    <Box
      sx={{
        border: "1px solid var(--chip-warning-border)",
        borderRadius: 2,
        p: 1.5,
        backgroundColor: "var(--chip-warning-bg)",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
        <WarningAmberIcon sx={{ color: "warning.main", fontSize: 20 }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          Warnings
        </Typography>
        <Chip size="small" color="warning" label="Advisory" />
      </Box>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
        {warnings.map((w, idx) => (
          <Box key={idx}>
            <Typography variant="body2" sx={{ color: "text.primary" }}>
              {w.message}
            </Typography>
            {w.detail && (
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {w.detail}
              </Typography>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
