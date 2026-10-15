import { afterEach, describe, expect, it, vi } from "vitest";
import dagre from "@dagrejs/dagre";

import { Position } from "@xyflow/react";
import type { ApiResourceIdentity, ResourceMapEdge, ResourceMapNode } from "../../types/api";
import { buildResourceMapGraph, RESOURCE_MAP_NODE_HEIGHT, RESOURCE_MAP_NODE_WIDTH } from "./resourceMapGraphModel";

afterEach(() => vi.restoreAllMocks());

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
    const peer = result.nodes.find((item) => item.id === "peer")!;
    const returnRoute = result.edges.find((item) => item.id === "peer-target")!.data!.routePoints;
    const sourceSide = peer.data.outgoingHandlePositions["peer-target"];
    expect([Position.Top, Position.Bottom]).toContain(sourceSide);
    // A cycle may wrap below the peer; the handle must follow the real route,
    // not the relative position of its destination.
    expect(returnRoute[0].y).toBe(peer.position.y + (sourceSide === Position.Top ? 0 : RESOURCE_MAP_NODE_HEIGHT));
  });

  it.each(["TB", "LR"] as const)("lays out parallel edges in a cycle (%s) without invalid intersections", (direction) => {
    const nodes = Array.from({ length: 11 }, (_, i) => node(String(i), "child", 1));
    const pairs = [[7,7],[10,4],[1,2],[4,1],[8,4],[3,9],[9,6],[8,4],[2,7],[4,1],[4,0],[0,9],[1,4],[3,5],[9,10]];
    const edges = pairs.map(([from, to], i) => edge(String(i), String(from), String(to)));
    const result = buildResourceMapGraph(nodes, edges, undefined, direction);
    expect(result.edges).toHaveLength(edges.length);
    expect(result.nodes.every(({ position }) => Number.isFinite(position.x) && Number.isFinite(position.y))).toBe(true);
    for (const item of result.edges) {
      if (item.data?.selfLoop) continue;
      expect(item.data?.routePoints.length).toBeGreaterThanOrEqual(2);
      expect(item.data?.routePoints.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    }
    expect(buildResourceMapGraph([...nodes].reverse(), [...edges].reverse(), undefined, direction)).toEqual(result);
  });

  it.each(["TB", "LR"] as const)("preserves the complete graph when Dagre fails (%s)", (direction) => {
    const nodes = [node("a", "current", 0), node("b", "child", 1), node("c", "child", 1)];
    const edges = [edge("ab", "a", "b"), edge("ab-ref", "a", "b", "objectReference"), edge("ba", "b", "a"), edge("loop", "c", "c")];
    vi.spyOn(dagre, "layout").mockImplementation((graph) => {
      // A failed library call may have partially mutated its input.
      graph.setNode("a", { x: NaN, y: NaN, width: 280, height: 112 });
      graph.setEdge("a", "b", { points: [{ x: NaN, y: NaN }] }, "ab");
      throw new Error("Not possible to find intersection inside of the rectangle");
    });
    const result = buildResourceMapGraph(nodes, edges, undefined, direction);
    expect(result.layoutFallback).toBe(true);
    expect(result.nodes).toHaveLength(nodes.length);
    expect(result.edges.map((item) => item.data?.resourceEdge)).toEqual(expect.arrayContaining(edges));
    expect(result.nodes.every(({ position }) => Number.isFinite(position.x) && Number.isFinite(position.y))).toBe(true);
    expect(new Set(result.nodes.map(({ position }) => JSON.stringify(position))).size).toBe(nodes.length);
    expect(result.edges.every((item) => item.data?.routePoints.length === 0)).toBe(true);
    expect(result.edges.find((item) => item.id === "loop")?.data?.selfLoop).toBe(true);
    expect(buildResourceMapGraph([...nodes].reverse(), [...edges].reverse(), undefined, direction)).toEqual(result);
  });

  it("keeps finite geometry across deterministic cyclic multigraph fixtures", () => {
    let seed = 42;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let fixture = 0; fixture < 20; fixture += 1) {
      const count = 3 + Math.floor(random() * 12);
      const nodes = Array.from({ length: count }, (_, i) => node(`n${i}`, "child", 1));
      const edges = Array.from({ length: count * 3 }, (_, i) => edge(`e${i}`, `n${Math.floor(random() * count)}`, `n${Math.floor(random() * count)}`));
      const result = buildResourceMapGraph(nodes, edges, undefined, fixture % 2 ? "TB" : "LR");
      expect(result.nodes).toHaveLength(count);
      expect(result.edges).toHaveLength(edges.length);
      expect(result.nodes.every(({ position }) => Number.isFinite(position.x) && Number.isFinite(position.y))).toBe(true);
      expect(result.edges.every((item) => item.data?.routePoints.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)))).toBe(true);
    }
  });

  it("recovers when Dagre returns non-finite coordinates without throwing", () => {
    vi.spyOn(dagre, "layout").mockImplementation((graph) => {
      graph.setNode("a", { x: NaN, y: Infinity, width: 280, height: 112 });
      return graph;
    });
    const result = buildResourceMapGraph([node("a", "current", 0)], []);
    expect(result.layoutFallback).toBe(true);
    expect(Number.isFinite(result.nodes[0].position.x)).toBe(true);
    expect(Number.isFinite(result.nodes[0].position.y)).toBe(true);
  });

  it.each(["TB", "LR"] as const)("lays out the captured Secret/ServiceAccount fan-in without recovery (%s)", (direction) => {
    // Anonymized topology reduced from the failing Deployment map: no cycle.
    const nodes = [node("b-deployment", "current", 0), node("a-secret", "parent", 1, "Secret"), node("c-account", "parent", 1, "ServiceAccount")];
    const edges = [
      edge("env", "a-secret", "b-deployment", "objectReference"),
      edge("envFrom", "a-secret", "b-deployment", "objectReference"),
      edge("volume", "a-secret", "b-deployment", "objectReference"),
      edge("serviceAccount", "c-account", "b-deployment", "objectReference"),
    ];
    const result = buildResourceMapGraph(nodes, edges, undefined, direction);
    expect(result.layoutFallback).toBe(false);
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(4);
    expect(new Set(result.edges.filter((item) => item.source === "a-secret").map((item) => JSON.stringify(item.data?.routePoints))).size).toBe(3);
    expect(buildResourceMapGraph([...nodes].reverse(), [...edges].reverse(), undefined, direction)).toEqual(result);
  });

  it("routes self-loops through distinct right-side anchors", () => {
    const result = buildResourceMapGraph([node("target", "current", 0)], [edge("loop", "target", "target", "objectReference")]);
    const target = result.nodes[0];
    expect(target.data.outgoingHandlePositions.loop).toBe(Position.Right);
    expect(target.data.incomingHandlePositions.loop).toBe(Position.Right);
    expect(result.edges[0].data?.selfLoop).toBe(true);
  });

  it("keeps strict navigation by default and accepts an explicit projection predicate", () => {
    const custom = {
      ...node("custom", "child", 1),
      navigable: true,
      identity: {
        ...identity,
        group: "cert-manager.io",
        resource: "",
        kind: "ClusterIssuer",
        scope: "unknown" as const,
        namespace: undefined,
        name: "production",
      },
    };
    expect(buildResourceMapGraph([custom], []).nodes[0].data.uiNavigable).toBe(false);
    expect(buildResourceMapGraph([custom], [], () => true).nodes[0].data.uiNavigable).toBe(true);
  });

  it("lays product fan-out left-to-right with children in a vertical column", () => {
    const nodes = [node("release", "current", 0), node("service", "child", 1), node("deployment", "child", 1)];
    const edges = [
      edge("release-service", "release", "service", "helmManifest"),
      edge("release-deployment", "release", "deployment", "helmManifest"),
    ];
    const result = buildResourceMapGraph(nodes, edges, () => true, "LR");
    const byId = new Map(result.nodes.map((item) => [item.id, item]));
    const release = byId.get("release")!;
    const service = byId.get("service")!;
    const deployment = byId.get("deployment")!;

    expect(service.position.x).toBeGreaterThan(release.position.x);
    expect(deployment.position.x).toBe(service.position.x);
    expect(deployment.position.y).not.toBe(service.position.y);
  });
});
