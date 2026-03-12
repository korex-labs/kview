import React, { useEffect, useState } from "react";
import { Box, Tabs, Tab, IconButton, Typography } from "@mui/material";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ActivityTabs from "./ActivityTabs";

export default function ActivityPanel() {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState(0);

  useEffect(() => {
    const offset = open ? "232px" : "32px";
    document.documentElement.style.setProperty("--bottom-panel-offset", offset);
  }, [open]);

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
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          px: 1.5,
          py: 0.75,
          borderBottom: open ? "1px solid var(--border-subtle)" : "none",
          bgcolor: "var(--bg-primary)",
          backdropFilter: "blur(10px)",
          boxShadow: "0 -2px 8px rgba(0, 0, 0, 0.16)",
          displayPrint: "none",
        }}
      >
        <Typography
          variant="subtitle2"
          sx={{ fontWeight: 600, letterSpacing: 0.2, textTransform: "uppercase", fontSize: 11 }}
        >
          Activity Panel
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{ minHeight: 32, "& .MuiTab-root": { minHeight: 32 } }}
        >
          <Tab label="Activities" />
          <Tab label="Sessions" />
          <Tab label="Logs" />
        </Tabs>
        <IconButton size="small" onClick={() => setOpen((v) => !v)}>
          {open ? <ExpandMoreIcon fontSize="small" /> : <ExpandLessIcon fontSize="small" />}
        </IconButton>
      </Box>
      {open && (
        <Box
          sx={{
            height: 200,
            px: 1.5,
            py: 1,
            overflow: "hidden",
          }}
        >
          <ActivityTabs tab={tab} />
        </Box>
      )}
    </Box>
  );
}

