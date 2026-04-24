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
import DeploymentDrawer from "../deployments/DeploymentDrawer";
import SecretDrawer from "../secrets/SecretDrawer";
import ConfigMapDrawer from "../configmaps/ConfigMapDrawer";
import ReplicaSetActions from "./ReplicaSetActions";
import { fmtAge, valueOrDash } from "../../../utils/format";
import { phaseChipColor } from "../../../utils/k8sUi";
import KeyValueTable from "../../shared/KeyValueTable";
import EmptyState from "../../shared/EmptyState";
import ErrorState from "../../shared/ErrorState";
import Section from "../../shared/Section";
import ResourceLinkChip from "../../shared/ResourceLinkChip";
import MetadataSection from "../../shared/MetadataSection";
import AttentionSummary from "../../shared/AttentionSummary";
import HealthConditionsPanel from "../../shared/HealthConditionsPanel";
import EventsList from "../../shared/EventsList";
import ResourceYamlPanel from "../../shared/ResourceYamlPanel";
import WorkloadSpecPanels from "../../shared/WorkloadSpecPanels";
import NamespaceDrawer from "../namespaces/NamespaceDrawer";
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

type ReplicaSetDetails = {
  summary: ReplicaSetSummary;
  conditions: ReplicaSetCondition[];
  pods: ReplicaSetPod[];
  spec: ReplicaSetSpec;
  linkedPods: ReplicaSetPodsSummary;
  yaml: string;
};

