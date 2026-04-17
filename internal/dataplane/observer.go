package dataplane

import (
	"context"
	"fmt"
	"time"

	"github.com/alex-mamchenkov/kview/internal/runtime"
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

func (p *clusterPlane) EnsureObservers(ctx context.Context, sched *workScheduler, clients ClientsProvider, rt runtime.RuntimeManager) {
	policy := p.currentPolicy()
	if !policy.Observers.Enabled {
		return
	}
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

func (p *clusterPlane) namespaceObserverTick(ctx context.Context, sched *workScheduler, clients ClientsProvider, rt runtime.RuntimeManager) {
	policy := p.currentPolicy()
	if !policy.Observers.Enabled || !policy.Observers.NamespacesEnabled {
		p.setObserverState(observerKindNamespaces, ObserverStateStopped, rt)
		return
	}
	// Run one refresh cycle immediately so observer state becomes truthful as soon
	// as a dataplane-backed endpoint activates the plane.
	tickCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	obsCtx := ContextWithWorkSource(tickCtx, WorkSourceObserver)
	snap, err := p.NamespacesSnapshot(obsCtx, sched, clients, WorkPriorityLow)
	if err != nil {
		if snap.Err != nil {
			state := observerStateForError(*snap.Err)
			p.setObserverState(observerKindNamespaces, state, rt)
		} else {
			p.setObserverState(observerKindNamespaces, ObserverStateUncertain, rt)
		}
		return
	}

	p.setObserverState(observerKindNamespaces, ObserverStateActive, rt)
}

func (p *clusterPlane) runNamespaceObserver(ctx context.Context, sched *workScheduler, clients ClientsProvider, rt runtime.RuntimeManager) {
	p.setObserverState(observerKindNamespaces, ObserverStateStarting, rt)
	p.namespaceObserverTick(ctx, sched, clients, rt)

	for {
		policy := p.currentPolicy()
		interval := time.Duration(policy.Observers.NamespacesIntervalSec) * time.Second
		if !policy.Observers.Enabled || !policy.Observers.NamespacesEnabled {
			interval = 5 * time.Second
		}
		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			p.setObserverState(observerKindNamespaces, ObserverStateStopped, rt)
			return
		case <-timer.C:
			p.namespaceObserverTick(ctx, sched, clients, rt)
		}
	}
}

func (p *clusterPlane) nodeObserverTick(ctx context.Context, sched *workScheduler, clients ClientsProvider, rt runtime.RuntimeManager, interval *time.Duration, ticker *time.Ticker) {
	policy := p.currentPolicy()
	if !policy.Observers.Enabled || !policy.Observers.NodesEnabled {
		p.setObserverState(observerKindNodes, ObserverStateStopped, rt)
		return
	}
	tickCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	obsCtx := ContextWithWorkSource(tickCtx, WorkSourceObserver)
	snap, err := p.NodesSnapshot(obsCtx, sched, clients, WorkPriorityLow)
	if err != nil {
		if snap.Err != nil {
			state := observerStateForError(*snap.Err)
			p.setObserverState(observerKindNodes, state, rt)

			// Simple backoff when access is blocked or upstream is degraded.
			switch state {
			case ObserverStateBlockedByAccess, ObserverStateBackoff:
				maxBackoff := time.Duration(policy.Observers.NodesBackoffMaxSec) * time.Second
				if *interval < maxBackoff {
					*interval *= 2
					if *interval > maxBackoff {
						*interval = maxBackoff
					}
					ticker.Reset(*interval)
					if rt != nil {
						rt.Log(runtime.LogLevelInfo, "dataplane",
							fmt.Sprintf("node observer for cluster %s entering backoff (%s)", p.name, *interval))
					}
				}
			}
		} else {
			p.setObserverState(observerKindNodes, ObserverStateUncertain, rt)
		}
		return
	}

	*interval = time.Duration(policy.Observers.NodesIntervalSec) * time.Second
	ticker.Reset(*interval)
	p.setObserverState(observerKindNodes, ObserverStateActive, rt)
}

func (p *clusterPlane) runNodeObserver(ctx context.Context, sched *workScheduler, clients ClientsProvider, rt runtime.RuntimeManager) {
	baseInterval := time.Duration(p.currentPolicy().Observers.NodesIntervalSec) * time.Second
	interval := baseInterval

	p.setObserverState(observerKindNodes, ObserverStateStarting, rt)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	p.nodeObserverTick(ctx, sched, clients, rt, &interval, ticker)

	for {
		select {
		case <-ctx.Done():
			p.setObserverState(observerKindNodes, ObserverStateStopped, rt)
			return
		case <-ticker.C:
			p.nodeObserverTick(ctx, sched, clients, rt, &interval, ticker)
		}
	}
}
