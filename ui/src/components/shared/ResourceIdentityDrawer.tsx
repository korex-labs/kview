import React, { lazy, Suspense } from "react";
import { Box, CircularProgress } from "@mui/material";
import type { ApiResourceIdentity } from "../../types/api";
import { fixedResourceIdentityRegistry } from "./resourceMapIdentity";

const NamespaceDrawer = lazy(() => import("../resources/namespaces/NamespaceDrawer"));
const NodeDrawer = lazy(() => import("../resources/nodes/NodeDrawer"));
const PodDrawer = lazy(() => import("../resources/pods/PodDrawer"));
const DeploymentDrawer = lazy(() => import("../resources/deployments/DeploymentDrawer"));
const DaemonSetDrawer = lazy(() => import("../resources/daemonsets/DaemonSetDrawer"));
const StatefulSetDrawer = lazy(() => import("../resources/statefulsets/StatefulSetDrawer"));
const ReplicaSetDrawer = lazy(() => import("../resources/replicasets/ReplicaSetDrawer"));
const JobDrawer = lazy(() => import("../resources/jobs/JobDrawer"));
const CronJobDrawer = lazy(() => import("../resources/cronjobs/CronJobDrawer"));
const ServiceDrawer = lazy(() => import("../resources/services/ServiceDrawer"));
const IngressDrawer = lazy(() => import("../resources/ingresses/IngressDrawer"));
const NetworkPolicyDrawer = lazy(() => import("../resources/networkpolicies/NetworkPolicyDrawer"));
const HorizontalPodAutoscalerDrawer = lazy(() => import("../resources/horizontalpodautoscalers/HorizontalPodAutoscalerDrawer"));
const ResourceQuotaDrawer = lazy(() => import("../resources/resourcequotas/ResourceQuotaDrawer"));
const LimitRangeDrawer = lazy(() => import("../resources/limitranges/LimitRangeDrawer"));
const ConfigMapDrawer = lazy(() => import("../resources/configmaps/ConfigMapDrawer"));
const SecretDrawer = lazy(() => import("../resources/secrets/SecretDrawer"));
const ServiceAccountDrawer = lazy(() => import("../resources/serviceaccounts/ServiceAccountDrawer"));
const RoleDrawer = lazy(() => import("../resources/roles/RoleDrawer"));
const RoleBindingDrawer = lazy(() => import("../resources/rolebindings/RoleBindingDrawer"));
const ClusterRoleDrawer = lazy(() => import("../resources/clusterroles/ClusterRoleDrawer"));
const ClusterRoleBindingDrawer = lazy(() => import("../resources/clusterrolebindings/ClusterRoleBindingDrawer"));
const PersistentVolumeClaimDrawer = lazy(() => import("../resources/persistentvolumeclaims/PersistentVolumeClaimDrawer"));
const PersistentVolumeDrawer = lazy(() => import("../resources/persistentvolumes/PersistentVolumeDrawer"));
const CustomResourceDefinitionDrawer = lazy(() => import("../resources/customresourcedefinitions/CustomResourceDefinitionDrawer"));
const CustomResourceDrawer = lazy(() => import("../resources/customresources/CustomResourceDrawer"));

export type DrawerResourceIdentity = Pick<ApiResourceIdentity, "resource" | "namespace" | "name"> & Partial<ApiResourceIdentity>;

const fixedDrawerResources = new Set([
  "namespaces", "nodes", "pods", "deployments", "daemonsets", "statefulsets", "replicasets", "jobs", "cronjobs",
  "services", "ingresses", "networkpolicies", "horizontalpodautoscalers", "resourcequotas", "limitranges", "configmaps",
  "secrets", "serviceaccounts", "roles", "rolebindings", "clusterroles", "clusterrolebindings", "persistentvolumeclaims",
  "persistentvolumes", "customresourcedefinitions",
]);

export function supportsResourceIdentityDrawer(identity: DrawerResourceIdentity): boolean {
  if (!identity.name || !identity.resource) return false;
  if (fixedDrawerResources.has(identity.resource)) {
    const descriptor = fixedResourceIdentityRegistry[identity.resource as keyof typeof fixedResourceIdentityRegistry];
    if (identity.version && descriptor && (identity.group !== descriptor.group || identity.version !== descriptor.version || identity.kind !== descriptor.kind || identity.scope !== descriptor.scope)) return false;
    if (identity.scope === "namespaced" && !identity.namespace) return false;
    if (identity.scope === "cluster" && identity.namespace) return false;
    return true;
  }
  if (!identity.group || !identity.version || !identity.kind || !identity.scope) return false;
  return identity.scope === "namespaced" ? Boolean(identity.namespace) : identity.scope === "cluster" && !identity.namespace;
}

