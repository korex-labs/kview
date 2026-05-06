import { apiGet, apiGetWithContext } from "../api";

/** Default interval for GET /api/dataplane/revision polling (seconds). */
export const defaultRevisionPollSec = 5;

export type ApiDataplaneRevisionResponse = {
  active?: string;
  kind?: string;
  namespace?: string;
  revision?: string;
  known?: boolean;
  observed?: string;
  freshness?: string;
  state?: string;
};

/**
 * Returns a fetcher for dataplane list revision strings (compare with ===).
 * Kind values match backend ResourceKind strings (e.g. "pods", "namespaces", "persistentvolumeclaims").
 */
export function dataplaneRevisionFetcher(token: string, kind: string, namespace?: string | null) {
  return async (contextName?: string): Promise<string> => {
    const q = new URLSearchParams({ kind });
    if (namespace) {
      q.set("namespace", namespace);
    }
    const path = `/api/dataplane/revision?${q.toString()}`;
    const res = contextName
      ? await apiGetWithContext<ApiDataplaneRevisionResponse>(path, token, contextName)
      : await apiGet<ApiDataplaneRevisionResponse>(path, token);
    if (!res.known) {
      return "0";
    }
    return res.revision ?? "0";
  };
}
