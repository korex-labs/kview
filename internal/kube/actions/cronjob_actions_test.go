package actions

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"

	"github.com/korex-labs/kview/v5/internal/cluster"
)

func newCronJobSuspendTestClients(t *testing.T, wantSuspend string) (*cluster.Clients, *httptest.Server) {
	t.Helper()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch {
			t.Errorf("method: got %s, want PATCH", r.Method)
		}
		if r.URL.Path != "/apis/batch/v1/namespaces/default/cronjobs/nightly" {
			t.Errorf("path: got %s", r.URL.Path)
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read body: %v", err)
		}
		if !strings.Contains(string(body), `"suspend":`+wantSuspend) {
			t.Errorf("patch body: got %s, want suspend %s", string(body), wantSuspend)
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"apiVersion":"batch/v1",
			"kind":"CronJob",
			"metadata":{"name":"nightly","namespace":"default"},
			"spec":{"schedule":"* * * * *","suspend":` + wantSuspend + `}
		}`))
	}))

	clientset, err := kubernetes.NewForConfig(&rest.Config{Host: server.URL})
	if err != nil {
		server.Close()
		t.Fatalf("new clientset: %v", err)
	}
	return &cluster.Clients{Clientset: clientset}, server
}

func TestHandleCronJobSuspendSetsSuspend(t *testing.T) {
	clients, server := newCronJobSuspendTestClients(t, "true")
	defer server.Close()

	result, err := HandleCronJobSuspend(context.Background(), clients, ActionRequest{
		Group:     "batch",
		Resource:  "cronjobs",
		Namespace: "default",
		Name:      "nightly",
		Params:    map[string]any{"suspend": true},
	})
	if err != nil {
		t.Fatalf("HandleCronJobSuspend returned error: %v", err)
	}
	if result.Status != "ok" {
		t.Fatalf("status: got %q, want ok", result.Status)
	}
	if result.Details["suspend"] != true {
		t.Fatalf("details.suspend: got %v, want true", result.Details["suspend"])
	}
}

func TestHandleCronJobSuspendClearsSuspend(t *testing.T) {
	clients, server := newCronJobSuspendTestClients(t, "false")
	defer server.Close()

	result, err := HandleCronJobSuspend(context.Background(), clients, ActionRequest{
		Group:     "batch",
		Resource:  "cronjobs",
		Namespace: "default",
		Name:      "nightly",
		Params:    map[string]any{"suspend": false},
	})
	if err != nil {
		t.Fatalf("HandleCronJobSuspend returned error: %v", err)
	}
	if result.Status != "ok" {
		t.Fatalf("status: got %q, want ok", result.Status)
	}
	if result.Details["suspend"] != false {
		t.Fatalf("details.suspend: got %v, want false", result.Details["suspend"])
	}
}

func TestHandleCronJobSuspendRequiresSuspendParam(t *testing.T) {
	result, err := HandleCronJobSuspend(context.Background(), nil, ActionRequest{
		Group:     "batch",
		Resource:  "cronjobs",
		Namespace: "default",
		Name:      "nightly",
	})
	if err != nil {
		t.Fatalf("HandleCronJobSuspend returned error: %v", err)
	}
	if result.Status != "error" {
		t.Fatalf("status: got %q, want error", result.Status)
	}
	if result.Message != "params.suspend is required" {
		t.Fatalf("message: got %q", result.Message)
	}
}
