import React, { useMemo, useState } from "react";
import {
  Box,
  Button,
  Chip,
  Menu,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";
import type {
  DashboardSignalItem,
  NamespacePodHealth,
  NamespaceProblematicResource,
  NamespaceSummaryMeta,
  NamespaceWorkloadHealthRollup,
  WorkloadKindHealthRollup,
} from "../../../types/api";
import AttentionSummary from "../../shared/AttentionSummary";
import EmptyState from "../../shared/EmptyState";
import Section from "../../shared/Section";
import DrawerActionStrip from "../../shared/DrawerActionStrip";
import StackedMetricBar from "../../shared/StackedMetricBar";
import GaugeTableRow from "../../shared/GaugeTableRow";
import ScopedCountChip from "../../shared/ScopedCountChip";
import StatusChip from "../../shared/StatusChip";
import SignalActions from "../../shared/SignalActions";
import SignalInvestigationDialog from "../../shared/SignalInvestigationDialog";
import SignalMemoryHint from "../../shared/SignalMemoryHint";
import { AppIconButton } from "../../shared/AppActions";
import { signalWithHistoryKey } from "../../shared/signalIdentity";
import { useActiveContext } from "../../../activeContext";
import { dispatchApplyFocusedResourceView } from "../../../focusedResourceViews";
import type { ListResourceKey } from "../../../utils/k8sResources";
import {
  signalCalculatedText,
  signalFirstSeenText,
  signalLastSeenText,
  signalSeverityColor,
  signalTooltipText,
} from "../../shared/signalFormat";
import {
  GAUGE_COLOR_HEALTHY,
  GAUGE_COLOR_WARNING,
  GAUGE_COLOR_ERROR,
  GAUGE_COLOR_NEUTRAL,
  GAUGE_COLOR_UNKNOWN,
} from "../../../theme/sxTokens";
import NamespaceActions from "./NamespaceActions";
import { dataplaneCoarseStateChipColor, formatChipLabel } from "../../../utils/k8sUi";
import type { CRRef } from "../customresources/CustomResourceDrawer";

function signalTarget(signal: DashboardSignalItem): string {
  if (!signal.name) return signal.namespace || signal.kind;
  return signal.namespace ? `${signal.namespace}/${signal.name}` : signal.name;
}

function suppressionModeLabel(signal: DashboardSignalItem): string {
  return signal.suppression?.mode === "until_changed" ? "Until changed" : "Snoozed";
}

function suppressionExpiryLabel(signal: DashboardSignalItem): string {
  const expiresAt = signal.suppression?.expiresAt;
  return expiresAt ? new Date(expiresAt * 1000).toLocaleString() : "";
}

function problematicSignalColor(reason: string): "warning" | "error" {
  const normalized = reason.toLowerCase();
  if (normalized.includes("fail") || normalized.includes("error") || normalized.includes("deadline")) return "error";
  return "warning";
}

function podHealthSummary(podHealth?: NamespacePodHealth): string {
  if (!podHealth) return "-";
  const total = podHealth.running + podHealth.pending + podHealth.failed + podHealth.succeeded + podHealth.unknown;
  if (total === 0) return "-";
  return `${podHealth.running} run · ${podHealth.pending} pend · ${podHealth.failed} fail · ${podHealth.succeeded} done · ${podHealth.unknown} unk / ${total}`;
}

function workloadSignalSummary(rollup?: WorkloadKindHealthRollup): string {
  if (!rollup || rollup.total === 0) return "-";
  return `${rollup.healthy} ok · ${rollup.progressing} prog · ${rollup.degraded} deg / ${rollup.total}`;
}

function signalHasFocusHint(signal: DashboardSignalItem): signal is DashboardSignalItem & { focus: NonNullable<DashboardSignalItem["focus"]> } {
  return !!signal.focus?.resource;
}


type Props = {
  token: string;
  namespaceName: string;
  workloadByKind?: NamespaceWorkloadHealthRollup;
  podHealth?: NamespacePodHealth;
  signals: DashboardSignalItem[];
  suppressedSignalCount?: number;
  suppressedSignals?: DashboardSignalItem[];
  problematic: NamespaceProblematicResource[];
  summaryMeta?: NamespaceSummaryMeta;
  quotaPressure: { critical: number; warning: number };
  onClose: () => void;
  onOpenPod: (name: string) => void;
  onOpenDeployment: (name: string) => void;
  onOpenJob: (name: string) => void;
  onOpenHPA: (name: string) => void;
  onOpenCustomResource: (ref: CRRef) => void;
  onOpenHelmRelease: (name: string | null) => void;
  onOpenResourceQuota: (name: string) => void;
  onNavigate: (sectionKey: string, filter?: string) => void;
  onSelectCapacityTab: () => void;
  onJumpToEvents?: () => void;
  onJumpToConditions?: () => void;
};

type SeenSortMode =
  | "priority"
  | "first_seen_desc"
  | "first_seen_asc"
  | "last_seen_desc"
  | "last_seen_asc";

/**
 * Namespace signals tab renders only backend-provided per-resource signals in
 * the shared AttentionSummary.
 */
export default function NamespaceSignalsTab({
  token,
  namespaceName,
  workloadByKind,
  podHealth,
  signals,
  suppressedSignalCount = 0,
  suppressedSignals = [],
  problematic,
  summaryMeta,
  quotaPressure,
  onClose,
  onOpenPod,
  onOpenDeployment,
  onOpenJob,
  onOpenHPA,
  onOpenCustomResource,
  onOpenHelmRelease,
  onOpenResourceQuota,
  onNavigate,
  onSelectCapacityTab,
  onJumpToEvents,
  onJumpToConditions,
}: Props) {
  const activeContext = useActiveContext();
  const [seenSortMode, setSeenSortMode] = useState<SeenSortMode>("priority");
  const [seenSortAnchor, setSeenSortAnchor] = useState<null | HTMLElement>(null);
  const [investigationSignal, setInvestigationSignal] = useState<DashboardSignalItem | null>(null);
  const [showSuppressed, setShowSuppressed] = useState(false);

  function handleProblematic(resource: NamespaceProblematicResource) {
    switch (resource.kind) {
      case "Pod": onOpenPod(resource.name); return;
      case "Deployment": onOpenDeployment(resource.name); return;
      case "Job": onOpenJob(resource.name); return;
      case "HorizontalPodAutoscaler": onOpenHPA(resource.name); return;
      case "DaemonSet": onNavigate("daemonSets"); return;
      case "StatefulSet": onNavigate("statefulSets"); return;
      case "CronJob": onNavigate("cronJobs"); return;
      case "ReplicaSet": onNavigate("replicaSets"); return;
    }
    if (resource.group && resource.version && resource.resource) {
      onOpenCustomResource({
        group: resource.group,
        version: resource.version,
        resource: resource.resource,
        kind: resource.kind,
        namespace: namespaceName,
        name: resource.name,
      });
      return;
    }
    onNavigate("customresources", resource.name || resource.kind);
  }

  function handleSignal(signal: DashboardSignalItem) {
    switch (signal.kind) {
      case "Namespace":
        onSelectCapacityTab();
        return;
      case "ResourceQuota":
        if (signal.name) onOpenResourceQuota(signal.name);
        else onSelectCapacityTab();
        return;
      case "LimitRange": onNavigate("limitRanges"); return;
      case "NetworkPolicy": onNavigate("networkPolicies"); return;
      case "HelmRelease": onOpenHelmRelease(signal.name || null); return;
      case "Job": onOpenJob(signal.name || ""); return;
      case "HorizontalPodAutoscaler": onOpenHPA(signal.name || ""); return;
      case "Pod": onOpenPod(signal.name || ""); return;
      case "ConfigMap": onNavigate("configMaps"); return;
      case "Secret": onNavigate("secrets"); return;
      case "PersistentVolumeClaim": onNavigate("pvcs"); return;
      case "ServiceAccount": onNavigate("serviceAccounts"); return;
      case "CronJob": onNavigate("cronJobs"); return;
    }
    if (signal.name) onNavigate("customresources", signal.name);
  }

  function focusSignalList(signal: DashboardSignalItem) {
    if (!signalHasFocusHint(signal)) return;
    dispatchApplyFocusedResourceView({
      context: activeContext,
      namespace: signal.focus.namespace || namespaceName,
      resource: signal.focus.resource as ListResourceKey,
      filter: signal.focus.filter || signal.resourceName || signal.name || signal.namespace || "",
      label: signal.focus.label || signal.resourceName || signal.name || signal.namespace || "",
      source: "namespace-signal",
    });
  }

  const sortedSignals = useMemo(() => {
    const items = [...signals];
    switch (seenSortMode) {
      case "first_seen_desc":
        items.sort((a, b) => (b.firstSeenAt || 0) - (a.firstSeenAt || 0));
        break;
      case "first_seen_asc":
        items.sort((a, b) => {
          const av = a.firstSeenAt || Number.MAX_SAFE_INTEGER;
          const bv = b.firstSeenAt || Number.MAX_SAFE_INTEGER;
          return av - bv;
        });
        break;
      case "last_seen_desc":
        items.sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
        break;
      case "last_seen_asc":
        items.sort((a, b) => {
          const av = a.lastSeenAt || Number.MAX_SAFE_INTEGER;
          const bv = b.lastSeenAt || Number.MAX_SAFE_INTEGER;
          return av - bv;
        });
        break;
      case "priority":
      default:
        break;
    }
    return items;
  }, [seenSortMode, signals]);

  function seenSortLabel(mode: SeenSortMode): string {
    switch (mode) {
      case "first_seen_desc": return "First: newest";
      case "first_seen_asc": return "First: oldest";
      case "last_seen_desc": return "Last: newest";
      case "last_seen_asc": return "Last: oldest";
      default: return "Priority";
    }
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
      <DrawerActionStrip>
        <NamespaceActions token={token} namespaceName={namespaceName} onDeleted={onClose} />
      </DrawerActionStrip>

      <AttentionSummary
        token={token}
        signals={signals}
        onJumpToEvents={onJumpToEvents}
        onJumpToConditions={onJumpToConditions}
      />

      {(workloadByKind || podHealth) && (
        <Section title="Health overview">
          <Box sx={{ mt: 1 }}>
              {podHealth && podHealthSummary(podHealth) !== "-" && (
                <GaugeTableRow
                  label="Pods"
                  bar={<StackedMetricBar segments={[
                    { label: "Running", value: podHealth.running, color: GAUGE_COLOR_HEALTHY },
                    { label: "Pending", value: podHealth.pending, color: GAUGE_COLOR_WARNING },
                    { label: "Failed", value: podHealth.failed, color: GAUGE_COLOR_ERROR },
                    { label: "Succeeded", value: podHealth.succeeded, color: GAUGE_COLOR_NEUTRAL },
                    { label: "Unknown", value: podHealth.unknown, color: GAUGE_COLOR_UNKNOWN },
                  ]} />}
                  summary={podHealthSummary(podHealth)}
                />
              )}
              {workloadByKind?.deployments?.total ? (
                <GaugeTableRow
                  label="Deployments"
                  bar={<StackedMetricBar segments={[
                    { label: "Healthy", value: workloadByKind.deployments.healthy, color: GAUGE_COLOR_HEALTHY },
                    { label: "Progressing", value: workloadByKind.deployments.progressing, color: GAUGE_COLOR_WARNING },
                    { label: "Degraded", value: workloadByKind.deployments.degraded, color: GAUGE_COLOR_ERROR },
                  ]} />}
                  summary={workloadSignalSummary(workloadByKind.deployments)}
                />
              ) : null}
              {workloadByKind?.daemonSets?.total ? (
                <GaugeTableRow
                  label="DaemonSets"
                  bar={<StackedMetricBar segments={[
                    { label: "Healthy", value: workloadByKind.daemonSets.healthy, color: GAUGE_COLOR_HEALTHY },
                    { label: "Progressing", value: workloadByKind.daemonSets.progressing, color: GAUGE_COLOR_WARNING },
                    { label: "Degraded", value: workloadByKind.daemonSets.degraded, color: GAUGE_COLOR_ERROR },
                  ]} />}
                  summary={workloadSignalSummary(workloadByKind.daemonSets)}
                />
              ) : null}
              {workloadByKind?.statefulSets?.total ? (
                <GaugeTableRow
                  label="StatefulSets"
                  bar={<StackedMetricBar segments={[
                    { label: "Healthy", value: workloadByKind.statefulSets.healthy, color: GAUGE_COLOR_HEALTHY },
                    { label: "Progressing", value: workloadByKind.statefulSets.progressing, color: GAUGE_COLOR_WARNING },
                    { label: "Degraded", value: workloadByKind.statefulSets.degraded, color: GAUGE_COLOR_ERROR },
                  ]} />}
                  summary={workloadSignalSummary(workloadByKind.statefulSets)}
                />
              ) : null}
              {workloadByKind?.jobs?.total ? (
                <GaugeTableRow
                  label="Jobs"
                  bar={<StackedMetricBar segments={[
                    { label: "Healthy", value: workloadByKind.jobs.healthy, color: GAUGE_COLOR_HEALTHY },
                    { label: "Progressing", value: workloadByKind.jobs.progressing, color: GAUGE_COLOR_WARNING },
                    { label: "Degraded", value: workloadByKind.jobs.degraded, color: GAUGE_COLOR_ERROR },
                  ]} />}
                  summary={workloadSignalSummary(workloadByKind.jobs)}
                />
              ) : null}
              {workloadByKind?.cronJobs?.total ? (
                <GaugeTableRow
                  label="CronJobs"
                  bar={<StackedMetricBar segments={[
                    { label: "Healthy", value: workloadByKind.cronJobs.healthy, color: GAUGE_COLOR_HEALTHY },
                    { label: "Progressing", value: workloadByKind.cronJobs.progressing, color: GAUGE_COLOR_WARNING },
                    { label: "Degraded", value: workloadByKind.cronJobs.degraded, color: GAUGE_COLOR_ERROR },
                  ]} />}
                  summary={workloadSignalSummary(workloadByKind.cronJobs)}
                />
              ) : null}
              {workloadByKind?.replicaSets?.total ? (
                <GaugeTableRow
                  label="ReplicaSets"
                  bar={<StackedMetricBar segments={[
                    { label: "Healthy", value: workloadByKind.replicaSets.healthy, color: GAUGE_COLOR_HEALTHY },
                    { label: "Progressing", value: workloadByKind.replicaSets.progressing, color: GAUGE_COLOR_WARNING },
                    { label: "Degraded", value: workloadByKind.replicaSets.degraded, color: GAUGE_COLOR_ERROR },
                  ]} />}
                  summary={workloadSignalSummary(workloadByKind.replicaSets)}
                />
              ) : null}
          </Box>
        </Section>
      )}

      {problematic.length > 0 && (
        <Section title="Problematic resources">
          <Table size="small" sx={{ mt: 1 }}>
            <TableHead>
              <TableRow>
                <TableCell>Kind</TableCell>
                <TableCell>Target</TableCell>
                <TableCell>Signal</TableCell>
                <TableCell>Reason</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {problematic.map((resource, index) => (
                <TableRow
                  key={`${resource.kind}-${resource.name}-${index}`}
                  hover
                  sx={{ cursor: "pointer" }}
                  onClick={() => handleProblematic(resource)}
                >
                  <TableCell>
                    <Chip size="small" label={resource.kind} />
                  </TableCell>
                  <TableCell sx={{ fontFamily: "monospace", fontSize: 13 }}>{resource.name}</TableCell>
                  <TableCell>
                    <StatusChip size="small" color={problematicSignalColor(resource.reason)} label="Attention" />
                  </TableCell>
                  <TableCell>{resource.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}

      <Section
        title="Signals"
        actions={suppressedSignalCount > 0 ? (
          <Button
            size="small"
            variant="text"
            aria-expanded={showSuppressed}
            aria-controls="namespace-suppressed-signals"
            onClick={() => setShowSuppressed((current) => !current)}
            sx={{ textTransform: "none" }}
          >
            {showSuppressed ? "Hide" : "Show"} suppressed ({suppressedSignalCount})
          </Button>
        ) : undefined}
      >
        {signals.length === 0 ? (
          <EmptyState message="No namespace signals from cached dataplane scope." />
        ) : (
          <Table size="small" sx={{ mt: 1, width: "100%", tableLayout: "fixed" }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 96 }}>Kind</TableCell>
                <TableCell sx={{ width: 168 }}>Target</TableCell>
                <TableCell sx={{ width: 212 }}>Signal</TableCell>
                <TableCell sx={{ width: 92, whiteSpace: "nowrap" }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.25 }}>
                    <span>Seen</span>
                    <AppIconButton
                      tooltip={`Sort: ${seenSortLabel(seenSortMode)}`}
                      label="Sort signal seen time"
                      sx={{ p: 0.25 }}
                      onClick={(e) => setSeenSortAnchor(e.currentTarget)}
                    >
                      <ArrowDropDownIcon fontSize="inherit" />
                    </AppIconButton>
                  </Box>
                </TableCell>
                <TableCell sx={{ width: "auto" }}>Reason</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedSignals.map((signal, index) => {
                const actionableSignal = signalWithHistoryKey(signal);
                return (
                  <TableRow
                    key={`${signal.kind}-${signal.name || signal.namespace || index}`}
                    hover
                    sx={{ cursor: "pointer" }}
                    onClick={() => handleSignal(signal)}
                    title={signalTooltipText(signal)}
                  >
                    <TableCell>
                      <Chip size="small" label={signal.kind} />
                    </TableCell>
                    <TableCell sx={{ fontFamily: "monospace", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {signalTarget(signal)}
                    </TableCell>
                    <TableCell sx={{ width: 212, whiteSpace: "nowrap" }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "nowrap" }}>
                        <StatusChip size="small" color={signalSeverityColor(signal.severity)} label={signal.severity} />
                        <SignalActions token={token} signal={actionableSignal} onInvestigate={setInvestigationSignal} />
                        {signalHasFocusHint(signal) ? (
                          <AppIconButton
                            label="Open focused resource list"
                            tooltip="Open focused resource list"
                            size="small"
                            sx={{ p: 0.25 }}
                            onClick={(event) => {
                              event.stopPropagation();
                              focusSignalList(signal);
                            }}
                          >
                            <SearchOutlinedIcon fontSize="inherit" />
                          </AppIconButton>
                        ) : null}
                      </Box>
                    </TableCell>
                    <TableCell sx={{ width: 92, whiteSpace: "nowrap" }}>
                      <Box sx={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
                        <Typography variant="caption" color="text.secondary">
                          F {signalFirstSeenText(signal)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          L {signalLastSeenText(signal)}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell sx={{ width: "auto" }}>
                      <Typography variant="body2">{signal.reason}</Typography>
                      {signalCalculatedText(signal) ? (
                        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                          {signalCalculatedText(signal)}
                        </Typography>
                      ) : null}
                      <SignalMemoryHint signal={signal} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <Menu
          anchorEl={seenSortAnchor}
          open={!!seenSortAnchor}
          onClose={() => setSeenSortAnchor(null)}
        >
          <MenuItem selected={seenSortMode === "priority"} onClick={() => { setSeenSortMode("priority"); setSeenSortAnchor(null); }}>
            Priority
          </MenuItem>
          <MenuItem selected={seenSortMode === "first_seen_desc"} onClick={() => { setSeenSortMode("first_seen_desc"); setSeenSortAnchor(null); }}>
            First seen: newest first
          </MenuItem>
          <MenuItem selected={seenSortMode === "first_seen_asc"} onClick={() => { setSeenSortMode("first_seen_asc"); setSeenSortAnchor(null); }}>
            First seen: oldest first
          </MenuItem>
          <MenuItem selected={seenSortMode === "last_seen_desc"} onClick={() => { setSeenSortMode("last_seen_desc"); setSeenSortAnchor(null); }}>
            Last verified: newest first
          </MenuItem>
          <MenuItem selected={seenSortMode === "last_seen_asc"} onClick={() => { setSeenSortMode("last_seen_asc"); setSeenSortAnchor(null); }}>
            Last verified: oldest first
          </MenuItem>
        </Menu>
        {showSuppressed && suppressedSignalCount > 0 ? (
          <Box
            id="namespace-suppressed-signals"
            sx={{ mt: 2, pt: 1.5, borderTop: "1px solid var(--panel-border)" }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Suppressed signals
            </Typography>
            {suppressedSignalCount > suppressedSignals.length ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
                Showing {suppressedSignals.length} of {suppressedSignalCount} suppressed.
              </Typography>
            ) : null}
            <Box sx={{ maxHeight: 360, overflow: "auto", mt: 1 }}>
              <Table size="small" stickyHeader sx={{ width: "100%", minWidth: 720, tableLayout: "fixed" }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: 96 }}>Kind</TableCell>
                    <TableCell sx={{ width: 168 }}>Target</TableCell>
                    <TableCell sx={{ width: 212 }}>Signal</TableCell>
                    <TableCell sx={{ width: "auto" }}>Reason</TableCell>
                    <TableCell sx={{ width: 200 }}>Suppression</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {suppressedSignals.map((signal) => {
                    const actionableSignal = signalWithHistoryKey(signal);
                    return (
                      <TableRow key={`${signal.historyKey || ""}/${signal.kind}/${signal.namespace || ""}/${signal.name || ""}/${signal.reason}`}>
                        <TableCell><Chip size="small" label={signal.kind} /></TableCell>
                        <TableCell sx={{ fontFamily: "monospace", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis" }}>
                          {signalTarget(signal)}
                        </TableCell>
                        <TableCell sx={{ width: 212, whiteSpace: "nowrap" }}>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "nowrap" }}>
                            <StatusChip size="small" color={signalSeverityColor(signal.severity)} label={signal.severity} />
                            <SignalActions token={token} signal={actionableSignal} onInvestigate={setInvestigationSignal} />
                          </Box>
                        </TableCell>
                        <TableCell sx={{ width: "auto" }}>
                          <Typography variant="body2">{signal.reason}</Typography>
                        </TableCell>
                        <TableCell sx={{ width: 200 }}>
                          <Typography variant="body2">{suppressionModeLabel(signal)}</Typography>
                          {suppressionExpiryLabel(signal) ? (
                            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                              Expires {suppressionExpiryLabel(signal)}
                            </Typography>
                          ) : null}
                          {signal.suppression?.comment?.trim() ? (
                            <Typography variant="caption" color="text.secondary" sx={{ display: "block", overflowWrap: "anywhere" }}>
                              Comment: {signal.suppression.comment.trim()}
                            </Typography>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          </Box>
        ) : null}
      </Section>

      {summaryMeta && (
        <Section title="Dataplane status">
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            <ScopedCountChip size="small" label="State" count={formatChipLabel(summaryMeta.state || "unknown")} color={dataplaneCoarseStateChipColor(summaryMeta.state)} />
            <ScopedCountChip size="small" variant="outlined" label="Freshness" count={formatChipLabel(summaryMeta.freshness || "?")} />
            <ScopedCountChip size="small" variant="outlined" label="Coverage" count={formatChipLabel(summaryMeta.coverage || "?")} />
            <ScopedCountChip size="small" variant="outlined" label="Degradation" count={formatChipLabel(summaryMeta.degradation || "?")} />
            <ScopedCountChip size="small" variant="outlined" label="Completeness" count={formatChipLabel(summaryMeta.completeness || "?")} />
          </Box>
        </Section>
      )}
      <SignalInvestigationDialog
        token={token}
        signal={investigationSignal}
        onClose={() => setInvestigationSignal(null)}
      />
    </Box>
  );
}
