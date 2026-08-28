import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet } from "../api";
import type { DashboardSignalItem } from "../types/api";
import { useSignalExclusionsRevision } from "../signalExclusions";
import { useSignalSuppressionsRevision } from "../signalSuppressions";

/**
 * Scope of a resource for the per-resource signals endpoint. Mirrors the
 * backend ResourceSignalsScope* constants and selects between the two HTTP
 * routes:
 *   - "namespace" → GET /api/namespaces/{ns}/{kind}/{name}/signals
 *   - "cluster"   → GET /api/cluster/{kind}/{name}/signals
 */
export type ResourceSignalsScope = "namespace" | "cluster";

export type ResourceSignalsResponse = {
  active?: string;
  signals: DashboardSignalItem[];
  suppressedSignalCount?: number;
  suppressedSignals?: DashboardSignalItem[];
  meta?: {
    freshness?: string;
    degradation?: string;
  };
};

export type UseResourceSignalsOptions = {
  token: string;
  scope: ResourceSignalsScope;
  /** Required for scope="namespace"; ignored otherwise. */
  namespace?: string;
  /** URL plural segment, matching existing per-resource routes (e.g. "pods", "deployments", "nodes"). */
  kind: string;
  name: string;
  enabled?: boolean;
  /** Increment to force a refetch (e.g. on retry / focus). */
  refreshKey?: number;
};

export type UseResourceSignalsResult = {
  signals: DashboardSignalItem[];
  suppressedSignalCount: number;
  suppressedSignals: DashboardSignalItem[];
  meta?: ResourceSignalsResponse["meta"];
  loading: boolean;
  error: string;
  refetch: () => void;
};

function buildSignalsPath(scope: ResourceSignalsScope, namespace: string | undefined, kind: string, name: string): string | null {
  const encName = encodeURIComponent(name);
  const encKind = encodeURIComponent(kind);
  if (scope === "cluster") {
    return `/api/cluster/${encKind}/${encName}/signals`;
  }
  if (!namespace) return null;
  const encNs = encodeURIComponent(namespace);
  return `/api/namespaces/${encNs}/${encKind}/${encName}/signals`;
}

/**
 * useResourceSignals fetches dataplane-derived signals for a single resource
 * from the per-resource signals endpoint. The endpoint is cache-only on the
 * server, so it is safe to mount this hook unconditionally inside any
 * resource drawer's Overview tab.
 *
 * The hook only refetches when its identity inputs (scope/namespace/kind/name)
 * change or when `refreshKey` changes; it does not poll. Callers that want
 * polling should manage `refreshKey` themselves.
 *
 * Returns an empty `signals` array (never `null`) when the resource has no
 * attention-worthy state. Treat `error` as a soft failure for the Overview
 * section; do not block the drawer from rendering.
 */
export default function useResourceSignals(opts: UseResourceSignalsOptions): UseResourceSignalsResult {
  const { token, scope, namespace, kind, name, enabled = true, refreshKey = 0 } = opts;
  const signalExclusionsRevision = useSignalExclusionsRevision();
  const signalSuppressionsRevision = useSignalSuppressionsRevision();

  const [signals, setSignals] = useState<DashboardSignalItem[]>([]);
  const [suppressedSignalCount, setSuppressedSignalCount] = useState(0);
  const [suppressedSignals, setSuppressedSignals] = useState<DashboardSignalItem[]>([]);
  const [meta, setMeta] = useState<ResourceSignalsResponse["meta"]>();
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [internalKey, setInternalKey] = useState(0);

  const lastReqId = useRef(0);

  const refetch = useCallback(() => {
    setInternalKey((n) => n + 1);
  }, []);

  useEffect(() => {
    const reset = () => {
      setSignals([]);
      setSuppressedSignalCount(0);
      setSuppressedSignals([]);
      setMeta(undefined);
    };
    if (!enabled || !token || !kind || !name) {
      lastReqId.current += 1;
      reset();
      setError("");
      setLoading(false);
      return;
    }
    const path = buildSignalsPath(scope, namespace, kind, name);
    if (!path) {
      lastReqId.current += 1;
      reset();
      setError("");
      setLoading(false);
      return;
    }

    const reqId = ++lastReqId.current;
    setLoading(true);
    setError("");

    (async () => {
      try {
        const res = await apiGet<ResourceSignalsResponse>(path, token);
        if (reqId !== lastReqId.current) return;
        setSignals(Array.isArray(res?.signals) ? res.signals : []);
        setSuppressedSignalCount(
          typeof res?.suppressedSignalCount === "number" && Number.isFinite(res.suppressedSignalCount)
            ? Math.max(0, res.suppressedSignalCount)
            : 0,
        );
        setSuppressedSignals(Array.isArray(res?.suppressedSignals) ? res.suppressedSignals : []);
        setMeta(res?.meta);
      } catch (e) {
        if (reqId !== lastReqId.current) return;
        reset();
        setError(String(e));
      } finally {
        if (reqId === lastReqId.current) setLoading(false);
      }
    })();
  }, [token, scope, namespace, kind, name, enabled, refreshKey, internalKey, signalExclusionsRevision, signalSuppressionsRevision]);

  return { signals, suppressedSignalCount, suppressedSignals, meta, loading, error, refetch };
}
