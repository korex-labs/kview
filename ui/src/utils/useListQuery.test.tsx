// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import useListQuery from "./useListQuery";
import React from "react";

vi.mock("./connectionState", () => ({
  useConnectionState: () => ({ retryNonce: 0 }),
}));

describe("useListQuery revision polling", () => {
  beforeEach(() => {
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
