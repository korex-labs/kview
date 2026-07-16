import { describe, expect, it } from "vitest";
import { latestSignalDecision, snapshotMatchesSignal } from "./signalMemory";
import type { DashboardSignalItem, InvestigationSnapshot } from "./types/api";

const signal: DashboardSignalItem = {
  kind: "workload",
  namespace: "prod",
  name: "checkout",
  severity: "high",
  score: 90,
  reason: "Deployment unavailable",
  signalType: "deployment_unavailable",
  resourceKind: "deployments",
  resourceName: "checkout",
  focus: { resource: "deployments", namespace: "prod", filter: "checkout" },
};

function snapshot(overrides: Partial<InvestigationSnapshot> = {}): InvestigationSnapshot {
  return {
    id: "snapshot-1",
    context: "kind-dev",
    createdAt: 100,
    updatedAt: 100,
    title: "Checkout investigation",
    triageState: "watching",
    signal: { type: "deployment_unavailable" },
    primaryResource: { kind: "deployments", namespace: "prod", name: "checkout" },
    markdown: "# Investigation",
    operatorNote: "Watch rollout after the image fix",
    source: "investigate-signal",
    ...overrides,
  };
}

describe("signal memory saved context", () => {
  it("matches by signal type and primary resource identity", () => {
    expect(snapshotMatchesSignal(snapshot(), signal)).toBe(true);
    expect(snapshotMatchesSignal(snapshot({ primaryResource: { kind: "deployments", namespace: "staging", name: "checkout" } }), signal)).toBe(false);
    expect(snapshotMatchesSignal(snapshot({ signal: { type: "pod_crash_loop_waiting" } }), signal)).toBe(false);
  });

  it("uses the latest matching explicit decision", () => {
    const decision = latestSignalDecision(
      [
        snapshot({ id: "older", updatedAt: 100, triageState: "watching" }),
        snapshot({ id: "latest", updatedAt: 200, triageState: "resolved", operatorNote: "Fixed image tag" }),
        snapshot({ id: "other", updatedAt: 300, primaryResource: { kind: "deployments", namespace: "prod", name: "payments" } }),
      ],
      signal,
    );

    expect(decision?.snapshot.id).toBe("latest");
    expect(decision?.label).toBe("Previously resolved");
    expect(decision?.note).toBe("Fixed image tag");
  });

  it("labels ignored investigations as known noisy", () => {
    expect(latestSignalDecision([snapshot({ triageState: "ignored" })], signal)?.label).toBe("Known noisy");
  });
});
