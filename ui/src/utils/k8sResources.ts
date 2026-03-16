import type { Section } from "../state";

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
  | "jobs"
  | "cronjobs"
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
  | "helm"
  | "helmcharts";

export type ResourceMeta = {
  label: string;
  clusterScoped: boolean;
};

export type SidebarGroup = {
  id: string;
  label: string;
  items: ListResourceKey[];
};

export const resourceMeta: Record<ListResourceKey, ResourceMeta> = {
  dashboard: { label: "Dashboard", clusterScoped: true },
  pods: { label: "Pods", clusterScoped: false },
  deployments: { label: "Deployments", clusterScoped: false },
  daemonsets: { label: "Daemon Sets", clusterScoped: false },
  statefulsets: { label: "Stateful Sets", clusterScoped: false },
  replicasets: { label: "Replica Sets", clusterScoped: false },
  services: { label: "Services", clusterScoped: false },
  ingresses: { label: "Ingresses", clusterScoped: false },
  jobs: { label: "Jobs", clusterScoped: false },
  cronjobs: { label: "Cron Jobs", clusterScoped: false },
  configmaps: { label: "Config Maps", clusterScoped: false },
  secrets: { label: "Secrets", clusterScoped: false },
  serviceaccounts: { label: "Service Accounts", clusterScoped: false },
  roles: { label: "Roles", clusterScoped: false },
  rolebindings: { label: "Role Bindings", clusterScoped: false },
  clusterroles: { label: "Cluster Roles", clusterScoped: true },
  clusterrolebindings: { label: "Cluster Role Bindings", clusterScoped: true },
  persistentvolumeclaims: { label: "Persistent Volume Claims", clusterScoped: false },
  persistentvolumes: { label: "Persistent Volumes", clusterScoped: true },
  nodes: { label: "Nodes", clusterScoped: true },
  namespaces: { label: "Namespaces", clusterScoped: true },
  customresourcedefinitions: { label: "Custom Resource Definitions", clusterScoped: true },
  helm: { label: "Helm Releases", clusterScoped: false },
  helmcharts: { label: "Helm Charts", clusterScoped: true },
};

export const sidebarGroups: SidebarGroup[] = [
  {
    id: "workloads",
    label: "Workloads",
    items: ["pods", "deployments", "statefulsets", "daemonsets", "jobs", "cronjobs"],
  },
  {
    id: "networking",
    label: "Networking",
    items: ["services", "ingresses"],
  },
  {
    id: "configuration",
    label: "Configuration",
    items: ["configmaps", "secrets"],
  },
  {
    id: "rbac",
    label: "Access Control",
    items: ["serviceaccounts", "roles", "rolebindings", "clusterroles", "clusterrolebindings"],
  },
  {
    id: "storage",
    label: "Storage",
    items: ["persistentvolumeclaims", "persistentvolumes"],
  },
  {
    id: "helm",
    label: "Helm",
    items: ["helm", "helmcharts"],
  },
  {
    id: "cluster",
    label: "Cluster",
    items: ["dashboard", "nodes", "namespaces", "customresourcedefinitions"],
  },
];

export function getResourceLabel(key: ListResourceKey): string {
  return resourceMeta[key]?.label ?? key;
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
  jobs: { group: "batch", resource: "jobs" },
  cronjobs: { group: "batch", resource: "cronjobs" },
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
  helm: { group: "", resource: "secrets" },
  helmcharts: { group: "", resource: "secrets" },
};
