import React, { useEffect, useRef, useState } from "react";
import { Alert, Box, MenuItem, TextField, Typography } from "@mui/material";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import { AppButton, AppIconButton } from "../shared/AppActions";
import { SettingField, SettingRow, SettingSection, ScopeTag } from "./shared";
import SettingsIcon from "./SettingsIcon";
import { apiGetWithContext, apiPostWithContext } from "../../api";

type Values = { signalHistory: boolean; enabled: boolean; retentionDays: 30 | 90 };
type Policy = Values & { signalEpoch?: string; revision: number };
type Settings = { collectionFailures?: { context: string; error: string; errorCode: string }[]; signalHistoryCapability?: { available: boolean }; context: string; policy: Policy; global: Values; globalRevision: number; override: Partial<Values>; editable: boolean; error: string; collector: { enabled: boolean } };
type Scope = "global" | "context";
type Props = { token: string; context: string; scope?: Scope; onSaved?: () => void };
const fields = ["enabled", "signalHistory", "retentionDays"] as const;
function validValues(p: Values | undefined) {
  return p && typeof p.enabled === "boolean" && typeof p.signalHistory === "boolean" && [30, 90].includes(p.retentionDays);
}
function parseSettings(raw: unknown, context: string): Settings {
  const v = raw as Settings | null;
  if (!v || v.context !== context || !validValues(v.policy) || !validValues(v.global) ||
    !Number.isSafeInteger(v.policy.revision) || v.policy.revision < 0 || !Number.isSafeInteger(v.globalRevision) || v.globalRevision < 0 ||
    !v.override || typeof v.override !== "object" || Array.isArray(v.override) ||
    Object.entries(v.override).some(([key, value]) => !fields.includes(key as typeof fields[number]) || (key === "retentionDays" ? ![30, 90].includes(value as number) : typeof value !== "boolean")) ||
    (v.collectionFailures !== undefined && (!Array.isArray(v.collectionFailures) || v.collectionFailures.some(f => !f || typeof f.context !== "string" || typeof f.error !== "string" || typeof f.errorCode !== "string"))) ||
    typeof v.editable !== "boolean" || typeof v.error !== "string" || typeof v.collector?.enabled !== "boolean") {
    throw new Error("Invalid or mismatched history settings response.");
  }
  return v;
}
export default function HistorySettings({ scope = "context", ...props }: Props) {
  return props.token && props.context
    ? <SettingsForm key={JSON.stringify([props.context, props.token, scope])} {...props} scope={scope} />
    : <Alert severity="info">Select a context to manage history.</Alert>;
}
function SettingsForm({ token, context, scope = "context", onSaved }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Values | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Loading history settings…");
  const [wake, setWake] = useState(0);
  const server = useRef<Settings | null>(null);
  const pending = useRef<Partial<Values>>({});
  const reset = useRef(false);
  const busy = useRef(false);
  const alive = useRef(false);
  const request = useRef<AbortController | null>(null);
  const savedCallback = useRef(onSaved);
  useEffect(() => { savedCallback.current = onSaved; }, [onSaved]);
  const values = (s: Settings) => scope === "global" ? s.global : s.policy;
  const publish = (s: Settings) => {
    server.current = s; setSettings(s);
    setDraft({ ...(reset.current ? s.global : values(s)), ...pending.current });
  };
  const read = async (controller: AbortController) => parseSettings(await apiGetWithContext<unknown>("/api/history/settings", token, context, { signal: controller.signal }), context);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController(); request.current = controller;
    void apiGetWithContext<unknown>("/api/history/settings", token, context, { signal: controller.signal }).then(raw => {
      if (!alive.current || controller.signal.aborted) return;
      const next = parseSettings(raw, context);
      server.current = next; setSettings(next); setDraft(scope === "global" ? next.global : next.policy); setStatus("");
    }).catch(() => { if (alive.current && !controller.signal.aborted) setError("Could not load history settings. Check access and retry."); });
    return () => { alive.current = false; request.current?.abort(); controller.abort(); };
  }, [token, context, scope]);

  // One debounced writer. Edits made during POST/GET remain queued, never replaced
  // by that request's snapshot. Only explicit fields are sent (never the epoch).
  const flush = async () => {
    const base = server.current;
    if (!base || busy.current || !base.editable) return;
    const changes = pending.current; const resetting = reset.current;
    if (!resetting && Object.keys(changes).length === 0) return;
    pending.current = {}; reset.current = false; busy.current = true;
    const controller = new AbortController(); request.current = controller;
    setStatus("Saving…");
    const revision = scope === "global" ? base.globalRevision : base.policy.revision;
    try {
      await apiPostWithContext("/api/history/settings", token, context, { scope, revision, globalRevision: base.globalRevision, ...changes, ...(resetting ? { reset: true } : {}) }, { signal: controller.signal });
      if (!alive.current || controller.signal.aborted) return;
      const next = await read(controller);
      if (!alive.current || controller.signal.aborted) return;
      const actualRevision = scope === "global" ? next.globalRevision : next.policy.revision;
      if (actualRevision !== revision + 1 || (scope === "context" && next.globalRevision !== base.globalRevision) ||
        fields.some(key => (key in changes || resetting) && values(next)[key] !== (key in changes ? changes[key] : base.global[key]))) {
        throw new Error("History settings changed during confirmation.");
      }
      publish(next); savedCallback.current?.();
      setStatus("Saved");
    } catch {
      if (!alive.current || controller.signal.aborted) return;
      // Preserve latest intent; failure/conflict never silently discards edits or
      // automatically overwrites another writer. Explicit Retry uses fresh CAS.
      if (!reset.current) pending.current = { ...changes, ...pending.current };
      if (resetting) reset.current = true;
      try { const next = await read(controller); if (alive.current && !controller.signal.aborted) publish(next); } catch { /* Retry reads again before writing. */ }
      if (!alive.current || controller.signal.aborted) return;
      setError("History settings were not confirmed. Your edits are kept. Review server status, then retry or discard edits.");
      const confirmed = server.current;
      const defaultsSaved = scope === "global" && confirmed?.globalRevision === revision + 1 && fields.every(key => !(key in changes) || confirmed.global[key] === changes[key]) && !!confirmed.collectionFailures?.length;
      setStatus(defaultsSaved ? "Defaults saved; collection needs attention" : "Not saved");
    } finally {
      if (alive.current && !controller.signal.aborted) { busy.current = false; setWake(v => v + 1); }
    }
  };
  useEffect(() => {
    if (error || busy.current || (!reset.current && Object.keys(pending.current).length === 0)) return;
    const timer = setTimeout(() => { void flush(); }, 350);
    return () => clearTimeout(timer);
    // The wake counter is the queue's explicit notification; closures use refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wake, error]);
  const edit = <K extends keyof Values>(key: K, value: Values[K]) => {
    pending.current = { ...pending.current, [key]: value };
    if (!busy.current && !reset.current && server.current && values(server.current)[key] === value) delete pending.current[key];
    setDraft(prev => prev ? { ...prev, [key]: value } : prev);
    setStatus(!busy.current && !reset.current && Object.keys(pending.current).length === 0 ? "Saved" : "Unsaved changes"); setWake(v => v + 1);
  };
  const retry = async (discard: boolean) => {
    if (busy.current) return;
    busy.current = true;
    const controller = new AbortController(); request.current = controller;
    try {
      const next = await read(controller);
      if (!alive.current || controller.signal.aborted) return;
      if (discard) { pending.current = {}; reset.current = false; }
      publish(next); setError(""); setStatus(discard ? "" : "Unsaved changes");
    } catch { if (alive.current && !controller.signal.aborted) setError("Could not load history settings. Your edits are kept. Retry settings."); }
    finally { if (alive.current && !controller.signal.aborted) { busy.current = false; setWake(v => v + 1); } }
  };
  const disabled = !settings?.editable;
  return <SettingSection
    title="History"
    icon={<SettingsIcon name="signals" />}
    hint="Autosaved on this server, separately from browser profiles. Records the full Dashboard signal population after Dashboard policy filters, without additional Kubernetes reads or writes. Global defaults apply to inheriting contexts, including new contexts; custom fields override them."
    actions={scope === "context" && settings && <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
      <ScopeTag state={Object.keys(settings.override).length ? "overridden" : "inherited"} />
      <AppIconButton tooltip="Reset to global defaults" label="Reset to global defaults" disabled={disabled} onClick={() => { pending.current = {}; reset.current = true; setDraft(settings.global); setStatus("Unsaved changes"); setWake(v => v + 1); }}>
        <RestartAltIcon fontSize="inherit" />
      </AppIconButton>
    </Box>}
  >
    {error && <Alert severity="error">
      {error}
      <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
        <AppButton onClick={() => { void retry(false); }}>Retry settings</AppButton>
        {draft && <AppButton onClick={() => { void retry(true); }}>Discard edits</AppButton>}
      </Box>
    </Alert>}
    {draft && settings && <>
      {!settings.editable && <Alert severity="warning">History settings are not editable in this server mode (including read-only mode).</Alert>}
      {settings.error && <Alert severity="error">{settings.error}</Alert>}
      {scope === "global" && settings.collectionFailures?.filter(failure => failure.context !== context).map(failure => <Alert severity="error" key={failure.context}>Collection · {failure.context}: {failure.error} Saved defaults remain durable; collection has not started for this context.</Alert>)}
      <SettingRow
        label={scope === "global" ? "Enable history by default" : "Enable history for this context"}
        hint="Collection follows published cache updates while the server runs. Disabling stops collection and preserves stored data. Re-enable to read it."
        checked={draft.enabled} disabled={disabled} onChange={value => edit("enabled", value)}
      />
      <Box>
        <SettingRow
          label="Enable signal history"
          hint="Explicit identity consent, off by default. Global consent applies to inheriting contexts; context consent applies only here. Requires Enable history too. No secret or label maps."
          checked={draft.signalHistory} disabled={disabled || !settings.signalHistoryCapability?.available} onChange={value => edit("signalHistory", value)}
        />
        <Typography variant="caption" color="text.secondary">Stores resource names, namespaces, UIDs, node membership and signal transitions on this server.</Typography>
      </Box>
      <Box sx={{ maxWidth: 220, mt: 0.5 }}>
        <SettingField label="History retention" hint="Shortening retention prunes older observations during successful publication or maintenance. Increasing it cannot recover deleted observations.">
          <TextField select size="small" fullWidth value={draft.retentionDays} disabled={disabled} onChange={event => edit("retentionDays", Number(event.target.value) as 30 | 90)}>
            <MenuItem value={30}>30 days</MenuItem><MenuItem value={90}>90 days</MenuItem>
          </TextField>
        </SettingField>
      </Box>
    </>}
    <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1 }}>
      {settings && <Typography variant="caption" color="text.secondary">Collection · {context}: {settings.collector.enabled ? "running" : settings.policy.enabled ? "requested but not running" : "off"}</Typography>}
      <Typography role="status" aria-label="History settings save status" variant="caption" color="text.secondary">{status}</Typography>
    </Box>
  </SettingSection>;
}
