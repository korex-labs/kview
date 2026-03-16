package dataplane

import (
	"context"
	"fmt"
	"time"

	"kview/internal/runtime"
)

type observerKind string

const (
	observerKindNamespaces  observerKind = "namespaces"
	observerKindNodes       observerKind = "nodes"
	observerKindPods        observerKind = "pods"
	observerKindDeployments observerKind = "deployments"
)

type clusterObservers struct {
	cluster string

	namespacesState ObserverState
	nodesState      ObserverState
	podsState       ObserverState
	deployState     ObserverState
}

func (m *manager) log(level runtime.LogLevel, msg string) {
	if m.rt == nil {
		return
	}
	m.rt.Log(level, "dataplane", msg)
}

func (m *manager) EnsureObservers(ctx context.Context, clusterName string) {
	m.obsMu.Lock()
	if _, ok := m.observers[clusterName]; ok {
		m.obsMu.Unlock()
		return
	}
	co := &clusterObservers{cluster: clusterName}
	m.observers[clusterName] = co
	m.obsMu.Unlock()

	go m.runNamespaceObserver(ctx, co)
	go m.runNodeObserver(ctx, co)
	// Pods and deployments observers will be wired to scope in later steps.
}

func (m *manager) setObserverState(co *clusterObservers, kind observerKind, state ObserverState) {
	var prev ObserverState

	switch kind {
	case observerKindNamespaces:
		prev = co.namespacesState
		co.namespacesState = state
	case observerKindNodes:
		prev = co.nodesState
		co.nodesState = state
	case observerKindPods:
		prev = co.podsState
		co.podsState = state
	case observerKindDeployments:
		prev = co.deployState
		co.deployState = state
	}

	if prev != state {
		m.log(runtime.LogLevelInfo, fmt.Sprintf("observer %s for cluster %s transitioned %s -> %s", kind, co.cluster, prev, state))
	}
}

func observerStateForError(n NormalizedError) ObserverState {
	switch n.Class {
	case NormalizedErrorClassAccessDenied, NormalizedErrorClassUnauthorized:
		return ObserverStateBlockedByAccess
	case NormalizedErrorClassRateLimited,
		NormalizedErrorClassTimeout,
		NormalizedErrorClassTransient,
		NormalizedErrorClassProxyFailure,
		NormalizedErrorClassConnectivity:
		return ObserverStateBackoff
	default:
		return ObserverStateDegraded
	}
}

func (m *manager) runNamespaceObserver(ctx context.Context, co *clusterObservers) {
	clusterName := co.cluster
	interval := 30 * time.Second

	m.setObserverState(co, observerKindNamespaces, ObserverStateStarting)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			m.setObserverState(co, observerKindNamespaces, ObserverStateStopped)
			return
		case <-ticker.C:
			// Drive snapshot refresh via scheduler-mediated read.
			snap, err := m.NamespacesSnapshot(ctx, clusterName)
			if err != nil {
				if snap.Err != nil {
					state := observerStateForError(*snap.Err)
					m.setObserverState(co, observerKindNamespaces, state)
				} else {
					m.setObserverState(co, observerKindNamespaces, ObserverStateUncertain)
				}
				continue
			}

			_ = snap // populated cache is used by HTTP handlers
			m.setObserverState(co, observerKindNamespaces, ObserverStateActive)
		}
	}
}

func (m *manager) runNodeObserver(ctx context.Context, co *clusterObservers) {
	clusterName := co.cluster
	baseInterval := 60 * time.Second
	interval := baseInterval

	m.setObserverState(co, observerKindNodes, ObserverStateStarting)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			m.setObserverState(co, observerKindNodes, ObserverStateStopped)
			return
		case <-ticker.C:
			snap, err := m.NodesSnapshot(ctx, clusterName)
			if err != nil {
				if snap.Err != nil {
					state := observerStateForError(*snap.Err)
					m.setObserverState(co, observerKindNodes, state)

					// Simple backoff when access is blocked or upstream is degraded.
					switch state {
					case ObserverStateBlockedByAccess, ObserverStateBackoff:
						if interval < 5*baseInterval {
							interval *= 2
							ticker.Reset(interval)
							m.log(runtime.LogLevelInfo, fmt.Sprintf("node observer for cluster %s entering backoff (%s)", clusterName, interval))
						}
					}
				} else {
					m.setObserverState(co, observerKindNodes, ObserverStateUncertain)
				}
				continue
			}

			_ = snap
			interval = baseInterval
			ticker.Reset(interval)
			m.setObserverState(co, observerKindNodes, ObserverStateActive)
		}
	}
}

