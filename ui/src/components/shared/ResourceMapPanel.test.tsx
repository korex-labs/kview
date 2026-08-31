// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { apiGet } from "../../api";
import { ActiveContextProvider } from "../../activeContext";
import type { ApiResourceIdentity, ResourceMapResponse } from "../../types/api";
import ResourceMapPanel, { historicalReplicaSetNodeIDs, layoutResourceMap, ResourceMapSvg, summarizeResourceMapEvidence } from "./ResourceMapPanel";

vi.mock("../../api", () => ({ apiGet: vi.fn() }));
const identity: ApiResourceIdentity = { group: "apps", version: "v1", resource: "deployments", kind: "Deployment", scope: "namespaced", namespace: "prod", name: "api" };
const descriptors: Record<string, Pick<ApiResourceIdentity, "group" | "version" | "kind" | "scope">> = {
  pods: { group: "", version: "v1", kind: "Pod", scope: "namespaced" },
  deployments: { group: "apps", version: "v1", kind: "Deployment", scope: "namespaced" },
  namespaces: { group: "", version: "v1", kind: "Namespace", scope: "cluster" },
};
const node = (id: string, kind: string, name: string, direction: "current" | "parent" | "child" | "both", depth: number, resource: string) => {
  const descriptor = descriptors[resource] || { group: "", version: "v1", kind, scope: "namespaced" as const };
  return { id, identity: { ...identity, ...descriptor, kind, name, resource, namespace: descriptor.scope === "cluster" ? "" : identity.namespace }, direction, depth, availability: "present" as const, navigable: true, current: direction === "current" };
};
const response: ResourceMapResponse = {
  active: "ctx", targetId: "target", target: { id: "target", requested: identity, identity, resolved: true, availability: "present", navigable: true },
  nodes: [node("child", "Pod", "api-abc", "child", 1, "pods"), node("target", "Deployment", "api", "current", 0, "deployments"), node("parent", "Namespace", "prod", "parent", 1, "namespaces")],
  edges: [{ id: "e1", from: "parent", to: "target", type: "namespace", source: { type: "kubernetes", fieldPath: "metadata.namespace" }, evidence: { description: "namespace membership" }, confidence: "exact", resolved: true }, { id: "e2", from: "target", to: "child", type: "owner", source: { type: "kubernetes" }, confidence: "high", resolved: true }],
  coverage: { coverage: "full", completeness: "complete", families: {} }, truncated: false,
  limits: { depth: 2, maxNodes: 100, maxEdges: 200, maxScanRecords: 50000 },
  cache: { freshness: "hot", snapshotsPresent: 2, snapshotsMissing: 0, scannedRecords: 3, totalNodes: 3, returnedNodes: 3, totalEdges: 2, returnedEdges: 2 },
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("ResourceMapPanel", () => {
  it("lays parent above center and child below deterministically", () => {
    const first = layoutResourceMap(response.nodes, response.targetId);
    const second = layoutResourceMap([...response.nodes].reverse(), response.targetId);
    const positions = new Map(first.nodes.map((item) => [item.id, item.y]));
    expect(positions.get("parent")).toBeLessThan(positions.get("target")!);
    expect(positions.get("child")).toBeGreaterThan(positions.get("target")!);
    expect(second).toEqual(first);
  });

  it("wraps broad fan-out into compact centered rows", () => {
    const children = Array.from({ length: 10 }, (_, index) => node(`child-${index}`, "Pod", `api-${index}`, "child", 1, "pods"));
    const layout = layoutResourceMap([response.nodes[1], ...children], response.targetId);
    const childRows = new Map<number, number>();
    for (const item of layout.nodes.filter((candidate) => candidate.direction === "child")) {
      childRows.set(item.y, (childRows.get(item.y) || 0) + 1);
    }
    expect(layout.width).toBe(602);
    expect(childRows.size).toBe(4);
    expect(Math.max(...childRows.values())).toBe(3);
  });

  it("collapses direct zero-replica rollout history while preserving current and unknown ReplicaSets", () => {
    const current = { ...node("rs-current", "ReplicaSet", "api-current", "child", 1, "replicasets"), replicaSet: { revision: 10, desired: 0, ready: 0 } };
    const oldOne = { ...node("rs-old-1", "ReplicaSet", "api-old-1", "child", 1, "replicasets"), replicaSet: { revision: 1, desired: 0, ready: 0 } };
    const oldTwo = { ...node("rs-old-2", "ReplicaSet", "api-old-2", "child", 1, "replicasets"), replicaSet: { revision: 2, desired: 0, ready: 0 } };
    const unknown = node("rs-unknown", "ReplicaSet", "api-unknown", "child", 1, "replicasets");
    const terminatingPod = node("old-pod", "Pod", "api-old-1-terminating", "child", 2, "pods");
    const rollout: ResourceMapResponse = {
      ...response,
      nodes: [response.nodes[1], current, oldOne, oldTwo, unknown, terminatingPod],
      edges: [
        ...[current, oldOne, oldTwo, unknown].map((replicaSet, index) => ({ id: `owner-${index}`, from: response.targetId, to: replicaSet.id, type: "owner" as const, source: { type: "kubernetes" as const, fieldPath: "metadata.ownerReferences" }, evidence: { description: "ownerReference" }, confidence: "exact" as const, resolved: true })),
        { id: "owner-pod", from: oldOne.id, to: terminatingPod.id, type: "owner", source: { type: "kubernetes", fieldPath: "metadata.ownerReferences" }, evidence: { description: "ownerReference" }, confidence: "exact", resolved: true },
      ],
    };

    expect(historicalReplicaSetNodeIDs(rollout)).toEqual(["rs-old-1", "rs-old-2"]);
    expect(historicalReplicaSetNodeIDs({
      ...rollout,
      nodes: rollout.nodes.filter((candidate) => candidate.id !== oldTwo.id),
      edges: rollout.edges.filter((edge) => edge.from !== oldTwo.id && edge.to !== oldTwo.id),
    })).toEqual([]);
    render(<ResourceMapSvg response={rollout} onOpenResource={vi.fn()} />);
    expect(screen.getByRole("button", { name: "ReplicaSet: api-current, revision 10, desired 0, ready 0" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "ReplicaSet: api-unknown" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "ReplicaSet: api-old-1, revision 1, desired 0, ready 0" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pod: api-old-1-terminating" })).toBeNull();
    expect(screen.getByText("2 zero-replica historical ReplicaSets hidden")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show history" }));
    expect(screen.getByRole("button", { name: "ReplicaSet: api-old-1, revision 1, desired 0, ready 0" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pod: api-old-1-terminating" })).toBeTruthy();
    expect(screen.getByText("ReplicaSet · rev 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide history" }));
    expect(screen.queryByRole("button", { name: "ReplicaSet: api-old-1, revision 1, desired 0, ready 0" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pod: api-old-1-terminating" })).toBeNull();
  });

  it("collapses and groups repeated relationship evidence", () => {
    const repeated = Array.from({ length: 4 }, (_, index) => ({ ...response.edges[0], id: `namespace-${index}` }));
    const summaries = summarizeResourceMapEvidence(repeated);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].count).toBe(4);
    const view = render(<ResourceMapSvg response={{ ...response, edges: repeated }} onOpenResource={vi.fn()} />);
    expect(view.container.querySelector("details")?.hasAttribute("open")).toBe(false);
    expect(screen.getByText("Relationship details (4 edges · 1 evidence patterns)")).toBeTruthy();
    expect(screen.getByText("×4")).toBeTruthy();
  });

  it("opens only supported navigable nodes by click and keyboard", () => {
    const open = vi.fn();
    const unsupported = { ...response.nodes[0], id: "unsupported", identity: { ...identity, group: "", resource: "widgets", kind: "Widget", name: "api-abc" } };
    render(<ResourceMapSvg response={{ ...response, nodes: [...response.nodes, unsupported] }} onOpenResource={open} />);
    fireEvent.click(screen.getByRole("button", { name: "Pod: api-abc" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Namespace: prod" }), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Namespace: prod" }), { key: " " });
    fireEvent.click(screen.getByRole("button", { name: "Deployment: api" }));
    fireEvent.click(screen.getByRole("button", { name: "Widget: api-abc" }));
    expect(open).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("button", { name: "Widget: api-abc" }).hasAttribute("disabled")).toBe(true);
  });

  it("fetches the strict depth-2 query lazily and renders partial/truncated status", async () => {
    vi.mocked(apiGet).mockResolvedValue({ ...response, coverage: { coverage: "partial", completeness: "partial", families: {} }, cache: { ...response.cache, freshness: "unknown" }, truncated: true, truncationReasons: ["node limit"] });
    render(<ActiveContextProvider value="ctx"><ResourceMapPanel identity={identity} token="token" onOpenResource={vi.fn()} /></ActiveContextProvider>);
    expect(screen.getByLabelText("Loading resource map")).toBeTruthy();
    await screen.findByText(/Relationship coverage is partial/);
    expect(screen.queryByText("partial coverage")).toBeNull();
    expect(screen.queryByText("unknown cache")).toBeNull();
    expect(screen.getByText("3/3 nodes · 2/2 edges")).toBeTruthy();
    expect(screen.getByText(/Map truncated at API limits: node limit/)).toBeTruthy();
    expect(vi.mocked(apiGet).mock.calls[0][0]).toBe("/api/dataplane/resource-map?group=apps&version=v1&resource=deployments&kind=Deployment&scope=namespaced&namespace=prod&name=api&depth=2");
    expect(vi.mocked(apiGet).mock.calls[0][2]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("shows errors and aborts stale requests on identity change", async () => {
    vi.mocked(apiGet).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(response);
    const view = render(<ActiveContextProvider value="ctx"><ResourceMapPanel identity={identity} token="token" onOpenResource={vi.fn()} /></ActiveContextProvider>);
    await screen.findByText(/Resource Map is unavailable/);
    expect(screen.queryByText(/offline/)).toBeNull();
    view.rerender(<ActiveContextProvider value="ctx"><ResourceMapPanel identity={{ ...identity, name: "other" }} token="token" onOpenResource={vi.fn()} /></ActiveContextProvider>);
    await waitFor(() => expect(vi.mocked(apiGet)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(apiGet).mock.calls[0][2]?.signal?.aborted).toBe(true);
  });

  it("places bidirectional nodes beside the centered target and uses unique SVG markers", () => {
    const both = node("both", "Pod", "peer", "both", 1, "pods");
    const layout = layoutResourceMap([...response.nodes, both], response.targetId);
    const target = layout.nodes.find((item) => item.id === "target")!;
    const peer = layout.nodes.find((item) => item.id === "both")!;
    expect(target.x + 87).toBe(layout.width / 2);
    expect(peer.y).toBe(target.y);
    const view = render(<><ResourceMapSvg response={response} onOpenResource={vi.fn()} /><ResourceMapSvg response={response} onOpenResource={vi.fn()} /></>);
    const ids = Array.from(view.container.querySelectorAll("marker"), (marker) => marker.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("does not fetch without authentication", async () => {
    render(<ActiveContextProvider value="ctx"><ResourceMapPanel identity={identity} token="" onOpenResource={vi.fn()} /></ActiveContextProvider>);
    await screen.findByText(/Authentication is unavailable/);
    expect(apiGet).not.toHaveBeenCalled();
  });

  it("aborts and refetches when the active context changes", async () => {
    vi.mocked(apiGet).mockResolvedValue(response);
    const view = render(<ActiveContextProvider value="ctx"><ResourceMapPanel identity={identity} token="token" onOpenResource={vi.fn()} /></ActiveContextProvider>);
    await screen.findByRole("region", { name: "Resource relationship map" });
    const firstSignal = vi.mocked(apiGet).mock.calls[0][2]?.signal;
    view.rerender(<ActiveContextProvider value="ctx-2"><ResourceMapPanel identity={identity} token="token" onOpenResource={vi.fn()} /></ActiveContextProvider>);
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    expect(firstSignal?.aborted).toBe(true);
  });

  it("does not fetch or render server-owned context data before context bootstrap", async () => {
    render(<ActiveContextProvider value=""><ResourceMapPanel identity={identity} token="token" onOpenResource={vi.fn()} /></ActiveContextProvider>);
    await screen.findByText(/Select an active cluster context/);
    expect(apiGet).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Resource relationship map" })).toBeNull();
  });

  it("does not expose Kubernetes labels in the map node contract", () => {
    expect("labels" in response.nodes[0]).toBe(false);
  });
});
