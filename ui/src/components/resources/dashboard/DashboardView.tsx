import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import BuildOutlinedIcon from "@mui/icons-material/BuildOutlined";
import HelpOutlineOutlinedIcon from "@mui/icons-material/HelpOutlineOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { apiGet, apiGetWithContext } from "../../../api";
import type { ApiDashboardClusterResponse } from "../../../types/api";
import { namespaceRowSummaryStateColor } from "../../../utils/k8sUi";
import { useActiveContext } from "../../../activeContext";
import { useUserSettings } from "../../../settingsContext";
import NamespaceDrawer from "../namespaces/NamespaceDrawer";
import PodDrawer from "../pods/PodDrawer";
import JobDrawer from "../jobs/JobDrawer";
import CronJobDrawer from "../cronjobs/CronJobDrawer";
import ConfigMapDrawer from "../configmaps/ConfigMapDrawer";
import SecretDrawer from "../secrets/SecretDrawer";
import ServiceAccountDrawer from "../serviceaccounts/ServiceAccountDrawer";
import PersistentVolumeClaimDrawer from "../persistentvolumeclaims/PersistentVolumeClaimDrawer";
import HelmReleaseDrawer from "../helm/HelmReleaseDrawer";
import HelmChartDrawer from "../helm/HelmChartDrawer";
import ServiceDrawer from "../services/ServiceDrawer";
import IngressDrawer from "../ingresses/IngressDrawer";
import RoleDrawer from "../roles/RoleDrawer";
import RoleBindingDrawer from "../rolebindings/RoleBindingDrawer";
import NodeDrawer from "../nodes/NodeDrawer";

type Props = {
  token: string;
  onNavigate?: (section: string, namespace: string) => void;
};

type FindingsPanel = NonNullable<NonNullable<ApiDashboardClusterResponse["item"]>["findings"]>;
type Finding = NonNullable<FindingsPanel["items"]>[number];
type FindingFilter =
  | "top"
  | "high"
  | "medium"
  | "low"
  | "Namespace"
  | "HelmRelease"
  | "Job"
  | "CronJob"
  | "ConfigMap"
  | "Secret"
  | "PersistentVolumeClaim"
  | "ServiceAccount"
  | "Service"
  | "Ingress"
  | "Role"
  | "RoleBinding"
  | "ResourceQuota";

type InspectTarget = {
  kind:
    | "Namespace"
    | "Node"
    | "Pod"
    | "Job"
    | "CronJob"
    | "ConfigMap"
    | "Secret"
    | "ServiceAccount"
    | "PersistentVolumeClaim"
    | "HelmRelease"
    | "Service"
    | "Ingress"
    | "Role"
    | "RoleBinding"
    | "HelmChart";
  namespace: string;
  name: string;
  chart?: {
    chartName: string;
    chartVersion: string;
    appVersion: string;
    releases: number;
    namespaces: string[];
    statuses?: string[];
    needsAttention?: number;
    versions?: Array<{
      chartVersion?: string;
      appVersion?: string;
      releases: number;
      namespaces?: string[];
      statuses?: string[];
      needsAttention?: number;
    }>;
    derived?: boolean;
    derivedSource?: string;
    derivedCoverage?: string;
    derivedNote?: string;
  };
};

type DerivedFilter = "all" | "nodes" | "helm" | "signals";

function stateChipColor(state: string): "success" | "warning" | "error" | "default" {
  return namespaceRowSummaryStateColor(state) as "success" | "warning" | "error" | "default";
}

function severityColor(severity: string): "error" | "warning" | "info" | "default" {
  if (severity === "high") return "error";
  if (severity === "medium") return "warning";
  if (severity === "low") return "info";
  return "default";
}

function formatRestartRatePerDay(value?: number): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "";
  if (value >= 100) return `${Math.round(value)}/day`;
  if (value >= 10) return `${value.toFixed(1)}/day`;
  return `${value.toFixed(1)}/day`;
}

function formatAgeShort(ageSec?: number): string {
  if (ageSec == null || !Number.isFinite(ageSec) || ageSec <= 0) return "";
  if (ageSec < 3600) return `${Math.max(1, Math.round(ageSec / 60))}m`;
  if (ageSec < 86400) return `${(ageSec / 3600).toFixed(1)}h`;
  return `${(ageSec / 86400).toFixed(1)}d`;
}

function formatBytes(value?: number): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let next = value;
  let idx = 0;
  while (next >= 1024 && idx < units.length - 1) {
    next /= 1024;
    idx++;
  }
  return `${next >= 100 || idx === 0 ? Math.round(next) : next.toFixed(1)} ${units[idx]}`;
}

function formatRate(value?: number, suffix = "/min"): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return `0${suffix}`;
  if (value >= 100) return `${Math.round(value)}${suffix}`;
  if (value >= 10) return `${value.toFixed(1)}${suffix}`;
  return `${value.toFixed(2)}${suffix}`;
}

function formatByteRate(value?: number): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "0 B/min";
  return `${formatBytes(value)}/min`;
}

function formatPercent(value?: number): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "0%";
  if (value >= 100) return "100%";
  return `${value.toFixed(1)}%`;
}

function InfoHint({ title }: { title: string }) {
  return (
    <Tooltip title={title}>
      <IconButton size="small" sx={{ p: 0.25 }}>
        <InfoOutlinedIcon fontSize="inherit" />
      </IconButton>
    </Tooltip>
  );
}

function PanelTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
      <Typography variant="subtitle2" color="primary">
        {title}
      </Typography>
      <InfoHint title={hint} />
    </Box>
  );
}

const dashboardPanelSx = {
  p: 2,
  height: "100%",
  display: "flex",
  flexDirection: "column",
  gap: 1.5,
};

const dashboardPanelSectionSx = {
  border: "1px solid var(--panel-border)",
  borderRadius: 1,
  p: 1.25,
  backgroundColor: "var(--bg-secondary)",
};

function FindingHintIcons({ likelyCause, suggestedAction }: { likelyCause?: string; suggestedAction?: string }) {
  if (!likelyCause && !suggestedAction) return null;
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.25, ml: 0.5, verticalAlign: "middle" }}>
      {likelyCause ? (
        <Tooltip title={`Likely cause: ${likelyCause}`}>
          <IconButton size="small" sx={{ p: 0.2 }}>
            <HelpOutlineOutlinedIcon fontSize="inherit" />
          </IconButton>
        </Tooltip>
      ) : null}
      {suggestedAction ? (
        <Tooltip title={`Next step: ${suggestedAction}`}>
          <IconButton size="small" sx={{ p: 0.2 }}>
            <BuildOutlinedIcon fontSize="inherit" />
          </IconButton>
        </Tooltip>
      ) : null}
    </Box>
  );
}

function StatCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <TableRow>
      <TableCell sx={{ border: 0, py: 0.5, pl: 0, color: "text.secondary", width: 240 }}>{label}</TableCell>
      <TableCell sx={{ border: 0, py: 0.5, fontWeight: 600 }}>{value}</TableCell>
    </TableRow>
  );
}

function MetricCard({
  label,
  value,
  color = "default",
  hint,
}: {
  label: string;
  value: React.ReactNode;
  color?: "success" | "warning" | "error" | "info" | "default";
  hint?: string;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, minWidth: 160, flex: "1 1 160px" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        {hint ? <InfoHint title={hint} /> : null}
      </Box>
      <Typography variant="h5" sx={{ mt: 0.5, color: color === "default" ? undefined : `${color}.main` }}>
        {value}
      </Typography>
    </Paper>
  );
}

type BarSegment = {
  label: string;
  value: number;
  color: string;
};

function StackedMetricBar({ segments }: { segments: BarSegment[] }) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value || 0), 0);
  if (total <= 0) {
    return (
      <Box
        sx={{
          height: 18,
          borderRadius: 999,
          border: "1px solid var(--panel-border)",
          backgroundColor: "rgba(0,0,0,0.05)",
        }}
      />
    );
  }
  return (
    <Box
      sx={{
        display: "flex",
        width: "100%",
        height: 18,
        overflow: "hidden",
        borderRadius: 999,
        border: "1px solid var(--panel-border)",
        backgroundColor: "rgba(0,0,0,0.04)",
      }}
    >
      {segments
        .filter((segment) => segment.value > 0)
        .map((segment) => (
          <Tooltip key={segment.label} title={`${segment.label}: ${segment.value}`}>
            <Box
              sx={{
                width: `${(segment.value / total) * 100}%`,
                backgroundColor: segment.color,
                minWidth: segment.value > 0 ? 8 : 0,
              }}
            />
          </Tooltip>
        ))}
    </Box>
  );
}

function MetricGauge({
  value,
  color,
  trackColor = "rgba(0,0,0,0.08)",
}: {
  value: number;
  color: string;
  trackColor?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <Box
      sx={{
        position: "relative",
        width: "100%",
        height: 18,
        borderRadius: 999,
        overflow: "hidden",
        border: "1px solid var(--panel-border)",
        backgroundColor: trackColor,
      }}
    >
      <Box
        sx={{
          width: `${clamped}%`,
          height: "100%",
          borderRadius: 999,
          backgroundColor: color,
        }}
      />
    </Box>
  );
}

function DataplaneVisualRow({
  label,
  hint,
  visual,
  summary,
}: {
  label: string;
  hint?: string;
  visual: React.ReactNode;
  summary: React.ReactNode;
}) {
  return (
    <TableRow>
      <TableCell sx={{ width: "24%", py: 0.8, pl: 0, fontWeight: 600, border: 0 }}>
        <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
          <span>{label}</span>
          {hint ? <InfoHint title={hint} /> : null}
        </Box>
      </TableCell>
      <TableCell sx={{ width: "46%", py: 0.8, border: 0 }}>{visual}</TableCell>
      <TableCell sx={{ width: "30%", py: 0.8, pr: 0, textAlign: "right", whiteSpace: "nowrap", border: 0 }}>
        {summary}
      </TableCell>
    </TableRow>
  );
}

function findingTarget(f: Finding): string {
  if (!f.name) return f.namespace || f.kind;
  return f.namespace ? `${f.namespace}/${f.name}` : f.name;
}

function findingFilterLabel(filter: FindingFilter): string {
  switch (filter) {
    case "top":
      return "Top priority";
    case "high":
      return "High severity";
    case "medium":
      return "Medium severity";
    case "low":
      return "Low severity";
    case "Namespace":
      return "Empty namespaces";
    case "HelmRelease":
      return "Stuck Helm releases";
    case "Job":
      return "Jobs";
    case "CronJob":
      return "CronJobs";
    case "ConfigMap":
      return "Empty ConfigMaps";
    case "Secret":
      return "Empty Secrets";
    case "PersistentVolumeClaim":
      return "PVCs";
    case "ServiceAccount":
      return "Potentially unused service accounts";
    case "Service":
      return "Service endpoints";
    case "Ingress":
      return "Ingress routing";
    case "Role":
      return "Roles";
    case "RoleBinding":
      return "RoleBindings";
    case "ResourceQuota":
      return "Quota pressure";
    default:
      return filter;
  }
}

function FindingFilterChip({
  filter,
  count,
  color = "default",
  hideWhenZero = false,
  selected,
  onSelect,
}: {
  filter: FindingFilter;
  count: number;
  color?: "error" | "warning" | "info" | "default";
  hideWhenZero?: boolean;
  selected: boolean;
  onSelect: (filter: FindingFilter) => void;
}) {
  if (hideWhenZero && count <= 0 && !selected) return null;
  return (
    <Chip
      size="small"
      color={color}
      variant={selected ? "filled" : "outlined"}
      label={`${findingFilterLabel(filter)} ${count}`}
      onClick={() => onSelect(filter)}
    />
  );
}

function derivedFilterLabel(filter: DerivedFilter): string {
  switch (filter) {
    case "all":
      return "All derived";
    case "nodes":
      return "Nodes";
    case "helm":
      return "Helm charts";
    case "signals":
      return "With signals";
    default:
      return filter;
  }
}

function DerivedFilterChip({
  filter,
  count,
  selected,
  onSelect,
}: {
  filter: DerivedFilter;
  count: number;
  selected: boolean;
  onSelect: (filter: DerivedFilter) => void;
}) {
  return (
    <Chip
      size="small"
      color={filter === "signals" && count > 0 ? "warning" : "default"}
      variant={selected ? "filled" : "outlined"}
      label={`${derivedFilterLabel(filter)} ${count}`}
      onClick={() => onSelect(filter)}
    />
  );
}

function inspectTargetFromFinding(f: Finding): InspectTarget | null {
  const namespace = f.namespace || "";
  const name = f.name || (f.kind === "Namespace" ? namespace : "");
  if (!namespace || !name) return null;
  switch (f.kind) {
    case "Namespace":
    case "Job":
    case "CronJob":
    case "ConfigMap":
    case "Secret":
    case "ServiceAccount":
    case "PersistentVolumeClaim":
    case "HelmRelease":
    case "Service":
    case "Ingress":
    case "Role":
    case "RoleBinding":
      return { kind: f.kind, namespace, name };
    case "ResourceQuota":
      return { kind: "Namespace", namespace, name: namespace };
    default:
      return null;
  }
}

