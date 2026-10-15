// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ResourceMapNode, ResourceMapResponse } from "../../types/api";
import { ResourceMapView } from "./ResourceMapPanel";
import { isPodGroupNode } from "./resourceOwnershipPresentation";
import type ResourceMapGraph from "./ResourceMapGraph";

const graph = vi.hoisted(() => vi.fn());
vi.mock("./ResourceMapGraph", () => ({ default: (props: React.ComponentProps<typeof ResourceMapGraph>) => { graph(props); return null; } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const owner: ResourceMapNode = {
  id: "owner", identity: { group: "apps", version: "v1", kind: "ReplicaSet", resource: "replicasets", scope: "namespaced", namespace: "test", name: "owner" },
  depth: 0, direction: "current", current: true, availability: "present", navigable: true,
};
const pods: ResourceMapNode[] = Array.from({ length: 20 }, (_, i) => ({
  ...owner, id: `pod-${i}`, current: false, direction: "child", depth: 1,
  identity: { ...owner.identity, group: "", kind: "Pod", resource: "pods", name: `pod-${i}` },
}));
const response: ResourceMapResponse = {
  active: "test", targetId: owner.id, target: { id: owner.id, identity: owner.identity, requested: owner.identity, resolved: true, availability: "present", navigable: true },
  nodes: [owner, ...pods],
  edges: pods.map((pod) => ({ id: `owner-${pod.id}`, from: owner.id, to: pod.id, type: "owner", confidence: "exact", resolved: true, source: { type: "kubernetes", fieldPath: "metadata.ownerReferences" } })),
  coverage: { coverage: "partial", completeness: "partial", families: {} }, truncated: true,
  limits: { depth: 2, maxNodes: 100, maxEdges: 200, maxScanRecords: 50000 },
  cache: { freshness: "hot", snapshotsPresent: 1, snapshotsMissing: 0, scannedRecords: 21, totalNodes: 21, returnedNodes: 21, totalEdges: 20, returnedEdges: 20 },
};
const latest = () => graph.mock.calls[graph.mock.calls.length - 1][0] as React.ComponentProps<typeof ResourceMapGraph>;

describe("ordinary map presentation", () => {
  it("collapses observed Pods and keeps graph inputs stable across unrelated rerenders", async () => {
    const open = vi.fn();
    const view = render(<ResourceMapView response={response} onOpenResource={open} />);
    await waitFor(() => expect(graph).toHaveBeenCalled());
    const first = latest();
    expect(first.nodes).toHaveLength(2);
    expect(first.nodes.filter(isPodGroupNode)[0].group.countComplete).toBe(false);
    view.rerender(<ResourceMapView response={response} onOpenResource={open} />);
    expect(latest().nodes).toBe(first.nodes);
    expect(latest().edges).toBe(first.edges);
    expect(latest().onToggleGroup).toBe(first.onToggleGroup);
  });

  it("honors explicit product groups, including an empty group list", async () => {
    render(<ResourceMapView response={response} podGroups={[]} onOpenResource={vi.fn()} />);
    await waitFor(() => expect(graph).toHaveBeenCalled());
    expect(latest().nodes).toHaveLength(21);
    expect(latest().nodes.some(isPodGroupNode)).toBe(false);
  });
});
