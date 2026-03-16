package dataplane

import (
	"context"
	"errors"
	"testing"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func TestNormalizeError_ClassifiesForbiddenAsAccessDenied(t *testing.T) {
	err := apierrors.NewForbidden(
		schema.GroupResource{Group: "", Resource: "nodes"},
		"",
		errors.New("forbidden"),
	)

	n := NormalizeError(err)
	if n.Class != NormalizedErrorClassAccessDenied {
		t.Fatalf("expected AccessDenied, got %q", n.Class)
	}
}

func TestNormalizeError_TimeoutAndCanceled(t *testing.T) {
	n := NormalizeError(context.DeadlineExceeded)
	if n.Class != NormalizedErrorClassTimeout {
		t.Fatalf("expected Timeout, got %q", n.Class)
	}

	n = NormalizeError(context.Canceled)
	if n.Class != NormalizedErrorClassCanceled {
		t.Fatalf("expected Canceled, got %q", n.Class)
	}
}

