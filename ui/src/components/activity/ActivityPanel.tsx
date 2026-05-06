import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Tabs, Tab, IconButton, Tooltip, Typography } from "@mui/material";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ActivityTabs from "./ActivityTabs";
import {
  FOCUS_LOGS_TAB_EVENT,
  FOCUS_ACTIVITY_PANEL_TAB_EVENT,
  FOCUS_PORT_FORWARDS_TAB_EVENT,
  OPEN_TERMINAL_SESSION_EVENT,
  TOGGLE_ACTIVITY_PANEL_EVENT,
  type FocusActivityPanelTabEventDetail,
  type OpenTerminalSessionEventDetail,
} from "../../activityEvents";
import { useConnectionState } from "../../connectionState";

type Props = {
  token: string;
  covered?: boolean;
  initialOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const MIN_PANEL_HEIGHT = 160;
const MAX_PANEL_HEIGHT = 630;
const HEADER_HEIGHT = 28;

export default function ActivityPanel({ token, covered = false, initialOpen = true, onOpenChange }: Props) {
  const { backendHealth, clusterHealth, cluster } = useConnectionState();
  const effectiveClusterHealth = backendHealth === "healthy" && clusterHealth === "healthy" ? "healthy" : "unhealthy";
  const [open, setOpen] = useState(() => initialOpen);
  const [tab, setTab] = useState(0);
  const [height, setHeight] = useState(230);
  const [dragging, setDragging] = useState(false);
  const [requestedTerminalId, setRequestedTerminalId] = useState<string | null>(null);
  const [requestKey, setRequestKey] = useState(0);
  const didMountRef = useRef(false);
  const [tabCounts, setTabCounts] = useState({
    activities: 0,
    dataplaneWork: 0,
    terminals: 0,
    portForwards: 0,
  });

  const updateOpen = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    setOpen(next);
  }, []);

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    onOpenChange?.(open);
  }, [onOpenChange, open]);

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
      updateOpen(true);
      setTab(2);
    };
    window.addEventListener(OPEN_TERMINAL_SESSION_EVENT, onOpenTerminal as EventListener);
    return () => {
      window.removeEventListener(OPEN_TERMINAL_SESSION_EVENT, onOpenTerminal as EventListener);
    };
  }, [updateOpen]);

  useEffect(() => {
    const onFocusPortForwards = () => {
      updateOpen(true);
      setTab(3);
    };
    window.addEventListener(FOCUS_PORT_FORWARDS_TAB_EVENT, onFocusPortForwards);
    return () => {
      window.removeEventListener(FOCUS_PORT_FORWARDS_TAB_EVENT, onFocusPortForwards);
    };
  }, [updateOpen]);

  useEffect(() => {
    const onFocusLogs = () => {
      updateOpen(true);
      setTab(4);
    };
    window.addEventListener(FOCUS_LOGS_TAB_EVENT, onFocusLogs);
    return () => {
      window.removeEventListener(FOCUS_LOGS_TAB_EVENT, onFocusLogs);
    };
  }, [updateOpen]);

  useEffect(() => {
    const onTogglePanel = () => updateOpen((v) => !v);
    const onFocusActivityTab = (event: Event) => {
      const custom = event as CustomEvent<FocusActivityPanelTabEventDetail>;
      const nextTab = custom.detail?.tab;
      if (typeof nextTab !== "number" || nextTab < 0 || nextTab > 4) return;
      updateOpen(true);
      setTab(nextTab);
    };
    window.addEventListener(TOGGLE_ACTIVITY_PANEL_EVENT, onTogglePanel);
    window.addEventListener(FOCUS_ACTIVITY_PANEL_TAB_EVENT, onFocusActivityTab as EventListener);
    return () => {
      window.removeEventListener(TOGGLE_ACTIVITY_PANEL_EVENT, onTogglePanel);
      window.removeEventListener(FOCUS_ACTIVITY_PANEL_TAB_EVENT, onFocusActivityTab as EventListener);
    };
  }, [updateOpen]);

  return (
    <Box
      data-testid="activity-panel"
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
        zIndex: covered ? 1100 : 1400,
      }}
    >
      {open && (
        <Box
          sx={{
            height: 5,
            cursor: "ns-resize",
            "&:hover": { bgcolor: "action.hover" },
          }}
          onMouseDown={() => setDragging(true)}
        />
      )}
      <Box
        onDoubleClick={() => updateOpen((v) => !v)}
        sx={{
          display: "flex",
          alignItems: "center",
          px: 1,
          py: 0.25,
          borderBottom: open ? "1px solid var(--border-subtle)" : "none",
          bgcolor: "var(--bg-primary)",
          backdropFilter: "blur(10px)",
          boxShadow: 2,
          displayPrint: "none",
        }}
      >
        <Tabs
          value={tab}
          onChange={(_, v) => {
            setTab(v);
            updateOpen(true);
          }}
          sx={{ minHeight: HEADER_HEIGHT, "& .MuiTab-root": { minHeight: HEADER_HEIGHT, py: 0, textTransform: "none" } }}
        >
          <Tab label={<TabLabel label="Activities" count={tabCounts.activities} />} />
          <Tab label={<TabLabel label="Work" count={tabCounts.dataplaneWork} />} />
          <Tab label={<TabLabel label="Terminals" count={tabCounts.terminals} />} />
          <Tab label={<TabLabel label="Port forwards" count={tabCounts.portForwards} />} />
          <Tab label="Logs" />
        </Tabs>
        <Box sx={{ flexGrow: 1 }} />
        <Tooltip
          title={`Backend: ${backendHealth}. Cluster: ${effectiveClusterHealth}${cluster?.message ? ` (${cluster.message})` : ""}`}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              mr: 1,
              minWidth: 0,
              flex: "0 1 720px",
              justifyContent: "flex-end",
            }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              sx={{
                display: { xs: "none", md: "block" },
                minWidth: 0,
                flex: 1,
                maxWidth: { md: 380, lg: 520, xl: 680 },
                textAlign: "right",
              }}
            >
              {cluster?.context || "no context"}
              {cluster?.cluster ? ` / ${cluster.cluster}` : ""}
              {cluster?.authInfo ? ` / ${cluster.authInfo}` : ""}
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexShrink: 0 }}>
              <StatusDot ok={backendHealth === "healthy"} label="Backend" />
              <StatusDot ok={effectiveClusterHealth === "healthy"} label="Cluster" />
            </Box>
          </Box>
        </Tooltip>
        <IconButton
          aria-label={open ? "Collapse activity panel" : "Expand activity panel"}
          data-testid="activity-panel-toggle"
          size="small"
          onClick={() => updateOpen((v) => !v)}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {open ? <ExpandMoreIcon fontSize="small" /> : <ExpandLessIcon fontSize="small" />}
        </IconButton>
      </Box>
      <Box
        sx={{
          height: open ? height : 0,
          px: 0,
          py: 0,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
          visibility: open ? "visible" : "hidden",
          pointerEvents: open ? "auto" : "none",
        }}
      >
        <ActivityTabs
          panelOpen={open}
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

function TabLabel({ label, count }: { label: string; count: number }) {
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
      <Box component="span">{label}</Box>
      <Box
        component="span"
        sx={{
          minWidth: 18,
          height: 18,
          px: 0.65,
          borderRadius: 9,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: count > 0 ? "action.selected" : "transparent",
          color: count > 0 ? "text.primary" : "text.disabled",
          fontSize: "0.72rem",
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {count}
      </Box>
    </Box>
  );
}

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Box
      component="span"
      aria-label={`${label} ${ok ? "connected" : "disconnected"}`}
      sx={{
        width: 9,
        height: 9,
        borderRadius: "50%",
        bgcolor: ok ? "success.main" : "error.main",
        boxShadow: ok ? "0 0 0 2px var(--chip-success-border)" : "0 0 0 2px var(--chip-error-border)",
        flexShrink: 0,
      }}
    />
  );
}
