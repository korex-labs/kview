import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Autocomplete, Box, Button, Checkbox, Chip, IconButton, MenuItem, Paper, TextField, Tooltip, Typography } from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import { emptyHistoryCatalog, historyOptions, mergeHistoryCatalog, mergeHistoryOptions, parseHistoryCatalog, signalTypeLabel, type HistoryCatalog } from "./historyOptions";
import type { ApiDataplaneSignalCatalogResponse } from "../../../types/api";
import { apiGetWithContext } from "../../../api";
import { useOptionalUserSettings } from "../../../settingsContext";
import { effectiveHistoryNamespaceRanking, historyNamespaceRankings, normalizeHistoryContextPreferences, normalizeHistoryPreferences, type HistoryContextPreferences, type HistoryPreferences } from "../../../historyPreferences";
import InfoHint from "../../shared/InfoHint";
import { historyError } from "./historyPresentation";
import SignalTrendsChart from "./SignalTrendsChart";
import { namespaceSelection, parseSignalTrends, sampleLabel, trendLines, trendURL, trendWindow, type NamespaceInventory, type SignalTrends, type TrendMode, type TrendQuery, type TrendSeries } from "./signalTrends";

export type SignalHistoryProps = { token: string; context: string; favouriteNamespaces?: string[]; recentNamespaces?: string[]; namespaceInventory?: NamespaceInventory };
type Option = { key: string; label: string };
type Group = "rules" | "nodes" | "namespaces";
const modeLabels: Record<TrendMode, string> = { topHigh10: "Top High 10", topChanges10: "Top Changes 10", custom: "Custom", favourites: "Favourites", recent: "Recent", tag: "Tag" };
export default function SignalHistoryPanel(props: SignalHistoryProps) {
  return <SignalHistoryScope key={JSON.stringify([props.context, props.token])} {...props} />;
}
function SignalHistoryScope({ token, context, favouriteNamespaces = [], recentNamespaces = [], namespaceInventory }: SignalHistoryProps) {
  const provider = useOptionalUserSettings();
  const settings = provider?.settings;
  const tags = settings?.resourceTags;
  const [localPreferences, setLocalPreferences] = useState(normalizeHistoryPreferences);
  const preferences = settings?.history ?? localPreferences;
  const { days, hours } = preferences;
  const scoped = normalizeHistoryContextPreferences(Object.prototype.hasOwnProperty.call(preferences.contexts, context) ? preferences.contexts[context] : undefined);
  // Only explicit control edits write preferences. Reads, polling, search and
  // inventory discovery never write back or replace a retained identity.
  const edit = (update: (old: HistoryPreferences) => HistoryPreferences) => {
    if (provider) provider.setSettings(old => ({ ...old, history: update(old.history) }));
    else setLocalPreferences(update);
  };
  const editContext = (patch: Partial<HistoryContextPreferences>) => edit(old => ({ ...old, contexts: { ...old.contexts, [context]: { ...normalizeHistoryContextPreferences(Object.prototype.hasOwnProperty.call(old.contexts, context) ? old.contexts[context] : undefined), ...patch } } }));
  const [revision, setRevision] = useState(0);
  const [windowAnchor, setWindowAnchor] = useState(Date.now);
  const window = useMemo(() => trendWindow(days, windowAnchor), [days, windowAnchor]);
  const [inventory, setInventory] = useState<HistoryCatalog>(emptyHistoryCatalog);
  const [inventoryError, setInventoryError] = useState("");
  const [ruleLabels, setRuleLabels] = useState<ReadonlyMap<string, string>>(() => new Map());
  useEffect(() => {
    if (!token || !context) return;
    let current = true;
    const controller = new AbortController();
    void apiGetWithContext<ApiDataplaneSignalCatalogResponse>("/api/dataplane/signals/catalog", token, context, { signal: controller.signal }).then(result => {
      if (!current || (result.active && result.active !== context)) return;
      setRuleLabels(new Map((result.items || []).filter(item => typeof item.type === "string" && typeof item.label === "string" && item.label.trim()).map(item => [item.type, item.label])));
    }).catch(() => { /* Optional names: retain readable fallback and history evidence. */ });
    return () => { current = false; controller.abort(); };
  }, [context, token, revision]);
  const [catalogTruncated, setCatalogTruncated] = useState(false);
  useEffect(() => {
    if (!token || !context) return;
    let current = true;
    const controller = new AbortController();
    void apiGetWithContext<unknown>("/api/history/inventory", token, context, { signal: controller.signal }).then(raw => {
      if (!current) return;
      if (!raw || typeof raw !== "object" || (raw as { context?: unknown }).context !== context) throw new Error("Mismatched history inventory.");
      setInventory(parseHistoryCatalog(raw)); setInventoryError("");
    }).catch(cause => { if (current) setInventoryError(historyError(cause)); });
    return () => { current = false; controller.abort(); };
  }, [context, token, revision]);
  const { rulesMode, nodesMode, namespaceMode, rules, nodes, namespaces, tag } = scoped;
  const [search, setSearch] = useState<Record<Group, string>>({ rules: "", nodes: "", namespaces: "" });
  const [options, setOptions] = useState<HistoryCatalog>(emptyHistoryCatalog);
  const evidence = useCallback((data: SignalTrends) => setOptions(old => {
    const catalog = data.catalog || emptyHistoryCatalog();
    return mergeHistoryCatalog(old, catalog, { rules: mergeHistoryOptions(data.rules, data.diagnostics.supportedRules.map(key => ({ key, label: key.replace(/_/g, " ") }))), nodes: data.nodes, namespaces: data.namespaces, truncated: false });
  }), []);
  const namespaceFeatures = {
    favourites: settings?.appearance.dashboardFavouriteNamespaceFilters ?? false,
    recent: settings?.appearance.dashboardRecentNamespaceFilters ?? false,
    tags: tags?.enabled ?? false,
    tagIds: tags?.enabled ? tags.definitions.map(tag => tag.id) : [],
  };
  const namespacesMode = effectiveHistoryNamespaceRanking(namespaceMode, tag, namespaceFeatures);
  const selectedNamespaces = namespaceSelection(namespacesMode, { context, token, favourites: favouriteNamespaces, recent: recentNamespaces, custom: namespaces, tag, tags, inventory: namespaceInventory });
  const query: TrendQuery = { context, ...window, rulesMode, nodesMode, namespacesMode, rules: rulesMode === "custom" ? rules : [], nodes: nodesMode === "custom" ? nodes : [], namespaces: selectedNamespaces };
  const validInventory = namespaceInventory?.context === context && namespaceInventory.token === token;
  const namespaceOptions = mergeHistoryOptions(options.namespaces, inventory.namespaces, validInventory ? namespaceInventory.items.map(item => ({ key: item.name, label: item.name })) : []);
  const nodeOptions = mergeHistoryOptions(options.nodes.map(option => ({ ...option, label: `${option.label} · retained` })), inventory.nodes.map(option => ({ ...option, label: `${option.label} · cached` })));
  const overLimit = selectedNamespaces.length > 20;
  const controls = (group: Group, mode: TrendMode, setMode: (mode: TrendMode) => void, values: string[], setValues: (values: string[]) => void, choices: Option[]) => {
    choices = historyOptions(choices.slice(0, 4096), values);
    if (group === "rules") choices = historyOptions(choices.map(option => ({ ...option, label: signalTypeLabel(option.key, ruleLabels) })), values);
    return <Box sx={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 1, ml: "auto", width: "max-content", minWidth: 0, maxWidth: "100%", flex: "0 1 auto" }}>
    <TextField select size="small" label={`${group === "rules" ? "Signal types" : group === "nodes" ? "Nodes" : "Namespaces"} ranking`} value={mode} onChange={e => setMode(e.target.value as TrendMode)} sx={{ minWidth: 0, width: 165, flex: "0 0 auto", maxWidth: "100%" }}>
      {(group !== "namespaces" ? ["topHigh10", "topChanges10", "custom"] : historyNamespaceRankings(namespaceFeatures)).map(key => <MenuItem key={key} value={key}>{modeLabels[key as TrendMode]}</MenuItem>)}
    </TextField>
    {mode === "custom" && <Autocomplete inputValue={search[group]} onInputChange={(_, value, reason) => { if (reason === "input" || reason === "clear") setSearch(old => ({ ...old, [group]: value })); }} multiple disableCloseOnSelect size="small" options={choices} value={choices.filter(s => values.includes(s.key))} getOptionLabel={s => s.label} isOptionEqualToValue={(a, b) => a.key === b.key} getOptionDisabled={s => values.length >= 20 && !values.includes(s.key)} onChange={(_, value) => setValues(value.map(s => s.key))} sx={{ minWidth: 0, maxWidth: "100%", width: 200, flex: "0 0 auto" }} renderInput={params => <TextField {...params} label={`Select ${group === "rules" ? "signal types" : group}`} />} renderOption={(props, option, { selected }) => <li {...props} key={option.key} title={option.label}><Checkbox checked={selected} tabIndex={-1} disableRipple slotProps={{ input: { "aria-label": option.label } }} sx={{ pointerEvents: "none" }} />{option.label}</li>} />}
    {group === "namespaces" && mode === "tag" && <TextField select size="small" label="Namespace tag" value={tag} onChange={e => editContext({ tag: e.target.value })} sx={{ minWidth: 0, width: 150, flex: "0 0 auto", maxWidth: "100%" }}><MenuItem value="">Select tag</MenuItem>{tag && !tags?.definitions.some(t => t.id === tag) && <MenuItem value={tag}>{tag} · unavailable</MenuItem>}{tags?.definitions.map(t => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}</TextField>}
  </Box>;
  };
  const groupControls = {
    rules: controls("rules", rulesMode, mode => editContext({ rulesMode: normalizeHistoryContextPreferences({ rulesMode: mode }).rulesMode }), rules, rules => editContext({ rules }), mergeHistoryOptions(options.rules, inventory.rules)),
    nodes: controls("nodes", nodesMode, mode => editContext({ nodesMode: normalizeHistoryContextPreferences({ nodesMode: mode }).nodesMode }), nodes, nodes => editContext({ nodes }), nodeOptions),
    namespaces: controls("namespaces", namespacesMode, namespaceMode => editContext({ namespaceMode, ...(namespaceMode === "tag" && !namespaceFeatures.tagIds.includes(tag) ? { tag: "" } : {}) }), namespaces, namespaces => editContext({ namespaces }), namespaceOptions),
  };
  return <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center", pt: 0.75 }}>
      <TextField select size="small" label="Period" value={days} onChange={e => edit(old => ({ ...old, days: Number(e.target.value) }))}><MenuItem value={1}>24 hours</MenuItem><MenuItem value={7}>7 days</MenuItem><MenuItem value={30}>30 days</MenuItem><MenuItem value={90}>90 days</MenuItem></TextField>
      <TextField select size="small" label="Detail" value={hours} onChange={e => edit(old => ({ ...old, hours: Number(e.target.value) }))}><MenuItem value={1}>Hourly</MenuItem><MenuItem value={6}>6 hours</MenuItem><MenuItem value={24}>Daily</MenuItem></TextField>
      <Tooltip title="Refresh history"><span><IconButton size="small" aria-label="Refresh history" disabled={!token || !context} onClick={() => { setWindowAnchor(Date.now()); setRevision(v => v + 1); }}><RefreshIcon fontSize="small" /></IconButton></span></Tooltip>
      <InfoHint title="Signal counts are last observed values, not live readings; changes count confirmed transitions and may be incomplete, while gaps mean no data, not zero." />
    </Box>
    {namespacesMode !== namespaceMode && <Typography variant="caption">Saved {modeLabels[namespaceMode]} ranking is unavailable; showing Top High 10. Your saved selection is preserved.</Typography>}
    {namespacesMode === "tag" && <Typography variant="caption">Tags use current cached namespace inventory, not historical tags.{!validInventory ? " Inventory unavailable for this context." : " Label/annotation rules require metadata present in that inventory."}</Typography>}
    {inventoryError && <Alert severity="warning">Cached history choices unavailable: {inventoryError}</Alert>}
    {(inventory.truncated || catalogTruncated || options.truncated || nodeOptions.length > 4096 || namespaceOptions.length > 4096 || mergeHistoryOptions(options.rules, inventory.rules).length > 4096) && <Alert severity="warning">History choices reached the bounded catalog limit (4096 per group). Selected identities remain available.</Alert>}
    {overLimit && <Alert severity="warning">This namespace selection exceeds the API limit of 20. Use Custom to choose a smaller set; no namespaces were silently omitted.</Alert>}
    {!token || !context ? <Alert severity="info">Sign in and select an active context to read history.</Alert> : <TrendRequest ruleLabels={ruleLabels} revision={revision} query={query} token={token} hours={hours} controls={groupControls} blocked={overLimit} onEvidence={evidence} onCatalogTruncated={setCatalogTruncated} />}
  </Box>;
}
function TrendRequest({ ruleLabels, query, token, hours, controls, blocked, onEvidence, onCatalogTruncated, revision }: { ruleLabels: ReadonlyMap<string, string>; revision: number; query: TrendQuery; token: string; hours: number; controls: Record<Group, React.ReactNode>; blocked: boolean; onEvidence: (data: SignalTrends) => void; onCatalogTruncated: (value: boolean) => void }) {
  // One atomic endpoint snapshot, with structural sharing for unchanged plots.
  const [snapshot, setSnapshot] = useState<TrendSnapshot | null>(null);
  const accepted = useRef<TrendSnapshot | null>(null);
  const [error, setError] = useState("");
  const [affected, setAffected] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const data = snapshot?.data;
  const [retry, setRetry] = useState(0);
  const identity = JSON.stringify(query);
  useEffect(() => {
    const initial = JSON.parse(identity) as TrendQuery;
    const previous = accepted.current;
    const commonChange = !previous || previous.revision !== revision || previous.query.context !== initial.context || previous.query.from !== initial.from || previous.query.to !== initial.to;
    // Compare with the last accepted request, not the last attempted one: rapid
    // edits to different cards must keep BOTH selections pending until committed.
    const changed = commonChange ? [] : groups.filter(group => JSON.stringify([previous.query[`${group}Mode`], previous.query[group]]) !== JSON.stringify([initial[`${group}Mode`], initial[group]]));
    setAffected(changed); setError(""); setLoading(!blocked);
    if (commonChange) { accepted.current = null; setSnapshot(null); }
    if (blocked) return;
    let current = true, controller: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    const load = async (rolling = false) => {
      if (!current || document.visibilityState === "hidden" || controller) return;
      const request = new AbortController(); controller = request;
      const expected = rolling ? { ...initial, ...trendWindow((Date.parse(initial.to) - Date.parse(initial.from)) / 86400000) }
        : !commonChange && previous ? { ...initial, from: previous.data.from, to: previous.data.to } : initial;
      try {
        const raw = await apiGetWithContext<unknown>(trendURL(expected), token, expected.context, { signal: request.signal });
        if (!current || request.signal.aborted) return;
        const next = parseSignalTrends(raw, expected);
        const old = accepted.current?.data;
        // All metadata and changed values come from this response generation.
        // Reusing equal arrays prevents unrelated MUI chart input/hover resets.
        if (old) for (const group of ["severity", ...groups] as const) {
          if (JSON.stringify(old[group]) === JSON.stringify(next[group])) next[group] = old[group];
        }
        const value = { data: next, query: initial, revision };
        accepted.current = value; setSnapshot(value); setError(""); setAffected([]);
        onEvidence(next); onCatalogTruncated(!!next.catalog?.truncated);
      } catch (cause) {
        if (current && !request.signal.aborted) {
          const off = (cause as { status?: number })?.status === 409;
          // Consent is shared, unlike a failed chart selection.
          if (off) { accepted.current = null; setSnapshot(null); setAffected([]); }
          setError(off ? "Signal history is off. Enable separate identity consent in Settings → Dataplane → History." : historyError(cause));
        }
      } finally {
        if (controller === request) controller = undefined;
        if (current && !request.signal.aborted) {
          setLoading(false);
          if (!document.hidden) timer = setTimeout(() => { void load(true); }, 60000);
        }
      }
    };
    let visible = document.visibilityState !== "hidden";
    const visibility = () => {
      const nextVisible = document.visibilityState !== "hidden";
      if (nextVisible === visible) return;
      visible = nextVisible;
      clearTimeout(timer);
      controller?.abort(); controller = undefined;
      if (document.visibilityState !== "hidden") void load(true);
    };
    document.addEventListener("visibilitychange", visibility);
    void load();
    return () => { current = false; clearTimeout(timer); controller?.abort(); document.removeEventListener("visibilitychange", visibility); };
  }, [identity, token, retry, blocked, onEvidence, onCatalogTruncated, revision]);
  const warning = error && <Alert severity="warning" action={<Button onClick={() => setRetry(v => v + 1)}>Retry signals</Button>}>{error}</Alert>;
  const card = (title: string, actions: React.ReactNode, graph: React.ReactNode, group?: Group) => <Paper variant="outlined" sx={{ p: 1.25, minWidth: 0 }}>
    <Box component="header" aria-label={`${title} chart header`} sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center", minHeight: 40, boxSizing: "content-box", pt: 1, pb: 0.75 }}>
      <Typography variant="subtitle2" sx={{ flexShrink: 0 }}>{title}</Typography>
      {actions}
    </Box>
    <Box sx={{ position: "relative" }}>
      {graph}
      {group && affected.includes(group) && loading && <Typography role="status" aria-label={`${title} loading`} variant="caption" sx={{ position: "absolute", top: 0, right: 0, bgcolor: "background.paper" }}>Loading {title.toLowerCase()}…</Typography>}
    </Box>
    {group && affected.includes(group) && warning}
  </Paper>;
  const graph = (group: Group | "severity", title: string) => <HistoryGraph title={title} group={group} series={data?.[group] || emptySeries} mode={group === "severity" ? "custom" : (snapshot?.query || query)[`${group}Mode`]} ruleLabels={group === "rules" ? ruleLabels : undefined} from={data?.from || query.from} to={data?.to || query.to} hours={hours} />;
  return <>
    {!affected.length && warning}
    {!data && !error && !blocked && <Typography role="status">Loading signal trends…</Typography>}
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "repeat(2, minmax(0, 1fr))" }, gap: 1 }}>
      {card("Severity", null, graph("severity", "Severity"))}
      {card("Signal types", controls.rules, graph("rules", "Signal types"), "rules")}
      {card("Nodes", controls.nodes, graph("nodes", "Nodes"), "nodes")}
      {card("Namespaces", controls.namespaces, graph("namespaces", "Namespaces"), "namespaces")}
    </Box>
    {data && <Diagnostics data={data} />}
  </>;
}
const groups: Group[] = ["rules", "nodes", "namespaces"];
const emptySeries: TrendSeries[] = [];
type TrendSnapshot = { data: SignalTrends; query: TrendQuery; revision: number };
const HistoryGraph = React.memo(function HistoryGraph({ title, group, series, mode, ruleLabels, from, to, hours }: { title: string; group: Group | "severity"; series: TrendSeries[]; mode: TrendMode; ruleLabels?: ReadonlyMap<string, string>; from: string; to: string; hours: number }) {
  const lines = useMemo(() => group === "severity"
    ? (["high", "medium", "low"] as const).map((metric, i) => ({ key: metric, label: ["High", "Medium", "Low"][i], color: ["#d94b48", "#c69212", "#2688ce"][i], metric, points: series[0]?.points || [] }))
    : trendLines(series, mode, "active").map(line => group === "rules" && ruleLabels ? { ...line, label: signalTypeLabel(line.key, ruleLabels) } : line), [group, series, mode, ruleLabels]);
  return <SignalTrendsChart title={title} kind={group === "severity" ? "stacked-area" : mode === "topChanges10" ? "stacked-bar" : "line"} preserveZero={group === "severity"} lines={lines} from={from} to={to} hours={hours} />;
});
function Diagnostics({ data }: { data: SignalTrends }) {
  const d = data.diagnostics;
  return <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }} aria-label="History diagnostics">
    <Chip size="small" label={`Last observation ${sampleLabel(d.lastSample)}`} title={`Source ${sampleLabel(d.sourceAt)}; age ${d.sourceAgeSeconds === null ? "unknown" : `${d.sourceAgeSeconds}s`}`} />
    <Chip size="small" label={`Carried hours ${data.severity[0]?.points.filter(p => p.carriedForward).length || 0}`} />
    {d.coalesced !== undefined && <Chip size="small" label={`Coalesced ${d.coalesced}`} color={d.coalesced ? "warning" : "default"} />}
    {d.overflow !== undefined && <Chip size="small" label={`Queue overflow ${d.overflow}`} color={d.overflow ? "warning" : "default"} />}
    <Chip size="small" label={`Scopes ${d.evaluatedScopes}/${d.eligibleScopes}`} color={d.evaluatedScopes < d.eligibleScopes ? "warning" : "default"} title="Evaluated / eligible scopes in the last stored observation, not live cluster coverage" />
    <Chip size="small" label={`Incomplete hours ${d.coverageGaps}`} color={d.coverageGaps ? "warning" : "default"} title="Partial or unknown severity hours in this period" />
    {d.capLosses > 0 && <Chip size="small" label={`Cap losses ${d.capLosses}`} color="warning" title="History limits omitted data from the last stored observation" />}
    <Chip size="small" label={`Persisted ${d.retainedHours}h · ${d.retainedBytes} B`} title={`Database ${d.databaseBytes} B. Retained payload, not a resource object count.`} />
  </Box>;
}
