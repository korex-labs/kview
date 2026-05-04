import React, { useEffect, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControlLabel,
  TextField,
  Alert,
  CircularProgress,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useActiveContext } from "../../../activeContext";
import { useConnectionState } from "../../../connectionState";
import ActionButton from "../../mutations/ActionButton";
import { executeAction } from "../../../lib/actions/executeAction";

// --- Uninstall / Upgrade / Reinstall buttons for a selected release ---

type ReleaseActionsProps = {
  token: string;
  namespace: string;
  releaseName: string;
  onRefresh: () => void;
  onDeleted: () => void;
};

type RollbackButtonProps = {
  token: string;
  namespace: string;
  releaseName: string;
  revision: number;
  onSuccess: () => void;
};

export function HelmReleaseActions({
  token,
  namespace,
  releaseName,
  onRefresh,
  onDeleted,
}: ReleaseActionsProps) {
  const activeContext = useActiveContext();

  const targetRef = {
    context: activeContext,
    kind: "HelmRelease",
    name: releaseName,
    namespace,
  };

  return (
    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
      <ActionButton
        label="Reinstall"
        descriptor={{
          id: "helm.reinstall",
          title: "Reinstall Helm Release",
          description:
            "Reinstalls the release using the currently installed chart and values.",
          risk: "medium",
          confirmSpec: { mode: "simple" },
          group: "",
          resource: "helmreleases",
          paramSpecs: [
            {
              kind: "boolean",
              key: "force",
              label: "Force resource updates",
              helperText:
                "Uses Helm force replacement. Use only when resources are stuck or immutable fields block reinstall.",
              defaultValue: false,
            },
          ],
        }}
        targetRef={targetRef}
        token={token}
        onSuccess={onRefresh}
      />

      <ActionButton
        label="Upgrade"
        descriptor={{
          id: "helm.upgrade",
          title: "Upgrade Helm Release",
          description: "Upgrades the release to a new chart version with optional value overrides.",
          risk: "medium",
          confirmSpec: { mode: "simple" },
          group: "",
          resource: "helmreleases",
          paramSpecs: [
            {
              kind: "string",
              key: "chart",
              label: "Chart",
              placeholder: "repo/chart or ./path",
              required: true,
            },
            {
              kind: "string",
              key: "version",
              label: "Version (optional)",
              placeholder: "e.g. 1.2.3",
            },
            {
              kind: "textarea",
              key: "valuesYaml",
              label: "Values YAML (optional)",
              placeholder: "key: value",
              minRows: 4,
            },
            {
              kind: "boolean",
              key: "force",
              label: "Force resource updates",
              helperText:
                "Uses Helm force replacement. Use only when resources are stuck or immutable fields block upgrade.",
              defaultValue: false,
            },
          ],
        }}
        targetRef={targetRef}
        token={token}
        onSuccess={onRefresh}
      />

      <ActionButton
        label="Uninstall"
        color="error"
        descriptor={{
          id: "helm.uninstall",
          title: "Uninstall Helm Release",
          description: "Permanently removes the Helm release from the cluster.",
          risk: "high",
          confirmSpec: { mode: "typed", requiredValue: releaseName },
          group: "",
          resource: "helmreleases",
        }}
        targetRef={targetRef}
        token={token}
        onSuccess={onDeleted}
      />
    </Box>
  );
}

export function HelmRollbackActionButton({
  token,
  namespace,
  releaseName,
  revision,
  onSuccess,
}: RollbackButtonProps) {
  const activeContext = useActiveContext();

  return (
    <ActionButton
      label={`Rollback to ${revision}`}
      descriptor={{
        id: "helm.rollback",
        title: "Rollback Helm Release",
        description: "Rolls the release back to the selected revision without running hooks.",
        risk: "medium",
        confirmSpec: { mode: "simple" },
        group: "",
        resource: "helmreleases",
        paramSpecs: [
          {
            kind: "numeric",
            key: "revision",
            label: "Target revision",
            min: 1,
            required: true,
          },
        ],
      }}
      targetRef={{
        context: activeContext,
        kind: "HelmRelease",
        name: releaseName,
        namespace,
      }}
      token={token}
      initialParams={{ revision: String(revision) }}
      onSuccess={onSuccess}
    />
  );
}

