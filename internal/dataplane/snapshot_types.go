package dataplane

import (
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

// Snapshot is the shared raw snapshot container across dataplane-owned resources.
// It keeps items, truthful metadata, and an optional normalized error.
type Snapshot[I any] struct {
	Items                []I
	Meta                 SnapshotMetadata
	Err                  *NormalizedError
	Aggregation          *dto.CustomResourceAggregationMeta        `json:"aggregation,omitempty"`
	Relationships        []dto.ResourceRelationshipRecord          `json:"relationships,omitempty"`
	RelationshipMetadata *dto.ResourceRelationshipSnapshotMetadata `json:"relationshipMetadata,omitempty"`
	// RelationshipSourceItems persists the authoritative number of list items
	// that carried Kubernetes relationship identity before display-only merges.
	// It is set only for CustomResource snapshots, whose Helm projections are
	// intentionally carrierless and whose hidden carriers do not survive JSON.
	RelationshipSourceItems *int `json:"relationshipSourceItems,omitempty"`
}

func (s Snapshot[I]) ObservedAt() time.Time { return s.Meta.ObservedAt }

type NamespaceSnapshot = Snapshot[dto.NamespaceListItemDTO]
type NodesSnapshot = Snapshot[dto.NodeListItemDTO]
type PersistentVolumesSnapshot = Snapshot[dto.PersistentVolumeDTO]
type ClusterRolesSnapshot = Snapshot[dto.ClusterRoleListItemDTO]
type ClusterRoleBindingsSnapshot = Snapshot[dto.ClusterRoleBindingListItemDTO]
type CRDsSnapshot = Snapshot[dto.CRDListItemDTO]
type CustomResourcesSnapshot = Snapshot[dto.CustomResourceInstanceDTO]
type PodsSnapshot = Snapshot[dto.PodListItemDTO]
type DeploymentsSnapshot = Snapshot[dto.DeploymentListItemDTO]
type ServicesSnapshot = Snapshot[dto.ServiceListItemDTO]
type IngressesSnapshot = Snapshot[dto.IngressListItemDTO]
type NetworkPoliciesSnapshot = Snapshot[dto.NetworkPolicyDTO]
type PVCsSnapshot = Snapshot[dto.PersistentVolumeClaimDTO]
type ConfigMapsSnapshot = Snapshot[dto.ConfigMapDTO]
type SecretsSnapshot = Snapshot[dto.SecretDTO]
type ServiceAccountsSnapshot = Snapshot[dto.ServiceAccountListItemDTO]
type RolesSnapshot = Snapshot[dto.RoleListItemDTO]
type RoleBindingsSnapshot = Snapshot[dto.RoleBindingListItemDTO]
type HelmReleasesSnapshot = Snapshot[dto.HelmReleaseDTO]
type DaemonSetsSnapshot = Snapshot[dto.DaemonSetDTO]
type StatefulSetsSnapshot = Snapshot[dto.StatefulSetDTO]
type ReplicaSetsSnapshot = Snapshot[dto.ReplicaSetDTO]
type JobsSnapshot = Snapshot[dto.JobDTO]
type CronJobsSnapshot = Snapshot[dto.CronJobDTO]
type HPAsSnapshot = Snapshot[dto.HorizontalPodAutoscalerDTO]
type ResourceQuotasSnapshot = Snapshot[dto.ResourceQuotaDTO]
type LimitRangesSnapshot = Snapshot[dto.LimitRangeDTO]

// Metrics snapshots hold point-in-time usage samples from metrics.k8s.io.
// These snapshot cells are not persisted (no bbolt writes) because metric
// samples churn every ~15s and would accumulate unbounded storage while
// offering no recovery value after a restart.
type PodMetricsSnapshot = Snapshot[dto.PodMetricsDTO]
type NodeMetricsSnapshot = Snapshot[dto.NodeMetricsDTO]
