import React, { useEffect, useState } from "react";
import {
  Alert, Box, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, FormControlLabel, InputLabel, MenuItem, Select, Typography,
} from "@mui/material";
import { AppButton } from "../shared/AppActions";
import CodeBlock from "../shared/CodeBlock";
import { settingsTransferMergeStrategies, type SettingsTransferMergeStrategy, type SettingsTransferSection } from "../../settings";
import {
  createSettingsImportReview, diffImportValues, projectSettingsImport, remoteImportSections,
  type ImportValueChange, type SettingsImportDocument, type SettingsImportSection, type SettingsImportState,
} from "./settingsImportReview";
import { loadSettingsImportBaseline, remoteImportChanges, type RemoteImportBaseline } from "./settingsImportBaseline";
import { useSettingsTransfer } from "./useSettingsTransfer";

type Message = { severity: "success" | "error"; text: string } | null;
type Props = SettingsImportState & {
  document: SettingsImportDocument;
  text: string;
  token: string;
  activeContext: string;
  contextOptions: string[];
  replaceSettings: (settings: SettingsImportState["settings"]) => void;
  setAppState: (state: SettingsImportState["appState"]) => void;
  onImportAppState?: (state: SettingsImportState["appState"]) => void;
  setImportText: (text: string) => void;
  setImportMessage: (message: Message) => void;
  onClose: () => void;
};
type BaselineResult = { value?: RemoteImportBaseline; error?: string };

function displayValue(value: unknown) {
  const text = value === undefined ? "(absent)" : JSON.stringify(value);
  return text.length > 1500 ? `${text.slice(0, 1500)}… (truncated)` : text;
}
function ChangeDetails({ changes }: { changes: ImportValueChange[] }) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState(false);
  return <Box>
    <AppButton variant="text" onClick={() => setOpen(!open)} aria-expanded={open}>
      {open ? "Hide differences" : "Show differences"}
    </AppButton>
    {open ? <Box sx={{ maxHeight: 280, overflow: "auto" }}>
      <FormControlLabel control={<Checkbox size="small" checked={raw} onChange={(_, value) => setRaw(value)} />} label="JSON diff (redacted)" />
      {raw ? <CodeBlock code={JSON.stringify(changes.slice(0, 100).map((change) => ({
        path: change.path, kind: change.kind, before: displayValue(change.before), after: displayValue(change.after),
      })), null, 2)} language="json" showCopy={false} showFontControls={false} />
        : changes.slice(0, 100).map((change) => <Box key={change.path} sx={{ mb: 1, overflowWrap: "anywhere" }}>
          <Typography variant="body2" component="div">{change.kind}: {change.path}</Typography>
          <Typography variant="caption" component="div" color="text.secondary">Before: {displayValue(change.before)}</Typography>
          <Typography variant="caption" component="div">After: {displayValue(change.after)}</Typography>
        </Box>)}
      {changes.length > 100 ? <Typography variant="caption">Showing the first 100 paths; counts include all changes.</Typography> : null}
      {changes.length === 0 ? <Typography variant="body2">No changes.</Typography> : null}
    </Box> : null}
  </Box>;
}