function DashboardInspectDrawers({
  token,
  target,
  onClose,
  onNavigate,
}: {
  token: string;
  target: InspectTarget | null;
  onClose: () => void;
  onNavigate?: (section: string, namespace: string) => void;
}) {
  const open = !!target;
  const namespace = target?.namespace || "";
  const name = target?.name || null;

  return (
    <>
      <NamespaceDrawer
        open={open && target?.kind === "Namespace"}
        onClose={onClose}
        token={token}
        namespaceName={target?.kind === "Namespace" ? name : null}
        onNavigate={onNavigate}
      />
      <PodDrawer
        open={open && target?.kind === "Pod"}
        onClose={onClose}
        token={token}
        namespace={namespace}
        podName={target?.kind === "Pod" ? name : null}
      />
      <NodeDrawer
        open={open && target?.kind === "Node"}
        onClose={onClose}
        token={token}
        nodeName={target?.kind === "Node" ? name : null}
      />
      <JobDrawer
        open={open && target?.kind === "Job"}
        onClose={onClose}
        token={token}
        namespace={namespace}
        jobName={target?.kind === "Job" ? name : null}
      />
      <CronJobDrawer
        open={open && target?.kind === "CronJob"}
        onClose={onClose}
        token={token}
        namespace={namespace}
        cronJobName={target?.kind === "CronJob" ? name : null}
      />
      <ConfigMapDrawer
        open={open && target?.kind === "ConfigMap"}
        onClose={onClose}
        token={token}
        namespace={namespace}
        configMapName={target?.kind === "ConfigMap" ? name : null}
      />
      <SecretDrawer
        open={open && target?.kind === "Secret"}
        onClose={onClose}
        token={token}
        namespace={namespace}
        secretName={target?.kind === "Secret" ? name : null}
      />
      <ServiceAccountDrawer
        open={open && target?.kind === "ServiceAccount"}
        onClose={onClose}
        token={token}
        namespace={namespace}
        serviceAccountName={target?.kind === "ServiceAccount" ? name : null}
      />
      <PersistentVolumeClaimDrawer
        open={open && target?.kind === "PersistentVolumeClaim"}
        onClose={onClose}
        token={token}
        namespace={namespace}
        persistentVolumeClaimName={target?.kind === "PersistentVolumeClaim" ? name : null}
      />
      <HelmReleaseDrawer
        open={open && target?.kind === "HelmRelease"}
        onClose={onClose}
        token={token}
        namespace={namespace}
        releaseName={target?.kind === "HelmRelease" ? name : null}
      />
      <HelmChartDrawer
        open={open && target?.kind === "HelmChart"}
        onClose={onClose}
        token={token}
        chart={target?.kind === "HelmChart" ? target.chart || null : null}
      />
      <ServiceDrawer
        open={open && target?.kind === "Service"}
        onClose={onClose}
        token={token}
        namespace={namespace}
        serviceName={target?.kind === "Service" ? name : null}
      />
      <IngressDrawer
        open={open && target?.kind === "Ingress"}
        onClose={onClose}
        token={token}
        namespace={namespace}
        ingressName={target?.kind === "Ingress" ? name : null}
      />
      <RoleDrawer
        open={open && target?.kind === "Role"}
        onClose={onClose}
        token={token}
        namespace={namespace}
        roleName={target?.kind === "Role" ? name : null}
      />
      <RoleBindingDrawer
        open={open && target?.kind === "RoleBinding"}
        onClose={onClose}
        token={token}
        namespace={namespace}
        roleBindingName={target?.kind === "RoleBinding" ? name : null}
      />
    </>
  );
}

