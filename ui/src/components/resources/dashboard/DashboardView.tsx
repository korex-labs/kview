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
  Typography,
} from "@mui/material";
import { apiGet, apiGetWithContext, apiPost } from "../../../api";
import type { ApiDashboardClusterResponse } from "../../../types/api";
import { dataplaneCoarseStateChipColor } from "../../../utils/k8sUi";
import { fmtAgeShort, fmtBytes, fmtByteRate, fmtPercent, fmtRate } from "../../../utils/format";
import {
  STAT_CELL_LABEL_WIDTH,
  GAUGE_COLOR_HEALTHY,
  GAUGE_COLOR_WARNING,
  GAUGE_COLOR_ERROR,
} from "../../../theme/sxTokens";
import { useActiveContext } from "../../../activeContext";
import { useConnectionState } from "../../../connectionState";
import { useUserSettings } from "../../../settingsContext";
import usePageVisible from "../../../utils/usePageVisible";
import InfoHint from "../../shared/InfoHint";
import MetricCard from "../../shared/MetricCard";
import StackedMetricBar from "../../shared/StackedMetricBar";
import GaugeTableRow from "../../shared/GaugeTableRow";
import ScopedCountChip from "../../shared/ScopedCountChip";
import ResourceIcon from "../../icons/resources/ResourceIcon";
import { formatCPUMilli, formatMemoryBytes } from "../../metrics/format";
import { useMetricsStatus, isMetricsUsable } from "../../metrics/useMetricsStatus";
import DashboardSignalsPanel from "./DashboardSignalsPanel";
import type { InspectTarget } from "./dashboardTypes";
import NamespaceDrawer from "../namespaces/NamespaceDrawer";
import PodDrawer from "../pods/PodDrawer";
import JobDrawer from "../jobs/JobDrawer";
import CronJobDrawer from "../cronjobs/CronJobDrawer";
import HorizontalPodAutoscalerDrawer from "../horizontalpodautoscalers/HorizontalPodAutoscalerDrawer";
import ConfigMapDrawer from "../configmaps/ConfigMapDrawer";
import SecretDrawer from "../secrets/SecretDrawer";
import ServiceAccountDrawer from "../serviceaccounts/ServiceAccountDrawer";
import PersistentVolumeClaimDrawer from "../persistentvolumeclaims/PersistentVolumeClaimDrawer";
import HelmReleaseDrawer from "../helm/HelmReleaseDrawer";
import HelmChartDrawer from "../helm/HelmChartDrawer";
import ServiceDrawer from "../services/ServiceDrawer";
import IngressDrawer from "../ingresses/IngressDrawer";
import NetworkPolicyDrawer from "../networkpolicies/NetworkPolicyDrawer";
import RoleDrawer from "../roles/RoleDrawer";
import RoleBindingDrawer from "../rolebindings/RoleBindingDrawer";
import NodeDrawer from "../nodes/NodeDrawer";
import ResourceQuotaDrawer from "../resourcequotas/ResourceQuotaDrawer";
import LimitRangeDrawer from "../limitranges/LimitRangeDrawer";

type Props = {
  token: string;
  favouriteNamespaces?: string[];
  recentNamespaces?: string[];
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
  backgroundColor: "transparent",
};

const DASHBOARD_PROFILE_REFRESH_FLOOR_SEC = 30;
const DASHBOARD_LOAD_DEDUPE_MS = 10_000;
const DASHBOARD_WARMUP_RETRY_MS = 1_500;
const DASHBOARD_WARMUP_RETRY_ATTEMPTS = 12;

function StatCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <TableRow>
      <TableCell sx={{ border: 0, py: 0.5, pl: 0, color: "text.secondary", width: STAT_CELL_LABEL_WIDTH }}>{label}</TableCell>
      <TableCell sx={{ border: 0, py: 0.5, fontWeight: 600 }}>{value}</TableCell>
    </TableRow>
  );
}

