// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { DashboardSignalItem } from "../../types/api";
import { signalMemoryHintValue } from "./SignalMemoryHint";

function signal(patch: Partial<DashboardSignalItem>): DashboardSignalItem {
  return {
    kind: "Pod",
    severity: "medium",
    score: 50,
    reason: "Pod is restarting",
    ...patch,
  };
}

describe("signalMemoryHintValue", () => {
  it("prefers the seven-day recurrence window", () => {
    expect(signalMemoryHintValue(signal({ observedDays7d: 4, observedDays30d: 9 }))).toMatchObject({
      label: "Seen 4d / 7d",
    });
  });

  it("falls back to the thirty-day window", () => {
    expect(signalMemoryHintValue(signal({ observedDays7d: 1, observedDays30d: 3 }))).toMatchObject({
      label: "Seen 3d / 30d",
    });
  });

  it("hides single-day observations", () => {
    expect(signalMemoryHintValue(signal({ observedDays7d: 1, observedDays30d: 1 }))).toBeNull();
  });
});
