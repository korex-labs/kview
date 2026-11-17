package dataplane

import (
	"errors"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func TestNamespaceSummaryProjection_DeniedSetsStateDenied(t *testing.T) {
	n := NormalizeError(apierrors.NewForbidden(schema.GroupResource{Group: "", Resource: "namespaces"}, "", errors.New("forbidden")))
	if n.Class != NormalizedErrorClassAccessDenied {
		t.Fatalf("expected AccessDenied, got %q", n.Class)
	}
}

func TestProjectionMetadataCombiners(t *testing.T) {
	now := time.Now().UTC()
	old := now.Add(-time.Minute)
	if got := ObservedAtFromSnapshots(
		SnapshotMetadata{ObservedAt: old},
		SnapshotMetadata{ObservedAt: now},
	); !got.Equal(now) {
		t.Fatalf("mostRecentAll: expected latest timestamp")
	}
	if got := WorstFreshness(FreshnessClassHot, FreshnessClassWarm, FreshnessClassCold); got != FreshnessClassCold {
		t.Fatalf("WorstFreshness: expected cold, got %q", got)
	}
	if got := WorstDegradation(DegradationClassNone, DegradationClassMinor, DegradationClassSevere); got != DegradationClassSevere {
		t.Fatalf("WorstDegradation: expected severe, got %q", got)
	}
}

func TestFirstHelpers(t *testing.T) {
	n := &NormalizedError{Class: NormalizedErrorClassProxyFailure}
	if got := FirstNonNilNormalizedError(nil, n); got != n {
		t.Fatalf("expected first non-nil normalized error")
	}
	errA := errors.New("a")
	errB := errors.New("b")
	if got := FirstError(nil, errA, errB); got != errA {
		t.Fatalf("expected first error")
	}
}

func TestNamespaceSummaryProjectionError_PreservesPartialRBAC(t *testing.T) {
	err := apierrors.NewForbidden(schema.GroupResource{Group: "rbac.authorization.k8s.io", Resource: "roles"}, "role", errors.New("forbidden"))
	if got := namespaceSummaryProjectionError(err, true); got != nil {
		t.Fatalf("expected usable partial namespace summary to avoid hard failure, got %v", got)
	}
}

func TestNamespaceSummaryProjectionError_FailsWithoutUsableSnapshot(t *testing.T) {
	err := errors.New("proxy unavailable")
	if got := namespaceSummaryProjectionError(err, false); got != err {
		t.Fatalf("expected hard failure without any usable snapshot, got %v", got)
	}
}

func TestNamespaceSummaryProjectionState_TransientAndProxyDegradedButUsable(t *testing.T) {
	tests := []struct {
		name  string
		nerr  *NormalizedError
		want  string
		items int
	}{
		{
			name:  "proxy partial",
			nerr:  &NormalizedError{Class: NormalizedErrorClassProxyFailure},
			want:  "partial_proxy",
			items: 2,
		},
		{
			name:  "transient degraded",
			nerr:  &NormalizedError{Class: NormalizedErrorClassTransient},
			want:  "degraded",
			items: 2,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := ProjectionCoarseState(tc.nerr, tc.items); got != tc.want {
				t.Fatalf("state: got %q want %q", got, tc.want)
			}
		})
	}
}

