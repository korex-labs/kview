package dataplane

import (
	"context"
	"sync"
	"time"
)

// WorkClass represents a broad scheduler work category.
type WorkClass string

const (
	WorkClassSnapshot WorkClass = "snapshot"
)

// ResourceKind identifies first-wave covered resources.
type ResourceKind string

const (
	ResourceKindNamespaces  ResourceKind = "namespaces"
	ResourceKindPods        ResourceKind = "pods"
	ResourceKindDeployments ResourceKind = "deployments"
	ResourceKindNodes       ResourceKind = "nodes"
	ResourceKindServices    ResourceKind = "services"
	ResourceKindIngresses   ResourceKind = "ingresses"
	ResourceKindPVCs        ResourceKind = "persistentvolumeclaims"
	ResourceKindConfigMaps  ResourceKind = "configmaps"
	ResourceKindSecrets     ResourceKind = "secrets"
)

type workKey struct {
	Cluster   string
	Class     WorkClass
	Kind      ResourceKind
	Namespace string
}

type inFlight struct {
	done chan struct{}
	err  error
}

// simpleScheduler is a per-process scheduler that provides:
// - per-cluster concurrency limits
// - in-flight de-duplication for equivalent work
// - basic jitter/backoff for transient failures
type simpleScheduler struct {
	mu sync.Mutex

	inFlight   map[workKey]*inFlight
	semaphores map[string]chan struct{}

	maxPerCluster int
}

func newSimpleScheduler(maxPerCluster int) *simpleScheduler {
	if maxPerCluster <= 0 {
		maxPerCluster = 4
	}
	return &simpleScheduler{
		inFlight:      make(map[workKey]*inFlight),
		semaphores:    make(map[string]chan struct{}),
		maxPerCluster: maxPerCluster,
	}
}

func (s *simpleScheduler) acquire(cluster string, ctx context.Context) error {
	s.mu.Lock()
	sem, ok := s.semaphores[cluster]
	if !ok {
		sem = make(chan struct{}, s.maxPerCluster)
		s.semaphores[cluster] = sem
	}
	s.mu.Unlock()

	select {
	case sem <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *simpleScheduler) release(cluster string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if sem, ok := s.semaphores[cluster]; ok {
		select {
		case <-sem:
		default:
		}
	}
}

// Run ensures that work for a given key is executed with in-flight de-duplication.
// If equivalent work is already running, callers will wait for that result.
// A small bounded retry with jitter is applied for transient errors.
func (s *simpleScheduler) Run(ctx context.Context, key workKey, fn func(context.Context) error) error {
	s.mu.Lock()
	if existing, ok := s.inFlight[key]; ok {
		done := existing.done
		s.mu.Unlock()
		select {
		case <-done:
			return existing.err
		case <-ctx.Done():
			return ctx.Err()
		}
	}

	inf := &inFlight{done: make(chan struct{})}
	s.inFlight[key] = inf
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		delete(s.inFlight, key)
		s.mu.Unlock()
		close(inf.done)
	}()

	if err := s.acquire(key.Cluster, ctx); err != nil {
		inf.err = err
		return err
	}
	defer s.release(key.Cluster)

	backoff := 100 * time.Millisecond
	maxBackoff := 1500 * time.Millisecond

	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			select {
			case <-time.After(backoff):
			case <-ctx.Done():
				inf.err = ctx.Err()
				return ctx.Err()
			}
			backoff *= 2
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
		}

		err := fn(ctx)
		if err == nil {
			inf.err = nil
			return nil
		}

		norm := NormalizeError(err)
		switch norm.Class {
		case NormalizedErrorClassRateLimited,
			NormalizedErrorClassTimeout,
			NormalizedErrorClassTransient,
			NormalizedErrorClassProxyFailure,
			NormalizedErrorClassConnectivity:
			// transient-ish, retry
			continue
		default:
			// non-transient, do not retry
			inf.err = err
			return err
		}
	}

	// Give up after retries; last error is transient by nature.
	inf.err = context.DeadlineExceeded
	return inf.err
}
