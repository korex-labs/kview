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
  | "helm"
  | "helmcharts";

export type AppStateV1 = {
  v: 1;
  activeContext?: string;
  activeNamespace?: string;
  activeSection?: Section;
  favouriteNamespacesByContext: Record<string, string[]>;
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
    return parsed as AppStateV1;
  } catch {
    return { v: 1, favouriteNamespacesByContext: {} };
  }
}

export function saveState(s: AppStateV1) {
  localStorage.setItem(KEY, JSON.stringify(s));
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

