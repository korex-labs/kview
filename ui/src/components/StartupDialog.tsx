import React from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Typography,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import HourglassTopIcon from "@mui/icons-material/HourglassTop";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";

export type StartupStepStatus = "pending" | "active" | "done" | "error";

export type StartupStep = {
  id: string;
  label: string;
  detail?: string;
  status: StartupStepStatus;
};

export type StartupKubeconfigInfo = {
  files?: string[];
  explicitlySet?: boolean;
  defaultPath?: string;
};

type Props = {
  open: boolean;
  mode: "loading" | "no-context" | "error";
  title?: string;
  message?: string;
  steps?: StartupStep[];
  kubeconfig?: StartupKubeconfigInfo | null;
  onRetry?: () => void;
};

function StepIcon({ status }: { status: StartupStepStatus }) {
  if (status === "done") return <CheckCircleIcon color="success" fontSize="small" />;
  if (status === "error") return <ErrorOutlineIcon color="error" fontSize="small" />;
  if (status === "active") return <CircularProgress size={18} />;
  return <RadioButtonUncheckedIcon color="disabled" fontSize="small" />;
}

function KubeconfigDetails({ kubeconfig }: { kubeconfig?: StartupKubeconfigInfo | null }) {
  const files = kubeconfig?.files || [];
  const defaultPath = kubeconfig?.defaultPath || "~/.kube/config";
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Typography variant="body2" color="text.secondary">
        kview checks `--config` first, then `KUBECONFIG`, then the default kubeconfig path.
      </Typography>
      <Box
        component="dl"
        sx={{
          m: 0,
          display: "grid",
          gridTemplateColumns: "max-content minmax(0, 1fr)",
          gap: 0.75,
          fontSize: 13,
        }}
      >
        <Typography component="dt" variant="caption" color="text.secondary">
          Source
        </Typography>
        <Typography component="dd" variant="caption" sx={{ m: 0 }}>
          {kubeconfig?.explicitlySet ? "Explicit config path" : "Default config path"}
        </Typography>
        <Typography component="dt" variant="caption" color="text.secondary">
          Default
        </Typography>
        <Typography component="dd" variant="caption" sx={{ m: 0, wordBreak: "break-all" }}>
          {defaultPath}
        </Typography>
        <Typography component="dt" variant="caption" color="text.secondary">
          Files
        </Typography>
        <Typography component="dd" variant="caption" sx={{ m: 0, wordBreak: "break-all" }}>
          {files.length ? files.join(", ") : "No readable kubeconfig files were found"}
        </Typography>
      </Box>
    </Box>
  );
}

export default function StartupDialog({
  open,
  mode,
  title,
  message,
  steps = [],
  kubeconfig,
  onRetry,
}: Props) {
  const loading = mode === "loading";
  return (
    <Dialog
      open={open}
      maxWidth="sm"
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: 1, border: "1px solid", borderColor: "divider" } } }}
    >
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
        {loading ? <HourglassTopIcon color="primary" /> : <ErrorOutlineIcon color="warning" />}
        {title || (loading ? "Starting kview" : "No kube context available")}
      </DialogTitle>
      {loading ? <LinearProgress /> : null}
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        {message ? (
          <Typography variant="body2" color="text.secondary">
            {message}
          </Typography>
        ) : null}
        {steps.length ? (
          <List dense disablePadding>
            {steps.map((step) => (
              <ListItem key={step.id} disableGutters sx={{ alignItems: "flex-start" }}>
                <ListItemIcon sx={{ minWidth: 32, pt: 0.25 }}>
                  <StepIcon status={step.status} />
                </ListItemIcon>
                <ListItemText
                  primary={step.label}
                  secondary={step.detail}
                  slotProps={{ primary: { variant: "body2" }, secondary: { variant: "caption" } }}
                />
              </ListItem>
            ))}
          </List>
        ) : null}
        {mode === "no-context" ? (
          <Alert severity="warning" variant="outlined">
            No Kubernetes contexts were loaded. Check `KUBECONFIG`, pass `--config`, or create a context in the
            default kubeconfig.
          </Alert>
        ) : null}
        {mode === "error" ? (
          <Alert severity="error" variant="outlined">
            Startup did not complete. Check the backend log or retry after fixing the cluster/config issue.
          </Alert>
        ) : null}
        {!loading ? <KubeconfigDetails kubeconfig={kubeconfig} /> : null}
      </DialogContent>
      {!loading && onRetry ? (
        <DialogActions>
          <Button onClick={onRetry} variant="contained">
            Retry
          </Button>
        </DialogActions>
      ) : null}
    </Dialog>
  );
}
