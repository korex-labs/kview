// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActiveContextProvider } from "../activeContext";

afterEach(cleanup);
import useNamespacedResourceDrawerDetail from "./useNamespacedResourceDrawerDetail";

type Details = { name: string };

function result(name: string) {
  return {
    item: { name },
    detailSignals: [],
    warningEvents: [
      { type: "Warning", reason: "Test", message: "warning", count: 1, firstSeen: 1, lastSeen: 2 },
    ],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("useNamespacedResourceDrawerDetail", () => {

  it.each(["name", "namespace", "token", "resource", "context", "retry"])("guards obsolete rejection/finally on %s changes and aborts on unmount", async (dimension) => {
    const old = deferred<ReturnType<typeof result>>();
    const current = deferred<ReturnType<typeof result>>();
    const unmounting = deferred<ReturnType<typeof result>>();
    const fetchDetail = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise).mockReturnValueOnce(unmounting.promise);
    let context = "context-a";
    const initialProps = { name: "fixture-a", namespace: "fixture-ns", token: "token-a", resource: "services", retryNonce: 0 };
    const { result: hook, rerender, unmount } = renderHook(
      (identity) => useNamespacedResourceDrawerDetail<Details>({ ...identity, open: true, fetchDetail }),
      { initialProps, wrapper: ({ children }) => <ActiveContextProvider value={context}>{children}</ActiveContextProvider> },
    );
    const oldSignal = fetchDetail.mock.calls[0][0].signal as AbortSignal;
    if (dimension === "context") context = "context-b";
    const next = dimension === "retry" ? { ...initialProps, retryNonce: 1 }
      : dimension === "context" ? initialProps : { ...initialProps, [dimension]: "fixture-b" };
    rerender(next);
    expect(oldSignal.aborted).toBe(true);
    await act(async () => old.reject(new Error("obsolete")));
    expect(hook.current.loading).toBe(true);
    expect(hook.current.error).toBe("");
    await act(async () => current.resolve(result("current")));
    expect(hook.current.details).toEqual({ name: "current" });
    expect(hook.current.loading).toBe(false);
    rerender(next);
    expect(fetchDetail).toHaveBeenCalledTimes(2);
    act(() => hook.current.refresh());
    const signal = fetchDetail.mock.calls[2][0].signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => unmounting.resolve(result("unmounted")));
  });

  it("stays idle until the drawer has a resource identity", () => {
    const fetchDetail = vi.fn();
    const { result: hook } = renderHook(() =>
      useNamespacedResourceDrawerDetail<Details>({
        open: false,
        token: "token",
        namespace: "default",
        resource: "resourcequotas",
        name: null,
        retryNonce: 0,
        fetchDetail,
      }),
    );

    expect(fetchDetail).not.toHaveBeenCalled();
    expect(hook.current.loading).toBe(false);
    expect(hook.current.details).toBeNull();
  });

  it("loads details, resets local drawer state, and refreshes on demand", async () => {
    const fetchDetail = vi
      .fn()
      .mockResolvedValueOnce(result("first"))
      .mockResolvedValueOnce(result("refreshed"));
    const onReset = vi.fn();
    const { result: hook } = renderHook(() =>
      useNamespacedResourceDrawerDetail<Details>({
        open: true,
        token: "token",
        namespace: "default",
        resource: "resourcequotas",
        name: "quota",
        retryNonce: 0,
        onReset,
        fetchDetail,
      }),
    );

    await waitFor(() => expect(hook.current.loading).toBe(false));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(fetchDetail).toHaveBeenCalledWith({
      token: "token",
      namespace: "default",
      resource: "resourcequotas",
      name: "quota",
      contextName: "",
      signal: expect.any(AbortSignal),
    });
    expect(hook.current.details).toEqual({ name: "first" });
    expect(hook.current.events).toHaveLength(1);

    act(() => hook.current.refresh());
    await waitFor(() => expect(hook.current.details).toEqual({ name: "refreshed" }));
    expect(onReset).toHaveBeenCalledTimes(2);
    expect(fetchDetail).toHaveBeenCalledTimes(2);
  });

  it("ignores stale responses after identity changes or the drawer closes", async () => {
    const first = deferred<ReturnType<typeof result>>();
    const second = deferred<ReturnType<typeof result>>();
    const closing = deferred<ReturnType<typeof result>>();
    const requests = { first, second, closing };
    const fetchDetail = vi.fn(({ name }: { name: string }) => requests[name as keyof typeof requests].promise);
    const { result: hook, rerender } = renderHook(
      ({ open, name }: { open: boolean; name: keyof typeof requests }) =>
        useNamespacedResourceDrawerDetail<Details>({
          open,
          token: "token",
          namespace: "default",
          resource: "resourcequotas",
          name,
          retryNonce: 0,
          fetchDetail,
        }),
      { initialProps: { open: true, name: "first" as keyof typeof requests } },
    );

    rerender({ open: true, name: "second" });
    await act(async () => second.resolve(result("second")));
    await waitFor(() => expect(hook.current.details).toEqual({ name: "second" }));
    await act(async () => first.resolve(result("first")));
    expect(hook.current.details).toEqual({ name: "second" });

    rerender({ open: true, name: "closing" });
    expect(hook.current.loading).toBe(true);
    rerender({ open: false, name: "closing" });
    await act(async () => closing.resolve(result("closing")));
    expect(hook.current.details).toBeNull();
    expect(hook.current.error).toBe("");
    expect(hook.current.loading).toBe(false);
  });

  it("exposes load failures and clears loading", async () => {
    const fetchDetail = vi.fn().mockRejectedValue(new Error("forbidden"));
    const { result: hook } = renderHook(() =>
      useNamespacedResourceDrawerDetail<Details>({
        open: true,
        token: "token",
        namespace: "default",
        resource: "limitranges",
        name: "limits",
        retryNonce: 0,
        fetchDetail,
      }),
    );

    await waitFor(() => expect(hook.current.loading).toBe(false));
    expect(hook.current.error).toContain("forbidden");
    expect(hook.current.details).toBeNull();
    expect(hook.current.events).toEqual([]);
  });
});
