import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Typography,
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
import StatefulSetActions from "./StatefulSetActions";
import { fmtAge, valueOrDash } from "../../../utils/format";
import { phaseChipColor } from "../../../utils/k8sUi";
import KeyValueTable from "../../shared/KeyValueTable";
import EmptyState from "../../shared/EmptyState";
import ErrorState from "../../shared/ErrorState";
import Section from "../../shared/Section";
import MetadataSection from "../../shared/MetadataSection";
import AttentionSummary from "../../shared/AttentionSummary";
import HealthConditionsPanel from "../../shared/HealthConditionsPanel";
import EventsList from "../../shared/EventsList";
import CodeBlock from "../../shared/CodeBlock";
import WorkloadSpecPanels from "../../shared/WorkloadSpecPanels";
import RightDrawer from "../../layout/RightDrawer";
import ResourceDrawerShell from "../../shared/ResourceDrawerShell";
import type { ApiItemResponse, ApiListResponse, DashboardSignalItem } from "../../../types/api";
import useResourceSignals from "../../../utils/useResourceSignals";
import {
  panelBoxSx,
  drawerBodySx,
  drawerTabContentCompactSx,
  loadingCenterSx,
} from "../../../theme/sxTokens";

type StatefulSetDetails = {
  summary: StatefulSetSummary;
  conditions: StatefulSetCondition[];
  pods: StatefulSetPod[];
  spec: StatefulSetSpec;
  metadata: StatefulSetMetadata;
  yaml: string;
};

type StatefulSetDetailsResponse = ApiItemResponse<StatefulSetDetails> & {
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

type StatefulSetSummary = {
  name: string;
  namespace: string;
  serviceName?: string;
  podManagementPolicy?: string;
  updateStrategy?: string;
  updatePartition?: number;
  revisionHistoryLimit?: number;
  selector?: string;
  desired: number;
  current: number;
  ready: number;
  updated: number;
  ageSec: number;
};

type StatefulSetCondition = {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: number;
};

type StatefulSetPod = {
  name: string;
  phase: string;
  ready: string;
  restarts: number;
  node?: string;
  ageSec: number;
};

type StatefulSetSpec = {
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

type StatefulSetMetadata = {
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

function isConditionHealthy(cond: StatefulSetCondition) {
  return cond.status === "True";
}

export default function StatefulSetDrawer(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  namespace: string;
  statefulSetName: string | null;
}) {
  const { retryNonce } = useConnectionState();
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<StatefulSetDetails | null>(null);
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [detailSignals, setDetailSignals] = useState<DashboardSignalItem[]>([]);
  const [err, setErr] = useState("");
  const [drawerPod, setDrawerPod] = useState<string | null>(null);
  const [drawerSecret, setDrawerSecret] = useState<string | null>(null);
  const [drawerConfigMap, setDrawerConfigMap] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const ns = props.namespace;
  const name = props.statefulSetName;

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
    setLoading(true);

    (async () => {
      const det = await apiGet<StatefulSetDetailsResponse>(
        `/api/namespaces/${encodeURIComponent(ns)}/statefulsets/${encodeURIComponent(name)}`,
        props.token
      );
      const item: StatefulSetDetails | null = det?.item ?? null;
      setDetails(item);
      setDetailSignals(Array.isArray(det?.detailSignals) ? det.detailSignals : []);

      const ev = await apiGet<ApiListResponse<EventDTO>>(
        `/api/namespaces/${encodeURIComponent(ns)}/statefulsets/${encodeURIComponent(name)}/events`,
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
    kind: "statefulsets",
    name: name || "",
    enabled: !!props.open && !!name,
    refreshKey: retryNonce + refreshNonce,
  });

  const warningEvents = useMemo(
    () => events.filter((e) => String(e.type).toLowerCase() === "warning").slice(0, 5),
    [events],
  );

  const statefulSetSignals = useMemo<DashboardSignalItem[]>(
    () => [...detailSignals, ...(resourceSignals.signals || [])],
    [detailSignals, resourceSignals.signals],
  );

  const summaryItems = useMemo(
    () => [
      { label: "Name", value: valueOrDash(summary?.name) },
      { label: "Namespace", value: valueOrDash(summary?.namespace) },
      { label: "Desired replicas", value: valueOrDash(summary?.desired) },
      { label: "Current replicas", value: valueOrDash(summary?.current) },
      { label: "Ready replicas", value: valueOrDash(summary?.ready) },
      { label: "Updated replicas", value: valueOrDash(summary?.updated) },
      { label: "Service name", value: valueOrDash(summary?.serviceName) },
      { label: "Pod management policy", value: valueOrDash(summary?.podManagementPolicy) },
      { label: "Update strategy", value: valueOrDash(summary?.updateStrategy) },
      {
        label: "Update partition",
        value: summary?.updatePartition !== undefined ? summary.updatePartition : "-",
      },
      {
        label: "Revision history limit",
        value: summary?.revisionHistoryLimit !== undefined ? summary.revisionHistoryLimit : "-",
      },
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
            StatefulSet: {name || "-"}{" "}
            <Typography component="span" variant="body2">
              ({ns})
            </Typography>
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
                    <Section title="Actions" divider={false}>
                      <StatefulSetActions
                        token={props.token}
                        namespace={ns}
                        statefulSetName={name}
                        currentReplicas={summary?.desired ?? 0}
                        onRefresh={() => setRefreshNonce((n) => n + 1)}
                        onDeleted={props.onClose}
                      />
                    </Section>
                  )}

                  <AttentionSummary
                    signals={statefulSetSignals}
                    onJumpToEvents={() => setTab(3)}
                    onJumpToSpec={() => setTab(2)}
                  />

                  <HealthConditionsPanel
                    conditions={details?.conditions || []}
                    isHealthy={(cond) => isConditionHealthy(cond as StatefulSetCondition)}
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
                    <EmptyState message="No pods found for this StatefulSet." />
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
                  <MetadataSection
                    labels={details?.spec?.metadata?.labels}
                    annotations={details?.spec?.metadata?.annotations}
                  />
                </Box>
              )}

              {/* EVENTS */}
              {tab === 3 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  <EventsList events={events} emptyMessage="No events found for this StatefulSet." />
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
                <CodeBlock code={details?.yaml || ""} language="yaml" />
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
          </>
        )}
      </ResourceDrawerShell>
    </RightDrawer>
  );
}