// --- Install button for the releases list page ---

type InstallButtonProps = {
  token: string;
  namespace: string;
  onSuccess: () => void;
};

export function HelmInstallButton({ token, namespace, onSuccess }: InstallButtonProps) {
  const activeContext = useActiveContext();
  const { health } = useConnectionState();
  const offline = health === "unhealthy";
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="small" variant="contained" startIcon={<AddIcon />} disabled={offline} onClick={() => setOpen(true)}>
        Install
      </Button>
      <InstallDialog
        open={open}
        onClose={() => setOpen(false)}
        token={token}
        activeContext={activeContext}
        defaultNamespace={namespace}
        offline={offline}
        onSuccess={() => {
          setOpen(false);
          onSuccess();
        }}
      />
    </>
  );
}

// --- Install Dialog ---

function InstallDialog(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  activeContext: string;
  defaultNamespace: string;
  offline: boolean;
  onSuccess: () => void;
}) {
  const [namespace, setNamespace] = useState(props.defaultNamespace);
  const [release, setRelease] = useState("");
  const [chart, setChart] = useState("");
  const [version, setVersion] = useState("");
  const [valuesYaml, setValuesYaml] = useState("");
  const [createNamespace, setCreateNamespace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (props.open) {
      setNamespace(props.defaultNamespace);
      setRelease("");
      setChart("");
      setVersion("");
      setValuesYaml("");
      setCreateNamespace(false);
      setError("");
    }
  }, [props.open, props.defaultNamespace]);

  const valid = !props.offline && namespace.trim() !== "" && release.trim() !== "" && chart.trim() !== "";

  async function handleConfirm() {
    if (!valid) return;
    setBusy(true);
    setError("");
    try {
      const result = await executeAction(props.token, props.activeContext, {
        actionId: "helm.install",
        targetRef: {
          context: props.activeContext,
          kind: "HelmRelease",
          name: release.trim(),
          namespace: namespace.trim(),
        },
        group: "",
        resource: "helmreleases",
        params: {
          chart: chart.trim(),
          version: version.trim(),
          valuesYaml,
          createNamespace,
        },
      });
      if (!result.success) {
        setError(result.message || "Helm install failed");
        return;
      }
      props.onSuccess();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={props.open} onClose={props.onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Install Helm Release</DialogTitle>
      <DialogContent>
        {props.offline && (
          <Alert severity="error" sx={{ mb: 2, mt: 1 }}>
            Cluster connection is unavailable. Helm install is disabled until connectivity recovers.
          </Alert>
        )}
        <TextField
          autoFocus
          fullWidth
          label="Namespace"
          value={namespace}
          onChange={(e) => setNamespace(e.target.value)}
          disabled={busy || props.offline}
          sx={{ mb: 2, mt: 1 }}
        />
        <TextField
          fullWidth
          label="Release name"
          value={release}
          onChange={(e) => setRelease(e.target.value)}
          disabled={busy || props.offline}
          sx={{ mb: 2 }}
        />
        <TextField
          fullWidth
          label="Chart"
          placeholder="repo/chart or ./path"
          value={chart}
          onChange={(e) => setChart(e.target.value)}
          disabled={busy || props.offline}
          sx={{ mb: 2 }}
        />
        <TextField
          fullWidth
          label="Version (optional)"
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          disabled={busy || props.offline}
          sx={{ mb: 2 }}
        />
        <TextField
          fullWidth
          label="Values YAML (optional)"
          multiline
          minRows={4}
          maxRows={12}
          value={valuesYaml}
          onChange={(e) => setValuesYaml(e.target.value)}
          disabled={busy || props.offline}
          InputProps={{ sx: { fontFamily: "monospace", fontSize: "0.85rem" } }}
          sx={{ mb: 1 }}
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={createNamespace}
              onChange={(e) => setCreateNamespace(e.target.checked)}
              disabled={busy || props.offline}
            />
          }
          label="Create namespace if it does not exist"
        />
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={handleConfirm} disabled={!valid || busy} variant="contained" startIcon={busy ? undefined : <AddIcon />}>
          {busy ? <CircularProgress size={20} /> : "Install"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
