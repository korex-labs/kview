import dagre from "@dagrejs/dagre";
import { MarkerType, Position, type Edge, type Node } from "@xyflow/react";
import type { ApiResourceIdentity, ResourceMapEdge, ResourceMapNode } from "../../types/api";
import { supportsResourceIdentityDrawer } from "./ResourceIdentityDrawer";

export const RESOURCE_MAP_NODE_WIDTH = 280;
export const RESOURCE_MAP_NODE_HEIGHT = 112;

export type ResourceMapGraphNodeData = Record<string, unknown> & {
  resourceNode: ResourceMapNode;
  uiNavigable: boolean;
  incoming: ResourceMapEdge[];
  outgoing: ResourceMapEdge[];
  incomingHandlePositions: Record<string, Position>;
  outgoingHandlePositions: Record<string, Position>;
  incomingHandleOffsets: Record<string, number>;
  outgoingHandleOffsets: Record<string, number>;
  cacheFreshness?: string;
  coveragePartial?: boolean;
  onOpenResource?: (identity: ApiResourceIdentity) => void;
};

export type ResourceMapGraphEdgeData = Record<string, unknown> & {
  resourceEdge: ResourceMapEdge;
  fromIdentity: ApiResourceIdentity;
  toIdentity: ApiResourceIdentity;
  stepPosition: number;
  selfLoop: boolean;
  routePoints: Array<{ x: number; y: number }>;
};

export type ResourceMapFlowNode = Node<ResourceMapGraphNodeData, "resourceMap">;
export type ResourceMapFlowEdge = Edge<ResourceMapGraphEdgeData, "resourceMap">;

export function resourceMapIdentityLabel(identity: ApiResourceIdentity): string {
  return `${identity.kind} ${identity.namespace ? `${identity.namespace}/` : ""}${identity.name}`;
}

export function resourceMapEdgeLabel(type: ResourceMapEdge["type"]): string {
  switch (type) {
    case "owner": return "Ownership";
    case "namespace": return "Namespace containment";
    case "objectReference": return "Object reference";
    case "kindDefinition": return "Kind definition";
    case "selector": return "Selector match";
  }
}

function nodeSort(a: ResourceMapNode, b: ResourceMapNode) {
  return [a.depth, a.identity.kind, a.identity.namespace, a.identity.name, a.id]
    .join("|").localeCompare([b.depth, b.identity.kind, b.identity.namespace, b.identity.name, b.id].join("|"));
}

function edgeSort(a: ResourceMapEdge, b: ResourceMapEdge) {
  return [a.from, a.to, a.type, a.id].join("|").localeCompare([b.from, b.to, b.type, b.id].join("|"));
}

function edgeStroke(edge: ResourceMapEdge): string {
  if (!edge.resolved) return "#9e9e9e";
  switch (edge.type) {
    case "owner": return "#5c6bc0";
    case "selector": return "#00897b";
    case "objectReference": return "#1e88e5";
    case "kindDefinition": return "#8e24aa";
    case "namespace": return "#78909c";
  }
}

type LayoutNode = { x: number; y: number; width: number; height: number };
type RoutePoint = { x: number; y: number };

function routeAnchor(node: LayoutNode, point: RoutePoint): { position: Position; offset: number } {
  const candidates = [
    { position: Position.Top, distance: Math.abs(point.y - (node.y - node.height / 2)) },
    { position: Position.Bottom, distance: Math.abs(point.y - (node.y + node.height / 2)) },
    { position: Position.Left, distance: Math.abs(point.x - (node.x - node.width / 2)) },
    { position: Position.Right, distance: Math.abs(point.x - (node.x + node.width / 2)) },
  ].sort((a, b) => a.distance - b.distance);
  const position = candidates[0].position;
  const rawOffset = position === Position.Top || position === Position.Bottom
    ? ((point.x - (node.x - node.width / 2)) / node.width) * 100
    : ((point.y - (node.y - node.height / 2)) / node.height) * 100;
  return { position, offset: Math.max(8, Math.min(92, rawOffset)) };
}

