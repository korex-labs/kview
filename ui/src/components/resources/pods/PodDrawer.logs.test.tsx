// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiGet } from "../../../api";
import { ActiveContextProvider } from "../../../activeContext";
import { UserSettingsProvider } from "../../../settingsContext";
import { loadUserSettings } from "../../../settings";
import PodDrawer from "./PodDrawer";
import type { ContextualKeyboardAction } from "../../../keyboard/KeyboardProvider";
const keyboard = vi.hoisted(() => ({ actions: [] as ContextualKeyboardAction[] }));
vi.mock("../../../keyboard/KeyboardProvider", async (original) => ({
  ...await original<typeof import("../../../keyboard/KeyboardProvider")>(),
  useContextualKeyboardActions: (actions: ContextualKeyboardAction[]) => { keyboard.actions = actions; },
}));

vi.mock("../../../api", async (original) => ({ ...await original<typeof import("../../../api")>(), apiGet: vi.fn() }));
vi.mock("../../../utils/useResourceSignals", () => ({ default: () => [] }));
vi.mock("../../metrics/useMetricsStatus", () => ({ useMetricsStatus: () => null, isMetricsUsable: () => false }));
vi.mock("../../shared/ResourceTags", () => ({ ResourceDrawerTags: () => null }));
vi.mock("../../shared/ResourceMacros", () => ({ ResourceDrawerMacros: () => null }));
vi.mock("../../shared/ResourceDynamicLinks", () => ({ default: () => null }));
vi.mock("../../shared/ResourceIdentityDrawer", () => ({ default: () => null }));
vi.mock("../../shared/ResourceMapPanel", () => ({ default: () => null }));
vi.mock("../../shared/CodeBlock", () => ({ default: ({ code }: { code: string }) => <pre>{code}</pre> }));
vi.mock("../../shared/YamlEditDialog", () => ({ default: () => null }));
vi.mock("../../mutations/useResourceCapabilities", () => ({ useResourceCapabilities: () => ({ patch: false }), RBAC_DISABLED_REASON: "Denied" }));
vi.mock("../../mutations/useMutationDialog", () => ({ useMutationDialog: () => ({ open: vi.fn() }) }));
vi.mock("./PodActions", () => ({ default: () => null }));

