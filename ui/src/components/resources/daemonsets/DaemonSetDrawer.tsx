import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Tabs,
  Tab,
  CircularProgress,
  Chip,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
} from "@mui/material";
import { apiGet } from "../../../api";
import { useConnectionState } from "../../../connectionState";
import PodDrawer from "../pods/PodDrawer";
import SecretDrawer from "../secrets/SecretDrawer";
import ConfigMapDrawer from "../configmaps/ConfigMapDrawer";
import NamespaceDrawer from "../namespaces/NamespaceDrawer";
import DaemonSetActions from "./DaemonSetActions";
import { fmtAge, valueOrDash } from "../../../utils/format";
import { phaseChipColor } from "../../../utils/k8sUi";
import KeyValueTable from "../../shared/KeyValueTable";
import EmptyState from "../../shared/EmptyState";
import ErrorState from "../../shared/ErrorState";
import Section from "../../shared/Section";
import DrawerActionStrip from "../../shared/DrawerActionStrip";
import ResourceLinkChip from "../../shared/ResourceLinkChip";
import MetadataSection from "../../shared/MetadataSection";
import AttentionSummary from "../../shared/AttentionSummary";
import HealthConditionsPanel from "../../shared/HealthConditionsPanel";
import EventsList from "../../shared/EventsList";
import EventsPanel from "../../shared/EventsPanel";
import CodeBlock from "../../shared/CodeBlock";
import WorkloadSpecPanels from "../../shared/WorkloadSpecPanels";
import RightDrawer from "../../layout/RightDrawer";
import ResourceDrawerShell from "../../shared/ResourceDrawerShell";
import ResourceYamlPanel from "../../shared/ResourceYamlPanel";
import type { ApiItemResponse, ApiListResponse, DashboardSignalItem } from "../../../types/api";
import useResourceSignals from "../../../utils/useResourceSignals";
import {
  panelBoxSx,
  drawerBodySx,
  drawerTabContentCompactSx,
  loadingCenterSx,
} from "../../../theme/sxTokens";

type DaemonSetDetails = {
  summary: DaemonSetSummary;
  conditions: DaemonSetCondition[];
  pods: DaemonSetPod[];
  spec: DaemonSetSpec;
  metadata: DaemonSetMetadata;
  yaml: string;
};

type DaemonSetDetailsResponse = ApiItemResponse<DaemonSetDetails> & {
  detailSignals?: DashboardSignalItem[];
};

type EventDTO = {
  type: string;
  reason: string;
  message: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
};

type DaemonSetSummary = {
  name: string;
  namespace: string;
  updateStrategy?: string;
  maxUnavailable?: string;
  maxSurge?: string;
  selector?: string;
  desired: number;
  current: number;
  ready: number;
  updated: number;
  available: number;
  ageSec: number;
};

type DaemonSetCondition = {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: number;
};

type DaemonSetPod = {
  name: string;
  phase: string;
  ready: string;
  restarts: number;
  node?: string;
  ageSec: number;
};