export default function DashboardView(props: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ApiDashboardClusterResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [findingFilter, setFindingFilter] = useState<FindingFilter>("top");
  const [findingsQuery, setFindingsQuery] = useState("");
  const [findingsPage, setFindingsPage] = useState(0);
  const [findingsRowsPerPage, setFindingsRowsPerPage] = useState(10);
  const [restartHotspotsQuery, setRestartHotspotsQuery] = useState("");
  const [restartHotspotsPage, setRestartHotspotsPage] = useState(0);
  const [restartHotspotsRowsPerPage, setRestartHotspotsRowsPerPage] = useState(10);
  const [derivedFilter, setDerivedFilter] = useState<DerivedFilter>("all");
  const [derivedQuery, setDerivedQuery] = useState("");
  const [derivedPage, setDerivedPage] = useState(0);
  const [derivedRowsPerPage, setDerivedRowsPerPage] = useState(10);
  const [inspectTarget, setInspectTarget] = useState<InspectTarget | null>(null);
  const activeContext = useActiveContext();
  const { settings } = useUserSettings();
  const dashboardRefreshSec = settings.appearance.dashboardRefreshSec;
  const deferredFindingsQuery = useDeferredValue(findingsQuery);
  const deferredRestartHotspotsQuery = useDeferredValue(restartHotspotsQuery);
  const deferredDerivedQuery = useDeferredValue(derivedQuery);
  const lastLoadScopeRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    const loadScope = `${activeContext || ""}:${props.token}`;
    const load = async (initial: boolean) => {
      const resetView = initial && lastLoadScopeRef.current !== loadScope;
      if (resetView) {
        setLoading(true);
        setData(null);
      }
      setErr(null);
      try {
        const params = new URLSearchParams({
          findingsFilter: findingFilter,
          findingsQ: deferredFindingsQuery,
          findingsOffset: String(findingsPage * findingsRowsPerPage),
          findingsLimit: String(findingsRowsPerPage),
          restartHotspotsQ: deferredRestartHotspotsQuery,
          restartHotspotsOffset: String(restartHotspotsPage * restartHotspotsRowsPerPage),
          restartHotspotsLimit: String(restartHotspotsRowsPerPage),
        });
        const path = `/api/dashboard/cluster?${params.toString()}`;
        const res = activeContext
          ? await apiGetWithContext<ApiDashboardClusterResponse>(path, props.token, activeContext)
          : await apiGet<ApiDashboardClusterResponse>(path, props.token);
        if (!cancelled) {
          lastLoadScopeRef.current = loadScope;
          setData(res);
        }
      } catch {
        if (!cancelled) setErr("Failed to load cluster overview");
      } finally {
        if (!cancelled && resetView) setLoading(false);
      }
    };
    void load(true);
    if (dashboardRefreshSec <= 0) {
      return () => {
        cancelled = true;
      };
    }
    const id = window.setInterval(() => void load(false), dashboardRefreshSec * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [
    activeContext,
    dashboardRefreshSec,
    deferredFindingsQuery,
    deferredRestartHotspotsQuery,
    findingFilter,
    findingsPage,
    findingsRowsPerPage,
    props.token,
    restartHotspotsPage,
    restartHotspotsRowsPerPage,
  ]);

  const selectFindingFilter = (filter: FindingFilter) => {
    setFindingFilter(filter);
    setFindingsPage(0);
  };

  const selectDerivedFilter = (filter: DerivedFilter) => {
    setDerivedFilter(filter);
    setDerivedPage(0);
  };

  const derivedRows = useMemo(() => {
    const derived = data?.item?.derived;
    if (!derived) return [];
    const nodeRows = (derived.nodes.nodes || []).map((node) => ({
      type: "nodes" as const,
      key: `node/${node.name}`,
      primary: node.name,
      secondary: `${node.namespaceCount} namespace${node.namespaceCount === 1 ? "" : "s"} · ${node.runningPods}/${node.pods} running`,
      metric: `${node.restartCount} restarts · ${node.elevatedRestartPods} elevated`,
      signals: node.problematicPods,
      severity: node.severity,
      target: { kind: "Node" as const, namespace: "", name: node.name },
    }));
    const chartRows = (derived.helmCharts.charts || []).map((chart) => {
      const versionLabel = chart.versions && chart.versions.length > 1
        ? `${chart.versions.length} versions`
        : chart.versions?.[0]?.chartVersion || "unknown version";
      return {
        type: "helm" as const,
        key: `helm/${chart.chartName}`,
        primary: chart.chartName,
        secondary: `${versionLabel} · ${chart.namespaceCount} namespace${chart.namespaceCount === 1 ? "" : "s"}`,
        metric: `${chart.releases} release${chart.releases === 1 ? "" : "s"}`,
        signals: chart.needsAttention || 0,
        severity: chart.needsAttention ? "medium" : "low",
        target: {
          kind: "HelmChart" as const,
          namespace: "",
          name: chart.chartName,
          chart: {
            chartName: chart.chartName,
            chartVersion: chart.versions && chart.versions.length > 1 ? "multiple" : chart.versions?.[0]?.chartVersion || "",
            appVersion: chart.versions && chart.versions.length > 1 ? "multiple" : chart.versions?.[0]?.appVersion || "",
            releases: chart.releases,
            namespaces: chart.namespaces || [],
            statuses: chart.statuses,
            needsAttention: chart.needsAttention,
            versions: chart.versions,
            derived: true,
            derivedSource: derived.helmCharts.meta.source,
            derivedCoverage: derived.helmCharts.meta.coverage,
            derivedNote: derived.helmCharts.meta.note,
          },
        },
      };
    });
    return [...nodeRows, ...chartRows];
  }, [data?.item?.derived]);

  const filteredDerivedRows = useMemo(() => {
    const q = deferredDerivedQuery.trim().toLowerCase();
    return derivedRows.filter((row) => {
      if (derivedFilter === "nodes" && row.type !== "nodes") return false;
      if (derivedFilter === "helm" && row.type !== "helm") return false;
      if (derivedFilter === "signals" && row.signals <= 0) return false;
      if (!q) return true;
      return (
        row.primary.toLowerCase().includes(q) ||
        row.secondary.toLowerCase().includes(q) ||
        row.metric.toLowerCase().includes(q) ||
        row.type.includes(q)
      );
    });
  }, [deferredDerivedQuery, derivedFilter, derivedRows]);

  const visibleDerivedRows = useMemo(
    () => filteredDerivedRows.slice(derivedPage * derivedRowsPerPage, derivedPage * derivedRowsPerPage + derivedRowsPerPage),
    [derivedPage, derivedRowsPerPage, filteredDerivedRows],
  );

  return (
    <Box
      className="kview-dashboard-root"
      sx={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        width: "100%",
        maxWidth: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        overflowY: "auto",
        overflowX: "hidden",
        pb: 2,
        boxSizing: "border-box",
      }}
    >
      <Box sx={{ px: 2, pt: 1, display: "flex", alignItems: "center", gap: 0.75 }}>
        <Typography variant="h6">Cluster dashboard</Typography>
        <InfoHint title="Dataplane snapshot view. Resource totals and findings use cached namespace list snapshots only; unknown namespaces are not inferred." />
      </Box>

      {loading && (
        <Box sx={{ px: 2, display: "flex", alignItems: "center", gap: 1 }}>
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">
            Loading...
          </Typography>
        </Box>
      )}

      {err && (
        <Typography color="error" sx={{ px: 2 }}>
          {err}
        </Typography>
      )}

      {!loading && !err && data?.item && (
        <Box sx={{ px: 2, display: "flex", flexDirection: "column", gap: 2 }}>
          {(() => {
            const { plane, visibility, coverage, resources, hotspots, findings, derived, dataplane } = data.item;
            const ns = visibility.namespaces;
            const nodes = visibility.nodes;
            const cov = coverage;
            const hotspotsEnabled = settings.dataplane.dashboard.includeHotspots;
            const knownScope = `${cov.namespacesInResourceTotals} / ${cov.visibleNamespaces}`;
            const topFindings = findings?.top || [];
            const visibleFindings = findings?.items || [];
            const visibleFindingsTotal = findings?.itemsTotal ?? visibleFindings.length;
            const visibleRestartHotspots = hotspots.topPodRestartHotspots || [];
            const visibleRestartHotspotsTotal = hotspots.restartHotspotsTotal ?? visibleRestartHotspots.length;

            return (
              <>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                  <MetricCard
                    label="Findings"
                    value={findings?.total ?? 0}
                    color={(findings?.high || 0) > 0 ? "error" : (findings?.medium || 0) > 0 ? "warning" : "success"}
                    hint="Heuristic findings from cached namespace snapshots."
                  />
                  <MetricCard
                    label="Known namespace scope"
                    value={knownScope}
                    color={cov.resourceTotalsCompleteness === "complete" ? "success" : "warning"}
                    hint="Namespaces included in resource totals and findings."
                  />
                  <MetricCard
                    label="Elevated pod restarts"
                    value={hotspotsEnabled ? hotspots.podsWithElevatedRestarts : "off"}
                    color={hotspots.highSeverityHotspotsInTopN > 0 ? "error" : hotspots.podsWithElevatedRestarts > 0 ? "warning" : "success"}
                    hint={`Pods above ${settings.dataplane.dashboard.restartElevatedThreshold} restarts in cached scope.`}
                  />
                  <MetricCard
                    label="Namespace list"
                    value={`${ns.total} ns`}
                    color={stateChipColor(ns.state) === "default" ? "default" : stateChipColor(ns.state)}
                    hint={`State ${ns.state}, freshness ${ns.freshness}, observer ${ns.observerState || "unknown"}.`}
                  />
                  <MetricCard
                    label="Nodes"
                    value={nodes.total}
                    color={stateChipColor(nodes.state) === "default" ? "default" : stateChipColor(nodes.state)}
                    hint={`State ${nodes.state}, freshness ${nodes.freshness}, observer ${nodes.observerState || "unknown"}.`}
                  />
                </Box>

                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" },
                    gap: 2,
                    alignItems: "stretch",
                  }}
                >
                  <Paper variant="outlined" sx={dashboardPanelSx}>
                    <PanelTitle
                      title="Attention"
                      hint={findings?.note || "Click a chip to filter the list. Top priority is capped; category chips show all matching cached-scope findings."}
                    />
                    <Box sx={dashboardPanelSectionSx}>
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                        Filter cached-scope findings by severity or resource type.
                      </Typography>
                      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                        <FindingFilterChip
                          filter="top"
                          count={topFindings.length}
                          selected={findingFilter === "top"}
                          onSelect={selectFindingFilter}
                        />
                        <FindingFilterChip
                          filter="high"
                          count={findings?.high ?? 0}
                          color={(findings?.high || 0) > 0 ? "error" : "default"}
                          selected={findingFilter === "high"}
                          onSelect={selectFindingFilter}
                        />
                        <FindingFilterChip
                          filter="medium"
                          count={findings?.medium ?? 0}
                          color={(findings?.medium || 0) > 0 ? "warning" : "default"}
                          selected={findingFilter === "medium"}
                          onSelect={selectFindingFilter}
                        />
                        <FindingFilterChip
                          filter="low"
                          count={findings?.low ?? 0}
                          color={(findings?.low || 0) > 0 ? "info" : "default"}
                          selected={findingFilter === "low"}
                          onSelect={selectFindingFilter}
                        />
                        <FindingFilterChip
                          filter="Namespace"
                          count={findings?.emptyNamespaces ?? 0}
                          hideWhenZero
                          selected={findingFilter === "Namespace"}
                          onSelect={selectFindingFilter}
                        />
                        <FindingFilterChip
                          filter="HelmRelease"
                          count={findings?.stuckHelmReleases ?? 0}
                          hideWhenZero
                          selected={findingFilter === "HelmRelease"}
                          onSelect={selectFindingFilter}
                        />
                        <FindingFilterChip
                          filter="Job"
                          count={findings?.abnormalJobs ?? 0}
                          hideWhenZero
                          selected={findingFilter === "Job"}
                          onSelect={selectFindingFilter}
                        />
                        <FindingFilterChip
                          filter="CronJob"
                          count={findings?.abnormalCronJobs ?? 0}
                          hideWhenZero
                          selected={findingFilter === "CronJob"}
                          onSelect={selectFindingFilter}
                        />
                        <FindingFilterChip
                          filter="ConfigMap"
                          count={findings?.emptyConfigMaps ?? 0}
                          hideWhenZero
                          selected={findingFilter === "ConfigMap"}
                          onSelect={selectFindingFilter}
                        />
                        <FindingFilterChip
                          filter="Secret"
                          count={findings?.emptySecrets ?? 0}
                          hideWhenZero
                          selected={findingFilter === "Secret"}
                          onSelect={selectFindingFilter}
                        />
                        <FindingFilterChip
                          filter="PersistentVolumeClaim"
                          count={(findings?.potentiallyUnusedPVCs ?? 0) + (findings?.pvcWarnings ?? 0)}
                          hideWhenZero
                          selected={findingFilter === "PersistentVolumeClaim"}
                          onSelect={selectFindingFilter}
                        />
                        <FindingFilterChip
                          filter="ServiceAccount"
                          count={findings?.potentiallyUnusedServiceAccounts ?? 0}
                          hideWhenZero
                          selected={findingFilter === "ServiceAccount"}
                          onSelect={selectFindingFilter}
                        />
                        <FindingFilterChip
                          filter="Service"
                          count={findings?.serviceWarnings ?? 0}
                          hideWhenZero
                          selected={findingFilter === "Service"}
                          onSelect={selectFindingFilter}
                        />
                        <FindingFilterChip
                          filter="Ingress"
                          count={findings?.ingressWarnings ?? 0}
                          hideWhenZero
                          selected={findingFilter === "Ingress"}
                          onSelect={selectFindingFilter}
                        />
                        <FindingFilterChip
                          filter="Role"
                          count={findings?.roleWarnings ?? 0}
                          hideWhenZero
                          selected={findingFilter === "Role"}
                          onSelect={selectFindingFilter}
                        />
                        <FindingFilterChip
                          filter="RoleBinding"
                          count={findings?.roleBindingWarnings ?? 0}
                          hideWhenZero
                          selected={findingFilter === "RoleBinding"}
                          onSelect={selectFindingFilter}
                        />
                        <FindingFilterChip
                          filter="ResourceQuota"
                          count={findings?.quotaWarnings ?? 0}
                          color={(findings?.quotaWarnings || 0) > 0 ? "warning" : "default"}
                          hideWhenZero
                          selected={findingFilter === "ResourceQuota"}
                          onSelect={selectFindingFilter}
                        />
                      </Box>
                    </Box>
                    <Box sx={{ ...dashboardPanelSectionSx, flex: 1 }}>
                      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1, mb: 1 }}>
                        <TextField
                          size="small"
                          label="Search findings"
                          value={findingsQuery}
                          onChange={(event) => {
                            setFindingsQuery(event.target.value);
                            setFindingsPage(0);
                          }}
                          placeholder="name, kind, namespace..."
                          sx={{ minWidth: { xs: "100%", sm: 280 } }}
                        />
                        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                          Showing {visibleFindings.length} of {visibleFindingsTotal} {findingFilterLabel(findingFilter).toLowerCase()} finding
                          {visibleFindingsTotal === 1 ? "" : "s"}.
                        </Typography>
                      </Box>
                      {visibleFindings.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          No cached-scope findings for this filter.
                        </Typography>
                      ) : (
                        <Table size="small">
                          <TableBody>
                            {visibleFindings.map((f) => (
                              <TableRow key={`${f.kind}/${f.namespace || ""}/${f.name || ""}/${f.reason}`}>
                                <TableCell sx={{ border: 0, py: 0.6, pl: 0, width: 118, verticalAlign: "top" }}>
                                  <Chip size="small" color={severityColor(f.severity)} label={f.severity} />
                                </TableCell>
                                <TableCell sx={{ border: 0, py: 0.6, verticalAlign: "top" }}>
                                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                    {f.kind} {findingTarget(f)}
                                    <FindingHintIcons likelyCause={f.likelyCause} suggestedAction={f.suggestedAction} />
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    {f.reason} {f.confidence ? `Confidence: ${f.confidence}.` : ""}
                                  </Typography>
                                </TableCell>
                                <TableCell sx={{ border: 0, py: 0.6, pr: 0, textAlign: "right", width: 110, verticalAlign: "top" }}>
                                  {inspectTargetFromFinding(f) ? (
                                    <Button
                                      size="small"
                                      variant="outlined"
                                      onClick={() => setInspectTarget(inspectTargetFromFinding(f))}
                                    >
                                      Inspect
                                    </Button>
                                  ) : null}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                      {visibleFindingsTotal > 0 ? (
                        <TablePagination
                          component="div"
                          count={visibleFindingsTotal}
                          page={findingsPage}
                          rowsPerPage={findingsRowsPerPage}
                          rowsPerPageOptions={[10, 25, 50, 100]}
                          onPageChange={(_, page) => setFindingsPage(page)}
                          onRowsPerPageChange={(event) => {
                            setFindingsRowsPerPage(Number(event.target.value));
                            setFindingsPage(0);
                          }}
                          sx={{ borderTop: "1px solid var(--panel-border)", mt: 1 }}
                        />
                      ) : null}
                    </Box>
                  </Paper>

                  {hotspotsEnabled && (hotspots.topProblematicNamespaces?.length || hotspots.podsWithElevatedRestarts > 0) ? (
                    <Paper variant="outlined" sx={dashboardPanelSx}>
                      <PanelTitle
                        title="Hotspots"
                        hint="Compatibility view for restart-heavy pods and older problematic-resource scoring."
                      />
                      {hotspots.topProblematicNamespaces && hotspots.topProblematicNamespaces.length > 0 ? (
                        <Box sx={dashboardPanelSectionSx}>
                          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75 }}>
                            Namespaces with the most flagged resources
                          </Typography>
                          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                            {hotspots.topProblematicNamespaces.map((t) => (
                              <Chip
                                key={t.namespace}
                                size="small"
                                label={`${t.namespace}: ${t.score}`}
                                color="warning"
                                variant="outlined"
                                onClick={() => setInspectTarget({ kind: "Namespace", namespace: t.namespace, name: t.namespace })}
                              />
                            ))}
                          </Box>
                        </Box>
                      ) : null}
                      <Box sx={{ ...dashboardPanelSectionSx, flex: 1 }}>
                        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1, mb: 1 }}>
                          <TextField
                            size="small"
                            label="Search restart hotspots"
                            value={restartHotspotsQuery}
                            onChange={(event) => {
                              setRestartHotspotsQuery(event.target.value);
                              setRestartHotspotsPage(0);
                            }}
                            placeholder="pod, namespace, node..."
                            sx={{ minWidth: { xs: "100%", sm: 280 } }}
                          />
                          <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                            Showing {visibleRestartHotspots.length} of {visibleRestartHotspotsTotal} pod restart hotspot
                            {visibleRestartHotspotsTotal === 1 ? "" : "s"} in cached scope.
                          </Typography>
                        </Box>
                        {visibleRestartHotspots.length > 0 ? (
                          <Table size="small">
                            <TableBody>
                              {visibleRestartHotspots.map((h) => (
                                <TableRow key={`${h.namespace}/${h.name}`}>
                                  <TableCell sx={{ border: 0, py: 0.5, pl: 0, verticalAlign: "top" }}>
                                    <Box sx={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                                      <Typography
                                        component="button"
                                        type="button"
                                        variant="body2"
                                        onClick={() => setInspectTarget({ kind: "Pod", namespace: h.namespace, name: h.name })}
                                        sx={{
                                          border: 0,
                                          p: 0,
                                          background: "transparent",
                                          color: "primary.main",
                                          cursor: "pointer",
                                          font: "inherit",
                                          fontWeight: 600,
                                          textAlign: "left",
                                        }}
                                      >
                                        {h.name}
                                      </Typography>
                                      <Typography
                                        component="button"
                                        type="button"
                                        variant="caption"
                                        color="text.secondary"
                                        onClick={() => setInspectTarget({ kind: "Namespace", namespace: h.namespace, name: h.namespace })}
                                        sx={{
                                          border: 0,
                                          p: 0,
                                          background: "transparent",
                                          cursor: "pointer",
                                          font: "inherit",
                                          textAlign: "left",
                                        }}
                                      >
                                        {h.namespace}
                                      </Typography>
                                    </Box>
                                  </TableCell>
                                  <TableCell sx={{ border: 0, py: 0.5, verticalAlign: "top" }}>
                                    <Box sx={{ display: "flex", flexDirection: "column" }}>
                                      <Typography variant="body2">
                                        {h.restartRatePerDay ? formatRestartRatePerDay(h.restartRatePerDay) : `${h.restarts} restarts`}
                                      </Typography>
                                      <Typography variant="caption" color="text.secondary">
                                        {h.restarts} restarts
                                        {h.ageSec ? ` · age ${formatAgeShort(h.ageSec)}` : ""}
                                      </Typography>
                                    </Box>
                                  </TableCell>
                                  <TableCell sx={{ border: 0, py: 0.5, verticalAlign: "top", width: 92 }}>
                                    <Chip size="small" label={h.severity} color={h.severity === "high" ? "error" : "warning"} />
                                  </TableCell>
                                  <TableCell sx={{ border: 0, py: 0.5, pr: 0, textAlign: "right", verticalAlign: "top", width: 110 }}>
                                    <Button
                                      size="small"
                                      variant="outlined"
                                      onClick={() => setInspectTarget({ kind: "Pod", namespace: h.namespace, name: h.name })}
                                    >
                                      Inspect
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            No restart hotspots match this search.
                          </Typography>
                        )}
                        {visibleRestartHotspotsTotal > 0 ? (
                          <TablePagination
                            component="div"
                            count={visibleRestartHotspotsTotal}
                            page={restartHotspotsPage}
                            rowsPerPage={restartHotspotsRowsPerPage}
                            rowsPerPageOptions={[10, 25, 50, 100]}
                            onPageChange={(_, page) => setRestartHotspotsPage(page)}
                            onRowsPerPageChange={(event) => {
                              setRestartHotspotsRowsPerPage(Number(event.target.value));
                              setRestartHotspotsPage(0);
                            }}
                            sx={{ borderTop: "1px solid var(--panel-border)", mt: 1 }}
                          />
                        ) : null}
                      </Box>
                    </Paper>
                  ) : null}
                </Box>

                <Paper variant="outlined" sx={{ p: 2 }}>
                  <PanelTitle
                    title="Known Resources"
                    hint="Resource counts are not inferred cluster totals; they are summed from cached namespace list snapshots."
                  />
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
                    {resources.aggregateFreshness ? <Chip size="small" variant="outlined" label={`Freshness ${resources.aggregateFreshness}`} /> : null}
                    {resources.aggregateDegradation && resources.aggregateDegradation !== "none" ? (
                      <Chip size="small" color="warning" variant="outlined" label={`Degradation ${resources.aggregateDegradation}`} />
                    ) : null}
                  </Box>
                  <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 1 }}>
                    {[
                      ["Pods", resources.pods],
                      ["Deployments", resources.deployments],
                      ["DaemonSets", resources.daemonSets],
                      ["StatefulSets", resources.statefulSets],
                      ["ReplicaSets", resources.replicaSets],
                      ["Jobs", resources.jobs],
                      ["CronJobs", resources.cronJobs],
                      ["Services", resources.services],
                      ["Ingresses", resources.ingresses],
                      ["PVCs", resources.persistentVolumeClaims],
                      ["ConfigMaps", resources.configMaps],
                      ["Secrets", resources.secrets],
                      ["ServiceAccounts", resources.serviceAccounts],
                      ["Roles", resources.roles],
                      ["RoleBindings", resources.roleBindings],
                      ["HelmReleases", resources.helmReleases],
                      ["ResourceQuotas", resources.resourceQuotas],
                      ["LimitRanges", resources.limitRanges],
                    ].map(([label, value]) => (
                      <Box key={label} sx={{ border: "1px solid var(--panel-border)", borderRadius: 1, p: 1 }}>
                        <Typography variant="caption" color="text.secondary">
                          {label}
                        </Typography>
                        <Typography variant="h6">{value}</Typography>
                      </Box>
                    ))}
                  </Box>
                </Paper>

                {derived ? (
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <PanelTitle
                      title="Derived Signals"
                      hint="Explicitly derived projections from cached dataplane snapshots. These do not perform hidden live Kubernetes reads and may be sparse."
                    />
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
                      <Chip size="small" variant="outlined" label={`Node source ${derived.nodes.meta.source}`} />
                      <Chip size="small" variant="outlined" label={`Helm source ${derived.helmCharts.meta.source}`} />
                      <Chip size="small" color="warning" variant="outlined" label="Sparse / inexact" />
                    </Box>
                    <Box sx={dashboardPanelSectionSx}>
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                        Filter sparse derived node and Helm chart rows. These rows preserve the normal Nodes and Helm Charts inspect targets.
                      </Typography>
                      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
                        <DerivedFilterChip filter="all" count={derivedRows.length} selected={derivedFilter === "all"} onSelect={selectDerivedFilter} />
                        <DerivedFilterChip filter="nodes" count={derived.nodes.total} selected={derivedFilter === "nodes"} onSelect={selectDerivedFilter} />
                        <DerivedFilterChip filter="helm" count={derived.helmCharts.total} selected={derivedFilter === "helm"} onSelect={selectDerivedFilter} />
                        <DerivedFilterChip
                          filter="signals"
                          count={derivedRows.filter((row) => row.signals > 0).length}
                          selected={derivedFilter === "signals"}
                          onSelect={selectDerivedFilter}
                        />
                      </Box>
                      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1, mb: 1 }}>
                        <TextField
                          size="small"
                          label="Search derived signals"
                          value={derivedQuery}
                          onChange={(event) => {
                            setDerivedQuery(event.target.value);
                            setDerivedPage(0);
                          }}
                          placeholder="node, chart, version..."
                          sx={{ minWidth: { xs: "100%", sm: 280 } }}
                        />
                        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                          Showing {visibleDerivedRows.length} of {filteredDerivedRows.length} derived row
                          {filteredDerivedRows.length === 1 ? "" : "s"}.
                        </Typography>
                      </Box>
                      {visibleDerivedRows.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          No derived rows match this filter.
                        </Typography>
                      ) : (
                        <Table size="small">
                          <TableBody>
                            {visibleDerivedRows.map((row) => (
                              <TableRow key={row.key} hover onClick={() => setInspectTarget(row.target)} sx={{ cursor: "pointer" }}>
                                <TableCell sx={{ border: 0, py: 0.6, pl: 0, width: 120, verticalAlign: "top" }}>
                                  <Chip size="small" label={row.type === "nodes" ? "Node" : "Helm chart"} variant="outlined" />
                                </TableCell>
                                <TableCell sx={{ border: 0, py: 0.6, verticalAlign: "top" }}>
                                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                    {row.primary}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    {row.secondary}
                                  </Typography>
                                </TableCell>
                                <TableCell sx={{ border: 0, py: 0.6, verticalAlign: "top" }}>
                                  {row.metric}
                                </TableCell>
                                <TableCell sx={{ border: 0, py: 0.6, verticalAlign: "top", width: 120 }}>
                                  {row.signals > 0 ? (
                                    <Chip
                                      size="small"
                                      color={severityColor(row.severity)}
                                      label={`${row.signals} signal${row.signals === 1 ? "" : "s"}`}
                                    />
                                  ) : (
                                    <Typography variant="caption" color="text.secondary">
                                      -
                                    </Typography>
                                  )}
                                </TableCell>
                                <TableCell sx={{ border: 0, py: 0.6, pr: 0, textAlign: "right", verticalAlign: "top", width: 100 }}>
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setInspectTarget(row.target);
                                    }}
                                  >
                                    Inspect
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                      {filteredDerivedRows.length > 0 ? (
                        <TablePagination
                          component="div"
                          count={filteredDerivedRows.length}
                          page={derivedPage}
                          rowsPerPage={derivedRowsPerPage}
                          rowsPerPageOptions={[10, 25, 50, 100]}
                          onPageChange={(_, page) => setDerivedPage(page)}
                          onRowsPerPageChange={(event) => {
                            setDerivedRowsPerPage(Number(event.target.value));
                            setDerivedPage(0);
                          }}
                          sx={{ borderTop: "1px solid var(--panel-border)", mt: 1 }}
                        />
                      ) : null}
                    </Box>
                  </Paper>
                ) : null}

                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", xl: "1fr 1fr" }, gap: 2 }}>
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <PanelTitle
                      title="Scope And Freshness"
                      hint="Observation metadata moved here so the attention panel stays focused."
                    />
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
                      <Chip size="small" label={`Profile ${plane.profile}`} variant="outlined" />
                      <Chip size="small" label={`Discovery ${plane.discoveryMode}`} variant="outlined" />
                      <Chip size="small" label={`Activation ${plane.activationMode}`} variant="outlined" />
                      <Chip size="small" label={`Refresh ${dashboardRefreshSec > 0 ? `${dashboardRefreshSec}s` : "manual"}`} variant="outlined" />
                      <Chip size="small" label={`Totals ${cov.resourceTotalsCompleteness}`} color={cov.resourceTotalsCompleteness === "unknown" ? "warning" : "default"} variant="outlined" />
                    </Box>
                    <Table size="small">
                      <TableBody>
                        <StatCell label="Namespaces total / unhealthy" value={`${ns.total} / ${ns.unhealthy}`} />
                        <StatCell label="Nodes total" value={nodes.total} />
                        <StatCell label="Namespace list" value={`${ns.state} / ${ns.freshness} / ${ns.completeness}`} />
                        <StatCell label="Node list" value={`${nodes.state} / ${nodes.freshness} / ${nodes.completeness}`} />
                        <StatCell label="Namespace observer" value={ns.observerState || "-"} />
                        <StatCell label="Node observer" value={nodes.observerState || "-"} />
                      </TableBody>
                    </Table>
                  </Paper>

                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <PanelTitle
                      title="Coverage"
                      hint="Row projection coverage comes from cached pod/deployment snapshots and active enrichment sessions."
                    />
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
                      <Chip size="small" variant="outlined" label={`Known lists ${knownScope}`} />
                      <Chip size="small" variant="outlined" label={`Row projections ${cov.rowProjectionCachedNamespaces}`} />
                      {cov.hasActiveEnrichmentSession ? <Chip size="small" variant="outlined" label="Enrichment active" /> : null}
                    </Box>
                    <Table size="small">
                      <TableBody>
                        <StatCell label="Visible namespaces" value={cov.visibleNamespaces} />
                        <StatCell label="Without row projection" value={cov.listOnlyNamespaces} />
                        <StatCell label="Detail fetches completed" value={cov.detailEnrichedNamespaces} />
                        <StatCell label="Cached row projections" value={cov.relatedEnrichedNamespaces} />
                        <StatCell label="Awaiting row projection" value={cov.awaitingRelatedRowProjection} />
                        {cov.enrichmentTargets != null && cov.enrichmentTargets > 0 ? (
                          <StatCell label="Enrichment targets" value={cov.enrichmentTargets} />
                        ) : null}
                      </TableBody>
                    </Table>
                  </Paper>
                </Box>

                <Paper variant="outlined" sx={{ p: 2 }}>
                  <PanelTitle
                    title="Dataplane Stats"
                    hint="Session-lifetime dataplane metrics since app startup. This tracks dataplane snapshot traffic and cache state only, not direct kube reads outside dataplane."
                  />
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
                    <Chip size="small" variant="outlined" label={`Uptime ${formatAgeShort(dataplane.uptimeSec) || "0m"}`} />
                    <Chip size="small" variant="outlined" label={`Requests ${formatRate(dataplane.traffic.requestsPerMin)}`} />
                    <Chip size="small" variant="outlined" label={`Traffic ${formatByteRate(dataplane.traffic.liveBytesPerMin)}`} />
                    <Chip size="small" variant="outlined" label={`Avg fetch ${formatBytes(dataplane.traffic.avgBytesPerFetch)}`} />
                  </Box>
                  <Box sx={dashboardPanelSectionSx}>
                    <Table size="small">
                      <TableBody>
                        <DataplaneVisualRow
                          label="Requests"
                          hint="All dataplane snapshot requests since app startup. Green is served from fresh cache; yellow needed a fetch."
                          visual={
                            <StackedMetricBar
                              segments={[
                                { label: "Fresh Hit", value: dataplane.requests.freshHits, color: "#2e7d32" },
                                { label: "Miss", value: dataplane.requests.misses, color: "#ed6c02" },
                              ]}
                            />
                          }
                          summary={`${formatPercent(dataplane.requests.hitRatio)} hit · ${dataplane.requests.freshHits}/${dataplane.requests.total} req`}
                        />
                        <DataplaneVisualRow
                          label="Traffic Mix"
                          hint="Payload bytes handled by dataplane. Green is restored from hydrated cache; yellow is newly fetched live payload."
                          visual={
                            <StackedMetricBar
                              segments={[
                                { label: "Hydrated Bytes", value: dataplane.traffic.hydratedBytes, color: "#2e7d32" },
                                { label: "Live Bytes", value: dataplane.traffic.liveBytes, color: "#ed6c02" },
                              ]}
                            />
                          }
                          summary={`${formatBytes(dataplane.traffic.liveBytes)} live · ${formatBytes(dataplane.traffic.hydratedBytes)} restored`}
                        />
                        <DataplaneVisualRow
                          label="Cache Footprint"
                          hint="Current cached snapshot bytes compared with session live payload volume. Green is retained cache bytes; yellow is live bytes fetched this session."
                          visual={
                            <StackedMetricBar
                              segments={[
                                { label: "Cache Bytes", value: dataplane.cache.currentBytes, color: "#2e7d32" },
                                { label: "Session Live Bytes", value: dataplane.traffic.liveBytes, color: "#ed6c02" },
                              ]}
                            />
                          }
                          summary={`${dataplane.cache.snapshotsStored} snapshots · ${formatBytes(dataplane.cache.avgBytesPerSnapshot)} avg`}
                        />
                        <DataplaneVisualRow
                          label="Execution"
                          hint="Scheduler run-time spread. Green is average run duration; yellow is the remaining distance up to the slowest observed run."
                          visual={
                            <Tooltip title={`Avg ${dataplane.execution.avgRunMs}ms of max ${dataplane.execution.maxRunMs}ms`}>
                              <Box>
                                <StackedMetricBar
                                  segments={[
                                    { label: "Average Run", value: dataplane.execution.avgRunMs, color: "#2e7d32" },
                                    {
                                      label: "Headroom To Max",
                                      value: Math.max(0, dataplane.execution.maxRunMs - dataplane.execution.avgRunMs),
                                      color: "#ed6c02",
                                    },
                                  ]}
                                />
                              </Box>
                            </Tooltip>
                          }
                          summary={`${dataplane.execution.avgRunMs}ms avg · ${dataplane.execution.maxRunMs}ms max · ${dataplane.execution.preemptions} preempt`}
                        />
                        {dataplane.sources?.map((source) => (
                          <DataplaneVisualRow
                            key={source.source}
                            label={`${source.source.charAt(0).toUpperCase()}${source.source.slice(1)} Hit/Miss`}
                            hint={`Dataplane requests attributed to ${source.source}. Green is requests satisfied without a new fetch; yellow needed a fetch; red ended in error.`}
                            visual={
                              <StackedMetricBar
                                segments={[
                                  {
                                    label: `${source.source} Hit`,
                                    value: Math.max(0, source.requests - source.fetches),
                                    color: "#2e7d32",
                                  },
                                  { label: `${source.source} Fetch`, value: source.fetches, color: "#ed6c02" },
                                  { label: `${source.source} Error`, value: source.errors, color: "#d32f2f" },
                                ]}
                              />
                            }
                            summary={`${formatPercent(source.requests > 0 ? ((source.requests - source.fetches) * 100) / source.requests : 0)} hit · ${Math.max(0, source.requests - source.fetches)}/${source.requests} req`}
                          />
                        ))}
                      </TableBody>
                    </Table>
                  </Box>
                </Paper>
              </>
            );
          })()}
        </Box>
      )}
      <DashboardInspectDrawers
        token={props.token}
        target={inspectTarget}
        onClose={() => setInspectTarget(null)}
        onNavigate={props.onNavigate}
      />
    </Box>
  );
}
