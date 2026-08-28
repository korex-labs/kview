import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Tab,
  TextField,
  Tabs,
  Typography,
} from "@mui/material";
import { apiGet, apiGetWithContext, apiPost } from "../../../api";
import type {
  ApiDashboardDataplaneResponse,
  ApiDashboardSignalsResponse,
  DashboardClusterItem,
} from "../../../types/api";
import { useActiveContext } from "../../../activeContext";
import { useSignalExclusionsRevision } from "../../../signalExclusions";
import { useSignalSuppressionsRevision } from "../../../signalSuppressions";
import { useConnectionState } from "../../../connectionState";
import { useUserSettings } from "../../../settingsContext";
import type { SavedDashboardViewSnapshot, SavedResourceViewDefinition } from "../../../settings";
import usePageVisible from "../../../utils/usePageVisible";
import InfoHint from "../../shared/InfoHint";
import { DialogActionButton } from "../../shared/AppActions";
import SavedViewPicker from "../../shared/SavedViewPicker";
import ResourceIcon from "../../icons/resources/ResourceIcon";
import { useMetricsStatus, isMetricsUsable } from "../../metrics/useMetricsStatus";
import DashboardSignalsTab from "./DashboardSignalsTab";
import DashboardDataplaneTab from "./DashboardDataplaneTab";
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
import {
  dashboardSignalViewSnapshotsEqual,
  dashboardSignalViewSnapshot,
  defaultDashboardSignalViewName,
  defaultDashboardSignalViewSnapshot,
  loadDashboardSignalViewInitialState,
} from "../../../dashboardProfiles";
import {
  clearPendingSavedResourceView,
  dispatchApplySavedResourceView,
  isDashboardSavedView,
  isResourceSavedView,
  loadPendingSavedResourceView,
} from "../../../savedViews";

type Props = {
  token: string;
  favouriteNamespaces?: string[];
  recentNamespaces?: string[];
  onNavigate?: (section: string, namespace: string) => void;
};

const DASHBOARD_PROFILE_REFRESH_FLOOR_SEC = 30;
const DASHBOARD_LOAD_DEDUPE_MS = 10_000;
const DASHBOARD_WARMUP_RETRY_MS = 1_500;
const DASHBOARD_WARMUP_RETRY_ATTEMPTS = 12;
const DASHBOARD_TAB_STORAGE_KEY = "kview:dashboardTab:v1";

type DashboardTab = "signals" | "dataplane";

function loadDashboardTab(): DashboardTab {
  try {
    return localStorage.getItem(DASHBOARD_TAB_STORAGE_KEY) === "dataplane" ? "dataplane" : "signals";
  } catch {
    return "signals";
  }
}

function loadInitialDashboardTab(): DashboardTab {
  const pendingView = loadPendingSavedResourceView();
  return pendingView && isDashboardSavedView(pendingView) ? "signals" : loadDashboardTab();
}

function persistDashboardTab(tab: DashboardTab) {
  try {
    localStorage.setItem(DASHBOARD_TAB_STORAGE_KEY, tab);
  } catch {
    // Dashboard navigation remains usable when browser storage is unavailable.
  }
}

type DashboardTabResponse = ApiDashboardSignalsResponse | ApiDashboardDataplaneResponse;
type DashboardTabError = { scope: string; message: string };

