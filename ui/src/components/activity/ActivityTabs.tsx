import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Chip,
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
import { apiGet, toApiError } from "../../api";
import TerminalSessionView from "./TerminalSessionView";
import { apiDelete } from "../../sessionsApi";
import { emitFocusLogsTab, emitOpenTerminalSession } from "../../activityEvents";
import {
  chipSxForValue,
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
  onCountsChange?: (counts: { activities: number; terminals: number; portForwards: number }) => void;
};

type Activity = {
  id: string;
  kind: string;
  type: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

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

export default function ActivityTabs({
  tab,
  token,
  requestedTerminalId,
  requestedTerminalRequestKey,
  onCountsChange,
}: Props) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsErr, setLogsErr] = useState<string | null>(null);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsErr, setSessionsErr] = useState<string | null>(null);

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
    setLoading(true);
    setErr(null);
    apiGet<{ items: Activity[] }>("/api/activity", token)
      .then((res) => {
        setActivities(res.items || []);
      })
      .catch((e) => {
        // For Phase 1 keep error handling simple; Activity Panel is additive.
        setErr(String(e));
      })
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    reloadActivities();
    const id = window.setInterval(reloadActivities, 5000);
    return () => window.clearInterval(id);
  }, [reloadActivities]);

  const reloadSessions = useCallback(() => {
    setSessionsLoading(true);
    setSessionsErr(null);
    apiGet<{ items: Session[] }>("/api/sessions", token)
      .then((res) => {
        setSessions(res.items || []);
      })
      .catch((e) => {
        setSessionsErr(String(e));
      })
      .finally(() => setSessionsLoading(false));
  }, [token]);

  useEffect(() => {
    reloadSessions();
    const id = window.setInterval(reloadSessions, 5000);
    return () => window.clearInterval(id);
  }, [reloadSessions]);

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
    if (tab !== 3) return;

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
          setLogsErr(String(e));
        })
        .finally(() => setLogsLoading(false));
    };

    loadOnce();
    const id = window.setInterval(loadOnce, 5000);
    return () => window.clearInterval(id);
  }, [tab, token, mergeRuntimeLogs]);

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
    if (tab !== 3) return;
    const node = logsScrollRef.current;
    if (!node) return;
    if (logsStickToBottomRef.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [logs, tab]);

  useEffect(() => {
    onCountsChange?.({
      activities: activities.length,
      terminals: openTerminalIds.length,
      portForwards: portForwardSessions.length,
    });
  }, [activities.length, openTerminalIds.length, portForwardSessions.length, onCountsChange]);

  return (
    <Box sx={{ flexGrow: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Box sx={{ display: tab === 0 ? "flex" : "none", flex: 1, minHeight: 0, overflow: "hidden", flexDirection: "column" }}>
        <ActivityList
          items={activities}
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
      <Box sx={{ display: tab === 1 ? "flex" : "none", flex: 1, minHeight: 0, flexDirection: "column", gap: 0.75 }}>
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
                          <Chip size="small" label={info.status} sx={chipSxForValue(info.status, "status")} />
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
      <Box sx={{ display: tab === 2 ? "flex" : "none", flex: 1, minHeight: 0, overflow: "hidden", flexDirection: "column" }}>
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
      <Box sx={{ display: tab === 3 ? "flex" : "none", flex: 1, minHeight: 0, overflow: "hidden", flexDirection: "column" }}>
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
                        <Chip label={log.level.toUpperCase()} size="small" sx={chipSxForValue(log.level, "level")} />
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