export function buildResourceMapGraph(
  nodes: ResourceMapNode[],
  edges: ResourceMapEdge[],
): { nodes: ResourceMapFlowNode[]; edges: ResourceMapFlowEdge[] } {
  const orderedNodes = [...nodes].sort(nodeSort);
  const orderedEdges = [...edges].sort(edgeSort);
  const byId = new Map(orderedNodes.map((node) => [node.id, node]));
  const incoming = new Map<string, ResourceMapEdge[]>();
  const outgoing = new Map<string, ResourceMapEdge[]>();

  for (const edge of orderedEdges) {
    incoming.set(edge.to, [...(incoming.get(edge.to) || []), edge]);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) || []), edge]);
  }

  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({
    rankdir: "TB",
    ranker: "network-simplex",
    acyclicer: "greedy",
    nodesep: 56,
    edgesep: 24,
    ranksep: 92,
    marginx: 32,
    marginy: 32,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const node of orderedNodes) {
    graph.setNode(node.id, { width: RESOURCE_MAP_NODE_WIDTH, height: RESOURCE_MAP_NODE_HEIGHT });
  }
  for (const edge of orderedEdges) {
    if (byId.has(edge.from) && byId.has(edge.to)) graph.setEdge(edge.from, edge.to, {}, edge.id);
  }
  dagre.layout(graph);

  const sourceHandlePositions = new Map<string, Position>();
  const targetHandlePositions = new Map<string, Position>();
  const sourceHandleOffsets = new Map<string, number>();
  const targetHandleOffsets = new Map<string, number>();
  const edgeRoutePoints = new Map<string, RoutePoint[]>();
  for (const resourceEdge of orderedEdges) {
    if (!byId.has(resourceEdge.from) || !byId.has(resourceEdge.to)) continue;
    if (resourceEdge.from === resourceEdge.to) {
      sourceHandlePositions.set(resourceEdge.id, Position.Right);
      targetHandlePositions.set(resourceEdge.id, Position.Right);
      sourceHandleOffsets.set(resourceEdge.id, 35);
      targetHandleOffsets.set(resourceEdge.id, 65);
      edgeRoutePoints.set(resourceEdge.id, []);
      continue;
    }
    const source = graph.node(resourceEdge.from) as LayoutNode;
    const target = graph.node(resourceEdge.to) as LayoutNode;
    const route = (graph.edge({ v: resourceEdge.from, w: resourceEdge.to, name: resourceEdge.id })?.points || []) as RoutePoint[];
    edgeRoutePoints.set(resourceEdge.id, route);
    if (route.length >= 2) {
      const sourceAnchor = routeAnchor(source, route[0]);
      const targetAnchor = routeAnchor(target, route[route.length - 1]);
      sourceHandlePositions.set(resourceEdge.id, sourceAnchor.position);
      targetHandlePositions.set(resourceEdge.id, targetAnchor.position);
      sourceHandleOffsets.set(resourceEdge.id, sourceAnchor.offset);
      targetHandleOffsets.set(resourceEdge.id, targetAnchor.offset);
    } else {
      const downward = source.y <= target.y;
      sourceHandlePositions.set(resourceEdge.id, downward ? Position.Bottom : Position.Top);
      targetHandlePositions.set(resourceEdge.id, downward ? Position.Top : Position.Bottom);
      sourceHandleOffsets.set(resourceEdge.id, 50);
      targetHandleOffsets.set(resourceEdge.id, 50);
    }
  }

  const corridorEdges = new Map<string, ResourceMapEdge[]>();
  for (const resourceEdge of orderedEdges) {
    if (!byId.has(resourceEdge.from) || !byId.has(resourceEdge.to)) continue;
    const source = graph.node(resourceEdge.from);
    const target = graph.node(resourceEdge.to);
    const sourcePosition = sourceHandlePositions.get(resourceEdge.id)!;
    const targetPosition = targetHandlePositions.get(resourceEdge.id)!;
    const sourceAnchor = sourcePosition === Position.Top ? source.y - RESOURCE_MAP_NODE_HEIGHT / 2
      : sourcePosition === Position.Bottom ? source.y + RESOURCE_MAP_NODE_HEIGHT / 2 : source.y;
    const targetAnchor = targetPosition === Position.Top ? target.y - RESOURCE_MAP_NODE_HEIGHT / 2
      : targetPosition === Position.Bottom ? target.y + RESOURCE_MAP_NODE_HEIGHT / 2 : target.y;
    const key = `${sourcePosition}:${sourceAnchor}|${targetPosition}:${targetAnchor}`;
    corridorEdges.set(key, [...(corridorEdges.get(key) || []), resourceEdge]);
  }
  const stepPositions = new Map<string, number>();
  for (const corridor of corridorEdges.values()) {
    corridor.forEach((resourceEdge, index) => {
      stepPositions.set(resourceEdge.id, 0.22 + (0.56 * (index + 1)) / (corridor.length + 1));
    });
  }

  const flowNodes: ResourceMapFlowNode[] = orderedNodes.map((resourceNode) => {
    const position = graph.node(resourceNode.id);
    return {
      id: resourceNode.id,
      type: "resourceMap",
      position: {
        x: position.x - RESOURCE_MAP_NODE_WIDTH / 2,
        y: position.y - RESOURCE_MAP_NODE_HEIGHT / 2,
      },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      draggable: false,
      selectable: false,
      connectable: false,
      focusable: false,
      width: RESOURCE_MAP_NODE_WIDTH,
      height: RESOURCE_MAP_NODE_HEIGHT,
      data: {
        resourceNode,
        uiNavigable: !resourceNode.current && resourceNode.navigable && supportsResourceIdentityDrawer(resourceNode.identity),
        incoming: incoming.get(resourceNode.id) || [],
        outgoing: outgoing.get(resourceNode.id) || [],
        incomingHandlePositions: Object.fromEntries((incoming.get(resourceNode.id) || []).map((edge) => [edge.id, targetHandlePositions.get(edge.id) || Position.Top])),
        outgoingHandlePositions: Object.fromEntries((outgoing.get(resourceNode.id) || []).map((edge) => [edge.id, sourceHandlePositions.get(edge.id) || Position.Bottom])),
        incomingHandleOffsets: Object.fromEntries((incoming.get(resourceNode.id) || []).map((edge) => [edge.id, targetHandleOffsets.get(edge.id) || 50])),
        outgoingHandleOffsets: Object.fromEntries((outgoing.get(resourceNode.id) || []).map((edge) => [edge.id, sourceHandleOffsets.get(edge.id) || 50])),
      },
    };
  });

  const flowEdges: ResourceMapFlowEdge[] = orderedEdges.flatMap((resourceEdge) => {
    const from = byId.get(resourceEdge.from);
    const to = byId.get(resourceEdge.to);
    if (!from || !to) return [];
    const dashed = resourceEdge.confidence !== "exact" || !resourceEdge.resolved;
    return [{
      id: resourceEdge.id,
      source: resourceEdge.from,
      target: resourceEdge.to,
      sourceHandle: `source-${resourceEdge.id}`,
      targetHandle: `target-${resourceEdge.id}`,
      type: "resourceMap",
      focusable: false,
      selectable: false,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: edgeStroke(resourceEdge) },
      style: {
        stroke: edgeStroke(resourceEdge),
        strokeWidth: resourceEdge.type === "namespace" ? 1.25 : 1.75,
        strokeDasharray: dashed ? "6 5" : undefined,
        opacity: resourceEdge.resolved ? 0.9 : 0.65,
      },
      data: {
        resourceEdge,
        fromIdentity: from.identity,
        toIdentity: to.identity,
        stepPosition: stepPositions.get(resourceEdge.id) || 0.5,
        selfLoop: resourceEdge.from === resourceEdge.to,
        routePoints: edgeRoutePoints.get(resourceEdge.id) || [],
      },
    }];
  });

  return { nodes: flowNodes, edges: flowEdges };
}
