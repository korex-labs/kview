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
  it("coalesces Live bursts behind pending reads, uses response revision, and suspends polling", async () => {
    const finish: Array<(value: { rows: string[]; dataplaneMeta?: { revision: string } }) => void> = [];
    const fetchItems = vi.fn(() => new Promise<{ rows: string[]; dataplaneMeta?: { revision: string } }>((resolve) => finish.push(resolve)));
    const fetchRevision = vi.fn().mockResolvedValue("999");
    const { result, rerender } = renderHook(({ revision }) => useListQuery({ refreshSec: 1, fetchItems, fetchRevision, revisionPollSec: 1, dataplaneRefreshSec: 1, suspendPolling: true, externalRevision: revision }), { initialProps: { revision: undefined as string | undefined } });
    await waitFor(() => expect(fetchItems).toHaveBeenCalledOnce());
    rerender({ revision: "2" });
    rerender({ revision: "3" });
    await act(async () => finish[0]({ rows: ["initial"], dataplaneMeta: { revision: "1" } }));
    await waitFor(() => expect(fetchItems).toHaveBeenCalledTimes(2));
    rerender({ revision: "4" });
    await act(async () => finish[1]({ rows: ["old"], dataplaneMeta: { revision: "3" } }));
    await waitFor(() => expect(fetchItems).toHaveBeenCalledTimes(3));
    await act(async () => finish[2]({ rows: ["latest"], dataplaneMeta: { revision: "4" } }));
    expect(result.current.items).toEqual(["latest"]);
    expect(result.current.dataplaneMeta?.revision).toBe("4");
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fetchItems).toHaveBeenCalledTimes(3);
    expect(fetchRevision).not.toHaveBeenCalled();
  });

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

  it("retries a failed Live read for the SAME notification with bounded backoff", async () => {
    vi.useFakeTimers();
    const fetchItems = vi.fn().mockResolvedValueOnce({ rows: ["one"], dataplaneMeta: { revision: "1" } })
      .mockRejectedValue(new Error("temporary"));
    const fetchRevision = vi.fn();
    const { result, rerender } = renderHook(({ revision }) => useListQuery<string>({
      refreshSec: 1, revisionPollSec: 1, fetchRevision, fetchItems, suspendPolling: true, externalRevision: revision,
    }), { initialProps: { revision: undefined as string | undefined } });
    await act(async () => {});
    await act(async () => { rerender({ revision: "2" }); });
    expect(fetchItems).toHaveBeenCalledTimes(2);
    expect(result.current.items).toEqual(["one"]);
    expect(result.current.error).not.toBeNull();
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      const calls = fetchItems.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(delay - 1); });
      expect(fetchItems).toHaveBeenCalledTimes(calls);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(fetchItems).toHaveBeenCalledTimes(calls + 1);
    }
    let finish!: (value: { rows: string[]; dataplaneMeta: { revision: string } }) => void;
    fetchItems.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    const calls = fetchItems.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
    expect(fetchItems).toHaveBeenCalledTimes(calls);
    await act(async () => { finish({ rows: ["two"], dataplaneMeta: { revision: "2" } }); });
    expect(result.current.items).toEqual(["two"]);
    expect(result.current.error).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
    expect(fetchItems).toHaveBeenCalledTimes(calls);
    expect(fetchRevision).not.toHaveBeenCalled();
  });

  it("coalesces newer Live notifications within the existing failure backoff", async () => {
    vi.useFakeTimers();
    const fetchItems = vi.fn().mockResolvedValueOnce({ rows: ["one"] }).mockRejectedValue(new Error("temporary"));
    const { result, rerender } = renderHook(({ revision }) => useListQuery<string>({
      refreshSec: 0, fetchItems, suspendPolling: true, externalRevision: revision,
    }), { initialProps: { revision: undefined as string | undefined } });
    await act(async () => {});
    await act(async () => { rerender({ revision: "2" }); });
    for (const revision of ["3", "4", "5"]) {
      await act(async () => { await vi.advanceTimersByTimeAsync(200); rerender({ revision }); });
      expect(fetchItems).toHaveBeenCalledTimes(2);
    }
    fetchItems.mockResolvedValue({ rows: ["five"], dataplaneMeta: { revision: "5" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(fetchItems).toHaveBeenCalledTimes(3);
    expect(result.current.items).toEqual(["five"]);
    await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
    expect(fetchItems).toHaveBeenCalledTimes(3);
  });

  it.each(["hidden", "context", "token", "off", "disabled", "unmount"] as const)("aborts an in-flight Live retry and discards its late response on %s", async (change) => {
    vi.useFakeTimers();
    let finish!: (value: { rows: string[] }) => void;
    const fetchItems = vi.fn().mockResolvedValueOnce({ rows: ["one"] }).mockRejectedValueOnce(new Error("temporary"))
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue({ rows: ["new"] });
    const props = { context: "old", token: "old", revision: undefined as string | undefined, enabled: true };
    const { result, rerender, unmount } = renderHook(({ context, token, revision, enabled }) => useListQuery<string>({
      queryKey: [context, token], refreshSec: 0, fetchItems, suspendPolling: true,
      externalRevision: revision, abortWhenHidden: true, enabled,
    }), { initialProps: props });
    await act(async () => {});
    await act(async () => { rerender({ ...props, revision: "2" }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(fetchItems).toHaveBeenCalledTimes(3);
    const signal = fetchItems.mock.calls[2][1] as AbortSignal;
    await act(async () => {
      if (change === "unmount") unmount();
      else if (change === "hidden") {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
      } else rerender({ ...props, context: change === "context" ? "new" : "old",
        token: change === "token" ? "new" : "old", enabled: change !== "disabled" });
    });
    expect(signal.aborted).toBe(true);
    const calls = fetchItems.mock.calls.length;
    await act(async () => { finish({ rows: ["stale"] }); await vi.advanceTimersByTimeAsync(120000); });
    expect(fetchItems).toHaveBeenCalledTimes(calls);
    expect(result.current.items).not.toEqual(["stale"]);
  });

  it.each(["hidden", "context", "token", "off", "disabled", "unmount"] as const)("cancels a failed Live notification retry on %s", async (change) => {
    vi.useFakeTimers();
    const fetchItems = vi.fn().mockResolvedValueOnce({ rows: ["one"] }).mockRejectedValue(new Error("temporary"));
    const props = { context: "old", token: "old", revision: undefined as string | undefined, enabled: true };
    const { rerender, unmount } = renderHook(({ context, token, revision, enabled }) => useListQuery<string>({
      queryKey: [context, token], refreshSec: 0, fetchItems, suspendPolling: true,
      externalRevision: revision, abortWhenHidden: true, enabled,
    }), { initialProps: props });
    await act(async () => {});
    await act(async () => { rerender({ ...props, revision: "2" }); });
    expect(fetchItems).toHaveBeenCalledTimes(2);
    fetchItems.mockResolvedValue({ rows: ["new"] });
    await act(async () => {
      if (change === "unmount") unmount();
      else if (change === "hidden") {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
      } else rerender({ ...props, context: change === "context" ? "new" : "old",
        token: change === "token" ? "new" : "old", enabled: change !== "disabled" });
    });
    const calls = fetchItems.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
    expect(fetchItems).toHaveBeenCalledTimes(calls);
  });

  it("queues a manual intent behind an initial read without overlapping it", async () => {
    let finish!: (value: { rows: string[] }) => void;
    const fetchItems = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValue({ rows: ["fresh"] });
    const { result } = renderHook(() => useListQuery<string>({ refreshSec: 0, fetchItems }));
    await waitFor(() => expect(fetchItems).toHaveBeenCalledWith("initial", expect.any(AbortSignal)));
    let manual!: Promise<void>;
    act(() => { manual = result.current.refetch(); });
    expect(fetchItems).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ rows: ["cached"] }); await manual; });
    expect(fetchItems).toHaveBeenLastCalledWith("manual", expect.any(AbortSignal));
    expect(result.current.items).toEqual(["fresh"]);
  });

  it.each(["resolve", "reject"] as const)("keeps queued manual ownership when the initial read settles via %s", async (outcome) => {
    let finishInitial!: (value: { rows: string[] }) => void;
    let rejectInitial!: (error: Error) => void;
    let finishManual!: (value: { rows: string[] }) => void;
    const fetchItems = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve, reject) => { finishInitial = resolve; rejectInitial = reject; }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishManual = resolve; }));
    const { result } = renderHook(() => useListQuery<string>({ refreshSec: 0, fetchItems }));
    await waitFor(() => expect(fetchItems).toHaveBeenCalledWith("initial", expect.any(AbortSignal)));
    let manual!: Promise<void>;
    let duplicate!: Promise<void>;
    act(() => {
      manual = result.current.refetch();
      duplicate = result.current.refetch();
    });
    expect(fetchItems).toHaveBeenCalledTimes(1);
    await act(async () => {
      if (outcome === "reject") rejectInitial(new Error("initial failed"));
      else finishInitial({ rows: ["cached"] });
    });
    expect(fetchItems).toHaveBeenCalledTimes(2);
    expect(fetchItems).toHaveBeenLastCalledWith("manual", expect.any(AbortSignal));
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
    let joined!: Promise<void>;
    await act(async () => { joined = result.current.refetch(); });
    expect(result.current.loading).toBe(true);
    expect(fetchItems).toHaveBeenCalledTimes(2);
    await act(async () => {
      finishManual({ rows: ["fresh"] });
      await Promise.all([manual, duplicate, joined]);
    });
    expect(result.current.items).toEqual(["fresh"]);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it.each(["identity change", "unmount"] as const)("discards a queued manual request after %s", async (change) => {
    let rejectInitial!: (error: Error) => void;
    const fetchItems = vi.fn()
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectInitial = reject; }))
      .mockResolvedValue({ rows: ["new identity"] });
    const onInitialResult = vi.fn();
    const { result, rerender, unmount } = renderHook(({ id }) => useListQuery<string>({
      queryKey: [id], refreshSec: 0, fetchItems, onInitialResult,
    }), { initialProps: { id: "old" } });
    await waitFor(() => expect(fetchItems).toHaveBeenCalledTimes(1));
    let manual!: Promise<void>;
    act(() => { manual = result.current.refetch(); });
    if (change === "unmount") unmount();
    else {
      rerender({ id: "new" });
      await waitFor(() => expect(result.current.items).toEqual(["new identity"]));
    }
    onInitialResult.mockClear();
    await act(async () => {
      rejectInitial(new Error("stale failure"));
      await manual;
    });
    expect(fetchItems.mock.calls.map(([reason]) => reason)).not.toContain("manual");
    expect(onInitialResult).not.toHaveBeenCalled();
    if (change === "identity change") {
      expect(result.current.items).toEqual(["new identity"]);
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
    }
  });

  it.each(["initial", "manual", "refresh", "dataplane", "revision"] as const)(
    "does not mark revision 2 applied when the %s response delivers revision 1",
    async (reason) => {
      const fetchItems = vi.fn().mockResolvedValue({ rows: ["one"], dataplaneMeta: { revision: "1" } });
      let revision = reason === "initial" ? "2" : "1";
      const fetchRevision = vi.fn(async () => revision);
      const { result, rerender } = renderHook(({ refreshSec, revisionPollSec, dataplaneRefreshSec }) => useListQuery<string>({
        refreshSec, revisionPollSec, dataplaneRefreshSec, fetchItems, fetchRevision,
      }), { initialProps: { refreshSec: 0, revisionPollSec: 0, dataplaneRefreshSec: 0 } });
      await waitFor(() => expect(result.current.loading).toBe(false));
      revision = "2";
      if (reason === "manual") await act(async () => { await result.current.refetch(); });
      if (reason === "refresh" || reason === "dataplane" || reason === "revision") {
        rerender({ refreshSec: reason === "refresh" ? 1 : 0, revisionPollSec: reason === "revision" ? 1 : 0, dataplaneRefreshSec: reason === "dataplane" ? 1 : 0 });
        await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
        expect(fetchItems).toHaveBeenLastCalledWith(reason, expect.any(AbortSignal));
      }
      expect(result.current.items).toEqual(["one"]);
      fetchItems.mockResolvedValue({ rows: ["two"], dataplaneMeta: { revision: "2" } });
      fetchItems.mockClear();
      rerender({ refreshSec: 0, revisionPollSec: 1, dataplaneRefreshSec: 0 });
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(fetchItems).toHaveBeenCalledTimes(1);
      expect(result.current.items).toEqual(["two"]);
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(fetchItems).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["notification first", "manual first"] as const)("retains trailing invalidation through queued manual ownership: %s", async (order) => {
    const finish: Array<(value: { rows: string[]; dataplaneMeta: { revision: string } }) => void> = [];
    const fetchItems = vi.fn(() => new Promise<{ rows: string[]; dataplaneMeta: { revision: string } }>((resolve) => finish.push(resolve)));
    const { result, rerender } = renderHook(({ revision }) => useListQuery<string>({
      refreshSec: 0, fetchItems, externalRevision: revision, suspendPolling: true,
    }), { initialProps: { revision: undefined as string | undefined } });
    await waitFor(() => expect(fetchItems).toHaveBeenCalledTimes(1));
    let manual!: Promise<void>;
    if (order === "notification first") rerender({ revision: "2" });
    act(() => { manual = result.current.refetch(); });
    if (order === "manual first") rerender({ revision: "2" });
    await act(async () => { finish[0]({ rows: ["initial"], dataplaneMeta: { revision: "1" } }); });
    expect(fetchItems).toHaveBeenCalledTimes(2);
    expect(fetchItems).toHaveBeenLastCalledWith("manual", expect.any(AbortSignal));
    expect(result.current.loading).toBe(true);
    await act(async () => { finish[1]({ rows: ["manual"], dataplaneMeta: { revision: "1" } }); await manual; });
    expect(fetchItems).toHaveBeenCalledTimes(3);
    expect(fetchItems).toHaveBeenLastCalledWith("revision", expect.any(AbortSignal));
    await act(async () => { finish[2]({ rows: ["two"], dataplaneMeta: { revision: "2" } }); });
    expect(result.current.items).toEqual(["two"]);
    expect(result.current.loading).toBe(false);
  });

  it("does not let a late legacy marker overwrite a newer delivered snapshot", async () => {
    let finishMarker!: (revision: string) => void;
    const fetchRevision = vi.fn().mockImplementationOnce(() => new Promise<string>((resolve) => { finishMarker = resolve; })).mockResolvedValue("2");
    const fetchItems = vi.fn().mockResolvedValueOnce({ rows: ["legacy"] }).mockResolvedValue({ rows: ["one"], dataplaneMeta: { revision: "1" } });
    const { result, rerender } = renderHook(({ refreshSec }) => useListQuery<string>({
      refreshSec, revisionPollSec: 1, fetchItems, fetchRevision,
    }), { initialProps: { refreshSec: 1 } });
    await waitFor(() => expect(fetchRevision).toHaveBeenCalledOnce());
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.items).toEqual(["one"]);
    await act(async () => { finishMarker("2"); });
    fetchItems.mockResolvedValue({ rows: ["two"], dataplaneMeta: { revision: "2" } });
    rerender({ refreshSec: 0 });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.items).toEqual(["two"]);
  });

  it("does not start a revision read from a poll that settles after Live suspends polling", async () => {
    let finishPoll!: (revision: string) => void;
    const fetchRevision = vi.fn().mockImplementationOnce(() => new Promise<string>((resolve) => { finishPoll = resolve; })).mockResolvedValue("2");
    const fetchItems = vi.fn().mockResolvedValueOnce({ rows: ["one"], dataplaneMeta: { revision: "1" } }).mockResolvedValue({ rows: ["two"], dataplaneMeta: { revision: "2" } });
    const { result, rerender } = renderHook(({ suspendPolling }) => useListQuery<string>({
      refreshSec: 0, revisionPollSec: 1, fetchItems, fetchRevision, suspendPolling,
    }), { initialProps: { suspendPolling: false } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchRevision).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    rerender({ suspendPolling: true });
    await act(async () => { finishPoll("2"); });
    expect(fetchItems).toHaveBeenCalledOnce();
    rerender({ suspendPolling: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.items).toEqual(["two"]);
  });

  it.each(["identity change", "unmount", "hidden"] as const)("cancels a trailing notification and manual request after %s", async (change) => {
    let finish!: (value: { rows: string[] }) => void;
    const fetchItems = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue({ rows: ["new"] });
    const { result, rerender, unmount } = renderHook(({ id, revision }) => useListQuery<string>({
      queryKey: [id], refreshSec: 0, fetchItems, externalRevision: revision, suspendPolling: true, abortWhenHidden: true,
    }), { initialProps: { id: "old", revision: undefined as string | undefined } });
    await waitFor(() => expect(fetchItems).toHaveBeenCalledOnce());
    const signal = fetchItems.mock.calls[0][1] as AbortSignal;
    let manual!: Promise<void>;
    act(() => { manual = result.current.refetch(); });
    rerender({ id: "old", revision: "2" });
    if (change === "unmount") unmount();
    else if (change === "hidden") {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    } else {
      rerender({ id: "new", revision: "2" });
      await waitFor(() => expect(result.current.items).toEqual(["new"]));
    }
    expect(signal.aborted).toBe(true);
    const callsBefore = fetchItems.mock.calls.length;
    await act(async () => { finish({ rows: ["stale"] }); await manual; });
    expect(fetchItems).toHaveBeenCalledTimes(callsBefore);
    expect(fetchItems.mock.calls.map(([reason]) => reason)).not.toContain("manual");
    if (change === "identity change") {
      expect(result.current.items).toEqual(["new"]);
      expect(fetchItems.mock.calls.map(([reason]) => reason)).toEqual(["initial", "initial", "revision"]);
    }
  });

  it("re-maps progressive enrichment immediately without refetching", async () => {
    const fetchItems = vi.fn().mockResolvedValue({ rows: [1] });
    const { result, rerender } = renderHook(({ extra }) => useListQuery<number>({
      refreshSec: 0, fetchItems, mapRows: (rows) => rows.map((n) => n + extra),
    }), { initialProps: { extra: 0 } });
    await waitFor(() => expect(result.current.items).toEqual([1]));
    rerender({ extra: 10 });
    expect(result.current.items).toEqual([11]);
    expect(fetchItems).toHaveBeenCalledTimes(1);
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
