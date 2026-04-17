package session

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/alex-mamchenkov/kview/internal/runtime"
)

var ErrNotFound = errors.New("session not found")

type Manager interface {
	List(ctx context.Context) ([]Session, error)
	Get(ctx context.Context, id string) (Session, bool, error)
	Create(ctx context.Context, s Session) (Session, error)
	Stop(ctx context.Context, id string) error
	Update(ctx context.Context, s Session) error
}

type InMemoryManager struct {
	mu           sync.RWMutex
	sessions     map[string]Session
	reg          runtime.ActivityRegistry
	portForwards map[string]func()
}

const stoppedActivityTTL = 3 * time.Minute

func NewInMemoryManager(reg runtime.ActivityRegistry) *InMemoryManager {
	return &InMemoryManager{
		sessions:     make(map[string]Session),
		reg:          reg,
		portForwards: make(map[string]func()),
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
	resType := "session:terminal"
	if actType == runtime.ActivityTypePortForward {
		resType = "session:portforward"
	}
	activity := runtime.Activity{
		ID:           s.ID,
		Kind:         runtime.ActivityKindSession,
		Type:         actType,
		Title:        s.Title,
		Status:       runtime.ActivityStatus(s.Status),
		CreatedAt:    s.CreatedAt,
		UpdatedAt:    s.UpdatedAt,
		StartedAt:    s.CreatedAt,
		ResourceType: resType,
		Metadata: map[string]string{
			"targetCluster":   s.TargetCluster,
			"targetNamespace": s.TargetNamespace,
			"targetResource":  s.TargetResource,
			"targetContainer": s.TargetContainer,
		},
	}
	for k, v := range s.Metadata {
		activity.Metadata[k] = v
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
	// Mark as stopped once, then remove from the in-memory list so the
	// Sessions tab no longer shows the terminated session.
	if s.Status != StatusFailed {
		s.Status = StatusStopped
	}
	s.UpdatedAt = time.Now().UTC()
	m.sessions[id] = s
	if cancel, ok := m.portForwards[id]; ok && cancel != nil {
		// Stop the live port-forward bridge outside the critical section.
		go cancel()
		delete(m.portForwards, id)
	}
	delete(m.sessions, id)
	m.mu.Unlock()

	// Update corresponding Activity to stopped, but keep it visible for history.
	if act, found, _ := m.reg.Get(context.Background(), id); found {
		if s.Status == StatusFailed {
			act.Status = runtime.ActivityStatusFailed
		} else {
			act.Status = runtime.ActivityStatusStopped
		}
		act.UpdatedAt = time.Now().UTC()
		_ = m.reg.Update(context.Background(), act)
		m.scheduleActivityCleanup(id, act.UpdatedAt)
	}
	return nil
}

// RegisterPortForward associates a cleanup function with a session that owns a
// live port-forward bridge. It is safe to call multiple times; the last
// registration wins.
func (m *InMemoryManager) RegisterPortForward(id string, stop func()) {
	if id == "" || stop == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.portForwards[id] = stop
}

func (m *InMemoryManager) Update(_ context.Context, s Session) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	existing, ok := m.sessions[s.ID]
	if !ok {
		return ErrNotFound
	}
	// Preserve CreatedAt if caller omitted it.
	if s.CreatedAt.IsZero() {
		s.CreatedAt = existing.CreatedAt
	}
	if s.UpdatedAt.IsZero() {
		s.UpdatedAt = time.Now().UTC()
	}
	m.sessions[s.ID] = s

	if act, found, _ := m.reg.Get(context.Background(), s.ID); found {
		if act.Metadata == nil {
			act.Metadata = map[string]string{}
		}
		act.Metadata["targetCluster"] = s.TargetCluster
		act.Metadata["targetNamespace"] = s.TargetNamespace
		act.Metadata["targetResource"] = s.TargetResource
		act.Metadata["targetContainer"] = s.TargetContainer
		for k, v := range s.Metadata {
			act.Metadata[k] = v
		}
		act.Title = s.Title
		act.Status = runtime.ActivityStatus(s.Status)
		act.UpdatedAt = s.UpdatedAt
		_ = m.reg.Update(context.Background(), act)
	}
	return nil
}

func generateSessionID() string {
	return "sess-" + time.Now().UTC().Format("20060102T150405.000000000Z07")
}

func (m *InMemoryManager) scheduleActivityCleanup(id string, marker time.Time) {
	go func() {
		timer := time.NewTimer(stoppedActivityTTL)
		defer timer.Stop()
		<-timer.C

		act, found, err := m.reg.Get(context.Background(), id)
		if err != nil || !found {
			return
		}
		// Avoid removing activity that has been updated/reused after scheduling.
		if !act.UpdatedAt.Equal(marker) {
			return
		}
		if act.Status != runtime.ActivityStatusStopped && act.Status != runtime.ActivityStatusFailed {
			return
		}
		_ = m.reg.Remove(context.Background(), id)
	}()
}
