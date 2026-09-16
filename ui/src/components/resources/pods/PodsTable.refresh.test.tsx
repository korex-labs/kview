// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ListFetchReason } from "../../../utils/useListQuery";
import useListQuery from "../../../utils/useListQuery";
import PodsTable from "./PodsTable";

const state = vi.hoisted(() => ({ context: "ctx-a", metrics: true, get: vi.fn() }));
vi.mock("../../../api", () => ({ apiGetWithContext: (...args: unknown[]) => state.get(...args) }));
vi.mock("../../../activeContext", () => ({ useActiveContext: () => state.context }));
vi.mock("../../../connectionState", () => ({ useConnectionState: () => ({ health: "healthy" }) }));
vi.mock("../../metrics/useMetricsStatus", () => ({ useMetricsStatus: () => ({}), isMetricsUsable: () => state.metrics }));
vi.mock("./PodDrawer", () => ({ default: () => null }));

type Row = { id: string; phase: string; cpuMilli?: number };
type Props = {
  fetchRows: (context?: string, reason?: ListFetchReason) => Promise<{ rows: Row[] }>;
  mapRows: (rows: Row[]) => Row[];
  dataplaneRefreshSec: number;
};
// Keep the actual list query lifecycle; replace only the DataGrid/drawer shell.
vi.mock("../../shared/ResourceListPage", () => ({ default: function List(props: Props) {
  const query = useListQuery({
    queryKey: [state.context, props.fetchRows], refreshSec: 0,
    fetchItems: (reason) => props.fetchRows(state.context, reason),
    mapRows: props.mapRows, fetchRevision: async () => "unchanged",
    revisionPollSec: 5, dataplaneRefreshSec: props.dataplaneRefreshSec,
  });
  return <><pre data-testid="rows">{JSON.stringify(query.items)}</pre><button onClick={() => void query.refetch()}>Refresh</button></>;
} }));

beforeEach(() => {
  state.context = "ctx-a";
  state.metrics = true;
  state.get.mockReset();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
const pods = { items: [{ namespace: "app", name: "pod", uid: "pod-instance", phase: "Running", cpuRequestMilli: 100 }] };
const sample = (cpuMilli: number) => ({ items: [{ namespace: "app", name: "pod", uid: "pod-instance", containers: [{ cpuMilli, memoryBytes: 1 }] }] });

describe("Pods refresh lanes", () => {
  it.each([true, false])("never relabels cached A metrics as same-name replacement B (sample UID: %s)", async (hasUID) => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(1_000_000);
    let currentPod = { ...pods.items[0], uid: "A", createdAt: 50 };
    let currentSample = { ...sample(91).items[0], uid: hasUID ? "A" : undefined, capturedAt: 100, windowSec: 20 };
    state.get.mockImplementation((path: string) => Promise.resolve({ items: [path.includes("podmetrics") ? currentSample : currentPod] }));
    await act(async () => { render(<PodsTable token="auth" namespace="app" />); });
    const rows = () => JSON.parse(screen.getByTestId("rows").textContent || "[]");
    expect(rows()[0]).toMatchObject({ uid: "A", cpuMilli: 91, cpuPctRequest: 91 });

    currentPod = { ...currentPod, uid: "B", createdAt: 200 };
    await act(async () => { fireEvent.click(screen.getByText("Refresh")); });
    expect(rows()[0].uid).toBe("B");
    expect(rows()[0].cpuMilli).toBeUndefined();
    expect(rows()[0].memoryBytes).toBeUndefined();
    expect(rows()[0].cpuPctRequest).toBeUndefined();
    // An independent metrics fetch AFTER B is visible still returns cached A.
    // Request-time association with the current UID is not identity evidence.
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(state.get.mock.calls.filter(([path]) => path.includes("podmetrics"))).toHaveLength(2);
    expect(rows()[0].cpuMilli).toBeUndefined();
    expect(rows()[0].usageAvailable).not.toBe(true);

    currentSample = { ...currentSample, uid: hasUID ? "B" : undefined, capturedAt: 300,
      containers: [{ cpuMilli: 22, memoryBytes: 2 }] };
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(rows()[0]).toMatchObject({ uid: "B", cpuMilli: 22, cpuPctRequest: 22, memoryBytes: 2, usageAvailable: true });
  });

  it("renders and manually refreshes status before slow metrics, then enriches without another pod fetch", async () => {
    let finish!: (value: unknown) => void;
    state.get.mockImplementation((path: string) => path.includes("podmetrics") ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve(pods));
    render(<PodsTable token="auth" namespace="app" />);
    await waitFor(() => expect(screen.getByTestId("rows").textContent).toContain("Running"));
    fireEvent.click(screen.getByText("Refresh"));
    await waitFor(() => expect(state.get).toHaveBeenCalledWith("/api/namespaces/app/pods?refresh=manual", "auth", "ctx-a"));
    await act(async () => finish(sample(42)));
    await waitFor(() => expect(screen.getByTestId("rows").textContent).toContain('"cpuMilli":42'));
    expect(state.get.mock.calls.filter(([path]) => !path.includes("podmetrics"))).toHaveLength(2);
  });

  it("advances the pod source on Off cadence with metrics disabled and unchanged revisions", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    state.metrics = false;
    state.get.mockResolvedValueOnce(pods).mockResolvedValue({ items: [{ ...pods.items[0], phase: "Failed" }] });
    render(<PodsTable token="auth" namespace="app" />);
    await waitFor(() => expect(screen.getByTestId("rows").textContent).toContain("Running"));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_100); });
    expect(state.get).toHaveBeenCalledWith("/api/namespaces/app/pods?refresh=auto", "auth", "ctx-a");
    expect(screen.getByTestId("rows").textContent).toContain("Failed");
    expect(state.get.mock.calls.some(([path]) => path.includes("podmetrics"))).toBe(false);
  });

  it("discards old-context metrics even when they complete after new-context metrics", async () => {
    let finishOld!: (value: unknown) => void;
    state.get.mockImplementation((path: string, _token: string, context: string) => {
      if (!path.includes("podmetrics")) return Promise.resolve(pods);
      return context === "ctx-a" ? new Promise((resolve) => { finishOld = resolve; }) : Promise.resolve(sample(22));
    });
    const view = render(<PodsTable token="auth" namespace="app" />);
    await waitFor(() => expect(screen.getByTestId("rows").textContent).toContain("Running"));
    state.context = "ctx-b";
    view.rerender(<PodsTable token="auth" namespace="app" />);
    await waitFor(() => expect(screen.getByTestId("rows").textContent).toContain('"cpuMilli":22'));
    await act(async () => finishOld(sample(99)));
    expect(screen.getByTestId("rows").textContent).toContain('"cpuMilli":22');
    expect(screen.getByTestId("rows").textContent).not.toContain('"cpuMilli":99');
  });
});