function dashboardNeedsWarmupRetry(res: ApiDashboardClusterResponse): boolean {
  const item = res.item;
  if (!item) return false;
  if (item.coverage?.persistenceHydrating) return true;
  const visibleNamespaces = item.coverage?.visibleNamespaces ?? item.visibility?.namespaces?.total ?? 0;
  const namespacesInTotals = item.coverage?.namespacesInResourceTotals ?? 0;
  const totalsCompleteness = item.coverage?.resourceTotalsCompleteness || "";
  if (visibleNamespaces > 0 && namespacesInTotals === 0 && totalsCompleteness === "unknown") {
    return true;
  }
  const namespaceState = item.visibility?.namespaces?.state || "";
  const namespaceObserverState = item.visibility?.namespaces?.observerState || "";
  if (namespaceState === "empty" && ["starting", "not_loaded", ""].includes(namespaceObserverState)) {
    return true;
  }
  const namespaceFreshness = item.visibility?.namespaces?.freshness || "";
  const namespaceCoverage = item.visibility?.namespaces?.coverage || "";
  const namespaceCompleteness = item.visibility?.namespaces?.completeness || "";
  const resources = item.resources;
  const allResourceTotalsZero = resources
    ? [
        resources.pods,
        resources.deployments,
        resources.daemonSets,
        resources.statefulSets,
        resources.replicaSets,
        resources.jobs,
        resources.cronJobs,
        resources.horizontalPodAutoscalers,
        resources.services,
        resources.ingresses,
        resources.persistentVolumeClaims,
        resources.configMaps,
        resources.secrets,
        resources.serviceAccounts,
        resources.roles,
        resources.roleBindings,
        resources.helmReleases,
        resources.customResources,
        resources.resourceQuotas,
        resources.limitRanges,
        resources.totalNamespaces,
      ].every((value) => (value ?? 0) === 0)
    : true;
  return (
    namespaceState === "empty" &&
    namespaceObserverState !== "disabled" &&
    namespaceFreshness !== "hot" &&
    namespaceCoverage !== "full" &&
    namespaceCompleteness !== "complete" &&
    visibleNamespaces === 0 &&
    namespacesInTotals === 0 &&
    totalsCompleteness === "unknown" &&
    allResourceTotalsZero &&
    (item.signals?.total ?? 0) === 0
  );
}

function dashboardWarmupRenderDeferAttempts(res: ApiDashboardClusterResponse): number {
  return dashboardNeedsWarmupRetry(res) ? DASHBOARD_WARMUP_RETRY_ATTEMPTS : 0;
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
      <HorizontalPodAutoscalerDrawer
        open={open && target?.kind === "HorizontalPodAutoscaler"}
        onClose={onClose}
        token={token}
        namespace={namespace}
        hpaName={target?.kind === "HorizontalPodAutoscaler" ? name : null}
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
      <NetworkPolicyDrawer
        open={open && target?.kind === "NetworkPolicy"}
        onClose={onClose}
        token={token}
        namespace={namespace}
        networkPolicyName={target?.kind === "NetworkPolicy" ? name : null}
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
      <ResourceQuotaDrawer
        open={open && target?.kind === "ResourceQuota"}
        onClose={onClose}
        token={token}
        namespace={namespace}
        resourceQuotaName={target?.kind === "ResourceQuota" ? name : null}
      />
      <LimitRangeDrawer
        open={open && target?.kind === "LimitRange"}
        onClose={onClose}
        token={token}
        namespace={namespace}
        limitRangeName={target?.kind === "LimitRange" ? name : null}
      />
    </>
  );
}

