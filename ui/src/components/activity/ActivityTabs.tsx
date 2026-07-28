import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Tabs,
  Tab,
  Typography,
  Table,
  TableContainer,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ActivityList from "./ActivityList";
import EmptyState from "../shared/EmptyState";
import { AppIconButton } from "../shared/AppActions";
import KeyValueChip from "../shared/KeyValueChip";
import StatusChip from "../shared/StatusChip";
import { apiGet, toApiError } from "../../api";
import TerminalSessionView from "./TerminalSessionView";
import { apiDelete } from "../../sessionsApi";
import { emitFocusLogsTab, emitOpenTerminalSession } from "../../activityEvents";
import { useConnectionState } from "../../connectionState";
import { fmtDurationMs } from "../../utils/format";
import usePageVisible from "../../utils/usePageVisible";
import { listInvestigationSnapshots } from "../../investigationSnapshots";
import type { InvestigationSnapshot } from "../../types/api";
import {
  activityChipSx,
  chipColorForValue,
  compactCellSx,
  compactHeaderCellSx,
  compactTableSx,
  compactTableContainerSx,
  panelEmptyStateSx,
} from "./activityUi";

type Props = {
  panelOpen: boolean;
  tab: number;
  token: string;
  requestedTerminalId?: string | null;
  requestedTerminalRequestKey?: number;
  onCountsChange?: (counts: {
    activities: number;
    dataplaneWork: number;
    terminals: number;
    portForwards: number;
  }) => void;
};

type LiveWorkRow = {
  workKey: string;
  cluster: string;
  class: string;
  kind: string;
  namespace?: string;
  priority: string;
  source: string;
  state: string;
  waitMs: number;
  runningMs: number;
};

type SchedulerHealthSnapshot = {
  cluster: string;
  state: "healthy" | "limited" | "throttled" | "recovering" | string;
  backgroundAdmission: "open" | "limited" | "paused" | string;
  consecutiveFailures: number;
  recentFailures: number;
  recentSuccesses: number;
  lastErrorClass?: string;
  lastTransition?: string;
  lastEvent?: string;
  reason?: string;
};

type NamespaceSweepCoverage = {
  cluster: string;
  enabled: boolean;
  totalNamespaces: number;
  enrichedNamespaces: number;
  staleNamespaces: number;
  neverScannedNamespaces: number;
  systemNamespacesSkipped: number;
  inFlight?: boolean;
  stage?: string;
  detailDone?: number;
  relatedDone?: number;
  enrichTargets?: number;
  hourUsed?: number;
  hourLimit?: number;
  pausedReason?: string;
};

type LiveWork = {
  maxSlotsPerCluster: number;
  running: LiveWorkRow[];
  queued: LiveWorkRow[];
  health?: SchedulerHealthSnapshot[];
  namespaceSweep?: NamespaceSweepCoverage[];
};

type Activity = {
  id: string;
  kind: string;
  type: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  resourceType?: string;
  /** Wall time from start to now (running) or to updatedAt (stopped), milliseconds */
  executionMs?: number;
  metadata?: Record<string, string>;
};

type FadingRow<T> = T & { __exiting?: boolean };

type ActivityLogEntry = {
  id: string;
  timestamp: string;
  level: string;
  source: string;
  message: string;
};

type Session = {
  id: string;
  type: string;
  title: string;
  status: string;
  createdAt: string;
  targetCluster?: string;
  targetNamespace?: string;
  targetResource?: string;
  targetContainer?: string;
  metadata?: Record<string, string>;
};

function useFadingRows<T>(
  rows: T[],
  keyForRow: (row: T) => string,
  holdMs = 2400,
): Array<FadingRow<T>> {
  const [displayRows, setDisplayRows] = useState<Array<FadingRow<T>>>([]);
  const removalTimersRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const incomingKeys = new Set(rows.map(keyForRow));
    setDisplayRows((prev) => {
      const next = rows.map((row) => ({ ...row, __exiting: false }));

      prev.forEach((row) => {
        const key = keyForRow(row);
        if (incomingKeys.has(key) || row.__exiting) return;
        next.push({ ...row, __exiting: true });
        const timer = window.setTimeout(() => {
          removalTimersRef.current.delete(key);
          setDisplayRows((current) => current.filter((item) => keyForRow(item) !== key));
        }, holdMs);
        removalTimersRef.current.set(key, timer);
      });

      rows.forEach((row) => {
        const key = keyForRow(row);
        const timer = removalTimersRef.current.get(key);
        if (timer !== undefined) {
          window.clearTimeout(timer);
          removalTimersRef.current.delete(key);
        }
      });

      return next;
    });
  }, [holdMs, keyForRow, rows]);

  useEffect(() => {
    const removalTimers = removalTimersRef.current;
    return () => {
      removalTimers.forEach((timer) => window.clearTimeout(timer));
      removalTimers.clear();
    };
  }, []);

  return displayRows;
}

