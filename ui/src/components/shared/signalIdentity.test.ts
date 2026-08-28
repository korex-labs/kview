import { describe, expect, it } from "vitest";
import type { DashboardSignalItem } from "../../types/api";
import { signalWithHistoryKey } from "./signalIdentity";

function signal(overrides: Partial<DashboardSignalItem> = {}): DashboardSignalItem {
  return {
    kind: "Pod",
    namespace: "apps",
    name: "api-0",
    severity: "high",
    score: 10,
    reason: "Container is restarting",
    signalType: "pod_restarts",
    ...overrides,
  };
}

describe("signalWithHistoryKey", () => {
  it("marks a detail-derived history key as client synthesized", () => {
    const result = signalWithHistoryKey(signal());

    expect(result.historyKey).toBe("pod_restarts|Pod|api-0|apps|Container is restarting");
    expect(result.clientSynthesizedHistoryKey).toBe(true);
  });

  it("leaves a backend history key unmarked", () => {
    const backendSignal = signal({ historyKey: "backend-history-key" });

    const result = signalWithHistoryKey(backendSignal);

    expect(result).toBe(backendSignal);
    expect(result.clientSynthesizedHistoryKey).toBeUndefined();
  });

  it("preserves an existing synthetic marker", () => {
    const syntheticSignal = signal({
      historyKey: "previously-synthesized-key",
      clientSynthesizedHistoryKey: true,
    });

    expect(signalWithHistoryKey(syntheticSignal)).toBe(syntheticSignal);
    expect(signalWithHistoryKey(syntheticSignal).clientSynthesizedHistoryKey).toBe(true);
  });
});
