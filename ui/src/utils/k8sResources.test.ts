import { afterEach, describe, expect, it } from "vitest";
import {
  applyViewResourceDescriptors,
  getDashboardSignalFilterCategoryPolicy,
  getDashboardViewPolicy,
  getResourceIcon,
  getResourceLabel,
  getResourceViewPolicy,
  listResourceAccess,
  resetViewResourceDescriptorsForTest,
  sidebarGroups,
} from "./k8sResources";
import { getActionPresentation } from "./actionPresentation";

describe("view resource descriptors", () => {
  afterEach(() => {
    resetViewResourceDescriptorsForTest();
  });

  it("applies backend-owned metadata for known resources", () => {
    const changed = applyViewResourceDescriptors({
      resources: [
        {
          key: "pods",
          label: "Runtime Pods",
          clusterScoped: false,
          icon: "pods",
          access: { group: "", resource: "pods" },
          listView: {
            quickFilters: { search: false, tag: true },
            defaultSort: { field: "createdAt", direction: "desc" },
            filterLabel: "Filter pods",
            identity: ["namespace", "name"],
            searchFields: ["name", "phase"],
            savedViews: {
              enabled: true,
              namePrefix: "Runtime Pods",
              location: ["context", "namespace", "resource"],
              state: ["filter", "sort"],
            },
          },
        },
      ],
      sidebarGroups: [
        {
          id: "runtime",
          label: "Runtime",
          icon: "workloads",
          items: ["pods", "deployments"],
        },
      ],
      dashboard: {
        signalViews: {
          enabled: true,
          namePrefix: "Signal preset",
          state: ["filters", "query"],
        },
        signalFilterCategories: [
          { key: "priority", label: "Primary", order: 2, compact: false },
          { key: "custom", label: "Custom", order: 11, compact: true },
        ],
      },
      actions: [
        { id: "delete", label: "Remove", icon: "delete", color: "error", order: 95 },
      ],
    });

    expect(changed).toBe(true);
    expect(getResourceLabel("pods")).toBe("Runtime Pods");
    expect(getResourceIcon("pods")).toBe("pods");
    expect(listResourceAccess.pods).toEqual({ group: "", resource: "pods" });
    expect(getResourceViewPolicy("pods")).toMatchObject({
      quickFilters: { search: false, tag: true },
      defaultSort: { field: "createdAt", direction: "desc" },
      filterLabel: "Filter pods",
      identity: ["namespace", "name"],
      searchFields: ["name", "phase"],
      savedViews: {
        enabled: true,
        namePrefix: "Runtime Pods",
        location: ["context", "namespace", "resource"],
        state: ["filter", "sort"],
      },
    });
    expect(sidebarGroups).toEqual([
      {
        id: "runtime",
        label: "Runtime",
        icon: "workloads",
        items: ["pods", "deployments"],
      },
    ]);
    expect(getDashboardViewPolicy().signalViews).toEqual({
      enabled: true,
      namePrefix: "Signal preset",
      state: ["filters", "query"],
    });
    expect(getDashboardSignalFilterCategoryPolicy("priority")).toEqual({
      label: "Primary",
      order: 2,
      compact: false,
    });
    expect(getDashboardSignalFilterCategoryPolicy("custom")).toEqual({
      label: "Custom",
      order: 11,
      compact: true,
    });
    expect(getActionPresentation("pod.delete")).toMatchObject({
      label: "Remove",
      icon: "delete",
      color: "error",
      order: 95,
    });
  });

  it("ignores unknown resource keys and invalid icons", () => {
    const changed = applyViewResourceDescriptors({
      resources: [
        {
          key: "unknown",
          label: "Unknown",
          clusterScoped: true,
          icon: "pods",
          access: { group: "", resource: "unknown" },
        },
        {
          key: "pods",
          label: "Invalid",
          clusterScoped: false,
          icon: "missing",
          access: { group: "", resource: "pods" },
        },
      ],
      sidebarGroups: [
        {
          id: "invalid",
          label: "Invalid",
          icon: "missing",
          items: ["pods"],
        },
      ],
    });

    expect(changed).toBe(false);
    expect(getResourceLabel("pods")).toBe("Pods");
    expect(getResourceViewPolicy("pods")).toMatchObject({
      quickFilters: { search: true, tag: true },
      defaultSort: { field: "name", direction: "asc" },
      filterLabel: "Filter (name/node/status)",
      identity: ["name"],
      searchFields: ["name", "nodeName", "phase", "status", "signalSeverity", "listSignalSeverity"],
      savedViews: {
        enabled: true,
        namePrefix: "Pods",
        location: ["context", "namespace", "resource"],
        state: ["filter", "sort", "columns"],
      },
    });
    expect(sidebarGroups.some((group) => group.id === "invalid")).toBe(false);
    expect(getDashboardViewPolicy().signalViews.namePrefix).toBe("Signal view");
    expect(getDashboardSignalFilterCategoryPolicy("priority")).toEqual({
      label: "Priority",
      order: 0,
      compact: true,
    });
    expect(getDashboardSignalFilterCategoryPolicy("kind")).toEqual({
      label: "Kind",
      order: 4,
      compact: false,
    });
    expect(getDashboardSignalFilterCategoryPolicy("signal_type")).toEqual({
      label: "Signal",
      order: 5,
      compact: false,
    });
    expect(getDashboardSignalFilterCategoryPolicy("namespace").label).toBe("Top problem namespaces");
    expect(getActionPresentation("pod.delete")).toMatchObject({
      label: "Delete",
      icon: "delete",
      color: "error",
      order: 90,
    });
  });
});
