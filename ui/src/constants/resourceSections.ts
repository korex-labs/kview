import type { Section } from "../state";

export const dataplaneSearchSectionByKind: Record<string, Section> = {
  namespaces: "namespaces",
  nodes: "nodes",
  pods: "pods",
  deployments: "deployments",
  daemonsets: "daemonsets",
  statefulsets: "statefulsets",
  replicasets: "replicasets",
  jobs: "jobs",
  cronjobs: "cronjobs",
  services: "services",
  ingresses: "ingresses",
  configmaps: "configmaps",
  secrets: "secrets",
  serviceaccounts: "serviceaccounts",
  roles: "roles",
  rolebindings: "rolebindings",
  persistentvolumeclaims: "persistentvolumeclaims",
  helmreleases: "helm",
  resourcequotas: "namespaces",
  limitranges: "namespaces",
};
