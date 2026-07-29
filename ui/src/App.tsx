import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, CssBaseline, AppBar, Toolbar, Typography, Snackbar, Alert } from "@mui/material";
import Brightness7Icon from "@mui/icons-material/Brightness7";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import BrightnessAutoIcon from "@mui/icons-material/BrightnessAuto";
import ConstructionIcon from "@mui/icons-material/Construction";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import logoUrl from "./assets/logo.svg";
import Sidebar from "./components/Sidebar";
import { apiGet, apiGetWithContext, apiPost, setApiDefaultContext, toApiError } from "./api";
import type { ApiContextsResponse, ApiNamespacesListResponse, ApiViewResourcesResponse, InvestigationSnapshot } from "./types/api";
import {
  loadState,
  isSection,
  namespacesListApiPath,
  recordRecentNamespace,
  recordRecentSection,
  saveState,
  saveListTextFilter,
  saveQuickFilterSelection,
  setSidebarGroupCollapsed,
  toggleFavouriteNamespace,
  type AppStateV1,
  type Section,
} from "./state";
import { notifyApiFailure, notifyStatus, useConnectionState, type AppStatus } from "./connectionState";
import ConnectionBanner from "./components/shared/ConnectionBanner";
import { AppIconButton } from "./components/shared/AppActions";
import ActivityPanel from "./components/activity/ActivityPanel";
import { ActiveContextProvider, useActiveContext } from "./activeContext";
import MutationProvider from "./components/mutations/MutationProvider";
import { ThemeProvider, useThemeMode } from "./theme/ThemeProvider";
import { UserSettingsProvider, useUserSettings } from "./settingsContext";
import GlobalSearchInput, { type GlobalSearchFocusRequest } from "./components/search/GlobalSearchInput";
import DataplaneSearchDrawer from "./components/search/DataplaneSearchDrawer";
import type { ApiDataplaneSearchItem } from "./types/api";
import StartupDialog, { type StartupKubeconfigInfo, type StartupStep, type StartupStepStatus } from "./components/StartupDialog";
import { POLL_STATUS_INTERVAL_MS } from "./constants/pollIntervals";
import { dataplaneSearchSectionByKind } from "./constants/resourceSections";
import { dataplaneSettingsForContext, type SavedResourceViewDefinition } from "./settings";
import { buildDataplaneBundleForSync } from "./dataplaneSync";
import { APPLY_SAVED_RESOURCE_VIEW_EVENT, isDashboardSavedView } from "./savedViews";
import {
  APPLY_FOCUSED_RESOURCE_VIEW_EVENT,
  dispatchApplyFocusedResourceView,
  type FocusedResourceViewIntent,
} from "./focusedResourceViews";
import usePageVisible from "./utils/usePageVisible";
import { applyViewResourceDescriptors } from "./utils/k8sResources";
import {
  performanceDiagnosticsEnabled,
  recordApiTiming,
  setPerformanceDiagnosticsContext,
  setPerformanceDiagnosticsEnabled,
} from "./utils/performanceDiagnostics";
import KeyboardProvider from "./keyboard/KeyboardProvider";
import { SignalMemoryProvider } from "./signalMemory";
import { QuickSignalExclusionProvider } from "./components/shared/QuickSignalExclusion";
import { dispatchSignalExclusionsChanged } from "./signalExclusions";
import "./styles/theme.css";

const SettingsView = React.lazy(() => import("./components/settings/SettingsView"));
const HelpView = React.lazy(() => import("./components/help/HelpView"));
const DashboardView = React.lazy(() => import("./components/resources/dashboard/DashboardView"));
const NodesTable = React.lazy(() => import("./components/resources/nodes/NodesTable"));
const NamespacesTable = React.lazy(() => import("./components/resources/namespaces/NamespacesTable"));
const PodsTable = React.lazy(() => import("./components/resources/pods/PodsTable"));
const DeploymentsTable = React.lazy(() => import("./components/resources/deployments/DeploymentsTable"));
const DaemonSetsTable = React.lazy(() => import("./components/resources/daemonsets/DaemonSetsTable"));
const StatefulSetsTable = React.lazy(() => import("./components/resources/statefulsets/StatefulSetsTable"));
const ReplicaSetsTable = React.lazy(() => import("./components/resources/replicasets/ReplicaSetsTable"));
const ServicesTable = React.lazy(() => import("./components/resources/services/ServicesTable"));
const IngressesTable = React.lazy(() => import("./components/resources/ingresses/IngressesTable"));
const NetworkPoliciesTable = React.lazy(() => import("./components/resources/networkpolicies/NetworkPoliciesTable"));
const JobsTable = React.lazy(() => import("./components/resources/jobs/JobsTable"));
const CronJobsTable = React.lazy(() => import("./components/resources/cronjobs/CronJobsTable"));
const HorizontalPodAutoscalersTable = React.lazy(
  () => import("./components/resources/horizontalpodautoscalers/HorizontalPodAutoscalersTable"),
);
const ConfigMapsTable = React.lazy(() => import("./components/resources/configmaps/ConfigMapsTable"));
const SecretsTable = React.lazy(() => import("./components/resources/secrets/SecretsTable"));
const ServiceAccountsTable = React.lazy(() => import("./components/resources/serviceaccounts/ServiceAccountsTable"));
const RolesTable = React.lazy(() => import("./components/resources/roles/RolesTable"));
const RoleBindingsTable = React.lazy(() => import("./components/resources/rolebindings/RoleBindingsTable"));
const ClusterRolesTable = React.lazy(() => import("./components/resources/clusterroles/ClusterRolesTable"));
const ClusterRoleBindingsTable = React.lazy(() => import("./components/resources/clusterrolebindings/ClusterRoleBindingsTable"));
const PersistentVolumesTable = React.lazy(() => import("./components/resources/persistentvolumes/PersistentVolumesTable"));
const PersistentVolumeClaimsTable = React.lazy(
  () => import("./components/resources/persistentvolumeclaims/PersistentVolumeClaimsTable"),
);
const ResourceQuotasTable = React.lazy(() => import("./components/resources/resourcequotas/ResourceQuotasTable"));
const LimitRangesTable = React.lazy(() => import("./components/resources/limitranges/LimitRangesTable"));
const HelmReleasesTable = React.lazy(() => import("./components/resources/helm/HelmReleasesTable"));
const HelmChartsTable = React.lazy(() => import("./components/resources/helm/HelmChartsTable"));
const CustomResourceDefinitionsTable = React.lazy(
  () => import("./components/resources/customresourcedefinitions/CustomResourceDefinitionsTable"),
);
const CustomResourcesTable = React.lazy(() => import("./components/resources/customresources/CustomResourcesTable"));
const ClusterCustomResourcesTable = React.lazy(() => import("./components/resources/customresources/ClusterCustomResourcesTable"));