const details = {
  summary: { uid: "fixture-pod-uid", name: "sample", namespace: "fixture", phase: "Running", ready: "1/1", restarts: 1 },
  conditions: [], lifecycle: {}, resources: { podSecurityContext: {} },
  containers: [{ name: "main", state: "Running" }, { name: "sidecar", state: "Running" }],
  metadata: { labels: {}, annotations: {} }, yaml: "",
};
class Socket {
  static instances: Socket[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { wasClean: boolean }) => void) | null = null;
  close = vi.fn();
  constructor(readonly url: string) { Socket.instances.push(this); }
  message(data: string) { this.onmessage?.({ data }); }
}
function Harness({ context = "fixture-a", token = "fixture-token", namespace = "fixture", podName = "sample", open = true, initialTab = "logs" as "logs" | "overview" } = {}) {
  return <ActiveContextProvider value={context}><UserSettingsProvider>
    <PodDrawer open={open} token={token} namespace={namespace} podName={podName} initialTab={initialTab} onClose={vi.fn()} />
  </UserSettingsProvider></ActiveContextProvider>;
}
const latest = () => Socket.instances[Socket.instances.length - 1];
const button = (name: string) => screen.getByRole("button", { name });
const follow = () => fireEvent.click(button("Follow"));
function select(label: string, option: string) {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: label }));
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}
beforeEach(() => {
  Socket.instances = [];
  vi.stubGlobal("WebSocket", Socket);
  vi.mocked(apiGet).mockResolvedValue({ item: details });
});
afterEach(() => { cleanup(); localStorage.clear(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

describe("Pod logs sources", () => {
  it("starts only on Logs and the L action does not duplicate sockets", async () => {
    await act(async () => { render(<Harness initialTab="overview" />); });
    expect(Socket.instances).toHaveLength(0);
    const openLogs = () => keyboard.actions.find((action) => action.id === "drawer.tab.logs")!.run();
    act(() => { openLogs(); });
    expect(Socket.instances).toHaveLength(1);
    act(() => { openLogs(); });
    expect(Socket.instances).toHaveLength(1);
    for (const name of ["Current", "Follow", "Pretty JSON", "Wrap"]) {
      expect(button(name).getAttribute("aria-pressed")).toBe("true");
    }
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    expect(latest().close).toHaveBeenCalledOnce();
    act(() => { openLogs(); });
    expect(Socket.instances).toHaveLength(2);
  });

  it("keeps display edits connection-free and preserves preferences on Lines/source/container changes", async () => {
    await act(async () => { render(<Harness />); });
    const first = latest();
    act(() => first.message("match [literal]\nother"));
    fireEvent.change(screen.getByRole("textbox", { name: "Filter" }), { target: { value: "[literal]" } });
    fireEvent.click(button("Pretty JSON"));
    fireEvent.click(button("Wrap"));
    expect(Socket.instances).toHaveLength(1);
    expect(screen.getByText("match [literal]")).toBeTruthy();
    expect(screen.queryByText("other")).toBeNull();
    follow();
    expect(first.close).toHaveBeenCalledOnce();
    expect(screen.getByText("match [literal]")).toBeTruthy();
    select("Lines", "1000");
    expect(Socket.instances).toHaveLength(2);
    expect(Object.fromEntries(new URL(latest().url).searchParams)).toMatchObject({ tail: "1000", follow: "0" });
    for (const name of ["Follow", "Pretty JSON", "Wrap"]) expect(button(name).getAttribute("aria-pressed")).toBe("false");
    select("Container", "sidecar");
    expect(Socket.instances).toHaveLength(3);
    expect(button("Follow").getAttribute("aria-pressed")).toBe("true");
    for (const name of ["Pretty JSON", "Wrap"]) expect(button(name).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button("History"));
    expect(Socket.instances).toHaveLength(4);
    expect(button("Follow").getAttribute("aria-pressed")).toBe("false");
    expect(button("Pretty JSON").getAttribute("aria-pressed")).toBe("false");
    expect(button("Wrap").getAttribute("aria-pressed")).toBe("false");
    expect((screen.getByRole("textbox", { name: "Filter" }) as HTMLInputElement).value).toBe("[literal]");
    expect(Object.fromEntries(new URL(latest().url).searchParams)).toMatchObject({ tail: "1000", follow: "0", previous: "1" });
    fireEvent.click(button("Current"));
    expect(Object.fromEntries(new URL(latest().url).searchParams)).toMatchObject({ tail: "1000", follow: "1", previous: "0" });
  });

  it("changes font size without reconnecting, clearing payload, or replacing the scroll body", async () => {
    await act(async () => { render(<Harness />); });
    const socket = latest();
    act(() => socket.message("font-zoom-evidence"));
    const pre = screen.getByText("font-zoom-evidence").closest("pre")!;
    const scroll = pre.parentElement!;
    scroll.scrollTop = 31;
    const overlay = screen.getByRole("group", { name: "Text viewer font size" });
    expect(overlay.parentElement).toBe(scroll.parentElement);
    expect(getComputedStyle(overlay).position).toBe("absolute");
    expect(getComputedStyle(scroll).paddingBottom).toBe("52px");
    expect(overlay.textContent).toBe("");
    fireEvent.click(button("Increase text size"));
    expect(pre.style.fontSize).toBe("14px");
    expect(screen.getByText("font-zoom-evidence").closest("pre")!.parentElement).toBe(scroll);
    expect(scroll.scrollTop).toBe(31);
    expect(Socket.instances).toHaveLength(1);
    expect(socket.close).not.toHaveBeenCalled();
    expect(button("Follow").getAttribute("aria-pressed")).toBe("true");
    expect(loadUserSettings().logs).toEqual({ lines: 100, pretty: true, wrap: true });
  });

  it("persists display preferences across Pods, drawer reopen, and a fresh settings provider", async () => {
    const view = await act(async () => render(<Harness />));
    select("Lines", "500");
    fireEvent.click(button("Pretty JSON"));
    fireEvent.click(button("Wrap"));
    fireEvent.click(button("History"));
    expect(loadUserSettings().logs).toEqual({ lines: 500, pretty: false, wrap: false });
    const assertPreferences = () => {
      expect(screen.getByRole("combobox", { name: "Lines" }).textContent).toBe("500");
      for (const name of ["Pretty JSON", "Wrap"]) expect(button(name).getAttribute("aria-pressed")).toBe("false");
      expect(Object.fromEntries(new URL(latest().url).searchParams)).toMatchObject({ tail: "500", previous: "0", follow: "1" });
    };
    await act(async () => view.rerender(<Harness podName="another-pod" />));
    assertPreferences();
    await act(async () => view.rerender(<Harness podName="another-pod" open={false} />));
    await act(async () => view.rerender(<Harness podName="another-pod" />));
    assertPreferences();
    view.unmount();
    await act(async () => { render(<Harness podName="fresh-pod" />); });
    assertPreferences();
  });

  it.each(["error", "eof"])("does not reconnect on %s or local edits, but permits Retry", async (outcome) => {
    await act(async () => { render(<Harness />); });
    const socket = latest();
    act(() => { if (outcome === "error") socket.onerror?.(); else socket.onclose?.({ wasClean: true }); });
    fireEvent.click(button("Pretty JSON"));
    fireEvent.click(button("Wrap"));
    expect(Socket.instances).toHaveLength(1);
    fireEvent.click(button("Retry"));
    expect(Socket.instances).toHaveLength(2);
  });

  it("opens current and previous with bounded options, clears evidence, and ignores stale socket events", async () => {
    await act(async () => { render(<Harness />); });
    expect(Socket.instances).toHaveLength(1);
    const current = latest();
    const url = new URL(current.url);
    expect(url.pathname).toBe("/api/namespaces/fixture/pods/sample/logs/ws");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ context: "fixture-a", container: "main", tail: "100", follow: "1", previous: "0", uid: "fixture-pod-uid" });
    act(() => current.message("current-evidence"));
    expect(screen.getByText("current-evidence")).toBeTruthy();
    fireEvent.click(button("History"));
    expect(current.close).toHaveBeenCalledOnce();
    expect(screen.queryByText("current-evidence")).toBeNull();
    expect((button("Follow") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/Previous reads the last terminated instance/)).toBeNull();
    const previous = latest();
    expect(Object.fromEntries(new URL(previous.url).searchParams)).toMatchObject({ previous: "1", follow: "0", container: "main", uid: "fixture-pod-uid" });
    act(() => { current.message("stale-evidence"); current.onerror?.(); current.onclose?.({ wasClean: false }); previous.message("previous-evidence"); });
    expect(screen.queryByText("stale-evidence")).toBeNull();
    expect(screen.queryByText(/connection failed|closed unexpectedly/)).toBeNull();
    act(() => previous.onclose?.({ wasClean: true }));
    expect(screen.getByText("Previous container logs loaded.")).toBeTruthy();
    expect(screen.getByText("previous-evidence")).toBeTruthy();
    fireEvent.click(button("Current"));
    expect(screen.queryByText("previous-evidence")).toBeNull();
    expect(screen.queryByText("Previous container logs loaded.")).toBeNull();
    expect(button("Follow").getAttribute("aria-pressed")).toBe("true");
  });

  it("resets on container/tail changes and stops when leaving Logs", async () => {
    await act(async () => { render(<Harness />); });
    const first = latest();
    act(() => first.message("old-container"));
    select("Container", "sidecar");
    expect(first.close).toHaveBeenCalledOnce();
    expect(screen.queryByText("old-container")).toBeNull();
    const second = latest();
    expect(new URL(second.url).searchParams.get("container")).toBe("sidecar");
    select("Lines", "5000");
    expect(second.close).toHaveBeenCalledOnce();
    const third = latest();
    expect(new URL(third.url).searchParams.get("tail")).toBe("5000");
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    expect(third.close).toHaveBeenCalledOnce();
  });

  it.each(["context", "namespace", "podName", "token", "open"] as const)("retires sockets on %s change and unmount", async (dimension) => {
    const view = await act(async () => render(<Harness />));
    const old = latest();
    act(() => old.message("old-identity"));
    const changed = dimension === "open" ? { open: false } : { [dimension]: "fixture-b" };
    await act(async () => view.rerender(<Harness {...changed} />));
    expect(old.close).toHaveBeenCalledOnce();
    act(() => { old.message("late-identity"); old.onerror?.(); old.onclose?.({ wasClean: true }); });
    expect(screen.queryByText("old-identity")).toBeNull();
    expect(screen.queryByText("late-identity")).toBeNull();
    if (dimension !== "open") {
      const next = latest();
      const url = new URL(next.url);
      expect(url.searchParams.get("context")).toBe(dimension === "context" ? "fixture-b" : "fixture-a");
      expect(url.pathname).toBe(`/api/namespaces/${dimension === "namespace" ? "fixture-b" : "fixture"}/pods/${dimension === "podName" ? "fixture-b" : "sample"}/logs/ws`);
      view.unmount();
      expect(next.close).toHaveBeenCalledOnce();
    }
  });

  it("keeps previous-container failures visible and permits an explicit retry", async () => {
    await act(async () => { render(<Harness />); });
    fireEvent.click(button("History"));
    const failed = latest();
    act(() => {
      failed.message(JSON.stringify({ __kviewLogStream: true, type: "error", message: "previous terminated container not found" }));
      failed.onclose?.({ wasClean: false });
    });
    expect(screen.getByText("Log stream failed: previous terminated container not found")).toBeTruthy();
    expect(screen.queryByText("Previous container logs loaded.")).toBeNull();
    fireEvent.click(button("Retry"));
    expect(latest()).not.toBe(failed);
    expect(screen.queryByText(/Log stream failed:/)).toBeNull();
  });

  it("does not start a log read without a verified Pod UID", async () => {
    vi.mocked(apiGet).mockResolvedValue({ item: { ...details, summary: { ...details.summary, uid: "" } } });
    await act(async () => { render(<Harness />); });
    expect((button("Follow") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button("History"));
    expect((button("Follow") as HTMLButtonElement).disabled).toBe(true);
    expect(Socket.instances).toHaveLength(0);
  });

  it("waits for verified details and a container before automatically opening logs", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(apiGet).mockReturnValueOnce(new Promise((yes) => { resolve = yes; }));
    const view = await act(async () => render(<Harness />));
    expect(Socket.instances).toHaveLength(0);
    await act(async () => resolve({ item: details }));
    expect(Socket.instances).toHaveLength(1);
    expect(new URL(latest().url).searchParams.get("uid")).toBe("fixture-pod-uid");
    view.unmount();
    vi.mocked(apiGet).mockResolvedValue({ item: { ...details, containers: [] } });
    await act(async () => { render(<Harness />); });
    expect(Socket.instances).toHaveLength(1);
  });

  it("aborts a pending detail read on unmount without opening a socket", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(apiGet).mockReturnValueOnce(new Promise((yes) => { resolve = yes; }));
    const view = await act(async () => render(<Harness />));
    const signal = vi.mocked(apiGet).mock.calls[0][2]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve({ item: details }));
    expect(Socket.instances).toHaveLength(0);
  });

  it.each(["resolve", "reject"])("aborts detail reads and ignores late %s across contexts", async (outcome) => {
    let resolve!: (value: unknown) => void;
    let reject!: (reason: Error) => void;
    vi.mocked(apiGet).mockReturnValueOnce(new Promise((yes, no) => { resolve = yes; reject = no; }));
    const view = await act(async () => render(<Harness />));
    const options = vi.mocked(apiGet).mock.calls[0][2];
    expect(options?.headers).toEqual({ "X-Kview-Context": "fixture-a" });
    await act(async () => view.rerender(<Harness context="fixture-b" />));
    expect(options?.signal?.aborted).toBe(true);
    await act(async () => {
      if (outcome === "resolve") resolve({ item: { ...details, summary: { ...details.summary, uid: "obsolete-uid" } } });
      else reject(new Error("obsolete-detail-error"));
    });
    expect(screen.queryByText(/obsolete-detail-error/)).toBeNull();
    expect(Object.fromEntries(new URL(latest().url).searchParams)).toMatchObject({ context: "fixture-b", uid: "fixture-pod-uid" });
    view.unmount();
    expect(vi.mocked(apiGet).mock.calls[1][2]?.signal?.aborted).toBe(true);
  });
});
