import { describe, expect, it } from "vitest";
import type { ResourceMapEdge, ResourceOwnershipNode, ResourceOwnershipPodGroup } from "../../types/api";
import { isPodGroupNode, ownershipHistoryIDs, ownershipPresentation, visibleOwnerPodGroups } from "./resourceOwnershipPresentation";

function node(id: string, resource = "replicasets", group = "apps"): ResourceOwnershipNode {
  return { id, identity: { group, version: "v1", resource, kind: resource, scope: "namespaced", namespace: "apps", name: id, uid: id }, depth: 1, direction: "child", availability: "present", navigable: true };
}
function edge(from: string, to: string, type: ResourceMapEdge["type"] = "owner"): ResourceMapEdge {
  return { id: `${type}:${from}:${to}`, from, to, type, resolved: true, confidence: "exact", source: { type: "product" } };
}
function group(ownerId: string): ResourceOwnershipPodGroup {
  return { id: `pods:${ownerId}`, ownerId, observedCount: 30, countComplete: false, membersTruncated: true, states: { Running: 29, Failed: 1 }, members: Array.from({ length: 15 }, (_, i) => node(`${ownerId}-pod-${String(i).padStart(2, "0")}`, "pods", "")) };
}

describe("visible owner Pod grouping", () => {
  const pod = (id: string) => ({ ...node(id, "pods", ""), identity: { ...node(id, "pods", "").identity, kind: "Pod" } });

  it("groups only exact visible-owner leaves with honest subset counts and stable samples", () => {
    const pods = Array.from({ length: 20 }, (_, i) => pod(`pod-${String(i).padStart(2, "0")}`));
    const nodes = [node("owner"), ...pods];
    const edges = pods.map((p) => ({ ...edge("owner", p.id), evidence: { description: `owner evidence ${p.id}` } }));
    const groups = visibleOwnerPodGroups(nodes, edges, "owner");
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ observedCount: 20, countComplete: false, states: { Unknown: 20 } });
    expect(visibleOwnerPodGroups([...nodes].reverse(), [...edges].reverse(), "owner")).toEqual(groups);
    const collapsed = ownershipPresentation([nodes[0]], edges, groups, null);
    expect(collapsed.nodes).toHaveLength(2);
    const expanded = ownershipPresentation([nodes[0]], edges, groups, groups[0].id);
    expect(expanded.nodes).toHaveLength(12);
    expect(expanded.nodes.filter(isPodGroupNode)[0].visibleMembers).toBe(10);
    expect(expanded.edges).toEqual(expect.arrayContaining(edges.slice(0, 10)));
  });

  it("preserves targets, referenced Pods, ambiguous/unresolved owners, missing owners and singletons", () => {
    const ids = ["good-a", "good-b", "target", "reference", "ambiguous", "unresolved", "inexact", "orphan", "singleton"];
    const nodes = [node("owner"), node("other"), ...ids.map(pod)];
    const edges = ids.map((id) => edge(id === "orphan" ? "absent" : id === "singleton" ? "other" : "owner", id));
    edges.push(edge("reference", "owner", "objectReference"), edge("other", "ambiguous"));
    edges.find((e) => e.to === "unresolved")!.resolved = false;
    edges.find((e) => e.to === "inexact")!.confidence = "high";
    const groups = visibleOwnerPodGroups(nodes, edges, "target");
    expect(groups.map((g) => g.members.map((m) => m.id))).toEqual([["good-a", "good-b"]]);
    const grouped = new Set(groups.flatMap((g) => g.members.map((m) => m.id)));
    const projection = ownershipPresentation(nodes.filter((n) => !grouped.has(n.id)), edges, groups, null);
    expect(projection.nodes.some((n) => n.id === "target")).toBe(true);
    expect(projection.edges).toContainEqual(edges.find((e) => e.type === "objectReference"));
  });
});

