package dataplane

import "testing"

func TestCoarseState(t *testing.T) {
	cases := []struct {
		name     string
		err      *NormalizedError
		items    int
		expected string
	}{
		{name: "denied", err: &NormalizedError{Class: NormalizedErrorClassAccessDenied}, expected: "denied"},
		{name: "proxy", err: &NormalizedError{Class: NormalizedErrorClassProxyFailure}, expected: "partial_proxy"},
		{name: "degraded", err: &NormalizedError{Class: NormalizedErrorClassTimeout}, expected: "degraded"},
		{name: "empty", items: 0, expected: "empty"},
		{name: "ok", items: 2, expected: "ok"},
	}
	for _, tc := range cases {
		got := CoarseState(tc.err, tc.items)
		if got != tc.expected {
			t.Fatalf("%s: expected %q, got %q", tc.name, tc.expected, got)
		}
	}
}
