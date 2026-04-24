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
import CronJobDrawer from "../cronjobs/CronJobDrawer";
import SecretDrawer from "../secrets/SecretDrawer";
import ConfigMapDrawer from "../configmaps/ConfigMapDrawer";
import NamespaceDrawer from "../namespaces/NamespaceDrawer";
import JobActions from "./JobActions";
import { fmtAge, fmtTimeAgo, valueOrDash } from "../../../utils/format";
import { jobStatusChipColor, phaseChipColor } from "../../../utils/k8sUi";
import KeyValueTable from "../../shared/KeyValueTable";
import EmptyState from "../../shared/EmptyState";
import ErrorState from "../../shared/ErrorState";
import Section from "../../shared/Section";
import ResourceLinkChip from "../../shared/ResourceLinkChip";
import AttentionSummary from "../../shared/AttentionSummary";
import HealthConditionsPanel from "../../shared/HealthConditionsPanel";
import EventsList from "../../shared/EventsList";
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
  loadingCenterSx,
} from "../../../theme/sxTokens";

type JobDetails = {
  summary: JobSummary;
  conditions: JobCondition[];
  pods: JobPod[];
  linkedPods: JobPodsSummary;
  spec: JobSpec;
  yaml: string;
};

type JobDetailsResponse = ApiItemResponse<JobDetails> & {
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

type JobSummary = {
  name: string;
  namespace: string;
  owner?: OwnerRef;
  status: string;
  active: number;
  succeeded: number;
  failed: number;
  completions?: number;
  parallelism?: number;
  backoffLimit?: number;
  startTime?: number;
  completionTime?: number;
  durationSec?: number;
  ageSec: number;
};

type OwnerRef = {
  kind: string;
  name: string;
};

type JobCondition = {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: number;
};

type JobPod = {
  name: string;
  phase: string;
  ready: string;
  restarts: number;
  node?: string;
  ageSec: number;
};

type JobPodsSummary = {
  total: number;
  ready: number;
};

type JobSpec = {
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

type ContainerSummary = {
  name: string;
  image?: string;
  cpuRequest?: string;
  cpuLimit?: string;
  memoryRequest?: string;
  memoryLimit?: string;
};

function isConditionHealthy(cond: JobCondition) {
  if (cond.type === "Failed") {
    return cond.status !== "True";
  }
  return cond.status === "True";
}

function formatDuration(seconds?: number) {
  if (!seconds || seconds <= 0) return "-";
  return fmtAge(seconds, "detail");
}

export default function JobDrawer(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  namespace: string;
  jobName: string | null;
}) {
  const { health, retryNonce } = useConnectionState();
  const offline = health === "unhealthy";
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<JobDetails | null>(null);
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [detailSignals, setDetailSignals] = useState<DashboardSignalItem[]>([]);
  const [err, setErr] = useState("");
  const [drawerPod, setDrawerPod] = useState<string | null>(null);
  const [drawerCronJob, setDrawerCronJob] = useState<string | null>(null);
  const [drawerSecret, setDrawerSecret] = useState<string | null>(null);
  const [drawerConfigMap, setDrawerConfigMap] = useState<string | null>(null);
  const [drawerNamespace, setDrawerNamespace] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const ns = props.namespace;
  const name = props.jobName;

  useEffect(() => {
    if (!props.open || !name || offline) return;

    setTab(0);
    setErr("");
    setDetails(null);
    setEvents([]);
    setDetailSignals([]);
    setDrawerPod(null);
    setDrawerCronJob(null);
    setDrawerSecret(null);
    setDrawerConfigMap(null);
    setDrawerNamespace(null);
    setLoading(true);

    (async () => {
      const det = await apiGet<JobDetailsResponse>(
        `/api/namespaces/${encodeURIComponent(ns)}/jobs/${encodeURIComponent(name)}`,
        props.token
      );
      const item: JobDetails | null = det?.item ?? null;
      setDetails(item);
      setDetailSignals(Array.isArray(det?.detailSignals) ? det.detailSignals : []);

      const ev = await apiGet<ApiListResponse<EventDTO>>(
        `/api/namespaces/${encodeURIComponent(ns)}/jobs/${encodeURIComponent(name)}/events`,
        props.token
      );
      setEvents(ev?.items || []);
    })()
      .catch((e) => {
        if (!details) setErr(String(e));
      })
      .finally(() => setLoading(false));
  }, [props.open, name, ns, props.token, retryNonce, offline, refreshNonce]);

  const summary = details?.summary;
  const linkedPods = details?.linkedPods;

  const resourceSignals = useResourceSignals({
    token: props.token,
    scope: "namespace",
    namespace: ns,
    kind: "jobs",
    name: name || "",
    enabled: !!props.open && !!name,
    refreshKey: retryNonce,
  });

  const jobSignals = useMemo<DashboardSignalItem[]>(
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
      {
        label: "Owner",
        value:
          summary?.owner?.kind === "CronJob" && summary?.owner?.name ? (
            <ResourceLinkChip label={summary.owner.name} onClick={() => setDrawerCronJob(summary.owner!.name)} />
          ) : summary?.owner?.name ? (
            `${summary.owner.kind || "Owner"}/${summary.owner.name}`
          ) : (
            "-"
          ),
      },
      {
        label: "Status",
        value: (
          <Chip size="small" label={valueOrDash(summary?.status)} color={jobStatusChipColor(summary?.status)} />
        ),
      },
      { label: "Active", value: valueOrDash(summary?.active) },
      { label: "Succeeded", value: valueOrDash(summary?.succeeded) },
      { label: "Failed", value: valueOrDash(summary?.failed) },
      {
        label: "Completions / Parallelism",
        value: `${valueOrDash(summary?.completions)} / ${valueOrDash(summary?.parallelism)}`,
      },
      { label: "Backoff Limit", value: valueOrDash(summary?.backoffLimit) },
      { label: "Start Time", value: summary?.startTime ? fmtTimeAgo(summary.startTime) : "-" },
      { label: "Completion Time", value: summary?.completionTime ? fmtTimeAgo(summary.completionTime) : "-" },
      { label: "Duration", value: formatDuration(summary?.durationSec) },
      { label: "Age", value: fmtAge(summary?.ageSec) },
      { label: "Linked Pods", value: linkedPods ? `${linkedPods.ready}/${linkedPods.total}` : "-" },
    ],
    [summary, linkedPods]
  );

  return (
    <RightDrawer open={props.open} onClose={props.onClose}>
      <ResourceDrawerShell
        title={
          <>
            Job: {name || "-"}{" "}
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
                    <Section title="Actions" divider={false}>
                      <JobActions
                        token={props.token}
                        namespace={ns}
                        jobName={name}
                        onDeleted={props.onClose}
                      />
                    </Section>
                  )}

                  <AttentionSummary
                    signals={jobSignals}
                    onJumpToEvents={() => setTab(3)}
                    onJumpToSpec={() => setTab(2)}
                  />

                  <HealthConditionsPanel
                    conditions={details?.conditions || []}
                    isHealthy={(cond) => isConditionHealthy(cond as JobCondition)}
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
                    <EmptyState message="No pods found for this Job." />
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
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
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
                  <EventsList events={events} emptyMessage="No events found for this Job." />
                </Box>
              )}

              {/* METADATA */}
              {tab === 4 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
                  <Box sx={panelBoxSx}>
                    <KeyValueTable
                      rows={summaryItems}
                      columns={3}
                      valueSx={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                    />
                  </Box>
                </Box>
              )}

              {/* YAML */}
              {tab === 5 && (
                <ResourceYamlPanel
                  code={details?.yaml || ""}
                  token={props.token}
                  target={{
                    kind: "Job",
                    group: "batch",
                    resource: "jobs",
                    apiVersion: "batch/v1",
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
            <CronJobDrawer
              open={!!drawerCronJob}
              onClose={() => setDrawerCronJob(null)}
              token={props.token}
              namespace={ns}
              cronJobName={drawerCronJob}
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
