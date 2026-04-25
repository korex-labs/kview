/**
 * Parsed resource reference from a Helm release manifest.
 */
export type ManifestResource = {
  kind: string;
  name: string;
  namespace?: string;
  apiVersion?: string;
};

/**
 * Parse a Helm manifest (multi-document YAML string) into resource references.
 * Uses regex-based extraction — does not require a full YAML parser.
 * Relies on the predictable structure of Helm-rendered Kubernetes manifests.
 */
export function parseManifestResources(manifest: string): ManifestResource[] {
  if (!manifest || !manifest.trim()) return [];

  const docs = splitManifestDocuments(manifest);
  const resources: ManifestResource[] = [];

  for (const doc of docs) {
    const trimmed = doc.trim();
    if (!trimmed) continue;

    const kind = readTopLevelScalar(trimmed, "kind");
    if (!kind) continue;

    const apiVersion = readTopLevelScalar(trimmed, "apiVersion");
    const metadata = readMetadataScalars(trimmed);
    const name = metadata.name;
    const namespace = metadata.namespace;

    if (!name) continue;

    resources.push({ kind, name, namespace, apiVersion });
  }

  return resources;
}

function splitManifestDocuments(manifest: string): string[] {
  const normalized = manifest.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized.split(/^---[ \t]*(?:#.*)?$/m);
}

function readTopLevelScalar(doc: string, key: string): string | undefined {
  const prefix = `${key}:`;
  for (const line of doc.split("\n")) {
    if (!line.startsWith(prefix)) continue;
    return cleanYamlScalar(line.slice(prefix.length));
  }
  return undefined;
}

function readMetadataScalars(doc: string): { name?: string; namespace?: string } {
  const out: { name?: string; namespace?: string } = {};
  const lines = doc.split("\n");
  let inMetadata = false;
  let metadataIndent = 0;
  let directChildIndent: number | undefined;

  for (const line of lines) {
    if (!inMetadata) {
      if (line.trim() === "metadata:") {
        inMetadata = true;
        metadataIndent = countIndent(line);
      }
      continue;
    }

    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const indent = countIndent(line);
    if (indent <= metadataIndent) break;
    if (directChildIndent === undefined) directChildIndent = indent;
    if (indent !== directChildIndent) continue;

    const trimmed = line.trimStart();
    if (trimmed.startsWith("name:")) {
      out.name = cleanYamlScalar(trimmed.slice("name:".length));
    } else if (trimmed.startsWith("namespace:")) {
      out.namespace = cleanYamlScalar(trimmed.slice("namespace:".length));
    }
  }

  return out;
}

function countIndent(line: string): number {
  return line.length - line.trimStart().length;
}

function cleanYamlScalar(value: string): string | undefined {
  let out = value.trim();
  if (!out) return undefined;
  const commentIndex = out.search(/\s#/);
  if (commentIndex >= 0) out = out.slice(0, commentIndex).trim();
  if ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("'") && out.endsWith("'"))) {
    out = out.slice(1, -1);
  }
  return out || undefined;
}

/**
 * Map of Kubernetes kind to the resource key used in kview navigation.
 * Only includes kinds that have drawers in the UI.
 */
const kindToNavKey: Record<string, string> = {
  Deployment: "deployments",
  StatefulSet: "statefulsets",
  DaemonSet: "daemonsets",
  Service: "services",
  Ingress: "ingresses",
  ConfigMap: "configmaps",
  Secret: "secrets",
  Job: "jobs",
  CronJob: "cronjobs",
  HorizontalPodAutoscaler: "horizontalpodautoscalers",
  PersistentVolumeClaim: "persistentvolumeclaims",
  PersistentVolume: "persistentvolumes",
  ServiceAccount: "serviceaccounts",
  Role: "roles",
  RoleBinding: "rolebindings",
  ClusterRole: "clusterroles",
  ClusterRoleBinding: "clusterrolebindings",
  CustomResourceDefinition: "customresourcedefinitions",
  Namespace: "namespaces",
  Node: "nodes",
  Pod: "pods",
  ReplicaSet: "replicasets",
};

/**
 * Check if a manifest resource kind can be navigated to in the UI via a built-in drawer.
 */
export function canNavigateToKind(kind: string): boolean {
  return kind in kindToNavKey;
}

/**
 * Returns true when a manifest resource is a custom resource that can be opened
 * with CustomResourceDrawer. Detects non-built-in API groups by checking that:
 * - the apiVersion contains a slash (has a group prefix, not core/v1)
 * - the group has at least one dot (domain-style, e.g. cert-manager.io)
 * - the group does NOT end with .k8s.io (built-in extended groups)
 * - the kind is not already handled by a built-in drawer
 */
export function isCRManifestResource(r: ManifestResource): boolean {
  if (canNavigateToKind(r.kind)) return false;
  if (!r.apiVersion) return false;
  const slashIdx = r.apiVersion.indexOf("/");
  if (slashIdx < 0) return false; // core group (e.g. "v1") — no group prefix
  const group = r.apiVersion.slice(0, slashIdx);
  if (!group.includes(".")) return false; // plain groups like "apps", "batch"
  if (group.endsWith(".k8s.io")) return false; // built-in extended groups
  return true;
}

/**
 * Parse group and version from an apiVersion string (e.g. "cert-manager.io/v1").
 * Returns null if the apiVersion has no group (core group).
 */
export function parseApiVersion(apiVersion: string): { group: string; version: string } | null {
  const slashIdx = apiVersion.indexOf("/");
  if (slashIdx < 0) return null;
  return { group: apiVersion.slice(0, slashIdx), version: apiVersion.slice(slashIdx + 1) };
}

/**
 * Group manifest resources by kind for display.
 * Navigable kinds (built-in drawers or custom resources) are sorted first.
 */
export function groupResourcesByKind(
  resources: ManifestResource[],
): { kind: string; items: ManifestResource[] }[] {
  const map = new Map<string, ManifestResource[]>();
  for (const r of resources) {
    const list = map.get(r.kind) || [];
    list.push(r);
    map.set(r.kind, list);
  }
  return Array.from(map.entries())
    .sort(([a, aItems], [b, bItems]) => {
      const aNav = canNavigateToKind(a) || aItems.some(isCRManifestResource);
      const bNav = canNavigateToKind(b) || bItems.some(isCRManifestResource);
      if (aNav !== bNav) return aNav ? -1 : 1;
      return a.localeCompare(b);
    })
    .map(([kind, items]) => ({ kind, items }));
}
