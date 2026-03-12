package runtime

import "context"

type RuntimeManager interface {
	Start(ctx context.Context) error
	Stop(ctx context.Context) error
	Registry() ActivityRegistry
}

type Manager struct {
	registry ActivityRegistry
}

func NewManager() *Manager {
	return &Manager{
		registry: NewInMemoryActivityRegistry(),
	}
}

func (m *Manager) Start(_ context.Context) error {
	// Phase 1: no-op startup hook.
	return nil
}

func (m *Manager) Stop(_ context.Context) error {
	// Phase 1: no-op shutdown hook.
	return nil
}

func (m *Manager) Registry() ActivityRegistry {
	return m.registry
}