type DaemonSetSpec = {
  podTemplate: {
    containers?: ContainerSummary[];
    initContainers?: ContainerSummary[];
    imagePullSecrets?: string[];
  };
  scheduling: {
    nodeSelector?: Record<string, string>;
    affinitySummary?: string;
    tolerations?: {
      key?: string;
      operator?: string;
      value?: string;
      effect?: string;
      seconds?: number;
    }[];
    topologySpreadConstraints?: {
      maxSkew: number;
      topologyKey?: string;
      whenUnsatisfiable?: string;
      labelSelector?: string;
    }[];
  };
  volumes?: { name: string; type?: string; source?: string }[];
  missingReferences?: { kind: string; name: string; source?: string }[];
  metadata: {
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
};

type DaemonSetMetadata = {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
};

type ContainerSummary = {
  name: string;
  image?: string;
  cpuRequest?: string;
  cpuLimit?: string;
  memoryRequest?: string;
  memoryLimit?: string;
};

function isConditionHealthy(cond: DaemonSetCondition) {
  return cond.status === "True";
}

export default function DaemonSetDrawer(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  namespace: string;
  daemonSetName: string | null;
}) {
  const { retryNonce } = useConnectionState();
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<DaemonSetDetails | null>(null);
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [detailSignals, setDetailSignals] = useState<DashboardSignalItem[]>([]);
  const [err, setErr] = useState("");
  const [drawerPod, setDrawerPod] = useState<string | null>(null);
  const [drawerSecret, setDrawerSecret] = useState<string | null>(null);
  const [drawerConfigMap, setDrawerConfigMap] = useState<string | null>(null);
  const [drawerNamespace, setDrawerNamespace] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const ns = props.namespace;
  const name = props.daemonSetName;

  useEffect(() => {
    if (!props.open || !name) return;

    setTab(0);
    setErr("");
    setDetails(null);
    setEvents([]);
    setDetailSignals([]);
    setDrawerPod(null);
    setDrawerSecret(null);
    setDrawerConfigMap(null);
    setDrawerNamespace(null);
    setLoading(true);

    (async () => {
      const det = await apiGet<DaemonSetDetailsResponse>(
        `/api/namespaces/${encodeURIComponent(ns)}/daemonsets/${encodeURIComponent(name)}`,
        props.token
      );
      const item: DaemonSetDetails | null = det?.item ?? null;
      setDetails(item);
      setDetailSignals(Array.isArray(det?.detailSignals) ? det.detailSignals : []);

      const ev = await apiGet<ApiListResponse<EventDTO>>(
        `/api/namespaces/${encodeURIComponent(ns)}/daemonsets/${encodeURIComponent(name)}/events?limit=5&type=Warning`,
        props.token
      );
      setEvents(ev?.items || []);
    })()
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [props.open, name, ns, props.token, retryNonce, refreshNonce]);

  const summary = details?.summary;
  const metadata = details?.metadata;

  const resourceSignals = useResourceSignals({
    token: props.token,
    scope: "namespace",
    namespace: ns,
    kind: "daemonsets",
    name: name || "",
    enabled: !!props.open && !!name,
    refreshKey: retryNonce + refreshNonce,
  });

  const daemonSetSignals = useMemo<DashboardSignalItem[]>(
    () => [...detailSignals, ...(resourceSignals.signals || [])],
    [detailSignals, resourceSignals.signals],
  );

  const warningEvents = useMemo(
    () => events.filter((e) => String(e.type).toLowerCase() === "warning").slice(0, 5),
    [events],
  );
  const summaryItems = useMemo(
    () => [
      { label: "Name", value: valueOrDash(summary?.name) },
      { label: "Namespace", value: valueOrDash(summary?.namespace) },
      { label: "Desired", value: valueOrDash(summary?.desired) },
      { label: "Current", value: valueOrDash(summary?.current) },
      { label: "Ready", value: valueOrDash(summary?.ready) },
      { label: "Updated", value: valueOrDash(summary?.updated) },
      { label: "Available", value: valueOrDash(summary?.available) },
      { label: "Update strategy", value: valueOrDash(summary?.updateStrategy) },
      { label: "Max unavailable", value: valueOrDash(summary?.maxUnavailable) },
      { label: "Max surge", value: valueOrDash(summary?.maxSurge) },
      { label: "Age", value: fmtAge(summary?.ageSec) },
      { label: "Selector", value: valueOrDash(summary?.selector) },
    ],
    [summary]
  );

  return (
    <RightDrawer open={props.open} onClose={props.onClose}>
      <ResourceDrawerShell
        title={
          <>
            DaemonSet: {name || "-"}{" "}
            {ns ? <ResourceLinkChip label={ns} onClick={() => setDrawerNamespace(ns)} /> : null}
          </>
        }
        onClose={props.onClose}
      >
        {loading ? (
          <Box sx={loadingCenterSx}>
            <CircularProgress />
          </Box>
        ) : err ? (
          <ErrorState message={err} />
        ) : (
          <>
            <Tabs value={tab} onChange={(_, v) => setTab(v)}>
              <Tab label="Overview" />
              <Tab label="Pods" />
              <Tab label="Spec" />
              <Tab label="Events" />
              <Tab label="Metadata" />
              <Tab label="YAML" />
            </Tabs>

            <Box sx={drawerBodySx}>
              {/* OVERVIEW */}
              {tab === 0 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
                  {name && (
                    <DrawerActionStrip>
                      <DaemonSetActions
                        token={props.token}
                        namespace={ns}
                        daemonSetName={name}
                        onRefresh={() => setRefreshNonce((n) => n + 1)}
                        onDeleted={props.onClose}
                      />
                    </DrawerActionStrip>
                  )}

                  <AttentionSummary
                    signals={daemonSetSignals}
                    onJumpToEvents={() => setTab(3)}
                    onJumpToSpec={() => setTab(2)}
                  />

                  <HealthConditionsPanel
                    conditions={details?.conditions || []}
                    isHealthy={(cond) => isConditionHealthy(cond as DaemonSetCondition)}
                  />

                  <Section title="Recent Warning events">
                    <Box sx={panelBoxSx}>
                      <EventsList events={warningEvents} emptyMessage="No recent warning events." />
                    </Box>
                  </Section>
                </Box>
              )}

              {/* PODS */}
              {tab === 1 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  {(details?.pods || []).length === 0 ? (
                    <EmptyState message="No pods found for this DaemonSet." />
                  ) : (
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Pod</TableCell>
                          <TableCell>Phase</TableCell>
                          <TableCell>Ready</TableCell>
                          <TableCell>Restarts</TableCell>
                          <TableCell>Node</TableCell>
                          <TableCell>Age</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(details?.pods || []).map((p, idx) => (
                          <TableRow
                            key={p.name || String(idx)}
                            hover
                            onClick={() => p.name && setDrawerPod(p.name)}
                            sx={{ cursor: p.name ? "pointer" : "default" }}
                          >
                            <TableCell>{valueOrDash(p.name)}</TableCell>
                            <TableCell>
                              <Chip size="small" label={valueOrDash(p.phase)} color={phaseChipColor(p.phase)} />
                            </TableCell>
                            <TableCell>{valueOrDash(p.ready)}</TableCell>
                            <TableCell>{valueOrDash(p.restarts)}</TableCell>
                            <TableCell>{valueOrDash(p.node)}</TableCell>
                            <TableCell>{fmtAge(p.ageSec)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Box>
              )}

              {/* SPEC */}
              {tab === 2 && (
                <Box sx={drawerTabContentCompactSx}>
                  <WorkloadSpecPanels
                    template={details?.spec?.podTemplate}
                    scheduling={details?.spec?.scheduling}
                    volumes={details?.spec?.volumes}
                    missingReferences={details?.spec?.missingReferences}
                    onOpenSecret={setDrawerSecret}
                    onOpenConfigMap={setDrawerConfigMap}
                  />
                </Box>
              )}

              {/* EVENTS */}
              {tab === 3 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  <EventsPanel endpoint={`/api/namespaces/${encodeURIComponent(ns)}/daemonsets/${encodeURIComponent(name || "")}/events`} token={props.token} emptyMessage="No events found for this DaemonSet." />
                </Box>
              )}

              {/* METADATA */}
              {tab === 4 && (
                <Box sx={drawerTabContentCompactSx}>
                  <Box sx={panelBoxSx}>
                    <KeyValueTable
                      rows={summaryItems}
                      columns={3}
                      valueSx={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                    />
                  </Box>
                  <MetadataSection labels={metadata?.labels} annotations={metadata?.annotations} />
                </Box>
              )}

              {/* YAML */}
              {tab === 5 && (
                <ResourceYamlPanel
                  code={details?.yaml || ""}
                  token={props.token}
                  target={{
                    kind: "DaemonSet",
                    group: "apps",
                    resource: "daemonsets",
                    apiVersion: "apps/v1",
                    namespace: ns,
                    name: name || "",
                  }}
                  onApplied={() => setRefreshNonce((v) => v + 1)}
                />
              )}
            </Box>
            <PodDrawer
              open={!!drawerPod}
              onClose={() => setDrawerPod(null)}
              token={props.token}
              namespace={ns}
              podName={drawerPod}
            />
            <SecretDrawer
              open={!!drawerSecret}
              onClose={() => setDrawerSecret(null)}
              token={props.token}
              namespace={ns}
              secretName={drawerSecret}
            />
            <ConfigMapDrawer
              open={!!drawerConfigMap}
              onClose={() => setDrawerConfigMap(null)}
              token={props.token}
              namespace={ns}
              configMapName={drawerConfigMap}
            />
            <NamespaceDrawer
              open={!!drawerNamespace}
              onClose={() => setDrawerNamespace(null)}
              token={props.token}
              namespaceName={drawerNamespace}
            />
          </>
        )}
      </ResourceDrawerShell>
    </RightDrawer>
  );
}