describe("ownership presentation", () => {
  it("keeps owner-scoped groups distinct and expands only a deterministic ten-member sample", () => {
    const nodes = [node("a"), node("b")];
    const groups = [group("a"), group("b")];
    const projection = ownershipPresentation(nodes, [], groups, groups[0].id, 200);
    expect(projection.nodes).toHaveLength(14);
    const cards = projection.nodes.filter(isPodGroupNode);
    expect(cards.map((card) => card.owner.uid)).toEqual(["a", "b"]);
    expect(cards.map((card) => card.visibleMembers)).toEqual([10, 0]);
    expect(cards.every((card) => !("identity" in card))).toBe(true);
    expect(projection.truncated).toBe(false); // Server sampling is not a display-budget failure.
    expect(ownershipPresentation([...nodes].reverse(), [], [...groups].reverse().map((g) => ({ ...g, members: [...g.members].reverse() })), groups[0].id, 200).nodes.map((n) => n.id)).toEqual(projection.nodes.map((n) => n.id));
  });

  it("bounds topology, presentation cards and members together, with no dangling edges", () => {
    const nodes = [node("a"), node("b")];
    const groups = [group("a"), group("b")];
    const projection = ownershipPresentation(nodes, [edge("a", "b")], groups, groups[0].id, 7);
    expect(projection.nodes).toHaveLength(7);
    expect(projection.truncated).toBe(true);
    expect(projection.nodes.filter(isPodGroupNode)[0].visibleMembers).toBe(4);
    const ids = new Set(projection.nodes.map((n) => n.id));
    expect(projection.edges.every((e) => ids.has(e.from) && ids.has(e.to))).toBe(true);
    const collapsed = ownershipPresentation(nodes, [], groups, null, 7);
    expect(collapsed.nodes).toHaveLength(4);
    expect(collapsed.truncated).toBe(false);
    expect(collapsed.nodes.filter(isPodGroupNode).every((card) => card.visibleMembers === 0)).toBe(true);
  });

  it("leaves ordinary map membership and order unchanged without an explicit presentation budget", () => {
    const nodes = [node("z"), node("a")];
    const edges = [edge("z", "a")];
    expect(ownershipPresentation(nodes, edges, [], null)).toEqual({ nodes, edges, truncated: false });
  });

  it("classifies ReplicaSet history independently per Deployment and preserves unknown/current state", () => {
    const rs = (id: string, revision: number, desired = 0): ResourceOwnershipNode => ({ ...node(id), replicaSet: { revision, desired, ready: 0 } });
    const nodes = [node("d1", "deployments"), node("d2", "deployments"), rs("old", 1), rs("latest", 8), rs("other-current", 1), node("unknown"), rs("active", 2, 1)];
    const edges = [edge("d1", "old"), edge("d1", "latest"), edge("d2", "other-current"), edge("d1", "unknown"), edge("d1", "active")];
    expect([...ownershipHistoryIDs(nodes, edges)]).toEqual(["old"]);
    expect(ownershipHistoryIDs(nodes, [...edges, edge("helm", "old", "helmManifest")]).size).toBe(0);
  });

  it("hides successful terminal Jobs only, following ownership but not references or shared visible branches", () => {
    const nodes = [node("cron", "cronjobs", "batch"), node("other", "cronjobs", "batch"),
      { ...node("done", "jobs", "batch"), jobStatus: "Complete" },
      { ...node("failed", "jobs", "batch"), jobStatus: "Failed" }, node("unknown", "jobs", "batch"),
      node("pod", "pods", ""), node("shared", "pods", ""), node("ref", "configmaps", "")];
    const edges = [edge("cron", "done"), edge("cron", "failed"), edge("cron", "unknown"), edge("done", "pod"), edge("done", "shared"), edge("other", "shared"), edge("done", "ref", "objectReference")];
    const hidden = ownershipHistoryIDs(nodes, edges);
    expect([...hidden].sort()).toEqual(["done", "pod"]);
    expect(ownershipPresentation(nodes.filter((n) => !hidden.has(n.id)), edges, [group("done"), group("failed")], null).nodes.filter(isPodGroupNode).map((n) => n.owner.name)).toEqual(["failed"]);
  });
});
