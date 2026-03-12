import React, { useEffect, useMemo, useState } from "react";
import { Box, CssBaseline, AppBar, Toolbar, Typography, Snackbar, Alert, FormControl, InputLabel, MenuItem, Select } from "@mui/material";
import Sidebar from "./components/Sidebar";
import NodesTable from "./components/NodesTable";
import NamespacesTable from "./components/NamespacesTable";
import PodsTable from "./components/PodsTable";
import DeploymentsTable from "./components/DeploymentsTable";
import DaemonSetsTable from "./components/DaemonSetsTable";
import StatefulSetsTable from "./components/StatefulSetsTable";
import ReplicaSetsTable from "./components/ReplicaSetsTable";
import ServicesTable from "./components/ServicesTable";
import IngressesTable from "./components/IngressesTable";
import JobsTable from "./components/JobsTable";
import CronJobsTable from "./components/CronJobsTable";
import ConfigMapsTable from "./components/ConfigMapsTable";
import SecretsTable from "./components/SecretsTable";
import ServiceAccountsTable from "./components/ServiceAccountsTable";
import RolesTable from "./components/RolesTable";
import RoleBindingsTable from "./components/RoleBindingsTable";
import ClusterRolesTable from "./components/ClusterRolesTable";
import ClusterRoleBindingsTable from "./components/ClusterRoleBindingsTable";
import PersistentVolumesTable from "./components/PersistentVolumesTable";
import PersistentVolumeClaimsTable from "./components/PersistentVolumeClaimsTable";
import HelmReleasesTable from "./components/HelmReleasesTable";
import HelmChartsTable from "./components/HelmChartsTable";
import CustomResourceDefinitionsTable from "./components/CustomResourceDefinitionsTable";
import { apiGet, apiPost, toApiError } from "./api";
import { loadState, saveState, toggleFavouriteNamespace, type Section } from "./state";
import { useConnectionState } from "./connectionState";
import ConnectionBanner from "./components/shared/ConnectionBanner";
import { ActiveContextProvider } from "./activeContext";
import MutationProvider from "./components/mutations/MutationProvider";
import { ThemeProvider, useThemeMode } from "./theme/ThemeProvider";
import "./styles/theme.css";

function getToken(): string {
  const u = new URL(window.location.href);
  return u.searchParams.get("token") || "";
}

function AppInner() {
  const token = useMemo(() => getToken(), []);
  const { lastRecoveryShownAt } = useConnectionState();
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [lastRecoverySeenAt, setLastRecoverySeenAt] = useState<number | null>(null);
  const [contexts, setContexts] = useState<any[]>([]);
  const [activeContext, setActiveContext] = useState<string>("");

  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [nsLimited, setNsLimited] = useState<boolean>(false);
  const [namespace, setNamespace] = useState<string>("");

  const [section, setSection] = useState<Section>("pods");

  const [favourites, setFavourites] = useState<string[]>([]);

  // load from localStorage once
  const [appState, setAppState] = useState(() => loadState());

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

  // initial bootstrap
  useEffect(() => {
    (async () => {
      // 1) contexts
      const ctxRes = await apiGet<any>("/api/contexts", token);
      const ctxs = ctxRes.contexts || [];
      setContexts(ctxs);

      const stateCtx = appState.activeContext;
      const ctxExists = stateCtx && ctxs.some((c: any) => c.name === stateCtx);
      const chosenCtx = ctxExists ? stateCtx : (ctxs[0]?.name || "");

      if (chosenCtx) {
        await apiPost("/api/context/select", token, { name: chosenCtx });
      }
      setActiveContext(chosenCtx);

      // 2) namespaces
      const { limited, items: nsItems } = await fetchNamespaces(token);
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

      // update stored state if we auto-picked
      setAppState((s) => ({
        ...s,
        activeContext: chosenCtx || s.activeContext,
        activeNamespace: chosenNs || s.activeNamespace,
        activeSection: s.activeSection || "pods",
      }));
    })().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchNamespaces(currentToken: string): Promise<{ limited: boolean; items: string[] }> {
    try {
      const nsRes = await apiGet<any>("/api/namespaces", currentToken);
      return {
        limited: !!nsRes.limited,
        items: (nsRes.items || []).map((x: any) => x.name),
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

    // refresh namespaces for new context
    const { limited, items: nsItems } = await fetchNamespaces(token);
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

    setAppState((s) => ({ ...s, activeContext: name, activeNamespace: chosenNs }));
  }

  function onSelectNamespace(ns: string) {
    setNamespace(ns);
    setAppState((s) => ({ ...s, activeNamespace: ns }));
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
    setSection(sec);
    setAppState((s) => ({ ...s, activeSection: sec }));
  }

  return (
    <ActiveContextProvider value={activeContext}>
      <MutationProvider>
        <Box
          sx={{
            display: "flex",
            height: "100vh",
            backgroundColor: "var(--bg-primary)",
            color: "var(--text-primary)",
          }}
        >
          <CssBaseline />
          <AppBar position="fixed" sx={{ zIndex: 1201 }}>
            <Toolbar>
              <Typography variant="h6" noWrap component="div">
                kview — {activeContext || "no context"}
              </Typography>
              <Box sx={{ flexGrow: 1 }} />
              <ThemeSelector />
            </Toolbar>
          </AppBar>

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
          />

          <Box
            component="main"
            sx={{
              flexGrow: 1,
              p: 2,
              mt: 8,
              backgroundColor: "var(--bg-elevated)",
              color: "var(--text-primary)",
            }}
          >
            <ConnectionBanner />
            {section === "nodes" ? <NodesTable token={token} /> : null}
            {section === "namespaces" ? (
              <NamespacesTable
                token={token}
                onNavigate={(sec, ns) => {
                  onSelectNamespace(ns);
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
            {section === "services" && namespace ? <ServicesTable token={token} namespace={namespace} /> : null}
            {section === "ingresses" && namespace ? <IngressesTable token={token} namespace={namespace} /> : null}
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
            {section === "customresourcedefinitions" ? (
              <CustomResourceDefinitionsTable token={token} />
            ) : null}
            {section === "helm" && namespace ? (
              <HelmReleasesTable token={token} namespace={namespace} />
            ) : null}
            {section === "helmcharts" ? <HelmChartsTable token={token} /> : null}
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
        </Box>
      </MutationProvider>
    </ActiveContextProvider>
  );
}

function ThemeSelector() {
  const { mode, setMode } = useThemeMode();

  return (
    <FormControl size="small" variant="outlined" sx={{ minWidth: 140 }}>
      <InputLabel id="theme-mode-label">Theme</InputLabel>
      <Select
        labelId="theme-mode-label"
        value={mode}
        label="Theme"
        onChange={(e) => setMode(e.target.value as any)}
      >
        <MenuItem value="light">Light</MenuItem>
        <MenuItem value="dark">Dark</MenuItem>
        <MenuItem value="system">System</MenuItem>
      </Select>
    </FormControl>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  );
}

