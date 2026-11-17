// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiDefaultContext } from "../api";
import type { AppStateV1 } from "../state";
import useNamespaceInventory from "./useNamespaceInventory";

const initialState: AppStateV1 = {
  v: 1, favouriteNamespacesByContext: { "context-a": ["favourite"] },
  recentNamespacesByContext: { "context-a": ["recent"] },
};
type Props = Omit<Parameters<typeof useNamespaceInventory>[0], "appState" | "setAppState">;
function useHarness(props: Props) {
  const [appState, setAppState] = useState(initialState);
  return { ...useNamespaceInventory({ ...props, appState, setAppState }), appState, setAppState };
}
function mount() {
  const props: Props = {
    token: "token-a", activeContext: "context-a", ready: false, contextSwitching: false,
    onInventory: vi.fn(), recentLimit: 2, favouriteLimit: 2,
  };
  const hook = renderHook(useHarness, { initialProps: props });
  act(() => hook.result.current.prepareNamespaceInventory(initialState, "preferred"));
  hook.rerender({ ...props, ready: true });
  return { ...hook, props: { ...props, ready: true } };
}
function deferred() {
  let resolve!: (response: Response) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Response>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function response(names: string[]) {
  return new Response(JSON.stringify({ items: names.map(name => ({ name })), limited: false }));
}
async function flush() { await act(async () => {}); }
function signalAt(index: number) { return vi.mocked(fetch).mock.calls[index][1]?.signal as AbortSignal; }

beforeEach(() => {
  vi.useFakeTimers();
  setApiDefaultContext("unrelated-default-context");
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => response(["preferred"])));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); setApiDefaultContext(""); });

