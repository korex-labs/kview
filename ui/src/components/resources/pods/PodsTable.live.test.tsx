// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PodsTable from "./PodsTable";

const api = vi.hoisted(() => ({ get: vi.fn(), revision: vi.fn().mockResolvedValue("1") }));
vi.mock("../../../api", async (original) => ({ ...await original<object>(), apiGetWithContext: (...args: unknown[]) => api.get(...args) }));
vi.mock("../../../activeContext", () => ({ useActiveContext: () => "ctx" }));
vi.mock("../../../connectionState", () => ({ useConnectionState: () => ({ health: "healthy" }) }));
vi.mock("../../../utils/dataplaneRevisionPoll", () => ({ dataplaneRevisionFetcher: () => api.revision, defaultRevisionPollSec: 5 }));
vi.mock("../../../keyboard/KeyboardProvider", () => ({ useKeyboardControls: () => ({ keyboardSettings: {}, requestKeyboardFocus: vi.fn() }), useTableKeyboardControls: vi.fn() }));
vi.mock("../../../settingsContext", async () => {
  const { defaultUserSettings } = await import("../../../settings");
  const settings = defaultUserSettings(); settings.resourceTags.enabled = false;
  return { useUserSettings: () => ({ settings, setSettings: vi.fn() }) };
});
vi.mock("../../../utils/useEmptyListAccessCheck", () => ({ default: () => null }));
vi.mock("../../metrics/useMetricsStatus", () => ({ useMetricsStatus: () => ({}), isMetricsUsable: () => true }));
vi.mock("./PodDrawer", () => ({ default: ({ open }: { open: boolean }) => open ? <div data-testid="pod-drawer" /> : null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks(); });

function liveControls() {
  // Keep accessible-role assertions, but restrict name/style computation to
  // the shared Live/Refresh control strip rather than every grid button.
  return within(screen.getByLabelText(/^Live=/).parentElement!);
}

function assertLiveChip(state: string, tone: string, pressed: boolean) {
  const chip = liveControls().getByRole("button", { name: `Live=${state}; ${pressed ? "disable Live and resume polling" : "enable Live"}` });
  expect(chip.textContent).toBe(`Live${state}`);
  expect(chip.getAttribute("aria-pressed")).toBe(String(pressed));
  expect(chip.getAttribute("tabindex")).toBe("0");
  const style = getComputedStyle(chip);
  expect(style.height).toBe("24px");
  expect(["", "auto"]).toContain(style.width);
  expect(style.minWidth).toBe("0px");
  const content = chip.querySelector(".MuiChip-label > span")!;
  expect(["", "auto"]).toContain(getComputedStyle(content).width);
  expect(["", "0"]).toContain(getComputedStyle(content.lastElementChild!).flexGrow);
  expect(style.getPropertyValue("--scoped-chip-bg")).toBe(`var(--chip-${tone}-bg)`);
  expect(style.getPropertyValue("--scoped-chip-fg")).toBe(`var(--chip-${tone}-fg)`);
  expect(style.getPropertyValue("--scoped-chip-border")).toBe(`var(--chip-${tone}-border)`);
  return chip;
}

it("streams into the real list only after committed fetch, preserves operator context, and keeps metrics independent", async () => {
  // Advance only the polling clock; the real grid's rendering/animation timers
  // must not advance the API clock according to machine/CI speed.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const fetcher = vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(c) { stream = c; }, cancel }), { headers: { "content-type": "text/event-stream" } }));
  vi.stubGlobal("fetch", fetcher);
  const pod = { namespace: "app", name: "pod-a", uid: "one", phase: "Running", ready: "1/1", ageSec: 1 };
  let finish!: (value: unknown) => void;
  api.get.mockImplementation((path: string) => {
    if (path.includes("podmetrics")) return Promise.resolve({ items: [] });
    if (path.includes("refresh=revision")) return new Promise((resolve) => { finish = resolve; });
    return Promise.resolve({ items: [pod], meta: { revision: "1" } });
  });
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<PodsTable token="secret" namespace="app" />); });
  assertLiveChip("polling", "default", false);
  expect(liveControls().getByRole("button", { name: "Refresh" }).parentElement).toBe(liveControls().getByRole("button", { name: /^Live=/ }).parentElement);
  fireEvent.doubleClick(screen.getByText("pod-a"));
  expect(fetcher).not.toHaveBeenCalled();
  const grid = screen.getByRole("grid");
  const scroller = view.container.querySelector(".MuiDataGrid-virtualScroller")!;
  scroller.scrollTop = 80;
  fireEvent.click(liveControls().getByRole("button", { name: /^Live=/ }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  assertLiveChip("starting", "warning", true);
  expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
  expect(liveControls().getByRole("button", { name: /^Live=starting;/ })).toBeTruthy();
  await act(async () => { stream.enqueue(new TextEncoder().encode('event: pods\ndata: {"context":"ctx","namespace":"app","state":"live","revision":2,"stale":false}\n\n')); });
  await waitFor(() => expect(api.get).toHaveBeenCalledWith("/api/namespaces/app/pods?refresh=revision", "secret", "ctx", expect.objectContaining({ signal: expect.any(AbortSignal) })));
  expect(liveControls().getByRole("button", { name: /^Live=starting;/ })).toBeTruthy();
  await act(async () => finish({ items: [{ ...pod, phase: "Failed" }], meta: { revision: "2" } }));
  await liveControls().findByRole("button", { name: /^Live=live;/ });
  assertLiveChip("live", "success", true);
  expect(screen.getByText("Failed")).toBeTruthy();
  expect(screen.getByRole("grid")).toBe(grid);
  expect(scroller.scrollTop).toBe(80);
  expect(screen.getByTestId("pod-drawer")).toBeTruthy();
  const revisions = api.revision.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(16000); });
  expect(api.get.mock.calls.filter(([path]) => path.includes("podmetrics"))).toHaveLength(2);
  expect(api.get.mock.calls.filter(([path]) => path.includes("/pods"))).toHaveLength(2);
  expect(api.revision).toHaveBeenCalledTimes(revisions);
  // The cached revision endpoint must agree with the committed SSE snapshot.
  // Leaving it at "1" starts an unresolved revision read on the first poll,
  // which correctly prevents the later automatic read from overlapping it.
  api.revision.mockResolvedValue("2");
  fireEvent.click(liveControls().getByRole("button", { name: /^Live=/ }));
  assertLiveChip("polling", "default", false);
  expect(liveControls().getByRole("button", { name: "Refresh" })).toBeTruthy();
  await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  await act(async () => { await vi.advanceTimersByTimeAsync(16000); });
  expect(api.get.mock.calls.some(([path]) => path.includes("refresh=auto"))).toBe(true);
});

