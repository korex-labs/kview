import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchNamespacedResourceDetailWithWarnings,
  type NamespacedResourceDetailFetchResult,
  type ResourceWarningEvent,
} from "./resourceDrawerFetch";

type FetchDetail<TDetails> = (args: {
  token: string;
  namespace: string;
  resource: string;
  name: string;
}) => Promise<NamespacedResourceDetailFetchResult<TDetails>>;

type Options<TDetails> = {
  open: boolean;
  token: string;
  namespace: string;
  resource: string;
  name: string | null;
  retryNonce: number;
  onReset?: () => void;
  fetchDetail?: FetchDetail<TDetails>;
};

export default function useNamespacedResourceDrawerDetail<TDetails>({
  open,
  token,
  namespace,
  resource,
  name,
  retryNonce,
  onReset,
  fetchDetail,
}: Options<TDetails>) {
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<TDetails | null>(null);
  const [events, setEvents] = useState<ResourceWarningEvent[]>([]);
  const [error, setError] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const onResetRef = useRef(onReset);
  const fetchDetailRef = useRef(fetchDetail);
  const requestIdRef = useRef(0);
  onResetRef.current = onReset;
  fetchDetailRef.current = fetchDetail;

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    if (!open || !name) {
      setLoading(false);
      return;
    }
    onResetRef.current?.();
    setError("");
    setDetails(null);
    setEvents([]);
    setLoading(true);

    const load = fetchDetailRef.current ?? fetchNamespacedResourceDetailWithWarnings<TDetails>;
    load({ token, namespace, resource, name })
      .then((result) => {
        if (requestIdRef.current !== requestId) return;
        setDetails(result.item);
        setEvents(result.warningEvents);
      })
      .catch((cause) => {
        if (requestIdRef.current === requestId) setError(String(cause));
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setLoading(false);
      });

    return () => {
      if (requestIdRef.current === requestId) requestIdRef.current += 1;
    };
  }, [open, name, namespace, token, resource, retryNonce, refreshNonce]);

  const refresh = useCallback(() => setRefreshNonce((value) => value + 1), []);

  return { loading, details, events, error, refresh };
}
