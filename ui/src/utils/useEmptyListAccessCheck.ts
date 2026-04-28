import { useEffect, useMemo, useState } from "react";
import { apiPost, toApiError, type ApiError } from "../api";
import { useConnectionState } from "../connectionState";
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

function getCachedAllowed(key: string): boolean | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.allowed;
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

export default function useEmptyListAccessCheck({
  token,
  itemsLength,
  error,
  loading,
  resource,
  namespace,
  contextName = "",
  verb = "list",
}: {
  token: string;
  itemsLength: number;
  error: ApiError | null;
  loading: boolean;
  resource: AccessReviewResource;
  namespace?: string | null;
  contextName?: string;
  verb?: string;
}) {
  const [accessDenied, setAccessDenied] = useState(false);
  const { health } = useConnectionState();
  const nsValue = namespace ?? null;

  const shouldCheck = health === "healthy" && !loading && !error && itemsLength === 0;
  const key = useMemo(
    () => [contextName, buildKey(token, verb, resource, nsValue)].join("|"),
    [contextName, token, verb, resource, nsValue],
  );

  useEffect(() => {
    if (!shouldCheck) {
      setAccessDenied(false);
      return;
    }

    const cached = getCachedAllowed(key);
    if (cached !== undefined) {
      setAccessDenied(!cached);
      return;
    }

    let cancelled = false;
    setAccessDenied(false);

    let promise = inflight.get(key);
    if (!promise) {
      promise = fetchCanI(token, contextName, verb, resource, nsValue);
      inflight.set(key, promise);
    }

    promise
      .then((res) => {
        if (cancelled) return;
        setCached(key, res);
        setAccessDenied(!res.allowed);
      })
      .catch((err) => {
        if (cancelled) return;
        const apiErr = toApiError(err);
        if (apiErr.status === 401 || apiErr.status === 403) {
          setAccessDenied(true);
          return;
        }
        setAccessDenied(false);
      })
      .finally(() => {
        if (inflight.get(key) === promise) {
          inflight.delete(key);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [contextName, key, shouldCheck, token, verb, resource, nsValue]);

  return accessDenied;
}