function dashboardNeedsWarmupRetry(res: DashboardTabResponse): boolean {
  const item = res.item as Partial<DashboardClusterItem> | undefined;
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

function dashboardWarmupRenderDeferAttempts(res: DashboardTabResponse): number {
  return dashboardNeedsWarmupRetry(res) ? DASHBOARD_WARMUP_RETRY_ATTEMPTS : 0;
}

function dashboardSavedViewSnapshot(view: SavedResourceViewDefinition | null | undefined): SavedDashboardViewSnapshot | null {
  if (!view || !isDashboardSavedView(view)) return null;
  return (view as SavedResourceViewDefinition).dashboardSnapshot ?? null;
}

function savedDashboardViewFromInput(input: {
  id?: string;
  name: string;
  context: string;
  snapshot: SavedDashboardViewSnapshot;
  createdAt?: number;
  now?: number;
}): SavedResourceViewDefinition {
  const now = Math.floor(input.now ?? Date.now());
  return {
    id: input.id || `dashboard-view-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name.trim().replace(/\s+/g, " "),
    viewType: "dashboard",
    context: input.context,
    namespace: "",
    resource: "pods",
    filter: "",
    sortModel: [],
    columnVisibilityModel: {},
    columnWidths: {},
    dashboardSnapshot: input.snapshot,
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
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
  const [initialSignalViewState] = useState(() => loadDashboardSignalViewInitialState());
  const [activeDashboardTab, setActiveDashboardTab] = useState<DashboardTab>(() => loadInitialDashboardTab());
  const [loading, setLoading] = useState(false);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [signalsData, setSignalsData] = useState<ApiDashboardSignalsResponse | null>(null);
  const [dataplaneData, setDataplaneData] = useState<ApiDashboardDataplaneResponse | null>(null);
  const [signalsDataScope, setSignalsDataScope] = useState("");
  const [dataplaneDataScope, setDataplaneDataScope] = useState("");
  const [signalsError, setSignalsError] = useState<DashboardTabError | null>(null);
  const [dataplaneError, setDataplaneError] = useState<DashboardTabError | null>(null);
  const [retryRevision, setRetryRevision] = useState(0);
  const [signalFilter, setSignalFilter] = useState(initialSignalViewState.snapshot.signalFilter);
  const [signalFilters, setSignalFilters] = useState<string[]>(initialSignalViewState.snapshot.signalFilters);
  const [signalsQuery, setSignalsQuery] = useState(initialSignalViewState.snapshot.signalsQuery);
  const [signalsSort, setSignalsSort] = useState(initialSignalViewState.snapshot.signalsSort);
  const [signalsPage, setSignalsPage] = useState(0);
  const [signalsRowsPerPage, setSignalsRowsPerPage] = useState(initialSignalViewState.snapshot.signalsRowsPerPage);
  const [inspectTarget, setInspectTarget] = useState<InspectTarget | null>(null);
  const [activeDashboardSavedViewId, setActiveDashboardSavedViewId] = useState(initialSignalViewState.profiles.activeProfileId);
  const [dashboardProfileName, setDashboardProfileName] = useState("");
  const [dashboardProfileDialogOpen, setDashboardProfileDialogOpen] = useState(false);
  const [dashboardProfileExistingId, setDashboardProfileExistingId] = useState<string | null>(null);
  const [deleteDashboardProfileId, setDeleteDashboardProfileId] = useState<string | null>(null);
  const [dashboardViewReady, setDashboardViewReady] = useState(false);
  const activeContext = useActiveContext();
  const signalExclusionsRevision = useSignalExclusionsRevision();
  const signalSuppressionsRevision = useSignalSuppressionsRevision();
  const activeSignalSuppressionsRevision = activeDashboardTab === "signals" ? signalSuppressionsRevision : 0;
  const { health } = useConnectionState();
  const { settings, setSettings } = useUserSettings();
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
  const dashboardDataScope = `${activeContext || ""}:${props.token}`;
  const visibleSignalsData = signalsDataScope === dashboardDataScope ? signalsData : null;
  const visibleDataplaneData = dataplaneDataScope === dashboardDataScope ? dataplaneData : null;
  const visibleSignalsError = signalsError?.scope === dashboardDataScope ? signalsError.message : "";
  const visibleDataplaneError = dataplaneError?.scope === dashboardDataScope ? dataplaneError.message : "";
  const lastLoadScopeRef = useRef<Partial<Record<DashboardTab, string>>>({});
  const lastSignalsParamsRef = useRef("");
  const loadInFlightRef = useRef(new Map<string, Promise<DashboardTabResponse>>());
  const warmupRetryAttemptsRef = useRef<Record<string, number>>({});
  const warmupRetryTimerRef = useRef<number | null>(null);
  const responseCacheRef = useRef<Partial<Record<DashboardTab, { key: string; at: number; data: DashboardTabResponse }>>>({});
  const currentDashboardProfileSnapshot = dashboardSignalViewSnapshot({
    signalFilter,
    signalFilters,
    signalsQuery,
    signalsSort,
    signalsRowsPerPage,
  });
  const savedViews = useMemo(
    () => [...settings.savedViews].sort((a, b) => a.name.localeCompare(b.name)),
    [settings.savedViews],
  );
  const dashboardSavedViews = useMemo(
    () => savedViews.filter(isDashboardSavedView),
    [savedViews],
  );
  const activeDashboardProfile = dashboardSavedViews.find((profile) => profile.id === activeDashboardSavedViewId) || null;
  const activeDashboardSnapshot = dashboardSavedViewSnapshot(activeDashboardProfile);
  const dashboardProfileDirty = activeDashboardSnapshot
    ? !dashboardSignalViewSnapshotsEqual(activeDashboardSnapshot, currentDashboardProfileSnapshot)
    : false;

  const applyDashboardSavedView = (view: SavedResourceViewDefinition) => {
    const snapshot = dashboardSavedViewSnapshot(view);
    if (!snapshot) return;
    setActiveDashboardTab("signals");
    persistDashboardTab("signals");
    setSignalFilter(snapshot.signalFilter);
    setSignalFilters(snapshot.signalFilters);
    setSignalsQuery(snapshot.signalsQuery);
    setSignalsSort(snapshot.signalsSort);
    setSignalsRowsPerPage(snapshot.signalsRowsPerPage);
    setSignalsPage(0);
    setActiveDashboardSavedViewId(view.id);
    clearPendingSavedResourceView();
  };

  useEffect(() => {
    if (initialSignalViewState.profiles.definitions.length === 0) return;
    setSettings((prev) => {
      const existingIds = new Set(prev.savedViews.map((view) => view.id));
      const migrated = initialSignalViewState.profiles.definitions
        .filter((profile) => !existingIds.has(profile.id))
        .map((profile) => savedDashboardViewFromInput({
          id: profile.id,
          name: profile.name,
          context: activeContext,
          snapshot: profile.snapshot,
          createdAt: profile.createdAt,
          now: profile.updatedAt,
        }));
      return migrated.length ? { ...prev, savedViews: [...migrated, ...prev.savedViews].slice(0, 50) } : prev;
    });
  }, [activeContext, initialSignalViewState.profiles.definitions, setSettings]);

  useEffect(() => {
    if (dashboardViewReady) return;
    const pendingView = loadPendingSavedResourceView();
    if (pendingView && isDashboardSavedView(pendingView)) {
      applyDashboardSavedView(pendingView);
    }
    setDashboardViewReady(true);
  }, [dashboardViewReady]);

  const clearDashboardSignalProfile = () => {
    const defaults = defaultDashboardSignalViewSnapshot();
    setSignalFilter(defaults.signalFilter);
    setSignalFilters(defaults.signalFilters);
    setSignalsQuery(defaults.signalsQuery);
    setSignalsSort(defaults.signalsSort);
    setSignalsRowsPerPage(defaults.signalsRowsPerPage);
    setSignalsPage(0);
    setActiveDashboardSavedViewId("");
    clearPendingSavedResourceView();
  };

  const createDashboardSignalProfile = () => {
    const nextView = savedDashboardViewFromInput({
      name: dashboardProfileName,
      context: activeContext,
      snapshot: currentDashboardProfileSnapshot,
    });
    setActiveDashboardSavedViewId(nextView.id);
    setSettings((prev) => ({
      ...prev,
      savedViews: [nextView, ...prev.savedViews.filter((view) => view.id !== nextView.id)].slice(0, 50),
    }));
    setDashboardProfileName("");
    setDashboardProfileDialogOpen(false);
    setDashboardProfileExistingId(null);
  };

  const updateActiveDashboardSignalProfile = () => {
    if (!activeDashboardProfile) return;
    const nextView = savedDashboardViewFromInput({
      id: activeDashboardProfile.id,
      name: dashboardProfileName || activeDashboardProfile.name,
      context: activeContext,
      snapshot: currentDashboardProfileSnapshot,
      createdAt: activeDashboardProfile.createdAt,
    });
    setActiveDashboardSavedViewId(nextView.id);
    setSettings((prev) => ({
      ...prev,
      savedViews: [nextView, ...prev.savedViews.filter((view) => view.id !== nextView.id)].slice(0, 50),
    }));
    setDashboardProfileName("");
    setDashboardProfileDialogOpen(false);
    setDashboardProfileExistingId(null);
  };

  const openDashboardProfileDialog = () => {
    setDashboardProfileExistingId(activeDashboardProfile?.id || null);
    setDashboardProfileName(activeDashboardProfile?.name || defaultDashboardSignalViewName());
    setDashboardProfileDialogOpen(true);
  };

  const closeDashboardProfileDialog = () => {
    setDashboardProfileDialogOpen(false);
    setDashboardProfileExistingId(null);
    setDashboardProfileName("");
  };

  const confirmDashboardProfileSave = () => {
    if (!dashboardProfileName.trim()) return;
    if (dashboardProfileExistingId && activeDashboardProfile) {
      updateActiveDashboardSignalProfile();
      return;
    }
    createDashboardSignalProfile();
  };

  const deleteDashboardProfile = settings.savedViews.find((view) => view.id === deleteDashboardProfileId) || null;

  useEffect(() => {
    if (!dashboardViewReady || deferredSignalsQuery !== signalsQuery || health === "unhealthy" || !pageVisible) return;
    let cancelled = false;
    const tab = activeDashboardTab;
    const loadScope = `${activeContext || ""}:${props.token}`;
    const setTabData = (response: DashboardTabResponse | null) => {
      if (tab === "signals") {
        setSignalsData(response as ApiDashboardSignalsResponse | null);
        setSignalsDataScope(loadScope);
      } else {
        setDataplaneData(response as ApiDashboardDataplaneResponse | null);
        setDataplaneDataScope(loadScope);
      }
    };
    const setTabError = (message: string | null) => {
      const error = message ? { scope: loadScope, message } : null;
      if (tab === "signals") setSignalsError(error);
      else setDataplaneError(error);
    };
    const canScheduleWarmupRetry = (cacheKey: string) =>
      (warmupRetryAttemptsRef.current[cacheKey] ?? 0) < DASHBOARD_WARMUP_RETRY_ATTEMPTS;
    const canDeferWarmupRender = (cacheKey: string, res: DashboardTabResponse) =>
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
      const resetView = initial && lastLoadScopeRef.current[tab] !== loadScope;
      let deferredWarmupRender = false;
      if (resetView) {
        setLoading(true);
        setTabData(null);
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
        const signalsParamsKey = tab === "signals" ? params.toString() : "";
        const cacheKey = tab === "signals"
          ? `${loadScope}:signals:${signalsParamsKey}:${resourceTagsSignature}:${signalExclusionsRevision}:${activeSignalSuppressionsRevision}`
          : `${loadScope}:dataplane`;
        const cached = responseCacheRef.current[tab];
        if (!force && cached && cached.key === cacheKey && Date.now() - cached.at < DASHBOARD_LOAD_DEDUPE_MS) {
          if (!cancelled) {
            lastLoadScopeRef.current[tab] = loadScope;
            if (tab === "signals") lastSignalsParamsRef.current = signalsParamsKey;
            setTabError(null);
            setTabData(cached.data);
          }
          return;
        }
        const showSignalsLoading =
          tab === "signals" &&
          initial &&
          !resetView &&
          lastSignalsParamsRef.current !== "" &&
          lastSignalsParamsRef.current !== signalsParamsKey;
        if (showSignalsLoading) setSignalsLoading(true);

        setTabError(null);
        let pending = loadInFlightRef.current.get(cacheKey);
        if (!pending) {
          const request = async (): Promise<DashboardTabResponse> => {
            if (tab === "signals") {
              const path = `/api/dashboard/signals?${params.toString()}`;
              return settings.resourceTags.enabled
                ? apiPost<ApiDashboardSignalsResponse>(`/api/dashboard/signals/query?${params.toString()}`, props.token, {
                    resourceTags: settings.resourceTags,
                  }, { headers: activeContext ? { "X-Kview-Context": activeContext } : undefined })
                : activeContext
                  ? apiGetWithContext<ApiDashboardSignalsResponse>(path, props.token, activeContext)
                  : apiGet<ApiDashboardSignalsResponse>(path, props.token);
            }
            const path = "/api/dashboard/dataplane";
            return activeContext
              ? apiGetWithContext<ApiDashboardDataplaneResponse>(path, props.token, activeContext)
              : apiGet<ApiDashboardDataplaneResponse>(path, props.token);
          };
          const created = request();
          pending = created.then(
            (value) => {
              loadInFlightRef.current.delete(cacheKey);
              return value;
            },
            (error: unknown) => {
              loadInFlightRef.current.delete(cacheKey);
              throw error;
            },
          );
          loadInFlightRef.current.set(cacheKey, pending);
        }
        const res = await pending;
        if (!cancelled) {
          const needsWarmupRetry = dashboardNeedsWarmupRetry(res);
          if (needsWarmupRetry && canDeferWarmupRender(cacheKey, res)) {
            deferredWarmupRender = true;
            scheduleWarmupRetry(cacheKey);
            return;
          }
          responseCacheRef.current[tab] = { key: cacheKey, at: Date.now(), data: res };
          lastLoadScopeRef.current[tab] = loadScope;
          if (tab === "signals") lastSignalsParamsRef.current = signalsParamsKey;
          setTabData(res);
          if (needsWarmupRetry && canScheduleWarmupRetry(cacheKey)) {
            scheduleWarmupRetry(cacheKey);
          } else {
            delete warmupRetryAttemptsRef.current[cacheKey];
          }
        }
      } catch {
        // Keep stale dashboard data visible while retries continue.
        if (!cancelled) {
          setTabError(tab === "signals" ? "Failed to load dashboard signals." : "Failed to load dataplane statistics.");
        }
      } finally {
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
    activeDashboardTab,
    effectiveDashboardRefreshSec,
    deferredSignalsQuery,
    dashboardViewReady,
    health,
    pageVisible,
    signalFilter,
    signalFilters,
    combinedSignalFilters,
    signalsSort,
    signalsPage,
    signalsQuery,
    signalsRowsPerPage,
    resourceTagsSignature,
    signalExclusionsRevision,
    activeSignalSuppressionsRevision,
    settings.resourceTags,
    favouriteNamespaceFilterParam,
    recentNamespaceFilterParam,
    props.token,
    retryRevision,
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

  const retryActiveDashboardTab = () => {
    delete responseCacheRef.current[activeDashboardTab];
    setLoading(true);
    setRetryRevision((value) => value + 1);
  };

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

      <Tabs
        value={activeDashboardTab}
        onChange={(_, value: DashboardTab) => {
          setActiveDashboardTab(value);
          persistDashboardTab(value);
        }}
        aria-label="Dashboard sections"
        sx={{ px: 2, borderBottom: "1px solid var(--panel-border)", minHeight: 40 }}
      >
        <Tab value="signals" id="dashboard-tab-signals" aria-controls="dashboard-panel-signals" label="Signals" />
        <Tab value="dataplane" id="dashboard-tab-dataplane" aria-controls="dashboard-panel-dataplane" label="Dataplane" />
      </Tabs>

      {activeDashboardTab === "signals" ? (
        <Box sx={{ px: 2, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <SavedViewPicker
          savedViews={savedViews}
          selectedSavedViewId={activeDashboardProfile ? activeDashboardSavedViewId : ""}
          selectedSavedViewDirty={!!activeDashboardProfile && dashboardProfileDirty}
          onSavedViewApply={(id) => {
            const view = savedViews.find((item) => item.id === id);
            if (!view) return;
            if (isDashboardSavedView(view)) {
              applyDashboardSavedView(view);
              return;
            }
            if (isResourceSavedView(view)) {
              dispatchApplySavedResourceView(view);
            }
          }}
          onSavedViewClear={clearDashboardSignalProfile}
          onSavedViewSave={openDashboardProfileDialog}
          onSavedViewDelete={(id) => setDeleteDashboardProfileId(id)}
          clearTooltip="Clear saved view and reset dashboard"
          saveTooltip="Save current dashboard view"
          saveSelectedTooltip="Update selected saved view"
          modifiedTooltip="The current dashboard signal filters differ from the selected saved view. Save to update it or reselect the view to restore it."
          />
        </Box>
      ) : null}

      {loading && (
        <Box sx={{ px: 2, display: "flex", alignItems: "center", gap: 1 }}>
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">
            Loading...
          </Typography>
        </Box>
      )}

            <Box sx={{ px: 2, display: "flex", flexDirection: "column", gap: 2 }}>
        <Box
          id="dashboard-panel-signals"
          role="tabpanel"
          aria-labelledby="dashboard-tab-signals"
          hidden={activeDashboardTab !== "signals"}
          tabIndex={0}
          sx={{ display: activeDashboardTab === "signals" ? "flex" : "none", flexDirection: "column", gap: 2 }}
        >
          {visibleSignalsError ? (
            <Paper variant="outlined" role="alert" sx={{ p: 2, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
              <Typography variant="body2" color="error">{visibleSignalsError}</Typography>
              <Button size="small" variant="outlined" onClick={retryActiveDashboardTab}>Retry</Button>
            </Paper>
          ) : null}
          {visibleSignalsData?.item ? (
            <DashboardSignalsTab
              token={props.token}
              item={visibleSignalsData.item}
              metricsUsable={metricsUsable}
              podRestartThreshold={settings.dataplane.global.signals.detectors.pod_restarts.restartCount}
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
              loading={signalsLoading}
            />
          ) : null}
        </Box>
        <Box
          id="dashboard-panel-dataplane"
          role="tabpanel"
          aria-labelledby="dashboard-tab-dataplane"
          hidden={activeDashboardTab !== "dataplane"}
          tabIndex={0}
          sx={{ display: activeDashboardTab === "dataplane" ? "flex" : "none", flexDirection: "column", gap: 2 }}
        >
          {visibleDataplaneError ? (
            <Paper variant="outlined" role="alert" sx={{ p: 2, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
              <Typography variant="body2" color="error">{visibleDataplaneError}</Typography>
              <Button size="small" variant="outlined" onClick={retryActiveDashboardTab}>Retry</Button>
            </Paper>
          ) : null}
          {visibleDataplaneData?.item ? (
            <DashboardDataplaneTab
              item={visibleDataplaneData.item}
              metricsUsable={metricsUsable}
              refreshSec={effectiveDashboardRefreshSec}
            />
          ) : null}
        </Box>
      </Box>

      <DashboardInspectDrawers
        token={props.token}
        target={inspectTarget}
        onClose={() => setInspectTarget(null)}
        onNavigate={props.onNavigate}
      />
      <Dialog open={dashboardProfileDialogOpen} onClose={closeDashboardProfileDialog} fullWidth maxWidth="xs">
        <DialogTitle>{dashboardProfileExistingId ? "Update Saved View" : "Save Current Dashboard View"}</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Name"
            value={dashboardProfileName}
            onChange={(event) => setDashboardProfileName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              confirmDashboardProfileSave();
            }}
          />
        </DialogContent>
        <DialogActions>
          <DialogActionButton action="cancel" onClick={closeDashboardProfileDialog}>Cancel</DialogActionButton>
          <DialogActionButton action="primary" onClick={confirmDashboardProfileSave} disabled={!dashboardProfileName.trim()}>
            {dashboardProfileExistingId ? "Update" : "Save"}
          </DialogActionButton>
        </DialogActions>
      </Dialog>
      <Dialog open={Boolean(deleteDashboardProfile)} onClose={() => setDeleteDashboardProfileId(null)} fullWidth maxWidth="xs">
        <DialogTitle>Delete Saved View</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Delete saved view {deleteDashboardProfile ? `"${deleteDashboardProfile.name}"` : ""}?
          </Typography>
        </DialogContent>
        <DialogActions>
          <DialogActionButton action="cancel" onClick={() => setDeleteDashboardProfileId(null)}>Cancel</DialogActionButton>
          <DialogActionButton
            action="destructive"
            onClick={() => {
              if (!deleteDashboardProfile) return;
              setSettings((prev) => ({
                ...prev,
                savedViews: prev.savedViews.filter((view) => view.id !== deleteDashboardProfile.id),
              }));
              setActiveDashboardSavedViewId((current) => current === deleteDashboardProfile.id ? "" : current);
              setDeleteDashboardProfileId(null);
            }}
          >
            Delete
          </DialogActionButton>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
