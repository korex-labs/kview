import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, CssBaseline, AppBar, Toolbar, Typography, Snackbar, Alert, IconButton, Tooltip } from "@mui/material";
import Brightness7Icon from "@mui/icons-material/Brightness7";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import BrightnessAutoIcon from "@mui/icons-material/BrightnessAuto";
import ConstructionIcon from "@mui/icons-material/Construction";
import logoUrl from "./assets/logo.svg";
import Sidebar from "./components/Sidebar";
import NodesTable from "./components/resources/nodes/NodesTable";
import NamespacesTable from "./components/resources/namespaces/NamespacesTable";
import PodsTable from "./components/resources/pods/PodsTable";
import DeploymentsTable from "./components/resources/deployments/DeploymentsTable";
import DaemonSetsTable from "./components/resources/daemonsets/DaemonSetsTable";
import StatefulSetsTable from "./components/resources/statefulsets/StatefulSetsTable";
import ReplicaSetsTable from "./components/resources/replicasets/ReplicaSetsTable";
import ServicesTable from "./components/resources/services/ServicesTable";
import IngressesTable from "./components/resources/ingresses/IngressesTable";
import JobsTable from "./components/resources/jobs/JobsTable";
import CronJobsTable from "./components/resources/cronjobs/CronJobsTable";
import HorizontalPodAutoscalersTable from "./components/resources/horizontalpodautoscalers/HorizontalPodAutoscalersTable";
import ConfigMapsTable from "./components/resources/configmaps/ConfigMapsTable";
import SecretsTable from "./components/resources/secrets/SecretsTable";
import ServiceAccountsTable from "./components/resources/serviceaccounts/ServiceAccountsTable";
import RolesTable from "./components/resources/roles/RolesTable";
import RoleBindingsTable from "./components/resources/rolebindings/RoleBindingsTable";
import ClusterRolesTable from "./components/resources/clusterroles/ClusterRolesTable";
import ClusterRoleBindingsTable from "./components/resources/clusterrolebindings/ClusterRoleBindingsTable";
import PersistentVolumesTable from "./components/resources/persistentvolumes/PersistentVolumesTable";
import PersistentVolumeClaimsTable from "./components/resources/persistentvolumeclaims/PersistentVolumeClaimsTable";
import HelmReleasesTable from "./components/resources/helm/HelmReleasesTable";
import HelmChartsTable from "./components/resources/helm/HelmChartsTable";
import CustomResourceDefinitionsTable from "./components/resources/customresourcedefinitions/CustomResourceDefinitionsTable";
import CustomResourcesTable from "./components/resources/customresources/CustomResourcesTable";
import ClusterCustomResourcesTable from "./components/resources/customresources/ClusterCustomResourcesTable";
import { apiGet, apiGetWithContext, apiPost, toApiError } from "./api";
import type { ApiContextsResponse, ApiNamespacesListResponse } from "./types/api";
import {
  loadState,
  namespacesListApiPath,
  recordRecentNamespace,
  saveState,
  toggleFavouriteNamespace,
  type AppStateV1,
  type Section,
} from "./state";
import { notifyApiFailure, notifyStatus, useConnectionState, type AppStatus } from "./connectionState";
import ConnectionBanner from "./components/shared/ConnectionBanner";
import DashboardView from "./components/resources/dashboard/DashboardView";
import ActivityPanel from "./components/activity/ActivityPanel";
import { ActiveContextProvider, useActiveContext } from "./activeContext";
import MutationProvider from "./components/mutations/MutationProvider";
import { ThemeProvider, useThemeMode } from "./theme/ThemeProvider";
import { UserSettingsProvider, useUserSettings } from "./settingsContext";
import SettingsView from "./components/settings/SettingsView";
import DataplaneQuickSearch from "./components/search/DataplaneQuickSearch";
import DataplaneSearchDrawer from "./components/search/DataplaneSearchDrawer";
import type { ApiDataplaneSearchItem } from "./types/api";
import StartupDialog, { type StartupKubeconfigInfo, type StartupStep, type StartupStepStatus } from "./components/StartupDialog";
import { POLL_STATUS_INTERVAL_MS } from "./constants/pollIntervals";
import { dataplaneSearchSectionByKind } from "./constants/resourceSections";
import { dataplaneSettingsForContext } from "./settings";
import { buildDataplaneBundleForSync } from "./dataplaneSync";
import KeyboardProvider from "./keyboard/KeyboardProvider";
import "./styles/theme.css";

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
  const { health, backendVersion, lastRecoveryShownAt, retryNonce } = useConnectionState();
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [lastRecoverySeenAt, setLastRecoverySeenAt] = useState<number | null>(null);
  const [contexts, setContexts] = useState<ContextOption[]>([]);
  const [activeContext, setActiveContext] = useState<string>("");
  const [bootstrapPhase, setBootstrapPhase] = useState<BootstrapPhase>("contexts");
  const [bootstrapDetail, setBootstrapDetail] = useState<Partial<Record<BootstrapPhase, string>>>({});
  const [bootstrapError, setBootstrapError] = useState<string>("");
  const [kubeconfigInfo, setKubeconfigInfo] = useState<StartupKubeconfigInfo | null>(null);
  const [bootstrapNonce, setBootstrapNonce] = useState(0);

  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [nsLimited, setNsLimited] = useState<boolean>(false);
  const [namespace, setNamespace] = useState<string>("");

  const [section, setSection] = useState<Section>("pods");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchDrawerItem, setSearchDrawerItem] = useState<ApiDataplaneSearchItem | null>(null);
  const [searchFocusNonce, setSearchFocusNonce] = useState(0);

  const [favourites, setFavourites] = useState<string[]>([]);

  // load from localStorage once
  const [appState, setAppState] = useState(() => loadState());

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

  // persist on change
  useEffect(() => {
    saveState(appState);
  }, [appState]);

  useEffect(() => {
    if (!lastRecoveryShownAt) return;
    if (lastRecoveryShownAt === lastRecoverySeenAt) return;
    setLastRecoverySeenAt(lastRecoveryShownAt);
    setRecoveryOpen(true);
  }, [lastRecoverySeenAt, lastRecoveryShownAt]);

  useEffect(() => {
    let cancelled = false;

    const pollStatus = async () => {
      try {
        const res = await fetch("/api/status", {
          headers: {
            Authorization: `Bearer ${token}`,
            ...(activeContext ? { "X-Kview-Context": activeContext } : {}),
          },
        });
        if (!res.ok) {
          const message = res.statusText || `Status check failed (${res.status})`;
          if (!cancelled) notifyApiFailure(res.status >= 500 ? "backend" : "request", message);
          return;
        }
        const status = (await res.json()) as AppStatus;
        if (!cancelled) notifyStatus(status);
      } catch (err) {
        if (!cancelled) {
          notifyApiFailure("backend", String((err as Error | undefined)?.message || err || "Network error"));
        }
      }
    };

    void pollStatus();
    const id = window.setInterval(pollStatus, POLL_STATUS_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [activeContext, retryNonce, token]);

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
      const optimisticNamespace = appState.activeNamespace || chosen?.namespace || "default";

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

  async function onSelectContext(name: string) {
    const selected = contexts.find((c) => c.name === name);
    const optimisticNamespace = selected?.namespace || appState.activeNamespace || "default";
    setBootstrapPhase("context");
    setBootstrapError("");
    setBootstrapDetail({
      context: `Selecting ${name}`,
      migration: "Checking local cache schema",
      namespaces: "Waiting for namespace snapshot",
    });
    try {
      await apiPost("/api/context/select", token, { name });
      setActiveContext(name);
      if (optimisticNamespace) setNamespace(optimisticNamespace);

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
      const nsPath = namespacesListApiPath(appState, name, appState.activeNamespace || "");
      const { limited, items: nsItems } = await fetchNamespacesWithWarmup(token, nsPath, name);
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
    setAppState((s) => ({ ...s, activeSection: sec }));
  }

  function onOpenSearchResult(item: ApiDataplaneSearchItem) {
    const targetSection = dataplaneSearchSectionByKind[item.kind];
    if (item.namespace) onSelectNamespace(item.namespace);
    if (item.kind === "namespaces") onSelectNamespace(item.name);
    if (targetSection) onSelectSection(targetSection);
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

  return (
    <ActiveContextProvider value={activeContext}>
      <MutationProvider>
        <KeyboardProvider
          namespaces={namespaces}
          contexts={contexts.map((ctx) => ctx.name)}
          settingsOpen={settingsOpen}
          keyboardSettings={settings.keyboard}
          onFocusGlobalSearch={() => setSearchFocusNonce((nonce) => nonce + 1)}
          onSelectSection={onSelectSection}
          onSelectNamespace={onSelectNamespace}
          onSelectContext={(name) => {
            void onSelectContext(name);
          }}
          onOpenSettings={() => setSettingsOpen(true)}
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
            open={!settingsOpen && bootstrapPhase !== "ready"}
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
                {settingsOpen ? "kview — Settings" : `kview — ${activeContext || "no context"}`}
              </Typography>
              {!settingsOpen ? (
                <Box
                  sx={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    transform: "translate(-50%, -50%)",
                    zIndex: 1,
                  }}
                >
                  <DataplaneQuickSearch
                    token={token}
                    activeContext={activeContext}
                    disabled={health === "unhealthy"}
                    focusNonce={searchFocusNonce}
                    onOpenResult={onOpenSearchResult}
                  />
                </Box>
              ) : null}
              <Box sx={{ flexGrow: 1 }} />
              <SettingsSelector open={settingsOpen} onToggle={() => setSettingsOpen((v) => !v)} />
              <ThemeSelector />
            </Toolbar>
          </AppBar>

          {!settingsOpen ? (
            <Sidebar
              contexts={contexts}
              activeContext={activeContext}
              onSelectContext={onSelectContext}
              namespaces={namespaces}
              namespace={namespace}
              onSelectNamespace={onSelectNamespace}
              nsLimited={nsLimited}
              favourites={favourites}
              recentNamespaces={recentNamespaces}
              smartNamespaceSorting={settings.appearance.smartNamespaceSorting}
              onToggleFavourite={onToggleFavourite}
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
              zIndex: settingsOpen ? 1300 : "auto",
              pb: settingsOpen ? 0 : "var(--bottom-panel-offset, 32px)",
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
              {settingsOpen ? (
                <SettingsView
                  token={token}
                  contexts={contexts}
                  namespaces={namespaces}
                  activeContext={activeContext}
                  activeNamespace={namespace}
                  onClose={() => setSettingsOpen(false)}
                />
              ) : null}
              {!settingsOpen && section === "dashboard" ? (
                <DashboardView
                  token={token}
                  onNavigate={(sec, ns) => {
                    onSelectNamespace(ns);
                    onSelectSection(sec as Section);
                  }}
                />
              ) : null}
              {!settingsOpen && section === "nodes" ? <NodesTable token={token} /> : null}
              {!settingsOpen && section === "namespaces" ? (
                <NamespacesTable
                  token={token}
                  listApiPath={namespacesListPath}
                  favourites={favourites}
                  recentNamespaces={recentNamespaces}
                  smartNamespaceSorting={settings.appearance.smartNamespaceSorting}
                  onToggleFavourite={onToggleFavourite}
                  onNavigate={(sec, ns) => {
                    onSelectNamespace(ns);
                    onSelectSection(sec as Section);
                  }}
                />
              ) : null}
              {!settingsOpen && section === "pods" && namespace ? <PodsTable token={token} namespace={namespace} /> : null}
              {!settingsOpen && section === "deployments" && namespace ? (
                <DeploymentsTable token={token} namespace={namespace} />
              ) : null}
              {!settingsOpen && section === "daemonsets" && namespace ? (
                <DaemonSetsTable token={token} namespace={namespace} />
              ) : null}
              {!settingsOpen && section === "statefulsets" && namespace ? (
                <StatefulSetsTable token={token} namespace={namespace} />
              ) : null}
              {!settingsOpen && section === "replicasets" && namespace ? (
                <ReplicaSetsTable token={token} namespace={namespace} />
              ) : null}
              {!settingsOpen && section === "jobs" && namespace ? <JobsTable token={token} namespace={namespace} /> : null}
              {!settingsOpen && section === "cronjobs" && namespace ? <CronJobsTable token={token} namespace={namespace} /> : null}
              {!settingsOpen && section === "horizontalpodautoscalers" && namespace ? (
                <HorizontalPodAutoscalersTable token={token} namespace={namespace} />
              ) : null}
              {!settingsOpen && section === "services" && namespace ? <ServicesTable token={token} namespace={namespace} /> : null}
              {!settingsOpen && section === "ingresses" && namespace ? <IngressesTable token={token} namespace={namespace} /> : null}
              {!settingsOpen && section === "configmaps" && namespace ? <ConfigMapsTable token={token} namespace={namespace} /> : null}
              {!settingsOpen && section === "secrets" && namespace ? <SecretsTable token={token} namespace={namespace} /> : null}
              {!settingsOpen && section === "serviceaccounts" && namespace ? (
                <ServiceAccountsTable token={token} namespace={namespace} />
              ) : null}
              {!settingsOpen && section === "roles" && namespace ? <RolesTable token={token} namespace={namespace} /> : null}
              {!settingsOpen && section === "rolebindings" && namespace ? <RoleBindingsTable token={token} namespace={namespace} /> : null}
              {!settingsOpen && section === "clusterroles" ? <ClusterRolesTable token={token} /> : null}
              {!settingsOpen && section === "clusterrolebindings" ? <ClusterRoleBindingsTable token={token} /> : null}
              {!settingsOpen && section === "persistentvolumes" ? <PersistentVolumesTable token={token} /> : null}
              {!settingsOpen && section === "persistentvolumeclaims" && namespace ? (
                <PersistentVolumeClaimsTable token={token} namespace={namespace} />
              ) : null}
              {!settingsOpen && section === "customresourcedefinitions" ? (
                <CustomResourceDefinitionsTable token={token} />
              ) : null}
              {!settingsOpen && section === "customresources" && namespace ? (
                <CustomResourcesTable token={token} namespace={namespace} />
              ) : null}
              {!settingsOpen && section === "clusterresources" ? (
                <ClusterCustomResourcesTable token={token} />
              ) : null}
              {!settingsOpen && section === "helm" && namespace ? (
                <HelmReleasesTable token={token} namespace={namespace} />
              ) : null}
              {!settingsOpen && section === "helmcharts" ? <HelmChartsTable token={token} /> : null}
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
          <ActivityPanel token={token} covered={settingsOpen} />
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
    <Tooltip title={open ? "Return to resources" : "Settings"}>
      <IconButton size="small" color="inherit" onClick={onToggle}>
        <ConstructionIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}

function ThemeSelector() {
  const { mode, setMode } = useThemeMode();
  const icon =
    mode === "light" ? <Brightness7Icon fontSize="small" /> : mode === "dark" ? <DarkModeIcon fontSize="small" /> : <BrightnessAutoIcon fontSize="small" />;
  const nextMode = mode === "light" ? "dark" : mode === "dark" ? "system" : "light";
  const title = mode === "light" ? "Theme: Light" : mode === "dark" ? "Theme: Dark" : "Theme: System";

  return (
    <Tooltip title={`${title}. Click to switch to ${nextMode}.`}>
      <IconButton
        size="small"
        color="inherit"
        onClick={() => {
          setMode(nextMode);
        }}
      >
        {icon}
      </IconButton>
    </Tooltip>
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
