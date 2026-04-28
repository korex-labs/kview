import React from "react";
import { Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import AccessDeniedState from "./AccessDeniedState";
import EmptyState from "./EmptyState";

type ErrorStateProps = {
  message: string;
  sx?: SxProps<Theme>;
};

export default function ErrorState({ message, sx }: ErrorStateProps) {
  const normalized = message.trim().toLowerCase();
  if (normalized.includes("forbidden") || normalized.includes("unauthorized")) {
    const status = normalized.includes("unauthorized") ? 401 : 403;
    return <AccessDeniedState status={status} sx={sx} />;
  }
  if (normalized.includes("not found") || normalized.includes("notfound")) {
    return (
      <EmptyState
        message="This resource is no longer available. It may have been deleted or replaced since the list was last refreshed."
        sx={sx}
      />
    );
  }
  return (
    <Typography color="error" sx={{ whiteSpace: "pre-wrap", ...sx }}>
      {message}
    </Typography>
  );
}
