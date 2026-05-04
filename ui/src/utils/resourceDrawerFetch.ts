import { apiGet } from "../api";
import type { ApiItemResponse, ApiListResponse, DashboardSignalItem } from "../types/api";

export type ResourceWarningEvent = {
  type: string;
  reason: string;
  message: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
};

export type DetailResponseWithSignals<TDetails> = ApiItemResponse<TDetails> & {
  detailSignals?: DashboardSignalItem[];
};

type ApiGetFn = <T>(path: string, token: string) => Promise<T>;

export type NamespacedResourceDetailFetchResult<TDetails> = {
  item: TDetails | null;
  detailSignals: DashboardSignalItem[];
  warningEvents: ResourceWarningEvent[];
};

export type ClusterResourceDetailFetchResult<TDetails> = NamespacedResourceDetailFetchResult<TDetails>;

export async function fetchNamespacedResourceDetailWithWarnings<TDetails>({
  token,
  namespace,
  resource,
  name,
  apiGetFn = apiGet,
}: {
  token: string;
  namespace: string;
  resource: string;
  name: string;
  apiGetFn?: ApiGetFn;
}): Promise<NamespacedResourceDetailFetchResult<TDetails>> {
  const ns = encodeURIComponent(namespace);
  const encodedName = encodeURIComponent(name);
  const basePath = `/api/namespaces/${ns}/${resource}/${encodedName}`;

  const [detail, events] = await Promise.all([
    apiGetFn<DetailResponseWithSignals<TDetails>>(basePath, token),
    apiGetFn<ApiListResponse<ResourceWarningEvent>>(`${basePath}/events?limit=5&type=Warning`, token),
  ]);

  return {
    item: detail?.item ?? null,
    detailSignals: Array.isArray(detail?.detailSignals) ? detail.detailSignals : [],
    warningEvents: events?.items || [],
  };
}

export async function fetchClusterResourceDetailWithWarnings<TDetails>({
  token,
  resource,
  name,
  apiGetFn = apiGet,
}: {
  token: string;
  resource: string;
  name: string;
  apiGetFn?: ApiGetFn;
}): Promise<ClusterResourceDetailFetchResult<TDetails>> {
  const encodedName = encodeURIComponent(name);
  const basePath = `/api/${resource}/${encodedName}`;

  const [detail, events] = await Promise.all([
    apiGetFn<DetailResponseWithSignals<TDetails>>(basePath, token),
    apiGetFn<ApiListResponse<ResourceWarningEvent>>(`${basePath}/events?limit=5&type=Warning`, token),
  ]);

  return {
    item: detail?.item ?? null,
    detailSignals: Array.isArray(detail?.detailSignals) ? detail.detailSignals : [],
    warningEvents: events?.items || [],
  };
}
