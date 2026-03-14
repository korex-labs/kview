import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Typography,
  Tabs,
  Tab,
  CircularProgress,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { apiGet } from "../../../api";
import { useConnectionState } from "../../../connectionState";
import JobDrawer from "../jobs/JobDrawer";
import CronJobActions from "./CronJobActions";
import { fmtAge, fmtTs, valueOrDash } from "../../../utils/format";
import { jobStatusChipColor } from "../../../utils/k8sUi";
import KeyValueTable from "../../shared/KeyValueTable";
import EmptyState from "../../shared/EmptyState";
import ErrorState from "../../shared/ErrorState";
import AccessDeniedState from "../../shared/AccessDeniedState";
import Section from "../../shared/Section";
import MetadataSection from "../../shared/MetadataSection";
import EventsList from "../../shared/EventsList";
import CodeBlock from "../../shared/CodeBlock";
import RightDrawer from "../../layout/RightDrawer";
import ResourceDrawerShell from "../../shared/ResourceDrawerShell";
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
  return <Chip size="small" label={suspended ? "Yes" : "No"} color={suspended ? "warning" : "default"} />;
}

function formatSchedule(schedule?: string, hint?: string) {
  if (!schedule) return "-";
  if (hint) return `${schedule} (${hint})`;
  return schedule;
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
  const [err, setErr] = useState("");
  const [drawerJob, setDrawerJob] = useState<string | null>(null);

  const ns = props.namespace;
  const name = props.cronJobName;

  useEffect(() => {
    if (!props.open || !name) return;

    setTab(0);
    setErr("");
    setDetails(null);
    setEvents([]);
    setDrawerJob(null);
    setLoading(true);

    (async () => {
      const det = await apiGet<any>(
        `/api/namespaces/${encodeURIComponent(ns)}/cronjobs/${encodeURIComponent(name)}`,
        props.token
      );
      const item: CronJobDetails | null = det?.item ?? null;
      setDetails(item);

      const ev = await apiGet<any>(
        `/api/namespaces/${encodeURIComponent(ns)}/cronjobs/${encodeURIComponent(name)}/events`,
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

  const hasPolicy =
    policy?.startingDeadlineSeconds != null ||
    policy?.successfulJobsHistoryLimit != null ||
    policy?.failedJobsHistoryLimit != null;

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
          <Chip size="small" label={summary.lastRunStatus} color={jobStatusChipColor(summary.lastRunStatus)} />
        ) : (
          "-"
        ),
      },
      { label: "Last Schedule", value: summary?.lastScheduleTime ? fmtTs(summary.lastScheduleTime) : "-" },
      { label: "Last Successful", value: summary?.lastSuccessfulTime ? fmtTs(summary.lastSuccessfulTime) : "-" },
      { label: "Age", value: fmtAge(summary?.ageSec) },
    ],
    [summary]
  );

  return (
    <RightDrawer open={props.open} onClose={props.onClose}>
      <ResourceDrawerShell
        title={
          <>
            CronJob: {name || "-"} <Typography component="span" variant="body2">({ns})</Typography>
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
              <Tab label="YAML" />
            </Tabs>

            <Box sx={drawerBodySx}>
              {/* OVERVIEW */}
              {tab === 0 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
                  {name && (
                    <Section title="Actions" divider={false}>
                      <CronJobActions
                        token={props.token}
                        namespace={ns}
                        cronJobName={name}
                        onDeleted={props.onClose}
                      />
                    </Section>
                  )}

                  <Box sx={panelBoxSx}>
                    <KeyValueTable
                      rows={summaryItems}
                      columns={3}
                      valueSx={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                    />
                  </Box>

                  <Accordion defaultExpanded={hasPolicy}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="subtitle2">Policy</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
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
                    </AccordionDetails>
                  </Accordion>
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
                              <Chip size="small" label={valueOrDash(j.status)} color={jobStatusChipColor(j.status)} />
                            </TableCell>
                            <TableCell>{j.startTime ? fmtTs(j.startTime) : "-"}</TableCell>
                            <TableCell>{j.completionTime ? fmtTs(j.completionTime) : "-"}</TableCell>
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
                  <Accordion defaultExpanded>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="subtitle2">Job Template Summary</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Typography variant="caption" color="text.secondary">
                        Containers
                      </Typography>
                      {(details?.spec?.jobTemplate?.containers || []).length === 0 ? (
                        <EmptyState message="No containers defined." sx={{ mt: 0.5 }} />
                      ) : (
                        <Table size="small" sx={{ mt: 0.5 }}>
                          <TableHead>
                            <TableRow>
                              <TableCell>Name</TableCell>
                              <TableCell>Image</TableCell>
                              <TableCell>CPU Req/Lim</TableCell>
                              <TableCell>Memory Req/Lim</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(details?.spec?.jobTemplate?.containers || []).map((c, idx) => (
                              <TableRow key={c.name || String(idx)}>
                                <TableCell>{valueOrDash(c.name)}</TableCell>
                                <TableCell sx={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>
                                  {valueOrDash(c.image)}
                                </TableCell>
                                <TableCell>
                                  {valueOrDash(c.cpuRequest)} / {valueOrDash(c.cpuLimit)}
                                </TableCell>
                                <TableCell>
                                  {valueOrDash(c.memoryRequest)} / {valueOrDash(c.memoryLimit)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </AccordionDetails>
                  </Accordion>

                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="subtitle2">Scheduling & Placement</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <KeyValueTable
                        columns={2}
                        rows={[{ label: "Affinity", value: details?.spec?.scheduling?.affinitySummary }]}
                      />

                      <Box sx={{ mt: 2 }}>
                        <Typography variant="caption" color="text.secondary">
                          Node Selectors
                        </Typography>
                        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 0.5 }}>
                          {Object.entries(details?.spec?.scheduling?.nodeSelector || {}).length === 0 ? (
                            <EmptyState message="None" />
                          ) : (
                            Object.entries(details?.spec?.scheduling?.nodeSelector || {}).map(([k, v]) => (
                              <Chip key={k} size="small" label={`${k}=${v}`} />
                            ))
                          )}
                        </Box>
                      </Box>

                      <Box sx={{ mt: 2 }}>
                        <Typography variant="caption" color="text.secondary">
                          Tolerations
                        </Typography>
                        {(details?.spec?.scheduling?.tolerations || []).length === 0 ? (
                          <EmptyState message="None" sx={{ mt: 0.5 }} />
                        ) : (
                          <Table size="small" sx={{ mt: 0.5 }}>
                            <TableHead>
                              <TableRow>
                                <TableCell>Key</TableCell>
                                <TableCell>Operator</TableCell>
                                <TableCell>Value</TableCell>
                                <TableCell>Effect</TableCell>
                                <TableCell>Seconds</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {(details?.spec?.scheduling?.tolerations || []).map((t, idx) => (
                                <TableRow key={`${t.key || "tol"}-${idx}`}>
                                  <TableCell>{valueOrDash(t.key)}</TableCell>
                                  <TableCell>{valueOrDash(t.operator)}</TableCell>
                                  <TableCell>{valueOrDash(t.value)}</TableCell>
                                  <TableCell>{valueOrDash(t.effect)}</TableCell>
                                  <TableCell>{valueOrDash(t.seconds)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </Box>
                    </AccordionDetails>
                  </Accordion>

                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="subtitle2">Volumes</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      {(details?.spec?.volumes || []).length === 0 ? (
                        <EmptyState message="No volumes defined." />
                      ) : (
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Name</TableCell>
                              <TableCell>Type</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(details?.spec?.volumes || []).map((v, idx) => (
                              <TableRow key={v.name || String(idx)}>
                                <TableCell>{valueOrDash(v.name)}</TableCell>
                                <TableCell>{valueOrDash(v.type)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </AccordionDetails>
                  </Accordion>

                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="subtitle2">Template Metadata</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <MetadataSection
                        labels={details?.spec?.metadata?.labels}
                        annotations={details?.spec?.metadata?.annotations}
                        wrapInSection={false}
                      />
                    </AccordionDetails>
                  </Accordion>
                </Box>
              )}

              {/* EVENTS */}
              {tab === 3 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  <EventsList events={events} emptyMessage="No events found for this CronJob." />
                </Box>
              )}

              {/* YAML */}
              {tab === 4 && (
                <CodeBlock code={details?.yaml || ""} language="yaml" />
              )}
            </Box>
            <JobDrawer
              open={!!drawerJob}
              onClose={() => setDrawerJob(null)}
              token={props.token}
              namespace={ns}
              jobName={drawerJob}
            />
          </>
        )}
      </ResourceDrawerShell>
    </RightDrawer>
  );
}
