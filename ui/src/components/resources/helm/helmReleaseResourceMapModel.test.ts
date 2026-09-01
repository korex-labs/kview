import { describe, expect, it } from "vitest";
import type { ManifestResource } from "../../../utils/helmManifest";
import {
  buildHelmReleaseResourceMap,
  canOpenHelmManifestIdentity,
  helmManifestPresenceIdentities,
  manifestResourceForIdentity,
} from "./helmReleaseResourceMapModel";

const resources: ManifestResource[] = [
  { apiVersion: "v1", kind: "Service", name: "api" },
  { apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRole", name: "api-reader", namespace: "ignored" },
  { apiVersion: "cert-manager.io/v1", kind: "Certificate", name: "api-cert", namespace: "apps" },
  { apiVersion: "v1", kind: "Service", name: "api" },
];

describe("Helm release resource map projection", () => {
  it("projects deterministic manifest membership without claiming live availability", () => {
    const first = buildHelmReleaseResourceMap("backend", "apps", resources);
    const reversed = buildHelmReleaseResourceMap("backend", "apps", [...resources].reverse());

    expect(reversed).toEqual(first);
    expect(first.nodes).toHaveLength(4);
    expect(first.edges).toHaveLength(3);
    expect(first.coverage).toMatchObject({ coverage: "partial", completeness: "complete" });
    expect(first.nodes.slice(1).every((node) => node.availability === "unknown")).toBe(true);
    expect(first.edges.every((edge) => edge.type === "helmManifest" && edge.confidence === "exact")).toBe(true);

    const service = first.nodes.find((node) => node.identity.kind === "Service");
    expect(service?.identity).toMatchObject({ group: "", version: "v1", resource: "services", scope: "namespaced", namespace: "apps" });
    const clusterRole = first.nodes.find((node) => node.identity.kind === "ClusterRole");
    expect(clusterRole?.identity).toMatchObject({ resource: "clusterroles", scope: "cluster" });
    expect(clusterRole?.identity.namespace).toBeUndefined();
    const certificate = first.nodes.find((node) => node.identity.kind === "Certificate");
    expect(certificate?.identity).toMatchObject({ group: "cert-manager.io", version: "v1", resource: "", namespace: "apps" });
  });

  it("resolves graph selections back to manifest resources without inventing a CR plural", () => {
    const response = buildHelmReleaseResourceMap("backend", "apps", resources);
    const certificate = response.nodes.find((node) => node.identity.kind === "Certificate")!;
    expect(canOpenHelmManifestIdentity(resources, "apps", certificate.identity)).toBe(true);
    expect(manifestResourceForIdentity(resources, "apps", certificate.identity)).toEqual(resources[2]);

    const unsupported = buildHelmReleaseResourceMap("backend", "apps", [
      { apiVersion: "policy/v1", kind: "PodDisruptionBudget", name: "api" },
    ]).nodes[1];
    expect(canOpenHelmManifestIdentity([{ apiVersion: "policy/v1", kind: "PodDisruptionBudget", name: "api" }], "apps", unsupported.identity)).toBe(false);
  });

  it("enriches only canonical identities from cache-derived presence", () => {
    const identities = helmManifestPresenceIdentities(resources, "apps");
    expect(identities).toHaveLength(2);
    expect(identities.map((identity) => identity.kind)).toEqual(["Service", "ClusterRole"]);

    const response = buildHelmReleaseResourceMap("backend", "apps", resources, [
      {
        requested: identities[0],
        identity: { ...identities[0], uid: "svc-1" },
        resolved: true,
        availability: "present",
      },
      {
        requested: identities[1],
        identity: identities[1],
        resolved: false,
        availability: "missing",
      },
    ]);
    expect(response.nodes.find((node) => node.identity.kind === "Service")?.availability).toBe("present");
    expect(response.nodes.find((node) => node.identity.kind === "ClusterRole")?.availability).toBe("missing");
    expect(response.nodes.find((node) => node.identity.kind === "Certificate")?.availability).toBe("unknown");
  });

  it("does not collapse custom API groups into built-in Kinds or guess custom-resource scope", () => {
    const customService = { apiVersion: "acme.example/v1", kind: "Service", name: "api", namespace: "apps" };
    const clusterIssuer = { apiVersion: "cert-manager.io/v1", kind: "ClusterIssuer", name: "production" };
    const response = buildHelmReleaseResourceMap("backend", "apps", [
      { apiVersion: "v1", kind: "Service", name: "api", namespace: "apps" },
      customService,
      clusterIssuer,
    ]);

    expect(response.nodes).toHaveLength(4);
    const serviceNodes = response.nodes.filter((node) => node.identity.kind === "Service");
    expect(serviceNodes).toHaveLength(2);
    expect(serviceNodes.map((node) => node.identity.group).sort()).toEqual(["", "acme.example"]);
    expect(serviceNodes.find((node) => node.identity.group === "acme.example")?.identity.resource).toBe("");
    const issuer = response.nodes.find((node) => node.identity.kind === "ClusterIssuer")!;
    expect(issuer.identity).toMatchObject({ group: "cert-manager.io", resource: "", scope: "unknown" });
    expect(issuer.identity.namespace).toBeUndefined();
    expect(canOpenHelmManifestIdentity([clusterIssuer], "apps", issuer.identity)).toBe(true);
    expect(manifestResourceForIdentity([clusterIssuer], "apps", issuer.identity)).toEqual(clusterIssuer);
    expect(buildHelmReleaseResourceMap("backend", "apps", [{ kind: "Job", name: "hook" }]).nodes[1].identity)
      .toMatchObject({ group: "batch", resource: "jobs", scope: "namespaced", namespace: "apps" });
  });

  it("caps dense release inventories and reports manifest-only truncation", () => {
    const dense = Array.from({ length: 105 }, (_, index) => ({ apiVersion: "v1", kind: "ConfigMap", name: `config-${index}` }));
    const response = buildHelmReleaseResourceMap("backend", "apps", dense);
    expect(response.nodes).toHaveLength(100);
    expect(response.edges).toHaveLength(99);
    expect(response).toMatchObject({ truncated: true, truncationReasons: ["max-nodes"] });
    expect(response.cache).toMatchObject({ totalNodes: 106, returnedNodes: 100, totalEdges: 105, returnedEdges: 99 });
  });
});
