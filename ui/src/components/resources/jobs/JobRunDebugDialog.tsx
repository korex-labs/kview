import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import { apiPostWithContext } from "../../../api";
import { useActiveContext } from "../../../activeContext";

type SourceKind = "Job" | "CronJob";

export type DebugSession = {
  id: string;
  context: string;
  namespace: string;
  jobName?: string;
};

type DebugRecord = {
  type: "status" | "event" | "log" | "pod";
  timestamp: number;
  level?: string;
  phase?: string;
  message?: string;
  jobName?: string;
  pod?: string;
  container?: string;
  line?: string;
  eventType?: string;
  reason?: string;
  involvedKind?: string;
  involvedName?: string;
};

function wsURL(path: string, token: string) {
  const u = new URL(window.location.href);
  const proto = u.protocol === "https:" ? "wss:" : "ws:";
  const sep = path.includes("?") ? "&" : "?";
  return `${proto}//${u.host}${path}${sep}token=${encodeURIComponent(token)}`;
}

function fmtTs(ts: number) {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleTimeString();
}

export default function JobRunDebugDialog({
  open,
  onClose,
  token,
  namespace,
  sourceKind,
  sourceName,
  session: providedSession,
  onStarted,
}: {
  open: boolean;
  onClose: () => void;
  token: string;
  namespace: string;
  sourceKind: SourceKind;
  sourceName: string;
  session?: DebugSession | null;
  onStarted?: (jobName: string) => void;
}) {
  const activeContext = useActiveContext();
  const [session, setSession] = useState<DebugSession | null>(null);
  const [records, setRecords] = useState<DebugRecord[]>([]);
  const [error, setError] = useState("");
  const [tab, setTab] = useState(0);
  const [stopping, setStopping] = useState(false);
  const [stopArmed, setStopArmed] = useState(false);
  const startedRef = useRef(false);
  const outputRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || !activeContext || startedRef.current) return;
    startedRef.current = true;
    setSession(providedSession ?? null);
    setRecords([]);
    setError("");
    setTab(0);
    setStopping(false);
    setStopArmed(false);

    let ws: WebSocket | null = null;
    let sessionID = providedSession?.id ?? "";
    let cancelled = false;

    const connect = (started: DebugSession) => {
      sessionID = started.id;
      setSession(started);
      if (started.jobName) onStarted?.(started.jobName);
      ws = new WebSocket(wsURL(`/api/job-runs/${encodeURIComponent(started.id)}/ws`, token));
      ws.onmessage = (event) => {
        try {
          const rec = JSON.parse(String(event.data)) as DebugRecord;
          setRecords((prev) => [...prev, rec]);
          if (rec.jobName) onStarted?.(rec.jobName);
        } catch {
          // Ignore malformed stream records; the connection itself remains useful.
        }
      };
      ws.onerror = () => setError("Debug stream connection failed.");
    };

    const start = async () => {
      if (providedSession) {
        connect(providedSession);
        return;
      }
      if (!sourceName) return;
      const started = await apiPostWithContext<DebugSession>(
        `/api/namespaces/${encodeURIComponent(namespace)}/job-runs/debug`,
        token,
        activeContext,
        { kind: sourceKind, name: sourceName },
      );
      if (cancelled) return;
      connect(started);
    };

    start().catch((e) => setError((e as Error | undefined)?.message || "Failed to start debug run."));

    return () => {
      cancelled = true;
      ws?.close();
      if (sessionID) {
        void fetch(`/api/job-runs/${encodeURIComponent(sessionID)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    };
  }, [activeContext, namespace, onStarted, open, providedSession, sourceKind, sourceName, token]);

  useEffect(() => {
    if (open) return;
    startedRef.current = false;
  }, [open]);

  const latestPhase = useMemo(() => {
    const status = [...records].reverse().find((r) => r.type === "status" && r.phase);
    return status?.phase || (session ? "waiting" : "creating");
  }, [records, session]);

  const logs = records.filter((r) => r.type === "log");
  const events = records.filter((r) => r.type === "event");
  const timeline = records.filter((r) => r.type !== "log");
  const canStop = !!session?.id && !["succeeded", "failed", "stopped"].includes(latestPhase);

  useEffect(() => {
    const el = outputRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [records.length, tab]);

  async function stopRun() {
    if (!session?.id || !activeContext || stopping) return;
    if (!stopArmed) {
      setStopArmed(true);
      return;
    }
    setStopping(true);
    try {
      await apiPostWithContext(`/api/job-runs/${encodeURIComponent(session.id)}/stop`, token, activeContext, {});
    } catch (e) {
      setError((e as Error | undefined)?.message || "Failed to stop debug run.");
      setStopping(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <span>Debug {sourceKind} run</span>
          <Chip size="small" label={latestPhase} color={latestPhase === "failed" ? "error" : latestPhase === "succeeded" ? "success" : "default"} />
          {session?.jobName && <Chip size="small" label={session.jobName} variant="outlined" />}
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {namespace}/{sourceName}
        </Typography>
      </DialogTitle>
      <DialogContent dividers sx={{ minHeight: 520 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {!session && !error && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">Starting debug run...</Typography>
          </Box>
        )}
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
          <Tab label={`Timeline (${timeline.length})`} />
          <Tab label={`Logs (${logs.length})`} />
          <Tab label={`Events (${events.length})`} />
        </Tabs>
        <Divider sx={{ mb: 2 }} />
        <Box
          ref={outputRef}
          sx={{
            height: 390,
            overflow: "auto",
            bgcolor: "background.default",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
            p: 1.5,
            fontFamily: "monospace",
            fontSize: "0.82rem",
            whiteSpace: "pre-wrap",
          }}
        >
          {tab === 0 && (timeline.length === 0 ? "Waiting for status..." : timeline.map((r, i) => (
            <Box key={i} sx={{ color: r.level === "error" ? "error.main" : r.level === "warning" ? "warning.main" : "text.primary" }}>
              [{fmtTs(r.timestamp)}] {r.type}{r.phase ? `/${r.phase}` : ""}{r.pod ? ` ${r.pod}` : ""}{r.container ? `/${r.container}` : ""}{r.reason ? ` ${r.reason}` : ""} {r.message || r.line || ""}
            </Box>
          )))}
          {tab === 1 && (logs.length === 0 ? "Waiting for container logs..." : logs.map((r, i) => (
            <Box key={i}>[{fmtTs(r.timestamp)}] {r.pod}/{r.container}: {r.line}</Box>
          )))}
          {tab === 2 && (events.length === 0 ? "Waiting for events..." : events.map((r, i) => (
            <Box key={i} sx={{ color: String(r.eventType).toLowerCase() === "warning" ? "warning.main" : "text.primary" }}>
              [{fmtTs(r.timestamp)}] {r.eventType} {r.involvedKind}/{r.involvedName} {r.reason}: {r.message}
            </Box>
          )))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button
          color="error"
          variant={stopArmed ? "contained" : "outlined"}
          startIcon={<StopCircleIcon />}
          onClick={stopRun}
          disabled={!canStop || stopping}
        >
          {stopping ? "Stopping..." : stopArmed ? "Confirm stop job" : "Stop job"}
        </Button>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
