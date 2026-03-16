/**
 * Shared API response and DTO types for type-safe apiGet/apiPost usage.
 * Response wrappers match backend JSON shape (item/items).
 */

/** Single resource response: { item?: T } (backend may add e.g. "active") */
export type ApiItemResponse<T> = { item?: T };

/** List response: { items?: T[] } */
export type ApiListResponse<T> = { items?: T[] };

/** /api/contexts response */
export type ApiContextsResponse = { contexts?: Array<{ name: string }> };

/** /api/namespaces list response (list of namespace objects with name) */
export type ApiNamespacesListResponse = {
  limited?: boolean;
  items?: Array<{ name: string }>;
};

/** /api/dashboard/cluster response */
export type ApiDashboardClusterResponse = {
  active?: string;
  item?: {
    namespaces: {
      total: number;
      unhealthy: number;
      freshness: string;
      coverage: string;
      degradation: string;
      completeness: string;
      state: string;
      observerState: string;
    };
    nodes: {
      total: number;
      freshness: string;
      coverage: string;
      degradation: string;
      completeness: string;
      state: string;
      observerState: string;
    };
  };
};

/** Event shape returned by .../events endpoints; used by EventsList and drawers */
export type EventDTO = {
  type: string;
  reason: string;
  message: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  fieldPath?: string;
};
