// @vitest-environment jsdom

import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import NamespaceDrawer from "./NamespaceDrawer";
import { notifyStatus } from "../../../connectionState";
import { dispatchSignalSuppressionsChanged } from "../../../signalSuppressions";

const apiGet = vi.fn();

vi.mock("../../../api", () => ({ apiGet: (...args: unknown[]) => apiGet(...args) }));
vi.mock("../../metrics/useMetricsStatus", () => ({
  useMetricsStatus: () => null,
  isMetricsUsable: () => false,
}));
vi.mock("../../layout/RightDrawer", () => ({
  default: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null,
}));
vi.mock("../../shared/ResourceDrawerShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../shared/ResourceTags", () => ({ ResourceDrawerTags: () => null }));
vi.mock("../../shared/ResourceMacros", () => ({ ResourceDrawerMacros: () => null }));
vi.mock("./NamespaceSignalsTab", () => ({
  default: ({ suppressedSignalCount, suppressedSignals }: { suppressedSignalCount?: number; suppressedSignals?: Array<{ name?: string }> }) => (
    <div data-testid="namespace-suppression-data">
      {suppressedSignalCount || 0}:{(suppressedSignals || []).map((signal) => signal.name).join(",")}
    </div>
  ),
}));
vi.mock("../pods/PodDrawer", () => ({ default: () => null }));
vi.mock("../deployments/DeploymentDrawer", () => ({ default: () => null }));
vi.mock("../jobs/JobDrawer", () => ({ default: () => null }));
vi.mock("../helm/HelmReleaseDrawer", () => ({ default: () => null }));
vi.mock("../horizontalpodautoscalers/HorizontalPodAutoscalerDrawer", () => ({ default: () => null }));
vi.mock("../customresources/CustomResourceDrawer", () => ({ default: () => null }));
vi.mock("../resourcequotas/ResourceQuotaDrawer", () => ({ default: () => null }));
vi.mock("../limitranges/LimitRangeDrawer", () => ({ default: () => null }));

function insightsResponse(count: number, name: string) {
  return {
    item: {
      summary: {},
      signals: [],
      suppressedSignalCount: count,
      suppressedSignals: [{
        kind: "Pod",
        namespace: "apps",
        name,
        severity: "medium",
        score: 5,
        reason: "Suppressed",
        suppression: { mode: "snooze", expiresAt: 2_000_000_000 },
      }],
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  apiGet.mockReset();
});

describe("NamespaceDrawer suppression refetch", () => {
  it("refetches open cached insights and replaces suppression data after a change", async () => {
    notifyStatus({
      ok: true,
      activeContext: "",
      backend: { ok: true },
      cluster: { ok: true, context: "" },
      checkedAt: new Date(0).toISOString(),
    });
    apiGet
      .mockResolvedValueOnce(insightsResponse(1, "old-suppressed"))
      .mockResolvedValueOnce(insightsResponse(2, "replacement-suppressed"));

    render(<NamespaceDrawer open onClose={vi.fn()} token="token" namespaceName="apps" />);

    await waitFor(() => expect(screen.getByTestId("namespace-suppression-data").textContent).toBe("1:old-suppressed"));
    dispatchSignalSuppressionsChanged();

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId("namespace-suppression-data").textContent).toBe("2:replacement-suppressed"));
    expect(apiGet.mock.calls.map((call) => call[0])).toEqual([
      "/api/namespaces/apps/insights",
      "/api/namespaces/apps/insights",
    ]);
  });

  it("keeps the newer refetch result and cache when the initial request resolves last", async () => {
    notifyStatus({
      ok: true,
      activeContext: "",
      backend: { ok: true },
      cluster: { ok: true, context: "" },
      checkedAt: new Date(0).toISOString(),
    });
    const initial = deferred<ReturnType<typeof insightsResponse>>();
    const refetch = deferred<ReturnType<typeof insightsResponse>>();
    const reopen = deferred<ReturnType<typeof insightsResponse>>();
    apiGet
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(refetch.promise)
      .mockReturnValueOnce(reopen.promise);

    const { rerender } = render(<NamespaceDrawer open onClose={vi.fn()} token="token" namespaceName="apps" />);
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));

    act(() => dispatchSignalSuppressionsChanged());
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    await act(async () => refetch.resolve(insightsResponse(2, "newer-suppressed")));
    expect(screen.getByTestId("namespace-suppression-data").textContent).toBe("2:newer-suppressed");

    await act(async () => initial.resolve(insightsResponse(1, "stale-suppressed")));
    expect(screen.getByTestId("namespace-suppression-data").textContent).toBe("2:newer-suppressed");

    rerender(<NamespaceDrawer open={false} onClose={vi.fn()} token="token" namespaceName="apps" />);
    rerender(<NamespaceDrawer open onClose={vi.fn()} token="token" namespaceName="apps" />);
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(3));
    expect(screen.getByTestId("namespace-suppression-data").textContent).toBe("2:newer-suppressed");
    await act(async () => reopen.resolve(insightsResponse(2, "newer-suppressed")));
  });
});
