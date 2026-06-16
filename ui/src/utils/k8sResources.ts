import type { Section } from "../state";
import type { ResourceIconName } from "../components/icons/resources/types";
import type { ApiViewResourcesResponse } from "../types/api";

export type AccessReviewResource = {
  group: string;
  resource: string;
};

export type ListResourceKey =
  | "dashboard"
  | "pods"
  | "deployments"
  | "daemonsets"
  | "statefulsets"
  | "replicasets"
  | "services"
  | "ingresses"
  | "networkpolicies"
  | "jobs"
  | "cronjobs"
  | "horizontalpodautoscalers"
  | "configmaps"
  | "secrets"
  | "serviceaccounts"
  | "roles"
  | "rolebindings"
  | "clusterroles"
  | "clusterrolebindings"
  | "persistentvolumeclaims"
  | "persistentvolumes"
  | "nodes"
  | "namespaces"
  | "customresourcedefinitions"
  | "customresources"
  | "clusterresources"
  | "helm"
  | "helmcharts"
  | "resourcequotas"
  | "limitranges";

export type ResourceMeta = {
  label: string;
  clusterScoped: boolean;
  icon: ResourceIconName;
};

export type SidebarGroup = {
  id: string;
  label: string;
  icon: ResourceIconName;
  items: Section[];
};

const validResourceIcons = new Set<ResourceIconName>([
  "dashboard",
  "workloads",
  "networking",
  "policy",
  "configuration",
  "access-control",
  "storage",
  "helm",
  "extensions",
  "cluster",
  "pods",
  "deployments",
  "daemonsets",
  "statefulsets",
  "replicasets",
  "services",
  "ingresses",
  "networkpolicies",
  "jobs",
  "cronjobs",
  "horizontalpodautoscalers",
  "configmaps",
  "secrets",
  "serviceaccounts",
  "roles",
  "rolebindings",
  "clusterroles",
  "clusterrolebindings",
  "persistentvolumeclaims",
  "persistentvolumes",
  "nodes",
  "namespaces",
  "customresourcedefinitions",
  "customresources",
  "clusterresources",
  "helmcharts",
  "resourcequotas",
  "limitranges",
]);

function isResourceIconName(value: unknown): value is ResourceIconName {
  return typeof value === "string" && validResourceIcons.has(value as ResourceIconName);
}

export const resourceMeta: Record<ListResourceKey, ResourceMeta> = {
  dashboard: { label: "Dashboard", clusterScoped: true, icon: "dashboard" },
  pods: { label: "Pods", clusterScoped: false, icon: "pods" },
  deployments: { label: "Deployments", clusterScoped: false, icon: "deployments" },
  daemonsets: { label: "Daemon Sets", clusterScoped: false, icon: "daemonsets" },
  statefulsets: { label: "Stateful Sets", clusterScoped: false, icon: "statefulsets" },
  replicasets: { label: "Replica Sets", clusterScoped: false, icon: "replicasets" },
  services: { label: "Services", clusterScoped: false, icon: "services" },
  ingresses: { label: "Ingresses", clusterScoped: false, icon: "ingresses" },
  networkpolicies: { label: "Network Policies", clusterScoped: false, icon: "networkpolicies" },
  jobs: { label: "Jobs", clusterScoped: false, icon: "jobs" },
  cronjobs: { label: "Cron Jobs", clusterScoped: false, icon: "cronjobs" },
  horizontalpodautoscalers: { label: "HPA", clusterScoped: false, icon: "horizontalpodautoscalers" },
  configmaps: { label: "Config Maps", clusterScoped: false, icon: "configmaps" },
  secrets: { label: "Secrets", clusterScoped: false, icon: "secrets" },
  serviceaccounts: { label: "Service Accounts", clusterScoped: false, icon: "serviceaccounts" },
  roles: { label: "Roles", clusterScoped: false, icon: "roles" },
  rolebindings: { label: "Role Bindings", clusterScoped: false, icon: "rolebindings" },
  clusterroles: { label: "Cluster Roles", clusterScoped: true, icon: "clusterroles" },
  clusterrolebindings: { label: "Cluster Role Bindings", clusterScoped: true, icon: "clusterrolebindings" },
  persistentvolumeclaims: { label: "Persistent Volume Claims", clusterScoped: false, icon: "persistentvolumeclaims" },
  persistentvolumes: { label: "Persistent Volumes", clusterScoped: true, icon: "persistentvolumes" },
  nodes: { label: "Nodes", clusterScoped: true, icon: "nodes" },
  namespaces: { label: "Namespaces", clusterScoped: true, icon: "namespaces" },
  customresourcedefinitions: { label: "Custom Resource Definitions", clusterScoped: true, icon: "customresourcedefinitions" },
  customresources: { label: "Custom Namespace Resources", clusterScoped: false, icon: "customresources" },
  clusterresources: { label: "Custom Cluster Resources", clusterScoped: true, icon: "clusterresources" },
  helm: { label: "Helm Releases", clusterScoped: false, icon: "helm" },
  helmcharts: { label: "Helm Charts", clusterScoped: true, icon: "helmcharts" },
  resourcequotas: { label: "Resource Quotas", clusterScoped: false, icon: "resourcequotas" },
  limitranges: { label: "Limit Ranges", clusterScoped: false, icon: "limitranges" },
};

