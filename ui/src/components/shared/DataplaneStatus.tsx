import React, { useEffect, useState } from "react";
import { Box, Chip, CircularProgress, Typography } from "@mui/material";
import { apiGet } from "../../api";
import type { ApiDashboardClusterResponse } from "../../types/api";
import { dataplaneCoarseStateChipColor } from "../../utils/k8sUi";

type Props = {
  token: string;
};

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
          setErr("Failed to load cluster data status");
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
          Loading cluster data…
        </Typography>
      </Box>
    );
  }

  if (err || !data || !data.item) {
    return null;
  }

  const ns = data.item.visibility.namespaces;
  const nodes = data.item.visibility.nodes;
  const plane = data.item.plane;
  const wh = data.item.workloadHints;

  return (
    <Box sx={{ mb: 1, px: 2, display: "flex", flexWrap: "wrap", rowGap: 0.5, columnGap: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
        Cluster data · context {data.active || "-"}
      </Typography>

      {wh && wh.namespacesWithWorkloadCache > 0 && (
        <Chip
          size="small"
          variant="outlined"
          color={wh.highSeverityHotspotsInTopN > 0 ? "warning" : "default"}
          label={`Workload cache: ${wh.namespacesWithWorkloadCache}/${wh.totalNamespacesVisible} ns · elevated restarts: ${wh.podsWithElevatedRestarts}`}
        />
      )}

      <Chip
        size="small"
        label={`Namespaces: ${ns.state} · ${ns.freshness} · scope ${ns.coverage}`}
        color={dataplaneCoarseStateChipColor(ns.state)}
      />
      <Chip
        size="small"
        label={`Nodes: ${nodes.state} · ${nodes.freshness} · scope ${nodes.coverage}`}
        color={dataplaneCoarseStateChipColor(nodes.state)}
      />
      <Chip
        size="small"
        label={`Namespace list: ${ns.observerState || "—"}`}
        variant="outlined"
      />
      <Chip
        size="small"
        label={`Node list: ${nodes.observerState || "—"}`}
        variant="outlined"
      />
      <Chip size="small" label={`Profile: ${plane.profile || "unknown"}`} variant="outlined" />
      <Chip size="small" label={`Discovery: ${plane.discoveryMode || "unknown"}`} variant="outlined" />
      <Chip size="small" label={`Activation: ${plane.activationMode || "unknown"}`} variant="outlined" />
      <Chip size="small" label={`Scope: ${plane.scope.namespaces} / ${plane.scope.resourceKinds}`} variant="outlined" />
    </Box>
  );
}

