package dataplane

// CoarseState maps normalized errors and item counts to a truthful coarse state.
func CoarseState(err *NormalizedError, itemsCount int) string {
	if err != nil {
		switch err.Class {
		case NormalizedErrorClassAccessDenied, NormalizedErrorClassUnauthorized:
			return "denied"
		case NormalizedErrorClassProxyFailure, NormalizedErrorClassConnectivity:
			return "partial_proxy"
		case NormalizedErrorClassRateLimited, NormalizedErrorClassTimeout, NormalizedErrorClassTransient:
			return "degraded"
		default:
			return "degraded"
		}
	}
	if itemsCount == 0 {
		return "empty"
	}
	return "ok"
}
