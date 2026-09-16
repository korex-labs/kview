import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, Chip, CircularProgress, Stack, Typography } from "@mui/material";
import { apiGet } from "../../api";
import { useActiveContext } from "../../activeContext";
import type { ApiResourceIdentity, ResourceMapEdge, ResourceMapNode, ResourceMapResponse } from "../../types/api";
import DataplaneExplanationAction from "./DataplaneExplanationAction";
import { buildResourceMapExplanationSurface } from "./dataplaneExplanationModel";

const LazyResourceMapGraph = lazy(() => import("./ResourceMapGraph"));

function nodeSort(a: ResourceMapNode, b: ResourceMapNode) {
  return [a.depth, a.identity.kind, a.identity.namespace, a.identity.name, a.id]
    .join("|").localeCompare([b.depth, b.identity.kind, b.identity.namespace, b.identity.name, b.id].join("|"));
}

function edgeTitle(edge: ResourceMapEdge): string {
  const evidence = edge.evidence?.description || (edge.evidence?.selector ? JSON.stringify(edge.evidence.selector) : "");
  return [edge.source.type, edge.source.fieldPath, evidence, edge.resolved ? "resolved" : "unresolved"].filter(Boolean).join(" · ");
}

export function summarizeResourceMapEvidence(edges: ResourceMapEdge[]): Array<{ key: string; label: string; count: number }> {
  const summaries = new Map<string, { key: string; label: string; count: number }>();
  for (const edge of edges) {
    const detail = edgeTitle(edge) || "no additional evidence";
    const key = [edge.type, edge.confidence, detail].join("|");
    const existing = summaries.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      summaries.set(key, { key, label: `${edge.type} · ${edge.confidence} · ${detail}`, count: 1 });
    }
  }
  return Array.from(summaries.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function historicalReplicaSetNodeIDs(response: ResourceMapResponse): string[] {
  if (response.target.identity.kind !== "Deployment") return [];
  const directOwnerChildren = new Set(response.edges
    .filter((edge) => edge.type === "owner" && edge.resolved && edge.from === response.targetId)
    .map((edge) => edge.to));
  const directReplicaSets = response.nodes.filter((node) =>
    directOwnerChildren.has(node.id)
    && node.depth === 1
    && node.direction === "child"
    && node.availability === "present"
    && node.identity.kind === "ReplicaSet"
    && node.identity.resource === "replicasets",
  );
  const latestRevision = Math.max(0, ...directReplicaSets.map((node) => node.replicaSet?.revision || 0));
  const historical = directReplicaSets.filter((node) =>
    node.replicaSet !== undefined
    && node.replicaSet.desired === 0
    && node.replicaSet.revision > 0
    && node.replicaSet.revision < latestRevision,
  ).sort(nodeSort);
  return historical.length >= 2 ? historical.map((node) => node.id) : [];
}

export function hiddenHistoryBranchNodeIDs(response: ResourceMapResponse, historicalReplicaSetIds: string[]): string[] {
  const hidden = new Set(historicalReplicaSetIds);
  const byId = new Map(response.nodes.map((node) => [node.id, node]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of response.edges) {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to || !hidden.has(from.id) || hidden.has(to.id) || to.depth <= from.depth || to.direction !== "child") continue;
      hidden.add(to.id);
      changed = true;
    }
  }
  return Array.from(hidden);
}

export function ResourceMapView({ response, onOpenResource, canOpenResource, showCacheFreshness, layoutDirection }: { response: ResourceMapResponse; onOpenResource: (identity: ApiResourceIdentity) => void; canOpenResource?: (identity: ApiResourceIdentity) => boolean; showCacheFreshness?: boolean; layoutDirection?: "TB" | "LR" }) {
  const [showHistoricalReplicaSets, setShowHistoricalReplicaSets] = useState(false);
  const historicalReplicaSetIds = useMemo(() => historicalReplicaSetNodeIDs(response), [response]);
  const hiddenHistoryBranchIds = useMemo(() => hiddenHistoryBranchNodeIDs(response, historicalReplicaSetIds), [historicalReplicaSetIds, response]);
  const hiddenNodeIds = useMemo(() => showHistoricalReplicaSets ? new Set<string>() : new Set(hiddenHistoryBranchIds), [hiddenHistoryBranchIds, showHistoricalReplicaSets]);
  const visibleNodes = useMemo(() => response.nodes.filter((node) => !hiddenNodeIds.has(node.id)), [hiddenNodeIds, response.nodes]);
  const visibleEdges = useMemo(() => response.edges.filter((edge) => !hiddenNodeIds.has(edge.from) && !hiddenNodeIds.has(edge.to)), [hiddenNodeIds, response.edges]);
  const evidenceRows = useMemo(() => summarizeResourceMapEvidence(response.edges), [response.edges]);
  useEffect(() => setShowHistoricalReplicaSets(false), [response.targetId]);

  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, overflow: "hidden" }}>
      {historicalReplicaSetIds.length ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "center", px: 1, py: 0.75, borderBottom: 1, borderColor: "divider", bgcolor: "action.hover" }}>
          <Typography variant="caption" color="text.secondary">
            {historicalReplicaSetIds.length} zero-replica historical ReplicaSets {showHistoricalReplicaSets ? "shown" : "hidden"}
          </Typography>
          <Button size="small" onClick={() => setShowHistoricalReplicaSets((shown) => !shown)} aria-expanded={showHistoricalReplicaSets}>
            {showHistoricalReplicaSets ? "Hide history" : "Show history"}
          </Button>
        </Stack>
      ) : null}
      <Suspense fallback={<Box aria-label="Loading resource map graph" sx={{ display: "flex", justifyContent: "center", p: 5 }}><CircularProgress size={28} /></Box>}>
        <LazyResourceMapGraph response={response} nodes={visibleNodes} edges={visibleEdges} onOpenResource={onOpenResource} canOpenResource={canOpenResource} showCacheFreshness={showCacheFreshness} layoutDirection={layoutDirection} />
      </Suspense>
      {evidenceRows.length ? (
        <Box component="details" sx={{ borderTop: 1, borderColor: "divider" }}>
          <Box component="summary" sx={{ px: 1, py: 0.75, cursor: "pointer", typography: "caption", color: "text.secondary", userSelect: "none" }}>
            Relationship details ({response.edges.length} edges · {evidenceRows.length} evidence patterns)
          </Box>
          <Stack spacing={0.5} sx={{ px: 1, pb: 1, maxHeight: 180, overflow: "auto" }} aria-label="Relationship evidence">
            {evidenceRows.map((row) => (
              <Stack key={row.key} direction="row" spacing={0.75} sx={{ alignItems: "flex-start" }}>
                {row.count > 1 ? <Chip size="small" label={`×${row.count}`} sx={{ height: 18, mt: 0.1 }} /> : null}
                <Typography variant="caption">{row.label}</Typography>
              </Stack>
            ))}
          </Stack>
        </Box>
      ) : null}
    </Box>
  );
}

