import type {
  ApiResourceIdentity,
  ResourceMapNode,
  ResourceMapResponse,
  ResourcePresenceIdentity,
  ResourcePresenceItem,
} from "../../../types/api";
import { parseApiVersion, type ManifestResource } from "../../../utils/helmManifest";
import { fixedResourceIdentityRegistry } from "../../shared/resourceMapIdentity";

const MAX_MANIFEST_RESOURCES = 99;

const fixedDescriptors = Object.values(fixedResourceIdentityRegistry).filter((descriptor) => descriptor !== undefined);

function manifestGroup(resource: ManifestResource): string {
  return resource.apiVersion ? parseApiVersion(resource.apiVersion)?.group || "" : "";
}

function fixedManifestDescriptor(resource: ManifestResource) {
  const group = manifestGroup(resource);
  return fixedDescriptors.find((descriptor) =>
    descriptor.kind === resource.kind && (!resource.apiVersion || descriptor.group === group),
  );
}

export function isCanonicalHelmManifestResource(resource: ManifestResource): boolean {
  return Boolean(fixedManifestDescriptor(resource));
}

export function isCustomHelmManifestResource(resource: ManifestResource): boolean {
  if (isCanonicalHelmManifestResource(resource)) return false;
  const group = manifestGroup(resource);
  return group.includes(".") && !group.endsWith(".k8s.io");
}

function isNavigableManifestResource(resource: ManifestResource): boolean {
  return isCanonicalHelmManifestResource(resource) || isCustomHelmManifestResource(resource);
}

function manifestIdentity(resource: ManifestResource, releaseNamespace: string): ApiResourceIdentity {
  const fixed = fixedManifestDescriptor(resource);
  if (fixed) {
    return {
      ...fixed,
      ...(fixed.scope === "namespaced" ? { namespace: resource.namespace || releaseNamespace } : {}),
      name: resource.name,
    };
  }
  const parsed = resource.apiVersion ? parseApiVersion(resource.apiVersion) : null;
  return {
    group: parsed?.group || "",
    version: parsed?.version || resource.apiVersion || "",
    resource: "",
    kind: resource.kind,
    scope: resource.namespace ? "namespaced" : "unknown",
    ...(resource.namespace ? { namespace: resource.namespace } : {}),
    name: resource.name,
  };
}

export function helmManifestIdentityKey(identity: ApiResourceIdentity): string {
  return [identity.group, identity.version, identity.resource, identity.kind, identity.scope, identity.namespace || "", identity.name].join("|");
}

function orderedManifestResources(resources: ManifestResource[], releaseNamespace: string): ManifestResource[] {
  const unique = new Map<string, ManifestResource>();
  for (const resource of resources) {
    const identity = manifestIdentity(resource, releaseNamespace);
    const key = helmManifestIdentityKey(identity);
    if (!unique.has(key)) unique.set(key, resource);
  }
  return [...unique.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, resource]) => resource);
}

export function manifestResourceForIdentity(
  resources: ManifestResource[],
  releaseNamespace: string,
  identity: ApiResourceIdentity,
): ManifestResource | undefined {
  return orderedManifestResources(resources, releaseNamespace)
    .find((resource) => helmManifestIdentityKey(manifestIdentity(resource, releaseNamespace)) === helmManifestIdentityKey(identity));
}

export function helmManifestPresenceIdentities(
  resources: ManifestResource[],
  releaseNamespace: string,
): ResourcePresenceIdentity[] {
  return orderedManifestResources(resources, releaseNamespace)
    .slice(0, MAX_MANIFEST_RESOURCES)
    .map((resource) => manifestIdentity(resource, releaseNamespace))
    .filter((identity): identity is ResourcePresenceIdentity =>
      Boolean(identity.resource) && (identity.scope === "namespaced" || identity.scope === "cluster"),
    );
}

export function canOpenHelmManifestIdentity(
  resources: ManifestResource[],
  releaseNamespace: string,
  identity: ApiResourceIdentity,
): boolean {
  const resource = manifestResourceForIdentity(resources, releaseNamespace, identity);
  return Boolean(resource && isNavigableManifestResource(resource));
}

export function buildHelmReleaseResourceMap(
  releaseName: string,
  releaseNamespace: string,
  resources: ManifestResource[],
  presenceItems: ResourcePresenceItem[] = [],
): ResourceMapResponse {
  const presenceByIdentity = new Map(
    presenceItems.map((item) => [helmManifestIdentityKey(item.requested), item.availability]),
  );
  const releaseIdentity: ApiResourceIdentity = {
    group: "helm.kview.io",
    version: "v1",
    resource: "helm",
    kind: "HelmRelease",
    scope: "namespaced",
    namespace: releaseNamespace,
    name: releaseName,
  };
  const targetId = `helm-release:${releaseNamespace}/${releaseName}`;
  const ordered = orderedManifestResources(resources, releaseNamespace);
  const visible = ordered.slice(0, MAX_MANIFEST_RESOURCES);
  const childNodes: ResourceMapNode[] = visible.map((resource) => {
    const identity = manifestIdentity(resource, releaseNamespace);
    return {
      id: `manifest:${helmManifestIdentityKey(identity)}`,
      identity,
      depth: 1,
      direction: "child",
      availability: presenceByIdentity.get(helmManifestIdentityKey(identity)) || "unknown",
      navigable: isNavigableManifestResource(resource),
    };
  });
  const nodes: ResourceMapNode[] = [
    {
      id: targetId,
      identity: releaseIdentity,
      depth: 0,
      direction: "current",
      availability: "present",
      navigable: false,
      current: true,
    },
    ...childNodes,
  ];
  const edges = childNodes.map((node) => ({
    id: `helm-manifest:${node.id}`,
    from: targetId,
    to: node.id,
    type: "helmManifest" as const,
    source: { type: "product" as const, fieldPath: "release.manifest" },
    evidence: { description: "Declared by the rendered Helm release manifest" },
    confidence: "exact" as const,
    resolved: true,
  }));
  const truncated = ordered.length > visible.length;
  return {
    active: "helm-release-manifest",
    targetId,
    target: {
      id: targetId,
      requested: releaseIdentity,
      identity: releaseIdentity,
      resolved: true,
      availability: "present",
      navigable: false,
    },
    nodes,
    edges,
    coverage: {
      coverage: "partial",
      completeness: "complete",
      reasons: ["manifest-inventory-only"],
      families: {
        helmManifest: { coverage: "full", completeness: "complete" },
        kubernetesRelationships: { coverage: "unknown", completeness: "unknown", reasons: ["not-evaluated"] },
      },
    },
    truncated,
    ...(truncated ? { truncationReasons: ["max-nodes"] } : {}),
    limits: { depth: 1, maxNodes: MAX_MANIFEST_RESOURCES + 1, maxEdges: MAX_MANIFEST_RESOURCES, maxScanRecords: resources.length },
    cache: {
      freshness: "unknown",
      snapshotsPresent: 0,
      snapshotsMissing: 0,
      scannedRecords: resources.length,
      totalNodes: ordered.length + 1,
      returnedNodes: nodes.length,
      totalEdges: ordered.length,
      returnedEdges: edges.length,
    },
  };
}
