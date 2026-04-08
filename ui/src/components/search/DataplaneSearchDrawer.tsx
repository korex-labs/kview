import NamespaceDrawer from "../resources/namespaces/NamespaceDrawer";
import NodeDrawer from "../resources/nodes/NodeDrawer";
import PodDrawer from "../resources/pods/PodDrawer";
import DeploymentDrawer from "../resources/deployments/DeploymentDrawer";
import DaemonSetDrawer from "../resources/daemonsets/DaemonSetDrawer";
import StatefulSetDrawer from "../resources/statefulsets/StatefulSetDrawer";
import ReplicaSetDrawer from "../resources/replicasets/ReplicaSetDrawer";
import JobDrawer from "../resources/jobs/JobDrawer";
import CronJobDrawer from "../resources/cronjobs/CronJobDrawer";
import ServiceDrawer from "../resources/services/ServiceDrawer";
import IngressDrawer from "../resources/ingresses/IngressDrawer";
import ConfigMapDrawer from "../resources/configmaps/ConfigMapDrawer";
import SecretDrawer from "../resources/secrets/SecretDrawer";
import ServiceAccountDrawer from "../resources/serviceaccounts/ServiceAccountDrawer";
import RoleDrawer from "../resources/roles/RoleDrawer";
import RoleBindingDrawer from "../resources/rolebindings/RoleBindingDrawer";
import PersistentVolumeClaimDrawer from "../resources/persistentvolumeclaims/PersistentVolumeClaimDrawer";
import HelmReleaseDrawer from "../resources/helm/HelmReleaseDrawer";
import type { ApiDataplaneSearchItem } from "../../types/api";

type Props = {
  token: string;
  item: ApiDataplaneSearchItem | null;
  onClose: () => void;
  onNavigate?: (section: string, namespace: string) => void;
};

export default function DataplaneSearchDrawer({ token, item, onClose, onNavigate }: Props) {
  const open = !!item;
  const kind = item?.kind || "";
  const namespace = item?.namespace || "";
  const name = item?.name || null;

  switch (kind) {
    case "namespaces":
      return <NamespaceDrawer open={open} onClose={onClose} token={token} namespaceName={name} onNavigate={onNavigate} />;
    case "nodes":
      return <NodeDrawer open={open} onClose={onClose} token={token} nodeName={name} />;
    case "pods":
      return <PodDrawer open={open} onClose={onClose} token={token} namespace={namespace} podName={name} />;
    case "deployments":
      return <DeploymentDrawer open={open} onClose={onClose} token={token} namespace={namespace} deploymentName={name} />;
    case "daemonsets":
      return <DaemonSetDrawer open={open} onClose={onClose} token={token} namespace={namespace} daemonSetName={name} />;
    case "statefulsets":
      return <StatefulSetDrawer open={open} onClose={onClose} token={token} namespace={namespace} statefulSetName={name} />;
    case "replicasets":
      return <ReplicaSetDrawer open={open} onClose={onClose} token={token} namespace={namespace} replicaSetName={name} />;
    case "jobs":
      return <JobDrawer open={open} onClose={onClose} token={token} namespace={namespace} jobName={name} />;
    case "cronjobs":
      return <CronJobDrawer open={open} onClose={onClose} token={token} namespace={namespace} cronJobName={name} />;
    case "services":
      return <ServiceDrawer open={open} onClose={onClose} token={token} namespace={namespace} serviceName={name} />;
    case "ingresses":
      return <IngressDrawer open={open} onClose={onClose} token={token} namespace={namespace} ingressName={name} />;
    case "configmaps":
      return <ConfigMapDrawer open={open} onClose={onClose} token={token} namespace={namespace} configMapName={name} />;
    case "secrets":
      return <SecretDrawer open={open} onClose={onClose} token={token} namespace={namespace} secretName={name} />;
    case "serviceaccounts":
      return <ServiceAccountDrawer open={open} onClose={onClose} token={token} namespace={namespace} serviceAccountName={name} />;
    case "roles":
      return <RoleDrawer open={open} onClose={onClose} token={token} namespace={namespace} roleName={name} />;
    case "rolebindings":
      return <RoleBindingDrawer open={open} onClose={onClose} token={token} namespace={namespace} roleBindingName={name} />;
    case "persistentvolumeclaims":
      return <PersistentVolumeClaimDrawer open={open} onClose={onClose} token={token} namespace={namespace} persistentVolumeClaimName={name} />;
    case "helmreleases":
      return <HelmReleaseDrawer open={open} onClose={onClose} token={token} namespace={namespace} releaseName={name} />;
    case "resourcequotas":
    case "limitranges":
      return <NamespaceDrawer open={open} onClose={onClose} token={token} namespaceName={namespace || null} onNavigate={onNavigate} />;
    default:
      return null;
  }
}