export const sidebarGroups: SidebarGroup[] = [
  {
    id: "workloads",
    label: "Workloads",
    icon: "workloads",
    items: ["pods", "deployments", "statefulsets", "daemonsets", "jobs", "cronjobs", "horizontalpodautoscalers"],
  },
  {
    id: "networking",
    label: "Networking",
    icon: "networking",
    items: ["services", "ingresses"],
  },
  {
    id: "policy",
    label: "Policy",
    icon: "policy",
    items: ["networkpolicies", "resourcequotas", "limitranges"],
  },
  {
    id: "configuration",
    label: "Configuration",
    icon: "configuration",
    items: ["configmaps", "secrets"],
  },
  {
    id: "rbac",
    label: "Access Control",
    icon: "access-control",
    items: ["serviceaccounts", "roles", "rolebindings", "clusterroles", "clusterrolebindings"],
  },
  {
    id: "storage",
    label: "Storage",
    icon: "storage",
    items: ["persistentvolumeclaims", "persistentvolumes"],
  },
  {
    id: "helm",
    label: "Helm",
    icon: "helm",
    items: ["helm", "helmcharts"],
  },
  {
    id: "extensions",
    label: "Extensions",
    icon: "extensions",
    items: ["customresources", "clusterresources", "customresourcedefinitions"],
  },
  {
    id: "cluster",
    label: "Cluster",
    icon: "cluster",
    items: ["dashboard", "nodes", "namespaces"],
  },
];

export function getResourceLabel(key: ListResourceKey): string {
  return resourceMeta[key]?.label ?? key;
}

export function getResourceIcon(key: ListResourceKey): ResourceIconName {
  return resourceMeta[key]?.icon ?? "customresources";
}

export function isClusterScopedResource(key: ListResourceKey): boolean {
  return resourceMeta[key]?.clusterScoped ?? false;
}

export function isClusterScopedSection(section: Section): boolean {
  if (Object.prototype.hasOwnProperty.call(resourceMeta, section)) {
    return resourceMeta[section as ListResourceKey].clusterScoped ?? false;
  }
  return false;
}

export const listResourceAccess: Record<ListResourceKey, AccessReviewResource> = {
  dashboard: { group: "", resource: "namespaces" },
  pods: { group: "", resource: "pods" },
  deployments: { group: "apps", resource: "deployments" },
  daemonsets: { group: "apps", resource: "daemonsets" },
  statefulsets: { group: "apps", resource: "statefulsets" },
  replicasets: { group: "apps", resource: "replicasets" },
  services: { group: "", resource: "services" },
  ingresses: { group: "networking.k8s.io", resource: "ingresses" },
  networkpolicies: { group: "networking.k8s.io", resource: "networkpolicies" },
  jobs: { group: "batch", resource: "jobs" },
  cronjobs: { group: "batch", resource: "cronjobs" },
  horizontalpodautoscalers: { group: "autoscaling", resource: "horizontalpodautoscalers" },
  configmaps: { group: "", resource: "configmaps" },
  secrets: { group: "", resource: "secrets" },
  serviceaccounts: { group: "", resource: "serviceaccounts" },
  roles: { group: "rbac.authorization.k8s.io", resource: "roles" },
  rolebindings: { group: "rbac.authorization.k8s.io", resource: "rolebindings" },
  clusterroles: { group: "rbac.authorization.k8s.io", resource: "clusterroles" },
  clusterrolebindings: { group: "rbac.authorization.k8s.io", resource: "clusterrolebindings" },
  persistentvolumeclaims: { group: "", resource: "persistentvolumeclaims" },
  persistentvolumes: { group: "", resource: "persistentvolumes" },
  nodes: { group: "", resource: "nodes" },
  namespaces: { group: "", resource: "namespaces" },
  customresourcedefinitions: { group: "apiextensions.k8s.io", resource: "customresourcedefinitions" },
  customresources: { group: "apiextensions.k8s.io", resource: "customresourcedefinitions" },
  clusterresources: { group: "apiextensions.k8s.io", resource: "customresourcedefinitions" },
  helm: { group: "", resource: "secrets" },
  helmcharts: { group: "", resource: "secrets" },
  resourcequotas: { group: "", resource: "resourcequotas" },
  limitranges: { group: "", resource: "limitranges" },
};

