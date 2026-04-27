import React from "react";
import { Box, Typography } from "@mui/material";

/**
 * Visual container for a set of fields that only appear together under a
 * specific condition (e.g. action type = "patch" reveals patch-only inputs).
 *
 * A left border and subtle indent give the group a visual identity without
 * adding heavy chrome. An optional `label` names the group.
 */

type Props = {
  label?: string;
  children: React.ReactNode;
};

export default function FieldGroup({ label, children }: Props) {
  return (
    <Box
      sx={{
        borderLeft: "2px solid",
        borderColor: "divider",
        pl: 1.5,
        display: "flex",
        flexDirection: "column",
        gap: 1,
      }}
    >
      {label && (
        <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 500 }}>
          {label}
        </Typography>
      )}
      {children}
    </Box>
  );
}
