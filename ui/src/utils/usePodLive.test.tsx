// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import usePodLive from "./usePodLive";
import { PodLiveError, type PodLiveUpdate } from "./podLive";
const subscribe = vi.hoisted(() => vi.fn());
vi.mock("./podLive", async (original) => ({ ...await original<object>(), apiSubscribePods: (...args: unknown[]) => subscribe(...args) }));
const options = { token: "token", contextName: "ctx", namespace: "app", enabled: true };
const update: PodLiveUpdate = { context: "ctx", namespace: "app", revision: 3, state: "live", stale: false };
beforeEach(() => { subscribe.mockReset(); Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("Live lease lifecycle", () => {
  it("is off by default, waits for notification, aborts hidden/context/token/unmount and resumes visible", async () => {
    subscribe.mockImplementation(() => new Promise(() => undefined));
    const { result, rerender, unmount } = renderHook((props) => usePodLive(props), { initialProps: { ...options, enabled: false } });
    expect(subscribe).not.toHaveBeenCalled();
    rerender(options);
    await waitFor(() => expect(subscribe).toHaveBeenCalledOnce());
    expect(result.current.state).toBe("starting");
    act(() => subscribe.mock.calls[0][4](update));
    expect(result.current.state).toBe("live");
    act(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
    expect(subscribe.mock.calls[0][3].aborted).toBe(true);
    expect(result.current.state).toBe("paused");
    act(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(2));
    rerender({ ...options, contextName: "new" });
    expect(subscribe.mock.calls[1][3].aborted).toBe(true);
    rerender({ ...options, contextName: "new", token: "new-token" });
    expect(subscribe.mock.calls[2][3].aborted).toBe(true);
    unmount();
    expect(subscribe.mock.calls[3][3].aborted).toBe(true);
  });
  it("backs off transport failures but never loops on denial", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    subscribe.mockRejectedValueOnce(new Error("network")).mockRejectedValue(new PodLiveError("denied"));
    const { result } = renderHook(() => usePodLive(options));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.state).toBe("reconnecting");
    expect(subscribe).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(result.current.state).toBe("blocked");
    await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
    expect(subscribe).toHaveBeenCalledTimes(2);
  });
});
