package dataplane

import (
	"sync"
	"testing"
)

func TestObserverStateForError_Classifications(t *testing.T) {
	cases := []struct {
		class    NormalizedErrorClass
		expected ObserverState
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

func TestSetObserverStateInvalidKindDoesNotStartLifecycle(t *testing.T) {
	plane := &clusterPlane{name: "ctx"}

	plane.setObserverState(observerKind("invalid"), ObserverStateActive, nil)

	plane.obsMu.Lock()
	if plane.observers != nil {
		plane.obsMu.Unlock()
		t.Fatalf("invalid observer kind initialized lifecycle state: %+v", plane.observers)
	}
	plane.obsMu.Unlock()

	plane.setObserverState(observerKindNamespaces, ObserverStateActive, nil)
	plane.setObserverState(observerKind("invalid"), ObserverStateDegraded, nil)
	plane.obsMu.Lock()
	defer plane.obsMu.Unlock()
	if plane.observers == nil || plane.observers.namespacesState != ObserverStateActive {
		t.Fatalf("invalid observer kind changed valid lifecycle state: %+v", plane.observers)
	}
}

func TestSetObserverStateValidConcurrentUpdates(t *testing.T) {
	plane := &clusterPlane{name: "ctx"}
	kinds := []observerKind{observerKindNamespaces, observerKindNodes, observerKindPods, observerKindDeployments}
	var wg sync.WaitGroup
	for _, kind := range kinds {
		kind := kind
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 1000; i++ {
				plane.setObserverState(kind, ObserverStateActive, nil)
			}
		}()
	}
	wg.Wait()

	plane.obsMu.Lock()
	defer plane.obsMu.Unlock()
	if plane.observers == nil {
		t.Fatal("valid observer updates did not initialize lifecycle state")
	}
	if plane.observers.namespacesState != ObserverStateActive ||
		plane.observers.nodesState != ObserverStateActive ||
		plane.observers.podsState != ObserverStateActive ||
		plane.observers.deployState != ObserverStateActive {
		t.Fatalf("valid observer states not updated: %+v", plane.observers)
	}
}