/** Shared review for file and paste imports. Mounting/selection/Cancel perform no writes. */
export default function SettingsImportReviewDialog(props: Props) {
  const { document, settings, appState, activeContext, token } = props;
  const [baseline, setBaseline] = useState<SettingsImportState>({ settings, appState });
  const [selected, setSelected] = useState<SettingsImportSection[]>(() => createSettingsImportReview(document, baseline).sections.map(({ id }) => id));
  const [strategy, setStrategy] = useState<SettingsTransferMergeStrategy>("useImported");
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [refreshNotice, setRefreshNotice] = useState(false);
  const [remote, setRemote] = useState<Partial<Record<SettingsImportSection, BaselineResult>>>({});
  const [retry, setRetry] = useState(0);
  const { applyTransferImport, cancelTransferImport, transferImportBusy } = useSettingsTransfer({
    ...props, transferSections: [], transferImportSections: selected as SettingsTransferSection[],
    transferStrategy: strategy, setTransferDialogMessage: (next) => {
      setMessage(next);
      if (next?.severity === "error") {
        // A failed sequence may have changed earlier remote sections. Review fresh baselines before retry.
        setRemote({});
        setRetry((value) => value + 1);
      }
    },
  });
  useEffect(() => {
    if (document.kind !== "transfer") return;
    const request = new AbortController();
    for (const id of Object.keys(document.bundle.sections) as SettingsImportSection[]) {
      if (!remoteImportSections.has(id)) continue;
      void loadSettingsImportBaseline(id, document.bundle, token, activeContext, request.signal).then((value) => {
        if (!request.signal.aborted) setRemote((prev) => ({ ...prev, [id]: { value } }));
      }).catch(() => {
        if (!request.signal.aborted) setRemote((prev) => ({ ...prev, [id]: { error: "Current values unavailable. Retry or deselect this section." } }));
      });
    }
    return () => request.abort();
  }, [document, token, activeContext, retry]);

  const review = createSettingsImportReview(document, baseline, selected, strategy, acknowledged);
  const rows = review.sections.map((section) => {
    const value = remote[section.id]?.value;
    if (!value) return section;
    const changes = remoteImportChanges(value, strategy, section.id);
    const counts = { added: 0, changed: 0, removed: 0 };
    for (const change of changes) counts[change.kind] += 1;
    return { ...section, status: "ready" as const, changes, counts };
  });
  const unavailable = rows.some((row) => row.selected && row.status !== "ready");
  const finished = message?.severity === "success";
  const disabled = transferImportBusy || finished;
  const canApply = selected.length > 0 && !unavailable && (!review.requiresNormalizationAcknowledgement || acknowledged) && !disabled;
  const close = () => { cancelTransferImport(); props.onClose(); };
  const refreshRemote = () => { setRemote({}); setRetry((value) => value + 1); };
  const apply = () => {
    if (!canApply) return;
    const current = { settings, appState };
    if (diffImportValues(baseline, current).length > 0) {
      setBaseline(current);
      setRefreshNotice(true);
      setMessage(null);
      return;
    }
    setRefreshNotice(false);
    if (document.kind === "transfer") {
      void applyTransferImport(document.bundle, props.text);
      return;
    }
    const next = projectSettingsImport(document, current, selected);
    if (next.settings !== settings) props.replaceSettings(next.settings);
    if (next.appState !== appState) (props.onImportAppState || props.setAppState)(next.appState);
    setMessage({ severity: "success", text: "Selected sections imported." });
    props.setImportMessage({ severity: "success", text: "Selected sections imported." });
  };
  const title = document.kind === "transfer" ? "Import Transfer Bundle" : document.kind === "fullProfile" ? "Import Full Profile" : "Import Settings";
  return <Dialog open onClose={close} fullWidth maxWidth="md" aria-labelledby="settings-import-review-title">
    <DialogTitle id="settings-import-review-title">{title}</DialogTitle>
    <DialogContent>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
        <Typography variant="body2" color="text.secondary">Review selected sections before applying. Unselected sections stay unchanged. Sensitive values are redacted.</Typography>
        {message ? <Alert severity={message.severity}>{message.text}</Alert> : null}
        {refreshNotice ? <Alert severity="warning">Local values changed while this preview was open. Differences have been refreshed; review them and press Apply again.</Alert> : null}
        {review.requiresNormalizationAcknowledgement ? <Alert severity="warning">
          Unsupported or invalid fields are omitted and defaults may be filled in. The differences show the normalized import.
          <FormControlLabel control={<Checkbox size="small" checked={acknowledged} disabled={disabled} onChange={(_, value) => setAcknowledged(value)} />} label="I understand the normalization changes" />
        </Alert> : null}
        {document.kind === "transfer" ? <FormControl size="small" fullWidth>
          <InputLabel id="settings-import-strategy-label">Merge strategy</InputLabel>
          <Select labelId="settings-import-strategy-label" label="Merge strategy" value={strategy} disabled={disabled}
            onChange={(event) => setStrategy(event.target.value as SettingsTransferMergeStrategy)}>
            {settingsTransferMergeStrategies.map((item) => <MenuItem key={item.id} value={item.id}>{item.label}</MenuItem>)}
          </Select>
        </FormControl> : null}
        {rows.some((row) => remoteImportSections.has(row.id)) ? <Typography variant="caption" color="text.secondary">
          Remote differences compare the proposed records with saved values at preview time. The server revalidates records (including expiry and limits) on Apply. Writes are sequential; Cancel cannot undo completed writes.
        </Typography> : null}
        <Box sx={{ display: "flex", gap: 1 }}>
          <AppButton variant="text" disabled={disabled} onClick={() => setSelected(rows.map(({ id }) => id))}>Select all</AppButton>
          <AppButton variant="text" disabled={disabled} onClick={() => setSelected([])}>Deselect all</AppButton>
        </Box>
        {rows.map((row) => <Box key={row.id} sx={{ borderBottom: "1px solid", borderColor: "divider", pb: 0.75 }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
            <FormControlLabel control={<Checkbox size="small" checked={row.selected} disabled={disabled}
              onChange={(_, value) => setSelected((prev) => value ? [...prev, row.id] : prev.filter((id) => id !== row.id))} />} label={row.label} />
            {row.counts ? <Typography variant="caption">Added {row.counts.added} · Changed {row.counts.changed} · Removed {row.counts.removed}</Typography>
              : <Typography variant="caption" color="text.secondary">{remote[row.id]?.error || "Loading current values…"}</Typography>}
          </Box>
          {row.status === "ready" ? <ChangeDetails changes={row.changes} /> : remote[row.id]?.error ?
            <AppButton variant="text" disabled={disabled} onClick={refreshRemote}>Retry current values</AppButton> : null}
        </Box>)}
      </Box>
    </DialogContent>
    <DialogActions>
      <AppButton variant="text" onClick={close}>{finished ? "Done" : "Cancel"}</AppButton>
      <AppButton intent="primary" disabled={!canApply} onClick={apply}>{transferImportBusy ? "Importing..." : "Apply"}</AppButton>
    </DialogActions>
  </Dialog>;
}
