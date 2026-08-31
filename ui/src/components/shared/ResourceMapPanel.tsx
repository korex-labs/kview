import React, { useEffect, useId, useMemo, useState } from "react";
import { Alert, Box, ButtonBase, Chip, CircularProgress, Stack, Typography } from "@mui/material";
import { apiGet } from "../../api";
import { useActiveContext } from "../../activeContext";
import type { ApiResourceIdentity, ResourceMapEdge, ResourceMapNode, ResourceMapResponse } from "../../types/api";
import { supportsResourceIdentityDrawer } from "./ResourceIdentityDrawer";
import { resourceIdentityKey } from "./resourceMapIdentity";

type PositionedNode = ResourceMapNode & { x: number; y: number; uiNavigable: boolean };

const NODE_WIDTH = 174;
const NODE_HEIGHT = 48;
const X_GAP = 28;

function nodeSort(a: ResourceMapNode, b: ResourceMapNode) {
  return [a.depth, a.identity.kind, a.identity.namespace, a.identity.name, a.id]
    .join("|").localeCompare([b.depth, b.identity.kind, b.identity.namespace, b.identity.name, b.id].join("|"));
}

const MAX_LANE_COLUMNS = 3;
const ROW_GAP = 24;
const BAND_GAP = 52;
const GRAPH_PADDING = 12;

type LayoutRow = { level: number; nodes: ResourceMapNode[] };

function rowsForLevels(lanes: Map<number, ResourceMapNode[]>, levels: number[]): LayoutRow[] {
  const rows: LayoutRow[] = [];
  for (const level of levels) {
    const lane = lanes.get(level) || [];
    for (let offset = 0; offset < lane.length; offset += MAX_LANE_COLUMNS) {
      rows.push({ level, nodes: lane.slice(offset, offset + MAX_LANE_COLUMNS) });
    }
  }
  return rows;
}

function rowsHeight(rows: LayoutRow[]): number {
  if (!rows.length) return 0;
  let height = rows.length * NODE_HEIGHT + (rows.length - 1) * ROW_GAP;
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index].level !== rows[index - 1].level) height += ROW_GAP;
  }
  return height;
}

