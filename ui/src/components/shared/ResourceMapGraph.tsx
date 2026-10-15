import React, { useEffect, useMemo } from "react";
import CenterFocusStrongOutlinedIcon from "@mui/icons-material/CenterFocusStrongOutlined";
import { Alert, Box, Tooltip } from "@mui/material";
import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  ReactFlow,
  useReactFlow,
  type EdgeTypes,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ApiResourceIdentity, ResourceMapEdge, ResourceMapResponse } from "../../types/api";
import { isPodGroupNode, type ResourceMapPresentationNode } from "./resourceOwnershipPresentation";
import ResourceMapGraphEdge from "./ResourceMapGraphEdge";
import ResourceMapGraphNode from "./ResourceMapGraphNode";
import { buildResourceMapGraph, RESOURCE_MAP_NODE_HEIGHT, RESOURCE_MAP_NODE_WIDTH, type ResourceMapFlowEdge, type ResourceMapFlowNode } from "./resourceMapGraphModel";

const nodeTypes: NodeTypes = { resourceMap: ResourceMapGraphNode };
const edgeTypes: EdgeTypes = { resourceMap: ResourceMapGraphEdge };

function ViewportControls({ targetId, layoutKey }: { targetId: string; layoutKey: string }) {
  const flow = useReactFlow<ResourceMapFlowNode, ResourceMapFlowEdge>();
  const { fitView, viewportInitialized } = flow;
  useEffect(() => {
    if (!viewportInitialized) return;
    const frame = window.requestAnimationFrame(() => {
      void fitView({ padding: 0.18, minZoom: 0.35, maxZoom: 1.15, duration: 220 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fitView, viewportInitialized, layoutKey]);

  const centerCurrent = () => {
    const target = flow.getNode(targetId);
    if (!target) return;
    const width = target.measured?.width || target.width || RESOURCE_MAP_NODE_WIDTH;
    const height = target.measured?.height || target.height || RESOURCE_MAP_NODE_HEIGHT;
    void flow.setCenter(target.position.x + width / 2, target.position.y + height / 2, { zoom: Math.min(1, flow.getZoom()), duration: 220 });
  };

  return (
    <Controls showInteractive={false} position="bottom-left">
      <Tooltip title="Center current resource" placement="right">
        <ControlButton onClick={centerCurrent} aria-label="Center current resource">
          <CenterFocusStrongOutlinedIcon fontSize="small" />
        </ControlButton>
      </Tooltip>
    </Controls>
  );
}

export default function ResourceMapGraph({
  response,
  nodes,
  edges,
  onOpenResource,
  onToggleGroup,
  canOpenResource,
  showCacheFreshness = true,
  layoutDirection = "TB",
}: {
  response: ResourceMapResponse;
  nodes: ResourceMapPresentationNode[];
  onToggleGroup?: (id: string) => void;
  edges: ResourceMapEdge[];
  onOpenResource: (identity: ApiResourceIdentity) => void;
  canOpenResource?: (identity: ApiResourceIdentity) => boolean;
  showCacheFreshness?: boolean;
  layoutDirection?: "TB" | "LR";
}) {
  const graph = useMemo(
    () => buildResourceMapGraph(nodes, edges, canOpenResource, layoutDirection),
    [canOpenResource, edges, layoutDirection, nodes],
  );
  const coveragePartial = response.coverage.coverage !== "full" || response.coverage.completeness !== "complete";
  const flowNodes = useMemo<ResourceMapFlowNode[]>(() => graph.nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      cacheFreshness: showCacheFreshness ? response.cache.freshness : undefined,
      coveragePartial,
      onOpenResource,
      onToggleGroup,
    },
  })), [coveragePartial, graph.nodes, onOpenResource, onToggleGroup, response.cache.freshness, showCacheFreshness]);
  const layoutKey = useMemo(
    () => `${layoutDirection}|${response.targetId}|${flowNodes.map((node) => node.id).join("|")}|${graph.edges.map((edge) => edge.id).join("|")}`,
    [flowNodes, graph.edges, layoutDirection, response.targetId],
  );

  return (
    <Box
      role="region"
      aria-label="Resource relationship map"
      sx={{
        position: "relative",
        width: "100%",
        height: "clamp(420px, calc(100dvh - 300px), 780px)",
        minHeight: 420,
        borderTop: 1,
        borderColor: "divider",
        bgcolor: "background.default",
        "& .react-flow__controls": { boxShadow: 2, border: 1, borderColor: "divider" },
        "& .react-flow__controls-button": { bgcolor: "background.paper", color: "text.primary", borderColor: "divider" },
        "& .react-flow__controls-button:hover": { bgcolor: "action.hover" },
      }}
    >
      {graph.layoutFallback && (
        <Alert severity="warning" sx={{ position: "absolute", top: 8, left: 8, right: 8, zIndex: 5 }}>
          Automatic layout failed. Showing a simplified layout with all resources and relationships retained.
        </Alert>
      )}
      <ReactFlow<ResourceMapFlowNode, ResourceMapFlowEdge>
        nodes={flowNodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.18, minZoom: 0.35, maxZoom: 1.15 }}
        minZoom={0.2}
        maxZoom={1.6}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        onNodeClick={(_, node) => {
          if (!isPodGroupNode(node.data.resourceNode) && node.data.uiNavigable) onOpenResource(node.data.resourceNode.identity);
        }}
        panOnDrag
        panOnScroll={false}
        zoomOnScroll
        zoomOnDoubleClick={false}
        zoomOnPinch
        preventScrolling
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(127, 127, 127, 0.28)" />
        <ViewportControls targetId={response.targetId} layoutKey={layoutKey} />
      </ReactFlow>
    </Box>
  );
}
