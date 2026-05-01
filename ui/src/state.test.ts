import { describe, expect, it } from "vitest";
import { namespaceSmartSortKey, sortNamespaces } from "./state";

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
