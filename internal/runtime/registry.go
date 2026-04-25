package runtime

import (
	"context"
	"sync"
)

type ActivityRegistry interface {
	Register(ctx context.Context, activity Activity) error
	Update(ctx context.Context, activity Activity) error
	Get(ctx context.Context, id string) (Activity, bool, error)
	List(ctx context.Context) ([]Activity, error)
	Remove(ctx context.Context, id string) error
}

type InMemoryActivityRegistry struct {
	mu    sync.RWMutex
	items map[string]Activity
}

func NewInMemoryActivityRegistry() *InMemoryActivityRegistry {
	return &InMemoryActivityRegistry{
		items: make(map[string]Activity),
	}
}

func (r *InMemoryActivityRegistry) Register(_ context.Context, activity Activity) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.items[activity.ID] = activity
	return nil
}

func (r *InMemoryActivityRegistry) Update(_ context.Context, activity Activity) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.items[activity.ID]; !ok {
		// For Phase 1 keep behavior simple: upsert.
	}
	r.items[activity.ID] = activity
	return nil
}

func (r *InMemoryActivityRegistry) Get(_ context.Context, id string) (Activity, bool, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	a, ok := r.items[id]
	return a, ok, nil
}

func (r *InMemoryActivityRegistry) List(_ context.Context) ([]Activity, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Activity, 0, len(r.items))
	for _, a := range r.items {
		out = append(out, a)
	}
	return out, nil
}

func (r *InMemoryActivityRegistry) Remove(_ context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.items, id)
	return nil
}
