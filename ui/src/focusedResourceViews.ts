import type { ListResourceKey } from "./utils/k8sResources";

export const APPLY_FOCUSED_RESOURCE_VIEW_EVENT = "kview:applyFocusedResourceView";
const PENDING_FOCUSED_RESOURCE_VIEW_KEY = "kview:focusedResourceView:pending";

export type FocusedResourceViewIntent = {
  context?: string;
  namespace?: string;
  resource: ListResourceKey;
  filter?: string;
  label?: string;
  source?: "dashboard-signal" | "namespace-signal" | "search" | "resource-link";
};

function parseFocusedResourceViewIntent(value: unknown): FocusedResourceViewIntent | null {
  if (!value || typeof value !== "object") return null;
  const intent = value as Partial<FocusedResourceViewIntent>;
  if (typeof intent.resource !== "string" || !intent.resource.trim()) return null;
  return {
    context: typeof intent.context === "string" ? intent.context : undefined,
    namespace: typeof intent.namespace === "string" ? intent.namespace : undefined,
    resource: intent.resource as ListResourceKey,
    filter: typeof intent.filter === "string" ? intent.filter : undefined,
    label: typeof intent.label === "string" ? intent.label : undefined,
    source: intent.source,
  };
}

export function dispatchApplyFocusedResourceView(intent: FocusedResourceViewIntent) {
  storePendingFocusedResourceView(intent);
  window.dispatchEvent(new CustomEvent<FocusedResourceViewIntent>(APPLY_FOCUSED_RESOURCE_VIEW_EVENT, {
    detail: intent,
  }));
}

export function storePendingFocusedResourceView(intent: FocusedResourceViewIntent) {
  try {
    window.sessionStorage.setItem(PENDING_FOCUSED_RESOURCE_VIEW_KEY, JSON.stringify(intent));
  } catch {
    // Focused navigation should still work when session storage is unavailable.
  }
}

export function loadPendingFocusedResourceView(): FocusedResourceViewIntent | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_FOCUSED_RESOURCE_VIEW_KEY);
    if (!raw) return null;
    return parseFocusedResourceViewIntent(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearPendingFocusedResourceView() {
  try {
    window.sessionStorage.removeItem(PENDING_FOCUSED_RESOURCE_VIEW_KEY);
  } catch {
    // Ignore storage failures.
  }
}
