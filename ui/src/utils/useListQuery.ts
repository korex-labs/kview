import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiError } from "../api";
import { toApiError } from "../api";
import type { DataplaneListMeta, ResourceListFetchResult } from "../types/api";
import { useConnectionState } from "../connectionState";
import usePageVisible from "./usePageVisible";

type UseListQueryOptions<T> = {
  enabled?: boolean;
  /** Inputs that identify the backing list; changes trigger a fresh load and discard stale in-flight results. */
  queryKey?: unknown[];
  /** Poll interval in seconds for full list refetch. When > 0, overrides revision-based polling. */
  refreshSec: number;
  fetchItems: () => Promise<ResourceListFetchResult<T>>;
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
}: UseListQueryOptions<T>): UseListQueryResult<T> {
  const [fetchedRows, setFetchedRows] = useState<T[]>([]);
  const [dataplaneMeta, setDataplaneMeta] = useState<DataplaneListMeta | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const { health } = useConnectionState();
  const pageVisible = usePageVisible();

  const onInitialResultRef = useRef(onInitialResult);

  useEffect(() => {
    onInitialResultRef.current = onInitialResult;
  }, [onInitialResult]);

  const fetchItemsRef = useRef(fetchItems);
  const fetchRevisionRef = useRef(fetchRevision);
  useEffect(() => {
    fetchItemsRef.current = fetchItems;
  }, [fetchItems]);
  useEffect(() => {
    fetchRevisionRef.current = fetchRevision;
  }, [fetchRevision]);

  const lastRevisionRef = useRef<string | null>(null);
  const generationRef = useRef(0);

  const loadInitial = useCallback(async () => {
    const generation = generationRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchItemsRef.current();
      if (generation !== generationRef.current) return;
      setFetchedRows(next.rows);
      setDataplaneMeta(next.dataplaneMeta ?? null);
      setLastRefresh(new Date());
      onInitialResultRef.current?.();
      const fr = fetchRevisionRef.current;
      if (fr) {
        try {
          const rev = await fr();
          if (generation !== generationRef.current) return;
          lastRevisionRef.current = rev;
        } catch {
          if (generation !== generationRef.current) return;
          lastRevisionRef.current = null;
        }
      } else {
        lastRevisionRef.current = null;
      }
    } catch (err) {
      if (generation !== generationRef.current) return;
      onInitialResultRef.current?.();
      setError(toApiError(err));
    } finally {
      if (generation === generationRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const mapRowsRef = useRef(mapRows);
  useEffect(() => {
    mapRowsRef.current = mapRows;
  }, [mapRows]);

  const items = useMemo(() => {
    const fn = mapRowsRef.current;
    if (!fn) return fetchedRows;
    return fn(fetchedRows);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mapRowsDeps mirrors caller intent
  }, [fetchedRows, mapRows, ...(mapRowsDeps ?? [])]);

  useEffect(() => {
    if (!enabled) return;
    generationRef.current += 1;
    setFetchedRows([]);
    setDataplaneMeta(null);
    setError(null);
    setLastRefresh(null);
    lastRevisionRef.current = null;
    void loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- queryKey is the caller-provided list identity
  }, [enabled, loadInitial, ...(queryKey ?? [])]);

  useEffect(() => {
    if (!enabled || health === "unhealthy" || !pageVisible || refreshSec <= 0) return;
    const t = setInterval(async () => {
      const generation = generationRef.current;
      try {
        const next = await fetchItemsRef.current();
        if (generation !== generationRef.current) return;
        setFetchedRows(next.rows);
        setDataplaneMeta(next.dataplaneMeta ?? null);
        setLastRefresh(new Date());
        setError(null);
        const fr = fetchRevisionRef.current;
        if (fr) {
          try {
            const rev = await fr();
            if (generation !== generationRef.current) return;
            lastRevisionRef.current = rev;
          } catch {
            /* keep previous revision marker */
          }
        }
      } catch {
        // keep previous data on refresh error
      }
    }, refreshSec * 1000);
    return () => clearInterval(t);
  }, [enabled, health, pageVisible, refreshSec, fetchItems]);

  useEffect(() => {
    if (!enabled || health === "unhealthy" || !pageVisible || loading) return;
    if (refreshSec > 0) return;
    const fr = fetchRevisionRef.current;
    if (!fr || revisionPollSec <= 0) return;

    const tick = async () => {
      const generation = generationRef.current;
      try {
        const rev = await fr();
        if (generation !== generationRef.current) return;
        const prev = lastRevisionRef.current;
        if (prev === null) {
          lastRevisionRef.current = rev;
          return;
        }
        if (prev !== rev) {
          lastRevisionRef.current = rev;
          const next = await fetchItemsRef.current();
          if (generation !== generationRef.current) return;
          setFetchedRows(next.rows);
          setDataplaneMeta(next.dataplaneMeta ?? null);
          setLastRefresh(new Date());
          setError(null);
        }
      } catch {
        // keep previous data
      }
    };

    const t = setInterval(() => void tick(), revisionPollSec * 1000);
    return () => clearInterval(t);
  }, [enabled, health, pageVisible, loading, refreshSec, revisionPollSec, fetchRevision]);

  useEffect(() => {
    if (!enabled || health === "unhealthy" || !pageVisible || loading) return;
    if (refreshSec > 0) return;
    if (!fetchRevisionRef.current || dataplaneRefreshSec <= 0) return;

    const tick = async () => {
      const generation = generationRef.current;
      try {
        const next = await fetchItemsRef.current();
        if (generation !== generationRef.current) return;
        setFetchedRows(next.rows);
        setDataplaneMeta(next.dataplaneMeta ?? null);
        setLastRefresh(new Date());
        setError(null);
        const fr = fetchRevisionRef.current;
        if (fr) {
          try {
            const rev = await fr();
            if (generation !== generationRef.current) return;
            lastRevisionRef.current = rev;
          } catch {
            /* keep previous revision marker */
          }
        }
      } catch {
        // keep previous data on dataplane refresh error
      }
    };

    const t = setInterval(() => void tick(), dataplaneRefreshSec * 1000);
    return () => clearInterval(t);
  }, [dataplaneRefreshSec, enabled, health, pageVisible, loading, refreshSec]);

  return { items, dataplaneMeta, error, loading, lastRefresh, refetch: loadInitial };
}
