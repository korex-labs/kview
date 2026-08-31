import { describe, expect, it } from "vitest";
import { supportsResourceIdentityDrawer } from "./ResourceIdentityDrawer";
import { fixedResourceIdentityRegistry } from "./resourceMapIdentity";

describe("ResourceIdentityDrawer registry", () => {
  it("supports every canonical fixed Resource Map identity", () => {
    for (const descriptor of Object.values(fixedResourceIdentityRegistry)) {
      if (!descriptor) continue;
      expect(supportsResourceIdentityDrawer({
        ...descriptor,
        namespace: descriptor.scope === "namespaced" ? "prod" : "",
        name: "example",
      }), descriptor.resource).toBe(true);
    }
  });

  it("requires authoritative dynamic identity and valid scope", () => {
    expect(supportsResourceIdentityDrawer({ group: "cert-manager.io", version: "v1", resource: "certificates", kind: "Certificate", scope: "namespaced", namespace: "prod", name: "api" })).toBe(true);
    expect(supportsResourceIdentityDrawer({ group: "cert-manager.io", version: "v1", resource: "clusterissuers", kind: "ClusterIssuer", scope: "cluster", namespace: "", name: "ca" })).toBe(true);
    expect(supportsResourceIdentityDrawer({ group: "", version: "v1", resource: "widgets", kind: "Widget", scope: "namespaced", namespace: "prod", name: "api" })).toBe(false);
    expect(supportsResourceIdentityDrawer({ group: "example.io", version: "v1", resource: "widgets", kind: "Widget", scope: "cluster", namespace: "prod", name: "api" })).toBe(false);
  });

  it("rejects mismatched complete identities for fixed drawers", () => {
    expect(supportsResourceIdentityDrawer({ group: "apps", version: "v1", resource: "pods", kind: "Deployment", scope: "namespaced", namespace: "prod", name: "api" })).toBe(false);
  });
});