it.each(["reconnecting", "paused", "blocked", "stopped"])("keeps %s honest, compact and keyboard-toggleable without metadata", async (state) => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(c) { stream = c; } }), { headers: { "content-type": "text/event-stream" } })));
  api.get.mockResolvedValue({ items: [] });
  await act(async () => { render(<PodsTable token="secret" namespace="app" />); });
  const chip = assertLiveChip("polling", "default", false);
  chip.focus();
  fireEvent.keyDown(chip, { key: "Enter", code: "Enter" });
  await waitFor(() => assertLiveChip("starting", "warning", true));
  await act(async () => {
    if (state === "paused") {
      // Paused is a client visibility state, not a server stream frame.
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    } else {
      stream.enqueue(new TextEncoder().encode(`event: pods\ndata: ${JSON.stringify({ context: "ctx", namespace: "app", state, revision: 0, stale: true, reason: "watch unavailable" })}\n\n`));
    }
  });
  const stateChip = assertLiveChip(state, state === "blocked" ? "error" : "warning", true);
  expect(stateChip).toBe(chip);
  expect(stateChip.getAttribute("title")).toContain("Updates this list when resource changes are reported");
  expect(stateChip.getAttribute("title")).toContain("Click to switch to periodic polling");
  expect(stateChip.getAttribute("title")).not.toContain("Live=");
  if (state !== "paused") expect(stateChip.getAttribute("title")).toContain("watch unavailable");
  expect(document.activeElement).toBe(chip);
  expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
  fireEvent.keyDown(chip, { key: " ", code: "Space" });
  fireEvent.keyUp(chip, { key: " ", code: "Space" });
  assertLiveChip("polling", "default", false);
  expect(liveControls().getByRole("button", { name: "Refresh" })).toBeTruthy();
});
