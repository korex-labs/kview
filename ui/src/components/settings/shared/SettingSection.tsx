import React from "react";
import { Box, Divider, Paper, Typography } from "@mui/material";
import InfoHint from "../../shared/InfoHint";

/**
 * Standard container for a named group of settings.
 *
 * Applies a max-width cap (default 900 px) so that content does not stretch
 * across very wide viewports. The `actions` slot is right-aligned in the
 * header row and is the canonical place for section-level buttons such as
 * "Add rule" or "Reset section to global".
 */

type Props = {
  title: string;
  icon?: React.ReactNode;
  hint?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: number | string;
  noPaper?: boolean;
};

export default function SettingSection({
  title,
  icon,
  hint,
  actions,
  children,
  maxWidth = 900,
  noPaper = false,
}: Props) {
  const content = (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minHeight: 36 }}>
        {icon ? <Box sx={{ display: "flex", color: "primary.main", mr: 0.25 }}>{icon}</Box> : null}
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        {hint && <InfoHint title={hint} />}
        {actions && <Box sx={{ ml: "auto" }}>{actions}</Box>}
      </Box>
      <Divider />
      {children}
    </Box>
  );

  if (noPaper) {
    return <Box sx={{ maxWidth }}>{content}</Box>;
  }

  return (
    <Paper variant="outlined" sx={{ p: 1.5, maxWidth }}>
      {content}
    </Paper>
  );
}
