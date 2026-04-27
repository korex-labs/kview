package jobdebug

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestManager_StartNilClients(t *testing.T) {
	m := NewManager()
	_, err := m.Start(context.Background(), nil, StartRequest{
		Context:   "ctx",
		Namespace: "default",
		Name:      "my-job",
		Kind:      SourceJob,
	})
	if err == nil {
		t.Fatal("expected error for nil clients")
	}
}

func TestManager_StartMissingFields(t *testing.T) {
	m := NewManager()
	cases := []StartRequest{
		{Namespace: "ns", Name: "n"},      // missing Context
		{Context: "ctx", Name: "n"},       // missing Namespace
		{Context: "ctx", Namespace: "ns"}, // missing Name
	}
	for _, req := range cases {
		_, err := m.Start(context.Background(), nil, req)
		if err == nil {
			t.Errorf("expected error for req %+v", req)
		}
	}
}

func TestManager_GetNonExistent(t *testing.T) {
	m := NewManager()
	_, ok := m.Get("does-not-exist")
	if ok {
		t.Fatal("expected Get to return false for unknown ID")
	}
}

func TestManager_CloseNonExistent(t *testing.T) {
	m := NewManager()
	// should not panic
	m.Close("does-not-exist")
}

func TestManager_ConcurrentGetClose(t *testing.T) {
	m := NewManager()
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			m.Get("unknown")
		}()
		go func() {
			defer wg.Done()
			m.Close("unknown")
		}()
	}
	wg.Wait()
}

func TestMapContainerStatuses(t *testing.T) {
	items := []corev1.ContainerStatus{
		{Name: "app", RestartCount: 1},
		{Name: "sidecar", RestartCount: 0},
	}
	m := mapContainerStatuses(items)
	if len(m) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(m))
	}
	if m["app"].RestartCount != 1 {
		t.Fatalf("app restart count: got %d, want 1", m["app"].RestartCount)
	}
	if m["sidecar"].RestartCount != 0 {
		t.Fatalf("sidecar restart count: got %d, want 0", m["sidecar"].RestartCount)
	}
}

func TestContainerLogKey(t *testing.T) {
	if containerLogKey("pod", "c", false) != "pod/c/current" {
		t.Fatal("expected pod/c/current")
	}
	if containerLogKey("pod", "c", true) != "pod/c/previous" {
		t.Fatal("expected pod/c/previous")
	}
}

func TestFirstNonEmpty(t *testing.T) {
	if firstNonEmpty("", "b", "c") != "b" {
		t.Fatal("expected b")
	}
	if firstNonEmpty("", "  ", "c") != "c" {
		t.Fatal("expected c")
	}
	if firstNonEmpty("", "") != "" {
		t.Fatal("expected empty")
	}
}

func TestShouldCapturePreviousLogs(t *testing.T) {
	status := corev1.ContainerStatus{
		Name:         "worker",
		RestartCount: 1,
		LastTerminationState: corev1.ContainerState{
			Terminated: &corev1.ContainerStateTerminated{ExitCode: 127},
		},
	}

	if !shouldCapturePreviousLogs(status, 0) {
		t.Fatal("expected terminated restart to capture previous logs")
	}
	if shouldCapturePreviousLogs(status, 1) {
		t.Fatal("did not expect to recapture the same restart count")
	}

	status.RestartCount = 0
	if shouldCapturePreviousLogs(status, 0) {
		t.Fatal("did not expect previous logs before a restart")
	}

	status.RestartCount = 2
	status.LastTerminationState.Terminated = nil
	if shouldCapturePreviousLogs(status, 1) {
		t.Fatal("did not expect previous logs without a terminated state")
	}
}

func TestEventTime_LastTimestamp(t *testing.T) {
	ts := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	e := corev1.Event{
		LastTimestamp: metav1.NewTime(ts),
		EventTime:     metav1.NewMicroTime(ts.Add(time.Hour)),
	}
	got := eventTime(e)
	if !got.Equal(ts) {
		t.Errorf("expected LastTimestamp %v, got %v", ts, got)
	}
}

func TestEventTime_EventTimeFallback(t *testing.T) {
	ts := time.Date(2024, 2, 1, 0, 0, 0, 0, time.UTC)
	e := corev1.Event{
		EventTime: metav1.NewMicroTime(ts),
	}
	got := eventTime(e)
	if !got.Equal(ts) {
		t.Errorf("expected EventTime %v, got %v", ts, got)
	}
}

func TestEventTime_CreationTimestampFallback(t *testing.T) {
	ts := time.Date(2024, 3, 1, 0, 0, 0, 0, time.UTC)
	e := corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			CreationTimestamp: metav1.NewTime(ts),
		},
	}
	got := eventTime(e)
	if !got.Equal(ts) {
		t.Errorf("expected CreationTimestamp %v, got %v", ts, got)
	}
}

func TestEventTime_NowFallback(t *testing.T) {
	before := time.Now().Add(-time.Second)
	got := eventTime(corev1.Event{})
	after := time.Now().Add(time.Second)
	if got.Before(before) || got.After(after) {
		t.Errorf("fallback time %v not in expected range [%v, %v]", got, before, after)
	}
}