type ReplicaSetDetailsResponse = ApiItemResponse<ReplicaSetDetails> & {
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

type ReplicaSetSummary = {
  name: string;
  namespace: string;
  owner?: OwnerRef;
  revision: number;
  selector: string;
  desired: number;
  current: number;
  ready: number;
  ageSec: number;
};

type OwnerRef = {
  kind: string;
  name: string;
};

type ReplicaSetCondition = {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: number;
};

type ReplicaSetPod = {
  name: string;
  phase: string;
  ready: string;
  restarts: number;
  node?: string;
  ageSec: number;
};

type ReplicaSetSpec = {
  podTemplate: {
    containers?: ContainerSummary[];
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
  };
  volumes?: { name: string; type?: string; source?: string }[];
  missingReferences?: { kind: string; name: string; source?: string }[];
  metadata: {
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
};

type ContainerSummary = {
  name: string;
  image?: string;
  cpuRequest?: string;
  cpuLimit?: string;
  memoryRequest?: string;
  memoryLimit?: string;
};

type ReplicaSetPodsSummary = {
  total: number;
  ready: number;
};

function formatRevision(revision?: number) {
  if (!revision || revision <= 0) return "-";
  return String(revision);
}

function isConditionHealthy(cond: ReplicaSetCondition) {
  if (cond.type === "ReplicaFailure") {
    return cond.status !== "True";
  }
  return cond.status === "True";
}

export default function ReplicaSetDrawer(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  namespace: string;
  replicaSetName: string | null;
}) {
  const { retryNonce } = useConnectionState();
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<ReplicaSetDetails | null>(null);
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [detailSignals, setDetailSignals] = useState<DashboardSignalItem[]>([]);
  const [err, setErr] = useState("");
  const [drawerPod, setDrawerPod] = useState<string | null>(null);
  const [drawerDeployment, setDrawerDeployment] = useState<string | null>(null);
  const [drawerNamespace, setDrawerNamespace] = useState<string | null>(null);
  const [drawerSecret, setDrawerSecret] = useState<string | null>(null);
  const [drawerConfigMap, setDrawerConfigMap] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const ns = props.namespace;
  const name = props.replicaSetName;

  useEffect(() => {
    if (!props.open || !name) return;

    setTab(0);
    setErr("");
    setDetails(null);
    setEvents([]);
    setDetailSignals([]);
    setDrawerPod(null);
    setDrawerDeployment(null);
    setDrawerNamespace(null);
    setDrawerSecret(null);
    setDrawerConfigMap(null);
    setLoading(true);

    (async () => {
      const det = await apiGet<ReplicaSetDetailsResponse>(
        `/api/namespaces/${encodeURIComponent(ns)}/replicasets/${encodeURIComponent(name)}`,
        props.token
      );
      const item: ReplicaSetDetails | null = det?.item ?? null;
      setDetails(item);
      setDetailSignals(Array.isArray(det?.detailSignals) ? det.detailSignals : []);

      const ev = await apiGet<ApiListResponse<EventDTO>>(
        `/api/namespaces/${encodeURIComponent(ns)}/replicasets/${encodeURIComponent(name)}/events`,
        props.token
      );
      setEvents(ev?.items || []);
    })()
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [props.open, name, ns, props.token, retryNonce, refreshNonce]);

  const summary = details?.summary;
  const linkedPods = details?.linkedPods;
  const owner = summary?.owner;

  const resourceSignals = useResourceSignals({
    token: props.token,
    scope: "namespace",
    namespace: ns,
    kind: "replicasets",
    name: name || "",
    enabled: !!props.open && !!name,
    refreshKey: retryNonce + refreshNonce,
  });

  const replicaSetSignals = useMemo<DashboardSignalItem[]>(
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
      {
        label: "Namespace",
        value: summary?.namespace ? (
          <ResourceLinkChip label={summary.namespace} onClick={() => setDrawerNamespace(summary.namespace)} />
        ) : (
          "-"
        ),
      },
      {
        label: "Owner Deployment",
        value:
          owner?.kind === "Deployment" && owner?.name ? (
            <ResourceLinkChip label={owner.name} onClick={() => setDrawerDeployment(owner.name)} />
          ) : (
            "-"
          ),
      },
      { label: "Revision", value: formatRevision(summary?.revision) },
      { label: "Desired replicas", value: valueOrDash(summary?.desired) },
      { label: "Current replicas", value: valueOrDash(summary?.current) },
      { label: "Ready replicas", value: valueOrDash(summary?.ready) },
      {
        label: "Linked Pods",
        value: linkedPods ? `${linkedPods.ready}/${linkedPods.total}` : "-",
      },
      { label: "Age", value: fmtAge(summary?.ageSec) },
      {
        label: "Selector",
        value: (() => {
          if (!summary?.selector) return "-";
          const parts = summary.selector.split(",").map((s) => s.trim()).filter(Boolean);
          if (parts.length === 0) return "-";
          return (
            <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
              {parts.map((part) => (
                <Chip key={part} size="small" label={part} />
              ))}
            </Box>
          );
        })(),
      },
    ],
    [summary, owner, linkedPods]
  );

  return (
    <RightDrawer open={props.open} onClose={props.onClose}>
      <ResourceDrawerShell
        title={
          <>
            ReplicaSet: {name || "-"}{" "}
            <ResourceLinkChip label={ns} onClick={() => setDrawerNamespace(ns)} />
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
                      <ReplicaSetActions
                        token={props.token}
                        namespace={ns}
                        replicaSetName={name}
                        currentReplicas={summary?.desired ?? 0}
                        onRefresh={() => setRefreshNonce((n) => n + 1)}
                        onDeleted={props.onClose}
                      />
                    </Section>
                  )}

                  <AttentionSummary
                    signals={replicaSetSignals}
                    onJumpToEvents={() => setTab(3)}
                    onJumpToSpec={() => setTab(2)}
                  />

                  <HealthConditionsPanel
                    conditions={details?.conditions || []}
                    isHealthy={(cond) => isConditionHealthy(cond as ReplicaSetCondition)}
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
                    <EmptyState message="No pods found for this ReplicaSet." />
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
                  <EventsList events={events} emptyMessage="No events found for this ReplicaSet." />
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
                  <MetadataSection
                    labels={details?.spec?.metadata?.labels}
                    annotations={details?.spec?.metadata?.annotations}
                  />
                </Box>
              )}

              {/* YAML */}
              {tab === 5 && (
                <ResourceYamlPanel
                  code={details?.yaml || ""}
                  token={props.token}
                  target={{
                    kind: "ReplicaSet",
                    group: "apps",
                    resource: "replicasets",
                    apiVersion: "apps/v1",
                    namespace: ns,
                    name: name || "",
                  }}
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
            <DeploymentDrawer
              open={!!drawerDeployment}
              onClose={() => setDrawerDeployment(null)}
              token={props.token}
              namespace={ns}
              deploymentName={drawerDeployment}
            />
            <NamespaceDrawer
              open={!!drawerNamespace}
              onClose={() => setDrawerNamespace(null)}
              token={props.token}
              namespaceName={drawerNamespace}
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
