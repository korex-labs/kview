// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mergePodMetrics } from "./PodsTable";

const now = 1_000;
const pod = {
  id: "app/pod", namespace: "app", name: "pod", uid: "B", createdAt: 800,
  phase: "Running", ready: "1/1", ageSec: 200,
  cpuRequestMilli: 100, cpuLimitMilli: 200, memoryRequestBytes: 100, memoryLimitBytes: 200,
};
const sample = {
  namespace: "app", name: "pod", capturedAt: 900, windowSec: 30,
  containers: [{ name: "main", cpuMilli: 42, memoryBytes: 64 }],
};

describe("Pod instance metrics join (backend identity contract)", () => {
  it.each([
    ["matching UID without time evidence", { uid: "B", capturedAt: undefined, windowSec: undefined }],
    ["matching UID at creation boundary", { uid: "B", capturedAt: 830 }],
    ["UID-less interval entirely after creation", {}],
    ["UID-less interval at now", { capturedAt: now }],
  ])("accepts %s", (_label, overrides) => {
    expect(mergePodMetrics([pod], [{ ...sample, ...overrides }], now)[0]).toMatchObject({
      cpuMilli: 42, memoryBytes: 64, cpuPctRequest: 42, cpuPctLimit: 21,
      memoryPctRequest: 64, memoryPctLimit: 32, usageAvailable: true,
    });
  });

  it.each([
    ["conflicting UID despite safe interval", { uid: "A" }],
    ["missing sample time", { capturedAt: undefined }],
    ["missing window", { windowSec: undefined }],
    ["zero time", { capturedAt: 0 }],
    ["zero window", { windowSec: 0 }],
    ["overlapping interval", { capturedAt: 820 }],
    ["equal interval boundary", { capturedAt: 830 }],
    ["future time", { capturedAt: now + 1 }],
    ["negative time", { capturedAt: -1 }],
    ["negative window", { windowSec: -1 }],
    ["window larger than time", { windowSec: 901 }],
    ["matching UID with contradictory interval", { uid: "B", capturedAt: 820 }],
    ["matching UID with future time", { uid: "B", capturedAt: now + 1 }],
    ["matching UID with negative time", { uid: "B", capturedAt: -1 }],
    ["matching UID with negative window", { uid: "B", windowSec: -1 }],
    ["matching UID with oversized window", { uid: "B", windowSec: 901 }],
    ["non-finite time", { uid: "B", capturedAt: Number.NaN }],
    ["non-finite window", { uid: "B", windowSec: Infinity }],
    ["another namespace", { namespace: "other" }],
    ["another name", { name: "other" }],
    ["empty containers", { containers: [] }],
  ])("rejects %s without touching backend fields", (_label, overrides) => {
    expect(mergePodMetrics([pod], [{ ...sample, ...overrides }], now)[0]).toBe(pod);
  });

  it.each([undefined, 0, -1, Number.NaN])("denies UID-less samples with unknown creation %s, not reconstructed age", (createdAt) => {
    const row = { ...pod, createdAt, ageSec: 999 };
    expect(mergePodMetrics([row], [sample], now)[0]).toBe(row);
  });

  it("requires interval proof when only the sample has a UID", () => {
    const row = { ...pod, uid: undefined };
    expect(mergePodMetrics([row], [{ ...sample, uid: "B", capturedAt: undefined }], now)[0]).toBe(row);
    expect(mergePodMetrics([row], [{ ...sample, uid: "B" }], now)[0].cpuMilli).toBe(42);
  });

  it("does not replace authoritative backend usage with an independent older sample, even for the same UID", () => {
    const row = { ...pod, cpuMilli: 12, memoryBytes: 24, cpuPctRequest: 12, cpuPctLimit: 6,
      memoryPctRequest: 24, memoryPctLimit: 12, usageAvailable: true };
    expect(mergePodMetrics([row], [{ ...sample, uid: "B" }], now)[0]).toBe(row);
    expect(mergePodMetrics([{ ...row, usageAvailable: undefined }], [sample], now)[0]).toEqual({ ...row, usageAvailable: undefined });
  });
});
