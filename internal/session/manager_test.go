package session

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/korex-labs/kview/internal/runtime"
)

func newTestManager() (*InMemoryManager, runtime.ActivityRegistry) {
	reg := runtime.NewInMemoryActivityRegistry()
	return NewInMemoryManager(reg), reg
}

func TestInMemoryManager_CreateDefaultsIDAndStatus(t *testing.T) {
	m, _ := newTestManager()
	s, err := m.Create(context.Background(), Session{Type: TypeTerminal})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if s.ID == "" {
		t.Error("expected non-empty ID")
	}
	if s.Status != StatusPending {
		t.Errorf("Status: got %q, want %q", s.Status, StatusPending)
	}
	if s.Metadata == nil {
		t.Error("expected Metadata to be initialized")
	}
	if s.CreatedAt.IsZero() || s.UpdatedAt.IsZero() {
		t.Error("expected timestamps to be set")
	}
}

func TestInMemoryManager_CreatePreservesExplicitID(t *testing.T) {
	m, _ := newTestManager()
	s, err := m.Create(context.Background(), Session{ID: "explicit-id", Type: TypeTerminal})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if s.ID != "explicit-id" {
		t.Errorf("ID: got %q, want explicit-id", s.ID)
	}
}

func TestInMemoryManager_CreatePreservesExplicitStatus(t *testing.T) {
	m, _ := newTestManager()
	s, err := m.Create(context.Background(), Session{Status: StatusStarting, Type: TypeTerminal})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if s.Status != StatusStarting {
		t.Errorf("Status: got %q, want %q", s.Status, StatusStarting)
	}
}

func TestInMemoryManager_CreateRegistersTerminalActivity(t *testing.T) {
	m, reg := newTestManager()
	s, _ := m.Create(context.Background(), Session{
		Type:            TypeTerminal,
		Title:           "exec session",
		TargetCluster:   "dev",
		TargetNamespace: "default",
		TargetResource:  "my-pod",
		TargetContainer: "app",
	})
	act, found, _ := reg.Get(context.Background(), s.ID)
	if !found {
		t.Fatal("activity not registered")
	}
	if act.Type != runtime.ActivityTypeTerminal {
		t.Errorf("ActivityType: got %q, want %q", act.Type, runtime.ActivityTypeTerminal)
	}
	if act.Metadata["targetCluster"] != "dev" {
		t.Errorf("targetCluster: got %q, want dev", act.Metadata["targetCluster"])
	}
	if act.Metadata["targetResource"] != "my-pod" {
		t.Errorf("targetResource: got %q, want my-pod", act.Metadata["targetResource"])
	}
}

func TestInMemoryManager_CreateRegistersPortForwardActivity(t *testing.T) {
	m, reg := newTestManager()
	s, _ := m.Create(context.Background(), Session{Type: TypePortForward, Title: "pf"})
	act, found, _ := reg.Get(context.Background(), s.ID)
	if !found {
		t.Fatal("activity not registered")
	}
	if act.Type != runtime.ActivityTypePortForward {
		t.Errorf("ActivityType: got %q, want %q", act.Type, runtime.ActivityTypePortForward)
	}
	if act.ResourceType != "session:portforward" {
		t.Errorf("ResourceType: got %q, want session:portforward", act.ResourceType)
	}
}

func TestInMemoryManager_CreateMergesCustomMetadata(t *testing.T) {
	m, reg := newTestManager()
	s, _ := m.Create(context.Background(), Session{
		Type:     TypeTerminal,
		Metadata: map[string]string{"shell": "/bin/zsh"},
	})
	act, found, _ := reg.Get(context.Background(), s.ID)
	if !found {
		t.Fatal("activity not registered")
	}
	if act.Metadata["shell"] != "/bin/zsh" {
		t.Errorf("shell metadata not propagated; got %q", act.Metadata["shell"])
	}
}

func TestInMemoryManager_List(t *testing.T) {
	m, _ := newTestManager()
	ctx := context.Background()

	list, err := m.List(ctx)
	if err != nil || len(list) != 0 {
		t.Fatalf("empty List: err=%v len=%d", err, len(list))
	}

	for range 3 {
		_, _ = m.Create(ctx, Session{Type: TypeTerminal})
	}
	list, err = m.List(ctx)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 3 {
		t.Errorf("expected 3 sessions, got %d", len(list))
	}
}

