// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APPLY_SAVED_RESOURCE_VIEW_EVENT,
  clearPendingSavedResourceView,
  defaultSavedResourceViewName,
  dispatchApplySavedResourceView,
  loadPendingSavedResourceView,
  storePendingSavedResourceView,
} from "./savedViews";
import type { SavedResourceViewDefinition } from "./settings";

const view: SavedResourceViewDefinition = {
  id: "namespaces-prod",
  name: "Namespaces: tag:prod",
  context: "prod",
  namespace: "",
  resource: "namespaces",
  filter: "tag:prod-id",
  sortModel: [{ field: "name", sort: "asc" }],
  columnVisibilityModel: { phase: true, internal: false },
  columnWidths: { name: 260 },
  createdAt: 10,
  updatedAt: 20,
};

afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("saved view helpers", () => {
  it("builds concise default names from resource and filter labels", () => {
    expect(defaultSavedResourceViewName({
      resourceLabel: "Namespaces",
      filter: "tag:team-a-id",
      filterLabel: "tag:team-a",
    })).toBe("Namespaces: tag:team-a");

    expect(defaultSavedResourceViewName({
      resourceLabel: "  Pods  ",
      filter: "  app = api  ",
    })).toBe("Pods: app = api");

    expect(defaultSavedResourceViewName({
      resourceLabel: "Cluster Roles",
    })).toBe("Cluster Roles");
  });

  it("stores, loads, and clears pending saved views", () => {
    storePendingSavedResourceView(view);

    expect(loadPendingSavedResourceView()).toEqual(view);

    clearPendingSavedResourceView();
    expect(loadPendingSavedResourceView()).toBeNull();
  });

  it("dispatches apply events and records a pending handoff", () => {
    const listener = vi.fn();
    window.addEventListener(APPLY_SAVED_RESOURCE_VIEW_EVENT, listener);

    dispatchApplySavedResourceView(view);

    expect(loadPendingSavedResourceView()).toEqual(view);
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent<SavedResourceViewDefinition>).detail).toEqual(view);

    window.removeEventListener(APPLY_SAVED_RESOURCE_VIEW_EVENT, listener);
  });

  it("treats unavailable session storage as non-fatal", () => {
    vi.spyOn(window.sessionStorage.__proto__, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(window.sessionStorage.__proto__, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(window.sessionStorage.__proto__, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => storePendingSavedResourceView(view)).not.toThrow();
    expect(loadPendingSavedResourceView()).toBeNull();
    expect(() => clearPendingSavedResourceView()).not.toThrow();
  });
});
