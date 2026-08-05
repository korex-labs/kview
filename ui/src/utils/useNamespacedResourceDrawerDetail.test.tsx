// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("useNamespacedResourceDrawerDetail", () => {
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
