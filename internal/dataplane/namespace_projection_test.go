package dataplane

import (
	"errors"
	"testing"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// fakeManagerMinimal provides just enough for NamespaceSummaryProjection tests.
type fakeManagerMinimal struct {
	manager
}

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
