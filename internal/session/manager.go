package session

import (
	"context"
	"errors"
	"sync"
	"time"

	"kview/internal/runtime"
)

var ErrNotFound = errors.New("session not found")

type Manager interface {
	List(ctx context.Context) ([]Session, error)
	Get(ctx context.Context, id string) (Session, bool, error)
	Create(ctx context.Context, s Session) (Session, error)
	Stop(ctx context.Context, id string) error
}

type InMemoryManager struct {
	mu       sync.RWMutex
	sessions map[string]Session
	reg      runtime.ActivityRegistry
}

func NewInMemoryManager(reg runtime.ActivityRegistry) *InMemoryManager {
	return &InMemoryManager{
		sessions: make(map[string]Session),
		reg:      reg,
	}
}

func (m *InMemoryManager) List(_ context.Context) ([]Session, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		out = append(out, s)
	}
	return out, nil
}

func (m *InMemoryManager) Get(_ context.Context, id string) (Session, bool, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s, ok := m.sessions[id]
	return s, ok, nil
}

func (m *InMemoryManager) Create(_ context.Context, s Session) (Session, error) {
	now := time.Now().UTC()
	if s.ID == "" {
		s.ID = generateSessionID()
	}
	if s.Status == "" {
		s.Status = StatusPending
	}
	s.CreatedAt = now
	s.UpdatedAt = now
	if s.Metadata == nil {
		s.Metadata = map[string]string{}
	}

	m.mu.Lock()
	m.sessions[s.ID] = s
	m.mu.Unlock()

	// Mirror into ActivityRegistry.
	actType := runtime.ActivityTypeTerminal
	if s.Type == TypePortForward {
		actType = runtime.ActivityTypePortForward
	}
	activity := runtime.Activity{
		ID:        s.ID,
		Kind:      runtime.ActivityKindSession,
		Type:      actType,
		Title:     s.Title,
		Status:    runtime.ActivityStatus(s.Status),
		CreatedAt: s.CreatedAt,
		UpdatedAt: s.UpdatedAt,
		Metadata: map[string]string{
			"targetCluster":   s.TargetCluster,
			"targetNamespace": s.TargetNamespace,
			"targetResource":  s.TargetResource,
			"targetContainer": s.TargetContainer,
		},
	}
	_ = m.reg.Register(context.Background(), activity)

	return s, nil
}

func (m *InMemoryManager) Stop(_ context.Context, id string) error {
	m.mu.Lock()
	s, ok := m.sessions[id]
	if !ok {
		m.mu.Unlock()
		return ErrNotFound
	}
	s.Status = StatusStopped
	s.UpdatedAt = time.Now().UTC()
	m.sessions[id] = s
	m.mu.Unlock()

	// Update corresponding Activity.
	if act, found, _ := m.reg.Get(context.Background(), id); found {
		act.Status = runtime.ActivityStatusStopped
		act.UpdatedAt = time.Now().UTC()
		_ = m.reg.Update(context.Background(), act)
	}
	return nil
}

func generateSessionID() string {
	return "sess-" + time.Now().UTC().Format("20060102T150405.000000000Z07")
}