func TestInMemoryManager_GetFound(t *testing.T) {
	m, _ := newTestManager()
	ctx := context.Background()
	s, _ := m.Create(ctx, Session{Type: TypeTerminal, Title: "t"})

	got, ok, err := m.Get(ctx, s.ID)
	if err != nil || !ok {
		t.Fatalf("Get: err=%v ok=%v", err, ok)
	}
	if got.ID != s.ID {
		t.Errorf("ID mismatch: got %q, want %q", got.ID, s.ID)
	}
}

func TestInMemoryManager_GetNotFound(t *testing.T) {
	m, _ := newTestManager()
	_, ok, err := m.Get(context.Background(), "no-such-id")
	if err != nil || ok {
		t.Fatalf("expected ok=false err=nil; got ok=%v err=%v", ok, err)
	}
}

func TestInMemoryManager_StopNotFound(t *testing.T) {
	m, _ := newTestManager()
	err := m.Stop(context.Background(), "no-such-id")
	if err != ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestInMemoryManager_StopRemovesSession(t *testing.T) {
	m, _ := newTestManager()
	ctx := context.Background()
	s, _ := m.Create(ctx, Session{Type: TypeTerminal})

	if err := m.Stop(ctx, s.ID); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	_, ok, _ := m.Get(ctx, s.ID)
	if ok {
		t.Error("expected session removed after Stop")
	}
}

func TestInMemoryManager_StopUpdatesActivityToStopped(t *testing.T) {
	m, reg := newTestManager()
	ctx := context.Background()
	s, _ := m.Create(ctx, Session{Type: TypeTerminal})
	_ = m.Stop(ctx, s.ID)

	// Give scheduleActivityCleanup goroutine time to be scheduled but NOT execute
	// (stoppedActivityTTL is 3 minutes so the activity persists).
	act, found, _ := reg.Get(ctx, s.ID)
	if !found {
		t.Fatal("activity should remain after Stop")
	}
	if act.Status != runtime.ActivityStatusStopped {
		t.Errorf("expected stopped, got %q", act.Status)
	}
}

func TestInMemoryManager_StopPreservesFailedStatus(t *testing.T) {
	m, reg := newTestManager()
	ctx := context.Background()
	// Create with explicit Failed status so Stop preserves it.
	s, _ := m.Create(ctx, Session{Type: TypeTerminal, Status: StatusFailed})

	_ = m.Stop(ctx, s.ID)

	act, found, _ := reg.Get(ctx, s.ID)
	if !found {
		t.Fatal("activity should remain after Stop")
	}
	if act.Status != runtime.ActivityStatusFailed {
		t.Errorf("expected failed, got %q", act.Status)
	}
}

func TestInMemoryManager_StopInvokesCancelForPortForward(t *testing.T) {
	m, _ := newTestManager()
	ctx := context.Background()
	s, _ := m.Create(ctx, Session{Type: TypePortForward})

	called := make(chan struct{}, 1)
	m.RegisterPortForward(s.ID, func() { called <- struct{}{} })

	if err := m.Stop(ctx, s.ID); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	select {
	case <-called:
	case <-time.After(time.Second):
		t.Fatal("port-forward cancel not invoked within 1s")
	}
}

func TestInMemoryManager_UpdateNotFound(t *testing.T) {
	m, _ := newTestManager()
	err := m.Update(context.Background(), Session{ID: "ghost"})
	if err != ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestInMemoryManager_UpdatePreservesCreatedAt(t *testing.T) {
	m, _ := newTestManager()
	ctx := context.Background()
	s, _ := m.Create(ctx, Session{Type: TypeTerminal})
	original := s.CreatedAt

	s.CreatedAt = time.Time{} // zero it out
	if err := m.Update(ctx, s); err != nil {
		t.Fatalf("Update: %v", err)
	}
	got, _, _ := m.Get(ctx, s.ID)
	if !got.CreatedAt.Equal(original) {
		t.Errorf("CreatedAt: got %v, want %v", got.CreatedAt, original)
	}
}

func TestInMemoryManager_UpdateSetsUpdatedAtWhenZero(t *testing.T) {
	m, _ := newTestManager()
	ctx := context.Background()
	s, _ := m.Create(ctx, Session{Type: TypeTerminal})
	s.UpdatedAt = time.Time{} // zero it out
	if err := m.Update(ctx, s); err != nil {
		t.Fatalf("Update: %v", err)
	}
	got, _, _ := m.Get(ctx, s.ID)
	if got.UpdatedAt.IsZero() {
		t.Error("expected UpdatedAt to be set")
	}
}

func TestInMemoryManager_UpdateMirrorsToActivity(t *testing.T) {
	m, reg := newTestManager()
	ctx := context.Background()
	s, _ := m.Create(ctx, Session{Type: TypeTerminal, Title: "old"})
	s.Title = "new"
	s.Status = StatusRunning
	if err := m.Update(ctx, s); err != nil {
		t.Fatalf("Update: %v", err)
	}
	act, found, _ := reg.Get(ctx, s.ID)
	if !found {
		t.Fatal("activity should exist")
	}
	if act.Title != "new" {
		t.Errorf("Title: got %q, want new", act.Title)
	}
	if act.Status != runtime.ActivityStatus(StatusRunning) {
		t.Errorf("Status: got %q, want running", act.Status)
	}
}

func TestInMemoryManager_RegisterPortForwardGuardsNilID(t *testing.T) {
	m, _ := newTestManager()
	m.RegisterPortForward("", func() {})
	m.mu.RLock()
	n := len(m.portForwards)
	m.mu.RUnlock()
	if n != 0 {
		t.Errorf("expected 0 portForwards, got %d", n)
	}
}

func TestInMemoryManager_RegisterPortForwardGuardsNilFunc(t *testing.T) {
	m, _ := newTestManager()
	m.RegisterPortForward("some-id", nil)
	m.mu.RLock()
	n := len(m.portForwards)
	m.mu.RUnlock()
	if n != 0 {
		t.Errorf("expected 0 portForwards, got %d", n)
	}
}

func TestInMemoryManager_RegisterPortForwardLastWins(t *testing.T) {
	m, _ := newTestManager()
	first := make(chan struct{}, 1)
	second := make(chan struct{}, 1)
	m.RegisterPortForward("id", func() { first <- struct{}{} })
	m.RegisterPortForward("id", func() { second <- struct{}{} })

	m.mu.RLock()
	fn := m.portForwards["id"]
	m.mu.RUnlock()
	fn()

	select {
	case <-second:
	default:
		t.Fatal("second registration did not win")
	}
	select {
	case <-first:
		t.Fatal("first registration should not be called")
	default:
	}
}

func TestGenerateSessionID_NonEmpty(t *testing.T) {
	id := generateSessionID()
	if id == "" {
		t.Fatal("expected non-empty session ID")
	}
}

func TestGenerateSessionID_HasPrefix(t *testing.T) {
	id := generateSessionID()
	if len(id) < 5 || id[:5] != "sess-" {
		t.Errorf("expected sess- prefix, got %q", id)
	}
}

func TestInMemoryManager_ConcurrentCreateListStop(t *testing.T) {
	m, _ := newTestManager()
	ctx := context.Background()

	ids := make(chan string, 100)
	var createWg sync.WaitGroup
	for range 50 {
		createWg.Add(1)
		go func() {
			defer createWg.Done()
			s, _ := m.Create(ctx, Session{Type: TypeTerminal})
			ids <- s.ID
		}()
	}
	createWg.Wait()
	close(ids)

	var stopWg sync.WaitGroup
	for id := range ids {
		stopWg.Add(1)
		go func(id string) {
			defer stopWg.Done()
			_ = m.Stop(ctx, id)
		}(id)
	}
	stopWg.Wait()

	list, _ := m.List(ctx)
	if len(list) != 0 {
		t.Errorf("expected all sessions stopped, %d remain", len(list))
	}
}