func TestSession_AppendSetsTimestamp(t *testing.T) {
	s := &Session{}
	s.append(Record{Type: "status"})
	if len(s.records) != 1 {
		t.Fatalf("expected 1 record, got %d", len(s.records))
	}
	if s.records[0].Timestamp == 0 {
		t.Error("expected Timestamp to be auto-filled")
	}
}

func TestSession_AppendPreservesExplicitTimestamp(t *testing.T) {
	s := &Session{}
	s.append(Record{Type: "status", Timestamp: 12345})
	if s.records[0].Timestamp != 12345 {
		t.Errorf("expected Timestamp=12345, got %d", s.records[0].Timestamp)
	}
}

func TestSession_AppendConcurrent(t *testing.T) {
	s := &Session{}
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			s.append(Record{Type: "log", Line: "line"})
		}(i)
	}
	wg.Wait()
	if len(s.records) != 100 {
		t.Errorf("expected 100 records, got %d", len(s.records))
	}
}

func TestSession_CloseIdempotent(t *testing.T) {
	s := &Session{}
	s.close()
	s.close() // must not panic
	if !s.closed {
		t.Error("expected closed=true")
	}
}

func TestSession_Fail(t *testing.T) {
	s := &Session{}
	s.fail(context.DeadlineExceeded)
	if !s.closed {
		t.Error("expected session to be closed after fail")
	}
	if len(s.records) == 0 {
		t.Error("expected error record after fail")
	}
	if s.records[0].Level != "error" {
		t.Errorf("expected error level, got %q", s.records[0].Level)
	}
}

func TestSession_JobName(t *testing.T) {
	s := &Session{}
	if s.currentJobName() != "" {
		t.Error("expected empty job name initially")
	}
	s.setJobName("test-job-abc")
	if got := s.currentJobName(); got != "test-job-abc" {
		t.Errorf("expected test-job-abc, got %q", got)
	}
}

func TestSession_LoggedContainer(t *testing.T) {
	s := &Session{logged: map[string]bool{}}
	if s.hasLoggedContainer("pod", "app", false) {
		t.Error("should not be logged initially")
	}
	s.markLoggedContainer("pod", "app", false)
	if !s.hasLoggedContainer("pod", "app", false) {
		t.Error("should be logged after mark")
	}
	if s.hasLoggedContainer("pod", "app", true) {
		t.Error("previous log should not be marked when current was marked")
	}
}

func TestManager_StopNotFound(t *testing.T) {
	m := NewManager()
	_, err := m.Stop(context.Background(), "no-such-id")
	if err == nil {
		t.Fatal("expected error for unknown session")
	}
}

func TestManager_StopNoJobYet(t *testing.T) {
	m := NewManager()
	// Inject a session with no jobName set.
	s := &Session{
		id:        "test-id",
		namespace: "ns",
		cancel:    func() {},
		logged:    map[string]bool{},
	}
	m.mu.Lock()
	m.sessions["test-id"] = s
	m.mu.Unlock()

	_, err := m.Stop(context.Background(), "test-id")
	if err == nil {
		t.Fatal("expected error when no job assigned yet")
	}
}

var wsUpgrader = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}

func wsTestServer(t *testing.T, fn func(conn *websocket.Conn)) (*httptest.Server, string) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := wsUpgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }()
		fn(conn)
	}))
	url := "ws" + strings.TrimPrefix(srv.URL, "http")
	return srv, url
}

func wsCollect(t *testing.T, url string) []Record {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close() }()
	var out []Record
	for {
		var rec Record
		if err := conn.ReadJSON(&rec); err != nil {
			break
		}
		out = append(out, rec)
	}
	return out
}

// TestSession_Stream_DrainsThenStops verifies that Stream() sends all buffered
// records over the WebSocket connection and returns once the session is closed.
func TestSession_Stream_DrainsThenStops(t *testing.T) {
	s := &Session{}
	s.append(Record{Type: "log", Line: "a"})
	s.append(Record{Type: "log", Line: "b"})
	s.close()

	srv, url := wsTestServer(t, func(conn *websocket.Conn) {
		s.Stream(context.Background(), conn)
	})
	defer srv.Close()

	got := wsCollect(t, url)
	if len(got) != 2 {
		t.Fatalf("expected 2 records, got %d", len(got))
	}
	if got[0].Line != "a" || got[1].Line != "b" {
		t.Errorf("unexpected record order: %+v", got)
	}
}

// TestSession_Stream_ContextCancel verifies that Stream() returns promptly when
// the context is cancelled, without sending any records.
func TestSession_Stream_ContextCancel(t *testing.T) {
	s := &Session{}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	srv, url := wsTestServer(t, func(conn *websocket.Conn) {
		s.Stream(ctx, conn)
	})
	defer srv.Close()

	got := wsCollect(t, url)
	if len(got) != 0 {
		t.Errorf("expected 0 records after context cancel, got %d", len(got))
	}
}

func TestRandomID_Length(t *testing.T) {
	id := randomID()
	// 8 bytes hex-encoded → 16 hex chars
	if len(id) != 16 {
		t.Errorf("expected 16-char hex ID, got %q (len=%d)", id, len(id))
	}
}

func TestRandomID_Unique(t *testing.T) {
	seen := map[string]bool{}
	for range 20 {
		id := randomID()
		if seen[id] {
			t.Fatalf("duplicate randomID: %q", id)
		}
		seen[id] = true
	}
}