export function layoutResourceMap(nodes: ResourceMapNode[], targetId: string): { nodes: PositionedNode[]; width: number; height: number } {
  const lanes = new Map<number, ResourceMapNode[]>();
  for (const node of [...nodes].sort(nodeSort)) {
    const level = node.id === targetId || node.current || node.direction === "both" ? 0 : node.direction === "parent" ? -Math.max(1, node.depth) : Math.max(1, node.depth);
    lanes.set(level, [...(lanes.get(level) || []), node]);
  }

  const width = MAX_LANE_COLUMNS * NODE_WIDTH + (MAX_LANE_COLUMNS - 1) * X_GAP + 2 * GRAPH_PADDING;
  const parentLevels = Array.from(lanes.keys()).filter((level) => level < 0).sort((a, b) => a - b);
  const childLevels = Array.from(lanes.keys()).filter((level) => level > 0).sort((a, b) => a - b);
  const parentRows = rowsForLevels(lanes, parentLevels);
  const childRows = rowsForLevels(lanes, childLevels);
  const centerLane = lanes.get(0) || [];
  const current = centerLane.find((node) => node.id === targetId || node.current);
  const bidirectional = centerLane.filter((node) => node !== current);
  const extraCenterRows = Math.max(0, Math.ceil(bidirectional.length / 2) - 1);
  const parentHeight = rowsHeight(parentRows);
  const centerY = 24 + parentHeight + (parentRows.length ? BAND_GAP : 0);
  const childStartY = centerY + NODE_HEIGHT + extraCenterRows * (NODE_HEIGHT + ROW_GAP) + (childRows.length ? BAND_GAP : 0);
  const height = childStartY + rowsHeight(childRows) + 24;
  const positioned: PositionedNode[] = [];

  const placeRows = (rows: LayoutRow[], startY: number) => {
    let y = startY;
    rows.forEach((row, rowIndex) => {
      if (rowIndex > 0 && row.level !== rows[rowIndex - 1].level) y += ROW_GAP;
      const rowWidth = row.nodes.length * NODE_WIDTH + Math.max(0, row.nodes.length - 1) * X_GAP;
      row.nodes.forEach((node, index) => positioned.push({
        ...node,
        x: (width - rowWidth) / 2 + index * (NODE_WIDTH + X_GAP),
        y,
        uiNavigable: node.navigable && supportsResourceIdentityDrawer(node.identity),
      }));
      y += NODE_HEIGHT + ROW_GAP;
    });
  };

  placeRows(parentRows, 24);
  if (current) positioned.push({ ...current, x: width / 2 - NODE_WIDTH / 2, y: centerY, uiNavigable: false });
  bidirectional.forEach((node, index) => {
    const side = index % 2 === 0 ? -1 : 1;
    const row = Math.floor(index / 2);
    positioned.push({
      ...node,
      x: width / 2 - NODE_WIDTH / 2 + side * (NODE_WIDTH + X_GAP),
      y: centerY + row * (NODE_HEIGHT + ROW_GAP),
      uiNavigable: node.navigable && supportsResourceIdentityDrawer(node.identity),
    });
  });
  placeRows(childRows, childStartY);

  return { nodes: positioned.sort((a, b) => a.id.localeCompare(b.id)), width, height };
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

export function ResourceMapSvg({ response, onOpenResource }: { response: ResourceMapResponse; onOpenResource: (identity: ApiResourceIdentity) => void }) {
  const layout = useMemo(() => layoutResourceMap(response.nodes, response.targetId), [response.nodes, response.targetId]);
  const byId = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout.nodes]);
  const evidenceRows = useMemo(() => summarizeResourceMapEvidence(response.edges), [response.edges]);
  const markerId = `resource-map-arrow-${useId().replace(/:/g, "")}`;
  return (
    <Box role="region" aria-label="Resource relationship map" sx={{ overflowX: "auto", border: 1, borderColor: "divider", borderRadius: 1 }}>
      <Box sx={{ position: "relative", width: layout.width, height: layout.height }}>
      <svg aria-hidden="true" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`}>
        <defs><marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="currentColor" /></marker></defs>
        {response.edges.map((edge) => {
          const from = byId.get(edge.from); const to = byId.get(edge.to);
          if (!from || !to) return null;
          return <g key={edge.id}><line x1={from.x + NODE_WIDTH / 2} y1={from.y + NODE_HEIGHT / 2} x2={to.x + NODE_WIDTH / 2} y2={to.y + NODE_HEIGHT / 2} stroke={edge.resolved ? "#718096" : "#a0aec0"} strokeDasharray={edge.confidence === "high" ? "5 4" : undefined} markerEnd={`url(#${markerId})`} /><text x={(from.x + to.x + NODE_WIDTH) / 2} y={(from.y + to.y + NODE_HEIGHT) / 2 - 5} textAnchor="middle" fontSize="10" fill="currentColor">{edge.type}</text></g>;
        })}
      </svg>
        {layout.nodes.map((node) => {
          const label = `${node.identity.kind}: ${node.identity.name}`;
          const open = () => node.uiNavigable && onOpenResource(node.identity);
          return (
            <ButtonBase key={node.id} aria-label={label} disabled={!node.uiNavigable} data-direction={node.direction} data-depth={node.depth} onClick={open} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } }} sx={{ position: "absolute", left: node.x, top: node.y, width: NODE_WIDTH, height: NODE_HEIGHT, display: "block", textAlign: "left", px: 1.25, border: 1, borderColor: node.current ? "primary.main" : "text.primary", borderStyle: node.availability === "present" ? "solid" : "dashed", borderRadius: 1, bgcolor: node.current ? "action.selected" : "background.paper", opacity: node.availability === "present" ? 1 : 0.7, "&.Mui-focusVisible": { outline: "3px solid", outlineColor: "primary.main", outlineOffset: 2 } }}>
              <Box component="span" sx={{ display: "block", typography: "caption", fontWeight: 700 }}>{node.identity.kind}{node.direction === "both" ? " · parent + child" : ""}</Box>
              <Box component="span" sx={{ display: "block", typography: "caption", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.identity.namespace ? `${node.identity.namespace}/` : ""}{node.identity.name} · {node.availability}</Box>
            </ButtonBase>
          );
        })}
      </Box>
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

export default function ResourceMapPanel({ identity, token, onOpenResource }: { identity: ApiResourceIdentity; token: string; onOpenResource: (identity: ApiResourceIdentity) => void }) {
  const activeContext = useActiveContext();
  const [response, setResponse] = useState<ResourceMapResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const key = resourceIdentityKey(identity);
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
  }, [activeContext, key, token]);

  const contextMatches = !response || response.active === activeContext;
  if (loading || !contextMatches) return <Box aria-label="Loading resource map" sx={{ display: "flex", justifyContent: "center", p: 5 }}><CircularProgress /></Box>;
  if (error) return <Alert severity="error">Could not load Resource Map: {error}</Alert>;
  if (!response) return null;
  const partial = response.coverage.coverage !== "full" || response.coverage.completeness !== "complete";
  return <Stack spacing={1.25} sx={{ overflow: "auto", py: 1 }}>
    <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
      <Chip size="small" label={`${response.coverage.coverage} coverage`} color={partial ? "warning" : "success"} />
      <Chip size="small" label={`${response.cache.freshness} cache`} variant="outlined" />
      <Typography variant="caption" color="text.secondary">{response.cache.returnedNodes}/{response.cache.totalNodes} nodes · {response.cache.returnedEdges}/{response.cache.totalEdges} edges</Typography>
    </Stack>
    {partial ? <Alert severity="warning">Relationship coverage is partial. Some resources or relationship families may be absent.</Alert> : null}
    {response.truncated ? <Alert severity="warning">Map truncated at API limits{response.truncationReasons?.length ? `: ${response.truncationReasons.join(", ")}` : "."}</Alert> : null}
    {response.nodes.length <= 1 ? <Alert severity="info">No related resources are present in the current cache.</Alert> : <ResourceMapSvg response={response} onOpenResource={onOpenResource} />}
    <Typography variant="caption" color="text.secondary">Solid: exact · dashed: high confidence or unavailable · arrows follow dependency evidence. Expand Relationship details when source evidence is needed.</Typography>
  </Stack>;
}
