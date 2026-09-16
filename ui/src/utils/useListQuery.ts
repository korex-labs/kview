import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiError } from "../api";
import { toApiError } from "../api";
import type { DataplaneListMeta, ResourceListFetchResult } from "../types/api";
import { useConnectionState } from "../connectionState";
import usePageVisible from "./usePageVisible";
import { performanceDiagnosticsEnabled, recordListTiming } from "./performanceDiagnostics";

export type ListFetchReason = "initial" | "manual" | "refresh" | "revision" | "dataplane";

type UseListQueryOptions<T> = {
  enabled?: boolean;
  /** Inputs that identify the backing list; changes trigger a fresh load and discard stale in-flight results. */
  queryKey?: unknown[];
  /** Poll interval in seconds for full list refetch. When > 0, overrides revision-based polling. */
  refreshSec: number;
  fetchItems: (reason: ListFetchReason, signal?: AbortSignal) => Promise<ResourceListFetchResult<T>>;
  onInitialResult?: () => void;
  /** Map last-fetched rows for display (e.g. merge progressive enrichment). */
  mapRows?: (rows: T[]) => T[];
  /** Dependencies that should trigger re-mapping without refetching. */
  mapRowsDeps?: unknown[];
  /**
   * When set and refreshSec is 0, poll only this lightweight revision endpoint on revisionPollSec;
   * full fetchItems runs on mount, on connection recovery, on manual refetch, and when revision changes.
   */
  fetchRevision?: () => Promise<string>;
  /** Seconds between revision polls when fetchRevision is used without full refreshSec. */
  revisionPollSec?: number;
  /** Seconds between full dataplane-backed refetches while toolbar refresh is Off. Default 0. */
  dataplaneRefreshSec?: number;
  /** Label used by optional performance diagnostics. */
  diagnosticsLabel?: string;
  externalRevision?: string;
  suspendPolling?: boolean;
  abortWhenHidden?: boolean;
};

type UseListQueryResult<T> = {
  items: T[];
  dataplaneMeta: DataplaneListMeta | null;
  error: ApiError | null;
  loading: boolean;
  lastRefresh: Date | null;
  refetch: () => Promise<void>;
};

