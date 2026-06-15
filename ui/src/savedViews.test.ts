// @vitest-environment node

import { describe, expect, it } from "vitest";
import { defaultSavedResourceViewName } from "./savedViews";

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
});
