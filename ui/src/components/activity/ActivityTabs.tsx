import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Chip,
  IconButton,
  Tabs,
  Tab,
  Typography,
  Table,
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
import { apiGet } from "../../api";
import TerminalSessionView from "./TerminalSessionView";
import { apiDelete } from "../../sessionsApi";

type Props = {
  tab: number;
  token: string;
  requestedTerminalId?: string | null;
  requestedTerminalRequestKey?: number;
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
    if (tab !== 0) return;
    reloadActivities();
    const id = window.setInterval(reloadActivities, 5000);
    return () => window.clearInterval(id);
  }, [tab, reloadActivities]);

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
    if (tab !== 1 && tab !== 2) return;
    reloadSessions();
    const id = window.setInterval(reloadSessions, 5000);
    return () => window.clearInterval(id);
  }, [tab, reloadSessions]);

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
  const portForwardSessions = useMemo(() => sessions.filter((s) => s.type === "portforward"), [sessions]);

  const terminateSession = async (id: string) => {
    await apiDelete(`/api/sessions/${encodeURIComponent(id)}`, token);
    setOpenTerminalIds((prev) => prev.filter((item) => item !== id));
    setActiveTerminalId((prev) => (prev === id ? null : prev));
    reloadSessions();
    reloadActivities();
  };

  useEffect(() => {
    if (tab !== 3) return;

    const loadOnce = () => {
      setLogsLoading(true);
      setLogsErr(null);
      apiGet<{ items: ActivityLogEntry[] }>("/api/activity/runtime/logs", token)
        .then((res) => {
          setLogs(res.items || []);
        })
        .catch((e) => {
          setLogsErr(String(e));
        })
        .finally(() => setLogsLoading(false));
    };

    loadOnce();
    const id = window.setInterval(loadOnce, 5000);
    return () => window.clearInterval(id);
  }, [tab, token]);

  useEffect(() => {
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
    node.scrollTop = node.scrollHeight;
  }, [logs, tab]);

  return (
    <Box sx={{ flexGrow: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Box sx={{ display: tab === 0 ? "block" : "none", flex: 1, minHeight: 0, overflow: "auto" }}>
        <ActivityList items={activities} loading={loading} error={err || undefined} />
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
                const info = sessionsById.get(id);
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
                          <Chip size="small" label={info.status} sx={{ height: 16, fontSize: "0.55rem", textTransform: "uppercase" }} />
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
            <EmptyState message="Open a terminal session from Pod actions." />
          ) : (
            openTerminalIds.map((id) => (
              <Box key={id} sx={{ display: id === activeTerminalId ? "block" : "none", height: "100%" }}>
                <TerminalSessionView
                  id={id}
                  token={token}
                  session={sessionsById.get(id)}
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
      <Box sx={{ display: tab === 2 ? "block" : "none", flex: 1, minHeight: 0, overflow: "auto" }}>
        <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", border: "1px solid var(--border-subtle)", borderRadius: 1 }}>
          {sessionsLoading ? (
            <EmptyState message="Loading port forwards..." />
          ) : sessionsErr ? (
            <EmptyState message="Unable to refresh port forwards." />
          ) : portForwardSessions.length === 0 ? (
            <EmptyState message="No active port forwards." />
          ) : (
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Local</TableCell>
                  <TableCell>Remote</TableCell>
                  <TableCell>Service</TableCell>
                  <TableCell>Pod</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {portForwardSessions.map((session) => {
                  const localHost = session.metadata?.localHost || "127.0.0.1";
                  const localPort = session.metadata?.localPort || "";
                  const remotePort = session.metadata?.remotePort || "";
                  const service =
                    session.metadata?.targetService ||
                    session.metadata?.service ||
                    session.metadata?.targetResource ||
                    "-";
                  const pod = session.targetResource || session.metadata?.pod || "-";
                  const url = localPort ? `http://${localHost}:${localPort}` : "";
                  return (
                    <TableRow key={session.id} hover>
                      <TableCell>
                        <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                          {localPort ? `${localHost}:${localPort}` : "-"}
                        </Typography>
                      </TableCell>
                      <TableCell>{remotePort || "-"}</TableCell>
                      <TableCell>{service}</TableCell>
                      <TableCell>{pod}</TableCell>
                      <TableCell align="right">
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
      <Box sx={{ display: tab === 3 ? "block" : "none", flex: 1, minHeight: 0, overflow: "auto" }}>
        <Box ref={logsScrollRef} sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {logsLoading && <EmptyState message="Loading runtime logs…" />}
          {!logsLoading && logsErr && <EmptyState message="Failed to load runtime logs." />}
          {!logsLoading && !logsErr && logs.length === 0 && <EmptyState message="No runtime logs yet." />}
          {!logsLoading && !logsErr && logs.length > 0 && (
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: 0.5,
                fontFamily: "monospace",
                fontSize: "0.75rem",
                py: 0.5,
              }}
            >
              {logs.map((log) => (
                <Box
                  key={log.id}
                  sx={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 1,
                    px: 1,
                    py: 0.25,
                    borderBottom: "1px solid var(--border-subtle)",
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{ color: "text.secondary", minWidth: 150, flexShrink: 0 }}
                  >
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </Typography>
                  <Chip
                    label={log.level.toUpperCase()}
                    size="small"
                    color={log.level === "error" ? "error" : log.level === "warn" ? "warning" : "default"}
                    sx={{ height: 18, fontSize: "0.6rem" }}
                  />
                  <Typography
                    variant="caption"
                    sx={{ color: "text.secondary", minWidth: 80, flexShrink: 0 }}
                  >
                    {log.source}
                  </Typography>
                  <Typography variant="caption" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word", flexGrow: 1 }}>
                    {log.message}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