function schedulerHealthColor(state?: string) {
  switch (state) {
    case "throttled":
      return "error" as const;
    case "limited":
      return "warning" as const;
    case "recovering":
      return "info" as const;
    case "healthy":
      return "success" as const;
    default:
      return "default" as const;
  }
}

function backgroundAdmissionColor(admission?: string) {
  switch (admission) {
    case "paused":
      return "error" as const;
    case "limited":
      return "warning" as const;
    case "open":
      return "success" as const;
    default:
      return "default" as const;
  }
}

function formatNamespaceSweepDetail(row: NamespaceSweepCoverage) {
  const bucketTotal = row.enrichedNamespaces + row.neverScannedNamespaces + row.systemNamespacesSkipped;
  const bits = [
    `total=${row.totalNamespaces}`,
    `scanned=${row.enrichedNamespaces}`,
    `never eligible=${row.neverScannedNamespaces}`,
    `system skipped=${row.systemNamespacesSkipped}`,
    `buckets=${bucketTotal}/${row.totalNamespaces}`,
    `stale scanned=${row.staleNamespaces}`,
    `hour=${row.hourUsed ?? 0}/${row.hourLimit ?? 0}`,
  ];
  if (row.stage) bits.push(`stage=${row.stage}`);
  if (row.enrichTargets) bits.push(`progress=${row.relatedDone ?? 0}/${row.enrichTargets}`);
  if (row.systemNamespacesSkipped) bits.push(`system skipped=${row.systemNamespacesSkipped}`);
  if (row.pausedReason) bits.push(`reason=${row.pausedReason}`);
  return bits.join(" · ");
}

function namespaceSweepColor(row: NamespaceSweepCoverage) {
  if (!row.enabled || row.pausedReason === "coverage fresh") return "default" as const;
  if (row.inFlight) return "info" as const;
  if (row.neverScannedNamespaces > 0) return "warning" as const;
  if (row.staleNamespaces > 0) return "info" as const;
  return "success" as const;
}

function namespaceSweepStateLabel(row: NamespaceSweepCoverage) {
  if (!row.enabled) return "Disabled";
  switch (row.stage) {
    case "focused_idle_wait":
      return "Waiting for idle (focused)";
    case "sweep_idle_wait":
      return "Waiting for idle";
    case "focused_enriching":
      return "Scanning focused";
    case "sweep_enriching":
      return `Scanning sweep ${row.relatedDone ?? 0}/${row.enrichTargets ?? 0}`;
    case "complete":
      return "Fresh";
    default:
      break;
  }
  if (row.inFlight) return "Running";
  if (row.pausedReason === "coverage fresh") return "Fresh";
  if (row.pausedReason === "eligible when idle") return "Idle; will scan when triggered";
  if (row.pausedReason) return row.pausedReason;
  return "Idle";
}

function namespaceSweepStateColor(row: NamespaceSweepCoverage) {
  if (row.stage?.endsWith("idle_wait")) return "warning" as const;
  if (row.stage?.endsWith("enriching")) return "info" as const;
  if (row.inFlight) return "info" as const;
  return "default" as const;
}

function formatSchedulerHealthDetail(snapshot: SchedulerHealthSnapshot) {
  const bits = [
    `state=${snapshot.state}`,
    `background=${snapshot.backgroundAdmission}`,
    `recent failures=${snapshot.recentFailures}`,
    `recent successes=${snapshot.recentSuccesses}`,
    `consecutive failures=${snapshot.consecutiveFailures}`,
  ];
  if (snapshot.lastErrorClass) bits.push(`last error=${snapshot.lastErrorClass}`);
  if (snapshot.reason) bits.push(`reason=${snapshot.reason}`);
  return bits.join(" · ");
}

function investigationSnapshotActivity(snapshot: InvestigationSnapshot): Activity {
  const ref = snapshot.primaryResource;
  const createdAt = new Date(snapshot.createdAt || Date.now()).toISOString();
  const updatedAt = new Date(snapshot.updatedAt || snapshot.createdAt || Date.now()).toISOString();
  return {
    id: `snapshot:${snapshot.id || `${snapshot.context || "local"}:${ref.kind}:${ref.namespace || ""}:${ref.name}`}`,
    kind: "local",
    type: "investigation-snapshot",
    title: snapshot.title || snapshot.signal?.title || "Saved investigation",
    status: snapshot.triageState || "investigating",
    createdAt,
    updatedAt,
    startedAt: createdAt,
    resourceType: snapshot.signal?.type || "investigation",
    metadata: {
      context: snapshot.context || "",
      resourceKind: ref.kind || "",
      namespace: ref.namespace || "",
      name: ref.name || "",
      signalSeverity: snapshot.signal?.severity || "",
    },
  };
}