function getToken(): string {
  const u = new URL(window.location.href);
  return u.searchParams.get("token") || "";
}

const INITIAL_NAMESPACE_RETRY_ATTEMPTS = 5;
const INITIAL_NAMESPACE_RETRY_DELAY_MS = 400;

type ContextOption = NonNullable<ApiContextsResponse["contexts"]>[number];
type BootstrapPhase = "contexts" | "context" | "migration" | "namespaces" | "ready" | "no-context" | "error";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function pickNamespace({
  limited,
  items,
  preferred,
}: {
  limited: boolean;
  items: string[];
  preferred: string;
}): string {
  if (limited) return preferred || "";
  if (preferred && items.includes(preferred)) return preferred;
  return items[0] || "";
}

function optimisticNamespaceForContext(
  state: AppStateV1,
  contextName: string,
  kubeconfigNamespace?: string,
  fallback?: string,
): string {
  const recent = state.recentNamespacesByContext?.[contextName]?.find(Boolean);
  const favourite = state.favouriteNamespacesByContext?.[contextName]?.find(Boolean);
  return recent || kubeconfigNamespace || favourite || fallback || "default";
}

function startupSteps(phase: BootstrapPhase, detail: Partial<Record<BootstrapPhase, string>>): StartupStep[] {
  const order: Array<{ id: BootstrapPhase; label: string }> = [
    { id: "contexts", label: "Reading kube contexts" },
    { id: "context", label: "Selecting active context" },
    { id: "migration", label: "Checking local cache" },
    { id: "namespaces", label: "Loading namespaces and dataplane cache" },
  ];
  const phaseIndex = order.findIndex((step) => step.id === phase);
  return order.map((step, index) => {
    let status: StartupStepStatus = "pending";
    if (phase === "ready") status = "done";
    else if (phase === "error" && index === Math.max(0, phaseIndex)) status = "error";
    else if (phase === "no-context" && step.id === "contexts") status = "error";
    else if (phaseIndex >= 0 && index < phaseIndex) status = "done";
    else if (step.id === phase) status = "active";
    return { ...step, status, detail: detail[step.id] };
  });
}

