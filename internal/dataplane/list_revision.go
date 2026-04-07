package dataplane

import (
	"context"
	"strconv"
	"strings"
	"time"
)

// ListSnapshotRevisionEnvelope is a compact JSON body for cheap list revision polling.
type ListSnapshotRevisionEnvelope struct {
	Active    string `json:"active"`
	Kind      string `json:"kind"`
	Namespace string `json:"namespace,omitempty"`
	Revision  string `json:"revision"`
	Known     bool   `json:"known"`
	Observed  string `json:"observed,omitempty"`
	Freshness string `json:"freshness,omitempty"`
	State     string `json:"state,omitempty"`
}

// ListRevisionKindNeedsNamespace is true for namespaced list kinds.
func ListRevisionKindNeedsNamespace(k ResourceKind) bool {
	switch k {
	case ResourceKindNamespaces:
		return false
	default:
		return true
	}
}

// ParseListRevisionResourceKind maps API query values to scheduler resource kinds.
func ParseListRevisionResourceKind(s string) (ResourceKind, bool) {
	switch strings.TrimSpace(s) {
	case string(ResourceKindNamespaces):
		return ResourceKindNamespaces, true
	case string(ResourceKindPods):
		return ResourceKindPods, true
	case string(ResourceKindDeployments):
		return ResourceKindDeployments, true
	case string(ResourceKindServices):
		return ResourceKindServices, true
	case string(ResourceKindIngresses):
		return ResourceKindIngresses, true
	case string(ResourceKindPVCs):
		return ResourceKindPVCs, true
	case string(ResourceKindConfigMaps):
		return ResourceKindConfigMaps, true
	case string(ResourceKindSecrets):
		return ResourceKindSecrets, true
	case string(ResourceKindServiceAccounts):
		return ResourceKindServiceAccounts, true
	case string(ResourceKindRoles):
		return ResourceKindRoles, true
	case string(ResourceKindRoleBindings):
		return ResourceKindRoleBindings, true
	case string(ResourceKindHelmReleases):
		return ResourceKindHelmReleases, true
	case string(ResourceKindDaemonSets):
		return ResourceKindDaemonSets, true
	case string(ResourceKindStatefulSets):
		return ResourceKindStatefulSets, true
	case string(ResourceKindReplicaSets):
		return ResourceKindReplicaSets, true
	case string(ResourceKindJobs):
		return ResourceKindJobs, true
	case string(ResourceKindCronJobs):
		return ResourceKindCronJobs, true
	default:
		return "", false
	}
}

func fillListRevisionEnvFromSnap[I any](env *ListSnapshotRevisionEnvelope, snap Snapshot[I], nerr *NormalizedError) {
	env.Known = true
	env.Revision = strconv.FormatUint(snap.Meta.Revision, 10)
	if !snap.Meta.ObservedAt.IsZero() {
		env.Observed = snap.Meta.ObservedAt.UTC().Format(time.RFC3339Nano)
	}
	env.Freshness = string(snap.Meta.Freshness)
	env.State = CoarseState(nerr, len(snap.Items))
}

