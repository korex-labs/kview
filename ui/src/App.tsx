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
import { POLL_STATUS_INTERVAL_MS } from "./constants/pollIntervals";
import { dataplaneSearchSectionByKind } from "./constants/resourceSections";
import "./styles/theme.css";

function getToken(): string {
  const u = new URL(window.location.href);
  return u.searchParams.get("token") || "";
}

function AppInner() {
  const token = useMemo(() => getToken(), []);
  const { settings } = useUserSettings();
  const { activeIssue, backendVersion, lastRecoveryShownAt, retryNonce } = useConnectionState();
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [criticalOpen, setCriticalOpen] = useState(false);
  const [lastCriticalSeenId, setLastCriticalSeenId] = useState<string | null>(null);
  const [lastRecoverySeenAt, setLastRecoverySeenAt] = useState<number | null>(null);
  const [contexts, setContexts] = useState<Array<{ name: string }>>([]);
  const [activeContext, setActiveContext] = useState<string>("");

  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [nsLimited, setNsLimited] = useState<boolean>(false);
  const [namespace, setNamespace] = useState<string>("");

  const [section, setSection] = useState<Section>("pods");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchDrawerItem, setSearchDrawerItem] = useState<ApiDataplaneSearchItem | null>(null);

  const [favourites, setFavourites] = useState<string[]>([]);

  // load from localStorage once
  const [appState, setAppState] = useState(() => loadState());

  const namespacesListPath = useMemo(
    () =>
      namespacesListApiPath(
        appState,
        activeContext,
        namespace,
        settings.dataplane.namespaceEnrichment.recentLimit,
        settings.dataplane.namespaceEnrichment.favouriteLimit,
      ),
    [
      appState,
      activeContext,
      namespace,
      settings.dataplane.namespaceEnrichment.recentLimit,
      settings.dataplane.namespaceEnrichment.favouriteLimit,
    ],
  );

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
    if (!activeIssue) return;
    if (activeIssue.id === lastCriticalSeenId) return;
    setLastCriticalSeenId(activeIssue.id);
    setCriticalOpen(true);
  }, [activeIssue, lastCriticalSeenId]);

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
    (async () => {
      // 1) contexts
      const ctxRes = await apiGet<ApiContextsResponse>("/api/contexts", token);
      const ctxs = ctxRes.contexts || [];
      setContexts(ctxs);

      const stateCtx = appState.activeContext;
      const ctxExists = stateCtx && ctxs.some((c) => c.name === stateCtx);
      const chosenCtx = ctxExists ? stateCtx : (ctxs[0]?.name || "");

      if (chosenCtx) {
        await apiPost("/api/context/select", token, { name: chosenCtx });
      }
      setActiveContext(chosenCtx);

      // 2) namespaces
      const nsPath0 = namespacesListApiPath(appState, chosenCtx, appState.activeNamespace || "");
      const { limited, items: nsItems } = await fetchNamespaces(token, nsPath0, chosenCtx);
      setNsLimited(limited);
      setNamespaces(nsItems);

      // 3) pick namespace
      let chosenNs = appState.activeNamespace || "";
      if (!limited) {
        if (!chosenNs || !nsItems.includes(chosenNs)) {
          chosenNs = nsItems[0] || "";
        }
      } else {
        // limited mode: keep what user had or blank
        chosenNs = chosenNs || "";
      }
      setNamespace(chosenNs);

      // 4) section
      setSection(appState.activeSection || "pods");

      // 5) favourites for this ctx
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
    })().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function onSelectContext(name: string) {
    await apiPost("/api/context/select", token, { name });
    setActiveContext(name);

    const nsPath = namespacesListApiPath(appState, name, appState.activeNamespace || "");
    const { limited, items: nsItems } = await fetchNamespaces(token, nsPath, name);
    setNsLimited(limited);
    setNamespaces(nsItems);

    // pick namespace from state if possible
    let chosenNs = appState.activeNamespace || "";
    if (!limited) {
      if (!chosenNs || !nsItems.includes(chosenNs)) chosenNs = nsItems[0] || "";
    }
    setNamespace(chosenNs);

    // load favourites for this context
    const fav = (appState.favouriteNamespacesByContext[name] || []).slice();
    setFavourites(fav);

    setAppState((s) => {
      let next: AppStateV1 = { ...s, activeContext: name, activeNamespace: chosenNs };
      if (name && chosenNs) next = recordRecentNamespace(next, name, chosenNs);
      return next;
    });
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

  return (
    <ActiveContextProvider value={activeContext}>
        <MutationProvider>
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
          <Snackbar
            open={criticalOpen && !!activeIssue}
            autoHideDuration={6000}
            onClose={() => setCriticalOpen(false)}
            anchorOrigin={{ vertical: "top", horizontal: "center" }}
          >
            <Alert severity="error" variant="filled" onClose={() => setCriticalOpen(false)}>
              {activeIssue?.kind === "cluster"
                ? `Cluster connection failed${activeIssue.message ? `: ${activeIssue.message}` : ""}`
                : activeIssue?.kind === "backend"
                  ? `Backend connection failed${activeIssue.message ? `: ${activeIssue.message}` : ""}`
                  : activeIssue?.message || "Request failed"}
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
        </MutationProvider>
    </ActiveContextProvider>
  );
}

function DataplaneSettingsSync({ token }: { token: string }) {
  const { settings } = useUserSettings();
  const activeContext = useActiveContext();
  const lastSweepWarmKeyRef = useRef<string>("");
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const dataplanePolicy = {
        ...settings.dataplane,
        dashboard: {
          ...settings.dataplane.dashboard,
          refreshSec: settings.appearance.dashboardRefreshSec,
        },
      };
      apiPost("/api/dataplane/config", token, dataplanePolicy)
        .then(() => {
          const sweep = settings.dataplane.namespaceEnrichment.sweep;
          const warmKey = settings.dataplane.namespaceEnrichment.enabled && sweep.enabled
            ? [
                activeContext,
                settings.dataplane.profile,
                sweep.maxNamespacesPerCycle,
                sweep.maxNamespacesPerHour,
                sweep.minReenrichIntervalMinutes,
                sweep.includeSystemNamespaces,
                settings.dataplane.namespaceEnrichment.warmResourceKinds.join(","),
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
  }, [activeContext, settings.appearance.dashboardRefreshSec, settings.dataplane, token]);
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
