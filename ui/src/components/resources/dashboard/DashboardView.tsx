import React, { useEffect, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
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
  | "ResourceQuota";

type InspectTarget = {
  kind:
    | "Namespace"
    | "Pod"
    | "Job"
    | "CronJob"
    | "ConfigMap"
    | "Secret"
    | "ServiceAccount"
    | "PersistentVolumeClaim"
    | "HelmRelease";
  namespace: string;
  name: string;
};

function stateChipColor(state: string): "success" | "warning" | "error" | "default" {
  return namespaceRowSummaryStateColor(state) as "success" | "warning" | "error" | "default";
}

function severityColor(severity: string): "error" | "warning" | "info" | "default" {
  if (severity === "high") return "error";
  if (severity === "medium") return "warning";
  if (severity === "low") return "info";
  return "default";
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
      return "Potentially unused PVCs";
    case "ServiceAccount":
      return "Potentially unused service accounts";
    case "ResourceQuota":
      return "Quota pressure";
    default:
      return filter;
  }
}

function filterFindings(all: Finding[], top: Finding[], filter: FindingFilter): Finding[] {
  if (filter === "top") return top;
  if (filter === "high" || filter === "medium" || filter === "low") {
    return all.filter((f) => f.severity === filter);
  }
  return all.filter((f) => f.kind === filter);
}

function FindingFilterChip({
  filter,
  count,
  color = "default",
  selected,
  onSelect,
}: {
  filter: FindingFilter;
  count: number;
  color?: "error" | "warning" | "info" | "default";
  selected: boolean;
  onSelect: (filter: FindingFilter) => void;
}) {
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
    </>
  );
}

