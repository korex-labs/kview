import React, { useEffect, useState } from "react";
import { Alert, Box, Typography } from "@mui/material";
import { requestConnectionRetry, useConnectionState } from "../../connectionState";
import { AppButton } from "./AppActions";

export default function ConnectionBanner() {
  const { health, activeIssue } = useConnectionState();
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  useEffect(() => {
    setDismissedId(null);
  }, [activeIssue?.id]);

  if (health !== "unhealthy" || !activeIssue || dismissedId === activeIssue.id) {
    return null;
  }

  const title =
    activeIssue.kind === "backend"
      ? "Backend unreachable"
      : activeIssue.kind === "cluster"
        ? "Cluster unreachable"
        : "Refresh failed";
  const description =
    activeIssue.kind === "backend"
      ? "The UI cannot reach the kview backend. We'll keep retrying in the background."
      : activeIssue.kind === "cluster"
        ? "The backend cannot reach the active Kubernetes cluster. Actions and automatic refresh should be treated as unavailable until this recovers."
        : "The latest refresh failed. We'll keep retrying in the background.";

  return (
    <Box sx={{ mb: 1 }}>
      <Alert
        severity="error"
        action={
          <Box sx={{ display: "flex", gap: 1 }}>
            <AppButton color="inherit" variant="text" onClick={() => requestConnectionRetry()}>
              Retry now
            </AppButton>
            <AppButton color="inherit" variant="text" onClick={() => setDismissedId(activeIssue.id)}>
              Dismiss
            </AppButton>
          </Box>
        }
      >
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {description}
        </Typography>
      </Alert>
    </Box>
  );
}
