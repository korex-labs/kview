import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
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
import JobDrawer from "../jobs/JobDrawer";
import SecretDrawer from "../secrets/SecretDrawer";
import ConfigMapDrawer from "../configmaps/ConfigMapDrawer";
import NamespaceDrawer from "../namespaces/NamespaceDrawer";
import CronJobActions from "./CronJobActions";
import { fmtAge, fmtTimeAgo, valueOrDash } from "../../../utils/format";
import { jobStatusChipColor } from "../../../utils/k8sUi";
import KeyValueTable from "../../shared/KeyValueTable";
import EmptyState from "../../shared/EmptyState";
import ErrorState from "../../shared/ErrorState";
import AccessDeniedState from "../../shared/AccessDeniedState";
import Section from "../../shared/Section";
import DrawerActionStrip from "../../shared/DrawerActionStrip";
import ResourceLinkChip from "../../shared/ResourceLinkChip";
import MetadataSection from "../../shared/MetadataSection";
import AttentionSummary, {
} from "../../shared/AttentionSummary";
import EventsList from "../../shared/EventsList";
import EventsPanel from "../../shared/EventsPanel";
import ResourceYamlPanel from "../../shared/ResourceYamlPanel";
import WorkloadSpecPanels from "../../shared/WorkloadSpecPanels";
import StatusChip from "../../shared/StatusChip";
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

type CronJobDetails = {
  summary: CronJobSummary;
  policy: CronJobPolicy;
  allJobs?: CronJobJob[];
  jobsForbidden?: boolean;
  spec: CronJobSpec;
  metadata: CronJobMetadata;
  yaml: string;
};

