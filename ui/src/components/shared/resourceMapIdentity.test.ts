import { describe, expect, it } from "vitest";
import { fixedResourceIdentityRegistry, resolveResourceDrawerIdentity } from "./resourceMapIdentity";

const expected = {
  pods: ["", "v1", "Pod", "namespaced"],
  deployments: ["apps", "v1", "Deployment", "namespaced"],
  jobs: ["batch", "v1", "Job", "namespaced"],
  ingresses: ["networking.k8s.io", "v1", "Ingress", "namespaced"],
  horizontalpodautoscalers: ["autoscaling", "v2", "HorizontalPodAutoscaler", "namespaced"],
  clusterroles: ["rbac.authorization.k8s.io", "v1", "ClusterRole", "cluster"],
  customresourcedefinitions: ["apiextensions.k8s.io", "v1", "CustomResourceDefinition", "cluster"],
} as const;

describe("resource map identity registry", () => {
  it("contains canonical API descriptors across supported groups", () => {
    for (const [resource, [group, version, kind, scope]] of Object.entries(expected)) {
      expect(fixedResourceIdentityRegistry[resource as keyof typeof fixedResourceIdentityRegistry]).toMatchObject({ group, version, resource, kind, scope });
    }
  });

  it("enforces namespace and excludes virtual resources", () => {
    expect(resolveResourceDrawerIdentity({ resource: "pods", name: "api" })).toBeNull();
    expect(resolveResourceDrawerIdentity({ resource: "pods", namespace: "prod", name: "api" })).toMatchObject({ kind: "Pod", scope: "namespaced" });
    expect(resolveResourceDrawerIdentity({ resource: "nodes", namespace: "prod", name: "node-a" })).toBeNull();
    expect(resolveResourceDrawerIdentity({ resource: "helm", namespace: "prod", name: "release" })).toBeNull();
    expect(resolveResourceDrawerIdentity({ resource: "helmcharts", name: "chart" })).toBeNull();
  });

  it("uses authoritative dynamic plural and never derives it from kind", () => {
    expect(resolveResourceDrawerIdentity({ resource: "customresources", namespace: "prod", name: "issuer", group: "cert-manager.io", version: "v1", kind: "Issuer", scope: "namespaced" })).toBeNull();
    expect(resolveResourceDrawerIdentity({ resource: "customresources", namespace: "prod", name: "issuer", group: "cert-manager.io", version: "v1", apiResource: "issuers", kind: "Issuer", scope: "namespaced" })).toEqual({ group: "cert-manager.io", version: "v1", resource: "issuers", kind: "Issuer", scope: "namespaced", namespace: "prod", name: "issuer" });
  });
});