func (p *clusterPlane) listSnapshotRevision(kind ResourceKind, namespace string) ListSnapshotRevisionEnvelope {
	env := ListSnapshotRevisionEnvelope{Kind: string(kind), Namespace: namespace, Revision: "0"}
	switch kind {
	case ResourceKindNamespaces:
		snap, ok := peekClusterSnapshot(&p.nsStore)
		if !ok {
			return env
		}
		fillListRevisionEnvFromSnap(&env, snap, snap.Err)
	case ResourceKindPods:
		snap, ok := peekNamespacedSnapshot(&p.podsStore, namespace)
		if !ok {
			return env
		}
		fillListRevisionEnvFromSnap(&env, snap, snap.Err)
	case ResourceKindDeployments:
		snap, ok := peekNamespacedSnapshot(&p.depsStore, namespace)
		if !ok {
			return env
		}
		fillListRevisionEnvFromSnap(&env, snap, snap.Err)
	case ResourceKindServices:
		snap, ok := peekNamespacedSnapshot(&p.svcsStore, namespace)
		if !ok {
			return env
		}
		fillListRevisionEnvFromSnap(&env, snap, snap.Err)
	case ResourceKindIngresses:
		snap, ok := peekNamespacedSnapshot(&p.ingStore, namespace)
		if !ok {
			return env
		}
		fillListRevisionEnvFromSnap(&env, snap, snap.Err)
	case ResourceKindPVCs:
		snap, ok := peekNamespacedSnapshot(&p.pvcsStore, namespace)
		if !ok {
			return env
		}
		fillListRevisionEnvFromSnap(&env, snap, snap.Err)
	case ResourceKindConfigMaps:
		snap, ok := peekNamespacedSnapshot(&p.cmsStore, namespace)
		if !ok {
			return env
		}
		fillListRevisionEnvFromSnap(&env, snap, snap.Err)
	case ResourceKindSecrets:
		snap, ok := peekNamespacedSnapshot(&p.secsStore, namespace)
		if !ok {
			return env
		}
		fillListRevisionEnvFromSnap(&env, snap, snap.Err)
	case ResourceKindServiceAccounts:
		snap, ok := peekNamespacedSnapshot(&p.saStore, namespace)
		if !ok {
			return env
		}
		fillListRevisionEnvFromSnap(&env, snap, snap.Err)
	case ResourceKindRoles:
		snap, ok := peekNamespacedSnapshot(&p.rolesStore, namespace)
		if !ok {
			return env
		}
		fillListRevisionEnvFromSnap(&env, snap, snap.Err)
	case ResourceKindRoleBindings:
		snap, ok := peekNamespacedSnapshot(&p.roleBindingsStore, namespace)
		if !ok {
			return env
		}
		fillListRevisionEnvFromSnap(&env, snap, snap.Err)
	case ResourceKindHelmReleases:
		snap, ok := peekNamespacedSnapshot(&p.helmReleasesStore, namespace)
		if !ok {
			return env
		}
		fillListRevisionEnvFromSnap(&env, snap, snap.Err)
	case ResourceKindDaemonSets:
		snap, ok := peekNamespacedSnapshot(&p.dsStore, namespace)
		if !ok {
			return env
		}
		fillListRevisionEnvFromSnap(&env, snap, snap.Err)
	case ResourceKindStatefulSets:
		snap, ok := peekNamespacedSnapshot(&p.stsStore, namespace)
		if !ok {
			return env
		}
		fillListRevisionEnvFromSnap(&env, snap, snap.Err)
	case ResourceKindReplicaSets:
		snap, ok := peekNamespacedSnapshot(&p.rsStore, namespace)
		if !ok {
			return env
		}
		fillListRevisionEnvFromSnap(&env, snap, snap.Err)
	case ResourceKindJobs:
		snap, ok := peekNamespacedSnapshot(&p.jobsStore, namespace)
		if !ok {
			return env
		}
		fillListRevisionEnvFromSnap(&env, snap, snap.Err)
	case ResourceKindCronJobs:
		snap, ok := peekNamespacedSnapshot(&p.cjStore, namespace)
		if !ok {
			return env
		}
		fillListRevisionEnvFromSnap(&env, snap, snap.Err)
	default:
		return env
	}
	return env
}

// ListSnapshotRevision returns the current revision for a dataplane list cell without scheduling fetches.
func (m *manager) ListSnapshotRevision(ctx context.Context, clusterName string, kind ResourceKind, namespace string) (ListSnapshotRevisionEnvelope, error) {
	planeAny, err := m.PlaneForCluster(ctx, clusterName)
	if err != nil {
		return ListSnapshotRevisionEnvelope{}, err
	}
	env := planeAny.(*clusterPlane).listSnapshotRevision(kind, namespace)
	env.Active = clusterName
	return env, nil
}
