// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import useListQuery from "./useListQuery";
import React from "react";

const mockConnection = vi.hoisted(() => ({
  health: "healthy",
  retryNonce: 0,
}));

vi.mock("../connectionState", () => ({
  useConnectionState: () => mockConnection,
}));

describe("useListQuery revision polling", () => {
  beforeEach(() => {
    mockConnection.health = "healthy";
    mockConnection.retryNonce = 0;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not refetch full list when revision is unchanged", async () => {
    const fetchItems = vi.fn().mockResolvedValue({ rows: [{ id: "1", name: "a" }] });
    const fetchRevision = vi.fn().mockResolvedValue("5");

    const wrapper = ({ children }: { children: React.ReactNode }) => <>{children}</>;

    const { result } = renderHook(
      () =>
        useListQuery({
          enabled: true,
          refreshSec: 0,
          fetchItems,
          fetchRevision,
          revisionPollSec: 1,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchItems).toHaveBeenCalledTimes(1);
    expect(fetchRevision).toHaveBeenCalled();

    fetchItems.mockClear();
    fetchRevision.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(fetchRevision.mock.calls.length).toBeGreaterThan(0);
    expect(fetchItems).not.toHaveBeenCalled();
  });

  it("refetches full list when revision changes", async () => {
    const fetchItems = vi.fn().mockResolvedValue({ rows: [{ id: "1", name: "a" }] });
    let rev = "1";
    const fetchRevision = vi.fn().mockImplementation(async () => rev);

    const wrapper = ({ children }: { children: React.ReactNode }) => <>{children}</>;

    const { result } = renderHook(
      () =>
        useListQuery({
          enabled: true,
          refreshSec: 0,
          fetchItems,
          fetchRevision,
          revisionPollSec: 1,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchItems).toHaveBeenCalledTimes(1);

    rev = "2";
    fetchItems.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    await waitFor(() => expect(fetchItems).toHaveBeenCalledTimes(1));
  });

  it("does not overlap full list refetches when revision polling changes during a slow fetch", async () => {
    let resolveRefresh: (value: { rows: Array<{ id: string; name: string }> }) => void = () => {};
    const fetchItems = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "1", name: "a" }] })
      .mockImplementation(() => new Promise<{ rows: Array<{ id: string; name: string }> }>((resolve) => {
        resolveRefresh = resolve;
      }));
    let rev = "1";
    const fetchRevision = vi.fn().mockImplementation(async () => rev);

    const { result } = renderHook(() =>
      useListQuery<{ id: string; name: string }>({
        enabled: true,
        refreshSec: 0,
        fetchItems,
        fetchRevision,
        revisionPollSec: 1,
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    fetchItems.mockClear();
    rev = "2";

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchItems).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fetchItems).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRefresh({ rows: [{ id: "2", name: "b" }] });
    });
    await waitFor(() => expect(result.current.items[0]?.id).toBe("2"));
  });

  it("can refetch dataplane lists on a full refresh interval even when revision is unchanged", async () => {
    const fetchItems = vi.fn().mockResolvedValue({ rows: [{ id: "1", name: "a" }] });
    const fetchRevision = vi.fn().mockResolvedValue("5");

    const { result } = renderHook(() =>
      useListQuery({
        enabled: true,
        refreshSec: 0,
        fetchItems,
        fetchRevision,
        revisionPollSec: 1,
        dataplaneRefreshSec: 10,
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchItems).toHaveBeenCalledTimes(1);

    fetchItems.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_500);
    });

    expect(fetchItems).toHaveBeenCalledTimes(1);
  });

  it("pauses dataplane refresh while connection health is unhealthy", async () => {
    mockConnection.health = "unhealthy";
    const fetchItems = vi.fn().mockResolvedValue({ rows: [{ id: "1", name: "a" }] });
    const fetchRevision = vi.fn().mockResolvedValue("5");

    const { result } = renderHook(() =>
      useListQuery({
        enabled: true,
        refreshSec: 0,
        fetchItems,
        fetchRevision,
        revisionPollSec: 1,
        dataplaneRefreshSec: 10,
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchItems).toHaveBeenCalledTimes(1);

    fetchItems.mockClear();
    fetchRevision.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_500);
    });

    expect(fetchRevision).not.toHaveBeenCalled();
    expect(fetchItems).not.toHaveBeenCalled();
  });

  it("pauses revision polling while the page is hidden", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });

    const fetchItems = vi.fn().mockResolvedValue({ rows: [{ id: "1", name: "a" }] });
    const fetchRevision = vi.fn().mockResolvedValue("5");

    const { result } = renderHook(() =>
      useListQuery({
        enabled: true,
        refreshSec: 0,
        fetchItems,
        fetchRevision,
        revisionPollSec: 1,
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchItems).toHaveBeenCalledTimes(1);

    fetchItems.mockClear();
    fetchRevision.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(fetchRevision).not.toHaveBeenCalled();
    expect(fetchItems).not.toHaveBeenCalled();
  });

  it("reloads when the query key changes", async () => {
    const fetchItems = vi.fn(async (id: string) => ({ rows: [{ id, name: id }] }));

    const { result, rerender } = renderHook(
      ({ id }) =>
        useListQuery({
          enabled: true,
          queryKey: [id],
          refreshSec: 0,
          fetchItems: () => fetchItems(id),
        }),
      { initialProps: { id: "namespace-a" } },
    );

    await waitFor(() => expect(result.current.items[0]?.id).toBe("namespace-a"));

    rerender({ id: "namespace-b" });

    await waitFor(() => expect(result.current.items[0]?.id).toBe("namespace-b"));
    expect(fetchItems).toHaveBeenCalledWith("namespace-a");
    expect(fetchItems).toHaveBeenCalledWith("namespace-b");
  });

  it("ignores stale list results after the query key changes", async () => {
    let resolveA: (value: { rows: Array<{ id: string }> }) => void = () => {};
    let resolveB: (value: { rows: Array<{ id: string }> }) => void = () => {};
    const fetchItems = vi.fn((id: string) => {
      if (id === "namespace-a") {
        return new Promise<{ rows: Array<{ id: string }> }>((resolve) => {
          resolveA = resolve;
        });
      }
      return new Promise<{ rows: Array<{ id: string }> }>((resolve) => {
        resolveB = resolve;
      });
    });

    const { result, rerender } = renderHook(
      ({ id }) =>
        useListQuery({
          enabled: true,
          queryKey: [id],
          refreshSec: 0,
          fetchItems: () => fetchItems(id),
        }),
      { initialProps: { id: "namespace-a" } },
    );

    await waitFor(() => expect(fetchItems).toHaveBeenCalledWith("namespace-a"));
    rerender({ id: "namespace-b" });
    await waitFor(() => expect(fetchItems).toHaveBeenCalledWith("namespace-b"));

    await act(async () => {
      resolveB({ rows: [{ id: "namespace-b" }] });
    });
    await waitFor(() => expect(result.current.items[0]?.id).toBe("namespace-b"));

    await act(async () => {
      resolveA({ rows: [{ id: "namespace-a" }] });
    });

    expect(result.current.items[0]?.id).toBe("namespace-b");
  });
});
