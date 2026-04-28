import { useEffect, useMemo, useState } from "react";
import { apiPost, toApiError, type ApiError } from "../api";
import { useActiveContext } from "../activeContext";
import type { AccessReviewResource } from "./k8sResources";

type CanIResponse = {
  allowed: boolean;
  reason?: string;
};

const CACHE_TTL_MS = 45 * 1000;
const cache = new Map<string, { allowed: boolean; reason?: string; expiresAt: number }>();
const inflight = new Map<string, Promise<CanIResponse>>();

function buildKey(
  token: string,
  verb: string,
  resource: AccessReviewResource,
  namespace: string | null,
) {
  return [token, verb, resource.group, resource.resource, namespace ?? ""].join("|");
}

function getCached(key: string): { allowed: boolean; reason?: string } | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return { allowed: entry.allowed, reason: entry.reason };
}

function setCached(key: string, res: CanIResponse) {
  cache.set(key, {
    allowed: res.allowed,
    reason: res.reason,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

async function fetchCanI(
  token: string,
  contextName: string,
  verb: string,
  resource: AccessReviewResource,
  namespace: string | null,
): Promise<CanIResponse> {
  return apiPost<CanIResponse>(
    "/api/auth/can-i",
    token,
    {
      verb,
      resource: resource.resource,
      group: resource.group,
      namespace,
    },
    contextName ? { headers: { "X-Kview-Context": contextName } } : undefined,
  );
}

export default function useAccessReview({
  token,
  resource,
  namespace,
  verb = "get",
  enabled = true,
}: {
  token: string;
  resource: AccessReviewResource;
  namespace?: string | null;
  verb?: string;
  enabled?: boolean;
}) {
  const [allowed, setAllowed] = useState(true);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const activeContext = useActiveContext();
  const nsValue = namespace ?? null;
  const key = useMemo(
    () => [activeContext, buildKey(token, verb, resource, nsValue)].join("|"),
    [activeContext, token, verb, resource, nsValue],
  );

  useEffect(() => {
    if (!enabled) {
      setAllowed(true);
      setReason("");
      setLoading(false);
      setError(null);
      return;
    }

    const cached = getCached(key);
    if (cached !== undefined) {
      setAllowed(cached.allowed);
      setReason(cached.reason || "");
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    let promise = inflight.get(key);
    if (!promise) {
      promise = fetchCanI(token, activeContext, verb, resource, nsValue);
      inflight.set(key, promise);
    }

    promise
      .then((res) => {
        if (cancelled) return;
        setCached(key, res);
        setAllowed(res.allowed);
        setReason(res.reason || "");
      })
      .catch((err) => {
        if (cancelled) return;
        setAllowed(true);
        setReason("");
        setError(toApiError(err));
      })
      .finally(() => {
        if (inflight.get(key) === promise) {
          inflight.delete(key);
        }
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeContext, key, enabled, token, verb, resource, nsValue]);

  return { allowed, reason, loading, error };
}
