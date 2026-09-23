// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DeploymentsTable from "./deployments/DeploymentsTable";
import StatefulSetsTable from "./statefulsets/StatefulSetsTable";
import DaemonSetsTable from "./daemonsets/DaemonSetsTable";
import ReplicaSetsTable from "./replicasets/ReplicaSetsTable";
import JobsTable from "./jobs/JobsTable";
import CronJobsTable from "./cronjobs/CronJobsTable";

const api = vi.hoisted(() => ({ get: vi.fn(), revision: vi.fn(), context: "ctx" }));
vi.mock("../../api", async (original) => ({ ...await original<object>(), apiGetWithContext: (...args: unknown[]) => api.get(...args) }));
vi.mock("../../activeContext", () => ({ useActiveContext: () => api.context }));
vi.mock("../../connectionState", () => ({ useConnectionState: () => ({ health: "healthy" }) }));
vi.mock("../../utils/dataplaneRevisionPoll", () => ({ dataplaneRevisionFetcher: () => api.revision, defaultRevisionPollSec: 5 }));
vi.mock("../../keyboard/KeyboardProvider", () => ({ useKeyboardControls: () => ({ keyboardSettings: {}, requestKeyboardFocus: vi.fn() }), useTableKeyboardControls: vi.fn() }));
vi.mock("../../settingsContext", async () => {
  const { defaultUserSettings } = await import("../../settings");
  const settings = defaultUserSettings(); settings.resourceTags.enabled = false;
  return { useUserSettings: () => ({ settings, setSettings: vi.fn() }) };
});
vi.mock("../../utils/useEmptyListAccessCheck", () => ({ default: () => null }));
// Only the detail bodies are isolated. Real shared list, DataGrid, toolbar,
// Live control, transport and causal query hooks remain mounted throughout.
vi.mock("./deployments/DeploymentDrawer", () => ({ default: ({ open }: { open: boolean }) => open ? <div data-testid="drawer" /> : null }));
vi.mock("./statefulsets/StatefulSetDrawer", () => ({ default: ({ open }: { open: boolean }) => open ? <div data-testid="drawer" /> : null }));
vi.mock("./daemonsets/DaemonSetDrawer", () => ({ default: ({ open }: { open: boolean }) => open ? <div data-testid="drawer" /> : null }));
vi.mock("./replicasets/ReplicaSetDrawer", () => ({ default: ({ open }: { open: boolean }) => open ? <div data-testid="drawer" /> : null }));
vi.mock("./jobs/JobDrawer", () => ({ default: ({ open }: { open: boolean }) => open ? <div data-testid="drawer" /> : null }));
vi.mock("./cronjobs/CronJobDrawer", () => ({ default: ({ open }: { open: boolean }) => open ? <div data-testid="drawer" /> : null }));

const fixtures = [
  ["deployments", DeploymentsTable], ["statefulsets", StatefulSetsTable],
  ["daemonsets", DaemonSetsTable], ["replicasets", ReplicaSetsTable],
  ["jobs", JobsTable], ["cronjobs", CronJobsTable],
] as const;
const row = { namespace: "app", name: "work-a", uid: "one", listStatus: "Ready", status: "Ready", ready: 1, desired: 1, active: 0, succeeded: 1, failed: 0, ageSec: 1, schedule: "* * * * *", suspend: false };
const snapshot = (revision: number, items = [row]) => ({ items, meta: { revision: String(revision) } });
const controls = () => within(screen.getByLabelText(/^Live=/).parentElement!);
// The accessible label identifies the control directly; avoid repeating computed-style
// traversal of the mounted grid for every transport-state assertion.
const chip = () => screen.getByLabelText(/^Live=/);
function assertState(state: string) { expect(chip().getAttribute("aria-label")).toMatch(new RegExp(`^Live=${state};`)); }
function visibility(value: string) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
  document.dispatchEvent(new Event("visibilitychange"));
}
function transport() {
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const cancellations: ReturnType<typeof vi.fn>[] = [];
  const fetcher = vi.fn().mockImplementation(() => {
    const cancel = vi.fn(); cancellations.push(cancel);
    return Promise.resolve(new Response(new ReadableStream({ start(c) { streams.push(c); }, cancel }), { headers: { "content-type": "text/event-stream" } }));
  });
  vi.stubGlobal("fetch", fetcher);
  const notify = async (resource: string, revision: number, index = streams.length - 1, context = api.context, namespace = "app") => {
    await act(async () => streams[index].enqueue(new TextEncoder().encode(`event: resource\ndata: ${JSON.stringify({ resource, scope: "Namespaced", context, namespace, state: "live", revision, stale: false })}\n\n`)));
  };
  return { fetcher, notify, cancellations };
}
beforeEach(() => {
  api.context = "ctx";
  api.revision.mockResolvedValue("1");
  api.get.mockResolvedValue(snapshot(1));
  visibility("visible");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetAllMocks(); window.localStorage.clear(); });

