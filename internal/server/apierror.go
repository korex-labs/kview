package server

import (
	"context"
	"errors"
	"net/http"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

// Error codes for structured mutation error responses.
const (
	ErrCodeForbidden  = "FORBIDDEN"
	ErrCodeNotFound   = "NOT_FOUND"
	ErrCodeConflict   = "CONFLICT"
	ErrCodeTimeout    = "TIMEOUT"
	ErrCodeValidation = "VALIDATION"
	ErrCodeInternal   = "INTERNAL"
)

// APIError is the structured error type returned by mutation endpoints.
type APIError struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

// mapKubeError maps a Kubernetes API error to an HTTP status and APIError.
func mapKubeError(err error) (int, *APIError) {
	if errors.Is(err, context.DeadlineExceeded) {
		return http.StatusGatewayTimeout, &APIError{Code: ErrCodeTimeout, Message: err.Error()}
	}
	if errors.Is(err, context.Canceled) {
		return http.StatusGatewayTimeout, &APIError{Code: ErrCodeTimeout, Message: err.Error()}
	}

	switch {
	case apierrors.IsForbidden(err):
		return http.StatusForbidden, &APIError{Code: ErrCodeForbidden, Message: err.Error()}
	case apierrors.IsNotFound(err):
		return http.StatusNotFound, &APIError{Code: ErrCodeNotFound, Message: err.Error()}
	case apierrors.IsConflict(err):
		return http.StatusConflict, &APIError{Code: ErrCodeConflict, Message: err.Error()}
	case apierrors.IsTimeout(err):
		return http.StatusGatewayTimeout, &APIError{Code: ErrCodeTimeout, Message: err.Error()}
	default:
		return http.StatusInternalServerError, &APIError{Code: ErrCodeInternal, Message: err.Error()}
	}
}

// validationError creates an APIError for input validation failures.
func validationError(msg string) *APIError {
	return &APIError{Code: ErrCodeValidation, Message: msg}
}
