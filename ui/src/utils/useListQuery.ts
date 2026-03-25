import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiError } from "../api";
import { toApiError } from "../api";
import type { DataplaneListMeta, ResourceListFetchResult } from "../types/api";
import { useConnectionState } from "../connectionState";

type UseListQueryOptions<T> = {
  enabled?: boolean;
  refreshSec: number;
  fetchItems: () => Promise<ResourceListFetchResult<T>>;
  onInitialResult?: () => void;
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
  refreshSec,
  fetchItems,
  onInitialResult,
}: UseListQueryOptions<T>): UseListQueryResult<T> {
  const [items, setItems] = useState<T[]>([]);
  const [dataplaneMeta, setDataplaneMeta] = useState<DataplaneListMeta | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const { retryNonce } = useConnectionState();

  const onInitialResultRef = useRef(onInitialResult);

  useEffect(() => {
    onInitialResultRef.current = onInitialResult;
  }, [onInitialResult]);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchItems();
      setItems(next.rows);
      setDataplaneMeta(next.dataplaneMeta ?? null);
      setLastRefresh(new Date());
      onInitialResultRef.current?.();
    } catch (err) {
      setItems([]);
      setDataplaneMeta(null);
      onInitialResultRef.current?.();
      setError(toApiError(err));
    } finally {
      setLoading(false);
    }
  }, [fetchItems]);

  useEffect(() => {
    if (!enabled) return;
    void loadInitial();
  }, [enabled, loadInitial, retryNonce]);

  useEffect(() => {
    if (!enabled || refreshSec <= 0) return;
    const t = setInterval(async () => {
      try {
        const next = await fetchItems();
        setItems(next.rows);
        setDataplaneMeta(next.dataplaneMeta ?? null);
        setLastRefresh(new Date());
        setError(null);
      } catch {
        // keep previous data on refresh error
      }
    }, refreshSec * 1000);
    return () => clearInterval(t);
  }, [enabled, refreshSec, fetchItems]);

  return { items, dataplaneMeta, error, loading, lastRefresh, refetch: loadInitial };
}
