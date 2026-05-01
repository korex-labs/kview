export type Section =
  | "dashboard"
  | "pods"
  | "nodes"
  | "namespaces"
  | "deployments"
  | "daemonsets"
  | "statefulsets"
  | "replicasets"
  | "jobs"
  | "cronjobs"
  | "horizontalpodautoscalers"
  | "services"
  | "ingresses"
  | "configmaps"
  | "secrets"
  | "serviceaccounts"
  | "roles"
  | "rolebindings"
  | "clusterroles"
  | "clusterrolebindings"
  | "persistentvolumes"
  | "persistentvolumeclaims"
  | "customresourcedefinitions"
  | "customresources"
  | "clusterresources"
  | "helm"
  | "helmcharts";

export type AppStateV1 = {
  v: 1;
  activeContext?: string;
  activeNamespace?: string;
  activeSection?: Section;
  favouriteNamespacesByContext: Record<string, string[]>;
  /** MRU namespaces per kube context (for background list enrichment). */
  recentNamespacesByContext?: Record<string, string[]>;
};

const KEY = "kview.state.v1";
const QUICK_FILTERS_KEY = "kview:list:quickFilters:selected";
const LIST_TEXT_FILTER_KEY = "kview:list:filter:text";

export function loadState(): AppStateV1 {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      return { v: 1, favouriteNamespacesByContext: {} };
    }
    const parsed = JSON.parse(raw);
    if (parsed?.v !== 1) return { v: 1, favouriteNamespacesByContext: {} };
    if (!parsed.favouriteNamespacesByContext) parsed.favouriteNamespacesByContext = {};
    if (!parsed.recentNamespacesByContext) parsed.recentNamespacesByContext = {};
    return parsed as AppStateV1;
  } catch {
    return { v: 1, favouriteNamespacesByContext: {} };
  }
}

export function saveState(s: AppStateV1) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

const MAX_RECENT_NAMESPACES = 20;
const MAX_FAVOURITES_FOR_ENRICH_QUERY = 40;

export function namespaceSmartSortRank(name: string, favourites: Iterable<string>, recent: readonly string[]): number {
  const favouriteSet = favourites instanceof Set ? favourites : new Set(favourites);
  const recentIndex = recent.indexOf(name);
  const isFavourite = favouriteSet.has(name);
  const isRecent = recentIndex >= 0;
  const groupRank = isFavourite && isRecent ? 0 : isFavourite ? 1 : isRecent ? 2 : 3;
  const orderInGroup = isRecent ? recentIndex : 0;
  return groupRank * 100_000 + orderInGroup;
}

export function namespaceSmartSortKey(name: string, favourites: Iterable<string>, recent: readonly string[]): string {
  const rank = namespaceSmartSortRank(name, favourites, recent);
  return `${String(rank).padStart(6, "0")}:${name}`;
}

export function sortNamespaces(
  namespaces: readonly string[],
  favourites: readonly string[],
  recent: readonly string[],
  smartSorting: boolean,
): string[] {
  const favouriteSet = new Set(favourites);
  const sorted = [...namespaces];
  if (!smartSorting) {
    const fav = sorted.filter((n) => favouriteSet.has(n)).sort((a, b) => a.localeCompare(b));
    const rest = sorted.filter((n) => !favouriteSet.has(n)).sort((a, b) => a.localeCompare(b));
    return [...fav, ...rest];
  }
  return sorted.sort((a, b) => {
    const rankA = namespaceSmartSortRank(a, favouriteSet, recent);
    const rankB = namespaceSmartSortRank(b, favouriteSet, recent);
    if (rankA !== rankB) return rankA - rankB;
    return a.localeCompare(b);
  });
}

/** Path for GET /api/namespaces including enrichment hint query (current, recent, favourites). */
export function namespacesListApiPath(
  state: AppStateV1,
  contextName: string,
  focusNamespace: string,
  recentLimit = MAX_RECENT_NAMESPACES,
  favouriteLimit = MAX_FAVOURITES_FOR_ENRICH_QUERY,
): string {
  const params = new URLSearchParams();
  const focus = (focusNamespace || "").trim();
  if (focus) params.set("enrichFocus", focus);
  const recent = (state.recentNamespacesByContext?.[contextName] || []).filter(Boolean).slice(0, Math.max(0, recentLimit));
  if (recent.length) params.set("enrichRecent", recent.join(","));
  const fav = (state.favouriteNamespacesByContext?.[contextName] || [])
    .filter(Boolean)
    .slice(0, Math.max(0, favouriteLimit));
  if (fav.length) params.set("enrichFav", fav.join(","));
  const q = params.toString();
  return q ? `/api/namespaces?${q}` : "/api/namespaces";
}

export function recordRecentNamespace(state: AppStateV1, ctx: string, ns: string): AppStateV1 {
  if (!ctx || !ns) return state;
  const prev = state.recentNamespacesByContext?.[ctx] || [];
  const next = [ns, ...prev.filter((x) => x !== ns)].slice(0, MAX_RECENT_NAMESPACES);
  return {
    ...state,
    recentNamespacesByContext: {
      ...(state.recentNamespacesByContext || {}),
      [ctx]: next,
    },
  };
}

export function toggleFavouriteNamespace(state: AppStateV1, ctx: string, ns: string): AppStateV1 {
  const fav = new Set(state.favouriteNamespacesByContext[ctx] || []);
  if (fav.has(ns)) fav.delete(ns);
  else fav.add(ns);

  return {
    ...state,
    favouriteNamespacesByContext: {
      ...state.favouriteNamespacesByContext,
      [ctx]: Array.from(fav).sort((a, b) => a.localeCompare(b)),
    },
  };
}

export function loadQuickFilterSelection(): string[] {
  try {
    const raw = localStorage.getItem(QUICK_FILTERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v) => typeof v === "string" && v.trim());
  } catch {
    return [];
  }
}

export function saveQuickFilterSelection(ids: string[]) {
  const cleaned = Array.from(new Set(ids.filter((v) => v && v.trim())));
  localStorage.setItem(QUICK_FILTERS_KEY, JSON.stringify(cleaned));
}

export function loadListTextFilter(): string {
  try {
    const raw = localStorage.getItem(LIST_TEXT_FILTER_KEY);
    return raw ?? "";
  } catch {
    return "";
  }
}

export function saveListTextFilter(value: string) {
  localStorage.setItem(LIST_TEXT_FILTER_KEY, value ?? "");
}