export default function ActivityTabs({
  panelOpen,
  tab,
  token,
  requestedTerminalId,
  requestedTerminalRequestKey,
  onCountsChange,
}: Props) {
  const { health } = useConnectionState();
  const offline = health === "unhealthy";
  const pageVisible = usePageVisible();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsErr, setLogsErr] = useState<string | null>(null);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsErr, setSessionsErr] = useState<string | null>(null);

  const [liveWork, setLiveWork] = useState<LiveWork | null>(null);
  const [liveWorkErr, setLiveWorkErr] = useState<string | null>(null);

  const [openTerminalIds, setOpenTerminalIds] = useState<string[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const logsScrollRef = useRef<HTMLDivElement | null>(null);
  const terminalInfoCacheRef = useRef<Map<string, Session>>(new Map());
  const logsStickToBottomRef = useRef(true);
  const activitiesLengthRef = useRef(0);
  const sessionsLengthRef = useRef(0);
  const logsLengthRef = useRef(0);
  const liveWorkRef = useRef<LiveWork | null>(null);

  useEffect(() => {
    activitiesLengthRef.current = activities.length;
  }, [activities.length]);

  useEffect(() => {
    sessionsLengthRef.current = sessions.length;
  }, [sessions.length]);

  useEffect(() => {
    logsLengthRef.current = logs.length;
  }, [logs.length]);

  useEffect(() => {
    liveWorkRef.current = liveWork;
  }, [liveWork]);

  const mergeRuntimeLogs = useCallback(
    (prev: ActivityLogEntry[], incoming: ActivityLogEntry[]): ActivityLogEntry[] => {
      if (incoming.length === 0) {
        return prev;
      }

      const byId = new Map<string, ActivityLogEntry>();
      const order: string[] = [];

      prev.forEach((item) => {
        byId.set(item.id, item);
        order.push(item.id);
      });

      let changed = false;
      incoming.forEach((item) => {
        const existing = byId.get(item.id);
        if (!existing) {
          byId.set(item.id, item);
          order.push(item.id);
          changed = true;
          return;
        }
        if (
          existing.timestamp !== item.timestamp ||
          existing.level !== item.level ||
          existing.source !== item.source ||
          existing.message !== item.message
        ) {
          byId.set(item.id, item);
          changed = true;
        }
      });

      if (!changed) return prev;
      return order.map((id) => byId.get(id)!).filter(Boolean);
    },
    [],
  );

  const reloadActivities = useCallback(() => {
    if (offline) return;
    setLoading(true);
    setErr(null);
    Promise.all([
      apiGet<{ items: Activity[] }>("/api/activity", token),
      listInvestigationSnapshots(token).catch(() => []),
    ])
      .then(([res, snapshots]) => {
        const snapshotActivities = snapshots.map(investigationSnapshotActivity);
        setActivities([...(res.items || []), ...snapshotActivities]);
      })
      .catch((e) => {
        // Keep stale activity rows visible while retrying in background.
        if (activitiesLengthRef.current === 0) setErr(String(e));
      })
      .finally(() => setLoading(false));
  }, [offline, token]);

  useEffect(() => {
    if (offline || !pageVisible) return;
    reloadActivities();
    const id = window.setInterval(reloadActivities, panelOpen ? 5000 : 30000);
    return () => window.clearInterval(id);
  }, [offline, pageVisible, panelOpen, reloadActivities]);

  const reloadLiveWork = useCallback(() => {
    if (offline) return;
    setLiveWorkErr(null);
    apiGet<LiveWork>("/api/dataplane/work/live", token)
      .then((res) => {
        setLiveWork(res);
      })
      .catch((e) => {
        if (!liveWorkRef.current) setLiveWorkErr(String(e));
      });
  }, [offline, token]);

  useEffect(() => {
    if (offline || !pageVisible || !panelOpen || tab !== 1) return;
    reloadLiveWork();
    const id = window.setInterval(reloadLiveWork, 3000);
    return () => window.clearInterval(id);
  }, [offline, pageVisible, panelOpen, tab, reloadLiveWork]);

  const reloadSessions = useCallback(() => {
    if (offline) return;
    setSessionsLoading(true);
    setSessionsErr(null);
    apiGet<{ items: Session[] }>("/api/sessions", token)
      .then((res) => {
        setSessions(res.items || []);
      })
      .catch((e) => {
        if (sessionsLengthRef.current === 0) setSessionsErr(String(e));
      })
      .finally(() => setSessionsLoading(false));
  }, [offline, token]);

  useEffect(() => {
    if (offline || !pageVisible) return;
    if (!panelOpen && openTerminalIds.length === 0) return;
    if (panelOpen && tab !== 2 && tab !== 3 && openTerminalIds.length === 0) return;
    reloadSessions();
    const id = window.setInterval(reloadSessions, 5000);
    return () => window.clearInterval(id);
  }, [offline, pageVisible, panelOpen, tab, openTerminalIds.length, reloadSessions]);

  useEffect(() => {
    if (!requestedTerminalId) return;
    setOpenTerminalIds((prev) =>
      prev.includes(requestedTerminalId) ? prev : [...prev, requestedTerminalId]
    );
    setActiveTerminalId(requestedTerminalId);
    setFocusNonce((n) => n + 1);
    reloadSessions();
  }, [requestedTerminalId, requestedTerminalRequestKey, reloadSessions]);

  useEffect(() => {
    if (openTerminalIds.length === 0) {
      if (activeTerminalId !== null) {
        setActiveTerminalId(null);
      }
      return;
    }
    if (!activeTerminalId || !openTerminalIds.includes(activeTerminalId)) {
      setActiveTerminalId(openTerminalIds[0]);
    }
  }, [openTerminalIds, activeTerminalId]);

  const sessionsById = useMemo(() => {
    const map = new Map<string, Session>();
    sessions.forEach((s) => map.set(s.id, s));
    return map;
  }, [sessions]);
  const terminalSessions = useMemo(() => sessions.filter((s) => s.type === "terminal"), [sessions]);
  const portForwardSessions = useMemo(
    () =>
      sessions.filter(
        (s) =>
          s.type === "portforward" &&
          (s.status === "running" || s.status === "starting" || s.status === "pending" || s.status === "stopping"),
      ),
    [sessions],
  );
  const liveWorkRunning = useMemo(() => liveWork?.running ?? [], [liveWork]);
  const liveWorkQueued = useMemo(() => liveWork?.queued ?? [], [liveWork]);
  const liveWorkHealth = useMemo(() => liveWork?.health ?? [], [liveWork]);
  const namespaceSweepRows = useMemo(() => liveWork?.namespaceSweep ?? [], [liveWork]);
  const limitedHealthCount = useMemo(
    () => liveWorkHealth.filter((snapshot) => snapshot.backgroundAdmission !== "open").length,
    [liveWorkHealth],
  );
  const pausedHealthCount = useMemo(
    () => liveWorkHealth.filter((snapshot) => snapshot.backgroundAdmission === "paused").length,
    [liveWorkHealth],
  );
  const displayHealthRows = useMemo(
    () => [
      ...liveWorkHealth.filter((snapshot) => snapshot.backgroundAdmission !== "open"),
      ...liveWorkHealth.filter((snapshot) => snapshot.backgroundAdmission === "open").slice(0, 3),
    ],
    [liveWorkHealth],
  );
  const displayActivities = useFadingRows(
    activities,
    useCallback((activity: Activity) => activity.id, []),
  );
  const runningWorkRows = useFadingRows(
    liveWorkRunning,
    useCallback((row: LiveWorkRow) => row.workKey, []),
  );
  const queuedWorkRows = useFadingRows(
    liveWorkQueued,
    useCallback((row: LiveWorkRow) => row.workKey, []),
  );

  const terminateSession = async (id: string) => {
    try {
      await apiDelete(`/api/sessions/${encodeURIComponent(id)}`, token);
      setOpenTerminalIds((prev) => prev.filter((item) => item !== id));
      setActiveTerminalId((prev) => (prev === id ? null : prev));
      reloadSessions();
      reloadActivities();
    } catch (e) {
      const apiErr = toApiError(e);
      if (apiErr.status === 404) {
        // Session is already closed on backend (e.g. shell exited via Ctrl+D).
        setOpenTerminalIds((prev) => prev.filter((item) => item !== id));
        setActiveTerminalId((prev) => (prev === id ? null : prev));
        reloadSessions();
        return;
      }
      const msg = apiErr.message || "Unable to terminate session.";
      setSessionsErr(msg);
    }
  };

  useEffect(() => {
    if (tab !== 4 || !panelOpen) return;
    if (offline || !pageVisible) return;

    const loadOnce = () => {
      const node = logsScrollRef.current;
      if (node) {
        const distanceToBottom = node.scrollHeight - node.clientHeight - node.scrollTop;
        logsStickToBottomRef.current = distanceToBottom <= 24;
      }
      setLogsLoading(true);
      setLogsErr(null);
      apiGet<{ items: ActivityLogEntry[] }>("/api/activity/runtime/logs", token)
        .then((res) => {
          setLogs((prev) => mergeRuntimeLogs(prev, res.items || []));
        })
        .catch((e) => {
          if (logsLengthRef.current === 0) setLogsErr(String(e));
        })
        .finally(() => setLogsLoading(false));
    };

    loadOnce();
    const id = window.setInterval(loadOnce, 5000);
    return () => window.clearInterval(id);
  }, [tab, panelOpen, offline, pageVisible, token, mergeRuntimeLogs]);

  useEffect(() => {
    terminalSessions.forEach((s) => {
      terminalInfoCacheRef.current.set(s.id, s);
    });
    const nextIds = new Set(terminalSessions.map((s) => s.id));
    setOpenTerminalIds((prev) => {
      const merged = [...prev];
      nextIds.forEach((id) => {
        if (!merged.includes(id)) merged.push(id);
      });
      return merged;
    });
    setActiveTerminalId((prev) => {
      if (prev) {
        return prev;
      }
      return terminalSessions[0]?.id || null;
    });
  }, [terminalSessions]);

  useEffect(() => {
    if (tab !== 4) return;
    const node = logsScrollRef.current;
    if (!node) return;
    if (logsStickToBottomRef.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [logs, tab]);

  useEffect(() => {
    const dw =
      liveWork != null ? (liveWork.running?.length ?? 0) + (liveWork.queued?.length ?? 0) : 0;
    onCountsChange?.({
      activities: activities.length,
      dataplaneWork: dw,
      terminals: openTerminalIds.length,
      portForwards: portForwardSessions.length,
    });
  }, [
    activities.length,
    liveWork,
    openTerminalIds.length,
    portForwardSessions.length,
    onCountsChange,
  ]);

  return (
    <Box sx={{ flexGrow: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Box sx={{ display: tab === 0 ? "flex" : "none", flex: 1, minHeight: 0, overflow: "hidden", flexDirection: "column" }}>
        <ActivityList
          items={displayActivities}
          loading={loading}
          error={err || undefined}
          onViewTerminal={(activity) => {
            emitOpenTerminalSession({ sessionId: activity.id });
          }}
          onOpenPortForward={(activity) => {
            const host = activity.metadata?.localHost || "127.0.0.1";
            const localPort = activity.metadata?.localPort;
            if (!localPort) return;
            window.open(`http://${host}:${localPort}`, "_blank", "noopener,noreferrer");
          }}
          onFocusLogs={() => emitFocusLogsTab()}
          onDeleteSession={(activity) => {
            if (activity.type === "terminal" || activity.type === "portforward") {
              void terminateSession(activity.id);
            }
          }}
        />
      </Box>
      <Box sx={{ display: tab === 1 ? "flex" : "none", flex: 1, minHeight: 0, overflow: "hidden", flexDirection: "column" }}>
        {liveWorkErr && !liveWork ? (
          <EmptyState message={`Dataplane work: ${liveWorkErr}`} sx={panelEmptyStateSx} />
        ) : (
          <Box sx={compactTableContainerSx}>
            {liveWorkErr ? (
              <Typography variant="caption" color="error" sx={{ px: 0.5, py: 0.25, display: "block" }}>
                {liveWorkErr}
              </Typography>
            ) : null}
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "minmax(120px, 160px) 1fr",
                gap: 0.75,
                px: 0.75,
                py: 0.75,
                borderBottom: "1px solid",
                borderColor: "divider",
                bgcolor: "action.hover",
              }}
            >
              <Box>
                <Typography variant="caption" sx={{ display: "block", fontWeight: 700 }}>
                  Scheduler work
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Queue and slot usage
                </Typography>
              </Box>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, alignItems: "center" }}>
                <KeyValueChip chipKey="slots/cluster" value={String(liveWork?.maxSlotsPerCluster ?? "-")} color="primary" maxKeyLen={16} />
                <KeyValueChip chipKey="running" value={String(liveWork?.running?.length ?? 0)} color="success" />
                <KeyValueChip chipKey="queued" value={String(liveWork?.queued?.length ?? 0)} color="info" />
              </Box>

              <Box>
                <Typography variant="caption" sx={{ display: "block", fontWeight: 700 }}>
                  Namespace sweep
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Background coverage radar
                </Typography>
              </Box>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, alignItems: "center", minWidth: 0 }}>
                {namespaceSweepRows.length === 0 ? (
                  <Typography variant="caption" color="text.secondary">
                    No coverage data yet.
                  </Typography>
                ) : null}
                {namespaceSweepRows.map((row) => (
                  <Tooltip key={`sweep-${row.cluster}`} title={formatNamespaceSweepDetail(row)}>
                    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.35, minWidth: 0, mr: 0.5 }}>
                      <Typography variant="caption" noWrap sx={{ maxWidth: 180, color: "text.secondary" }}>
                        {row.cluster}
                      </Typography>
                      <StatusChip size="small" label={`${row.enrichedNamespaces}/${row.totalNamespaces} scanned`} color={namespaceSweepColor(row)} sx={activityChipSx} />
                      {row.neverScannedNamespaces > 0 ? <StatusChip size="small" label={`${row.neverScannedNamespaces} never eligible`} color="warning" variant="outlined" sx={activityChipSx} /> : null}
                      {row.systemNamespacesSkipped > 0 ? <StatusChip size="small" label={`${row.systemNamespacesSkipped} system skipped`} color="default" variant="outlined" sx={activityChipSx} /> : null}
                      {row.staleNamespaces > 0 ? <StatusChip size="small" label={`${row.staleNamespaces} stale`} color="info" variant="outlined" sx={activityChipSx} /> : null}
                      <StatusChip size="small" label={namespaceSweepStateLabel(row)} color={namespaceSweepStateColor(row)} variant="outlined" sx={activityChipSx} />
                    </Box>
                  </Tooltip>
                ))}
              </Box>

              <Box>
                <Typography variant="caption" sx={{ display: "block", fontWeight: 700 }}>
                  Cluster health
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Adaptive background admission
                </Typography>
              </Box>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, alignItems: "center", minWidth: 0 }}>
                {displayHealthRows.length === 0 ? (
                  <Typography variant="caption" color="text.secondary">
                    No scheduler health rows yet.
                  </Typography>
                ) : null}
                {displayHealthRows.map((snapshot) => (
                  <Tooltip key={snapshot.cluster} title={formatSchedulerHealthDetail(snapshot)}>
                    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.35, minWidth: 0, mr: 0.5 }}>
                      <Typography variant="caption" noWrap sx={{ maxWidth: 180, color: "text.secondary" }}>
                        {snapshot.cluster}
                      </Typography>
                      <StatusChip size="small" label={snapshot.state} color={schedulerHealthColor(snapshot.state)} sx={activityChipSx} />
                      <StatusChip
                        size="small"
                        label={`background ${snapshot.backgroundAdmission}`}
                        color={backgroundAdmissionColor(snapshot.backgroundAdmission)}
                        sx={activityChipSx}
                      />
                      {snapshot.lastErrorClass ? (
                        <StatusChip size="small" label={snapshot.lastErrorClass} color="default" variant="outlined" sx={activityChipSx} />
                      ) : null}
                    </Box>
                  </Tooltip>
                ))}
                {limitedHealthCount > 0 ? <StatusChip size="small" label={`${limitedHealthCount} limited`} color="warning" variant="outlined" sx={activityChipSx} /> : null}
                {pausedHealthCount > 0 ? <StatusChip size="small" label={`${pausedHealthCount} paused`} color="error" variant="outlined" sx={activityChipSx} /> : null}
              </Box>
            </Box>
            <Table size="small" stickyHeader sx={compactTableSx}>
              <TableHead>
                <TableRow>
                  <TableCell sx={compactHeaderCellSx}>State</TableCell>
                  <TableCell sx={compactHeaderCellSx}>Cluster</TableCell>
                  <TableCell sx={compactHeaderCellSx}>Kind</TableCell>
                  <TableCell sx={compactHeaderCellSx}>NS</TableCell>
                  <TableCell sx={compactHeaderCellSx}>Pri</TableCell>
                  <TableCell sx={compactHeaderCellSx}>Src</TableCell>
                  <TableCell sx={compactHeaderCellSx} align="right">
                    Queued
                  </TableCell>
                  <TableCell sx={compactHeaderCellSx} align="right">
                    Running
                  </TableCell>
                  <TableCell sx={compactHeaderCellSx}>Key</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {!liveWork && !liveWorkErr ? (
                  <TableRow>
                    <TableCell sx={compactCellSx} colSpan={9}>
                      <EmptyState message="Loading dataplane work…" sx={panelEmptyStateSx} />
                    </TableCell>
                  </TableRow>
                ) : null}
                {liveWork &&
                (liveWork.running?.length ?? 0) + (liveWork.queued?.length ?? 0) === 0 &&
                runningWorkRows.length + queuedWorkRows.length === 0 &&
                !liveWorkErr ? (
                  <TableRow>
                    <TableCell sx={compactCellSx} colSpan={9}>
                      <EmptyState message="No snapshot work running or queued." sx={panelEmptyStateSx} />
                    </TableCell>
                  </TableRow>
                ) : null}
                {runningWorkRows.map((row, i) => (
                  <TableRow key={`r-${row.workKey}-${i}`} data-exiting={row.__exiting ? "true" : undefined} hover>
                    <TableCell sx={compactCellSx}>
                      <StatusChip size="small" label="Running" color={chipColorForValue("running", "status")} sx={activityChipSx} />
                    </TableCell>
                    <TableCell sx={compactCellSx}>
                      <Typography variant="caption" noWrap sx={{ maxWidth: 120, display: "block" }}>
                        {row.cluster}
                      </Typography>
                    </TableCell>
                    <TableCell sx={compactCellSx}>
                      <Typography variant="caption" noWrap>
                        {row.kind}
                      </Typography>
                    </TableCell>
                    <TableCell sx={compactCellSx}>
                      <Typography variant="caption" noWrap sx={{ maxWidth: 88 }}>
                        {row.namespace || "—"}
                      </Typography>
                    </TableCell>
                    <TableCell sx={compactCellSx}>
                      <Typography variant="caption">{row.priority}</Typography>
                    </TableCell>
                    <TableCell sx={compactCellSx}>
                      <Typography variant="caption" noWrap sx={{ maxWidth: 72 }}>
                        {row.source}
                      </Typography>
                    </TableCell>
                    <TableCell sx={compactCellSx} align="right">
                      <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                        {fmtDurationMs(row.waitMs)}
                      </Typography>
                    </TableCell>
                    <TableCell sx={compactCellSx} align="right">
                      <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                        {fmtDurationMs(row.runningMs)}
                      </Typography>
                    </TableCell>
                    <TableCell sx={compactCellSx}>
                      <Tooltip title={row.workKey}>
                        <Typography variant="caption" noWrap sx={{ maxWidth: 160, fontFamily: "monospace" }}>
                          {row.workKey}
                        </Typography>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
                {queuedWorkRows.map((row, i) => (
                  <TableRow key={`q-${row.workKey}-${i}`} data-exiting={row.__exiting ? "true" : undefined} hover>
                    <TableCell sx={compactCellSx}>
                      <StatusChip size="small" label="Queued" color={chipColorForValue("pending", "status")} sx={activityChipSx} />
                    </TableCell>
                    <TableCell sx={compactCellSx}>
                      <Typography variant="caption" noWrap sx={{ maxWidth: 120, display: "block" }}>
                        {row.cluster}
                      </Typography>
                    </TableCell>
                    <TableCell sx={compactCellSx}>
                      <Typography variant="caption" noWrap>
                        {row.kind}
                      </Typography>
                    </TableCell>
                    <TableCell sx={compactCellSx}>
                      <Typography variant="caption" noWrap sx={{ maxWidth: 88 }}>
                        {row.namespace || "—"}
                      </Typography>
                    </TableCell>
                    <TableCell sx={compactCellSx}>
                      <Typography variant="caption">{row.priority}</Typography>
                    </TableCell>
                    <TableCell sx={compactCellSx}>
                      <Typography variant="caption" noWrap sx={{ maxWidth: 72 }}>
                        {row.source}
                      </Typography>
                    </TableCell>
                    <TableCell sx={compactCellSx} align="right">
                      <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                        {fmtDurationMs(row.waitMs)}
                      </Typography>
                    </TableCell>
                    <TableCell sx={compactCellSx} align="right">
                      <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                        —
                      </Typography>
                    </TableCell>
                    <TableCell sx={compactCellSx}>
                      <Tooltip title={row.workKey}>
                        <Typography variant="caption" noWrap sx={{ maxWidth: 160, fontFamily: "monospace" }}>
                          {row.workKey}
                        </Typography>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Box>
      <Box sx={{ display: tab === 2 ? "flex" : "none", flex: 1, minHeight: 0, flexDirection: "column", gap: 0.75 }}>
        {openTerminalIds.length > 0 && (
          <Box
            sx={{
              flexShrink: 0,
              border: "1px solid var(--border-subtle)",
              borderRadius: 1,
              bgcolor: "var(--bg-primary)",
            }}
          >
            <Tabs
              value={activeTerminalId && openTerminalIds.includes(activeTerminalId) ? openTerminalIds.indexOf(activeTerminalId) : false}
              onChange={(_, idx) => {
                const next = openTerminalIds[idx] || null;
                if (!next) return;
                setActiveTerminalId(next);
                setFocusNonce((n) => n + 1);
              }}
              variant="scrollable"
              scrollButtons="auto"
              sx={{ minHeight: 30, "& .MuiTab-root": { minHeight: 30, textTransform: "none", py: 0 } }}
            >
              {openTerminalIds.map((id) => {
                const info = sessionsById.get(id) || terminalInfoCacheRef.current.get(id);
                const label = info?.targetContainer || info?.title || id;
                return (
                  <Tab
                    key={id}
                    label={
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                        <Typography variant="caption" sx={{ maxWidth: 220 }} noWrap>
                          {label}
                        </Typography>
                        {info?.status ? (
                          <StatusChip size="small" label={info.status} color={chipColorForValue(info.status, "status")} sx={activityChipSx} />
                        ) : null}
                        <AppIconButton
                          tooltip="Close terminal"
                          label="Close terminal"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            window.dispatchEvent(new CustomEvent("kview-terminal-close-request", { detail: { id } }));
                          }}
                        >
                          <CloseIcon sx={{ fontSize: 14 }} />
                        </AppIconButton>
                      </Box>
                    }
                  />
                );
              })}
            </Tabs>
          </Box>
        )}

        <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          {openTerminalIds.length === 0 ? (
            <EmptyState message="No open terminal sessions." sx={panelEmptyStateSx} />
          ) : (
            openTerminalIds.map((id) => (
              <Box key={id} sx={{ display: id === activeTerminalId ? "block" : "none", height: "100%" }}>
                <TerminalSessionView
                  id={id}
                  token={token}
                  session={sessionsById.get(id) || terminalInfoCacheRef.current.get(id)}
                  active={id === activeTerminalId}
                  focusNonce={focusNonce}
                  onClose={() => {
                    void terminateSession(id);
                  }}
                />
              </Box>
            ))
          )}
        </Box>
        {!sessionsLoading && sessionsErr && (
          <Typography variant="caption" color="error">
            Unable to refresh terminal sessions.
          </Typography>
        )}
      </Box>
      <Box sx={{ display: tab === 3 ? "flex" : "none", flex: 1, minHeight: 0, overflow: "hidden", flexDirection: "column" }}>
        <Box sx={compactTableContainerSx}>
          {sessionsLoading ? (
            <EmptyState message="Loading port forwards..." sx={panelEmptyStateSx} />
          ) : sessionsErr ? (
            <EmptyState message="Unable to load port forwards." sx={panelEmptyStateSx} />
          ) : portForwardSessions.length === 0 ? (
            <EmptyState message="No active port forwards." sx={panelEmptyStateSx} />
          ) : (
            <Table size="small" stickyHeader sx={compactTableSx}>
              <TableHead>
                <TableRow>
                  <TableCell sx={compactHeaderCellSx}>ID</TableCell>
                  <TableCell sx={compactHeaderCellSx}>Local</TableCell>
                  <TableCell sx={compactHeaderCellSx}>Remote</TableCell>
                  <TableCell sx={compactHeaderCellSx}>Service</TableCell>
                  <TableCell sx={compactHeaderCellSx}>Pod</TableCell>
                  <TableCell sx={compactHeaderCellSx} align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {portForwardSessions.map((session) => {
                  const targetKind = session.metadata?.targetKind || "pod";
                  const localHost = session.metadata?.localHost || "127.0.0.1";
                  const localPort = session.metadata?.localPort || "";
                  const remotePort = session.metadata?.remotePort || "";
                  const service =
                    session.metadata?.targetService ||
                    session.metadata?.service ||
                    (targetKind === "service" ? session.targetResource : "") ||
                    "-";
                  const pod = session.metadata?.pod || (targetKind === "pod" ? session.targetResource || "-" : "-");
                  const url = localPort ? `http://${localHost}:${localPort}` : "";
                  return (
                    <TableRow key={session.id} hover>
                      <TableCell sx={compactCellSx}>
                        <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                          {session.id}
                        </Typography>
                      </TableCell>
                      <TableCell sx={compactCellSx}>
                        <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                          {localPort ? `${localHost}:${localPort}` : "-"}
                        </Typography>
                      </TableCell>
                      <TableCell sx={compactCellSx}>
                        <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                          {remotePort || "-"}
                        </Typography>
                      </TableCell>
                      <TableCell sx={compactCellSx}>
                        <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                          {service}
                        </Typography>
                      </TableCell>
                      <TableCell sx={compactCellSx}>
                        <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                          {pod}
                        </Typography>
                      </TableCell>
                      <TableCell sx={compactCellSx} align="right">
                        <AppIconButton
                          tooltip={url || "Local endpoint not available"}
                          label="Open forwarded endpoint"
                          disabled={!url}
                          onClick={() => {
                            if (!url) return;
                            window.open(url, "_blank", "noopener,noreferrer");
                          }}
                        >
                          <OpenInNewIcon fontSize="small" />
                        </AppIconButton>
                        <AppIconButton
                          tooltip="Stop port forward"
                          label="Stop port forward"
                          onClick={() => {
                            void terminateSession(session.id);
                          }}
                        >
                          <CloseIcon fontSize="small" />
                        </AppIconButton>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Box>
      </Box>
      <Box sx={{ display: tab === 4 ? "flex" : "none", flex: 1, minHeight: 0, overflow: "hidden", flexDirection: "column" }}>
        {logsErr && logs.length === 0 && !logsLoading ? (
          <EmptyState message="Unable to load runtime logs." sx={panelEmptyStateSx} />
        ) : (
          <TableContainer
            ref={logsScrollRef}
            sx={compactTableContainerSx}
            onScroll={(e) => {
              const node = e.currentTarget;
              const distanceToBottom = node.scrollHeight - node.clientHeight - node.scrollTop;
              logsStickToBottomRef.current = distanceToBottom <= 24;
            }}
          >
            <Table size="small" stickyHeader sx={compactTableSx}>
              <TableHead>
                <TableRow>
                  <TableCell sx={compactHeaderCellSx}>Time</TableCell>
                  <TableCell sx={compactHeaderCellSx}>Level</TableCell>
                  <TableCell sx={compactHeaderCellSx}>Source</TableCell>
                  <TableCell sx={compactHeaderCellSx}>Message</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {logs.length === 0 ? (
                  <TableRow>
                    <TableCell sx={compactCellSx} colSpan={4}>
                      <EmptyState message={logsLoading ? "Loading runtime logs..." : "No runtime logs yet."} sx={panelEmptyStateSx} />
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => (
                    <TableRow key={log.id} hover>
                      <TableCell sx={compactCellSx}>
                        <Typography variant="caption" sx={{ color: "text.secondary", fontFamily: "monospace" }}>
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </Typography>
                      </TableCell>
                      <TableCell sx={compactCellSx}>
                        <StatusChip label={log.level} size="small" color={chipColorForValue(log.level, "level")} sx={activityChipSx} />
                      </TableCell>
                      <TableCell sx={compactCellSx}>
                        <Typography variant="caption" sx={{ color: "text.secondary", fontFamily: "monospace" }}>
                          {log.source}
                        </Typography>
                      </TableCell>
                      <TableCell sx={compactCellSx}>
                        <Typography variant="caption" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                          {log.message}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>
    </Box>
  );
}
