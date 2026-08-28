// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiGet } from "../api";
import { dispatchSignalSuppressionsChanged } from "../signalSuppressions";
import useResourceSignals from "./useResourceSignals";

vi.mock("../api", () => ({ apiGet: vi.fn() }));

const suppressedSignal = {
  kind: "Pod",
  namespace: "apps",
  name: "api-0",
  severity: "high",
  score: 10,
  reason: "Container is restarting",
  historyKey: "pod-restarts|apps|api-0",
  stateFingerprint: `v1:${"a".repeat(64)}`,
  suppression: { mode: "snooze", expiresAt: 2_000_000_000, comment: "maintenance" },
};

beforeEach(() => {
  vi.mocked(apiGet).mockResolvedValue({ signals: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useResourceSignals suppression support", () => {
  it("parses suppressed metadata and refetches after global invalidation", async () => {
    vi.mocked(apiGet)
      .mockResolvedValueOnce({
        signals: [],
        suppressedSignalCount: 1,
        suppressedSignals: [suppressedSignal],
      })
      .mockResolvedValueOnce({
        signals: [suppressedSignal],
        suppressedSignalCount: 0,
        suppressedSignals: [],
      });

    const { result } = renderHook(() => useResourceSignals({
      token: "token",
      scope: "namespace",
      namespace: "apps",
      kind: "pods",
      name: "api-0",
    }));

    await waitFor(() => expect(result.current.suppressedSignalCount).toBe(1));
    expect(result.current.suppressedSignals).toEqual([suppressedSignal]);
    expect(result.current.suppressedSignals[0].suppression).toEqual({
      mode: "snooze",
      expiresAt: 2_000_000_000,
      comment: "maintenance",
    });

    act(() => dispatchSignalSuppressionsChanged());

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.suppressedSignalCount).toBe(0));
    expect(result.current.suppressedSignals).toEqual([]);
  });

  it("uses safe defaults for malformed suppression fields", async () => {
    vi.mocked(apiGet).mockResolvedValueOnce({
      signals: [],
      suppressedSignalCount: Number.NaN,
      suppressedSignals: null,
    });

    const { result } = renderHook(() => useResourceSignals({
      token: "token",
      scope: "cluster",
      kind: "nodes",
      name: "node-a",
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.suppressedSignalCount).toBe(0);
    expect(result.current.suppressedSignals).toEqual([]);
  });

  it("clears suppressed state when disabled", async () => {
    vi.mocked(apiGet).mockResolvedValueOnce({
      signals: [],
      suppressedSignalCount: 1,
      suppressedSignals: [suppressedSignal],
    });

    const { result, rerender } = renderHook(
      ({ enabled }) => useResourceSignals({
        token: "token",
        scope: "cluster",
        kind: "nodes",
        name: "node-a",
        enabled,
      }),
      { initialProps: { enabled: true } },
    );

    await waitFor(() => expect(result.current.suppressedSignalCount).toBe(1));
    rerender({ enabled: false });
    await waitFor(() => expect(result.current.suppressedSignalCount).toBe(0));
    expect(result.current.suppressedSignals).toEqual([]);
  });
});
