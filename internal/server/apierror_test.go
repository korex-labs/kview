package server

import (
	"context"
	"errors"
	"net/http"
	"testing"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func Test_validationError(t *testing.T) {
	err := validationError("bad input")
	if err == nil {
		t.Fatal("validationError returned nil")
	}
	if err.Code != ErrCodeValidation {
		t.Errorf("Code: got %q, want %q", err.Code, ErrCodeValidation)
	}
	if err.Message != "bad input" {
		t.Errorf("Message: got %q, want %q", err.Message, "bad input")
	}
}

func Test_mapKubeError(t *testing.T) {
	tests := []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{
			name:   "deadline exceeded",
			err:    context.DeadlineExceeded,
			status: http.StatusGatewayTimeout,
			code:   ErrCodeTimeout,
		},
		{
			name:   "canceled",
			err:    context.Canceled,
			status: http.StatusGatewayTimeout,
			code:   ErrCodeTimeout,
		},
		{
			name:   "forbidden",
			err:    apierrors.NewForbidden(schema.GroupResource{}, "foo", nil),
			status: http.StatusForbidden,
			code:   ErrCodeForbidden,
		},
		{
			name:   "not found",
			err:    apierrors.NewNotFound(schema.GroupResource{}, "bar"),
			status: http.StatusNotFound,
			code:   ErrCodeNotFound,
		},
		{
			name:   "conflict",
			err:    apierrors.NewConflict(schema.GroupResource{}, "baz", nil),
			status: http.StatusConflict,
			code:   ErrCodeConflict,
		},
		{
			name:   "generic",
			err:    apierrors.NewGenericServerResponse(500, "GET", schema.GroupResource{}, "qux", "internal", 0, true),
			status: http.StatusInternalServerError,
			code:   ErrCodeInternal,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, apiErr := mapKubeError(tt.err)
			if status != tt.status {
				t.Errorf("status: got %d, want %d", status, tt.status)
			}
			if apiErr == nil {
				t.Fatal("mapKubeError returned nil APIError")
			}
			if apiErr.Code != tt.code {
				t.Errorf("Code: got %q, want %q", apiErr.Code, tt.code)
			}
		})
	}
}

func Test_mapKubeError_Timeout(t *testing.T) {
	err := apierrors.NewTimeoutError("timed out", 0)
	status, apiErr := mapKubeError(err)
	if status != http.StatusGatewayTimeout {
		t.Errorf("status: got %d, want %d", status, http.StatusGatewayTimeout)
	}
	if apiErr == nil || apiErr.Code != ErrCodeTimeout {
		t.Errorf("Code: got %v, want %q", apiErr, ErrCodeTimeout)
	}
}

func Test_mapHelmError(t *testing.T) {
	// k8s errors are passed through
	err := apierrors.NewNotFound(schema.GroupResource{Resource: "pods"}, "mypod")
	status, apiErr := mapHelmError(err)
	if status != http.StatusNotFound || apiErr.Code != ErrCodeNotFound {
		t.Errorf("mapHelmError(k8s NotFound): got %d %q", status, apiErr.Code)
	}

	// context errors
	status, apiErr = mapHelmError(context.DeadlineExceeded)
	if status != http.StatusGatewayTimeout || apiErr.Code != ErrCodeTimeout {
		t.Errorf("mapHelmError(DeadlineExceeded): got %d %q", status, apiErr.Code)
	}
}

func Test_mapHelmError_MessagePatterns(t *testing.T) {
	tests := []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{name: "release not found", err: errors.New("release: not found"), status: http.StatusNotFound, code: ErrCodeNotFound},
		{name: "cannot re-use", err: errors.New("cannot re-use release name"), status: http.StatusConflict, code: ErrCodeConflict},
		{name: "forbidden", err: errors.New("is forbidden"), status: http.StatusForbidden, code: ErrCodeForbidden},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, apiErr := mapHelmError(tt.err)
			if status != tt.status || apiErr.Code != tt.code {
				t.Errorf("mapHelmError: got %d %q, want %d %q", status, apiErr.Code, tt.status, tt.code)
			}
		})
	}
}
