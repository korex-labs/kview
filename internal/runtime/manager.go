package runtime

import (
	"context"
	"time"
)

type RuntimeManager interface {
	Start(ctx context.Context) error
	Stop(ctx context.Context) error
	Registry() ActivityRegistry
	Logs() LogReader
	Log(level LogLevel, source, msg string)
}

type Manager struct {
	registry ActivityRegistry
	logs     *LogBuffer
}

func NewManager() *Manager {
	return &Manager{
		registry: NewInMemoryActivityRegistry(),
		logs:     NewLogBuffer(512),
	}
}

func (m *Manager) Start(_ context.Context) error {
	now := time.Now().UTC()

	// Register a runtime/system activity and mark it as running.
	a := Activity{
		ID:           RuntimeActivityID,
		Kind:         ActivityKindStream,
		Type:         ActivityTypeRuntimeLog,
		Title:        "Runtime",
		Status:       ActivityStatusStarting,
		CreatedAt:    now,
		UpdatedAt:    now,
		StartedAt:    now,
		ResourceType: "system:runtime",
		Metadata:     map[string]string{"scope": "system"},
	}
	_ = m.registry.Register(context.Background(), a)
	m.logs.Append(LogLevelInfo, "runtime", "runtime activity registered (starting)")

	a.Status = ActivityStatusRunning
	a.UpdatedAt = time.Now().UTC()
	_ = m.registry.Update(context.Background(), a)
	m.logs.Append(LogLevelInfo, "runtime", "runtime activity is running")

	return nil
}

func (m *Manager) Stop(_ context.Context) error {
	now := time.Now().UTC()
	a, ok, _ := m.registry.Get(context.Background(), RuntimeActivityID)
	if ok {
		a.Status = ActivityStatusStopped
		a.UpdatedAt = now
		_ = m.registry.Update(context.Background(), a)
	}
	m.logs.Append(LogLevelInfo, "runtime", "runtime activity stopped")
	return nil
}

func (m *Manager) Registry() ActivityRegistry {
	return m.registry
}

func (m *Manager) Logs() LogReader {
	return m.logs
}

func (m *Manager) Log(level LogLevel, source, msg string) {
	m.logs.Append(level, source, msg)
}
