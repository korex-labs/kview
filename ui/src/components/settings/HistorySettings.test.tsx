// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import HistorySettings from "./HistorySettings";

const fetchMock = vi.fn();
const onSaved = vi.fn();
const props = { token: "synthetic-token", context: "synthetic-a", onSaved };
const defaults = { enabled: false, signalHistory: false, retentionDays: 30 };
function settings(context = props.context) {
  return { context, global: { ...defaults }, globalRevision: 0, override: {} as Partial<typeof defaults>, policy: { ...defaults, revision: 0, signalEpoch: "server-owned" }, editable: true, error: "", collector: { enabled: false }, signalHistoryCapability: { available: true } };
}
type State = ReturnType<typeof settings>;
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }); }
const posts = () => fetchMock.mock.calls.filter(([, init]) => init.method === "POST");
const body = (index = 0) => JSON.parse(posts()[index][1].body);
const toggle = (name = "Enable history for this context") => screen.getByRole("switch", { name: new RegExp(`^${name}`) }) as HTMLInputElement;
async function tick() { await act(async () => { await vi.advanceTimersByTimeAsync(350); }); }
async function mount(extra = {}) { let view!: ReturnType<typeof render>; await act(async () => { view = render(<HistorySettings {...props} {...extra} />); }); return view; }
function apply(state: State, init: RequestInit) {
  const { scope, revision: _revision, globalRevision: _global, reset, ...changes } = JSON.parse(String(init.body));
  if (scope === "global") { state.global = { ...state.global, ...changes }; state.globalRevision++; }
  else { state.override = { ...(reset ? {} : state.override), ...changes }; state.policy.revision++; }
  state.policy = { ...state.policy, ...state.global, ...state.override };
  state.collector.enabled = state.policy.enabled && state.policy.signalHistory;
}
function backend(state = settings()) {
  fetchMock.mockImplementation((_path, init: RequestInit) => { if (init.method === "POST") apply(state, init); return Promise.resolve(json(state)); });
  return state;
}
beforeEach(() => { vi.useFakeTimers(); fetchMock.mockReset(); onSaved.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("autosaves two edits once, reads back exact context, and never sends identity or unrelated preferences", async () => {
  const state = backend(); await mount();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: /Save history/ })).toBeNull();
  fireEvent.click(toggle());
  fireEvent.mouseDown(screen.getByRole("combobox", { name: /History retention/ }));
  fireEvent.click(screen.getByRole("option", { name: "90 days" }));
  expect(posts()).toHaveLength(0); await tick();
  expect(body()).toEqual({ scope: "context", revision: 0, globalRevision: 0, enabled: true, retentionDays: 90 });
  expect(fetchMock).toHaveBeenCalledTimes(3); expect(onSaved).toHaveBeenCalledTimes(1);
  expect(state.policy.signalHistory).toBe(false); expect(state.policy.signalEpoch).toBe("server-owned");
  expect(fetchMock.mock.calls.every(([path, init]) => path === "/api/history/settings" && new Headers(init.headers).get("X-Kview-Context") === props.context)).toBe(true);
  expect(screen.queryByRole("checkbox", { name: /Include Node|Cluster aggregate/ })).toBeNull();
  expect(screen.getByText("Stores resource names, namespaces, UIDs, node membership and signal transitions on this server.")).toBeTruthy();
});
it("coalesces rapid checkbox toggles without a redundant POST", async () => {
  backend(); await mount(); fireEvent.click(toggle()); fireEvent.click(toggle()); await tick(); expect(posts()).toHaveLength(0);
 expect(screen.getByRole("status", { name: "History settings save status" }).textContent).toBe("Saved");
});
it("serializes in-flight changes and preserves the last checkbox intent plus another input", async () => {
  const state = settings(); let finish!: () => void;
  fetchMock.mockImplementation((_path, init: RequestInit) => {
    if (init.method === "POST" && posts().length === 1) return new Promise<Response>(resolve => { finish = () => { apply(state, init); resolve(json(state)); }; });
    if (init.method === "POST") apply(state, init);
    return Promise.resolve(json(state));
  });
  await mount(); fireEvent.click(toggle()); await tick();
  expect(posts()).toHaveLength(1); expect(toggle().disabled).toBe(false);
  fireEvent.click(toggle()); fireEvent.click(toggle("Enable signal history")); await tick(); expect(posts()).toHaveLength(1);
  await act(async () => finish()); expect(toggle().checked).toBe(false); expect(toggle("Enable signal history").checked).toBe(true);
  await tick(); expect(posts()).toHaveLength(2);
  expect(body(1)).toEqual({ scope: "context", revision: 1, globalRevision: 0, enabled: false, signalHistory: true });
  expect(state.policy.enabled).toBe(false); expect(state.policy.signalHistory).toBe(true);
});
it("uses global scope explicitly and leaves signal consent off on retention edits", async () => {
  backend(); await mount({ scope: "global" });
  expect(screen.queryByRole("button", { name: "Reset to global defaults" })).toBeNull();
  fireEvent.click(toggle("Enable history by default")); await tick();
  expect(body()).toEqual({ scope: "global", revision: 0, globalRevision: 0, enabled: true });
  expect(toggle("Enable signal history").checked).toBe(false);
});
it("resets custom fields to inherited defaults with authoritative readback", async () => {
  const state = settings(); state.global.retentionDays = 90; state.override = { retentionDays: 30 }; backend(state); await mount();
  expect(screen.getByText("custom")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Reset to global defaults" })); await tick();
  expect(body()).toEqual({ scope: "context", revision: 0, globalRevision: 0, reset: true });
  expect(screen.queryByText("custom")).toBeNull();
  expect(screen.getByRole("combobox", { name: /History retention/ }).textContent).toContain("90 days");
});
it.each([409, 503])("keeps edits on %s and retries only on explicit action using fresh revisions", async code => {
  const state = settings(); let fail = true;
  fetchMock.mockImplementation((_path, init: RequestInit) => {
    if (init.method === "POST") {
      if (fail) { fail = false; state.policy.revision = 9; state.globalRevision = 4; return Promise.resolve(json({ error: "failed" }, code)); }
      apply(state, init);
    }
    return Promise.resolve(json(state));
  });
  await mount(); fireEvent.click(toggle()); await tick();
  expect(screen.getByText(/Your edits are kept/)).toBeTruthy(); expect(toggle().checked).toBe(true);
  await tick(); expect(posts()).toHaveLength(1);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry settings" })));
  await tick(); expect(body(1)).toEqual({ scope: "context", revision: 9, globalRevision: 4, enabled: true });
  expect(state.policy.enabled).toBe(true); expect(screen.queryByText(/Your edits are kept/)).toBeNull();
});
it("allows explicit discard after conflict, not silent lost edits", async () => {
  const state = settings(); fetchMock.mockImplementation((_p, init) => Promise.resolve(init.method === "POST" ? json({}, 409) : json(state)));
  await mount(); fireEvent.click(toggle()); await tick();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Discard edits" })));
  expect(toggle().checked).toBe(false); await tick(); expect(posts()).toHaveLength(1);
});
it.each(["context", "token", "scope", "unmount"])("cancels a pending POST and ignores its late result on %s", async field => {
  let finish!: (v: Response) => void;
  fetchMock.mockImplementation((_p, init: RequestInit) => init.method === "POST" ? new Promise<Response>(resolve => { finish = resolve; }) : Promise.resolve(json(settings(new Headers(init.headers).get("X-Kview-Context")!))));
  const view = await mount(); fireEvent.click(toggle()); await tick();
  const signal = posts()[0][1].signal as AbortSignal;
  await act(async () => {
    if (field === "unmount") view.unmount();
    else view.rerender(<HistorySettings {...props} {...(field === "context" ? { context: "synthetic-b" } : field === "token" ? { token: "new-token" } : { scope: "global" as const })} />);
  });
  const count = fetchMock.mock.calls.length; expect(signal.aborted).toBe(true);
  await act(async () => finish(json(settings()))); expect(fetchMock).toHaveBeenCalledTimes(count); expect(onSaved).not.toHaveBeenCalled();
});
it("ignores a late GET from the previous context", async () => {
  let finish!: (v: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
  const view = await mount(); fetchMock.mockResolvedValue(json(settings("synthetic-b")));
  await act(async () => view.rerender(<HistorySettings {...props} context="synthetic-b" />));
  await act(async () => finish(json({ ...settings(), policy: { ...settings().policy, enabled: true } })));
  expect(toggle().checked).toBe(false); expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
});
it("does not confirm a mismatched readback", async () => {
  fetchMock.mockResolvedValueOnce(json(settings())).mockResolvedValueOnce(json({})).mockResolvedValue(json(settings("wrong-context")));
  await mount(); fireEvent.click(toggle()); await tick(); expect(screen.getByText(/Your edits are kept/)).toBeTruthy(); expect(onSaved).not.toHaveBeenCalled(); expect(toggle().checked).toBe(true);
});
it("does not merge an obsolete failed POST into a newer reset", async () => {
  const state = settings(); state.override = { enabled: true }; state.policy.enabled = true;
  let reject!: (v: Response) => void;
  fetchMock.mockImplementation((_p, init: RequestInit) => {
    if (init.method === "POST" && posts().length === 1) return new Promise<Response>(resolve => { reject = resolve; });
    if (init.method === "POST") apply(state, init);
    return Promise.resolve(json(state));
  });
  await mount(); fireEvent.click(toggle("Enable signal history")); await tick();
  fireEvent.click(screen.getByRole("button", { name: "Reset to global defaults" }));
  await act(async () => reject(json({}, 409)));
  expect(toggle().checked).toBe(false); expect(toggle("Enable signal history").checked).toBe(false);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry settings" })));
  await tick(); expect(body(1)).toEqual({ scope: "context", revision: 0, globalRevision: 0, reset: true });
  expect(state.override).toEqual({});
});
it("keeps latest rapid edits after an in-flight conflict", async () => {
  const state = settings(); let finish!: (v: Response) => void;
  fetchMock.mockImplementation((_p, init: RequestInit) => {
    if (init.method === "POST" && posts().length === 1) return new Promise<Response>(resolve => { finish = resolve; });
    if (init.method === "POST") apply(state, init);
    return Promise.resolve(json(state));
  });
  await mount(); fireEvent.click(toggle()); await tick();
  fireEvent.click(toggle()); fireEvent.click(toggle("Enable signal history"));
  state.policy.revision = 5;
  await act(async () => finish(json({}, 409)));
  expect(toggle().checked).toBe(false); expect(toggle("Enable signal history").checked).toBe(true);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry settings" })));
  await tick(); expect(body(1)).toEqual({ scope: "context", revision: 5, globalRevision: 0, enabled: false, signalHistory: true });
});
it("shows another inheritor's safe failure without claiming the global save succeeded", async () => {
  const state = { ...settings(), collectionFailures: [] as { context: string; error: string; errorCode: string }[] };
  fetchMock.mockImplementation((_p, init: RequestInit) => {
    if (init.method === "POST") {
      apply(state, init);
      state.collectionFailures = [{ context: "synthetic-b", error: "Cache-only history source unavailable.", errorCode: "history_source_unavailable" }];
      return Promise.resolve(json(state, 503));
    }
    return Promise.resolve(json(state));
  });
  await mount({ scope: "global" }); fireEvent.click(toggle("Enable history by default")); await tick();
  expect(screen.getByText(/Collection · synthetic-b: Cache-only history source unavailable/)).toBeTruthy();
  expect(screen.getByText(/Saved defaults remain durable/)).toBeTruthy();
  expect(screen.getByRole("status", { name: "History settings save status" }).textContent).toBe("Defaults saved; collection needs attention");
  expect(state.global.enabled).toBe(true); expect(onSaved).not.toHaveBeenCalled();
});
it("uses a standard section with compact help and visible identity consent", async () => {
  backend(); await mount();
  expect(screen.getAllByText("History", { selector: "h6" })).toHaveLength(1);
  expect(screen.queryByText(/History settings ·|Custom settings for|Unchanged fields inherit/)).toBeNull();
  expect(screen.queryByText(/Shortening retention prunes/)).toBeNull();
  expect(screen.getByText(/Stores resource names, namespaces, UIDs, node membership/)).toBeTruthy();
  expect(toggle("Enable signal history").checked).toBe(false);
  const retention = screen.getByRole("combobox", { name: /History retention/ });
  const field = retention.closest(".MuiFormControl-root")! as HTMLElement;
  fireEvent.mouseOver(within(field).getByRole("button", { name: "More information" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  expect(screen.getByRole("tooltip").textContent).toContain("Increasing it cannot recover deleted observations.");
  expect(posts()).toHaveLength(0);
});
it("keeps startup recovery instructions visible and all policy controls locked", async () => {
  const recovery = "History is disabled because its settings could not be loaded or initialized. The existing file has been preserved and settings changes are blocked. Check permissions and format of kview/local-history/settings.json in your user configuration directory. To explicitly reset History consent, stop kview, move that file aside as a backup, then restart and opt in again in History settings.";
  fetchMock.mockResolvedValue(json({ ...settings(), editable: false, error: recovery }));
  await mount();
  expect(screen.getAllByRole("alert").some(alert => alert.textContent === recovery)).toBe(true);
  expect(toggle().disabled).toBe(true);
  expect(toggle("Enable signal history").disabled).toBe(true);
  expect(screen.getByRole("combobox", { name: /History retention/ }).getAttribute("aria-disabled")).toBe("true");
  expect((screen.getByRole("button", { name: "Reset to global defaults" }) as HTMLButtonElement).disabled).toBe(true);
  await tick(); expect(posts()).toHaveLength(0);
});
it("offers an actionable retry when initial loading fails", async () => {
  fetchMock.mockRejectedValueOnce(new Error("synthetic failure")).mockResolvedValue(json(settings()));
  await mount();
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toContain("Could not load history settings. Check access and retry.");
  await act(async () => fireEvent.click(within(alert).getByRole("button", { name: "Retry settings" })));
  expect(toggle().checked).toBe(false);
  expect(screen.queryByRole("alert")).toBeNull();
  await tick(); expect(posts()).toHaveLength(0);
});
it("locks noneditable settings and opening never writes", async () => {
  fetchMock.mockResolvedValue(json({ ...settings(), editable: false })); await mount(); expect(toggle().disabled).toBe(true); await tick(); expect(posts()).toHaveLength(0);
});
