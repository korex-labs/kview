import { useEffect, useState } from "react";
import { apiGetWithContext } from "../../api";
import { useActiveContext } from "../../activeContext";
import { useConnectionState } from "../../connectionState";
import type {
  ApiMetricsStatusResponse,
  MetricsCapability,
} from "../../types/api";

export type MetricsStatus = {
  loaded: boolean;
  enabled: boolean;
  capability: MetricsCapability;
};

const DEFAULT_CAPABILITY: MetricsCapability = { installed: false, allowed: false };
const INITIAL_STATUS: MetricsStatus = {
  loaded: false,
  enabled: false,
  capability: DEFAULT_CAPABILITY,
};
const metricsStatusCache = new Map<
  string,
  {
    expiresAt: number;
    promise?: Promise<MetricsStatus>;
    value?: MetricsStatus;
  }
>();
const metricsStatusTtlMs = 30_000;

function metricsStatusCacheKey(token: string, contextName: string): string {
  return `${contextName}\n${token}`;
}

function loadMetricsStatus(token: string, contextName: string): Promise<MetricsStatus> {
  const key = metricsStatusCacheKey(token, contextName);
  const now = Date.now();
  const cached = metricsStatusCache.get(key);
  if (cached && cached.expiresAt > now) {
    if (cached.value) return Promise.resolve(cached.value);
    if (cached.promise) return cached.promise;
  }

  const promise = apiGetWithContext<ApiMetricsStatusResponse>(
    "/api/dataplane/metrics/status",
    token,
    contextName,
  )
    .then((res) => {
      const value = {
        loaded: true,
        enabled: Boolean(res.enabled),
        capability: res.capability ?? DEFAULT_CAPABILITY,
      };
      metricsStatusCache.set(key, { value, expiresAt: Date.now() + metricsStatusTtlMs });
      return value;
    })
    .catch((err) => {
      metricsStatusCache.delete(key);
      throw err;
    });
  metricsStatusCache.set(key, { promise, expiresAt: now + metricsStatusTtlMs });
  return promise;
}

/**
 * Returns whether pod/node metrics are usable for the active cluster.
 * Backed by GET /api/dataplane/metrics/status, which folds in the user's
 * DataplanePolicy.Metrics.Enabled flag and a short-TTL cached probe of
 * metrics.k8s.io (discovery + SelfSubjectAccessReview). The hook is idempotent
 * for multiple simultaneous consumers — the backend caches the probe so
 * repeated calls are cheap.
 */
export function useMetricsStatus(token: string): MetricsStatus {
  const activeContext = useActiveContext();
  const { health } = useConnectionState();
  const [status, setStatus] = useState<MetricsStatus>(INITIAL_STATUS);

  useEffect(() => {
    if (!activeContext) {
      setStatus(INITIAL_STATUS);
      return;
    }
    if (health === "unhealthy") {
      setStatus({ loaded: true, enabled: false, capability: DEFAULT_CAPABILITY });
      return;
    }
    let cancelled = false;
    loadMetricsStatus(token, activeContext)
      .then((res) => {
        if (cancelled) return;
        setStatus(res);
      })
      .catch(() => {
        if (cancelled) return;
        setStatus({ loaded: true, enabled: false, capability: DEFAULT_CAPABILITY });
      });
    return () => {
      cancelled = true;
    };
  }, [activeContext, token, health]);

  return status;
}

/**
 * isMetricsUsable centralises the "should I show usage widgets?" decision so
 * list rows, drawers, and dashboard panels stay consistent. Callers that
 * already know the status can skip useMetricsStatus entirely.
 */
export function isMetricsUsable(status: MetricsStatus): boolean {
  return status.loaded && status.enabled && status.capability.installed && status.capability.allowed;
}
