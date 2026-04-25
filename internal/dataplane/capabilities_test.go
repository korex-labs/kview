package dataplane

import (
	"errors"
	"testing"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func TestCapabilityRegistry_LearnReadResult_SuccessAndForbidden(t *testing.T) {
	reg := NewCapabilityRegistry()
	cluster := "cluster-1"

	// Successful read -> allowed, high confidence.
	reg.LearnReadResult(cluster, "", "namespaces", "", "list", CapabilityScopeCluster, nil)
	key := CapabilityKey{
		Cluster:  cluster,
		Resource: "namespaces",
		Verb:     "list",
		Scope:    CapabilityScopeCluster,
	}
	rec, ok := reg.Get(key)
	if !ok {
		t.Fatalf("expected record after success")
	}
	if rec.State != CapabilityStateAllowed {
		t.Fatalf("expected allowed after success, got %q", rec.State)
	}

	// Forbidden overrides with denied, high confidence.
	err := forbiddenErrorForTest()
	reg.LearnReadResult(cluster, "", "namespaces", "", "list", CapabilityScopeCluster, err)
	rec, ok = reg.Get(key)
	if !ok {
		t.Fatalf("expected record after forbidden")
	}
	if rec.State != CapabilityStateDenied {
		t.Fatalf("expected denied after forbidden, got %q", rec.State)
	}
	if rec.Confidence != CapabilityConfidenceHigh {
		t.Fatalf("expected high confidence for denied, got %q", rec.Confidence)
	}
}

func forbiddenErrorForTest() error {
	return apierrors.NewForbidden(
		schema.GroupResource{Group: "", Resource: "namespaces"},
		"",
		errors.New("forbidden"),
	)
}
