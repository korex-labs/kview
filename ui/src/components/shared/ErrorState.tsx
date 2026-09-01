import React from "react";
import { Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import AccessDeniedState from "./AccessDeniedState";
import EmptyState from "./EmptyState";

type ErrorStateProps = {
  message: string;
  status?: number;
  notFoundMessage?: string;
  sx?: SxProps<Theme>;
};

export default function ErrorState({ message, status, notFoundMessage, sx }: ErrorStateProps) {
  const normalized = message.trim().toLowerCase();
  if (status === 401 || status === 403 || (status === undefined && (normalized.includes("forbidden") || normalized.includes("unauthorized")))) {
    const accessStatus = status === 401 || normalized.includes("unauthorized") ? 401 : 403;
    return <AccessDeniedState status={accessStatus} sx={sx} />;
  }
  if (status === 404 || (status === undefined && (normalized.includes("not found") || normalized.includes("notfound")))) {
    return (
      <EmptyState
        message={notFoundMessage || "This resource is no longer available. It may have been deleted or replaced since the list was last refreshed."}
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