const listResourceKeys = new Set<string>(Object.keys(resourceMeta));

function isListResourceKey(value: unknown): value is ListResourceKey {
  return typeof value === "string" && listResourceKeys.has(value);
}

const defaultResourceMeta: Record<ListResourceKey, ResourceMeta> = Object.fromEntries(
  Object.entries(resourceMeta).map(([key, meta]) => [key, { ...meta }]),
) as Record<ListResourceKey, ResourceMeta>;

const defaultListResourceAccess: Record<ListResourceKey, AccessReviewResource> = Object.fromEntries(
  Object.entries(listResourceAccess).map(([key, access]) => [key, { ...access }]),
) as Record<ListResourceKey, AccessReviewResource>;

const defaultSidebarGroups: SidebarGroup[] = sidebarGroups.map((group) => ({
  ...group,
  items: [...group.items],
}));

export function resetViewResourceDescriptorsForTest(): void {
  for (const key of Object.keys(resourceMeta) as ListResourceKey[]) {
    resourceMeta[key] = { ...defaultResourceMeta[key] };
    listResourceAccess[key] = { ...defaultListResourceAccess[key] };
  }
  sidebarGroups.splice(
    0,
    sidebarGroups.length,
    ...defaultSidebarGroups.map((group) => ({ ...group, items: [...group.items] })),
  );
}

export function applyViewResourceDescriptors(response: ApiViewResourcesResponse | null | undefined): boolean {
  let changed = false;

  for (const descriptor of response?.resources || []) {
    if (!isListResourceKey(descriptor.key)) continue;
    if (!descriptor.label || !isResourceIconName(descriptor.icon) || !descriptor.access?.resource) continue;

    const nextMeta: ResourceMeta = {
      label: descriptor.label,
      clusterScoped: Boolean(descriptor.clusterScoped),
      icon: descriptor.icon,
    };
    const currentMeta = resourceMeta[descriptor.key];
    if (
      currentMeta.label !== nextMeta.label ||
      currentMeta.clusterScoped !== nextMeta.clusterScoped ||
      currentMeta.icon !== nextMeta.icon
    ) {
      resourceMeta[descriptor.key] = nextMeta;
      changed = true;
    }

    const nextAccess: AccessReviewResource = {
      group: descriptor.access.group || "",
      resource: descriptor.access.resource,
    };
    const currentAccess = listResourceAccess[descriptor.key];
    if (currentAccess.group !== nextAccess.group || currentAccess.resource !== nextAccess.resource) {
      listResourceAccess[descriptor.key] = nextAccess;
      changed = true;
    }
  }

  const nextGroups = (response?.sidebarGroups || [])
    .filter((group) => group.id && group.label && isResourceIconName(group.icon))
    .map((group) => ({
      id: group.id,
      label: group.label,
      icon: group.icon as ResourceIconName,
      items: (group.items || []).filter(isListResourceKey),
    }))
    .filter((group) => group.items.length > 0);

  if (nextGroups.length > 0) {
    const current = JSON.stringify(sidebarGroups);
    const next = JSON.stringify(nextGroups);
    if (current !== next) {
      sidebarGroups.splice(0, sidebarGroups.length, ...nextGroups);
      changed = true;
    }
  }

  return changed;
}
