import { afterEach, describe, expect, it, vi } from "vitest";
import { buildInvestigationSnapshot, listResourceInvestigationSnapshots } from "./investigationSnapshots";
import type { SignalInvestigationResult } from "./types/api";

function sampleInvestigation(): SignalInvestigationResult {
  return {
    signal: {
      kind: "Pod",
      resourceKind: "pods",
      name: "api-7f",
      resourceName: "api-7f",
      namespace: "app-prod",
      severity: "high",
      score: 90,
      reason: "CrashLoopBackOff",
      section: "workloads",
      signalType: "pod_crash_loop_waiting",
      firstSeenAt: 1000,
      lastSeenAt: 2000,
    },
    diagnosis: {
      summary: "The pod is repeatedly failing during startup.",
      confidence: "high",
    },
    primaryResource: {
      kind: "pods",
      namespace: "app-prod",
      name: "api-7f",
      relation: "primary",
    },
    relatedResources: [
      { kind: "deployments", namespace: "app-prod", name: "api", relation: "owner" },
    ],
    relatedSignals: [
      { kind: "Pod", namespace: "app-prod", name: "api-7f", severity: "medium", score: 40, reason: "Restarting", signalType: "pod_restart_elevated" },
    ],
    contextSignals: [
      { kind: "Pod", namespace: "app-prod", name: "worker", severity: "low", score: 20, reason: "Restarting", signalType: "pod_restart_elevated" },
    ],
    exportMarkdown: "# Investigation\n\nEvidence bundle.",
    generatedAt: 3000,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildInvestigationSnapshot", () => {
  it("maps an investigation result into a local snapshot payload", () => {
    const snapshot = buildInvestigationSnapshot(sampleInvestigation());

    expect(snapshot).toMatchObject({
      title: "Investigation: CrashLoopBackOff on pods api-7f",
      triageState: "investigating",
      signal: {
        type: "pod_crash_loop_waiting",
        title: "CrashLoopBackOff on pods api-7f",
        severity: "high",
        category: "workloads",
        observedAt: 2000,
      },
      primaryResource: {
        kind: "pods",
        namespace: "app-prod",
        name: "api-7f",
      },
      relatedResources: [{ kind: "deployments", namespace: "app-prod", name: "api" }],
      markdown: "# Investigation\n\nEvidence bundle.",
      operatorNote: "The pod is repeatedly failing during startup.",
      source: "investigate-signal",
    });
    expect(snapshot.relatedSignalTypes).toEqual(["pod_crash_loop_waiting", "pod_restart_elevated"]);
  });

  it("falls back to reason/kind when signalType and resource identity are sparse", () => {
    const result = sampleInvestigation();
    result.signal = {
      kind: "Namespace",
      namespace: "app-prod",
      severity: "medium",
      score: 10,
      reason: "Quota pressure",
    };
    result.primaryResource = { kind: "namespaces", name: "app-prod", relation: "primary" };

    const snapshot = buildInvestigationSnapshot(result);

    expect(snapshot.signal.type).toBe("Quota pressure");
    expect(snapshot.title).toBe("Investigation: Quota pressure on Namespace app-prod");
    expect(snapshot.primaryResource).toEqual({ kind: "namespaces", namespace: "", name: "app-prod" });
  });
});

describe("listResourceInvestigationSnapshots", () => {
  it("loads resource-scoped snapshots through the local API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      active: "kind-dev",
      items: [{ id: "snap-1", title: "Investigation", triageState: "investigating" }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listResourceInvestigationSnapshots("token", {
      resource: "pods",
      namespace: "app-prod",
      name: "api-7f",
    })).resolves.toEqual([{ id: "snap-1", title: "Investigation", triageState: "investigating" }]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/investigations/snapshots?kind=pods&namespace=app-prod&name=api-7f",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer token" }) }),
    );
  });
});
