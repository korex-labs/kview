import React, { useDeferredValue, useEffect, useRef, useState } from "react";
import {
  Box,
  Chip,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import { apiGet, apiGetWithContext } from "../../../api";
import type { ApiDashboardClusterResponse } from "../../../types/api";
import { dataplaneCoarseStateChipColor } from "../../../utils/k8sUi";
import { fmtAgeShort, fmtBytes, fmtByteRate, fmtPercent, fmtRate } from "../../../utils/format";
import { useActiveContext } from "../../../activeContext";
import { useUserSettings } from "../../../settingsContext";
import InfoHint from "../../shared/InfoHint";
import MetricCard from "../../shared/MetricCard";
import StackedMetricBar from "../../shared/StackedMetricBar";
import DashboardSignalsPanel from "./DashboardSignalsPanel";
import DashboardDerivedPanel from "./DashboardDerivedPanel";
import type { InspectTarget } from "./dashboardTypes";
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

function stateChipColor(state: string): "success" | "warning" | "error" | "default" {
  return dataplaneCoarseStateChipColor(state) as "success" | "warning" | "error" | "default";
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

const dashboardPanelSectionSx = {
  border: "1px solid var(--panel-border)",
  borderRadius: 1,
  p: 1.25,
  backgroundColor: "var(--bg-secondary)",
};

function StatCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <TableRow>
      <TableCell sx={{ border: 0, py: 0.5, pl: 0, color: "text.secondary", width: 240 }}>{label}</TableCell>
      <TableCell sx={{ border: 0, py: 0.5, fontWeight: 600 }}>{value}</TableCell>
    </TableRow>
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
  const [signalFilter, setSignalFilter] = useState("top");
  const [signalsQuery, setSignalsQuery] = useState("");
  const [signalsPage, setSignalsPage] = useState(0);
  const [signalsRowsPerPage, setSignalsRowsPerPage] = useState(10);
  const [inspectTarget, setInspectTarget] = useState<InspectTarget | null>(null);
  const activeContext = useActiveContext();
  const { settings } = useUserSettings();
  const dashboardRefreshSec = settings.appearance.dashboardRefreshSec;
  const deferredSignalsQuery = useDeferredValue(signalsQuery);
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
          signalsFilter: signalFilter,
          signalsQ: deferredSignalsQuery,
          signalsOffset: String(signalsPage * signalsRowsPerPage),
          signalsLimit: String(signalsRowsPerPage),
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
    deferredSignalsQuery,
    signalFilter,
    signalsPage,
    signalsRowsPerPage,
    props.token,
  ]);

  const selectSignalFilter = (filter: string) => {
    setSignalFilter(filter);
    setSignalsPage(0);
  };

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
        <InfoHint title="Dataplane snapshot view. Resource totals and signals use cached namespace list snapshots only; unknown namespaces are not inferred." />
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
            const { plane, visibility, coverage, resources, signals, derived, dataplane } = data.item;
            const signalPanel = signals;
            const ns = visibility.namespaces;
            const nodes = visibility.nodes;
            const cov = coverage;
            const knownScope = `${cov.namespacesInResourceTotals} / ${cov.visibleNamespaces}`;

            return (
              <>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                  <MetricCard
                    label="Signals"
                    value={signalPanel?.total ?? 0}
                    color={(signalPanel?.high || 0) > 0 ? "error" : (signalPanel?.medium || 0) > 0 ? "warning" : "success"}
                    hint="Heuristic signals from cached namespace snapshots."
                  />
                  <MetricCard
                    label="Known namespace scope"
                    value={knownScope}
                    color={cov.resourceTotalsCompleteness === "complete" ? "success" : "warning"}
                    hint="Namespaces included in resource totals and signals."
                  />
                  <MetricCard
                    label="Pod restart signals"
                    value={signalPanel?.podRestartSignals ?? 0}
                    color={(signalPanel?.podRestartSignals || 0) > 0 ? "warning" : "success"}
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

                <Box sx={{ display: "block" }}>
                  <DashboardSignalsPanel
                    signalPanel={signalPanel}
                    signalFilter={signalFilter}
                    onSignalFilterChange={selectSignalFilter}
                    signalsQuery={signalsQuery}
                    onSignalsQueryChange={setSignalsQuery}
                    signalsPage={signalsPage}
                    onSignalsPageChange={setSignalsPage}
                    signalsRowsPerPage={signalsRowsPerPage}
                    onSignalsRowsPerPageChange={setSignalsRowsPerPage}
                    onInspect={setInspectTarget}
                  />
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
                  <DashboardDerivedPanel derived={derived} onInspect={setInspectTarget} />
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
                    <Chip size="small" variant="outlined" label={`Uptime ${fmtAgeShort(dataplane.uptimeSec) || "0m"}`} />
                    <Chip size="small" variant="outlined" label={`Requests ${fmtRate(dataplane.traffic.requestsPerMin)}`} />
                    <Chip size="small" variant="outlined" label={`Traffic ${fmtByteRate(dataplane.traffic.liveBytesPerMin)}`} />
                    <Chip size="small" variant="outlined" label={`Avg fetch ${fmtBytes(dataplane.traffic.avgBytesPerFetch)}`} />
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
                          summary={`${fmtPercent(dataplane.requests.hitRatio)} hit · ${dataplane.requests.freshHits}/${dataplane.requests.total} req`}
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
                          summary={`${fmtBytes(dataplane.traffic.liveBytes)} live · ${fmtBytes(dataplane.traffic.hydratedBytes)} restored`}
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
                          summary={`${dataplane.cache.snapshotsStored} snapshots · ${fmtBytes(dataplane.cache.avgBytesPerSnapshot)} avg`}
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
                            summary={`${fmtPercent(source.requests > 0 ? ((source.requests - source.fetches) * 100) / source.requests : 0)} hit · ${Math.max(0, source.requests - source.fetches)}/${source.requests} req`}
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
