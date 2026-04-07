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
import { useActiveContext } from "../../../activeContext";

type Props = {
  token: string;
};

const dashboardRefreshMs = 10_000;

function stateChipColor(state: string): "success" | "warning" | "error" | "default" {
  return namespaceRowSummaryStateColor(state) as "success" | "warning" | "error" | "default";
}

function StatCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <TableRow>
      <TableCell sx={{ border: 0, py: 0.5, pl: 0, color: "text.secondary", width: 220 }}>{label}</TableCell>
      <TableCell sx={{ border: 0, py: 0.5, fontWeight: 600 }}>{value}</TableCell>
    </TableRow>
  );
}

function completenessExplanation(v: string): string {
  switch (v) {
    case "complete":
      return "Resource totals cover every visible namespace that has at least one cached dataplane list.";
    case "partial":
      return "Resource totals cover only namespaces with cached dataplane lists; some visible namespaces are not included yet.";
    default:
      return "Resource totals are not available until the dataplane has cached a list for at least one visible namespace.";
  }
}

export default function DashboardView(props: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ApiDashboardClusterResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const activeContext = useActiveContext();

  useEffect(() => {
    let cancelled = false;
    const load = async (initial: boolean) => {
      if (initial) {
        setLoading(true);
        setData(null);
      }
      setErr(null);
      try {
        const res = await apiGet<ApiDashboardClusterResponse>("/api/dashboard/cluster", props.token);
        if (!cancelled) setData(res);
      } catch {
        if (!cancelled) setErr("Failed to load cluster overview");
      } finally {
        if (!cancelled && initial) setLoading(false);
      }
    };
    void load(true);
    const id = window.setInterval(() => void load(false), dashboardRefreshMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [activeContext, props.token]);

  return (
    <Box
      className="kview-dashboard-root"
      sx={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        width: "100%",
        maxWidth: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        overflowY: "auto",
        overflowX: "hidden",
        pb: 2,
        boxSizing: "border-box",
      }}
    >
      <Box sx={{ px: 2, pt: 1 }}>
        <Typography variant="h6">Cluster overview</Typography>
        <Typography variant="body2" color="text.secondary">
          Dataplane-backed snapshot of namespace and node lists, row-enrichment coverage, and workload rollups from cached
          namespace data only — no inferred cluster-wide totals.
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
            const { plane, visibility, coverage, resources, hotspots } = data.item;
            const ns = visibility.namespaces;
            const nodes = visibility.nodes;
            const cov = coverage;

            return (
              <>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle2" color="primary" gutterBottom>
                    1 · Dataplane scope
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Which namespaces and resource kinds the dataplane observes, and observer wiring for list refreshes.
                  </Typography>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                    <Chip size="small" label={`View: ${plane.profile}`} variant="outlined" />
                    <Chip size="small" label={`Namespace selection: ${plane.discoveryMode}`} variant="outlined" />
                    <Chip size="small" label={`When active: ${plane.activationMode}`} variant="outlined" />
                    <Chip
                      size="small"
                      label={`Namespaces: ${plane.scope.namespaces}`}
                      variant="outlined"
                      sx={{ maxWidth: "100%" }}
                    />
                    <Chip size="small" label={`Resource types: ${plane.scope.resourceKinds}`} variant="outlined" />
                    <Chip size="small" label={`Namespace list: ${ns.observerState || "—"}`} variant="outlined" />
                    <Chip size="small" label={`Node list: ${nodes.observerState || "—"}`} variant="outlined" />
                  </Box>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                    Available views: {plane.profilesImplemented?.join(", ") || "—"} · Namespace modes:{" "}
                    {plane.discoveryImplemented?.join(", ") || "—"}
                  </Typography>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle2" color="primary" gutterBottom>
                    2 · List health and freshness
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Cluster-wide namespace and node lists: coarse state, metadata signals, and last observation time.
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
                        label="Namespaces · scope / degradation / completeness"
                        value={`${ns.coverage} · ${ns.degradation} · ${ns.completeness}`}
                      />
                      <StatCell
                        label="Nodes · scope / degradation / completeness"
                        value={`${nodes.coverage} · ${nodes.degradation} · ${nodes.completeness}`}
                      />
                      <StatCell label="Namespaces last observed" value={visibility.namespacesObservedAt || "—"} />
                      <StatCell label="Nodes last observed" value={visibility.nodesObservedAt || "—"} />
                    </TableBody>
                  </Table>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle2" color="primary" gutterBottom>
                    3 · Coverage
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Namespace visibility, optional row-enrichment progress, and how complete workload totals are relative
                    to visible namespaces.
                  </Typography>
                  {cov.note && (
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                      {cov.note}
                    </Typography>
                  )}
                  {cov.resourceTotalsNote && (
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                      {cov.resourceTotalsNote}
                    </Typography>
                  )}
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
                    <Chip
                      size="small"
                      variant="outlined"
                      color={cov.resourceTotalsCompleteness === "unknown" ? "warning" : "default"}
                      label={`Resource totals: ${cov.resourceTotalsCompleteness}`}
                    />
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`Namespaces in workload totals: ${cov.namespacesInResourceTotals} / ${cov.visibleNamespaces}`}
                    />
                    {cov.hasActiveEnrichmentSession && (
                      <Chip size="small" variant="outlined" label="Row enrichment session active" />
                    )}
                  </Box>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                    {completenessExplanation(cov.resourceTotalsCompleteness)}
                  </Typography>
                  <Table size="small">
                    <TableBody>
                      <StatCell label="Visible namespaces" value={cov.visibleNamespaces} />
                      <StatCell
                        label="Not targeted for background row enrichment"
                        value={cov.listOnlyNamespaces}
                      />
                      <StatCell label="Detail fetches completed (session)" value={cov.detailEnrichedNamespaces} />
                      <StatCell label="Related row projections (pods/deployments)" value={cov.relatedEnrichedNamespaces} />
                      <StatCell label="Awaiting related projection" value={cov.awaitingRelatedRowProjection} />
                      {cov.enrichmentTargets != null && cov.enrichmentTargets > 0 && (
                        <StatCell label="Enrichment target namespaces" value={cov.enrichmentTargets} />
                      )}
                    </TableBody>
                  </Table>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle2" color="primary" gutterBottom>
                    4 · Resource totals (known namespaces)
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Dataplane-owned namespaced lists summed only from namespaces where the dataplane already has cached
                    snapshots (typically from visiting those namespaces or enrichment).
                  </Typography>
                  {resources.note && (
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                      {resources.note}
                    </Typography>
                  )}
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
                    {resources.aggregateFreshness && (
                      <Chip size="small" variant="outlined" label={`Aggregate freshness: ${resources.aggregateFreshness}`} />
                    )}
                    {resources.aggregateDegradation && resources.aggregateDegradation !== "none" && (
                      <Chip
                        size="small"
                        color="warning"
                        variant="outlined"
                        label={`Aggregate degradation: ${resources.aggregateDegradation}`}
                      />
                    )}
                  </Box>
                  <Table size="small">
                    <TableBody>
                      <StatCell label="Pods" value={resources.pods} />
                      <StatCell label="Deployments" value={resources.deployments} />
                      <StatCell label="DaemonSets" value={resources.daemonSets} />
                      <StatCell label="StatefulSets" value={resources.statefulSets} />
                      <StatCell label="ReplicaSets" value={resources.replicaSets} />
                      <StatCell label="Jobs" value={resources.jobs} />
                      <StatCell label="CronJobs" value={resources.cronJobs} />
                      <StatCell label="Services" value={resources.services} />
                      <StatCell label="Ingresses" value={resources.ingresses} />
                      <StatCell label="PVCs" value={resources.persistentVolumeClaims} />
                      <StatCell label="ConfigMaps" value={resources.configMaps} />
                      <StatCell label="Secrets" value={resources.secrets} />
                      <StatCell label="ServiceAccounts" value={resources.serviceAccounts} />
                      <StatCell label="Roles" value={resources.roles} />
                      <StatCell label="RoleBindings" value={resources.roleBindings} />
                      <StatCell label="HelmReleases" value={resources.helmReleases} />
                    </TableBody>
                  </Table>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle2" color="primary" gutterBottom>
                    5 · Hotspots (known namespaces)
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Same cached-namespace scope as resource totals. Pods with at least 3 container restarts are flagged;
                    merged top lists are capped.
                  </Typography>
                  {hotspots.note && hotspots.note !== resources.note && (
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                      {hotspots.note}
                    </Typography>
                  )}
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
                    {hotspots.highSeverityHotspotsInTopN > 0 && (
                      <Chip size="small" color="error" label={`High-severity hotspots: ${hotspots.highSeverityHotspotsInTopN}`} />
                    )}
                    {hotspots.aggregateFreshness && (
                      <Chip size="small" variant="outlined" label={`Aggregate freshness: ${hotspots.aggregateFreshness}`} />
                    )}
                    {hotspots.aggregateDegradation && hotspots.aggregateDegradation !== "none" && (
                      <Chip
                        size="small"
                        color="warning"
                        variant="outlined"
                        label={`Aggregate degradation: ${hotspots.aggregateDegradation}`}
                      />
                    )}
                  </Box>
                  <Table size="small">
                    <TableBody>
                      <StatCell label="Unhealthy namespaces (from cluster list)" value={hotspots.unhealthyNamespaces} />
                      <StatCell label="Deployments needing attention (cached scope)" value={hotspots.degradedDeployments} />
                      <StatCell label="Pods with many restarts (≥3, cached scope)" value={hotspots.podsWithElevatedRestarts} />
                      <StatCell label="Other flagged resources (cached scope)" value={hotspots.problematicResources} />
                    </TableBody>
                  </Table>
                  {hotspots.topProblematicNamespaces && hotspots.topProblematicNamespaces.length > 0 && (
                    <>
                      <Divider sx={{ my: 1.5 }} />
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                        Namespaces with the most flagged resources (cached scope)
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
                        Pods with the most restarts
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
