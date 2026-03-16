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
	namespacesState ObserverState
	nodesState      ObserverState
	podsState       ObserverState
	deployState     ObserverState
}

func (p *clusterPlane) setObserverState(kind observerKind, state ObserverState, rt runtime.RuntimeManager) {
	var prev ObserverState

	switch kind {
	case observerKindNamespaces:
		prev = p.observers.namespacesState
		p.observers.namespacesState = state
	case observerKindNodes:
		prev = p.observers.nodesState
		p.observers.nodesState = state
	case observerKindPods:
		prev = p.observers.podsState
		p.observers.podsState = state
	case observerKindDeployments:
		prev = p.observers.deployState
		p.observers.deployState = state
	}

	if prev != state {
		if rt != nil {
			rt.Log(runtime.LogLevelInfo, "dataplane",
				fmt.Sprintf("observer %s for cluster %s transitioned %s -> %s", kind, p.name, prev, state))
		}
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

func (p *clusterPlane) EnsureObservers(ctx context.Context, sched *simpleScheduler, clients ClientsProvider, rt runtime.RuntimeManager) {
	p.obsMu.Lock()
	if p.observers != nil {
		p.obsMu.Unlock()
		return
	}
	p.observers = &clusterObservers{}
	p.obsMu.Unlock()

	go p.runNamespaceObserver(ctx, sched, clients, rt)
	go p.runNodeObserver(ctx, sched, clients, rt)
}

func (p *clusterPlane) runNamespaceObserver(ctx context.Context, sched *simpleScheduler, clients ClientsProvider, rt runtime.RuntimeManager) {
	interval := 30 * time.Second

	p.setObserverState(observerKindNamespaces, ObserverStateStarting, rt)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			p.setObserverState(observerKindNamespaces, ObserverStateStopped, rt)
			return
		case <-ticker.C:
			// Drive snapshot refresh via scheduler-mediated read.
			snap, err := p.NamespacesSnapshot(ctx, sched, clients)
			if err != nil {
				if snap.Err != nil {
					state := observerStateForError(*snap.Err)
					p.setObserverState(observerKindNamespaces, state, rt)
				} else {
					p.setObserverState(observerKindNamespaces, ObserverStateUncertain, rt)
				}
				continue
			}

			_ = snap
			p.setObserverState(observerKindNamespaces, ObserverStateActive, rt)
		}
	}
}

func (p *clusterPlane) runNodeObserver(ctx context.Context, sched *simpleScheduler, clients ClientsProvider, rt runtime.RuntimeManager) {
	baseInterval := 60 * time.Second
	interval := baseInterval

	p.setObserverState(observerKindNodes, ObserverStateStarting, rt)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			p.setObserverState(observerKindNodes, ObserverStateStopped, rt)
			return
		case <-ticker.C:
			snap, err := p.NodesSnapshot(ctx, sched, clients)
			if err != nil {
				if snap.Err != nil {
					state := observerStateForError(*snap.Err)
					p.setObserverState(observerKindNodes, state, rt)

					// Simple backoff when access is blocked or upstream is degraded.
					switch state {
					case ObserverStateBlockedByAccess, ObserverStateBackoff:
						if interval < 5*baseInterval {
							interval *= 2
							ticker.Reset(interval)
							if rt != nil {
								rt.Log(runtime.LogLevelInfo, "dataplane",
									fmt.Sprintf("node observer for cluster %s entering backoff (%s)", p.name, interval))
							}
						}
					}
				} else {
					p.setObserverState(observerKindNodes, ObserverStateUncertain, rt)
				}
				continue
			}

			_ = snap
			interval = baseInterval
			ticker.Reset(interval)
			p.setObserverState(observerKindNodes, ObserverStateActive, rt)
		}
	}
}