type CronJobDetailsResponse = ApiItemResponse<CronJobDetails> & {
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

type CronJobSummary = {
  name: string;
  namespace: string;
  schedule: string;
  scheduleHint?: string;
  timeZone?: string;
  concurrencyPolicy?: string;
  suspend: boolean;
  active: number;
  lastScheduleTime?: number;
  lastSuccessfulTime?: number;
  lastRunStatus?: string;
  ageSec: number;
};

type CronJobPolicy = {
  startingDeadlineSeconds?: number;
  successfulJobsHistoryLimit?: number;
  failedJobsHistoryLimit?: number;
};

type CronJobJob = {
  name: string;
  status: string;
  startTime?: number;
  completionTime?: number;
  durationSec?: number;
  ageSec?: number;
};

type CronJobSpec = {
  jobTemplate: {
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

type CronJobMetadata = {
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

function formatSuspend(suspend?: boolean) {
  if (suspend == null) return "-";
  const suspended = Boolean(suspend);
  return <StatusChip size="small" label={suspended ? "Yes" : "No"} color={suspended ? "warning" : "default"} />;
}

function formatSchedule(schedule?: string, hint?: string) {
  if (!schedule) return "-";
  if (hint) {
    return (
      <span title={schedule}>
        {hint}
      </span>
    );
  }
  return <span title={schedule}>{schedule}</span>;
}

function formatDuration(seconds?: number) {
  if (!seconds || seconds <= 0) return "-";
  return fmtAge(seconds, "detail");
}

export default function CronJobDrawer(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  namespace: string;
  cronJobName: string | null;
}) {
  const { retryNonce } = useConnectionState();
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<CronJobDetails | null>(null);
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [detailSignals, setDetailSignals] = useState<DashboardSignalItem[]>([]);
  const [err, setErr] = useState("");
  const [drawerJob, setDrawerJob] = useState<string | null>(null);
  const [drawerSecret, setDrawerSecret] = useState<string | null>(null);
  const [drawerConfigMap, setDrawerConfigMap] = useState<string | null>(null);
  const [drawerNamespace, setDrawerNamespace] = useState<string | null>(null);

  const ns = props.namespace;
  const name = props.cronJobName;

  useEffect(() => {
    if (!props.open || !name) return;

    setTab(0);
    setErr("");
    setDetails(null);
    setEvents([]);
    setDetailSignals([]);
    setDrawerJob(null);
    setDrawerSecret(null);
    setDrawerConfigMap(null);
    setDrawerNamespace(null);
    setLoading(true);

    (async () => {
      const det = await apiGet<CronJobDetailsResponse>(
        `/api/namespaces/${encodeURIComponent(ns)}/cronjobs/${encodeURIComponent(name)}`,
        props.token
      );
      const item: CronJobDetails | null = det?.item ?? null;
      setDetails(item);
      setDetailSignals(Array.isArray(det?.detailSignals) ? det.detailSignals : []);

      const ev = await apiGet<ApiListResponse<EventDTO>>(
        `/api/namespaces/${encodeURIComponent(ns)}/cronjobs/${encodeURIComponent(name)}/events?limit=5&type=Warning`,
        props.token
      );
      setEvents(ev?.items || []);
    })()
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [props.open, name, ns, props.token, retryNonce]);

  const summary = details?.summary;
  const policy = details?.policy;
  const allJobs = details?.allJobs || [];
  const metadata = details?.metadata;

  const resourceSignals = useResourceSignals({
    token: props.token,
    scope: "namespace",
    namespace: ns,
    kind: "cronjobs",
    name: name || "",
    enabled: !!props.open && !!name,
    refreshKey: retryNonce,
  });

  const cronJobSignals = useMemo<DashboardSignalItem[]>(
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
      { label: "Schedule", value: formatSchedule(summary?.schedule, summary?.scheduleHint) },
      { label: "Time Zone", value: valueOrDash(summary?.timeZone) },
      { label: "Concurrency Policy", value: valueOrDash(summary?.concurrencyPolicy) },
      { label: "Suspend", value: formatSuspend(summary?.suspend) },
      { label: "Active Jobs", value: valueOrDash(summary?.active) },
      {
        label: "Last Run Status",
        value: summary?.lastRunStatus ? (
          <StatusChip size="small" label={summary.lastRunStatus} color={jobStatusChipColor(summary.lastRunStatus)} />
        ) : (
          "-"
        ),
      },
      { label: "Last Schedule", value: summary?.lastScheduleTime ? fmtTimeAgo(summary.lastScheduleTime) : "-" },
      { label: "Last Successful", value: summary?.lastSuccessfulTime ? fmtTimeAgo(summary.lastSuccessfulTime) : "-" },
      { label: "Age", value: fmtAge(summary?.ageSec) },
    ],
    [summary]
  );

  return (
    <RightDrawer open={props.open} onClose={props.onClose}>
      <ResourceDrawerShell
        title={
          <>
            CronJob: {name || "-"}{" "}
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
              <Tab label="Jobs" />
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
                      <CronJobActions
                        token={props.token}
                        namespace={ns}
                        cronJobName={name}
                        onDeleted={props.onClose}
                      />
                    </DrawerActionStrip>
                  )}

                  <AttentionSummary
                    signals={cronJobSignals}
                    onJumpToEvents={() => setTab(3)}
                    onJumpToSpec={() => setTab(2)}
                  />

                  <Box sx={panelBoxSx}>
                    <Section
                      title="Key policy state"
                      dividerPlacement="content"
                      actions={null}
                    >
                      <KeyValueTable
                        columns={2}
                        rows={[
                          {
                            label: "Starting Deadline Seconds",
                            value: valueOrDash(policy?.startingDeadlineSeconds),
                          },
                          {
                            label: "Successful Jobs History Limit",
                            value: valueOrDash(policy?.successfulJobsHistoryLimit),
                          },
                          {
                            label: "Failed Jobs History Limit",
                            value: valueOrDash(policy?.failedJobsHistoryLimit),
                          },
                        ]}
                      />
                    </Section>
                  </Box>

                  <Section title="Recent Warning events">
                    <Box sx={panelBoxSx}>
                      <EventsList events={warningEvents} emptyMessage="No recent warning events." />
                    </Box>
                  </Section>
                </Box>
              )}

              {/* JOBS */}
              {tab === 1 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
                  {details?.jobsForbidden ? (
                    <AccessDeniedState resourceLabel="Jobs" />
                  ) : allJobs.length === 0 ? (
                    <EmptyState message="No Jobs found for this CronJob." />
                  ) : (
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Name</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell>Started</TableCell>
                          <TableCell>Completed</TableCell>
                          <TableCell>Duration</TableCell>
                          <TableCell>Age</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {allJobs.map((j, idx) => (
                          <TableRow
                            key={j.name || String(idx)}
                            hover
                            onClick={() => j.name && setDrawerJob(j.name)}
                            sx={{ cursor: j.name ? "pointer" : "default" }}
                          >
                            <TableCell>{valueOrDash(j.name)}</TableCell>
                            <TableCell>
                              <StatusChip size="small" label={valueOrDash(j.status)} color={jobStatusChipColor(j.status)} />
                            </TableCell>
                            <TableCell>{j.startTime ? fmtTimeAgo(j.startTime) : "-"}</TableCell>
                            <TableCell>{j.completionTime ? fmtTimeAgo(j.completionTime) : "-"}</TableCell>
                            <TableCell>{formatDuration(j.durationSec)}</TableCell>
                            <TableCell>{fmtAge(j.ageSec)}</TableCell>
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
                    template={details?.spec?.jobTemplate}
                    scheduling={details?.spec?.scheduling}
                    volumes={details?.spec?.volumes}
                    missingReferences={details?.spec?.missingReferences}
                    templateTitle="Job Template Summary"
                    onOpenSecret={setDrawerSecret}
                    onOpenConfigMap={setDrawerConfigMap}
                  />
                </Box>
              )}

              {/* EVENTS */}
              {tab === 3 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  <EventsPanel endpoint={`/api/namespaces/${encodeURIComponent(ns)}/cronjobs/${encodeURIComponent(name || "")}/events`} token={props.token} emptyMessage="No events found for this CronJob." />
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
                  <Section title="Template Metadata">
                    <MetadataSection
                      labels={details?.spec?.metadata?.labels}
                      annotations={details?.spec?.metadata?.annotations}
                      wrapInSection={false}
                    />
                  </Section>
                </Box>
              )}

              {/* YAML */}
              {tab === 5 && (
                <ResourceYamlPanel
                  code={details?.yaml || ""}
                  token={props.token}
                  target={{
                    kind: "CronJob",
                    group: "batch",
                    resource: "cronjobs",
                    apiVersion: "batch/v1",
                    namespace: ns,
                    name: name || "",
                  }}
                />
              )}
            </Box>
            <JobDrawer
              open={!!drawerJob}
              onClose={() => setDrawerJob(null)}
              token={props.token}
              namespace={ns}
              jobName={drawerJob}
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
