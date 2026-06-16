import { afterEach, describe, expect, it } from "vitest";
import {
  applyViewResourceDescriptors,
  getResourceIcon,
  getResourceLabel,
  listResourceAccess,
  resetViewResourceDescriptorsForTest,
  sidebarGroups,
} from "./k8sResources";

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
    });

    expect(changed).toBe(true);
    expect(getResourceLabel("pods")).toBe("Runtime Pods");
    expect(getResourceIcon("pods")).toBe("pods");
    expect(listResourceAccess.pods).toEqual({ group: "", resource: "pods" });
    expect(sidebarGroups).toEqual([
      {
        id: "runtime",
        label: "Runtime",
        icon: "workloads",
        items: ["pods", "deployments"],
      },
    ]);
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
    expect(sidebarGroups.some((group) => group.id === "invalid")).toBe(false);
  });
});
