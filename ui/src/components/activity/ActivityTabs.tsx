import React, { useEffect, useState } from "react";
import { Box, Chip, Typography } from "@mui/material";
import ActivityList from "./ActivityList";
import EmptyState from "../shared/EmptyState";
import { apiGet } from "../../api";
import SessionList from "./SessionList";

type Props = {
  tab: number;
  token: string;
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
};

export default function ActivityTabs({ tab, token }: Props) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsErr, setLogsErr] = useState<string | null>(null);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsErr, setSessionsErr] = useState<string | null>(null);

  useEffect(() => {
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
  }, []);

  const reloadSessions = () => {
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
  };

  useEffect(() => {
    if (tab !== 1) return;
    reloadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (tab !== 2) return;
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
  }, [tab]);

  return (
    <Box sx={{ flexGrow: 1, minHeight: 0, overflow: "auto" }}>
      {tab === 0 && <ActivityList items={activities} loading={loading} error={err || undefined} />}
      {tab === 1 && (
        <SessionList
          items={sessions}
          loading={sessionsLoading}
          error={sessionsErr || undefined}
          token={token}
          onChange={reloadSessions}
        />
      )}
      {tab === 2 && (
        <>
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
        </>
      )}
    </Box>
  );
}

