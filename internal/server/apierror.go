package server

import (
	"context"
	"errors"
	"net/http"
	"strings"

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
// Envelope: mutations use {"error": {"code", "message"}}; simple errors use {"message": "..."}.
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

// mapHelmError maps a Helm operation error to an HTTP status and APIError.
// Helm errors are not k8s API errors so we classify by message content.
func mapHelmError(err error) (int, *APIError) {
	// Try kube error mapping first (Helm may wrap k8s errors).
	if apierrors.IsForbidden(err) {
		return http.StatusForbidden, &APIError{Code: ErrCodeForbidden, Message: err.Error()}
	}
	if apierrors.IsNotFound(err) {
		return http.StatusNotFound, &APIError{Code: ErrCodeNotFound, Message: err.Error()}
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return http.StatusGatewayTimeout, &APIError{Code: ErrCodeTimeout, Message: err.Error()}
	}

	msg := err.Error()
	lower := strings.ToLower(msg)

	// Classify user-input problems as VALIDATION.
	if strings.Contains(lower, "not found") && !strings.Contains(lower, "release") {
		return http.StatusBadRequest, &APIError{Code: ErrCodeValidation, Message: msg}
	}
	if strings.Contains(lower, "invalid") ||
		strings.Contains(lower, "invalid valuesyaml") ||
		strings.Contains(lower, "locate chart") ||
		strings.Contains(lower, "load chart") ||
		strings.Contains(lower, "no chart name") ||
		strings.Contains(lower, "chart not found") {
		return http.StatusBadRequest, &APIError{Code: ErrCodeValidation, Message: msg}
	}

	// "release: not found" from Helm uninstall/upgrade.
	if strings.Contains(lower, "not found") {
		return http.StatusNotFound, &APIError{Code: ErrCodeNotFound, Message: msg}
	}

	// "cannot re-use" from Helm install when release already exists.
	if strings.Contains(lower, "cannot re-use") {
		return http.StatusConflict, &APIError{Code: ErrCodeConflict, Message: msg}
	}

	// Forbidden patterns in Helm error messages.
	if strings.Contains(lower, "forbidden") || strings.Contains(lower, "is forbidden") {
		return http.StatusForbidden, &APIError{Code: ErrCodeForbidden, Message: msg}
	}

	return http.StatusInternalServerError, &APIError{Code: ErrCodeInternal, Message: msg}
}
