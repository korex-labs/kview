import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  IconButton,
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
import KeyValueChip from "../shared/KeyValueChip";
import StatusChip from "../shared/StatusChip";
import { apiGet, toApiError } from "../../api";
import TerminalSessionView from "./TerminalSessionView";
import { apiDelete } from "../../sessionsApi";
import { emitFocusLogsTab, emitOpenTerminalSession } from "../../activityEvents";
import { useConnectionState } from "../../connectionState";
import { fmtDurationMs } from "../../utils/format";
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

type LiveWork = {
  maxSlotsPerCluster: number;
  running: LiveWorkRow[];
  queued: LiveWorkRow[];
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

export default function ActivityTabs({
  tab,
  token,
  requestedTerminalId,
  requestedTerminalRequestKey,
  onCountsChange,
}: Props) {
  const { health } = useConnectionState();
  const offline = health === "unhealthy";
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
    apiGet<{ items: Activity[] }>("/api/activity", token)
      .then((res) => {
        setActivities(res.items || []);
      })
      .catch((e) => {
        // Keep stale activity rows visible while retrying in background.
        if (activities.length === 0) setErr(String(e));
      })
      .finally(() => setLoading(false));
  }, [activities.length, offline, token]);

  useEffect(() => {
    if (offline) return;
    reloadActivities();
    const id = window.setInterval(reloadActivities, 5000);
    return () => window.clearInterval(id);
  }, [offline, reloadActivities]);

  const reloadLiveWork = useCallback(() => {
    if (offline) return;
    setLiveWorkErr(null);
    apiGet<LiveWork>("/api/dataplane/work/live", token)
      .then((res) => {
        setLiveWork(res);
      })
      .catch((e) => {
        if (!liveWork) setLiveWorkErr(String(e));
      });
  }, [liveWork, offline, token]);

  useEffect(() => {
    if (offline) return;
    reloadLiveWork();
    const id = window.setInterval(reloadLiveWork, 3000);
    return () => window.clearInterval(id);
  }, [offline, reloadLiveWork]);

  const reloadSessions = useCallback(() => {
    if (offline) return;
    setSessionsLoading(true);
    setSessionsErr(null);
    apiGet<{ items: Session[] }>("/api/sessions", token)
      .then((res) => {
        setSessions(res.items || []);
      })
      .catch((e) => {
        if (sessions.length === 0) setSessionsErr(String(e));
      })
      .finally(() => setSessionsLoading(false));
  }, [offline, sessions.length, token]);

  useEffect(() => {
    if (offline) return;
    reloadSessions();
    const id = window.setInterval(reloadSessions, 5000);
    return () => window.clearInterval(id);
  }, [offline, reloadSessions]);

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
    if (tab !== 4) return;
    if (offline) return;

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
          if (logs.length === 0) setLogsErr(String(e));
        })
        .finally(() => setLogsLoading(false));
    };

    loadOnce();
    const id = window.setInterval(loadOnce, 5000);
    return () => window.clearInterval(id);
  }, [tab, offline, token, mergeRuntimeLogs, logs.length]);

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
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, px: 0.5, py: 0.5 }}>
              <KeyValueChip chipKey="slots/cluster" value={String(liveWork?.maxSlotsPerCluster ?? "-")} color="primary" maxKeyLen={16} />
              <KeyValueChip chipKey="running" value={String(liveWork?.running?.length ?? 0)} color="success" />
              <KeyValueChip chipKey="queued" value={String(liveWork?.queued?.length ?? 0)} color="info" />
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
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void terminateSession(id);
                          }}
                        >
                          <CloseIcon sx={{ fontSize: 14 }} />
                        </IconButton>
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
                        <Tooltip title={url || "Local endpoint not available"}>
                          <span>
                            <IconButton
                              size="small"
                              disabled={!url}
                              onClick={() => {
                                if (!url) return;
                                window.open(url, "_blank", "noopener,noreferrer");
                              }}
                            >
                              <OpenInNewIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <IconButton
                          size="small"
                          onClick={() => {
                            void terminateSession(session.id);
                          }}
                        >
                          <CloseIcon fontSize="small" />
                        </IconButton>
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
