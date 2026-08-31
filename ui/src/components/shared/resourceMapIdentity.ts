import type { ApiResourceIdentity } from "../../types/api";
import type { ListResourceKey } from "../../utils/k8sResources";
import type { ResourceDrawerIdentity } from "./ResourceDrawerShell";

export type CanonicalResourceDescriptor = Pick<ApiResourceIdentity, "group" | "version" | "resource" | "kind" | "scope">;

const fixed = (group: string, version: string, resource: string, kind: string, scope: ApiResourceIdentity["scope"]): CanonicalResourceDescriptor => ({
  group, version, resource, kind, scope,
});

/** Authoritative API identity for every real fixed resource drawer. */
export const fixedResourceIdentityRegistry: Partial<Record<ListResourceKey, CanonicalResourceDescriptor>> = {
  pods: fixed("", "v1", "pods", "Pod", "namespaced"),
  services: fixed("", "v1", "services", "Service", "namespaced"),
  configmaps: fixed("", "v1", "configmaps", "ConfigMap", "namespaced"),
  secrets: fixed("", "v1", "secrets", "Secret", "namespaced"),
  serviceaccounts: fixed("", "v1", "serviceaccounts", "ServiceAccount", "namespaced"),
  persistentvolumeclaims: fixed("", "v1", "persistentvolumeclaims", "PersistentVolumeClaim", "namespaced"),
  persistentvolumes: fixed("", "v1", "persistentvolumes", "PersistentVolume", "cluster"),
  nodes: fixed("", "v1", "nodes", "Node", "cluster"),
  namespaces: fixed("", "v1", "namespaces", "Namespace", "cluster"),
  resourcequotas: fixed("", "v1", "resourcequotas", "ResourceQuota", "namespaced"),
  limitranges: fixed("", "v1", "limitranges", "LimitRange", "namespaced"),
  deployments: fixed("apps", "v1", "deployments", "Deployment", "namespaced"),
  daemonsets: fixed("apps", "v1", "daemonsets", "DaemonSet", "namespaced"),
  statefulsets: fixed("apps", "v1", "statefulsets", "StatefulSet", "namespaced"),
  replicasets: fixed("apps", "v1", "replicasets", "ReplicaSet", "namespaced"),
  jobs: fixed("batch", "v1", "jobs", "Job", "namespaced"),
  cronjobs: fixed("batch", "v1", "cronjobs", "CronJob", "namespaced"),
  ingresses: fixed("networking.k8s.io", "v1", "ingresses", "Ingress", "namespaced"),
  networkpolicies: fixed("networking.k8s.io", "v1", "networkpolicies", "NetworkPolicy", "namespaced"),
  horizontalpodautoscalers: fixed("autoscaling", "v2", "horizontalpodautoscalers", "HorizontalPodAutoscaler", "namespaced"),
  roles: fixed("rbac.authorization.k8s.io", "v1", "roles", "Role", "namespaced"),
  rolebindings: fixed("rbac.authorization.k8s.io", "v1", "rolebindings", "RoleBinding", "namespaced"),
  clusterroles: fixed("rbac.authorization.k8s.io", "v1", "clusterroles", "ClusterRole", "cluster"),
  clusterrolebindings: fixed("rbac.authorization.k8s.io", "v1", "clusterrolebindings", "ClusterRoleBinding", "cluster"),
  customresourcedefinitions: fixed("apiextensions.k8s.io", "v1", "customresourcedefinitions", "CustomResourceDefinition", "cluster"),
};

export function resolveResourceDrawerIdentity(identity?: ResourceDrawerIdentity | null): ApiResourceIdentity | null {
  if (!identity?.name) return null;
  const hasExplicitDescriptor = identity.group != null && Boolean(identity.version && identity.kind && identity.scope);
  if (hasExplicitDescriptor && identity.resource === "customresources" && !identity.apiResource) return null;
  const descriptor = hasExplicitDescriptor
    ? {
        group: identity.group!,
        version: identity.version!,
        resource: identity.apiResource || identity.resource,
        kind: identity.kind!,
        scope: identity.scope!,
      }
    : fixedResourceIdentityRegistry[identity.resource];
  if (!descriptor?.resource) return null;
  const namespace = identity.namespace?.trim() || "";
  if (descriptor.scope === "namespaced" && !namespace) return null;
  if (descriptor.scope === "cluster" && namespace) return null;
  return { ...descriptor, namespace, name: identity.name, ...(identity.uid ? { uid: identity.uid } : {}) };
}

export function resourceIdentityKey(identity: ApiResourceIdentity | null): string {
  return identity ? [identity.group, identity.version, identity.resource, identity.kind, identity.scope, identity.namespace, identity.name, identity.uid || ""].join("|") : "";
}
