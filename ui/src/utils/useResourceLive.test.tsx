// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import useResourceLive, { type ResourceLiveOptions } from "./useResourceLive";
import useResourceLiveSnapshot, { resourceLiveDisplayState } from "./useResourceLiveSnapshot";
const subscribe = vi.hoisted(() => vi.fn());
vi.mock("./resourceLive", async (original) => ({ ...await original<object>(), apiSubscribeResource: (...args: unknown[]) => subscribe(...args) }));
const options: ResourceLiveOptions = { token: "token", contextName: "ctx", namespace: "app", resource: "deployments", enabled: true };
const update = { resource: "deployments" as const, scope: "Namespaced" as const, context: "ctx", namespace: "app", revision: 7, state: "live" as const, stale: false };
beforeEach(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); });
afterEach(() => { cleanup(); subscribe.mockReset(); vi.restoreAllMocks(); vi.useRealTimers(); });
it.each([{ token: "new" }, { contextName: "other" }, { namespace: "other" }, { resource: "jobs" as const }])("guards the render before effects and cancels old generation %j", (change) => {
  subscribe.mockImplementation(() => new Promise(() => undefined));
  const renders: string[] = [];
  const { result, rerender, unmount } = renderHook((props) => { const live = useResourceLive(props); renders.push(live.state); return live; }, { initialProps: options });
  act(() => subscribe.mock.calls[0][5](update));
  expect(result.current.state).toBe("live");
  renders.length = 0;
  rerender({ ...options, ...change });
  expect(renders[0]).toBe("starting");
  expect(subscribe.mock.calls[0][4].aborted).toBe(true);
  act(() => subscribe.mock.calls[0][5]({ ...update, revision: 100 }));
  expect(result.current.state).toBe("starting");
  expect(result.current).not.toHaveProperty("update");
  unmount();
  expect(subscribe.mock.calls[1][4].aborted).toBe(true);
});
it.each([{ token: "new" }, { contextName: "other" }, { namespace: "other" }, { resource: "jobs" as const }, { enabled: false }])("does not carry applied revision across identity changes %j", (change) => {
  const { result, rerender } = renderHook(useResourceLiveSnapshot, { initialProps: options });
  act(() => result.current.onSnapshotRevision("7"));
  expect(result.current.appliedRevision).toBe("7");
  const oldCallback = result.current.onSnapshotRevision;
  rerender({ ...options, ...change });
  expect(result.current.appliedRevision).toBeUndefined();
  act(() => oldCallback("100"));
  expect(result.current.appliedRevision).toBeUndefined();
  act(() => result.current.onSnapshotRevision("7"));
  expect(result.current.appliedRevision).toBe("7");
});
it("requires a nonstale committed notification and applied snapshot without changing revisions", () => {
  expect(resourceLiveDisplayState("live", update, "6")).toBe("starting");
  expect(resourceLiveDisplayState("live", update, undefined)).toBe("starting");
  expect(resourceLiveDisplayState("live", update, "invalid")).toBe("starting");
  expect(resourceLiveDisplayState("live", { ...update, stale: true }, "8")).toBe("starting");
  expect(resourceLiveDisplayState("live", { ...update, revision: 0 }, "8")).toBe("starting");
  expect(resourceLiveDisplayState("live", update, "7")).toBe("live");
  expect(resourceLiveDisplayState("reconnecting", update, "7")).toBe("reconnecting");
  expect(update.revision).toBe(7);
});
it("releases hidden/off generations and never revives old updates on resume", () => {
  subscribe.mockImplementation(() => new Promise(() => undefined));
  const { result, rerender, unmount } = renderHook(useResourceLive, { initialProps: options });
  act(() => subscribe.mock.calls[0][5](update));
  act(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  expect(result.current.state).toBe("paused");
  expect(result.current).not.toHaveProperty("update");
  expect(subscribe.mock.calls[0][4].aborted).toBe(true);
  act(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  expect(result.current.state).toBe("starting");
  act(() => subscribe.mock.calls[1][5](update));
  rerender({ ...options, enabled: false });
  expect(result.current.state).toBe("off");
  expect(subscribe.mock.calls[1][4].aborted).toBe(true);
  rerender(options);
  act(() => subscribe.mock.calls[1][5](update));
  expect(result.current.state).toBe("starting");
  unmount();
  expect(subscribe.mock.calls[2][4].aborted).toBe(true);
});
it.each(["blocked", "stopped"])("releases terminal %s streams without retries", async (state) => {
  vi.useFakeTimers();
  subscribe.mockImplementation(async (...args) => { args[5]({ ...update, state }); });
  const { result } = renderHook(() => useResourceLive(options));
  await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
  expect(result.current.state).toBe(state);
  expect(subscribe.mock.calls[0][4].aborted).toBe(true);
  expect(subscribe).toHaveBeenCalledOnce();
});
it("backs off repeated EOF with a bounded jittered delay and cancels pending retries", async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  subscribe.mockResolvedValue(undefined);
  const { result, unmount } = renderHook(() => useResourceLive(options));
  await act(async () => { await Promise.resolve(); });
  let calls = 1;
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    await act(async () => { await vi.advanceTimersByTimeAsync(delay - 1); });
    expect(subscribe).toHaveBeenCalledTimes(calls);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(subscribe).toHaveBeenCalledTimes(++calls);
    expect(result.current.state).toBe("reconnecting");
  }
  unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
  expect(subscribe).toHaveBeenCalledTimes(calls);
});