describe.each(fixtures)("%s Live real list", (resource, Table) => {
  it("applies notifications causally and preserves operator state", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const live = transport();
    let finish!: (value: unknown) => void;
    api.get.mockImplementation((path: string) => path.includes("refresh=revision") ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve(snapshot(1)));
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(<Table token="secret" namespace="app" />); });
    assertState("polling");
    expect(controls().getByRole("button", { name: "Refresh" })).toBeTruthy();
    const grid = screen.getByRole("grid");
    const scroller = view.container.querySelector(".MuiDataGrid-virtualScroller")!;
    fireEvent.doubleClick(screen.getByText("work-a"));
    expect(screen.getByTestId("drawer")).toBeTruthy();
    const filter = screen.getByLabelText(/^Filter /);
    fireEvent.change(filter, { target: { value: "work" } });
    const nameHeader = within(grid.querySelector('[role="rowgroup"]') as HTMLElement).getByRole("columnheader", { name: /Name/ });
    fireEvent.click(nameHeader);
    const sort = nameHeader.getAttribute("aria-sort");
    scroller.scrollTop = 80;
    fireEvent.click(chip());
    await waitFor(() => expect(live.fetcher).toHaveBeenCalledOnce());
    expect(live.fetcher.mock.calls[0][0]).toBe(`/api/namespaces/app/${resource}/live`);
    expect(live.fetcher.mock.calls[0][1].headers).toMatchObject({ Authorization: "Bearer secret", "X-Kview-Context": "ctx" });
    assertState("starting");
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
    if (resource === "cronjobs") expect(chip().title).toContain("Resource status only; Kubernetes Events are not streamed");
    await live.notify(resource, 2);
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    scroller.scrollTop = 80;
    assertState("starting");
    expect(api.get).toHaveBeenLastCalledWith(`/api/namespaces/app/${resource}?refresh=revision`, "secret", "ctx", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    // A successful HTTP response is not proof of notification coverage.
    await act(async () => finish(snapshot(1)));
    assertState("starting");
    await live.notify(resource, 3);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(3));
    await act(async () => finish(snapshot(3, [{ ...row, listStatus: "Failed" }])));
    assertState("live");
    expect(getComputedStyle(chip()).getPropertyValue("--scoped-chip-bg")).toBe("var(--chip-success-bg)");
    expect(within(screen.getByText("work-a").closest('[role="row"]') as HTMLElement).getByText("Failed")).toBeTruthy();
    expect(screen.getByRole("grid")).toBe(grid);
    expect(scroller.scrollTop).toBe(80);
    expect((filter as HTMLInputElement).value).toBe("work");
    expect(nameHeader.getAttribute("aria-sort")).toBe(sort);
    expect(screen.getByTestId("drawer")).toBeTruthy();
  });

  it("does not poll or refetch once the Live revision is applied", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const live = transport();
    await act(async () => { render(<Table token="secret" namespace="app" />); });
    await act(async () => { fireEvent.click(chip()); });
    api.get.mockResolvedValue(snapshot(2));
    await live.notify(resource, 2);
    assertState("live");
    const reads = api.get.mock.calls.length;
    const polls = api.revision.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(16000); });
    expect(api.get).toHaveBeenCalledTimes(reads);
    expect(api.revision).toHaveBeenCalledTimes(polls);
  });

  it("restores revision polling and manual refresh without adding metrics or Events reads", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const live = transport();
    await act(async () => { render(<Table token="secret" namespace="app" />); });
    fireEvent.click(chip());
    await waitFor(() => expect(live.fetcher).toHaveBeenCalledOnce());
    api.get.mockResolvedValue(snapshot(3));
    await live.notify(resource, 3);
    await waitFor(() => assertState("live"));
    const reads = api.get.mock.calls.length;
    const polls = api.revision.mock.calls.length;
    api.revision.mockResolvedValue("3");
    fireEvent.click(chip());
    assertState("polling");
    await waitFor(() => expect(live.cancellations[0]).toHaveBeenCalledOnce());
    await act(async () => { await vi.advanceTimersByTimeAsync(16000); });
    expect(api.revision.mock.calls.length).toBeGreaterThan(polls);
    expect(api.get).toHaveBeenCalledTimes(reads);
    api.revision.mockResolvedValue("4");
    api.get.mockResolvedValue(snapshot(4));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(api.get.mock.calls.length).toBeGreaterThan(reads);
    fireEvent.click(controls().getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(api.get.mock.calls.some(([path]) => path === `/api/namespaces/app/${resource}?refresh=manual`)).toBe(true));
    expect(api.get.mock.calls.every(([path]) => [`/api/namespaces/app/${resource}`, `/api/namespaces/app/${resource}?refresh=revision`, `/api/namespaces/app/${resource}?refresh=manual`].includes(path))).toBe(true);
  });

  it("queues an update before the initial read completes and retries a failed revision without a new frame", async () => {
    vi.useFakeTimers();
    const live = transport();
    let initial!: (value: unknown) => void;
    api.get.mockImplementationOnce(() => new Promise((resolve) => { initial = resolve; }))
      .mockRejectedValueOnce(new Error("snapshot unavailable"))
      .mockResolvedValue(snapshot(2));
    await act(async () => { render(<Table token="secret" namespace="app" />); });
    await act(async () => { fireEvent.click(chip()); });
    expect(live.fetcher).toHaveBeenCalledOnce();
    await live.notify(resource, 2);
    expect(api.get).toHaveBeenCalledOnce();
    assertState("starting");
    await act(async () => initial(snapshot(1)));
    expect(api.get).toHaveBeenCalledTimes(2);
    assertState("starting");
    // Advance the retry deadline explicitly: slow grid rendering must not race
    // the intermediate two-call assertion against a real one-second timer.
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    assertState("live");
    expect(api.get).toHaveBeenCalledTimes(3);
    expect(api.get.mock.calls.slice(1).every(([path]) => path.endsWith("?refresh=revision"))).toBe(true);
  });

  it.each(["hidden", "off", "unmount"])("cancels %s reads and ignores a transport that resolves after cancellation", async (action) => {
    const live = transport();
    let finish!: (value: unknown) => void;
    let signal!: AbortSignal;
    api.get.mockImplementation((path: string, _token: string, _context: string, options: { signal: AbortSignal }) => path.includes("refresh=revision") ? new Promise((resolve) => { finish = resolve; signal = options.signal; }) : Promise.resolve(snapshot(1)));
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(<Table token="secret" namespace="app" />); });
    fireEvent.click(chip());
    await waitFor(() => expect(live.fetcher).toHaveBeenCalledOnce());
    await live.notify(resource, 2);
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    if (action === "hidden") act(() => visibility("hidden"));
    else if (action === "off") fireEvent.click(chip());
    else view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => finish(snapshot(2, [{ ...row, name: "obsolete" }])));
    expect(screen.queryByText("obsolete")).toBeNull();
    await waitFor(() => expect(live.cancellations[0]).toHaveBeenCalledOnce());
    if (action !== "unmount") {
      assertState(action === "hidden" ? "paused" : "polling");
      expect(screen.getByText("work-a")).toBeTruthy();
    }
    if (action === "hidden") {
      api.get.mockResolvedValue(snapshot(2));
      act(() => visibility("visible"));
      await waitFor(() => expect(live.fetcher).toHaveBeenCalledTimes(2));
      assertState("starting");
      await live.notify(resource, 2);
      await waitFor(() => assertState("live"));
    }
  });

  it.each(["token", "context", "namespace"])("discards stale %s generation completion", async (dimension) => {
    const live = transport();
    let finish!: (value: unknown) => void;
    let signal!: AbortSignal;
    api.get.mockImplementation((path: string, _token: string, _context: string, options: { signal: AbortSignal }) => path.includes("refresh=revision") ? new Promise((resolve) => { finish = resolve; signal = options.signal; }) : Promise.resolve(snapshot(1)));
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(<Table token="secret" namespace="app" />); });
    fireEvent.click(chip());
    await waitFor(() => expect(live.fetcher).toHaveBeenCalledOnce());
    await live.notify(resource, 2);
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    if (dimension === "context") api.context = "other";
    await act(async () => view.rerender(<Table token={dimension === "token" ? "new-secret" : "secret"} namespace={dimension === "namespace" ? "other" : "app"} />));
    expect(signal.aborted).toBe(true);
    await act(async () => finish(snapshot(99, [{ ...row, name: "obsolete" }])));
    expect(screen.queryByText("obsolete")).toBeNull();
    assertState("starting");
    expect(live.fetcher).toHaveBeenCalledTimes(2);
    expect(api.get.mock.calls[api.get.mock.calls.length - 1]?.slice(0, 3)).toEqual([`/api/namespaces/${dimension === "namespace" ? "other" : "app"}/${resource}`, dimension === "token" ? "new-secret" : "secret", dimension === "context" ? "other" : "ctx"]);
  });

  it.each(["replacement", "disappearance", "uidless"])("clears selection and drawer on %s instead of claiming object continuity", async (change) => {
    const live = transport();
    const original = change === "uidless" ? { ...row, uid: "" } : row;
    api.get.mockResolvedValue(snapshot(1, [original]));
    await act(async () => { render(<Table token="secret" namespace="app" />); });
    fireEvent.doubleClick(screen.getByText("work-a"));
    expect(screen.getByTestId("drawer")).toBeTruthy();
    fireEvent.click(chip());
    await waitFor(() => expect(live.fetcher).toHaveBeenCalledOnce());
    api.get.mockResolvedValue(snapshot(2, change === "disappearance" ? [] : [{ ...original, uid: change === "replacement" ? "two" : "" }]));
    await live.notify(resource, 2);
    await waitFor(() => expect(screen.queryByTestId("drawer")).toBeNull());
    expect(document.querySelector('[role="row"][aria-selected="true"]')).toBeNull();
    assertState("live");
  });
});

it("switching workload kinds aborts the old stream/read and cannot publish its rows into the new table", async () => {
  const live = transport();
  let finish!: (value: unknown) => void;
  let signal!: AbortSignal;
  api.get.mockImplementation((path: string, _token: string, _context: string, options: { signal: AbortSignal }) => path.includes("refresh=revision") ? new Promise((resolve) => { finish = resolve; signal = options.signal; }) : Promise.resolve(snapshot(1)));
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<DeploymentsTable token="secret" namespace="app" />); });
  fireEvent.click(chip());
  await waitFor(() => expect(live.fetcher).toHaveBeenCalledOnce());
  await live.notify("deployments", 2);
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  await act(async () => view.rerender(<JobsTable token="secret" namespace="app" />));
  expect(signal.aborted).toBe(true);
  await act(async () => finish(snapshot(99, [{ ...row, name: "obsolete" }])));
  expect(screen.queryByText("obsolete")).toBeNull();
  assertState("polling");
  expect(screen.getByTestId("resource-list-jobs")).toBeTruthy();
});