export function ResourceIdentityDrawer({ token, identity, open = true, onClose }: {
  token: string;
  identity: DrawerResourceIdentity | null;
  open?: boolean;
  onClose: () => void;
}) {
  if (!identity || !supportsResourceIdentityDrawer(identity)) return null;
  const common = { open, onClose, token };
  const namespace = identity.namespace || "";
  const name = identity.name || null;
  let drawer: React.ReactNode;
  switch (identity.resource) {
    case "namespaces": drawer = <NamespaceDrawer {...common} namespaceName={name} />; break;
    case "nodes": drawer = <NodeDrawer {...common} nodeName={name} />; break;
    case "pods": drawer = <PodDrawer {...common} namespace={namespace} podName={name} />; break;
    case "deployments": drawer = <DeploymentDrawer {...common} namespace={namespace} deploymentName={name} />; break;
    case "daemonsets": drawer = <DaemonSetDrawer {...common} namespace={namespace} daemonSetName={name} />; break;
    case "statefulsets": drawer = <StatefulSetDrawer {...common} namespace={namespace} statefulSetName={name} />; break;
    case "replicasets": drawer = <ReplicaSetDrawer {...common} namespace={namespace} replicaSetName={name} />; break;
    case "jobs": drawer = <JobDrawer {...common} namespace={namespace} jobName={name} />; break;
    case "cronjobs": drawer = <CronJobDrawer {...common} namespace={namespace} cronJobName={name} />; break;
    case "services": drawer = <ServiceDrawer {...common} namespace={namespace} serviceName={name} />; break;
    case "ingresses": drawer = <IngressDrawer {...common} namespace={namespace} ingressName={name} />; break;
    case "networkpolicies": drawer = <NetworkPolicyDrawer {...common} namespace={namespace} networkPolicyName={name} />; break;
    case "horizontalpodautoscalers": drawer = <HorizontalPodAutoscalerDrawer {...common} namespace={namespace} hpaName={name} />; break;
    case "resourcequotas": drawer = <ResourceQuotaDrawer {...common} namespace={namespace} resourceQuotaName={name} />; break;
    case "limitranges": drawer = <LimitRangeDrawer {...common} namespace={namespace} limitRangeName={name} />; break;
    case "configmaps": drawer = <ConfigMapDrawer {...common} namespace={namespace} configMapName={name} />; break;
    case "secrets": drawer = <SecretDrawer {...common} namespace={namespace} secretName={name} />; break;
    case "serviceaccounts": drawer = <ServiceAccountDrawer {...common} namespace={namespace} serviceAccountName={name} />; break;
    case "roles": drawer = <RoleDrawer {...common} namespace={namespace} roleName={name} />; break;
    case "rolebindings": drawer = <RoleBindingDrawer {...common} namespace={namespace} roleBindingName={name} />; break;
    case "clusterroles": drawer = <ClusterRoleDrawer {...common} clusterRoleName={name} />; break;
    case "clusterrolebindings": drawer = <ClusterRoleBindingDrawer {...common} clusterRoleBindingName={name} />; break;
    case "persistentvolumeclaims": drawer = <PersistentVolumeClaimDrawer {...common} namespace={namespace} persistentVolumeClaimName={name} />; break;
    case "persistentvolumes": drawer = <PersistentVolumeDrawer {...common} persistentVolumeName={name} />; break;
    case "customresourcedefinitions": drawer = <CustomResourceDefinitionDrawer {...common} crdName={name} />; break;
    default:
      drawer = <CustomResourceDrawer {...common} crRef={{
        group: identity.group!, version: identity.version!, resource: identity.resource, kind: identity.kind!, namespace, name: identity.name,
      }} />;
  }
  return <Suspense fallback={<Box sx={{ display: "flex", justifyContent: "center", p: 4 }}><CircularProgress size={28} /></Box>}>{drawer}</Suspense>;
}

export default ResourceIdentityDrawer;
