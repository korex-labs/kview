import React from "react";
import { Box } from "@mui/material";
import { GridOverlay } from "@mui/x-data-grid";
import type { ApiError } from "../../api";
import AccessDeniedState from "./AccessDeniedState";
import EmptyState from "./EmptyState";
import ErrorState from "./ErrorState";

type ListStateOverlayProps = {
  error: ApiError | null;
  emptyMessage: string;
  filteredEmptyMessage?: string;
  rowCount?: number;
  filter?: string;
  resourceLabel?: string;
  accessDenied?: boolean;
};

export default function ListStateOverlay({
  error,
  emptyMessage,
  filteredEmptyMessage,
  rowCount = 0,
  filter = "",
  resourceLabel,
  accessDenied,
}: ListStateOverlayProps) {
  const isAccessDenied = accessDenied || error?.status === 401 || error?.status === 403;
  const status = accessDenied ? 403 : error?.status;
  const hasFilter = filter.trim() !== "";
  const isFilteredEmpty = !error && !isAccessDenied && rowCount > 0 && hasFilter;
  const message = isFilteredEmpty
    ? (filteredEmptyMessage || `No ${resourceLabel || "resources"} match the current filter.`)
    : emptyMessage;
  return (
    <GridOverlay sx={{ p: 2, alignItems: "flex-start", justifyContent: "flex-start" }}>
      <Box sx={{ maxWidth: 520 }}>
        {isAccessDenied ? (
          <AccessDeniedState status={status} resourceLabel={resourceLabel} />
        ) : error ? (
          <ErrorState message={error.message} />
        ) : (
          <EmptyState message={message} />
        )}
      </Box>
    </GridOverlay>
  );
}
