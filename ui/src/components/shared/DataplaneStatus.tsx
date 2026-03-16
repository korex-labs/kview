import React, { useEffect, useState } from "react";
import { Box, Chip, CircularProgress, Typography } from "@mui/material";
import { apiGet } from "../../api";
import type { ApiDashboardClusterResponse } from "../../types/api";

type Props = {
  token: string;
};

function chipColorForState(state: string): "success" | "warning" | "error" | "default" {
  switch (state) {
    case "ok":
      return "success";
    case "empty":
      return "default";
    case "denied":
    case "partial_proxy":
    case "degraded":
      return "error";
    default:
      return "warning";
  }
}

export default function DataplaneStatus(props: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ApiDashboardClusterResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);

    (async () => {
      try {
        const res = await apiGet<ApiDashboardClusterResponse>("/api/dashboard/cluster", props.token);
        if (!cancelled) {
          setData(res);
        }
      } catch (e) {
        if (!cancelled) {
          setErr("Failed to load dataplane status");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [props.token]);

  if (loading) {
    return (
      <Box sx={{ mb: 1, px: 2, display: "flex", alignItems: "center", gap: 1 }}>
        <CircularProgress size={16} />
        <Typography variant="caption" color="text.secondary">
          Loading dataplane status…
        </Typography>
      </Box>
    );
  }

  if (err || !data || !data.item) {
    return null;
  }

  const ns = data.item.namespaces;
  const nodes = data.item.nodes;

  return (
    <Box sx={{ mb: 1, px: 2, display: "flex", flexWrap: "wrap", rowGap: 0.5, columnGap: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
        Dataplane · context {data.active || "-"}
      </Typography>

      <Chip
        size="small"
        label={`Namespaces: ${ns.state} (${ns.freshness}, cov=${ns.coverage})`}
        color={chipColorForState(ns.state)}
      />
      <Chip
        size="small"
        label={`Nodes: ${nodes.state} (${nodes.freshness}, cov=${nodes.coverage})`}
        color={chipColorForState(nodes.state)}
      />
      <Chip
        size="small"
        label={`NS observer: ${ns.observerState || "not_loaded"}`}
        variant="outlined"
      />
      <Chip
        size="small"
        label={`Node observer: ${nodes.observerState || "not_loaded"}`}
        variant="outlined"
      />
    </Box>
  );
}

