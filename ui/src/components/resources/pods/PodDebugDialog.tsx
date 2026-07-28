import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from "@mui/material";

import { apiPostWithContext, toApiError } from "../../../api";
import { createPodDebugSession } from "../../../sessionsApi";
import { DialogActionButton } from "../../shared/AppActions";

export type PodDebugContainerOption = {
  name: string;
  state?: string;
};

type AccessReviewResponse = {
  allowed: boolean;
  reason?: string;
};

type Props = {
  open: boolean;
  token: string;
  contextName: string;
  namespace: string;
  pod: string;
  podUID: string;
  containers: PodDebugContainerOption[];
  defaultImage: string;
  defaultShell: string;
  onClose: () => void;
  onCreated: (sessionID: string, container: string) => void;
};

function newRequestID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `pod-debug-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function PodDebugDialog(props: Props) {
  const [targetContainer, setTargetContainer] = useState("");
  const [image, setImage] = useState(props.defaultImage);
  const [shell, setShell] = useState(props.defaultShell);
  const [requestID, setRequestID] = useState(newRequestID);
  const [checkingAccess, setCheckingAccess] = useState(false);
  const [accessAllowed, setAccessAllowed] = useState(false);
  const [accessReason, setAccessReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const defaultTarget = useMemo(
    () => props.containers.find((container) => container.state === "Running")?.name || "",
    [props.containers],
  );

  useEffect(() => {
    if (!props.open) return;
    setTargetContainer(defaultTarget);
    setImage(props.defaultImage);
    setShell(props.defaultShell);
    setRequestID(newRequestID());
    setError("");
    setAccessAllowed(false);
    setAccessReason("");
    setCheckingAccess(true);

    const namespace = props.namespace;
    const name = props.pod;
    let cancelled = false;
    const checks = [
      { verb: "get", resource: "pods", group: "", namespace, name },
      { verb: "patch", resource: "pods", subresource: "ephemeralcontainers", group: "", namespace, name },
      { verb: "create", resource: "pods", subresource: "attach", group: "", namespace, name },
    ];
    Promise.all(
      checks.map((body) =>
        apiPostWithContext<AccessReviewResponse>("/api/auth/can-i", props.token, props.contextName, body),
      ),
    )
      .then((results) => {
        if (cancelled) return;
        const denied = results.find((result) => !result.allowed);
        setAccessAllowed(!denied);
        setAccessReason(denied?.reason || (denied ? "Kubernetes RBAC denied a required Pod Debug operation." : ""));
      })
      .catch((reason) => {
        if (cancelled) return;
        setAccessAllowed(false);
        setAccessReason(toApiError(reason).message || "Unable to verify Pod Debug permissions.");
      })
      .finally(() => {
        if (!cancelled) setCheckingAccess(false);
      });

    return () => {
      cancelled = true;
    };
  }, [defaultTarget, props.contextName, props.defaultImage, props.defaultShell, props.namespace, props.open, props.pod, props.token]);

  const imageValue = image.trim();
  const shellValue = shell.trim();
  const validationError = !targetContainer
    ? "Select a target container."
    : !imageValue
      ? "Debug image is required."
      : !shellValue.startsWith("/")
        ? "Shell must be an absolute path."
        : "";

  const start = async () => {
    if (validationError || !accessAllowed || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const created = await createPodDebugSession(
        {
          namespace: props.namespace,
          pod: props.pod,
          expectedUID: props.podUID,
          targetContainer,
          image: imageValue,
          shell: shellValue,
          profile: "baseline",
          requestId: requestID,
        },
        props.token,
        props.contextName,
      );
      props.onCreated(created.sessionID, created.debugContainer);
      props.onClose();
    } catch (reason) {
      setError(toApiError(reason).message || "Unable to start Pod Debug.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={props.open} onClose={submitting ? undefined : props.onClose} fullWidth maxWidth="sm">
      <DialogTitle>Debug Pod</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
            <Chip size="small" label={props.namespace} variant="outlined" />
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{props.pod}</Typography>
            <Chip size="small" label="Baseline profile" color="info" variant="outlined" />
          </Box>
          <Alert severity="warning">
            This adds an ephemeral container to the Pod. Kubernetes cannot remove or change it afterwards; its record remains until the Pod is recreated.
          </Alert>
          <Alert severity="info">
            The target requests access to that container&apos;s process namespace. Support depends on the container runtime, and the target filesystem is not automatically shared. Baseline does not request privileged mode or added capabilities, but it also does not force Restricted-profile non-root, seccomp, capability-drop, or privilege-escalation settings; cluster admission remains authoritative.
          </Alert>
          <FormControl size="small" fullWidth>
            <InputLabel id="pod-debug-target-label">Target container</InputLabel>
            <Select
              labelId="pod-debug-target-label"
              label="Target container"
              value={targetContainer}
              onChange={(event) => setTargetContainer(String(event.target.value))}
            >
              {props.containers.map((container) => (
                <MenuItem key={container.name} value={container.name} disabled={container.state !== "Running"}>
                  {container.name}{container.state ? ` — ${container.state}` : ""}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            size="small"
            label="Debug image"
            value={image}
            onChange={(event) => setImage(event.target.value)}
            helperText="Use an approved image with the selected shell. Avoid mutable latest tags."
            fullWidth
          />
          <TextField
            size="small"
            label="Shell"
            value={shell}
            onChange={(event) => setShell(event.target.value)}
            helperText="The shell is the debug container's main process and exits when the session ends."
            fullWidth
          />
          {checkingAccess ? <Alert severity="info">Checking Kubernetes permissions…</Alert> : null}
          {!checkingAccess && !accessAllowed ? <Alert severity="error">{accessReason || "Pod Debug is not allowed."}</Alert> : null}
          {validationError ? <Alert severity="error">{validationError}</Alert> : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Box>
      </DialogContent>
      <DialogActions>
        <DialogActionButton action="cancel" onClick={props.onClose} disabled={submitting}>Cancel</DialogActionButton>
        <DialogActionButton
          action="primary"
          onClick={() => void start()}
          disabled={submitting || checkingAccess || !accessAllowed || Boolean(validationError)}
        >
          {submitting ? "Creating…" : "Create and open terminal"}
        </DialogActionButton>
      </DialogActions>
    </Dialog>
  );
}
