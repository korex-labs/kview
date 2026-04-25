import React from "react";
import { Box, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";

type AccessDeniedStateProps = {
  status?: number;
  resourceLabel?: string;
  message?: string;
  sx?: SxProps<Theme>;
};

function buildMessage(status?: number, resourceLabel?: string) {
  const subject = resourceLabel ? resourceLabel : "this resource";
  if (status === 401) {
    return `Unauthorized: you are not authenticated or your session expired. Unable to list ${subject}.`;
  }
  if (status === 403) {
    return `Forbidden: you don't have permission to list ${subject}.`;
  }
  return `Access denied: unable to list ${subject}.`;
}

export default function AccessDeniedState({ status, resourceLabel, message, sx }: AccessDeniedStateProps) {
  return (
    <Box sx={sx}>
      <Typography variant="body2">{message || buildMessage(status, resourceLabel)}</Typography>
      <Typography variant="caption" color="text.secondary">
        Ask your cluster admin for get/list permissions.
      </Typography>
    </Box>
  );
}
