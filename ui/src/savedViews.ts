import type { SavedResourceViewDefinition } from "./settings";
import type { GridColumnVisibilityModel, GridSortModel } from "@mui/x-data-grid";
import { getResourceLabel, getResourceViewPolicy, type ListResourceKey } from "./utils/k8sResources";

export const APPLY_SAVED_RESOURCE_VIEW_EVENT = "kview:applySavedResourceView";
const PENDING_SAVED_RESOURCE_VIEW_KEY = "kview:savedResourceView:pending";

export function isDashboardSavedView(view: SavedResourceViewDefinition | null | undefined): boolean {
  return view?.viewType === "dashboard" && !!view.dashboardSnapshot;
}

export function isResourceSavedView(view: SavedResourceViewDefinition | null | undefined): boolean {
  return !isDashboardSavedView(view);
}

export function dispatchApplySavedResourceView(view: SavedResourceViewDefinition) {
  storePendingSavedResourceView(view);
  window.dispatchEvent(new CustomEvent<SavedResourceViewDefinition>(APPLY_SAVED_RESOURCE_VIEW_EVENT, {
    detail: view,
  }));
}

export function storePendingSavedResourceView(view: SavedResourceViewDefinition) {
  try {
    window.sessionStorage.setItem(PENDING_SAVED_RESOURCE_VIEW_KEY, JSON.stringify(view));
  } catch {
    // Saved views should still navigate/apply when session storage is unavailable.
  }
}

export function loadPendingSavedResourceView(): SavedResourceViewDefinition | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_SAVED_RESOURCE_VIEW_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as SavedResourceViewDefinition : null;
  } catch {
    return null;
  }
}

export function clearPendingSavedResourceView() {
  try {
    window.sessionStorage.removeItem(PENDING_SAVED_RESOURCE_VIEW_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function defaultSavedResourceViewName(input: {
  resource: ListResourceKey;
  resourceLabel?: string;
  namespace?: string | null;
  filter?: string;
  filterLabel?: string;
}) {
  const policy = getResourceViewPolicy(input.resource);
  const resourceLabel = (policy.savedViews.namePrefix || input.resourceLabel || getResourceLabel(input.resource)).trim().replace(/\s+/g, " ");
  const filterName = (input.filterLabel || input.filter || "").trim().replace(/\s+/g, " ");
  return filterName ? `${resourceLabel}: ${filterName}` : resourceLabel;
}

export function savedResourceViewsEnabled(resource: ListResourceKey): boolean {
  return getResourceViewPolicy(resource).savedViews.enabled;
}

export function recordsEqual<T extends string | number | boolean>(a: Record<string, T>, b: Record<string, T>): boolean {
  const aEntries = Object.entries(a);
  const bEntries = Object.entries(b);
  if (aEntries.length !== bEntries.length) return false;
  return aEntries.every(([key, value]) => b[key] === value);
}

export function sortModelsEqual(
  a: ReadonlyArray<{ field: string; sort?: unknown }>,
  b: ReadonlyArray<{ field: string; sort?: unknown }>,
): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) => item.field === b[index]?.field && item.sort === b[index]?.sort);
}

export function savedSortModelFromGrid(sortModel: GridSortModel): SavedResourceViewDefinition["sortModel"] {
  return sortModel
    .filter((item) => item.field && (item.sort === "asc" || item.sort === "desc"))
    .map((item) => ({ field: item.field, sort: item.sort === "desc" ? "desc" : "asc" }));
}

export function savedViewMatchesLocation(
  view: SavedResourceViewDefinition,
  input: {
    context: string;
    namespace: string;
    resource: ListResourceKey;
  },
): boolean {
  if (!isResourceSavedView(view)) return false;
  const policy = getResourceViewPolicy(input.resource).savedViews;
  if (!policy.enabled || view.resource !== input.resource) return false;
  const location = new Set(policy.location);
  return (
    (!location.has("context") || view.context === input.context) &&
    (!location.has("namespace") || view.namespace === input.namespace) &&
    (!location.has("resource") || view.resource === input.resource)
  );
}

export function savedViewMatchesCurrentState(
  view: SavedResourceViewDefinition,
  input: {
    context: string;
    namespace: string;
    resource: ListResourceKey;
    filter: string;
    sortModel: GridSortModel;
    columnVisibilityModel: GridColumnVisibilityModel;
    columnWidths: Record<string, number>;
  },
): boolean {
  if (!savedViewMatchesLocation(view, input)) return false;
  const state = new Set(getResourceViewPolicy(input.resource).savedViews.state);
  return (
    (!state.has("filter") || view.filter === input.filter) &&
    (!state.has("sort") || sortModelsEqual(view.sortModel, savedSortModelFromGrid(input.sortModel))) &&
    (!state.has("columns") || (
      recordsEqual(view.columnVisibilityModel, input.columnVisibilityModel as Record<string, boolean>) &&
      recordsEqual(view.columnWidths, input.columnWidths)
    ))
  );
}
