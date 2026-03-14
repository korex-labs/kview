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
import PodDrawer from "../pods/PodDrawer";
import CronJobDrawer from "../cronjobs/CronJobDrawer";
import JobActions from "./JobActions";
import { fmtAge, fmtTs, valueOrDash } from "../../../utils/format";
import { eventChipColor, jobStatusChipColor, phaseChipColor } from "../../../utils/k8sUi";
import KeyValueTable from "../../shared/KeyValueTable";
import EmptyState from "../../shared/EmptyState";
import ErrorState from "../../shared/ErrorState";
import Section from "../../shared/Section";
import ResourceLinkChip from "../../shared/ResourceLinkChip";
import ConditionsTable from "../../shared/ConditionsTable";
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

type JobDetails = {
  summary: JobSummary;
  conditions: JobCondition[];
  pods: JobPod[];
  linkedPods: JobPodsSummary;
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
  const { retryNonce } = useConnectionState();
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<JobDetails | null>(null);
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [err, setErr] = useState("");
  const [drawerPod, setDrawerPod] = useState<string | null>(null);
  const [drawerCronJob, setDrawerCronJob] = useState<string | null>(null);

  const ns = props.namespace;
  const name = props.jobName;

  useEffect(() => {
    if (!props.open || !name) return;

    setTab(0);
    setErr("");
    setDetails(null);
    setEvents([]);
    setDrawerPod(null);
    setDrawerCronJob(null);
    setLoading(true);

    (async () => {
      const det = await apiGet<any>(
        `/api/namespaces/${encodeURIComponent(ns)}/jobs/${encodeURIComponent(name)}`,
        props.token
      );
      const item: JobDetails | null = det?.item ?? null;
      setDetails(item);

      const ev = await apiGet<any>(
        `/api/namespaces/${encodeURIComponent(ns)}/jobs/${encodeURIComponent(name)}/events`,
        props.token
      );
      setEvents(ev?.items || []);
    })()
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [props.open, name, ns, props.token, retryNonce]);

  const summary = details?.summary;
  const linkedPods = details?.linkedPods;
  const hasUnhealthyConditions = (details?.conditions || []).some((c) => !isConditionHealthy(c));

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
      { label: "Start Time", value: summary?.startTime ? fmtTs(summary.startTime) : "-" },
      { label: "Completion Time", value: summary?.completionTime ? fmtTs(summary.completionTime) : "-" },
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
            Job: {name || "-"} <Typography component="span" variant="body2">({ns})</Typography>
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
              <Tab label="Events" />
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

                  <Box sx={panelBoxSx}>
                    <KeyValueTable
                      rows={summaryItems}
                      columns={3}
                      valueSx={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                    />
                  </Box>

                  <ConditionsTable conditions={details?.conditions || []} isHealthy={isConditionHealthy} />

                  {events.length > 0 && (() => {
                    const lastEvent = events[events.length - 1];
                    return (
                      <Section title="Last Event">
                        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, mt: 1 }}>
                          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                            <Chip size="small" label={lastEvent.type} color={eventChipColor(lastEvent.type)} />
                            <Typography variant="body2" fontWeight="medium">{lastEvent.reason}</Typography>
                            {lastEvent.lastSeen > 0 && (
                              <Typography variant="caption" color="text.secondary">
                                {fmtTs(lastEvent.lastSeen)}
                              </Typography>
                            )}
                          </Box>
                          {lastEvent.message && (
                            <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-wrap" }}>
                              {lastEvent.message}
                            </Typography>
                          )}
                        </Box>
                      </Section>
                    );
                  })()}
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

              {/* EVENTS */}
              {tab === 2 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  <EventsList events={events} emptyMessage="No events found for this Job." />
                </Box>
              )}

              {/* YAML */}
              {tab === 3 && (
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
            <CronJobDrawer
              open={!!drawerCronJob}
              onClose={() => setDrawerCronJob(null)}
              token={props.token}
              namespace={ns}
              cronJobName={drawerCronJob}
            />
          </>
        )}
      </ResourceDrawerShell>
    </RightDrawer>
  );
}
