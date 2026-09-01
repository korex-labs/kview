import { describe, expect, it } from "vitest";
import { Position } from "@xyflow/react";
import type { ApiResourceIdentity, ResourceMapEdge, ResourceMapNode } from "../../types/api";
import { buildResourceMapGraph, RESOURCE_MAP_NODE_HEIGHT, RESOURCE_MAP_NODE_WIDTH } from "./resourceMapGraphModel";

const identity: ApiResourceIdentity = {
  group: "apps",
  version: "v1",
  resource: "deployments",
  kind: "Deployment",
  scope: "namespaced",
  namespace: "prod",
  name: "api",
};

function node(id: string, direction: ResourceMapNode["direction"], depth: number, kind = "Deployment"): ResourceMapNode {
  return {
    id,
    identity: { ...identity, resource: `${kind.toLowerCase()}s`, kind, name: id },
    direction,
    depth,
    availability: "present",
    navigable: true,
    current: direction === "current",
  };
}

function edge(id: string, from: string, to: string, type: ResourceMapEdge["type"] = "owner"): ResourceMapEdge {
  return {
    id,
    from,
    to,
    type,
    source: { type: "kubernetes", fieldPath: "metadata.ownerReferences" },
    evidence: { description: "ownerReference" },
    confidence: "exact",
    resolved: true,
  };
}

function segmentIntersectsNode(
  start: { x: number; y: number },
  end: { x: number; y: number },
  position: { x: number; y: number },
): boolean {
  const left = position.x + 1;
  const right = position.x + RESOURCE_MAP_NODE_WIDTH - 1;
  const top = position.y + 1;
  const bottom = position.y + RESOURCE_MAP_NODE_HEIGHT - 1;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const p = [-dx, dx, -dy, dy];
  const q = [start.x - left, right - start.x, start.y - top, bottom - start.y];
  let entry = 0;
  let exit = 1;
  for (let index = 0; index < p.length; index += 1) {
    if (p[index] === 0) {
      if (q[index] < 0) return false;
      continue;
    }
    const ratio = q[index] / p[index];
    if (p[index] < 0) entry = Math.max(entry, ratio);
    else exit = Math.min(exit, ratio);
    if (entry > exit) return false;
  }
  return true;
}

describe("buildResourceMapGraph", () => {
  it("lays dependencies above the target and dependants below", () => {
    const result = buildResourceMapGraph(
      [node("child", "child", 1, "Pod"), node("target", "current", 0), node("parent", "parent", 1, "Namespace")],
      [edge("parent-target", "parent", "target", "namespace"), edge("target-child", "target", "child")],
    );
    const positions = new Map(result.nodes.map((item) => [item.id, item.position]));
    expect(positions.get("parent")!.y).toBeLessThan(positions.get("target")!.y);
    expect(positions.get("child")!.y).toBeGreaterThan(positions.get("target")!.y);
    expect(result.nodes.every((item) => item.width === RESOURCE_MAP_NODE_WIDTH && item.height === RESOURCE_MAP_NODE_HEIGHT)).toBe(true);
    expect(result.nodes.find((item) => item.id === "target")?.data.uiNavigable).toBe(false);
  });

  it("is deterministic for reversed node and edge input", () => {
    const nodes = [node("target", "current", 0), ...Array.from({ length: 10 }, (_, index) => node(`pod-${index}`, "child", 1, "Pod"))];
    const edges = nodes.slice(1).map((item, index) => edge(`edge-${index}`, "target", item.id));
    const first = buildResourceMapGraph(nodes, edges);
    const second = buildResourceMapGraph([...nodes].reverse(), [...edges].reverse());
    expect(second).toEqual(first);
    expect(new Set(first.nodes.filter((item) => item.id !== "target").map((item) => item.position.x)).size).toBeGreaterThan(3);
    expect(new Set(first.edges.map((item) => item.sourceHandle)).size).toBe(first.edges.length);
    expect(new Set(first.edges.map((item) => item.data?.stepPosition)).size).toBeGreaterThan(3);
  });

  it("assigns distinct anchors and lanes to parallel relationships", () => {
    const parallel = [
      edge("owner", "target", "child", "owner"),
      edge("reference", "target", "child", "objectReference"),
      edge("selector", "target", "child", "selector"),
    ];
    const result = buildResourceMapGraph([node("target", "current", 0), node("child", "child", 1, "Pod")], parallel);
    expect(new Set(result.edges.map((item) => item.sourceHandle)).size).toBe(3);
    expect(new Set(result.edges.map((item) => item.targetHandle)).size).toBe(3);
    expect(new Set(result.edges.map((item) => item.data?.stepPosition)).size).toBe(3);
    expect(new Set(result.edges.map((item) => JSON.stringify(item.data?.routePoints))).size).toBe(3);
  });

  it("keeps Dagre routes outside unrelated resource cards", () => {
    const nodes = [
      node("root", "parent", 1),
      node("left", "both", 1),
      node("middle", "both", 1),
      node("right", "both", 1),
      node("bottom", "child", 2),
    ];
    const edges = [
      edge("root-left", "root", "left"),
      edge("root-middle", "root", "middle"),
      edge("root-right", "root", "right"),
      edge("left-bottom", "left", "bottom"),
      edge("right-bottom", "right", "bottom"),
      edge("bottom-root", "bottom", "root", "objectReference"),
    ];
    const result = buildResourceMapGraph(nodes, edges);
    const positions = new Map(result.nodes.map((item) => [item.id, item.position]));
    for (const flowEdge of result.edges) {
      const route = flowEdge.data?.routePoints || [];
      expect(route.length).toBeGreaterThanOrEqual(2);
      for (const candidate of result.nodes) {
        if (candidate.id === flowEdge.source || candidate.id === flowEdge.target) continue;
        const intersects = route.slice(1).some((point, index) => segmentIntersectsNode(route[index], point, positions.get(candidate.id)!));
        expect(intersects, `${flowEdge.id} crosses ${candidate.id}`).toBe(false);
      }
    }
  });

  it("keeps cycles bounded and carries exact relationship evidence", () => {
    const cycleEdges = [
      edge("target-peer", "target", "peer", "objectReference"),
      { ...edge("peer-target", "peer", "target", "selector"), confidence: "high" as const, evidence: { selector: { app: "api" } } },
    ];
    const result = buildResourceMapGraph([node("target", "current", 0), node("peer", "both", 1, "Service")], cycleEdges);
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(2);
    expect(result.edges.find((item) => item.id === "peer-target")?.data?.resourceEdge.evidence?.selector).toEqual({ app: "api" });
    expect(result.nodes.find((item) => item.id === "target")?.data.outgoing.map((item) => item.id)).toEqual(["target-peer"]);
    expect(result.nodes.find((item) => item.id === "target")?.data.incoming.map((item) => item.id)).toEqual(["peer-target"]);
    expect(result.nodes.find((item) => item.id === "target")?.data.incomingHandlePositions["peer-target"]).toBe(Position.Bottom);
    expect(result.nodes.find((item) => item.id === "peer")?.data.outgoingHandlePositions["peer-target"]).toBe(Position.Top);
  });

  it("routes self-loops through distinct right-side anchors", () => {
    const result = buildResourceMapGraph([node("target", "current", 0)], [edge("loop", "target", "target", "objectReference")]);
    const target = result.nodes[0];
    expect(target.data.outgoingHandlePositions.loop).toBe(Position.Right);
    expect(target.data.incomingHandlePositions.loop).toBe(Position.Right);
    expect(result.edges[0].data?.selfLoop).toBe(true);
  });
});
