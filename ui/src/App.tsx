import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, CssBaseline, AppBar, Toolbar, Typography, Snackbar, Alert } from "@mui/material";
import Brightness7Icon from "@mui/icons-material/Brightness7";
import RefreshIcon from "@mui/icons-material/Refresh";
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
import { useConnectionState } from "./connectionState";
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
  setPerformanceDiagnosticsContext,
  setPerformanceDiagnosticsEnabled,
} from "./utils/performanceDiagnostics";
import useBackendStatusPolling from "./hooks/useBackendStatusPolling";
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
type BootstrapPhase = "contexts" | "context" | "migration" | "ready" | "no-context" | "error";

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
  const [namespaceLoading, setNamespaceLoading] = useState(false);
  const [namespaceError, setNamespaceError] = useState("");
  const [namespaceNonce, setNamespaceNonce] = useState(0);
  const namespaceGeneration = useRef(0);
  const namespaceSelection = useRef(0);
  const contextGeneration = useRef(0);
  const namespaceAbort = useRef<AbortController | null>(null);

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
  const namespaceRequest = useRef({ state: appState, preferred: "" });
  useEffect(() => () => { ++contextGeneration.current; }, []);

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

  useBackendStatusPolling({
    token,
    activeContext,
    backendHealth,
    pageVisible,
    retryNonce,
    settingsOpen,
  });

  // initial bootstrap
  useEffect(() => {
    let cancelled = false;
    const generation = ++contextGeneration.current;
    ++namespaceGeneration.current;
    namespaceAbort.current?.abort();
    const current = () => !cancelled && generation === contextGeneration.current;
    (async () => {
      // Retry may select a different context. Retire all previous context inventory
      // before releasing the shell, including restriction/error state.
      setNamespaces([]);
      setNsLimited(false);
      setNamespaceError("");
      setNamespaceLoading(false);
      setBootstrapPhase("contexts");
      setBootstrapError("");
      setBootstrapDetail({ contexts: "Reading configured kubeconfig files" });
      // 1) contexts
      const ctxRes = await apiGet<ApiContextsResponse>("/api/contexts", token);
      if (!current()) return;
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
      if (!current()) return;
      setNamespaceLoading(true);
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

      // Context selection is the shell gate. Namespace inventory/cache warmup is
      // independent and must not keep navigation behind the startup modal.
      namespaceRequest.current = { state: appState, preferred: optimisticNamespace };
      setAppState((s) => ({ ...s, activeContext: chosenCtx, activeNamespace: optimisticNamespace }));
      setBootstrapPhase("ready");
    })().catch((err) => {
      if (!current()) return;
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
    signal: AbortSignal,
  ): Promise<{ limited: boolean; items: string[] }> {
    try {
      const nsRes = await apiGetWithContext<ApiNamespacesListResponse>(apiPath, currentToken, contextName, { signal });
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
    current: () => boolean,
    signal: AbortSignal,
  ): Promise<{ limited: boolean; items: string[] }> {
    let result = await fetchNamespaces(currentToken, apiPath, contextName, signal);
    if (result.limited || result.items.length > 0) return result;
    for (let i = 0; i < INITIAL_NAMESPACE_RETRY_ATTEMPTS; i += 1) {
      if (!current()) return result;
      await sleep(INITIAL_NAMESPACE_RETRY_DELAY_MS);
      if (!current()) return result;
      result = await fetchNamespaces(currentToken, apiPath, contextName, signal);
      if (result.limited || result.items.length > 0) break;
    }
    return result;
  }

  // Each context/retry owns its namespace completion. A pending response cannot
  // publish into a newer context, restart retries after unmount, or undo a choice
  // the operator made while the shell was already usable.
  useEffect(() => {
    if (!activeContext || bootstrapPhase !== "ready") return;
    let cancelled = false;
    const generation = ++namespaceGeneration.current;
    const controller = new AbortController();
    namespaceAbort.current = controller;
    const selection = namespaceSelection.current;
    const current = () => !cancelled && generation === namespaceGeneration.current;
    const { state, preferred } = namespaceRequest.current;
    setNamespaceLoading(true);
    setNamespaceError("");
    const path = namespacesListApiPath(state, activeContext, preferred);
    void fetchNamespacesWithWarmup(token, path, activeContext, current, controller.signal).then(({ limited, items }) => {
      if (!current()) return;
      setNsLimited(limited);
      setNamespaces(items);
      if (selection === namespaceSelection.current) {
        const chosen = pickNamespace({ limited, items, preferred });
        setNamespace(chosen);
        setAppState((s) => {
          const next = { ...s, activeNamespace: chosen };
          return chosen ? recordRecentNamespace(next, activeContext, chosen) : next;
        });
      }
    }).catch((err) => {
      if (current()) setNamespaceError(String((err as Error)?.message || err || "Namespace loading failed"));
    }).finally(() => {
      if (current()) setNamespaceLoading(false);
    });
    return () => { cancelled = true; controller.abort(); };
    // Requests use the context-selection snapshot, not changing navigation state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeContext, bootstrapPhase, namespaceNonce, token]);

  async function onSelectContext(name: string, preferredNamespace?: string) {
    if (!name || name === activeContext || contextSwitching) return;
    const selected = contexts.find((c) => c.name === name);
    const preferred = preferredNamespace || optimisticNamespaceForContext(appState, name, selected?.namespace);
    const generation = ++contextGeneration.current;
    ++namespaceGeneration.current;
    namespaceAbort.current?.abort();
    setContextSwitching(true);
    setBootstrapError("");
    try {
      await apiPost("/api/context/select", token, { name });
      if (generation !== contextGeneration.current) return;
      namespaceRequest.current = { state: appState, preferred };
      setNamespaces([]);
      setNsLimited(false);
      setNamespaceError("");
      setNamespaceLoading(true);
      setActiveContext(name);
      setNamespace(preferred);
      setAppState((s) => ({ ...s, activeContext: name, activeNamespace: preferred }));
      setBootstrapPhase("ready");
    } catch (err) {
      if (generation !== contextGeneration.current) return;
      const message = String((err as Error | undefined)?.message || err || "Context switch failed");
      setBootstrapError(message);
      setBootstrapPhase("error");
    } finally {
      if (generation === contextGeneration.current) setContextSwitching(false);
    }
  }

  function onSelectNamespace(ns: string) {
    ++namespaceSelection.current;
    namespaceRequest.current.preferred = ns;
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
              namespaceInventoryUnavailable={namespaceLoading || !!namespaceError}
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
            {bootstrapPhase === "ready" && namespaceLoading ? (
              <Alert severity="info" role="status">Loading namespaces and dataplane cache in the background. You can keep navigating.</Alert>
            ) : null}
            {bootstrapPhase === "ready" && !namespaceLoading && (namespaceError || namespaces.length === 0) ? (
              <Alert severity={namespaceError ? "warning" : "info"} action={
                <AppIconButton tooltip="Retry namespaces" label="Retry namespaces" onClick={() => setNamespaceNonce((n) => n + 1)}>
                  <RefreshIcon fontSize="small" />
                </AppIconButton>
              }>
                {namespaceError || (nsLimited ? "Namespace listing is restricted. Use a known namespace." : "No namespaces returned. Choose another context or retry.")}
              </Alert>
            ) : null}
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
                    <CustomResourceDefinitionsTable token={token} namespace={namespace} />
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
  // Mount-local only: a new app/backend session must still receive its bundle.
  const configSyncRef = useRef<{ inFlight: Promise<void> | null; syncedKey: string | null }>({
    inFlight: null,
    syncedKey: null,
  });
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
      void (async () => {
          const sync = configSyncRef.current;
          // Cleanup retires queued work, not server mutations. Wait for the
          // current POST before applying only the latest still-mounted intent.
          while (sync.inFlight) {
            await sync.inFlight.catch(() => {});
            if (cancelled) return;
          }
          // Context selects effective sweep policy, not the full config payload.
          // Include credentials so a success under an old token cannot suppress
          // a new identity's sync. Failed writes are never remembered as synced.
          const key = JSON.stringify([token, dataplaneBundle]);
          if (sync.syncedKey !== key) {
            sync.syncedKey = null;
            const request = apiPost("/api/dataplane/config", token, dataplaneBundle).then(() => {
              sync.syncedKey = key;
            });
            sync.inFlight = request;
            try {
              await request;
            } finally {
              sync.inFlight = null;
            }
          }
          if (cancelled) return;
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
      })()
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
