import type {
  ApiResourceIdentity,
  ResourceMapNode,
  ResourceMapResponse,
  ResourcePresenceIdentity,
  ResourcePresenceItem,
  ResourceOwnershipResponse,
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
      version: (resource.apiVersion && parseApiVersion(resource.apiVersion)?.version) || fixed.version,
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
    .map((resource) => manifestIdentity(resource, releaseNamespace))
    .filter((identity): identity is ResourcePresenceIdentity =>
      Boolean(identity.resource) && (identity.scope === "namespaced" || identity.scope === "cluster"),
    ).slice(0, MAX_MANIFEST_RESOURCES);
}

export function canOpenHelmManifestIdentity(
  resources: ManifestResource[],
  releaseNamespace: string,
  identity: ApiResourceIdentity,
): boolean {
  const resource = manifestResourceForIdentity(resources, releaseNamespace, identity);
  return Boolean(resource && isNavigableManifestResource(resource));
}

export function isObservedHelmIdentity(ownership: ResourceOwnershipResponse | undefined, identity: ApiResourceIdentity): boolean {
  const matches = (node: ResourceMapNode) => node.availability === "present" && node.navigable
    && helmManifestIdentityKey(node.identity) === helmManifestIdentityKey(identity)
    && node.identity.uid === identity.uid;
  return Boolean(ownership && (ownership.nodes.some(matches) || ownership.podGroups.some((group) => group.members.some(matches))));
}

export function mergeHelmOwnership(response: ResourceMapResponse, ownership?: ResourceOwnershipResponse): ResourceMapResponse {
  if (!ownership) return response;
  const observed = new Map(ownership.nodes.map((node) => [`${helmManifestIdentityKey(node.identity)}|${node.identity.uid || ""}`, node]));
  const roots = new Map(ownership.roots.map((root) => [helmManifestIdentityKey(root.requested), root]));
  const remap = new Map<string, string>();
  const nodes = new Map<string, ResourceMapNode>();
  for (const node of response.nodes) {
    const root = roots.get(helmManifestIdentityKey(node.identity));
    const canonical = root?.resolved ? observed.get(`${helmManifestIdentityKey(root.identity)}|${root.identity.uid || ""}`) : undefined;
    const merged: ResourceMapNode = canonical ? { ...canonical, depth: 1, direction: "child", current: false } : { ...node, availability: root?.availability || node.availability };
    remap.set(node.id, merged.id);
    nodes.set(merged.id, merged);
  }
  // Never append disconnected seeds omitted by the manifest display bound.
  const reachable = new Set(nodes.keys());
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of ownership.edges) {
      if (edge.type === "owner" && edge.resolved && reachable.has(edge.from) && !reachable.has(edge.to)) {
        reachable.add(edge.to); changed = true;
      }
    }
  }
  for (const node of ownership.nodes) if (reachable.has(node.id) && !nodes.has(node.id)) nodes.set(node.id, { ...node, depth: node.depth + 1 });
  const edges = [
    ...response.edges.map((edge) => ({ ...edge, to: remap.get(edge.to) || edge.to })),
    ...ownership.edges.filter((edge) => nodes.has(edge.from) && nodes.has(edge.to)),
  ].sort((a, b) => a.id.localeCompare(b.id));
  return {
    ...response, active: ownership.active, nodes: [...nodes.values()].sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id)), edges,
    truncated: response.truncated || ownership.truncated,
    truncationReasons: [...new Set([...(response.truncationReasons || []), ...(ownership.truncationReasons || [])])].sort(),
    coverage: { ...ownership.coverage, completeness: response.truncated ? "partial" : ownership.coverage.completeness, families: { ...ownership.coverage.families, helmManifest: response.coverage.families.helmManifest } },
    limits: { ...ownership.limits, depth: ownership.limits.depth + 1, maxNodes: response.limits.maxNodes + ownership.limits.maxNodes, maxEdges: response.limits.maxEdges + ownership.limits.maxEdges },
    cache: { ...ownership.cache, totalNodes: nodes.size, returnedNodes: nodes.size, totalEdges: edges.length, returnedEdges: edges.length },
  };
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
      completeness: truncated ? "partial" : "complete",
      reasons: ["manifest-inventory-only"],
      families: {
        helmManifest: { coverage: "full", completeness: truncated ? "partial" : "complete", ...(truncated ? { reasons: ["max-nodes"] } : {}) },
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
