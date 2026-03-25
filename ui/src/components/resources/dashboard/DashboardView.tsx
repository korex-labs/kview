import React, { useEffect, useState } from "react";
import {
  Box,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Typography,
} from "@mui/material";
import { apiGet } from "../../../api";
import type { ApiDashboardClusterResponse } from "../../../types/api";
import { namespaceRowSummaryStateColor } from "../../../utils/k8sUi";

type Props = {
  token: string;
};

function stateChipColor(state: string): "success" | "warning" | "error" | "default" {
  return namespaceRowSummaryStateColor(state) as "success" | "warning" | "error" | "default";
}

function StatCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <TableRow>
      <TableCell sx={{ border: 0, py: 0.5, pl: 0, color: "text.secondary", width: 200 }}>{label}</TableCell>
      <TableCell sx={{ border: 0, py: 0.5, fontWeight: 600 }}>{value}</TableCell>
    </TableRow>
  );
}

export default function DashboardView(props: Props) {
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
        if (!cancelled) setData(res);
      } catch {
        if (!cancelled) setErr("Failed to load cluster overview");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.token]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto", pb: 2 }}>
      <Box sx={{ px: 2, pt: 1 }}>
        <Typography variant="h6">Cluster overview</Typography>
        <Typography variant="body2" color="text.secondary">
          Bounded Stage 5C operator view: dataplane snapshots, freshness, and a sampled workload rollup (not full-cluster
          analytics).
        </Typography>
      </Box>

      {loading && (
        <Box sx={{ px: 2, display: "flex", alignItems: "center", gap: 1 }}>
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">
            Loading…
          </Typography>
        </Box>
      )}

      {err && (
        <Typography color="error" sx={{ px: 2 }}>
          {err}
        </Typography>
      )}

      {!loading && !err && data?.item && (
        <Box sx={{ px: 2, display: "flex", flexDirection: "column", gap: 2 }}>
          {(() => {
            const { plane, visibility, resources, hotspots } = data.item;
            const ns = visibility.namespaces;
            const nodes = visibility.nodes;

            return (
              <>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle2" color="primary" gutterBottom>
                    1 · Plane &amp; control
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    What powers this view (dataplane profile, discovery, scope, observers).
                  </Typography>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                    <Chip size="small" label={`Profile: ${plane.profile}`} variant="outlined" />
                    <Chip size="small" label={`Discovery: ${plane.discoveryMode}`} variant="outlined" />
                    <Chip size="small" label={`Activation: ${plane.activationMode}`} variant="outlined" />
                    <Chip
                      size="small"
                      label={`Scope · ns: ${plane.scope.namespaces}`}
                      variant="outlined"
                      sx={{ maxWidth: "100%" }}
                    />
                    <Chip size="small" label={`Scope · kinds: ${plane.scope.resourceKinds}`} variant="outlined" />
                    <Chip size="small" label={`NS observer: ${ns.observerState || "not_loaded"}`} variant="outlined" />
                    <Chip size="small" label={`Node observer: ${nodes.observerState || "not_loaded"}`} variant="outlined" />
                  </Box>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                    Implemented profiles: {plane.profilesImplemented?.join(", ") || "—"} · Discovery modes:{" "}
                    {plane.discoveryImplemented?.join(", ") || "—"}
                  </Typography>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle2" color="primary" gutterBottom>
                    2 · Visibility &amp; freshness
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Cluster-wide namespace and node list snapshots — use this to judge trust in the numbers below.
                  </Typography>
                  {visibility.trustNote && (
                    <Typography variant="caption" color="warning.main" display="block" sx={{ mb: 1 }}>
                      {visibility.trustNote}
                    </Typography>
                  )}
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 1 }}>
                    <Chip
                      size="small"
                      label={`Namespaces ${ns.state} · ${ns.freshness}`}
                      color={stateChipColor(ns.state)}
                    />
                    <Chip
                      size="small"
                      label={`Nodes ${nodes.state} · ${nodes.freshness}`}
                      color={stateChipColor(nodes.state)}
                    />
                  </Box>
                  <Table size="small">
                    <TableBody>
                      <StatCell
                        label="Namespaces (total / unhealthy)"
                        value={`${ns.total} / ${ns.unhealthy}`}
                      />
                      <StatCell label="Nodes (total)" value={nodes.total} />
                      <StatCell
                        label="Namespaces meta"
                        value={`cov ${ns.coverage} · deg ${ns.degradation} · cmp ${ns.completeness}`}
                      />
                      <StatCell
                        label="Nodes meta"
                        value={`cov ${nodes.coverage} · deg ${nodes.degradation} · cmp ${nodes.completeness}`}
                      />
                      <StatCell label="Namespaces observed at" value={visibility.namespacesObservedAt || "—"} />
                      <StatCell label="Nodes observed at" value={visibility.nodesObservedAt || "—"} />
                    </TableBody>
                  </Table>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle2" color="primary" gutterBottom>
                    3 · Visible resources (sampled)
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Totals sum pods, deployments, services, ingresses, and PVCs from the first{" "}
                    {resources.sampledNamespaces} namespaces alphabetically
                    {resources.partial ? ` (of ${resources.totalNamespaces} visible — not cluster-complete)` : ""}.
                  </Typography>
                  {resources.note && (
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                      {resources.note}
                    </Typography>
                  )}
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
                    {resources.partial && <Chip size="small" color="warning" label="Partial aggregate" variant="outlined" />}
                    {resources.sampleFreshness && (
                      <Chip size="small" variant="outlined" label={`Sample freshness: ${resources.sampleFreshness}`} />
                    )}
                    {resources.sampleDegradation && resources.sampleDegradation !== "none" && (
                      <Chip size="small" color="warning" variant="outlined" label={`Sample degradation: ${resources.sampleDegradation}`} />
                    )}
                  </Box>
                  <Table size="small">
                    <TableBody>
                      <StatCell label="Pods" value={resources.pods} />
                      <StatCell label="Deployments" value={resources.deployments} />
                      <StatCell label="Services" value={resources.services} />
                      <StatCell label="Ingresses" value={resources.ingresses} />
                      <StatCell label="PVCs" value={resources.persistentVolumeClaims} />
                    </TableBody>
                  </Table>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle2" color="primary" gutterBottom>
                    4 · Hotspots &amp; risk (sampled)
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Where to look first: derived from the same namespace sample as section 3. Restart counts use restarts ≥
                    3; top pods list is globally merged and capped.
                  </Typography>
                  {hotspots.note && hotspots.note !== resources.note && (
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                      {hotspots.note}
                    </Typography>
                  )}
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
                    {hotspots.partial && <Chip size="small" color="warning" label="Partial rollup" variant="outlined" />}
                    {hotspots.highSeverityHotspotsInTopN > 0 && (
                      <Chip size="small" color="error" label={`High-severity hotspots: ${hotspots.highSeverityHotspotsInTopN}`} />
                    )}
                  </Box>
                  <Table size="small">
                    <TableBody>
                      <StatCell label="Unhealthy namespaces (cluster list)" value={hotspots.unhealthyNamespaces} />
                      <StatCell label="Degraded / attention deployments (in sample)" value={hotspots.degradedDeployments} />
                      <StatCell label="Pods with elevated restarts (≥3, in sample)" value={hotspots.podsWithElevatedRestarts} />
                      <StatCell label="Problematic resources (in sample, deduped per ns)" value={hotspots.problematicResources} />
                    </TableBody>
                  </Table>
                  {hotspots.topProblematicNamespaces && hotspots.topProblematicNamespaces.length > 0 && (
                    <>
                      <Divider sx={{ my: 1.5 }} />
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                        Top namespaces by problematic count (sample)
                      </Typography>
                      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                        {hotspots.topProblematicNamespaces.map((t) => (
                          <Chip
                            key={t.namespace}
                            size="small"
                            label={`${t.namespace}: ${t.score}`}
                            color={t.score > 0 ? "warning" : "default"}
                            variant="outlined"
                          />
                        ))}
                      </Box>
                    </>
                  )}
                  {hotspots.topPodRestartHotspots && hotspots.topPodRestartHotspots.length > 0 && (
                    <>
                      <Divider sx={{ my: 1.5 }} />
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                        Top pod restart hotspots (merged)
                      </Typography>
                      <Table size="small">
                        <TableBody>
                          {hotspots.topPodRestartHotspots.slice(0, 8).map((h) => (
                            <TableRow key={`${h.namespace}/${h.name}`}>
                              <TableCell sx={{ border: 0, py: 0.35, pl: 0 }}>
                                {h.namespace}/{h.name}
                              </TableCell>
                              <TableCell sx={{ border: 0, py: 0.35 }}>{h.restarts} restarts</TableCell>
                              <TableCell sx={{ border: 0, py: 0.35 }}>
                                <Chip size="small" label={h.severity} color={h.severity === "high" ? "error" : "warning"} />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </>
                  )}
                </Paper>
              </>
            );
          })()}
        </Box>
      )}
    </Box>
  );
}
