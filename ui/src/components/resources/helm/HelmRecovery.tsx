import React, { useEffect, useId, useRef, useState } from "react";
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, TextField, Typography } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { apiGetWithContext, apiPostWithContext } from "../../../api";
import { useActiveContext } from "../../../activeContext";
import { useConnectionState } from "../../../connectionState";
import { useResourceCapabilities } from "../../mutations/useResourceCapabilities";
import { AppButton, DialogActionButton } from "../../shared/AppActions";
import KeyValueTable from "../../shared/KeyValueTable";
import ResourceLinkChip from "../../shared/ResourceLinkChip";
import Section from "../../shared/Section";
import StatusChip from "../../shared/StatusChip";
import { helmStatusChipColor } from "../../../utils/k8sUi";

export type HelmRecoveryPreview = {
  namespace: string;
  release: string;
  latest: { revision: number; status: string; description: string; secretName: string; uid: string; resourceVersion: string };
  previous?: { revision: number; status: string; secretName: string };
  eligible: boolean;
  blockedReason?: string;
  confirmation: string;
};
type Props = {
  open: boolean; token: string; namespace: string; releaseName: string;
  onRecovered: () => void;
  onOpenSecret: (name: string) => void;
};

export default function HelmRecovery(props: Props) {
  const context = useActiveContext();
  const { health } = useConnectionState();
  if (!props.open || health === "unhealthy" || !context) return null;
  return <RecoverySession key={JSON.stringify([props.token, context, props.namespace, props.releaseName])} {...props} context={context} />;
}

