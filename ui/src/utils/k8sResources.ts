import type { Section } from "../state";
import type { ResourceIconName } from "../components/icons/resources/types";
import type { ApiViewResourcesResponse } from "../types/api";
import { applyActionPresentationDescriptors, resetActionPresentationsForTest } from "./actionPresentation";

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

export type ResourceViewPolicy = {
  quickFilters: {
    search: boolean;
    tag: boolean;
  };
  defaultSort: {
    field: string;
    direction: "asc" | "desc";
  };
  filterLabel: string;
  identity: string[];
  searchFields: string[];
  savedViews: {
    enabled: boolean;
    namePrefix: string;
    location: string[];
    state: string[];
  };
};

export type SidebarGroup = {
  id: string;
  label: string;
  icon: ResourceIconName;
  items: Section[];
};

export type DashboardViewPolicy = {
  signalViews: {
    enabled: boolean;
    namePrefix: string;
    state: string[];
  };
  signalFilterCategories: Record<string, {
    label: string;
    order: number;
    compact: boolean;
  }>;
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

export const resourceViewPolicies: Record<ListResourceKey, ResourceViewPolicy> = Object.fromEntries(
  Object.keys(resourceMeta).map((key) => [
    key,
    {
      quickFilters: {
        search: key !== "dashboard",
        tag: key !== "dashboard",
      },
      defaultSort: {
        field: key === "helmcharts" ? "chartName" : key === "customresources" || key === "clusterresources" ? "kind" : "name",
        direction: "asc",
      },
      filterLabel: defaultFilterLabel(key as ListResourceKey),
      identity: defaultIdentityFields(key as ListResourceKey),
      searchFields: defaultSearchFields(key as ListResourceKey),
      savedViews: defaultSavedViewPolicy(key as ListResourceKey),
    },
  ]),
) as Record<ListResourceKey, ResourceViewPolicy>;

function defaultSavedViewPolicy(key: ListResourceKey): ResourceViewPolicy["savedViews"] {
  if (key === "dashboard") {
    return {
      enabled: false,
      namePrefix: "",
      location: [],
      state: [],
    };
  }
  return {
    enabled: true,
    namePrefix: resourceMeta[key].label,
    location: ["context", "namespace", "resource"],
    state: ["filter", "sort", "columns"],
  };
}

function defaultIdentityFields(key: ListResourceKey): string[] {
  if (key === "helmcharts") return ["chartName"];
  if (key === "customresources" || key === "clusterresources") return ["kind", "name"];
  return ["name"];
}

function defaultSearchFields(key: ListResourceKey): string[] {
  switch (key) {
    case "helmcharts":
      return ["chartName", "chartVersion", "appVersion", "statuses", "derivedSource"];
    case "helm":
      return ["name", "chart", "chartVersion", "appVersion", "status", "signalSeverity", "listSignalSeverity"];
    case "customresources":
    case "clusterresources":
      return ["name", "kind", "group", "signalSeverity", "statusSummary"];
    case "customresourcedefinitions":
      return ["name", "group", "kind", "scope", "signalSeverity", "listSignalSeverity"];
    case "pods":
      return ["name", "nodeName", "phase", "status", "signalSeverity", "listSignalSeverity"];
    case "nodes":
      return ["name", "role", "roles", "status", "source", "signalSeverity", "listSignalSeverity"];
    case "deployments":
    case "daemonsets":
      return ["name", "strategy", "status", "phase", "signalSeverity", "listSignalSeverity"];
    case "statefulsets":
      return ["name", "serviceName", "service", "status", "phase", "signalSeverity", "listSignalSeverity"];
    case "replicasets":
      return ["name", "owner.name", "ownerName", "status", "phase", "signalSeverity", "listSignalSeverity"];
    case "jobs":
      return ["name", "status", "phase", "conditions", "signalSeverity", "listSignalSeverity"];
    case "cronjobs":
      return ["name", "schedule", "scheduleHint", "status", "phase", "signalSeverity", "listSignalSeverity"];
    case "services":
      return ["name", "type", "clusterIP", "externalName", "exposure", "exposureHint", "clusterIPs", "portsSummary", "signalSeverity", "listSignalSeverity"];
    case "ingresses":
      return ["name", "className", "ingressClassName", "hosts", "addresses", "addressState", "tlsHint", "signalSeverity", "listSignalSeverity"];
    case "networkpolicies":
      return ["name", "podSelector", "policyTypes", "types", "signalSeverity", "listSignalSeverity"];
    case "secrets":
      return ["name", "type", "signalSeverity", "listSignalSeverity"];
    case "serviceaccounts":
      return ["name", "tokenCount", "tokens", "tokenMountPolicy", "pullSecretCount", "pullSecrets", "pullSecretHint", "imagePullSecrets", "signalSeverity", "listSignalSeverity"];
    case "roles":
    case "clusterroles":
      return ["name", "privilegeBreadth", "signalSeverity", "listSignalSeverity"];
    case "rolebindings":
    case "clusterrolebindings":
      return ["name", "roleName", "bindingHint", "subjectBreadth", "signalSeverity", "listSignalSeverity"];
    case "persistentvolumeclaims":
      return ["name", "status", "phase", "storageClass", "storageClassName", "volumeName", "signalSeverity", "listSignalSeverity"];
    case "persistentvolumes":
      return ["name", "status", "phase", "storageClass", "storageClassName", "claim", "claimRef.name", "claimRef.namespace", "signalSeverity", "listSignalSeverity"];
    case "resourcequotas":
      return ["name", "key", "hard", "used", "entries.key", "maxEntry", "status", "signalSeverity", "listSignalSeverity"];
    case "limitranges":
      return ["name", "type", "types", "status", "signalSeverity", "listSignalSeverity"];
    default:
      return ["name", "status", "phase", "type", "signalSeverity", "listSignalSeverity"];
  }
}

function defaultFilterLabel(key: ListResourceKey): string {
  switch (key) {
    case "horizontalpodautoscalers":
      return "Filter (name/target/metric/signal)";
    case "clusterrolebindings":
      return "Filter (name/role/signal)";
    case "networkpolicies":
      return "Filter (name/selector/type)";
    case "persistentvolumes":
      return "Filter (name/status/signal/storageClass/claim)";
    case "jobs":
      return "Filter (name/status)";
    case "ingresses":
      return "Filter (name/class/signal/host)";
    case "statefulsets":
      return "Filter (name/service)";
    case "customresources":
    case "clusterresources":
      return "Filter (name/kind/group/status)";
    case "clusterroles":
      return "Filter (name/signal)";
    case "deployments":
    case "daemonsets":
      return "Filter (name/strategy)";
    case "services":
      return "Filter (name/type/signal/exposure)";
    case "helmcharts":
      return "Filter (chart/version/status/source)";
    case "helm":
      return "Filter (name / chart / signal / version)";
    case "nodes":
      return "Filter (name/role/status/signal/source)";
    case "namespaces":
      return "Filter (name, status, signals, workload, quota)";
    case "configmaps":
    case "roles":
    case "rolebindings":
      return "Filter (name/signal)";
    case "resourcequotas":
      return "Filter (name/key)";
    case "secrets":
      return "Filter (name/type/signal)";
    case "limitranges":
      return "Filter (name/type)";
    case "replicasets":
      return "Filter (name/owner)";
    case "cronjobs":
      return "Filter (name/schedule)";
    case "persistentvolumeclaims":
      return "Filter (name/status/signal/storageClass/volume)";
    case "pods":
      return "Filter (name/node/status)";
    case "serviceaccounts":
      return "Filter (name/token/pullSecret)";
    default:
      return "Filter";
  }
}

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

export function getResourceViewPolicy(key?: ListResourceKey | null): ResourceViewPolicy {
  if (!key || !isListResourceKey(key)) {
    return {
      quickFilters: { search: true, tag: true },
      defaultSort: { field: "name", direction: "asc" },
      filterLabel: "Filter",
      identity: ["name"],
      searchFields: ["name"],
      savedViews: {
        enabled: true,
        namePrefix: "Resources",
        location: ["context", "namespace", "resource"],
        state: ["filter", "sort", "columns"],
      },
    };
  }
  return resourceViewPolicies[key] ?? {
    quickFilters: { search: true, tag: true },
    defaultSort: { field: "name", direction: "asc" },
    filterLabel: "Filter",
    identity: ["name"],
    searchFields: ["name"],
    savedViews: {
      enabled: true,
      namePrefix: "Resources",
      location: ["context", "namespace", "resource"],
      state: ["filter", "sort", "columns"],
    },
  };
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

const defaultResourceViewPolicies: Record<ListResourceKey, ResourceViewPolicy> = Object.fromEntries(
  Object.entries(resourceViewPolicies).map(([key, policy]) => [
    key,
    {
      quickFilters: { ...policy.quickFilters },
      defaultSort: { ...policy.defaultSort },
      filterLabel: policy.filterLabel,
      identity: [...policy.identity],
      searchFields: [...policy.searchFields],
      savedViews: {
        ...policy.savedViews,
        location: [...policy.savedViews.location],
        state: [...policy.savedViews.state],
      },
    },
  ]),
) as Record<ListResourceKey, ResourceViewPolicy>;

const defaultSidebarGroups: SidebarGroup[] = sidebarGroups.map((group) => ({
  ...group,
  items: [...group.items],
}));

const defaultDashboardViewPolicy: DashboardViewPolicy = {
  signalViews: {
    enabled: true,
    namePrefix: "Signal view",
    state: ["filters", "query", "sort", "rowsPerPage"],
  },
  signalFilterCategories: {
    priority: { label: "Priority", order: 0, compact: true },
    severity: { label: "By Severity", order: 1, compact: true },
    acknowledgement: { label: "By Acknowledgement", order: 2, compact: true },
    tag: { label: "By Tags", order: 3, compact: true },
    kind: { label: "By Kind", order: 4, compact: false },
    signal_type: { label: "By Signal Reason", order: 5, compact: false },
    namespace: { label: "Top 5 Namespaces With Problems", order: 6, compact: false },
    namespace_favourite: { label: "Favourite Namespaces", order: 7, compact: false },
    namespace_recent: { label: "Recent Namespaces", order: 8, compact: false },
    derived: { label: "Derived", order: 9, compact: false },
    other: { label: "Other", order: 10, compact: false },
  },
};

const dashboardViewPolicy: DashboardViewPolicy = {
  signalViews: {
    ...defaultDashboardViewPolicy.signalViews,
    state: [...defaultDashboardViewPolicy.signalViews.state],
  },
  signalFilterCategories: Object.fromEntries(
    Object.entries(defaultDashboardViewPolicy.signalFilterCategories).map(([key, policy]) => [key, { ...policy }]),
  ),
};

export function getDashboardViewPolicy(): DashboardViewPolicy {
  return {
    signalViews: {
      ...dashboardViewPolicy.signalViews,
      state: [...dashboardViewPolicy.signalViews.state],
    },
    signalFilterCategories: Object.fromEntries(
      Object.entries(dashboardViewPolicy.signalFilterCategories).map(([key, policy]) => [key, { ...policy }]),
    ),
  };
}

export function getDashboardSignalFilterCategoryPolicy(category?: string): { label: string; order: number; compact: boolean } {
  const key = category || "other";
  return dashboardViewPolicy.signalFilterCategories[key] || dashboardViewPolicy.signalFilterCategories.other;
}

export function resetViewResourceDescriptorsForTest(): void {
  for (const key of Object.keys(resourceMeta) as ListResourceKey[]) {
    resourceMeta[key] = { ...defaultResourceMeta[key] };
    listResourceAccess[key] = { ...defaultListResourceAccess[key] };
    resourceViewPolicies[key] = {
      quickFilters: { ...defaultResourceViewPolicies[key].quickFilters },
      defaultSort: { ...defaultResourceViewPolicies[key].defaultSort },
      filterLabel: defaultResourceViewPolicies[key].filterLabel,
      identity: [...defaultResourceViewPolicies[key].identity],
      searchFields: [...defaultResourceViewPolicies[key].searchFields],
      savedViews: {
        ...defaultResourceViewPolicies[key].savedViews,
        location: [...defaultResourceViewPolicies[key].savedViews.location],
        state: [...defaultResourceViewPolicies[key].savedViews.state],
      },
    };
  }
  sidebarGroups.splice(
    0,
    sidebarGroups.length,
    ...defaultSidebarGroups.map((group) => ({ ...group, items: [...group.items] })),
  );
  dashboardViewPolicy.signalViews = {
    ...defaultDashboardViewPolicy.signalViews,
    state: [...defaultDashboardViewPolicy.signalViews.state],
  };
  dashboardViewPolicy.signalFilterCategories = Object.fromEntries(
    Object.entries(defaultDashboardViewPolicy.signalFilterCategories).map(([key, policy]) => [key, { ...policy }]),
  );
  resetActionPresentationsForTest();
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

    const quickFilters = descriptor.listView?.quickFilters;
    if (quickFilters) {
      const nextPolicy: ResourceViewPolicy = {
        ...resourceViewPolicies[descriptor.key],
        quickFilters: {
          search: quickFilters.search !== false,
          tag: quickFilters.tag !== false,
        },
      };
      const currentPolicy = resourceViewPolicies[descriptor.key];
      if (
        currentPolicy.quickFilters.search !== nextPolicy.quickFilters.search ||
        currentPolicy.quickFilters.tag !== nextPolicy.quickFilters.tag
      ) {
        resourceViewPolicies[descriptor.key] = nextPolicy;
        changed = true;
      }
    }

    const defaultSort = descriptor.listView?.defaultSort;
    if (defaultSort?.field && (defaultSort.direction === "asc" || defaultSort.direction === "desc")) {
      const currentPolicy = resourceViewPolicies[descriptor.key];
      if (
        currentPolicy.defaultSort.field !== defaultSort.field ||
        currentPolicy.defaultSort.direction !== defaultSort.direction
      ) {
        resourceViewPolicies[descriptor.key] = {
          ...currentPolicy,
          defaultSort: {
            field: defaultSort.field,
            direction: defaultSort.direction,
          },
        };
        changed = true;
      }
    }

    const listView = descriptor.listView;
    if (listView?.filterLabel || listView?.identity || listView?.searchFields) {
      const currentPolicy = resourceViewPolicies[descriptor.key];
      const nextIdentity = normalizeFieldList(listView.identity) || currentPolicy.identity;
      const nextSearchFields = normalizeFieldList(listView.searchFields) || currentPolicy.searchFields;
      const nextFilterLabel = listView.filterLabel?.trim() || currentPolicy.filterLabel;
      if (
        currentPolicy.filterLabel !== nextFilterLabel ||
        currentPolicy.identity.join("\u0000") !== nextIdentity.join("\u0000") ||
        currentPolicy.searchFields.join("\u0000") !== nextSearchFields.join("\u0000")
      ) {
        resourceViewPolicies[descriptor.key] = {
          ...currentPolicy,
          filterLabel: nextFilterLabel,
          identity: [...nextIdentity],
          searchFields: [...nextSearchFields],
        };
        changed = true;
      }
    }

    const savedViews = listView?.savedViews;
    if (savedViews) {
      const currentPolicy = resourceViewPolicies[descriptor.key];
      const nextPolicy: ResourceViewPolicy = {
        ...currentPolicy,
        savedViews: {
          enabled: savedViews.enabled !== false,
          namePrefix: savedViews.namePrefix?.trim() || currentPolicy.savedViews.namePrefix || descriptor.label,
          location: normalizeFieldList(savedViews.location) || currentPolicy.savedViews.location,
          state: normalizeFieldList(savedViews.state) || currentPolicy.savedViews.state,
        },
      };
      if (
        currentPolicy.savedViews.enabled !== nextPolicy.savedViews.enabled ||
        currentPolicy.savedViews.namePrefix !== nextPolicy.savedViews.namePrefix ||
        currentPolicy.savedViews.location.join("\u0000") !== nextPolicy.savedViews.location.join("\u0000") ||
        currentPolicy.savedViews.state.join("\u0000") !== nextPolicy.savedViews.state.join("\u0000")
      ) {
        resourceViewPolicies[descriptor.key] = nextPolicy;
        changed = true;
      }
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

  const dashboard = response?.dashboard;
  if (dashboard?.signalViews) {
    const nextSignalViews = {
      enabled: dashboard.signalViews.enabled !== false,
      namePrefix: dashboard.signalViews.namePrefix?.trim() || defaultDashboardViewPolicy.signalViews.namePrefix,
      state: normalizeFieldList(dashboard.signalViews.state) || defaultDashboardViewPolicy.signalViews.state,
    };
    if (
      dashboardViewPolicy.signalViews.enabled !== nextSignalViews.enabled ||
      dashboardViewPolicy.signalViews.namePrefix !== nextSignalViews.namePrefix ||
      dashboardViewPolicy.signalViews.state.join("\u0000") !== nextSignalViews.state.join("\u0000")
    ) {
      dashboardViewPolicy.signalViews = {
        ...nextSignalViews,
        state: [...nextSignalViews.state],
      };
      changed = true;
    }
  }

  const nextSignalFilterCategories = (dashboard?.signalFilterCategories || [])
    .filter((category) => category.key?.trim() && category.label?.trim() && typeof category.order === "number")
    .map((category) => ({
      key: category.key?.trim() || "",
      label: category.label?.trim() || "",
      order: Number.isFinite(category.order) ? Math.round(category.order as number) : 10,
      compact: category.compact === true,
    }));
  if (nextSignalFilterCategories.length > 0) {
    const merged = Object.fromEntries(
      Object.entries(defaultDashboardViewPolicy.signalFilterCategories).map(([key, policy]) => [key, { ...policy }]),
    ) as DashboardViewPolicy["signalFilterCategories"];
    for (const category of nextSignalFilterCategories) {
      merged[category.key] = {
        label: category.label,
        order: category.order,
        compact: category.compact,
      };
    }
    if (JSON.stringify(dashboardViewPolicy.signalFilterCategories) !== JSON.stringify(merged)) {
      dashboardViewPolicy.signalFilterCategories = merged;
      changed = true;
    }
  }

  if (applyActionPresentationDescriptors(response?.actions)) {
    changed = true;
  }

  return changed;
}

function normalizeFieldList(fields: string[] | undefined): string[] | null {
  if (!Array.isArray(fields)) return null;
  const normalized = fields
    .map((field) => field.trim())
    .filter(Boolean);
  return normalized.length > 0 ? Array.from(new Set(normalized)) : null;
}
