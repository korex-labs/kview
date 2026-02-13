import React, { useCallback, useEffect, useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Typography,
  CircularProgress,
  Alert,
  Tooltip,
} from "@mui/material";
import { apiPostWithContext, toApiError } from "../api";
import { useActiveContext } from "../activeContext";

type Capabilities = {
  delete: boolean;
  update: boolean;
  patch: boolean;
  create: boolean;
};

type Props = {
  token: string;
  namespace: string;
  deploymentName: string;
  currentReplicas: number;
  onRefresh: () => void;
  onDeleted: () => void;
};

export default function DeploymentActions({
  token,
  namespace,
  deploymentName,
  currentReplicas,
  onRefresh,
  onDeleted,
}: Props) {
  const activeContext = useActiveContext();
  const [caps, setCaps] = useState<Capabilities | null>(null);

  const [scaleOpen, setScaleOpen] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Fetch capabilities
  useEffect(() => {
    if (!activeContext || !deploymentName) return;
    setCaps(null);
    apiPostWithContext<{ capabilities: Capabilities }>(
      "/api/capabilities",
      token,
      activeContext,
      { group: "apps", resource: "deployments", namespace, name: deploymentName },
    )
      .then((res) => setCaps(res.capabilities))
      .catch(() => setCaps({ delete: false, update: false, patch: false, create: false }));
  }, [activeContext, token, namespace, deploymentName]);

  const canScale = caps ? caps.patch || caps.update : false;
  const canRestart = caps ? caps.patch || caps.update : false;
  const canDelete = caps ? caps.delete : false;

  return (
    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
      <Tooltip title={!canScale && caps ? "Not permitted by RBAC" : ""}>
        <span>
          <Button
            size="small"
            variant="outlined"
            disabled={!canScale}
            onClick={() => setScaleOpen(true)}
          >
            Scale
          </Button>
        </span>
      </Tooltip>

      <Tooltip title={!canRestart && caps ? "Not permitted by RBAC" : ""}>
        <span>
          <Button
            size="small"
            variant="outlined"
            disabled={!canRestart}
            onClick={() => setRestartOpen(true)}
          >
            Restart
          </Button>
        </span>
      </Tooltip>

      <Tooltip title={!canDelete && caps ? "Not permitted by RBAC" : ""}>
        <span>
          <Button
            size="small"
            variant="outlined"
            color="error"
            disabled={!canDelete}
            onClick={() => setDeleteOpen(true)}
          >
            Delete
          </Button>
        </span>
      </Tooltip>

      <ScaleDialog
        open={scaleOpen}
        onClose={() => setScaleOpen(false)}
        token={token}
        activeContext={activeContext}
        namespace={namespace}
        deploymentName={deploymentName}
        currentReplicas={currentReplicas}
        onSuccess={() => { setScaleOpen(false); onRefresh(); }}
      />

      <RestartDialog
        open={restartOpen}
        onClose={() => setRestartOpen(false)}
        token={token}
        activeContext={activeContext}
        namespace={namespace}
        deploymentName={deploymentName}
        onSuccess={() => { setRestartOpen(false); onRefresh(); }}
      />

      <DeleteDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        token={token}
        activeContext={activeContext}
        namespace={namespace}
        deploymentName={deploymentName}
        onSuccess={() => { setDeleteOpen(false); onDeleted(); }}
      />
    </Box>
  );
}

// --- Scale Dialog ---

function ScaleDialog(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  activeContext: string;
  namespace: string;
  deploymentName: string;
  currentReplicas: number;
  onSuccess: () => void;
}) {
  const [replicas, setReplicas] = useState(String(props.currentReplicas));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (props.open) {
      setReplicas(String(props.currentReplicas));
      setError("");
    }
  }, [props.open, props.currentReplicas]);

  const parsed = parseInt(replicas, 10);
  const valid = !isNaN(parsed) && parsed >= 0 && String(parsed) === replicas.trim();

  async function handleConfirm() {
    if (!valid) return;
    setBusy(true);
    setError("");
    try {
      await apiPostWithContext("/api/actions", props.token, props.activeContext, {
        group: "apps",
        resource: "deployments",
        namespace: props.namespace,
        name: props.deploymentName,
        action: "scale",
        params: { replicas: parsed },
      });
      props.onSuccess();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={props.open} onClose={props.onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Scale Deployment</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>
          Set replicas for <strong>{props.deploymentName}</strong>
        </Typography>
        <TextField
          autoFocus
          fullWidth
          label="Replicas"
          type="number"
          inputProps={{ min: 0, step: 1 }}
          value={replicas}
          onChange={(e) => setReplicas(e.target.value)}
          disabled={busy}
          error={replicas !== "" && !valid}
          helperText={replicas !== "" && !valid ? "Must be an integer >= 0" : ""}
        />
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose} disabled={busy}>Cancel</Button>
        <Button onClick={handleConfirm} disabled={!valid || busy} variant="contained">
          {busy ? <CircularProgress size={20} /> : "Scale"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// --- Restart Dialog ---

function RestartDialog(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  activeContext: string;
  namespace: string;
  deploymentName: string;
  onSuccess: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (props.open) setError("");
  }, [props.open]);

  async function handleConfirm() {
    setBusy(true);
    setError("");
    try {
      await apiPostWithContext("/api/actions", props.token, props.activeContext, {
        group: "apps",
        resource: "deployments",
        namespace: props.namespace,
        name: props.deploymentName,
        action: "restart",
      });
      props.onSuccess();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={props.open} onClose={props.onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Restart Deployment</DialogTitle>
      <DialogContent>
        <Typography variant="body2">
          Restart deployment <strong>{props.deploymentName}</strong>?
        </Typography>
        <Typography variant="caption" color="text.secondary">
          This performs a rolling restart by patching the pod template annotation.
        </Typography>
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose} disabled={busy}>Cancel</Button>
        <Button onClick={handleConfirm} disabled={busy} variant="contained">
          {busy ? <CircularProgress size={20} /> : "Restart"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// --- Delete Dialog (typed confirmation) ---

function DeleteDialog(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  activeContext: string;
  namespace: string;
  deploymentName: string;
  onSuccess: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (props.open) {
      setConfirmText("");
      setError("");
    }
  }, [props.open]);

  const confirmed = confirmText === props.deploymentName;

  async function handleConfirm() {
    if (!confirmed) return;
    setBusy(true);
    setError("");
    try {
      await apiPostWithContext("/api/actions", props.token, props.activeContext, {
        group: "apps",
        resource: "deployments",
        namespace: props.namespace,
        name: props.deploymentName,
        action: "delete",
      });
      props.onSuccess();
    } catch (e) {
      const apiErr = toApiError(e);
      if (apiErr.status === 404) {
        props.onSuccess();
        return;
      }
      setError(apiErr.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={props.open} onClose={props.onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Delete Deployment</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          This action is destructive and cannot be undone.
        </Alert>
        <Typography variant="body2" sx={{ mb: 2 }}>
          To confirm, type the deployment name: <strong>{props.deploymentName}</strong>
        </Typography>
        <TextField
          autoFocus
          fullWidth
          label="Deployment name"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          disabled={busy}
        />
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose} disabled={busy}>Cancel</Button>
        <Button onClick={handleConfirm} disabled={!confirmed || busy} variant="contained" color="error">
          {busy ? <CircularProgress size={20} /> : "Delete"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
