import type { SavedResourceViewDefinition } from "./settings";

export const APPLY_SAVED_RESOURCE_VIEW_EVENT = "kview:applySavedResourceView";
const PENDING_SAVED_RESOURCE_VIEW_KEY = "kview:savedResourceView:pending";

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
  resourceLabel: string;
  namespace?: string | null;
  filter?: string;
  filterLabel?: string;
}) {
  const resourceLabel = input.resourceLabel.trim().replace(/\s+/g, " ");
  const filterName = (input.filterLabel || input.filter || "").trim().replace(/\s+/g, " ");
  return filterName ? `${resourceLabel}: ${filterName}` : resourceLabel;
}
