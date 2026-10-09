import { describe, expect, it } from "vitest";
import type { ResourceMapEdge, ResourceOwnershipNode, ResourceOwnershipResponse } from "../../../types/api";
import { buildHelmReleaseResourceMap, helmManifestPresenceIdentities, isObservedHelmIdentity, mergeHelmOwnership } from "./helmReleaseResourceMapModel";

const declarations = [{ apiVersion: "apps/v1", kind: "Deployment", name: "app" }];
function fixture() {
  const base = buildHelmReleaseResourceMap("release", "ns", declarations);
  const requested = helmManifestPresenceIdentities(declarations, "ns")[0];
  const root: ResourceOwnershipNode = { id: "deployment:uid", identity: { ...requested, uid: "uid" }, depth: 0, direction: "current", availability: "present", navigable: true };
  const rs: ResourceOwnershipNode = { ...root, id: "rs:uid", identity: { ...root.identity, kind: "ReplicaSet", resource: "replicasets", name: "app-rs", uid: "rs-uid" }, direction: "child", depth: 1 };
  const pod: ResourceOwnershipNode = { ...rs, id: "pod:uid", identity: { ...rs.identity, group: "", kind: "Pod", resource: "pods", name: "app-pod", uid: "pod-uid" }, depth: 2 };
  const edge: ResourceMapEdge = { id: "owns-rs", from: root.id, to: rs.id, type: "owner", confidence: "exact", resolved: true, source: { type: "kubernetes", fieldPath: "metadata.ownerReferences" } };
  const ownership: ResourceOwnershipResponse = { active: "cluster", roots: [{ requested, identity: { ...requested, uid: "uid" }, resolved: true, availability: "present" }], nodes: [root, rs], edges: [edge], podGroups: [{ id: "group", ownerId: rs.id, observedCount: 1, countComplete: true, membersTruncated: false, members: [pod], states: { Running: 1 } }], maxMembers: 10, coverage: base.coverage, limits: { depth: 2, maxNodes: 100, maxEdges: 200, maxScanRecords: 50000 }, cache: base.cache, truncated: false };
  return { base, ownership, root, rs, pod };
}

describe("Helm canonical ownership merge", () => {
  it("merges declarations onto exact canonical UID identities and retains recursive descendant navigation", () => {
    const { base, ownership, root, rs, pod } = fixture();
    const merged = mergeHelmOwnership(base, ownership);
    expect(merged.nodes.map((n) => n.id)).toEqual([base.targetId, root.id, rs.id]);
    expect(merged.nodes[1].identity.uid).toBe("uid");
    expect(merged.edges.find((e) => e.type === "helmManifest")?.to).toBe(root.id);
    expect(merged.nodes[2].depth).toBe(2);
    expect(isObservedHelmIdentity(ownership, rs.identity)).toBe(true);
    expect(isObservedHelmIdentity(ownership, pod.identity)).toBe(true);
    expect(isObservedHelmIdentity(ownership, { ...pod.identity, uid: "replacement" })).toBe(false);
    expect(isObservedHelmIdentity(undefined, root.identity)).toBe(false);
    expect(mergeHelmOwnership(base, { ...ownership, nodes: [...ownership.nodes].reverse(), edges: [...ownership.edges].reverse(), roots: [...ownership.roots].reverse() })).toEqual(merged);
  });

  it("does not join a replacement UID, unresolved root, or same name in another API group", () => {
    const { base, ownership, root } = fixture();
    for (const identity of [{ ...root.identity, uid: "replacement" }, { ...root.identity, group: "other.example" }]) {
      const merged = mergeHelmOwnership(base, { ...ownership, nodes: [{ ...root, identity }] });
      expect(merged.nodes.map((n) => n.id)).toEqual(base.nodes.map((n) => n.id));
      expect(merged.nodes.some((n) => n.identity.uid)).toBe(false);
    }
    expect(mergeHelmOwnership(base, { ...ownership, roots: ownership.roots.map((r) => ({ ...r, resolved: false, availability: "unknown" })) }).nodes).toEqual(base.nodes);
  });

  it("does not attach disconnected omitted seeds and retains explicit projection truncation", () => {
    const { base, ownership, root } = fixture();
    const merged = mergeHelmOwnership({ ...base, truncated: true, truncationReasons: ["max-nodes"] }, { ...ownership, nodes: [...ownership.nodes, { ...root, id: "unrelated", identity: { ...root.identity, name: "unrelated", uid: "other" } }], truncated: true, truncationReasons: ["max-nodes", "max-depth"] });
    expect(merged.nodes.some((n) => n.id === "unrelated")).toBe(false);
    expect(merged.truncationReasons).toEqual(["max-depth", "max-nodes"]);
    expect(merged.coverage.completeness).toBe("partial");
    expect(merged.edges.every((e) => merged.nodes.some((n) => n.id === e.from) && merged.nodes.some((n) => n.id === e.to))).toBe(true);
  });

  it("filters unknown canonical routes before the seed cap and preserves declared served versions", () => {
    const custom = Array.from({ length: 110 }, (_, i) => ({ apiVersion: "a.example/v1", kind: "Widget", name: `w-${i}` }));
    expect(helmManifestPresenceIdentities([...custom, ...declarations], "ns")).toHaveLength(1);
    expect(helmManifestPresenceIdentities([{ apiVersion: "batch/v1beta1", kind: "CronJob", name: "job" }], "ns")[0].version).toBe("v1beta1");
  });
});