describe("namespace inventory ownership", () => {
  it("uses exact token/context headers and snapshot hints, preserving manual selection while pending", async () => {
    const pending = deferred();
    vi.mocked(fetch).mockReturnValueOnce(pending.promise);
    const { result, props } = mount();
    expect(fetch).toHaveBeenCalledWith(
      "/api/namespaces?enrichFocus=preferred&enrichRecent=recent&enrichFav=favourite",
      { headers: { Authorization: "Bearer token-a", "X-Kview-Context": "context-a" }, signal: expect.any(AbortSignal) },
    );
    act(() => result.current.onSelectNamespace("operator-choice"));
    await act(async () => { pending.resolve(response(["server-choice"])); });
    expect(result.current.namespace).toBe("operator-choice");
    expect(result.current.namespaces).toEqual(["server-choice"]);
    expect(result.current.appState.activeNamespace).toBe("operator-choice");
    expect(result.current.appState.recentNamespacesByContext?.["context-a"][0]).toBe("operator-choice");
    expect(props.onInventory).toHaveBeenCalledExactlyOnceWith({ context: "context-a", token: "token-a", items: [{ name: "server-choice" }] });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["context", "token"])("rejects obsolete success/error/finally during a newer %s request", async (identity) => {
    const old = deferred();
    const next = deferred();
    const refresh = deferred();
    vi.mocked(fetch).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise).mockReturnValueOnce(refresh.promise);
    const { result, props, rerender } = mount();
    const newer = { ...props, activeContext: identity === "context" ? "context-b" : props.activeContext,
      token: identity === "token" ? "token-b" : props.token };
    if (identity === "context") act(() => result.current.prepareNamespaceInventory(initialState, "preferred-b"));
    rerender(newer);
    expect(signalAt(0).aborted).toBe(true);
    expect(vi.mocked(fetch).mock.calls[1][1]?.headers).toEqual({ Authorization: `Bearer ${newer.token}`, "X-Kview-Context": newer.activeContext });
    await act(async () => { next.resolve(response(["accepted-b"])); });
    act(() => result.current.onOpenNamespaceSelector());
    expect(result.current.namespaceLoading).toBe(false);
    await act(async () => {
      if (identity === "context") old.resolve(response(["obsolete-a"]));
      else old.reject(new Error("obsolete-token failure"));
    });
    expect(result.current.namespaces).toEqual(["accepted-b"]);
    expect(result.current.namespace).toBe("accepted-b");
    expect(result.current.namespaceLoading).toBe(false);
    expect(result.current.namespaceError).toBe("");
    expect(signalAt(2).aborted).toBe(false);
    act(() => result.current.onOpenNamespaceSelector());
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(props.onInventory).toHaveBeenCalledTimes(1);
    await act(async () => { refresh.resolve(response(["refreshed-b"])); });
    expect(result.current.namespaceLoading).toBe(false);
    expect(result.current.namespace).toBe("accepted-b");
  });

  it.each(["disabled", "no-context", "unmount"])("aborts pending work on %s and cannot publish or resume warmup", async (close) => {
    const pending = deferred();
    vi.mocked(fetch).mockReturnValueOnce(pending.promise);
    const { result, props, rerender, unmount } = mount();
    if (close === "unmount") unmount();
    else rerender({ ...props, ready: close !== "disabled", activeContext: close === "no-context" ? "" : props.activeContext });
    expect(signalAt(0).aborted).toBe(true);
    if (close !== "unmount") expect(result.current.namespaceLoading).toBe(false);
    await act(async () => { pending.resolve(response([])); await vi.advanceTimersByTimeAsync(5000); });
    expect(props.onInventory).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("serializes warmup and stops its delayed retries when disabled", async () => {
    const slow = deferred();
    vi.mocked(fetch).mockResolvedValueOnce(response([])).mockReturnValueOnce(slow.promise);
    const { result, props, rerender } = mount();
    await flush();
    expect(result.current.namespaceLoading).toBe(true);
    expect(result.current.namespaces).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(fetch).toHaveBeenCalledTimes(2);
    act(() => { result.current.onOpenNamespaceSelector(); result.current.retryNamespaces(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => { slow.resolve(response([])); });
    rerender({ ...props, ready: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(props.onInventory).not.toHaveBeenCalled();
  });

  it("refreshes once on use without polling, selection changes, or hidden additional queries", async () => {
    const { result, props, rerender } = mount();
    await flush();
    act(() => result.current.onSelectNamespace("kept-even-if-absent"));
    const pending = deferred();
    vi.mocked(fetch).mockReturnValueOnce(pending.promise);
    act(() => { result.current.onOpenNamespaceSelector(); result.current.onOpenNamespaceSelector(); result.current.retryNamespaces(); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.current.namespaces).toEqual(["preferred"]);
    expect(result.current.namespaceLoading).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => { pending.resolve(response([])); });
    expect(result.current.namespace).toBe("kept-even-if-absent");
    expect(result.current.namespaces).toEqual([]);
    act(() => result.current.setAppState(s => ({ ...s, activeSection: "deployments" })));
    rerender({ ...props, recentLimit: 0, favouriteLimit: 0 });
    expect(result.current.namespacesListPath).toBe("/api/namespaces?enrichFocus=kept-even-if-absent");
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(props.onInventory).toHaveBeenCalledTimes(2);
  });

  it.each(["context", "token"])("never borrows a cached inventory across a %s change", async (identity) => {
    const { result, props, rerender } = mount();
    await flush();
    const oldRefresh = deferred();
    const fresh = deferred();
    vi.mocked(fetch).mockReturnValueOnce(oldRefresh.promise).mockReturnValueOnce(fresh.promise);
    act(() => result.current.onOpenNamespaceSelector());
    expect(result.current.namespaceLoading).toBe(false);
    rerender({ ...props, activeContext: identity === "context" ? "context-b" : props.activeContext,
      token: identity === "token" ? "token-b" : props.token });
    expect(result.current.namespaces).toEqual([]);
    expect(result.current.namespaceLoading).toBe(true);
    expect(signalAt(1).aborted).toBe(true);
    await act(async () => { oldRefresh.resolve(response(["obsolete"])); });
    expect(result.current.namespaces).toEqual([]);
    expect(result.current.namespaceLoading).toBe(true);
    act(() => result.current.onOpenNamespaceSelector());
    expect(fetch).toHaveBeenCalledTimes(3);
    await act(async () => { fresh.resolve(response(["fresh"])); });
    expect(result.current.namespaces).toEqual(["fresh"]);
    expect(result.current.namespaceLoading).toBe(false);
  });

  it("distinguishes a confirmed empty inventory from unknown inventory during refresh", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("initial failure"));
    const { result } = mount();
    await flush();
    const unknown = deferred();
    vi.mocked(fetch).mockReturnValueOnce(unknown.promise);
    act(() => result.current.onOpenNamespaceSelector());
    expect(result.current.namespaceLoading).toBe(true);
    expect(result.current.namespaces).toEqual([]);
    await act(async () => { unknown.resolve(response([])); });
    const confirmed = deferred();
    vi.mocked(fetch).mockReturnValueOnce(confirmed.promise);
    act(() => result.current.onOpenNamespaceSelector());
    expect(result.current.namespaceLoading).toBe(false);
    expect(result.current.namespaces).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fetch).toHaveBeenCalledTimes(3);
    await act(async () => { confirmed.resolve(response(["discovered"])); });
    expect(result.current.namespaces).toEqual(["discovered"]);
  });

  it("retains cached options on failure and shows explicit retry progress and errors truthfully", async () => {
    const { result } = mount();
    await flush();
    vi.mocked(fetch).mockRejectedValueOnce(new Error("refresh failed"));
    act(() => result.current.onOpenNamespaceSelector());
    await flush();
    expect(result.current.namespaceError).toBe("refresh failed");
    expect(result.current.namespaces).toEqual(["preferred"]);
    const retry = deferred();
    vi.mocked(fetch).mockReturnValueOnce(retry.promise);
    act(() => { result.current.retryNamespaces(); result.current.retryNamespaces(); result.current.onOpenNamespaceSelector(); });
    expect(result.current.namespaceLoading).toBe(true);
    expect(result.current.namespaceError).toBe("");
    expect(result.current.namespaces).toEqual(["preferred"]);
    expect(fetch).toHaveBeenCalledTimes(3);
    await act(async () => { retry.reject(new Error("retry failed")); });
    expect(result.current.namespaceError).toBe("retry failed");
    expect(result.current.namespaceLoading).toBe(false);
    expect(result.current.namespaces).toEqual(["preferred"]);
    expect(result.current.namespace).toBe("preferred");
  });
});
