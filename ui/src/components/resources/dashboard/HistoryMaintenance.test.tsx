// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import DashboardHistoryTab from "./DashboardHistoryTab";
import { emptyHistoryCatalog } from "./historyOptions";
import { queryFromTrendURL, trendFixture } from "./signalTrends.testFixtures";
const props = { token: "synthetic-token", context: "synthetic-context", active: true };
const fetchMock = vi.fn();
const current = { key: '["worker","current-uid"]', label: "worker" };
const retained = { key: '["worker","retained-uid"]', label: "worker" };
function json(value: unknown) { return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } }); }
function response(path: string, init: RequestInit) {
  const context = new Headers(init.headers).get("X-Kview-Context")!;
  if (path === "/api/dataplane/signals/catalog") return json({ active: context, items: [] });
  if (path === "/api/history/inventory") return json({ ...emptyHistoryCatalog(), context, nodes: [current, { key: '["alpha","alpha-uid"]', label: "alpha" }] });
  const data = trendFixture(queryFromTrendURL(path, context));
  return json({ ...data, catalog: { ...emptyHistoryCatalog(), nodes: [retained] } });
}
function calls() { return fetchMock.mock.calls.filter(([path]) => path.startsWith("/api/history/signal-trends?")); }
function last() { return calls()[calls().length - 1]; }
function select(label: string, value: string) { fireEvent.mouseDown(screen.getByRole("combobox", { name: label })); fireEvent.click(screen.getByRole("option", { name: value })); }
async function flush() { await act(async () => {}); }
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
beforeEach(() => { localStorage.clear(); fetchMock.mockReset().mockImplementation(response); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("offers cached UID choices before any history and keeps checked/search/selected-first state across reads", async () => {
  let resolve!: (value: Response) => void;
  fetchMock.mockImplementation((path, init) => !path.startsWith("/api/history/signal-trends?") ? response(path, init) : new Promise<Response>(r => { resolve = r; }));
  render(<DashboardHistoryTab {...props} />); await flush();
  select("Nodes ranking", "Custom");
  const field = screen.getByRole("combobox", { name: "Select nodes" }) as HTMLInputElement;
  fireEvent.change(field, { target: { value: "worker" } });
  const choice = screen.getByRole("option", { name: /worker · cached/ });
  expect((within(choice).getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  fireEvent.click(choice); await flush();
  expect(field.value).toBe("worker");
  expect((within(screen.getByRole("option", { name: /worker · cached/ })).getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  expect(queryFromTrendURL(last()[0], props.context).nodes).toEqual([current.key]);
  fireEvent.change(field, { target: { value: "" } });
  expect(screen.getAllByRole("option")[0].textContent).toContain("worker · cached");
  expect(screen.getAllByRole("option")[1].textContent).toContain("alpha · cached");
  fetchMock.mockImplementation(response);
  await act(async () => resolve(response(last()[0], last()[1]))); await flush();
  fireEvent.change(field, { target: { value: "worker" } });
  expect(screen.getAllByRole("option").map(option => option.getAttribute("title"))).toEqual(["worker · cached", "worker · retained"]);
  expect((within(screen.getAllByRole("option")[0]).getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  expect(fetchMock.mock.calls.every(([path, init]) => (path.startsWith("/api/history/") || path === "/api/dataplane/signals/catalog") && init.method !== "POST")).toBe(true);
  for (const title of ["Severity", "Signal types", "Nodes", "Namespaces"]) expect(screen.getByRole("heading", { name: title })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Reload signals" })).toBeNull();
  expect(screen.queryByRole("button", { name: "History settings" })).toBeNull();
  expect(screen.queryByRole("checkbox", { name: "Enable signal history" })).toBeNull();
  expect(fetchMock.mock.calls.some(([path]) => path === "/api/history/settings")).toBe(false);
});
it("refreshes 60s after completion, never overlaps, pauses/aborts hidden and resumes once", async () => {
  vi.useFakeTimers();
  let state: DocumentVisibilityState = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => state);
  vi.spyOn(document, "hidden", "get").mockImplementation(() => state === "hidden");
  let resolve!: (value: Response) => void;
  fetchMock.mockImplementation((path, init) => !path.startsWith("/api/history/signal-trends?") ? response(path, init) : new Promise<Response>(r => { resolve = r; }));
  const view = render(<DashboardHistoryTab {...props} />); await flush();
  expect(calls()).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Refresh history" })).toBeNull();
  await advance(120000); expect(calls()).toHaveLength(1);
  await act(async () => resolve(response(last()[0], last()[1])));
  await advance(59999); expect(calls()).toHaveLength(1);
  await advance(1); expect(calls()).toHaveLength(2);
  const pending = last();
  await advance(120000); expect(calls()).toHaveLength(2);
  state = "hidden"; fireEvent(document, new Event("visibilitychange"));
  expect(pending[1].signal.aborted).toBe(true);
  await advance(180000); expect(calls()).toHaveLength(2);
  state = "visible"; fireEvent(document, new Event("visibilitychange")); expect(calls()).toHaveLength(3);
  fireEvent(document, new Event("visibilitychange")); expect(calls()).toHaveLength(3);
  const active = last();
  view.rerender(<DashboardHistoryTab {...props} active={false} />);
  expect(active[1].signal.aborted).toBe(true);
  await advance(120000); expect(calls()).toHaveLength(3);
  view.rerender(<DashboardHistoryTab {...props} />); await flush(); expect(calls()).toHaveLength(4);
  const resumed = last(); view.unmount(); expect(resumed[1].signal.aborted).toBe(true);
});
it("retries a failed trend read immediately and resumes automatic reads after failure", async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementation((path, init) => !path.startsWith("/api/history/signal-trends?") ? response(path, init) : Promise.reject(new Error("synthetic offline")));
  render(<DashboardHistoryTab {...props} />); await flush();
  expect(calls()).toHaveLength(1);
  expect(screen.getByText(/synthetic offline/)).toBeTruthy();
  await advance(59999); expect(calls()).toHaveLength(1);
  await advance(1); expect(calls()).toHaveLength(2);
  fetchMock.mockImplementation(response);
  fireEvent.click(screen.getByRole("button", { name: "Retry signals" })); await flush();
  expect(calls()).toHaveLength(3);
  expect(screen.queryByText(/synthetic offline/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry signals" })).toBeNull();
  await advance(60000); expect(calls()).toHaveLength(4);
  expect(fetchMock.mock.calls.every(([, init]) => init.method !== "POST")).toBe(true);
});
it("keeps a cached-choice error recoverable without a normal refresh button", async () => {
  fetchMock.mockImplementation((path, init) => path === "/api/history/inventory" ? Promise.reject(new Error("synthetic choices unavailable")) : response(path, init));
  render(<DashboardHistoryTab {...props} />); await flush();
  expect(screen.getByText(/Cached history choices unavailable/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Refresh history" })).toBeNull();
  fetchMock.mockImplementation(response);
  fireEvent.click(screen.getByRole("button", { name: "Retry choices" })); await flush();
  expect(screen.queryByText(/Cached history choices unavailable/)).toBeNull();
  expect(fetchMock.mock.calls.filter(([path]) => path === "/api/history/inventory")).toHaveLength(2);
  expect(calls()).toHaveLength(1);
});
it("keeps the rolled-forward shared window when a local ranking changes", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T10:59:30Z"));
  render(<DashboardHistoryTab {...props} />); await flush();
  const initial = queryFromTrendURL(last()[0], props.context);
  await advance(60000);
  const rolled = queryFromTrendURL(last()[0], props.context);
  expect(rolled.to).not.toBe(initial.to);
  select("Nodes ranking", "Top Changes 10"); await flush();
  expect(queryFromTrendURL(last()[0], props.context)).toMatchObject({ from: rolled.from, to: rolled.to, nodesMode: "topChanges10" });
  expect(calls()).toHaveLength(3);
  expect(fetchMock.mock.calls.filter(([path]) => path === "/api/dataplane/signals/catalog")).toHaveLength(1);
});
it.each(["context", "token"] as const)("aborts all in-flight readers on %s change and ignores late inventory", async field => {
  let resolve!: (value: Response) => void;
  fetchMock.mockImplementation((path) => path === "/api/history/inventory" ? new Promise<Response>(r => { resolve = r; }) : new Promise(() => {}));
  const view = render(<DashboardHistoryTab {...props} />);
  const oldCalls = [...fetchMock.mock.calls], finishOld = resolve;
  fetchMock.mockImplementation(response);
  view.rerender(<DashboardHistoryTab {...props} {...{ [field]: "synthetic-new" }} />); await flush();
  expect(oldCalls).toHaveLength(3); expect(oldCalls.every(([, init]) => init.signal.aborted)).toBe(true);
  await act(async () => finishOld(json({ ...emptyHistoryCatalog(), context: props.context, nodes: [{ key: '["stale","uid"]', label: "stale" }] })));
  select("Nodes ranking", "Custom"); await flush();
  fireEvent.change(screen.getByRole("combobox", { name: "Select nodes" }), { target: { value: "stale" } });
  expect(screen.queryByRole("option", { name: /stale/ })).toBeNull();
});
it("warns when the actual combined cached/retained choices exceed the cap", async () => {
  fetchMock.mockImplementation((path, init) => {
    if (path !== "/api/history/inventory") return response(path, init);
    return json({ ...emptyHistoryCatalog(), context: props.context, nodes: Array.from({ length: 4096 }, (_, i) => ({ key: JSON.stringify([`worker-${i}`, `uid-${i}`]), label: `worker-${i}` })) });
  });
  render(<DashboardHistoryTab {...props} />); await flush();
  expect(screen.getByText(/History choices reached the bounded catalog limit/)).toBeTruthy();
});
