import type { HelmChart } from "../../../types/api";

export type InspectTarget = {
  kind:
    | "Namespace"
    | "Node"
    | "Pod"
    | "Job"
    | "CronJob"
    | "ConfigMap"
    | "Secret"
    | "ServiceAccount"
    | "PersistentVolumeClaim"
    | "HelmRelease"
    | "Service"
    | "Ingress"
    | "Role"
    | "RoleBinding"
    | "HelmChart";
  namespace: string;
  name: string;
  chart?: HelmChart;
};

export type DerivedFilter = "all" | "nodes" | "helm" | "signals";
