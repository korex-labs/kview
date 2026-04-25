package dataplane

import (
	"context"
	"errors"
	"net"
	"net/url"
	"strings"
	"syscall"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

// NormalizeError classifies a raw upstream error into a NormalizedError suitable
// for capability learning and plane health decisions.
func NormalizeError(err error) NormalizedError {
	if err == nil {
		return NormalizedError{Class: NormalizedErrorClassUnknown}
	}

	if errors.Is(err, context.Canceled) {
		return NormalizedError{
			UpstreamMessage: err.Error(),
			Class:           NormalizedErrorClassCanceled,
			Consequence:     ErrorConsequenceHintRetryable,
		}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return NormalizedError{
			UpstreamMessage: err.Error(),
			Class:           NormalizedErrorClassTimeout,
			Consequence:     ErrorConsequenceHintRetryable,
		}
	}

	// Kubernetes-status aware classification.
	var statusErr *apierrors.StatusError
	if errors.As(err, &statusErr) {
		status := statusErr.ErrStatus
		code := int(status.Code)
		reason := status.Reason

		switch {
		case code == 401 || reason == "Unauthorized":
			return NormalizedError{
				UpstreamMessage: err.Error(),
				Class:           NormalizedErrorClassUnauthorized,
				Consequence:     ErrorConsequenceHintPermissions,
			}
		case code == 403 || reason == "Forbidden":
			return NormalizedError{
				UpstreamMessage: err.Error(),
				Class:           NormalizedErrorClassAccessDenied,
				Consequence:     ErrorConsequenceHintPermissions,
			}
		case code == 404 || reason == "NotFound":
			return NormalizedError{
				UpstreamMessage: err.Error(),
				Class:           NormalizedErrorClassNotFound,
				Consequence:     ErrorConsequenceHintUserAction,
			}
		case code == 409 || reason == "Conflict":
			return NormalizedError{
				UpstreamMessage: err.Error(),
				Class:           NormalizedErrorClassConflict,
				Consequence:     ErrorConsequenceHintUserAction,
			}
		case code == 429 || reason == "TooManyRequests":
			return NormalizedError{
				UpstreamMessage: err.Error(),
				Class:           NormalizedErrorClassRateLimited,
				Consequence:     ErrorConsequenceHintRetryable,
			}
		case code >= 500 && code < 600:
			// Treat raw 5xx as transient or proxy issues rather than hard denial.
			class := NormalizedErrorClassTransient
			consequence := ErrorConsequenceHintRetryable
			if isLikelyProxyFailure(status.Details) || looksLikeProxyError(err) {
				class = NormalizedErrorClassProxyFailure
				consequence = ErrorConsequenceHintEnvironment
			}
			return NormalizedError{
				UpstreamMessage: err.Error(),
				Class:           class,
				Consequence:     consequence,
			}
		}
	}

	// Network-level connectivity / proxy issues.
	var netErr net.Error
	if errors.As(err, &netErr) {
		if netErr.Timeout() {
			return NormalizedError{
				UpstreamMessage: err.Error(),
				Class:           NormalizedErrorClassTimeout,
				Consequence:     ErrorConsequenceHintRetryable,
			}
		}
		return NormalizedError{
			UpstreamMessage: err.Error(),
			Class:           NormalizedErrorClassConnectivity,
			Consequence:     ErrorConsequenceHintEnvironment,
		}
	}

	var opErr *net.OpError
	if errors.As(err, &opErr) {
		if errors.Is(opErr.Err, syscall.ECONNREFUSED) || errors.Is(opErr.Err, syscall.ECONNRESET) {
			return NormalizedError{
				UpstreamMessage: err.Error(),
				Class:           NormalizedErrorClassProxyFailure,
				Consequence:     ErrorConsequenceHintEnvironment,
			}
		}
	}

	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		if urlErr.Timeout() {
			return NormalizedError{
				UpstreamMessage: err.Error(),
				Class:           NormalizedErrorClassTimeout,
				Consequence:     ErrorConsequenceHintRetryable,
			}
		}
		if strings.Contains(strings.ToLower(urlErr.Error()), "proxy") {
			return NormalizedError{
				UpstreamMessage: err.Error(),
				Class:           NormalizedErrorClassProxyFailure,
				Consequence:     ErrorConsequenceHintEnvironment,
			}
		}
	}

	// Fallback classification.
	return NormalizedError{
		UpstreamMessage: err.Error(),
		Class:           NormalizedErrorClassUnknown,
		Consequence:     ErrorConsequenceHintUserAction,
	}
}

func isLikelyProxyFailure(_ interface{}) bool {
	// Keep this helper for potential future expansion with richer kube error details.
	return false
}

func looksLikeProxyError(err error) bool {
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "proxy") ||
		strings.Contains(msg, "tunnel connection failed") ||
		strings.Contains(msg, "connectex") ||
		strings.Contains(msg, "connection refused")
}
