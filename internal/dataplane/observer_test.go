package dataplane

import "testing"

func TestObserverStateForError_Classifications(t *testing.T) {
	cases := []struct {
		class     NormalizedErrorClass
		expected  ObserverState
	}{
		{NormalizedErrorClassAccessDenied, ObserverStateBlockedByAccess},
		{NormalizedErrorClassUnauthorized, ObserverStateBlockedByAccess},
		{NormalizedErrorClassRateLimited, ObserverStateBackoff},
		{NormalizedErrorClassTimeout, ObserverStateBackoff},
		{NormalizedErrorClassTransient, ObserverStateBackoff},
		{NormalizedErrorClassProxyFailure, ObserverStateBackoff},
		{NormalizedErrorClassConnectivity, ObserverStateBackoff},
		{NormalizedErrorClassUnknown, ObserverStateDegraded},
	}

	for _, tc := range cases {
		got := observerStateForError(NormalizedError{Class: tc.class})
		if got != tc.expected {
			t.Fatalf("class %q: expected %q, got %q", tc.class, tc.expected, got)
		}
	}
}

