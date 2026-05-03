import { beforeEach, describe, expect, it } from "vitest";
import {
  loadState,
  namespaceSmartSortKey,
  recordRecentSection,
  saveState,
  setSidebarGroupCollapsed,
  sortNamespaces,
} from "./state";

beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      clear: () => store.clear(),
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      removeItem: (key: string) => store.delete(key),
      setItem: (key: string, value: string) => store.set(key, value),
    },
  });
});

describe("namespace sorting", () => {
  it("keeps the legacy favourite-first alphabetical order when smart sorting is disabled", () => {
    expect(sortNamespaces(["zeta", "apps", "default", "kube-system"], ["zeta", "default"], ["apps"], false))
      .toEqual(["default", "zeta", "apps", "kube-system"]);
  });

  it("prioritizes recent favourites, favourites, recent namespaces, then the rest", () => {
    expect(sortNamespaces(
      ["zeta", "apps", "default", "kube-system", "observability", "dev"],
      ["zeta", "default", "observability"],
      ["apps", "zeta", "dev", "observability"],
      true,
    )).toEqual(["zeta", "observability", "default", "apps", "dev", "kube-system"]);
  });

  it("uses MRU order inside recent groups", () => {
    const compare = namespaceSmartSortKey("apps", ["apps"], ["apps", "dev"])
      .localeCompare(namespaceSmartSortKey("dev", ["dev"], ["apps", "dev"]));
    expect(compare).toBeLessThan(0);
  });
});

describe("recent sections", () => {
  it("keeps a deduplicated MRU list capped by the configured limit", () => {
    const state = { v: 1 as const, favouriteNamespacesByContext: {} };
    const afterPods = recordRecentSection(state, "pods", 3);
    const afterServices = recordRecentSection(afterPods, "services", 3);
    const afterNodes = recordRecentSection(afterServices, "nodes", 3);
    const afterPodsAgain = recordRecentSection(afterNodes, "pods", 3);
    const afterHelm = recordRecentSection(afterPodsAgain, "helm", 3);

    expect(afterHelm.recentSections).toEqual(["helm", "pods", "nodes"]);
  });
});

describe("sidebar collapsed groups", () => {
  it("persists collapsed state through app state storage", () => {
    const state = setSidebarGroupCollapsed({ v: 1, favouriteNamespacesByContext: {} }, "workloads", true);
    saveState(setSidebarGroupCollapsed(state, "networking", false));

    expect(loadState().sidebarCollapsedGroups).toEqual({
      workloads: true,
      networking: false,
    });
  });
});
