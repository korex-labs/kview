package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/korex-labs/kview/v5/internal/cluster"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

func newLogsTestServer(t *testing.T, handler http.Handler) (*Server, string, *atomic.Int32) {
	t.Helper()
	selected := httptest.NewServer(handler)
	t.Cleanup(selected.Close)
	wrongCalls := &atomic.Int32{}
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wrongCalls.Add(1)
		http.Error(w, "wrong cluster", http.StatusInternalServerError)
	}))
	t.Cleanup(other.Close)
	cfg := clientcmdapi.Config{
		Clusters:  map[string]*clientcmdapi.Cluster{"selected": {Server: selected.URL}, "other": {Server: other.URL}},
		AuthInfos: map[string]*clientcmdapi.AuthInfo{"user": {}},
		Contexts: map[string]*clientcmdapi.Context{
			"selected": {Cluster: "selected", AuthInfo: "user"}, "other": {Cluster: "other", AuthInfo: "user"},
		},
		CurrentContext: "other",
	}
	path := filepath.Join(t.TempDir(), "config")
	if err := clientcmd.WriteToFile(cfg, path); err != nil {
		t.Fatal(err)
	}
	mgr, err := cluster.NewManagerWithLoggerAndConfig(discardLogger{}, path)
	if err != nil {
		t.Fatal(err)
	}
	s, _ := newTestServer(t)
	s.mgr = mgr
	s.SetReadOnly(true)
	srv := httptest.NewServer(s.Router())
	t.Cleanup(srv.Close)
	return s, "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/namespaces/prod/pods/api/logs/ws", wrongCalls
}

func dialLogs(t *testing.T, base, query string) *websocket.Conn {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial(base+"?token="+testToken+"&"+query, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	return conn
}

func TestLogsWSOptionsAndContext(t *testing.T) {
	for _, tc := range []struct{ name, previous, follow string }{
		{"current", "", "true"}, {"previous numeric", "1", ""}, {"previous boolean", "true", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			queries := make(chan url.Values, 1)
			s, base, wrong := newLogsTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodGet {
					t.Errorf("unexpected method: %s", r.Method)
				}
				if r.URL.Path == "/api/v1/namespaces/prod/pods/api" {
					w.Header().Set("Content-Type", "application/json")
					_, _ = fmt.Fprint(w, `{"apiVersion":"v1","kind":"Pod","metadata":{"uid":"uid-1"}}`)
					return
				}
				if r.URL.Path != "/api/v1/namespaces/prod/pods/api/log" {
					t.Errorf("path: %s", r.URL.Path)
				}
				queries <- r.URL.Query()
				_, _ = fmt.Fprint(w, "hello\n")
			}))
			conn := dialLogs(t, base, "context=selected&container=worker&tail=500&follow=1&uid=uid-1&previous="+tc.previous)
			_, data, err := conn.ReadMessage()
			if err != nil || string(data) != "hello\n" {
				t.Fatalf("message=%q err=%v", data, err)
			}
			q := <-queries
			if q.Get("container") != "worker" || q.Get("tailLines") != "500" || q.Get("follow") != tc.follow {
				t.Fatalf("query: %v", q)
			}
			if (q.Get("previous") == "true") != (tc.previous != "") {
				t.Fatalf("previous: %v", q)
			}
			_, _, err = conn.ReadMessage()
			if !websocket.IsCloseError(err, websocket.CloseNormalClosure) {
				t.Fatalf("expected normal completion: %v", err)
			}
			if wrong.Load() != 0 || s.mgr.ActiveContext() != "other" {
				t.Fatal("explicit context leaked or changed active context")
			}
		})
	}
}

func TestLogsWSAuthAndErrors(t *testing.T) {
	for _, tc := range []struct {
		name, query, message string
		status               int
	}{
		{"replacement", "context=selected&uid=old", "identity changed", 200},
		{"forbidden logs", "context=selected&previous=true", "forbidden", 403},
		{"missing previous", "context=selected&previous=1", "previous terminated container not found", 400},
		{"unknown context", "context=missing&previous=true", "unknown context", 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := &atomic.Int32{}
			_, base, wrong := newLogsTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.Header().Set("Content-Type", "application/json")
				if tc.name == "replacement" {
					if strings.HasSuffix(r.URL.Path, "/log") {
						t.Error("replacement log read")
					}
					_, _ = fmt.Fprint(w, `{"apiVersion":"v1","kind":"Pod","metadata":{"uid":"new"}}`)
					return
				}
				w.WriteHeader(tc.status)
				_ = json.NewEncoder(w).Encode(map[string]any{"kind": "Status", "apiVersion": "v1", "status": "Failure", "message": tc.message, "code": tc.status})
			}))
			for _, token := range []string{"", "wrong"} {
				conn, resp, err := websocket.DefaultDialer.Dial(base+"?token="+token+"&"+tc.query, nil)
				if conn != nil {
					_ = conn.Close()
				}
				if err == nil || resp == nil || resp.StatusCode != 401 {
					t.Fatalf("auth not enforced: %v %v", resp, err)
				}
				_ = resp.Body.Close()
			}
			if calls.Load() != 0 {
				t.Fatal("unauthorized Kubernetes call")
			}
			conn := dialLogs(t, base, tc.query)
			_, data, err := conn.ReadMessage()
			if err != nil {
				t.Fatal(err)
			}
			var control struct {
				Marker        bool `json:"__kviewLogStream"`
				Type, Message string
			}
			if err := json.Unmarshal(data, &control); err != nil {
				t.Fatal(err)
			}
			if !control.Marker || control.Type != "error" || !strings.Contains(strings.ToLower(control.Message), tc.message) {
				t.Fatalf("control: %s", data)
			}
			if wrong.Load() != 0 {
				t.Fatal("fell back to active cluster")
			}
			if tc.name == "unknown context" && calls.Load() != 0 {
				t.Fatal("unknown context called Kubernetes")
			}
		})
	}
}

func TestLogsWSDisconnectCancelsIdleRequest(t *testing.T) {
	started, cancelled := make(chan struct{}), make(chan struct{})
	_, base, _ := newLogsTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		close(started)
		<-r.Context().Done()
		close(cancelled)
	}))
	conn := dialLogs(t, base, "context=selected&follow=1")
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("request did not start")
	}
	_ = conn.Close()
	select {
	case <-cancelled:
	case <-time.After(3 * time.Second):
		t.Fatal("idle Kubernetes stream was not cancelled")
	}
}