export default function useListQuery<T>({
  enabled = true,
  queryKey,
  refreshSec,
  fetchItems,
  onInitialResult,
  mapRows,
  mapRowsDeps,
  fetchRevision,
  revisionPollSec = 0,
  dataplaneRefreshSec = 0,
  diagnosticsLabel,
  externalRevision,
  suspendPolling = false,
  abortWhenHidden = false,
}: UseListQueryOptions<T>): UseListQueryResult<T> {
  const [fetchedRows, setFetchedRows] = useState<T[]>([]);
  const [dataplaneMeta, setDataplaneMeta] = useState<DataplaneListMeta | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const { health } = useConnectionState();
  const pageVisible = usePageVisible();

  const controllersRef = useRef(new Set<AbortController>());
  const suspendPollingRef = useRef(suspendPolling);
  suspendPollingRef.current = suspendPolling;
  const onInitialResultRef = useRef(onInitialResult);

  useEffect(() => {
    onInitialResultRef.current = onInitialResult;
  }, [onInitialResult]);

  const fetchItemsRef = useRef(fetchItems);
  const fetchRevisionRef = useRef(fetchRevision);
  const fetchInFlightRef = useRef<{ generation: number; reason: ListFetchReason; promise: Promise<ResourceListFetchResult<T>> } | null>(null);
  const revisionPollInFlightRef = useRef(false);
  const revisionPollFailuresRef = useRef(0);
  const nextRevisionPollAtRef = useRef(0);
  useEffect(() => {
    fetchItemsRef.current = fetchItems;
  }, [fetchItems]);
  useEffect(() => {
    fetchRevisionRef.current = fetchRevision;
  }, [fetchRevision]);

  const lastRevisionRef = useRef<string | null>(null);
  const generationRef = useRef(0);

  const runFetchItems = useCallback(async (
    generation: number,
    reason: ListFetchReason,
    controller = new AbortController(),
  ): Promise<ResourceListFetchResult<T> | null> => {
    const pending = fetchInFlightRef.current;
    if (pending?.generation === generation) {
      if (reason !== "manual" || pending.reason === "manual") return null;
      // A manual action must not disappear behind an ordinary cached read.
      // Queue one foreground request after it rather than overlap the lanes.
      try { await pending.promise; } catch { /* manual refresh may recover */ }
      if (generation !== generationRef.current) return null;
      if (fetchInFlightRef.current?.generation === generation) return null;
    }
    const startedAt = performanceDiagnosticsEnabled() ? window.performance.now() : 0;
    controllersRef.current.add(controller);
    const promise = Promise.resolve().then(() => fetchItemsRef.current(reason, controller.signal));
    fetchInFlightRef.current = { generation, reason, promise };
    try {
      const next = await promise;
      if (startedAt && diagnosticsLabel) {
        recordListTiming({
          label: diagnosticsLabel,
          phase: "fetch",
          durationMs: window.performance.now() - startedAt,
          rows: next.rows.length,
        });
      }
      return next;
    } finally {
      controllersRef.current.delete(controller);
      const current = fetchInFlightRef.current;
      if (current?.generation === generation && current.reason === reason) {
        fetchInFlightRef.current = null;
      }
    }
  }, [diagnosticsLabel]);

  const revisionMarkerVersionRef = useRef(0);
  const syncRevisionMarker = useCallback(async (
    generation: number,
    next: ResourceListFetchResult<T>,
    fallbackRevision?: string | null,
  ) => {
    const version = ++revisionMarkerVersionRef.current;
    // Only the delivered snapshot proves which revision is on screen. A later
    // revision lookup can already describe a publication these rows do not show.
    const revision = next.dataplaneMeta?.revision ?? fallbackRevision;
    if (revision !== undefined) {
      lastRevisionRef.current = revision;
      revisionPollFailuresRef.current = 0;
      nextRevisionPollAtRef.current = 0;
      return;
    }
    if (suspendPollingRef.current) return;
    // Legacy lists without response metadata retain their revision baseline.
    const fr = fetchRevisionRef.current;
    try {
      const rev = fr ? await fr() : null;
      if (generation !== generationRef.current || version !== revisionMarkerVersionRef.current || suspendPollingRef.current) return;
      lastRevisionRef.current = rev;
      revisionPollFailuresRef.current = 0;
      nextRevisionPollAtRef.current = 0;
    } catch {
      // Keep the previous marker when the legacy baseline lookup fails.
    }
  }, []);

  const foregroundRequestRef = useRef<{
    generation: number;
    reason: "initial" | "manual";
    promise: Promise<void>;
  } | null>(null);
  const loadInitial = useCallback((reason: "initial" | "manual" = "initial") => {
    const generation = generationRef.current;
    const pending = foregroundRequestRef.current;
    if (pending?.generation === generation && (pending.reason === "manual" || pending.reason === reason)) {
      return pending.promise;
    }
    // A queued manual action owns foreground state immediately. The older
    // initial request may settle, but must not clear its loading/error state.
    const request = { generation, reason, promise: Promise.resolve() };
    foregroundRequestRef.current = request;
    const ownsState = () => generation === generationRef.current && foregroundRequestRef.current === request;
    setLoading(true);
    setError(null);
    request.promise = (async () => {
      try {
        const next = await runFetchItems(generation, reason);
        if (!next || !ownsState()) return;
        setFetchedRows(next.rows);
        setDataplaneMeta(next.dataplaneMeta ?? null);
        setLastRefresh(new Date());
        setError(null);
        onInitialResultRef.current?.();
        await syncRevisionMarker(generation, next);
      } catch (err) {
        if (!ownsState()) return;
        onInitialResultRef.current?.();
        setError(toApiError(err));
      } finally {
        if (ownsState()) {
          foregroundRequestRef.current = null;
          setLoading(false);
        }
      }
    })();
    return request.promise;
  }, [runFetchItems, syncRevisionMarker]);

  const items = useMemo(() => {
    const fn = mapRows;
    if (!fn) return fetchedRows;
    const startedAt = performanceDiagnosticsEnabled() ? window.performance.now() : 0;
    const next = fn(fetchedRows);
    if (startedAt && diagnosticsLabel) {
      recordListTiming({
        label: diagnosticsLabel,
        phase: "map",
        durationMs: window.performance.now() - startedAt,
        rows: fetchedRows.length,
        filteredRows: next.length,
      });
    }
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mapRowsDeps mirrors caller intent
  }, [fetchedRows, mapRows, diagnosticsLabel, ...(mapRowsDeps ?? [])]);

  useEffect(() => {
    if (!enabled) return;
    generationRef.current += 1;
    setFetchedRows([]);
    setDataplaneMeta(null);
    setError(null);
    setLastRefresh(null);
    lastRevisionRef.current = null;
    fetchInFlightRef.current = null;
    revisionPollInFlightRef.current = false;
    revisionPollFailuresRef.current = 0;
    nextRevisionPollAtRef.current = 0;
    void loadInitial();
    const controllers = controllersRef.current;
    return () => {
      generationRef.current += 1;
      controllers.forEach((c) => c.abort());
      controllers.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- queryKey is the caller-provided list identity
  }, [enabled, loadInitial, ...(queryKey ?? [])]);

  useEffect(() => {
    if (suspendPolling || !enabled || health === "unhealthy" || !pageVisible || refreshSec <= 0) return;
    const t = setInterval(async () => {
      const generation = generationRef.current;
      try {
        const next = await runFetchItems(generation, "refresh");
        if (!next) return;
        if (generation !== generationRef.current) return;
        setFetchedRows(next.rows);
        setDataplaneMeta(next.dataplaneMeta ?? null);
        setLastRefresh(new Date());
        setError(null);
        await syncRevisionMarker(generation, next);
      } catch {
        // keep previous data on refresh error
      }
    }, refreshSec * 1000);
    return () => clearInterval(t);
  }, [suspendPolling, enabled, health, pageVisible, refreshSec, runFetchItems, syncRevisionMarker]);

  useEffect(() => {
    if (suspendPolling || !enabled || health === "unhealthy" || !pageVisible || loading) return;
    if (refreshSec > 0) return;
    const fr = fetchRevisionRef.current;
    if (!fr || revisionPollSec <= 0) return;

    const tick = async () => {
      const now = Date.now();
      if (revisionPollInFlightRef.current || now < nextRevisionPollAtRef.current) return;
      const generation = generationRef.current;
      revisionPollInFlightRef.current = true;
      try {
        const rev = await fr();
        if (generation !== generationRef.current || suspendPollingRef.current) return;
        revisionPollFailuresRef.current = 0;
        nextRevisionPollAtRef.current = 0;
        const prev = lastRevisionRef.current;
        if (prev === null) {
          lastRevisionRef.current = rev;
          return;
        }
        if (prev !== rev) {
          const next = await runFetchItems(generation, "revision");
          if (!next) return;
          if (generation !== generationRef.current) return;
          void syncRevisionMarker(generation, next, rev);
          setFetchedRows(next.rows);
          setDataplaneMeta(next.dataplaneMeta ?? null);
          setLastRefresh(new Date());
          setError(null);
        }
      } catch {
        // keep previous data
        if (generation === generationRef.current) {
          revisionPollFailuresRef.current += 1;
          const backoffMs = Math.min(
            60_000,
            revisionPollSec * 1000 * Math.pow(2, Math.min(revisionPollFailuresRef.current - 1, 5)),
          );
          nextRevisionPollAtRef.current = Date.now() + backoffMs;
        }
      } finally {
        if (generation === generationRef.current) {
          revisionPollInFlightRef.current = false;
        }
      }
    };

    const t = setInterval(() => void tick(), revisionPollSec * 1000);
    return () => clearInterval(t);
  }, [suspendPolling, enabled, health, pageVisible, loading, refreshSec, revisionPollSec, fetchRevision, runFetchItems, syncRevisionMarker]);

  useEffect(() => {
    if (suspendPolling || !enabled || health === "unhealthy" || !pageVisible || loading) return;
    if (refreshSec > 0) return;
    if (!fetchRevisionRef.current || dataplaneRefreshSec <= 0) return;

    const tick = async () => {
      const generation = generationRef.current;
      try {
        const next = await runFetchItems(generation, "dataplane");
        if (!next) return;
        if (generation !== generationRef.current) return;
        setFetchedRows(next.rows);
        setDataplaneMeta(next.dataplaneMeta ?? null);
        setLastRefresh(new Date());
        setError(null);
        await syncRevisionMarker(generation, next);
      } catch {
        // keep previous data on dataplane refresh error
      }
    };

    const t = setInterval(() => void tick(), dataplaneRefreshSec * 1000);
    return () => clearInterval(t);
  }, [suspendPolling, dataplaneRefreshSec, enabled, health, pageVisible, loading, refreshSec, runFetchItems, syncRevisionMarker]);

  useEffect(() => {
    if (!abortWhenHidden || pageVisible) return;
    generationRef.current += 1;
    controllersRef.current.forEach((c) => c.abort());
    controllersRef.current.clear();
    fetchInFlightRef.current = null;
    foregroundRequestRef.current = null;
    setLoading(false);
  }, [abortWhenHidden, pageVisible]);

  const externalRetryRef = useRef({ generation: -1, failures: 0, nextAt: 0 });

  // Each effect waits for the current read, then fetches the newest notification.
  // Superseded effects are cancelled: bursts coalesce but never lose a trailing read.
  useEffect(() => {
    if (!enabled || !pageVisible || !externalRevision) return;
    let cancelled = false;
    const generation = generationRef.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    if (externalRetryRef.current.generation !== generation) {
      externalRetryRef.current = { generation, failures: 0, nextAt: 0 };
    }
    const retry = externalRetryRef.current;
    const attempt = async () => {
      if (cancelled || generation !== generationRef.current) return;
      // Preserve the failure deadline across newer notifications too: an event
      // burst must not turn an unavailable snapshot endpoint into a retry storm.
      const remaining = retry.nextAt - Date.now();
      if (remaining > 0) {
        timer = setTimeout(() => void attempt(), remaining);
        return;
      }
      try {
        // Recheck after every wait: a manual action may have queued behind
        // the same read. Foreground ownership wins regardless of waiter order.
        while (!cancelled && generation === generationRef.current) {
          const foreground = foregroundRequestRef.current;
          const pending = fetchInFlightRef.current;
          const promise = foreground?.generation === generation ? foreground.promise
            : pending?.generation === generation ? pending.promise : null;
          if (!promise) break;
          try { await promise; } catch { /* notification can recover */ }
        }
        if (cancelled || generation !== generationRef.current) return;
        controller = new AbortController();
        const next = await runFetchItems(generation, "revision", controller);
        if (!next || cancelled || generation !== generationRef.current) return;
        retry.failures = 0;
        retry.nextAt = 0;
        void syncRevisionMarker(generation, next, null);
        setFetchedRows(next.rows);
        setDataplaneMeta(next.dataplaneMeta ?? null);
        setLastRefresh(new Date());
        setError(null);
      } catch (err) {
        if (cancelled || generation !== generationRef.current) return;
        setError(toApiError(err));
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(retry.failures++, 5));
        retry.nextAt = Date.now() + delay;
        timer = setTimeout(() => void attempt(), delay);
      }
    };
    void attempt();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller?.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- queryKey is the caller-provided list identity
  }, [enabled, externalRevision, pageVisible, runFetchItems, syncRevisionMarker, ...(queryKey ?? [])]);

  const refetch = useCallback(() => loadInitial("manual"), [loadInitial]);
  return { items, dataplaneMeta, error, loading, lastRefresh, refetch };
}