export default function DashboardView(props: Props) {
  const [loading, setLoading] = useState(false);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [data, setData] = useState<ApiDashboardClusterResponse | null>(null);
  const [signalFilter, setSignalFilter] = useState("top");
  const [signalFilters, setSignalFilters] = useState<string[]>(["top"]);
  const [signalsQuery, setSignalsQuery] = useState("");
  const [signalsSort, setSignalsSort] = useState("priority");
  const [signalsPage, setSignalsPage] = useState(0);
  const [signalsRowsPerPage, setSignalsRowsPerPage] = useState(10);
  const [inspectTarget, setInspectTarget] = useState<InspectTarget | null>(null);
  const activeContext = useActiveContext();
  const { health } = useConnectionState();
  const { settings } = useUserSettings();
  const pageVisible = usePageVisible();
  const metricsStatus = useMetricsStatus(props.token);
  const metricsUsable = isMetricsUsable(metricsStatus);
  const favouriteNamespaceFilterParam = (props.favouriteNamespaces || []).filter(Boolean).join(",");
  const recentNamespaceFilterParam = (props.recentNamespaces || []).filter(Boolean).join(",");
  const dashboardRefreshSec = settings.dataplane.global.dashboard.refreshSec;
  const dashboardProfile = settings.dataplane.global.profile;
  const combinedSignalFilters = settings.appearance.dashboardCombinedSignalFilters;
  const resourceTagsSignature = settings.resourceTags.enabled ? JSON.stringify(settings.resourceTags) : "";
  const effectiveDashboardRefreshSec =
    dashboardRefreshSec > 0 && (dashboardProfile === "wide" || dashboardProfile === "diagnostic")
      ? Math.max(dashboardRefreshSec, DASHBOARD_PROFILE_REFRESH_FLOOR_SEC)
      : dashboardRefreshSec;
  const deferredSignalsQuery = useDeferredValue(signalsQuery);
  const lastLoadScopeRef = useRef("");
  const lastSignalsParamsRef = useRef("");
  const loadInFlightKeyRef = useRef<string | null>(null);
  const warmupRetryAttemptsRef = useRef<Record<string, number>>({});
  const warmupRetryTimerRef = useRef<number | null>(null);
  const responseCacheRef = useRef<{ key: string; at: number; data: ApiDashboardClusterResponse } | null>(null);

  useEffect(() => {
    if (health === "unhealthy" || !pageVisible) return;
    let cancelled = false;
    const loadScope = `${activeContext || ""}:${props.token}`;
    const canScheduleWarmupRetry = (cacheKey: string) =>
      (warmupRetryAttemptsRef.current[cacheKey] ?? 0) < DASHBOARD_WARMUP_RETRY_ATTEMPTS;
    const canDeferWarmupRender = (cacheKey: string, res: ApiDashboardClusterResponse) =>
      (warmupRetryAttemptsRef.current[cacheKey] ?? 0) < dashboardWarmupRenderDeferAttempts(res);
    const scheduleWarmupRetry = (cacheKey: string) => {
      const attempts = warmupRetryAttemptsRef.current[cacheKey] ?? 0;
      if (attempts >= DASHBOARD_WARMUP_RETRY_ATTEMPTS) return;
      warmupRetryAttemptsRef.current[cacheKey] = attempts + 1;
      if (warmupRetryTimerRef.current != null) {
        window.clearTimeout(warmupRetryTimerRef.current);
      }
      warmupRetryTimerRef.current = window.setTimeout(() => {
        warmupRetryTimerRef.current = null;
        if (!cancelled) void load(false, true);
      }, DASHBOARD_WARMUP_RETRY_MS);
    };
    const load = async (initial: boolean, force = false) => {
      const resetView = initial && lastLoadScopeRef.current !== loadScope;
      let acquiredLoad = false;
      let deferredWarmupRender = false;
      let requestKey = "";
      if (resetView) {
        setLoading(true);
        setData(null);
      }
      try {
        const requestedSignalFilters = combinedSignalFilters ? signalFilters : [signalFilter];
        const params = new URLSearchParams({
          signalsFilter: requestedSignalFilters.join(","),
          signalsQ: deferredSignalsQuery,
          signalsSort,
          signalsOffset: String(signalsPage * signalsRowsPerPage),
          signalsLimit: String(signalsRowsPerPage),
        });
        if (combinedSignalFilters) {
          params.set("signalsCombined", "true");
        }
        if (favouriteNamespaceFilterParam) {
          params.set("signalsFavouriteNamespaces", favouriteNamespaceFilterParam);
        }
        if (recentNamespaceFilterParam) {
          params.set("signalsRecentNamespaces", recentNamespaceFilterParam);
        }
        const signalsParamsKey = params.toString();
        const cacheKey = `${loadScope}:${signalsParamsKey}:${resourceTagsSignature}`;
        requestKey = cacheKey;
        const cached = responseCacheRef.current;
        if (!force && cached && cached.key === cacheKey && Date.now() - cached.at < DASHBOARD_LOAD_DEDUPE_MS) {
          if (!cancelled) {
            lastLoadScopeRef.current = loadScope;
            lastSignalsParamsRef.current = signalsParamsKey;
            setData(cached.data);
          }
          return;
        }
        if (loadInFlightKeyRef.current === cacheKey) return;
        loadInFlightKeyRef.current = cacheKey;
        acquiredLoad = true;
        const showSignalsLoading =
          initial &&
          !resetView &&
          lastSignalsParamsRef.current !== "" &&
          lastSignalsParamsRef.current !== signalsParamsKey;
        if (showSignalsLoading) setSignalsLoading(true);
        const path = `/api/dashboard/cluster?${params.toString()}`;
        const res = settings.resourceTags.enabled
          ? await apiPost<ApiDashboardClusterResponse>(`/api/dashboard/cluster/query?${params.toString()}`, props.token, {
              resourceTags: settings.resourceTags,
            }, { headers: activeContext ? { "X-Kview-Context": activeContext } : undefined })
          : activeContext
            ? await apiGetWithContext<ApiDashboardClusterResponse>(path, props.token, activeContext)
            : await apiGet<ApiDashboardClusterResponse>(path, props.token);
        if (!cancelled) {
          const needsWarmupRetry = dashboardNeedsWarmupRetry(res);
          if (needsWarmupRetry && canDeferWarmupRender(cacheKey, res)) {
            deferredWarmupRender = true;
            scheduleWarmupRetry(cacheKey);
            return;
          }
          responseCacheRef.current = { key: cacheKey, at: Date.now(), data: res };
          lastLoadScopeRef.current = loadScope;
          lastSignalsParamsRef.current = signalsParamsKey;
          setData(res);
          if (needsWarmupRetry && canScheduleWarmupRetry(cacheKey)) {
            scheduleWarmupRetry(cacheKey);
          } else {
            delete warmupRetryAttemptsRef.current[cacheKey];
          }
        }
      } catch {
        // Keep stale dashboard data visible while retries continue.
      } finally {
        if (acquiredLoad && loadInFlightKeyRef.current === requestKey) {
          loadInFlightKeyRef.current = null;
        }
        if (!cancelled) {
          if (!deferredWarmupRender) setLoading(false);
          setSignalsLoading(false);
        }
      }
    };
    void load(true);
    if (effectiveDashboardRefreshSec <= 0) {
      return () => {
        cancelled = true;
        if (warmupRetryTimerRef.current != null) {
          window.clearTimeout(warmupRetryTimerRef.current);
          warmupRetryTimerRef.current = null;
        }
      };
    }
    const id = window.setInterval(() => void load(false), effectiveDashboardRefreshSec * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      if (warmupRetryTimerRef.current != null) {
        window.clearTimeout(warmupRetryTimerRef.current);
        warmupRetryTimerRef.current = null;
      }
    };
  }, [
    activeContext,
    effectiveDashboardRefreshSec,
    deferredSignalsQuery,
    health,
    pageVisible,
    signalFilter,
    signalFilters,
    combinedSignalFilters,
    signalsSort,
    signalsPage,
    signalsRowsPerPage,
    resourceTagsSignature,
    settings.resourceTags,
    favouriteNamespaceFilterParam,
    recentNamespaceFilterParam,
    props.token,
  ]);

  const selectSignalFilter = (filter: string) => {
    const isDerived = filter.startsWith("derived");
    const nextFilters = combinedSignalFilters && !isDerived
      ? signalFilters.includes(filter)
        ? signalFilters.filter((item) => item !== filter)
        : [...signalFilters.filter((item) => item !== "top" && !item.startsWith("derived")), filter]
      : [filter];
    const normalizedFilters = nextFilters.length > 0 ? nextFilters : ["top"];
    const nextFilter = normalizedFilters.join(",");
    if (nextFilter !== signalFilter) setSignalsLoading(true);
    setSignalFilters(normalizedFilters);
    setSignalFilter(combinedSignalFilters && !isDerived ? nextFilter : filter);
    setSignalsPage(0);
  };

  useEffect(() => {
    if (combinedSignalFilters) return;
    const firstFilter = signalFilters[0] || signalFilter || "top";
    if (signalFilter !== firstFilter) {
      setSignalFilter(firstFilter);
    }
    if (signalFilters.length !== 1 || signalFilters[0] !== firstFilter) {
      setSignalFilters([firstFilter]);
    }
  }, [combinedSignalFilters, signalFilter, signalFilters]);

  return (
    <Paper
      className="kview-dashboard-root"
      data-testid="cluster-dashboard"
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
        borderRadius: 0,
        backgroundColor: "background.paper",
        backgroundImage: (theme) =>
          theme.palette.mode === "dark"
            ? "linear-gradient(rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.05))"
            : "none",
        "&, & .MuiPaper-root": {
          backgroundColor: "background.paper",
          backgroundImage: (theme) =>
            theme.palette.mode === "dark"
              ? "linear-gradient(rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.05))"
              : "none",
        },
      }}
    >
      <Box sx={{ px: 2, pt: 1, display: "flex", alignItems: "center", gap: 0.75 }}>
        <ResourceIcon name="dashboard" size={21} sx={{ color: "primary.main" }} />
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

      {!loading && data?.item && (
        <Box sx={{ px: 2, display: "flex", flexDirection: "column", gap: 2 }}>
          {(() => {
            const { plane, visibility, coverage, resources, signals, derived, dataplane, usage } = data.item;
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
                    hint={`Pods above ${settings.dataplane.global.signals.detectors.pod_restarts.restartCount} restarts in cached scope.`}
                  />
                  <MetricCard
                    label="Quota pressure"
                    value={signalPanel?.quotaWarnings ?? 0}
                    color={(signalPanel?.quotaWarnings || 0) > 0 ? "warning" : "success"}
                    hint="Namespace ResourceQuota usage nearing hard limits; available even when node capacity is not visible."
                  />
                  <MetricCard
                    label="Nodes"
                    value={nodes.total}
                    color={stateChipColor(nodes.state) === "default" ? "default" : stateChipColor(nodes.state)}
                    hint={`State ${nodes.state}, freshness ${nodes.freshness}, observer ${nodes.observerState || "unknown"}.`}
                  />
                  {metricsUsable ? (
                    <>
                      <MetricCard
                        label="Container near limit"
                        value={signalPanel?.containerNearLimit ?? 0}
                        color={(signalPanel?.containerNearLimit || 0) > 0 ? "warning" : "success"}
                        hint="Containers using a high percentage of CPU or memory limit, sourced from metrics.k8s.io."
                      />
                      <MetricCard
                        label="Node resource pressure"
                        value={signalPanel?.nodeResourcePressure ?? 0}
                        color={(signalPanel?.nodeResourcePressure || 0) > 0 ? "error" : "success"}
                        hint="Nodes whose CPU or memory usage exceeds the configured pressure threshold against allocatable."
                      />
                    </>
                  ) : null}
                </Box>

                <Box sx={{ display: "block" }}>
                  <DashboardSignalsPanel
                    token={props.token}
                    signalPanel={signalPanel}
                    signalFilter={signalFilter}
                    signalFilters={signalFilters}
                    combinedSignalFilters={combinedSignalFilters}
                    onSignalFilterChange={selectSignalFilter}
                    signalsQuery={signalsQuery}
                    onSignalsQueryChange={setSignalsQuery}
                    signalsSort={signalsSort}
                    onSignalsSortChange={setSignalsSort}
                    signalsPage={signalsPage}
                    onSignalsPageChange={setSignalsPage}
                    signalsRowsPerPage={signalsRowsPerPage}
                    onSignalsRowsPerPageChange={setSignalsRowsPerPage}
                    onInspect={setInspectTarget}
                    derived={derived}
                    loading={signalsLoading}
                  />
                </Box>

                <Paper variant="outlined" sx={{ p: 2 }}>
                  <PanelTitle
                    title="Known Resources"
                    hint="Resource counts are not inferred cluster totals; they are summed from cached namespace list snapshots."
                  />
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
                    {resources.aggregateFreshness ? <ScopedCountChip size="small" variant="outlined" label="Freshness" count={resources.aggregateFreshness} /> : null}
                    {resources.aggregateDegradation && resources.aggregateDegradation !== "none" ? (
                      <ScopedCountChip size="small" color="warning" label="Degradation" count={resources.aggregateDegradation} />
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
                      ["HPAs", resources.horizontalPodAutoscalers],
                      ["Services", resources.services],
                      ["Ingresses", resources.ingresses],
                      ["PVCs", resources.persistentVolumeClaims],
                      ["ConfigMaps", resources.configMaps],
                      ["Secrets", resources.secrets],
                      ["ServiceAccounts", resources.serviceAccounts],
                      ["Roles", resources.roles],
                      ["RoleBindings", resources.roleBindings],
                      ["HelmReleases", resources.helmReleases],
                      ["CustomResources", resources.customResources],
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

                {metricsUsable && usage ? (
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <PanelTitle
                      title="Cluster usage"
                      hint="Cluster-wide CPU and memory rolled up from cached metrics.k8s.io snapshots. Pod totals sum across known namespaces; node totals sum across sampled nodes."
                    />
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
                      {usage.freshness ? <ScopedCountChip size="small" variant="outlined" label="Freshness" count={usage.freshness} /> : null}
                      <ScopedCountChip size="small" variant="outlined" label="Pods sampled" count={usage.podsWithMetrics} />
                      <ScopedCountChip size="small" variant="outlined" label="Namespaces" count={usage.namespaces} />
                      {usage.nodesSampled != null ? <ScopedCountChip size="small" variant="outlined" label="Nodes sampled" count={usage.nodesSampled} /> : null}
                      {usage.note ? (
                        <Chip size="small" color="warning" variant="outlined" label={usage.note} />
                      ) : null}
                    </Box>
                    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1 }}>
                      <Box sx={dashboardPanelSectionSx}>
                        <Typography variant="overline" color="text.secondary">Pods</Typography>
                        <Table size="small">
                          <TableBody>
                            <StatCell label="CPU" value={formatCPUMilli(usage.podCpuMilli) || "—"} />
                            <StatCell label="Memory" value={formatMemoryBytes(usage.podMemoryBytes) || "—"} />
                          </TableBody>
                        </Table>
                      </Box>
                      <Box sx={dashboardPanelSectionSx}>
                        <Typography variant="overline" color="text.secondary">Nodes</Typography>
                        <Table size="small">
                          <TableBody>
                            <StatCell label="CPU" value={usage.nodeCpuMilli != null ? (formatCPUMilli(usage.nodeCpuMilli) || "—") : "—"} />
                            <StatCell label="Memory" value={usage.nodeMemoryBytes != null ? (formatMemoryBytes(usage.nodeMemoryBytes) || "—") : "—"} />
                          </TableBody>
                        </Table>
                      </Box>
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
                      <ScopedCountChip size="small" variant="outlined" label="Profile" count={plane.profile} />
                      <ScopedCountChip size="small" variant="outlined" label="Discovery" count={plane.discoveryMode} />
                      <ScopedCountChip size="small" variant="outlined" label="Activation" count={plane.activationMode} />
                      <ScopedCountChip size="small" variant="outlined" label="Refresh" count={effectiveDashboardRefreshSec > 0 ? `${effectiveDashboardRefreshSec}s` : "Manual"} />
                      <ScopedCountChip size="small" variant="outlined" label="Totals" count={cov.resourceTotalsCompleteness} color={cov.resourceTotalsCompleteness === "unknown" ? "warning" : "default"} />
                    </Box>
                    <Table size="small">
                      <TableBody>
                        <StatCell label="Namespaces total / unhealthy" value={`${ns.total} / ${ns.unhealthy}`} />
                        <StatCell label="Nodes total" value={nodes.total} />
                        <StatCell label="Namespace snapshot" value={`${ns.state} / ${ns.freshness} / ${ns.completeness}`} />
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
                      <ScopedCountChip size="small" variant="outlined" label="Known lists" count={knownScope} />
                      <ScopedCountChip size="small" variant="outlined" label="Row projections" count={cov.rowProjectionCachedNamespaces} />
                      {cov.hasActiveEnrichmentSession ? <ScopedCountChip size="small" color="info" label="Enrichment" count="Active" /> : null}
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
                    <ScopedCountChip size="small" variant="outlined" label="Uptime" count={fmtAgeShort(dataplane.uptimeSec) || "0m"} />
                    <ScopedCountChip size="small" variant="outlined" label="Requests" count={fmtRate(dataplane.traffic.requestsPerMin)} />
                    <ScopedCountChip size="small" variant="outlined" label="Traffic" count={fmtByteRate(dataplane.traffic.liveBytesPerMin)} />
                    <ScopedCountChip size="small" variant="outlined" label="Avg fetch" count={fmtBytes(dataplane.traffic.avgBytesPerFetch)} />
                  </Box>
                  <Box sx={dashboardPanelSectionSx}>
                        <GaugeTableRow
                          label="Requests"
                          hint="All dataplane snapshot requests since app startup. Green is served from fresh cache; yellow needed a fetch."
                          bar={
                            <StackedMetricBar
                              segments={[
                                { label: "Fresh Hit", value: dataplane.requests.freshHits, color: GAUGE_COLOR_HEALTHY },
                                { label: "Miss", value: dataplane.requests.misses, color: GAUGE_COLOR_WARNING },
                              ]}
                            />
                          }
                          summary={`${fmtPercent(dataplane.requests.hitRatio)} hit · ${dataplane.requests.freshHits}/${dataplane.requests.total} req`}
                        />
                        <GaugeTableRow
                          label="Traffic Mix"
                          hint="Payload bytes handled by dataplane. Green is restored from hydrated cache; yellow is newly fetched live payload."
                          bar={
                            <StackedMetricBar
                              segments={[
                                { label: "Hydrated Bytes", value: dataplane.traffic.hydratedBytes, color: GAUGE_COLOR_HEALTHY },
                                { label: "Live Bytes", value: dataplane.traffic.liveBytes, color: GAUGE_COLOR_WARNING },
                              ]}
                            />
                          }
                          summary={`${fmtBytes(dataplane.traffic.liveBytes)} live · ${fmtBytes(dataplane.traffic.hydratedBytes)} restored`}
                        />
                        <GaugeTableRow
                          label="Cache Footprint"
                          hint="Current cached snapshot bytes compared with session live payload volume. Green is retained cache bytes; yellow is live bytes fetched this session."
                          bar={
                            <StackedMetricBar
                              segments={[
                                { label: "Cache Bytes", value: dataplane.cache.currentBytes, color: GAUGE_COLOR_HEALTHY },
                                { label: "Session Live Bytes", value: dataplane.traffic.liveBytes, color: GAUGE_COLOR_WARNING },
                              ]}
                            />
                          }
                          summary={`${dataplane.cache.snapshotsStored} snapshots · ${fmtBytes(dataplane.cache.avgBytesPerSnapshot)} avg`}
                        />
                        <GaugeTableRow
                          label="Execution"
                          hint="Scheduler run-time spread. Green is average run duration; yellow is the remaining distance up to the slowest observed run."
                          bar={
                            <StackedMetricBar
                              segments={[
                                { label: "Average Run", value: dataplane.execution.avgRunMs, color: GAUGE_COLOR_HEALTHY },
                                {
                                  label: "Headroom To Max",
                                  value: Math.max(0, dataplane.execution.maxRunMs - dataplane.execution.avgRunMs),
                                  color: GAUGE_COLOR_WARNING,
                                },
                              ]}
                            />
                          }
                          summary={`${dataplane.execution.avgRunMs}ms avg · ${dataplane.execution.maxRunMs}ms max · ${dataplane.execution.preemptions} preempt`}
                        />
                        {dataplane.sources?.map((source) => (
                          <GaugeTableRow
                            key={source.source}
                            label={`${source.source.charAt(0).toUpperCase()}${source.source.slice(1)} Hit/Miss`}
                            hint={`Dataplane requests attributed to ${source.source}. Green is requests satisfied without a new fetch; yellow needed a fetch; red ended in error.`}
                            bar={
                              <StackedMetricBar
                                segments={[
                                  {
                                    label: `${source.source} Hit`,
                                    value: Math.max(0, source.requests - source.fetches),
                                    color: GAUGE_COLOR_HEALTHY,
                                  },
                                  { label: `${source.source} Fetch`, value: source.fetches, color: GAUGE_COLOR_WARNING },
                                  { label: `${source.source} Error`, value: source.errors, color: GAUGE_COLOR_ERROR },
                                ]}
                              />
                            }
                            summary={`${fmtPercent(source.requests > 0 ? ((source.requests - source.fetches) * 100) / source.requests : 0)} hit · ${Math.max(0, source.requests - source.fetches)}/${source.requests} req`}
                          />
                        ))}
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
    </Paper>
  );
}
