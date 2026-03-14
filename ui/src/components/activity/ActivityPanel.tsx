import React, { useEffect, useState } from "react";
import { Box, Tabs, Tab, IconButton } from "@mui/material";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ActivityTabs from "./ActivityTabs";
import {
  FOCUS_LOGS_TAB_EVENT,
  FOCUS_PORT_FORWARDS_TAB_EVENT,
  OPEN_TERMINAL_SESSION_EVENT,
  type OpenTerminalSessionEventDetail,
} from "../../activityEvents";

type Props = {
  token: string;
};

const MIN_PANEL_HEIGHT = 160;
const MAX_PANEL_HEIGHT = 630;
const HEADER_HEIGHT = 28;

export default function ActivityPanel({ token }: Props) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState(0);
  const [height, setHeight] = useState(230);
  const [dragging, setDragging] = useState(false);
  const [requestedTerminalId, setRequestedTerminalId] = useState<string | null>(null);
  const [requestKey, setRequestKey] = useState(0);
  const [tabCounts, setTabCounts] = useState({ activities: 0, terminals: 0, portForwards: 0 });

  useEffect(() => {
    const offset = open ? `${HEADER_HEIGHT + height}px` : `${HEADER_HEIGHT}px`;
    document.documentElement.style.setProperty("--bottom-panel-offset", offset);
  }, [open, height]);

  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: MouseEvent) => {
      const available = window.innerHeight - e.clientY;
      const next = Math.min(
        MAX_PANEL_HEIGHT,
        Math.max(MIN_PANEL_HEIGHT, available - 0) // panel is anchored to bottom
      );
      setHeight(next);
    };

    const onUp = () => {
      setDragging(false);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  useEffect(() => {
    const onOpenTerminal = (event: Event) => {
      const custom = event as CustomEvent<OpenTerminalSessionEventDetail>;
      const sessionId = custom.detail?.sessionId;
      if (!sessionId) return;
      setRequestedTerminalId(sessionId);
      setRequestKey((v) => v + 1);
      setOpen(true);
      setTab(1);
    };
    window.addEventListener(OPEN_TERMINAL_SESSION_EVENT, onOpenTerminal as EventListener);
    return () => {
      window.removeEventListener(OPEN_TERMINAL_SESSION_EVENT, onOpenTerminal as EventListener);
    };
  }, []);

  useEffect(() => {
    const onFocusPortForwards = () => {
      setOpen(true);
      setTab(2);
    };
    window.addEventListener(FOCUS_PORT_FORWARDS_TAB_EVENT, onFocusPortForwards);
    return () => {
      window.removeEventListener(FOCUS_PORT_FORWARDS_TAB_EVENT, onFocusPortForwards);
    };
  }, []);

  useEffect(() => {
    const onFocusLogs = () => {
      setOpen(true);
      setTab(3);
    };
    window.addEventListener(FOCUS_LOGS_TAB_EVENT, onFocusLogs);
    return () => {
      window.removeEventListener(FOCUS_LOGS_TAB_EVENT, onFocusLogs);
    };
  }, []);

  return (
    <Box
      sx={{
        position: "fixed",
        // Align with main content area, not covering the permanent sidebar.
        left: 320,
        right: 0,
        bottom: 0,
        borderTop: "1px solid var(--border-subtle)",
        bgcolor: "var(--bg-elevated)",
        color: "var(--text-primary)",
        // Keep the panel above drawers and main content.
        zIndex: 1400,
      }}
    >
      {open && (
        <Box
          sx={{
            height: 5,
            cursor: "ns-resize",
            "&:hover": { bgcolor: "rgba(255,255,255,0.06)" },
          }}
          onMouseDown={() => setDragging(true)}
        />
      )}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          px: 1,
          py: 0.25,
          borderBottom: open ? "1px solid var(--border-subtle)" : "none",
          bgcolor: "var(--bg-primary)",
          backdropFilter: "blur(10px)",
          boxShadow: "0 -2px 8px rgba(0, 0, 0, 0.16)",
          displayPrint: "none",
        }}
      >
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{ minHeight: HEADER_HEIGHT, "& .MuiTab-root": { minHeight: HEADER_HEIGHT, py: 0 } }}
        >
          <Tab label={`Activities (${tabCounts.activities})`} />
          <Tab label={`Terminals (${tabCounts.terminals})`} />
          <Tab label={`Port Forwards (${tabCounts.portForwards})`} />
          <Tab label="Logs" />
        </Tabs>
        <Box sx={{ flexGrow: 1 }} />
        <IconButton size="small" onClick={() => setOpen((v) => !v)}>
          {open ? <ExpandMoreIcon fontSize="small" /> : <ExpandLessIcon fontSize="small" />}
        </IconButton>
      </Box>
      <Box
        sx={{
          height: open ? height : 0,
          px: 1,
          py: open ? 0.75 : 0,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
          visibility: open ? "visible" : "hidden",
          pointerEvents: open ? "auto" : "none",
        }}
      >
        <ActivityTabs
          tab={tab}
          token={token}
          requestedTerminalId={requestedTerminalId}
          requestedTerminalRequestKey={requestKey}
          onCountsChange={setTabCounts}
        />
      </Box>
    </Box>
  );
}