// Compatibility export for focused tests and callers while the v1 SVG renderer is replaced.
export const ResourceMapSvg = ResourceMapView;

export default function ResourceMapPanel({ identity, token, onOpenResource }: { identity: ApiResourceIdentity; token: string; onOpenResource: (identity: ApiResourceIdentity) => void }) {
  const activeContext = useActiveContext();
  const [response, setResponse] = useState<ResourceMapResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setResponse(null);
    if (!activeContext) {
      setLoading(false);
      setError("Select an active cluster context to use Resource Map.");
      return () => controller.abort();
    }
    if (!token) {
      setLoading(false);
      setError("Authentication is unavailable for Resource Map.");
      return () => controller.abort();
    }
    const params = new URLSearchParams();
    params.set("group", identity.group); params.set("version", identity.version); params.set("resource", identity.resource);
    params.set("kind", identity.kind); params.set("scope", identity.scope);
    if (identity.scope === "namespaced") params.set("namespace", identity.namespace!);
    params.set("name", identity.name); if (identity.uid) params.set("uid", identity.uid); params.set("depth", "2");
    apiGet<ResourceMapResponse>(`/api/dataplane/resource-map?${params.toString()}`, token, { signal: controller.signal })
      .then((next) => {
        if (!controller.signal.aborted && next.active === activeContext) setResponse(next);
        else if (!controller.signal.aborted) setError("Resource Map context changed. Reopen the tab to retry.");
      })
      .catch(() => { if (!controller.signal.aborted) setError("Resource Map is unavailable. Try again."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [
    activeContext,
    identity.group,
    identity.kind,
    identity.name,
    identity.namespace,
    identity.resource,
    identity.scope,
    identity.uid,
    identity.version,
    token,
  ]);

  const contextMatches = !response || response.active === activeContext;
  if (loading || !contextMatches) return <Box aria-label="Loading resource map" sx={{ display: "flex", justifyContent: "center", p: 5 }}><CircularProgress /></Box>;
  if (error) return <Alert severity="error">Could not load Resource Map: {error}</Alert>;
  if (!response) return null;
  const partial = response.coverage.coverage !== "full" || response.coverage.completeness !== "complete";
  return <Stack spacing={1.25} sx={{ overflow: "auto", py: 1 }}>
    <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
      {!partial ? <>
        <Chip size="small" label={`${response.coverage.coverage} coverage`} color="success" />
        <Chip size="small" label={`${response.cache.freshness} cache`} variant="outlined" />
      </> : null}
      <Typography variant="caption" color="text.secondary">{response.cache.returnedNodes}/{response.cache.totalNodes} nodes · {response.cache.returnedEdges}/{response.cache.totalEdges} edges</Typography>
      <DataplaneExplanationAction
        token={token}
        activeContext={activeContext}
        surface={buildResourceMapExplanationSurface(response)}
      />
    </Stack>
    {partial ? <Alert severity="warning">Relationship coverage is partial. Some resources or relationship families may be absent.</Alert> : null}
    {response.truncated ? <Alert severity="warning">Map truncated at API limits{response.truncationReasons?.length ? `: ${response.truncationReasons.join(", ")}` : "."}</Alert> : null}
    {response.nodes.length <= 1 ? <Alert severity="info">No related resources are present in the current cache.</Alert> : <ResourceMapView response={response} onOpenResource={onOpenResource} />}
    <Typography variant="caption" color="text.secondary">Use the graph controls to fit, zoom, or center the current resource. Hover or focus resource cards and relationship markers for full identity and evidence.</Typography>
  </Stack>;
}