export default function DashboardView(props: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ApiDashboardClusterResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [findingFilter, setFindingFilter] = useState<FindingFilter>("top");
  const [inspectTarget, setInspectTarget] = useState<InspectTarget | null>(null);
  const activeContext = useActiveContext();
  const { settings } = useUserSettings();
  const dashboardRefreshSec = settings.appearance.dashboardRefreshSec;

  useEffect(() => {
    let cancelled = false;
    const load = async (initial: boolean) => {
      if (initial) {
        setLoading(true);
        setData(null);
      }
      setErr(null);
      try {
        const res = activeContext
          ? await apiGetWithContext<ApiDashboardClusterResponse>("/api/dashboard/cluster", props.token, activeContext)
          : await apiGet<ApiDashboardClusterResponse>("/api/dashboard/cluster", props.token);
        if (!cancelled) setData(res);
      } catch {
        if (!cancelled) setErr("Failed to load cluster overview");
      } finally {
        if (!cancelled && initial) setLoading(false);
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
  }, [activeContext, dashboardRefreshSec, props.token]);

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
            const { plane, visibility, coverage, resources, hotspots, findings } = data.item;
            const ns = visibility.namespaces;
            const nodes = visibility.nodes;
            const cov = coverage;
            const hotspotsEnabled = settings.dataplane.dashboard.includeHotspots;
            const knownScope = `${cov.namespacesInResourceTotals} / ${cov.visibleNamespaces}`;
            const allFindings = findings?.items || findings?.top || [];
            const topFindings = findings?.top || [];
            const visibleFindings = filterFindings(allFindings, topFindings, findingFilter);

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

                <Paper variant="outlined" sx={{ p: 2 }}>
                  <PanelTitle
                    title="Attention"
                    hint={findings?.note || "Click a chip to filter the list. Top priority is capped; category chips show all matching cached-scope findings."}
                  />
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1.5 }}>
                    <FindingFilterChip
                      filter="top"
                      count={topFindings.length}
                      selected={findingFilter === "top"}
                      onSelect={setFindingFilter}
                    />
                    <FindingFilterChip
                      filter="high"
                      count={findings?.high ?? 0}
                      color={(findings?.high || 0) > 0 ? "error" : "default"}
                      selected={findingFilter === "high"}
                      onSelect={setFindingFilter}
                    />
                    <FindingFilterChip
                      filter="medium"
                      count={findings?.medium ?? 0}
                      color={(findings?.medium || 0) > 0 ? "warning" : "default"}
                      selected={findingFilter === "medium"}
                      onSelect={setFindingFilter}
                    />
                    <FindingFilterChip
                      filter="low"
                      count={findings?.low ?? 0}
                      color={(findings?.low || 0) > 0 ? "info" : "default"}
                      selected={findingFilter === "low"}
                      onSelect={setFindingFilter}
                    />
                    <FindingFilterChip
                      filter="Namespace"
                      count={findings?.emptyNamespaces ?? 0}
                      selected={findingFilter === "Namespace"}
                      onSelect={setFindingFilter}
                    />
                    <FindingFilterChip
                      filter="HelmRelease"
                      count={findings?.stuckHelmReleases ?? 0}
                      selected={findingFilter === "HelmRelease"}
                      onSelect={setFindingFilter}
                    />
                    <FindingFilterChip
                      filter="Job"
                      count={findings?.abnormalJobs ?? 0}
                      selected={findingFilter === "Job"}
                      onSelect={setFindingFilter}
                    />
                    <FindingFilterChip
                      filter="CronJob"
                      count={findings?.abnormalCronJobs ?? 0}
                      selected={findingFilter === "CronJob"}
                      onSelect={setFindingFilter}
                    />
                    <FindingFilterChip
                      filter="ConfigMap"
                      count={findings?.emptyConfigMaps ?? 0}
                      selected={findingFilter === "ConfigMap"}
                      onSelect={setFindingFilter}
                    />
                    <FindingFilterChip
                      filter="Secret"
                      count={findings?.emptySecrets ?? 0}
                      selected={findingFilter === "Secret"}
                      onSelect={setFindingFilter}
                    />
                    <FindingFilterChip
                      filter="PersistentVolumeClaim"
                      count={findings?.potentiallyUnusedPVCs ?? 0}
                      selected={findingFilter === "PersistentVolumeClaim"}
                      onSelect={setFindingFilter}
                    />
                    <FindingFilterChip
                      filter="ServiceAccount"
                      count={findings?.potentiallyUnusedServiceAccounts ?? 0}
                      selected={findingFilter === "ServiceAccount"}
                      onSelect={setFindingFilter}
                    />
                    <FindingFilterChip
                      filter="ResourceQuota"
                      count={findings?.quotaWarnings ?? 0}
                      color={(findings?.quotaWarnings || 0) > 0 ? "warning" : "default"}
                      selected={findingFilter === "ResourceQuota"}
                      onSelect={setFindingFilter}
                    />
                  </Box>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                    Showing {visibleFindings.length} {findingFilterLabel(findingFilter).toLowerCase()} finding
                    {visibleFindings.length === 1 ? "" : "s"}.
                  </Typography>
                  {visibleFindings.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      No cached-scope findings for this filter.
                    </Typography>
                  ) : (
                    <Table size="small">
                      <TableBody>
                        {visibleFindings.map((f) => (
                          <TableRow key={`${f.kind}/${f.namespace || ""}/${f.name || ""}/${f.reason}`}>
                            <TableCell sx={{ border: 0, py: 0.6, pl: 0, width: 118 }}>
                              <Chip size="small" color={severityColor(f.severity)} label={f.severity} />
                            </TableCell>
                            <TableCell sx={{ border: 0, py: 0.6 }}>
                              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                {f.kind} {findingTarget(f)}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {f.reason} {f.confidence ? `Confidence: ${f.confidence}.` : ""}
                              </Typography>
                            </TableCell>
                            <TableCell sx={{ border: 0, py: 0.6, pr: 0, textAlign: "right", width: 110 }}>
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
                </Paper>

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

                {hotspotsEnabled && (hotspots.topProblematicNamespaces?.length || hotspots.topPodRestartHotspots?.length) ? (
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <PanelTitle
                      title="Hotspots"
                      hint="Compatibility view for restart-heavy pods and older problematic-resource scoring."
                    />
                    {hotspots.topProblematicNamespaces && hotspots.topProblematicNamespaces.length > 0 ? (
                      <>
                        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
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
                      </>
                    ) : null}
                    {hotspots.topPodRestartHotspots && hotspots.topPodRestartHotspots.length > 0 ? (
                      <>
                        <Divider sx={{ my: 1.5 }} />
                        <Table size="small">
                          <TableBody>
                            {hotspots.topPodRestartHotspots.slice(0, 8).map((h) => (
                              <TableRow key={`${h.namespace}/${h.name}`}>
                                <TableCell sx={{ border: 0, py: 0.35, pl: 0 }}>
                                  {h.namespace}/{h.name}
                                </TableCell>
                                <TableCell sx={{ border: 0, py: 0.35 }}>{h.restarts} restarts</TableCell>
                                <TableCell sx={{ border: 0, py: 0.35 }}>
                                  <Chip size="small" label={h.severity} color={h.severity === "high" ? "error" : "warning"} />
                                </TableCell>
                                <TableCell sx={{ border: 0, py: 0.35, pr: 0, textAlign: "right" }}>
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
                      </>
                    ) : null}
                  </Paper>
                ) : null}
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
