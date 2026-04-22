import type { HelmChart } from "../../../types/api";

export type InspectTarget = {
  kind:
    | "Namespace"
    | "Node"
    | "Pod"
    | "Job"
    | "CronJob"
    | "HorizontalPodAutoscaler"
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
