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
	if got := mostRecentAll(old, now); !got.Equal(now) {
		t.Fatalf("mostRecentAll: expected latest timestamp")
	}
	if got := minFreshnessAll(FreshnessClassHot, FreshnessClassWarm, FreshnessClassCold); got != FreshnessClassCold {
		t.Fatalf("minFreshnessAll: expected cold, got %q", got)
	}
	if got := maxDegradationAll(DegradationClassNone, DegradationClassMinor, DegradationClassSevere); got != DegradationClassSevere {
		t.Fatalf("maxDegradationAll: expected severe, got %q", got)
	}
}

func TestFirstHelpers(t *testing.T) {
	n := &NormalizedError{Class: NormalizedErrorClassProxyFailure}
	if got := firstNonNilNormalized(nil, n); got != n {
		t.Fatalf("expected first non-nil normalized error")
	}
	errA := errors.New("a")
	errB := errors.New("b")
	if got := firstError(nil, errA, errB); got != errA {
		t.Fatalf("expected first error")
	}
}