func TestNamespaceSummaryProjection_CustomResourcesCountAndProblems(t *testing.T) {
	now := time.Now().UTC()
	proj, err := buildNamespaceSummaryProjectionFromSnapshots(namespaceProjectionSnapshots{
		customResources: CustomResourcesSnapshot{
			Meta: SnapshotMetadata{ObservedAt: now, Freshness: FreshnessClassHot},
			Items: []dto.CustomResourceInstanceDTO{
				{Name: "ok", Kind: "Widget", Group: "example.com", Version: "v1", Resource: "widgets", SignalSeverity: "ok"},
				{Name: "stuck", Kind: "Widget", Group: "example.com", Version: "v1", Resource: "widgets", SignalSeverity: "warning", StatusSummary: "NotReady"},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := proj.Resources.Counts.CustomResources; got != 2 {
		t.Fatalf("custom resource count: got %d want 2", got)
	}
	if len(proj.Resources.CustomResourceKinds) != 1 || proj.Resources.CustomResourceKinds[0].Kind != "Widget" || proj.Resources.CustomResourceKinds[0].Count != 2 || proj.Resources.CustomResourceKinds[0].Warnings != 1 {
		t.Fatalf("custom resource kinds: %+v", proj.Resources.CustomResourceKinds)
	}
	if len(proj.Resources.Problematic) != 1 || proj.Resources.Problematic[0].Name != "stuck" {
		t.Fatalf("problematic custom resources: %+v", proj.Resources.Problematic)
	}
	if got := proj.Resources.Problematic[0]; got.Kind != "Widget" || got.Group != "example.com" || got.Version != "v1" || got.Resource != "widgets" {
		t.Fatalf("problematic custom resource identity: %+v", got)
	}
}

// Keep every source explicitly healthy: zero-value metadata can mask an omitted input.
func healthyNamespaceProjectionSnapshots(observedAt time.Time) namespaceProjectionSnapshots {
	var snaps namespaceProjectionSnapshots
	for _, meta := range []*SnapshotMetadata{
		&snaps.pods.Meta, &snaps.deps.Meta, &snaps.svcs.Meta, &snaps.ing.Meta,
		&snaps.networkPolicies.Meta, &snaps.pvcs.Meta, &snaps.cms.Meta, &snaps.secs.Meta,
		&snaps.ds.Meta, &snaps.sts.Meta, &snaps.rs.Meta, &snaps.jobs.Meta, &snaps.cj.Meta,
		&snaps.hpa.Meta, &snaps.sa.Meta, &snaps.roles.Meta, &snaps.roleBindings.Meta,
		&snaps.helm.Meta, &snaps.customResources.Meta, &snaps.rq.Meta, &snaps.lr.Meta,
	} {
		*meta = SnapshotMetadata{ObservedAt: observedAt, Freshness: FreshnessClassHot,
			Degradation: DegradationClassNone, Coverage: CoverageClassFull, Completeness: CompletenessClassComplete}
	}
	return snaps
}

func TestNamespaceSummaryProjection_NetworkPolicyMetadata(t *testing.T) {
	observedAt := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	for _, tc := range []struct {
		name        string
		freshness   FreshnessClass
		degradation DegradationClass
		policyTime  time.Time
	}{
		{"healthy empty", FreshnessClassHot, DegradationClassNone, observedAt},
		{"stale minor older", FreshnessClassStale, DegradationClassMinor, observedAt.Add(-time.Minute)},
		{"stale severe newest", FreshnessClassStale, DegradationClassSevere, observedAt.Add(time.Minute)},
		{"unknown severe zero timestamp", FreshnessClassUnknown, DegradationClassSevere, time.Time{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			snaps := healthyNamespaceProjectionSnapshots(observedAt)
			snaps.networkPolicies.Meta.Freshness = tc.freshness
			snaps.networkPolicies.Meta.Degradation = tc.degradation
			snaps.networkPolicies.Meta.ObservedAt = tc.policyTime
			projection, err := buildNamespaceSummaryProjectionFromSnapshots(snaps)
			if err != nil || projection.Err != nil {
				t.Fatalf("invented empty-source error: %v / %v", err, projection.Err)
			}
			wantTime := observedAt
			if tc.policyTime.After(wantTime) {
				wantTime = tc.policyTime
			}
			if projection.Meta.Freshness != tc.freshness || projection.Meta.Degradation != tc.degradation || !projection.Meta.ObservedAt.Equal(wantTime) {
				t.Fatalf("network policy metadata omitted: %+v", projection.Meta)
			}
			if projection.Meta.Coverage != CoverageClassPartial || projection.Meta.Completeness != CompletenessClassInexact {
				t.Fatalf("summary contract changed: %+v", projection.Meta)
			}
			meta := projection.Resources.Meta
			if meta.Freshness != string(tc.freshness) || meta.Degradation != string(tc.degradation) || meta.Coverage != "partial" || meta.Completeness != "inexact" || meta.State != "empty" {
				t.Fatalf("DTO metadata: %+v", meta)
			}
		})
	}
}

func TestNamespaceSummaryProjection_NetworkPolicyFailureAndErrorOrder(t *testing.T) {
	snaps := healthyNamespaceProjectionSnapshots(time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC))
	snaps.networkPolicies.Items = []dto.NetworkPolicyDTO{{Name: "fixture-policy"}}
	projection, err := buildNamespaceSummaryProjectionFromSnapshots(snaps)
	if err != nil || projection.Resources.Counts.NetworkPolicies != 1 || projection.Resources.Meta.State != "ok" {
		t.Fatalf("healthy policy-only projection: %+v / %v", projection, err)
	}
	policyError := errors.New("policy source unavailable")
	policyNormalized := &NormalizedError{Class: NormalizedErrorClassTransient}
	snaps.networkPoliciesErr = policyError
	snaps.networkPolicies.Err = policyNormalized
	snaps.networkPolicies.Meta.Freshness = FreshnessClassStale
	snaps.networkPolicies.Meta.Degradation = DegradationClassSevere
	projection, err = buildNamespaceSummaryProjectionFromSnapshots(snaps)
	if err != nil || projection.Err != policyNormalized || projection.Resources.Meta.State != "degraded" || projection.Resources.Counts.NetworkPolicies != 0 {
		t.Fatalf("healthy empty siblings must preserve partial result: %+v / %v", projection, err)
	}
	if projection.Meta.Freshness != FreshnessClassStale || projection.Meta.Degradation != DegradationClassSevere {
		t.Fatalf("failed policy metadata: %+v", projection.Meta)
	}
	// Input ordering is stable, not completion order or severity order.
	snaps.pvcs.Err = &NormalizedError{Class: NormalizedErrorClassAccessDenied}
	projection, _ = buildNamespaceSummaryProjectionFromSnapshots(snaps)
	if projection.Err != policyNormalized {
		t.Fatalf("PVC error displaced preceding policy error")
	}
	snaps.ing.Err = &NormalizedError{Class: NormalizedErrorClassProxyFailure}
	projection, _ = buildNamespaceSummaryProjectionFromSnapshots(snaps)
	if projection.Err != snaps.ing.Err {
		t.Fatalf("policy error displaced preceding ingress error")
	}
	first := errors.New("pods unavailable")
	for _, sourceErr := range []*error{
		&snaps.podsErr, &snaps.depsErr, &snaps.svcsErr, &snaps.ingErr, &snaps.pvcsErr,
		&snaps.cmsErr, &snaps.secsErr, &snaps.dsErr, &snaps.stsErr, &snaps.rsErr,
		&snaps.jobsErr, &snaps.cjErr, &snaps.hpaErr, &snaps.saErr, &snaps.rolesErr,
		&snaps.roleBindingsErr, &snaps.helmErr, &snaps.customResourcesErr, &snaps.rqErr, &snaps.lrErr,
	} {
		*sourceErr = errors.New("other source unavailable")
	}
	snaps.podsErr = first
	_, err = buildNamespaceSummaryProjectionFromSnapshots(snaps)
	if err != first {
		t.Fatalf("first hard error changed: %v", err)
	}
	// A healthy empty policy source is sufficient to keep a usable partial result.
	snaps.networkPoliciesErr = nil
	snaps.networkPolicies.Err = nil
	snaps.networkPolicies.Items = nil
	_, err = buildNamespaceSummaryProjectionFromSnapshots(snaps)
	if err != nil {
		t.Fatalf("healthy empty policy source not usable: %v", err)
	}
}