function RecoverySession({ token, context, namespace, releaseName, onRecovered, onOpenSecret }: Props & { context: string }) {
  const guidanceId = useId();
  const [preview, setPreview] = useState<HelmRecoveryPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [writersStopped, setWritersStopped] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const submitting = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; controller.current?.abort(); };
  }, []);
  const caps = useResourceCapabilities({ token, group: "", resource: "secrets", namespace, name: preview?.latest.secretName || "" });
  const path = `/api/namespaces/${encodeURIComponent(namespace)}/helmreleases/${encodeURIComponent(releaseName)}/recovery`;
  const eligible = !!preview?.eligible && !!caps?.delete &&
    ["pending-upgrade", "pending-rollback"].includes(preview.latest.status) && preview.latest.revision > 1 &&
    !!preview.previous && ["deployed", "superseded"].includes(preview.previous.status) &&
    preview.previous.revision < preview.latest.revision && preview.previous.revision > 0;

  function resetConfirmation() { setConfirmation(""); setWritersStopped(false); }
  async function load(openConfirmation = false) {
    if (submitting.current) return;
    const current = ++generation.current;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true); setPreview(null); setError(""); resetConfirmation(); setDialog(openConfirmation);
    try {
      const response = await apiGetWithContext<{ active: string; item: HelmRecoveryPreview }>(path, token, context, { signal: request.signal });
      if (!alive.current || current !== generation.current) return;
      const item = response.item;
      if (response.active !== context || item?.namespace !== namespace || item?.release !== releaseName ||
          !item.latest?.secretName || !item.latest.uid || !item.latest.resourceVersion ||
          !Number.isInteger(item.latest.revision) || item.confirmation !== `delete ${namespace}/${releaseName} revision ${item.latest.revision}`) {
        throw new Error("Recovery preview identity mismatch. Fetch a new preview.");
      }
      setPreview(item);
    } catch (e) {
      if (alive.current && current === generation.current) { setError(String(e)); setDialog(false); resetConfirmation(); }
    } finally {
      if (alive.current && current === generation.current) setLoading(false);
    }
  }
  async function submit() {
    if (submitting.current || loading || !dialog || !eligible || !preview || !writersStopped || confirmation !== preview.confirmation) return;
    submitting.current = true; setBusy(true); setError("");
    const current = generation.current;
    try {
      const result = await apiPostWithContext<{ active: string; item: { status: string; message: string } }>(path, token, context, {
        expectedRevision: preview.latest.revision,
        expectedSecretName: preview.latest.secretName,
        expectedUID: preview.latest.uid,
        expectedResourceVersion: preview.latest.resourceVersion,
        confirmation,
        writersStopped,
      });
      if (!alive.current || current !== generation.current) return;
      if (result.active !== context || result.item?.status !== "ok") throw new Error("Unexpected recovery response. Fetch a new preview before proceeding.");
      setDialog(false); resetConfirmation(); setMessage(result.item.message);
      submitting.current = false;
      void load();
      onRecovered();
    } catch (e) {
      if (!alive.current || current !== generation.current) return;
      setError(`${String(e)} — Fetch a new preview and confirm again. No automatic retry was made.`);
      setPreview(null); setDialog(false); resetConfirmation();
    } finally {
      // load() advances the generation after success, but this session still owns the submit lock.
      if (alive.current) { submitting.current = false; setBusy(false); }
    }
  }
  return <Section title="Guarded recovery preflight">
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mt: 1 }}>
      <Typography variant="body2">Preview the latest Helm history revision before considering guarded Secret deletion. This does not roll back resources or uninstall the release.</Typography>
      <Accordion disableGutters elevation={0}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />} id={`${guidanceId}-heading`} aria-controls={`${guidanceId}-content`}>Recovery guidance and alternatives</AccordionSummary>
        <AccordionDetails>
          <Typography variant="body2">A pending operation may still be active. Age does not prove abandonment. Stop all external Helm and CI writers before considering break-glass recovery.</Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>For failed releases, use Rollback in History or Reinstall in Overview. Rollback disables hooks. Reinstall uses the stored chart and values and may execute hooks; when templates are absent it uses server-side apply of the stored manifest.</Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>Break-glass deletes only one Helm history Secret. There is no automatic retry, chain deletion, or Secret backup. Secret exports can contain sensitive values and credentials.</Typography>
        </AccordionDetails>
      </Accordion>
      {message && <Alert severity="success">{message}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      <AppButton sx={{ alignSelf: "flex-start" }} disabled={loading || busy} onClick={() => { setMessage(""); void load(); }}>{loading ? "Loading recovery preview…" : "Preview recovery"}</AppButton>
      {preview && <>
        <KeyValueTable rows={[
          { label: "Latest revision", value: preview.latest.revision },
          { label: "Latest status", value: <StatusChip label={preview.latest.status} color={helmStatusChipColor(preview.latest.status)} /> },
          { label: "Description", value: preview.latest.description || "-" },
          { label: "Storage Secret", value: <ResourceLinkChip label={preview.latest.secretName} onClick={() => onOpenSecret(preview.latest.secretName)} /> },
          { label: "Previous retained revision", value: preview.previous ? `${preview.previous.revision} (${preview.previous.status})` : "None" },
          ...(preview.previous ? [{ label: "Previous storage Secret", value: <ResourceLinkChip label={preview.previous.secretName} onClick={() => onOpenSecret(preview.previous!.secretName)} /> }] : []),
          { label: "Eligibility", value: eligible ? "Eligible for guarded history deletion" : preview.blockedReason || "Unavailable: requires delete capability, pending-upgrade/pending-rollback revision > 1 and a usable immediately preceding retained revision." },
        ]} />
        <AppButton sx={{ alignSelf: "flex-start" }} intent="destructive" disabled={!eligible || loading || busy} onClick={() => void load(true)}>Review history Secret deletion</AppButton>
      </>}
    </Box>
    <Dialog open={dialog} onClose={() => { if (!busy) { setDialog(false); resetConfirmation(); } }} maxWidth="sm" fullWidth>
      <DialogTitle>Delete Helm history Secret</DialogTitle>
      <DialogContent>
        <Typography variant="body2">Context: {context}. Release: {namespace}/{releaseName}.</Typography>
        {loading ? <Typography>Refreshing recovery preview…</Typography> : preview && <>
          <Typography variant="body2">Delete only Secret {namespace}/{preview.latest.secretName}, revision {preview.latest.revision} ({preview.latest.status}). UID: {preview.latest.uid}. Resource version: {preview.latest.resourceVersion}.</Typography>
          <Alert severity="warning" sx={{ my: 2 }}>A pending operation may still be active. Age does not prove abandonment. Stop every Helm/CI writer before proceeding. Break-glass deletes only one Helm history Secret. This is not a resource rollback or uninstall. There is no automatic retry, chain deletion, or Secret backup. Secret exports can contain sensitive values and credentials. The server rechecks the exact identity and eligibility on submission. Closing this drawer or switching context cannot undo an already submitted deletion.</Alert>
          {!eligible && <Alert severity="error">{preview.blockedReason || "Recovery is not eligible or delete capability is unavailable."}</Alert>}
          <Typography variant="body2">Type exactly: {preview.confirmation}</Typography>
          <TextField fullWidth label="Confirmation" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} disabled={busy || !eligible} sx={{ mt: 2 }} />
          <FormControlLabel control={<Checkbox checked={writersStopped} onChange={(e) => setWritersStopped(e.target.checked)} disabled={busy || !eligible} />} label="All external Helm and CI writers are stopped" />
        </>}
      </DialogContent>
      <DialogActions>
        <DialogActionButton action="cancel" disabled={busy} onClick={() => { setDialog(false); resetConfirmation(); }}>Cancel</DialogActionButton>
        <DialogActionButton action="destructive" disabled={busy || loading || !eligible || !writersStopped || confirmation !== preview?.confirmation} onClick={() => void submit()}>{busy ? "Deleting…" : "Delete history Secret"}</DialogActionButton>
      </DialogActions>
    </Dialog>
  </Section>;
}