function AppInner() {
  const token = useMemo(() => getToken(), []);
  const { settings } = useUserSettings();
  const { health, backendHealth, backendVersion, lastRecoveryShownAt, retryNonce } = useConnectionState();
  const pageVisible = usePageVisible();

  useEffect(() => {
    setPerformanceDiagnosticsEnabled(settings.appearance.performanceDiagnosticsEnabled);
    return () => setPerformanceDiagnosticsEnabled(false);
  }, [settings.appearance.performanceDiagnosticsEnabled]);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [lastRecoverySeenAt, setLastRecoverySeenAt] = useState<number | null>(null);
  const [contexts, setContexts] = useState<ContextOption[]>([]);
  const [activeContext, setActiveContext] = useState<string>("");
  const [bootstrapPhase, setBootstrapPhase] = useState<BootstrapPhase>("contexts");
  const [bootstrapDetail, setBootstrapDetail] = useState<Partial<Record<BootstrapPhase, string>>>({});
  const [bootstrapError, setBootstrapError] = useState<string>("");
  const [kubeconfigInfo, setKubeconfigInfo] = useState<StartupKubeconfigInfo | null>(null);
  const [bootstrapNonce, setBootstrapNonce] = useState(0);
  const [contextSwitching, setContextSwitching] = useState(false);

  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [nsLimited, setNsLimited] = useState<boolean>(false);
  const [namespace, setNamespace] = useState<string>("");

  const [section, setSection] = useState<Section>("pods");
  const [customResourcesFilterIntent, setCustomResourcesFilterIntent] = useState<{ value: string; nonce: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [searchDrawerItem, setSearchDrawerItem] = useState<ApiDataplaneSearchItem | null>(null);
  const [searchFocusRequest, setSearchFocusRequest] = useState<GlobalSearchFocusRequest>({ nonce: 0, query: "" });
  const [viewDescriptorRevision, setViewDescriptorRevision] = useState(0);

  const [favourites, setFavourites] = useState<string[]>([]);

  // load from localStorage once
  const [appState, setAppState] = useState(() => loadState());

  useEffect(() => {
    setApiDefaultContext(activeContext);
  }, [activeContext]);

  useEffect(() => {
    let cancelled = false;
    void apiGet<ApiViewResourcesResponse>("/api/view/resources", token, { useDefaultContext: false })
      .then((response) => {
        if (cancelled) return;
        if (applyViewResourceDescriptors(response)) {
          setViewDescriptorRevision((revision) => revision + 1);
        }
      })
      .catch(() => {
        // Local resource metadata remains the fallback when an older backend does not expose descriptors.
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const namespacesListPath = useMemo(
    () =>
      namespacesListApiPath(
        appState,
        activeContext,
        namespace,
        settings.dataplane.global.namespaceEnrichment.recentLimit,
        settings.dataplane.global.namespaceEnrichment.favouriteLimit,
      ),
    [
      appState,
      activeContext,
      namespace,
      settings.dataplane.global.namespaceEnrichment.recentLimit,
      settings.dataplane.global.namespaceEnrichment.favouriteLimit,
    ],
  );
  const recentNamespaces = appState.recentNamespacesByContext?.[activeContext] || [];

  useEffect(() => {
    setPerformanceDiagnosticsContext({
      activeContext,
      activeNamespace: namespace,
      activeSection: section,
      activityPanelOpen: appState.activityPanelOpen,
      dataplaneProfile: settings.dataplane.global.profile,
      settingsOpen,
      namespaceCount: namespaces.length,
    });
  }, [
    activeContext,
    appState.activityPanelOpen,
    namespace,
    namespaces.length,
    section,
    settings.dataplane.global.profile,
    settings.appearance.performanceDiagnosticsEnabled,
    settingsOpen,
  ]);

  // persist on change
  useEffect(() => {
    saveState(appState);
  }, [appState]);

  useEffect(() => {
    setFavourites((appState.favouriteNamespacesByContext[activeContext] || []).slice());
  }, [activeContext, appState.favouriteNamespacesByContext]);

  const handleActivityPanelOpenChange = useCallback((activityPanelOpen: boolean) => {
    setAppState((s) => (s.activityPanelOpen === activityPanelOpen ? s : { ...s, activityPanelOpen }));
  }, []);

  const handleActivityPanelHeightChange = useCallback((activityPanelHeightPx: number) => {
    setAppState((s) => (
      s.activityPanelHeightPx === activityPanelHeightPx ? s : { ...s, activityPanelHeightPx }
    ));
  }, []);

  useEffect(() => {
    if (!lastRecoveryShownAt) return;
    if (lastRecoveryShownAt === lastRecoverySeenAt) return;
    setLastRecoverySeenAt(lastRecoveryShownAt);
    setRecoveryOpen(true);
  }, [lastRecoverySeenAt, lastRecoveryShownAt]);

  useEffect(() => {
    if (!pageVisible) return;
    let cancelled = false;

    const pollStatus = async () => {
      const startedAt = performanceDiagnosticsEnabled() ? window.performance.now() : 0;
      try {
        const res = await fetch("/api/status", {
          headers: {
            Authorization: `Bearer ${token}`,
            ...(activeContext ? { "X-Kview-Context": activeContext } : {}),
          },
        });
        if (!res.ok) {
          if (startedAt) {
            recordApiTiming({
              method: "GET",
              path: "/api/status",
              durationMs: window.performance.now() - startedAt,
              parseMs: 0,
              bytes: 0,
              ok: false,
              status: res.status,
            });
          }
          const message = res.statusText || `Status check failed (${res.status})`;
          if (!cancelled) notifyApiFailure(res.status >= 500 ? "backend" : "request", message);
          return;
        }
        const text = await res.text();
        const parseStartedAt = startedAt ? window.performance.now() : 0;
        const status = JSON.parse(text || "null") as AppStatus;
        if (startedAt) {
          recordApiTiming({
            method: "GET",
            path: "/api/status",
            durationMs: window.performance.now() - startedAt,
            parseMs: parseStartedAt ? window.performance.now() - parseStartedAt : 0,
            bytes: text.length,
            ok: true,
            status: res.status,
          });
        }
        if (!cancelled) notifyStatus(status);
      } catch (err) {
        if (startedAt) {
          recordApiTiming({
            method: "GET",
            path: "/api/status",
            durationMs: window.performance.now() - startedAt,
            parseMs: 0,
            bytes: 0,
            ok: false,
          });
        }
        if (!cancelled) {
          notifyApiFailure("backend", String((err as Error | undefined)?.message || err || "Network error"));
        }
      }
    };

    void pollStatus();
    const statusPollIntervalMs = settingsOpen && backendHealth === "healthy" ? 30000 : POLL_STATUS_INTERVAL_MS;
    const id = window.setInterval(pollStatus, statusPollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [activeContext, backendHealth, pageVisible, retryNonce, settingsOpen, token]);

  // initial bootstrap
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBootstrapPhase("contexts");
      setBootstrapError("");
      setBootstrapDetail({ contexts: "Reading configured kubeconfig files" });
      // 1) contexts
      const ctxRes = await apiGet<ApiContextsResponse>("/api/contexts", token);
      if (cancelled) return;
      const ctxs = ctxRes.contexts || [];
      setContexts(ctxs);
      setKubeconfigInfo(ctxRes.kubeconfig || null);

      if (ctxs.length === 0) {
        setActiveContext("");
        setNamespace("");
        setNamespaces([]);
        setBootstrapDetail({ contexts: "No contexts were found in the configured kubeconfig files" });
        setBootstrapPhase("no-context");
        return;
      }

      const stateCtx = appState.activeContext;
      const ctxExists = stateCtx && ctxs.some((c) => c.name === stateCtx);
      const activeFromBackend = ctxRes.active && ctxs.some((c) => c.name === ctxRes.active) ? ctxRes.active : "";
      const chosen = ctxExists
        ? ctxs.find((c) => c.name === stateCtx)
        : ctxs.find((c) => c.name === activeFromBackend) || ctxs[0];
      const chosenCtx = chosen?.name || ctxRes.active || "";
      const optimisticNamespace =
        chosenCtx === appState.activeContext
          ? optimisticNamespaceForContext(appState, chosenCtx, chosen?.namespace, appState.activeNamespace)
          : optimisticNamespaceForContext(appState, chosenCtx, chosen?.namespace);

      if (chosenCtx) {
        setBootstrapPhase("context");
        setBootstrapDetail((d) => ({ ...d, context: `Selecting ${chosenCtx}` }));
        await apiPost("/api/context/select", token, { name: chosenCtx });
      }
      if (cancelled) return;
      setActiveContext(chosenCtx);
      if (optimisticNamespace) {
        setNamespace(optimisticNamespace);
      }
      setSection(appState.activeSection || "pods");

      // 2) local cache migration status
      setBootstrapPhase("migration");
      const migrationPhase = ctxRes.cacheMigration?.phase || "idle";
      const migrationDetail =
        migrationPhase === "running"
          ? "Checking local cache state"
          : migrationPhase === "failed"
            ? "Local cache migration failed, cache persistence disabled"
            : ctxRes.cacheMigration?.applied
              ? `Upgraded local cache schema to v${ctxRes.cacheMigration?.toVersion || "?"}`
              : "Local cache schema is up to date";
      setBootstrapDetail((d) => ({ ...d, migration: migrationDetail }));

      // 3) namespaces
      setBootstrapPhase("namespaces");
      setBootstrapDetail((d) => ({
        ...d,
        namespaces: "Starting observers and asking the dataplane for the namespace snapshot",
      }));
      const nsPath0 = namespacesListApiPath(appState, chosenCtx, appState.activeNamespace || "");
      const { limited, items: nsItems } = await fetchNamespacesWithWarmup(token, nsPath0, chosenCtx);
      if (cancelled) return;
      setNsLimited(limited);
      setNamespaces(nsItems);

      // 4) pick namespace
      const chosenNs = pickNamespace({
        limited,
        items: nsItems,
        preferred: optimisticNamespace || "",
      });
      setNamespace(chosenNs);

      // 5) section
      setSection(appState.activeSection || "pods");

      // 6) favourites for this ctx
      const fav = (appState.favouriteNamespacesByContext[chosenCtx] || []).slice();
      setFavourites(fav);

      // update stored state if we auto-picked; record MRU for enrichment hints
      setAppState((s) => {
        let next: typeof s = {
          ...s,
          activeContext: chosenCtx || s.activeContext,
          activeNamespace: chosenNs || s.activeNamespace,
          activeSection: s.activeSection || "pods",
        };
        if (chosenCtx && chosenNs) {
          next = recordRecentNamespace(next, chosenCtx, chosenNs);
        }
        return next;
      });
      setBootstrapDetail((d) => ({ ...d, namespaces: `${nsItems.length} namespaces available` }));
      setBootstrapPhase("ready");
    })().catch((err) => {
      if (cancelled) return;
      const message = String((err as Error | undefined)?.message || err || "Startup failed");
      setBootstrapError(message);
      setBootstrapPhase("error");
      console.error(err);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapNonce]);

  async function fetchNamespaces(
    currentToken: string,
    apiPath: string,
    contextName: string,
  ): Promise<{ limited: boolean; items: string[] }> {
    try {
      const nsRes = await apiGetWithContext<ApiNamespacesListResponse>(apiPath, currentToken, contextName);
      return {
        limited: !!nsRes.limited,
        items: (nsRes.items || []).map((x) => x.name),
      };
    } catch (err) {
      const apiErr = toApiError(err);
      if (apiErr.status === 401 || apiErr.status === 403) {
        return { limited: true, items: [] };
      }
      throw err;
    }
  }

  async function fetchNamespacesWithWarmup(
    currentToken: string,
    apiPath: string,
    contextName: string,
  ): Promise<{ limited: boolean; items: string[] }> {
    let result = await fetchNamespaces(currentToken, apiPath, contextName);
    if (result.limited || result.items.length > 0) return result;
    for (let i = 0; i < INITIAL_NAMESPACE_RETRY_ATTEMPTS; i += 1) {
      await sleep(INITIAL_NAMESPACE_RETRY_DELAY_MS);
      result = await fetchNamespaces(currentToken, apiPath, contextName);
      if (result.limited || result.items.length > 0) break;
    }
    return result;
  }

  async function onSelectContext(name: string, preferredNamespace?: string) {
    if (!name || name === activeContext || contextSwitching) return;
    const selected = contexts.find((c) => c.name === name);
    const optimisticNamespace = preferredNamespace || optimisticNamespaceForContext(appState, name, selected?.namespace);
    const showStartupDialog = bootstrapPhase !== "ready";
    setContextSwitching(true);
    setBootstrapError("");
    if (showStartupDialog) {
      setBootstrapPhase("context");
      setBootstrapDetail({
        context: `Selecting ${name}`,
        migration: "Checking local cache schema",
        namespaces: "Waiting for namespace snapshot",
      });
    }
    try {
      await apiPost("/api/context/select", token, { name });
      setActiveContext(name);
      if (optimisticNamespace) setNamespace(optimisticNamespace);

      if (showStartupDialog) {
        setBootstrapPhase("migration");
        const refreshedContexts = await apiGet<ApiContextsResponse>("/api/contexts", token);
        const migrationPhase = refreshedContexts.cacheMigration?.phase || "idle";
        const migrationDetail =
          migrationPhase === "running"
            ? "Checking local cache state"
            : migrationPhase === "failed"
              ? "Local cache migration failed, cache persistence disabled"
              : refreshedContexts.cacheMigration?.applied
                ? `Upgraded local cache schema to v${refreshedContexts.cacheMigration?.toVersion || "?"}`
                : "Local cache schema is up to date";
        setBootstrapDetail((d) => ({ ...d, migration: migrationDetail }));
        setBootstrapPhase("namespaces");
      }

      const nsPath = namespacesListApiPath(appState, name, optimisticNamespace || "");
      const { limited, items: nsItems } = showStartupDialog
        ? await fetchNamespacesWithWarmup(token, nsPath, name)
        : await fetchNamespaces(token, nsPath, name);
      setNsLimited(limited);
      setNamespaces(nsItems);

      // pick namespace from state if possible
      const chosenNs = pickNamespace({
        limited,
        items: nsItems,
        preferred: optimisticNamespace || "",
      });
      setNamespace(chosenNs);

      // load favourites for this context
      const fav = (appState.favouriteNamespacesByContext[name] || []).slice();
      setFavourites(fav);

      setAppState((s) => {
        let next: AppStateV1 = { ...s, activeContext: name, activeNamespace: chosenNs };
        if (name && chosenNs) next = recordRecentNamespace(next, name, chosenNs);
        return next;
      });
      setBootstrapDetail((d) => ({ ...d, namespaces: `${nsItems.length} namespaces available` }));
      setBootstrapPhase("ready");
    } catch (err) {
      const message = String((err as Error | undefined)?.message || err || "Context switch failed");
      setBootstrapError(message);
      setBootstrapPhase("error");
    } finally {
      setContextSwitching(false);
    }
  }

  function onSelectNamespace(ns: string) {
    setNamespace(ns);
    setAppState((s) => {
      let next: AppStateV1 = { ...s, activeNamespace: ns };
      if (activeContext) next = recordRecentNamespace(next, activeContext, ns);
      return next;
    });
  }

  function onToggleFavourite(ns: string) {
    if (!activeContext) return;
    setAppState((s) => {
      const next = toggleFavouriteNamespace(s, activeContext, ns);
      setFavourites(next.favouriteNamespacesByContext[activeContext] || []);
      return next;
    });
  }

  function onSelectSection(sec: Section) {
    setSettingsOpen(false);
    setSection(sec);
    setAppState((s) => recordRecentSection({ ...s, activeSection: sec }, sec, settings.appearance.recentMenuLimit));
  }

  useEffect(() => {
    const handleApplySavedView = (event: Event) => {
      const view = (event as CustomEvent<SavedResourceViewDefinition>).detail;
      if (!view) return;
      if (isDashboardSavedView(view)) {
        onSelectSection("dashboard");
        return;
      }
      if (!isSection(view.resource)) return;
      saveListTextFilter(view.filter || "");
      saveQuickFilterSelection([]);
      if (view.context && view.context !== activeContext) {
        void onSelectContext(view.context, view.namespace);
      } else if (view.namespace) {
        onSelectNamespace(view.namespace);
      }
      onSelectSection(view.resource);
    };
    window.addEventListener(APPLY_SAVED_RESOURCE_VIEW_EVENT, handleApplySavedView);
    return () => window.removeEventListener(APPLY_SAVED_RESOURCE_VIEW_EVENT, handleApplySavedView);
  });

  useEffect(() => {
    const handleApplyFocusedView = (event: Event) => {
      const intent = (event as CustomEvent<FocusedResourceViewIntent>).detail;
      if (!intent || !isSection(intent.resource)) return;
      saveListTextFilter(intent.filter || "");
      saveQuickFilterSelection([]);
      if (intent.context && intent.context !== activeContext) {
        void onSelectContext(intent.context, intent.namespace);
      } else if (intent.namespace) {
        onSelectNamespace(intent.namespace);
      }
      onSelectSection(intent.resource);
    };
    window.addEventListener(APPLY_FOCUSED_RESOURCE_VIEW_EVENT, handleApplyFocusedView);
    return () => window.removeEventListener(APPLY_FOCUSED_RESOURCE_VIEW_EVENT, handleApplyFocusedView);
  });

  function onToggleSidebarGroup(groupId: string) {
    setAppState((s) => {
      const nextCollapsed = !s.sidebarCollapsedGroups?.[groupId];
      return setSidebarGroupCollapsed(s, groupId, nextCollapsed);
    });
  }

  function onOpenSearchResult(item: ApiDataplaneSearchItem) {
    const targetSection = dataplaneSearchSectionByKind[item.kind];
    if (targetSection) {
      dispatchApplyFocusedResourceView({
        context: item.cluster,
        namespace: item.kind === "namespaces" ? undefined : item.namespace,
        resource: targetSection,
        filter: item.name,
        label: item.name,
        source: "search",
      });
    } else {
      if (item.namespace) onSelectNamespace(item.namespace);
      if (item.kind === "namespaces") onSelectNamespace(item.name);
    }
    setSettingsOpen(false);
    setSearchDrawerItem(item);
  }

  const startupMode = bootstrapPhase === "no-context" ? "no-context" : bootstrapPhase === "error" ? "error" : "loading";
  const startupMessage =
    bootstrapPhase === "no-context"
      ? "kview is running, but it did not find any Kubernetes context to select."
      : bootstrapPhase === "error"
        ? bootstrapError || "Startup did not complete."
        : "Preparing the active cluster view. Cached data may appear first while live snapshots refresh.";
  const resourcesOpen = !settingsOpen && !helpOpen;

  return (
    <ActiveContextProvider value={activeContext}>
      <SignalMemoryProvider
        token={token}
        activeContext={activeContext}
        onOpenSnapshot={(snapshot: InvestigationSnapshot) => {
          const ref = snapshot.primaryResource;
          onOpenSearchResult({
            cluster: snapshot.context || activeContext,
            kind: ref.kind,
            namespace: ref.namespace,
            name: ref.name,
            signalSeverity: snapshot.signal?.severity,
            signalCount: 1,
            needsAttention: snapshot.triageState !== "resolved" && snapshot.triageState !== "ignored",
            matchReason: "saved investigation",
          });
        }}
      >
      <QuickSignalExclusionProvider token={token}>
      <MutationProvider>
        <KeyboardProvider
          settingsOpen={settingsOpen || helpOpen}
          keyboardSettings={settings.keyboard}
          onFocusGlobalSearch={(query = "") => {
            setSearchFocusRequest((prev) => ({ nonce: prev.nonce + 1, query }));
          }}
          onSelectSection={onSelectSection}
          onOpenSettings={() => {
            setHelpOpen(false);
            setSettingsOpen(true);
          }}
        >
          <DataplaneSettingsSync token={token} />
          <Box
          sx={{
            display: "flex",
            height: "100dvh",
            maxHeight: "100dvh",
            backgroundColor: "var(--bg-primary)",
            color: "var(--text-primary)",
            pt: 8,
            overflow: "hidden",
          }}
        >
          <CssBaseline />
          <StartupDialog
            open={resourcesOpen && bootstrapPhase !== "ready"}
            mode={startupMode}
            message={startupMessage}
            steps={startupSteps(bootstrapPhase, bootstrapDetail)}
            kubeconfig={kubeconfigInfo}
            onRetry={() => setBootstrapNonce((n) => n + 1)}
          />
          <AppBar position="fixed" sx={{ zIndex: 1201 }}>
            <Toolbar sx={{ position: "relative" }}>
              <Box
                component="img"
                src={logoUrl}
                alt=""
                aria-hidden="true"
                sx={{ width: 42, height: 42, mr: 1.25, flex: "0 0 auto" }}
              />
              <Typography variant="h6" noWrap component="div">
                {settingsOpen ? "kview — Settings" : helpOpen ? "kview — Help" : `kview — ${activeContext || "no context"}`}
              </Typography>
              {resourcesOpen ? (
                <Box
                  sx={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    transform: "translate(-50%, -50%)",
                    zIndex: 1,
                  }}
                >
                  <GlobalSearchInput
                    token={token}
                    activeContext={activeContext}
                    disabled={health === "unhealthy" || !activeContext}
                    focusRequest={searchFocusRequest}
                    namespaces={namespaces}
                    contexts={contexts.map((ctx) => ctx.name)}
                    onSelectSection={onSelectSection}
                    onSelectNamespace={onSelectNamespace}
                    onSelectContext={(name) => {
                      void onSelectContext(name);
                    }}
                    onOpenResource={onOpenSearchResult}
                    onOpenSettings={() => {
                      setHelpOpen(false);
                      setSettingsOpen(true);
                    }}
                  />
                </Box>
              ) : null}
              <Box sx={{ flexGrow: 1 }} />
              <HelpSelector
                open={helpOpen}
                onToggle={() => {
                  setSettingsOpen(false);
                  setHelpOpen((v) => !v);
                }}
              />
              <SettingsSelector
                open={settingsOpen}
                onToggle={() => {
                  setHelpOpen(false);
                  setSettingsOpen((v) => !v);
                }}
              />
              <ThemeSelector />
            </Toolbar>
          </AppBar>

          {resourcesOpen ? (
            <Sidebar
              key={viewDescriptorRevision}
              contexts={contexts}
              activeContext={activeContext}
              onSelectContext={onSelectContext}
              namespaces={namespaces}
              namespace={namespace}
              onSelectNamespace={onSelectNamespace}
              nsLimited={nsLimited}
              favourites={favourites}
              recentNamespaces={recentNamespaces}
              recentSections={appState.recentSections || []}
              collapsedGroups={appState.sidebarCollapsedGroups || {}}
              smartNamespaceSorting={settings.appearance.smartNamespaceSorting}
              recentMenuEnabled={settings.appearance.recentMenuEnabled}
              recentMenuLimit={settings.appearance.recentMenuLimit}
              onToggleFavourite={onToggleFavourite}
              onToggleGroup={onToggleSidebarGroup}
              section={section}
              onSelectSection={onSelectSection}
              buildVersion={backendVersion}
              releaseChecksEnabled={settings.appearance.releaseChecksEnabled}
            />
          ) : null}

          <Box
            component="main"
            sx={{
              flexGrow: 1,
              minWidth: 0,
              minHeight: 0,
              position: "relative",
              zIndex: settingsOpen || helpOpen ? 1300 : "auto",
              pb: settingsOpen || helpOpen ? 0 : "var(--bottom-panel-offset, 32px)",
              backgroundColor: "var(--bg-primary)",
              color: "var(--text-primary)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <ConnectionBanner />
            {/* Single bounded main column: children fill width/height; dashboard scrolls here; tables scroll inside Paper/DataGrid */}
            <Box className="kview-main-content" sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
              {helpOpen ? (
                <React.Suspense fallback={<Box sx={{ flex: 1, minHeight: 0 }} />}>
                  <HelpView onClose={() => setHelpOpen(false)} />
                </React.Suspense>
              ) : null}
              {settingsOpen ? (
                <React.Suspense fallback={<Box sx={{ flex: 1, minHeight: 0 }} />}>
                  <SettingsView
                    token={token}
                    contexts={contexts}
                    namespaces={namespaces}
                    activeContext={activeContext}
                    activeNamespace={namespace}
                    appState={appState}
                    setAppState={setAppState}
                    onClose={() => setSettingsOpen(false)}
                  />
                </React.Suspense>
              ) : null}
              {resourcesOpen ? (
                <React.Suspense fallback={<Box sx={{ flex: 1, minHeight: 0 }} />}>
                  {section === "dashboard" ? (
                    <DashboardView
                      token={token}
                      favouriteNamespaces={
                        settings.appearance.dashboardFavouriteNamespaceFilters ? favourites : []
                      }
                      recentNamespaces={
                        settings.appearance.dashboardRecentNamespaceFilters ? recentNamespaces : []
                      }
                      onNavigate={(sec, ns) => {
                        onSelectNamespace(ns);
                        onSelectSection(sec as Section);
                      }}
                    />
                  ) : null}
                  {section === "nodes" ? <NodesTable token={token} /> : null}
                  {section === "namespaces" ? (
                    <NamespacesTable
                      token={token}
                      listApiPath={namespacesListPath}
                      favourites={favourites}
                      recentNamespaces={recentNamespaces}
                      smartNamespaceSorting={settings.appearance.smartNamespaceSorting}
                      onToggleFavourite={onToggleFavourite}
                      onNavigate={(sec, ns, filter) => {
                        onSelectNamespace(ns);
                        if (sec === "customresources" && filter) {
                          setCustomResourcesFilterIntent((prev) => ({ value: filter, nonce: (prev?.nonce || 0) + 1 }));
                        }
                        onSelectSection(sec as Section);
                      }}
                    />
                  ) : null}
                  {section === "pods" && namespace ? <PodsTable token={token} namespace={namespace} /> : null}
                  {section === "deployments" && namespace ? (
                    <DeploymentsTable token={token} namespace={namespace} />
                  ) : null}
                  {section === "daemonsets" && namespace ? (
                    <DaemonSetsTable token={token} namespace={namespace} />
                  ) : null}
                  {section === "statefulsets" && namespace ? (
                    <StatefulSetsTable token={token} namespace={namespace} />
                  ) : null}
                  {section === "replicasets" && namespace ? (
                    <ReplicaSetsTable token={token} namespace={namespace} />
                  ) : null}
                  {section === "jobs" && namespace ? <JobsTable token={token} namespace={namespace} /> : null}
                  {section === "cronjobs" && namespace ? <CronJobsTable token={token} namespace={namespace} /> : null}
                  {section === "horizontalpodautoscalers" && namespace ? (
                    <HorizontalPodAutoscalersTable token={token} namespace={namespace} />
                  ) : null}
                  {section === "services" && namespace ? <ServicesTable token={token} namespace={namespace} /> : null}
                  {section === "ingresses" && namespace ? <IngressesTable token={token} namespace={namespace} /> : null}
                  {section === "networkpolicies" && namespace ? (
                    <NetworkPoliciesTable token={token} namespace={namespace} />
                  ) : null}
                  {section === "configmaps" && namespace ? <ConfigMapsTable token={token} namespace={namespace} /> : null}
                  {section === "secrets" && namespace ? <SecretsTable token={token} namespace={namespace} /> : null}
                  {section === "serviceaccounts" && namespace ? (
                    <ServiceAccountsTable token={token} namespace={namespace} />
                  ) : null}
                  {section === "roles" && namespace ? <RolesTable token={token} namespace={namespace} /> : null}
                  {section === "rolebindings" && namespace ? <RoleBindingsTable token={token} namespace={namespace} /> : null}
                  {section === "clusterroles" ? <ClusterRolesTable token={token} /> : null}
                  {section === "clusterrolebindings" ? <ClusterRoleBindingsTable token={token} /> : null}
                  {section === "persistentvolumes" ? <PersistentVolumesTable token={token} /> : null}
                  {section === "persistentvolumeclaims" && namespace ? (
                    <PersistentVolumeClaimsTable token={token} namespace={namespace} />
                  ) : null}
                  {section === "resourcequotas" && namespace ? (
                    <ResourceQuotasTable token={token} namespace={namespace} />
                  ) : null}
                  {section === "limitranges" && namespace ? (
                    <LimitRangesTable token={token} namespace={namespace} />
                  ) : null}
                  {section === "customresourcedefinitions" ? (
                    <CustomResourceDefinitionsTable token={token} />
                  ) : null}
                  {section === "customresources" && namespace ? (
                    <CustomResourcesTable
                      token={token}
                      namespace={namespace}
                      filterIntent={customResourcesFilterIntent}
                      onFilterIntentApplied={(nonce) => {
                        setCustomResourcesFilterIntent((prev) => (prev?.nonce === nonce ? null : prev));
                      }}
                    />
                  ) : null}
                  {section === "clusterresources" ? (
                    <ClusterCustomResourcesTable token={token} />
                  ) : null}
                  {section === "helm" && namespace ? (
                    <HelmReleasesTable token={token} namespace={namespace} />
                  ) : null}
                  {section === "helmcharts" ? <HelmChartsTable token={token} /> : null}
                </React.Suspense>
              ) : null}
            </Box>
          </Box>
          <Snackbar
            open={recoveryOpen}
            autoHideDuration={3000}
            onClose={() => setRecoveryOpen(false)}
            anchorOrigin={{ vertical: "top", horizontal: "center" }}
          >
            <Alert severity="success" variant="filled" onClose={() => setRecoveryOpen(false)}>
              Connection restored
            </Alert>
          </Snackbar>
          <ActivityPanel
            token={token}
            covered={settingsOpen || helpOpen}
            initialOpen={appState.activityPanelOpen ?? true}
            initialHeight={appState.activityPanelHeightPx}
            onOpenChange={handleActivityPanelOpenChange}
            onHeightChange={handleActivityPanelHeightChange}
          />
          <DataplaneSearchDrawer
            token={token}
            item={searchDrawerItem}
            onClose={() => setSearchDrawerItem(null)}
            onNavigate={(sec, ns) => {
              onSelectNamespace(ns);
              onSelectSection(sec as Section);
            }}
          />
        </Box>
        </KeyboardProvider>
      </MutationProvider>
      </QuickSignalExclusionProvider>
      </SignalMemoryProvider>
    </ActiveContextProvider>
  );
}

export function DataplaneSettingsSync({ token }: { token: string }) {
  const { settings } = useUserSettings();
  const activeContext = useActiveContext();
  const lastSweepWarmKeyRef = useRef<string>("");
  const dashboardRefreshSec = settings.appearance.dashboardRefreshSec;
  const dataplaneSettings = settings.dataplane;
  const dataplaneBundle = useMemo(
    () => buildDataplaneBundleForSync(dataplaneSettings, dashboardRefreshSec),
    [dashboardRefreshSec, dataplaneSettings],
  );
  const effectiveDataplane = useMemo(
    () => dataplaneSettingsForContext(dataplaneSettings, activeContext),
    [activeContext, dataplaneSettings],
  );

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      apiPost("/api/dataplane/config", token, dataplaneBundle)
        .then(() => {
          dispatchSignalExclusionsChanged();
          const sweep = effectiveDataplane.namespaceEnrichment.sweep;
          const warmKey = effectiveDataplane.namespaceEnrichment.enabled && sweep.enabled
            ? [
                activeContext,
                effectiveDataplane.profile,
                sweep.maxNamespacesPerCycle,
                sweep.maxNamespacesPerHour,
                sweep.minReenrichIntervalMinutes,
                sweep.includeSystemNamespaces,
                effectiveDataplane.namespaceEnrichment.warmResourceKinds.join(","),
              ].join(":")
            : "";
          if (!activeContext || !warmKey || warmKey === lastSweepWarmKeyRef.current || cancelled) {
            if (!warmKey) lastSweepWarmKeyRef.current = "";
            return;
          }
          lastSweepWarmKeyRef.current = warmKey;
          apiGetWithContext<ApiNamespacesListResponse>("/api/namespaces", token, activeContext).catch(() => {
            /* Sweep warm-up is best-effort; connection banner handles backend failures. */
          });
        })
        .catch(() => {
          /* Settings sync is best-effort; connection banner handles backend failures. */
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeContext, dataplaneBundle, effectiveDataplane, token]);
  return null;
}

function SettingsSelector({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <AppIconButton tooltip={open ? "Return to resources" : "Settings"} label={open ? "Return to resources" : "Settings"} data-testid="settings-toggle" color="inherit" onClick={onToggle}>
      <ConstructionIcon fontSize="small" />
    </AppIconButton>
  );
}

function HelpSelector({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <AppIconButton tooltip={open ? "Return to resources" : "Help"} label={open ? "Return to resources" : "Help"} color="inherit" onClick={onToggle}>
      <HelpOutlineIcon fontSize="small" />
    </AppIconButton>
  );
}

function ThemeSelector() {
  const { mode, setMode } = useThemeMode();
  const icon =
    mode === "light" ? <Brightness7Icon fontSize="small" /> : mode === "dark" ? <DarkModeIcon fontSize="small" /> : <BrightnessAutoIcon fontSize="small" />;
  const nextMode = mode === "light" ? "dark" : mode === "dark" ? "system" : "light";
  const title = mode === "light" ? "Theme: Light" : mode === "dark" ? "Theme: Dark" : "Theme: System";

  return (
    <AppIconButton
      tooltip={`${title}. Click to switch to ${nextMode}.`}
      label={title}
      color="inherit"
      onClick={() => {
        setMode(nextMode);
      }}
    >
      {icon}
    </AppIconButton>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <UserSettingsProvider>
        <AppInner />
      </UserSettingsProvider>
    </ThemeProvider>
  );
}
