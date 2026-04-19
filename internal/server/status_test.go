package server

import (
	"context"
	"testing"

	"github.com/korex-labs/kview/internal/buildinfo"
	"github.com/korex-labs/kview/internal/runtime"
	"github.com/korex-labs/kview/internal/session"
)

func TestBuildStatusIncludesBackendVersion(t *testing.T) {
	prev := buildinfo.Version
	buildinfo.Version = "v9.9.9-test"
	defer func() { buildinfo.Version = prev }()

	s := &Server{}
	status := s.buildStatus(context.Background(), "")
	if status.Backend.Version != "v9.9.9-test" {
		t.Fatalf("backend version: got %q", status.Backend.Version)
	}
}

func TestUpdateConnectivityActivity_RegistersConnectedActivity(t *testing.T) {
	rt := runtime.NewManager()
	s := &Server{rt: rt}

	s.updateConnectivityActivity(statusClusterDTO{
		OK:            true,
		Context:       "dev",
		Cluster:       "dev-cluster",
		AuthInfo:      "dev-user",
		Namespace:     "default",
		ServerVersion: "v1.30.0",
	})

	act, ok, err := rt.Registry().Get(context.Background(), "connectivity:dev")
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("connectivity activity was not registered")
	}
	if act.Type != runtime.ActivityTypeConnectivity {
		t.Fatalf("type: got %q, want %q", act.Type, runtime.ActivityTypeConnectivity)
	}
	if act.Status != runtime.ActivityStatusRunning {
		t.Fatalf("status: got %q, want %q", act.Status, runtime.ActivityStatusRunning)
	}
	if act.Metadata["state"] != "connected" {
		t.Fatalf("state: got %q, want connected", act.Metadata["state"])
	}
	if act.Metadata["version"] != "v1.30.0" {
		t.Fatalf("version: got %q", act.Metadata["version"])
	}
}

func TestUpdateConnectivityActivity_UpdatesExistingActivityToFailed(t *testing.T) {
	rt := runtime.NewManager()
	s := &Server{rt: rt}

	s.updateConnectivityActivity(statusClusterDTO{
		OK:            true,
		Context:       "dev",
		Cluster:       "dev-cluster",
		ServerVersion: "v1.30.0",
	})
	first, ok, err := rt.Registry().Get(context.Background(), "connectivity:dev")
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("connectivity activity was not registered")
	}

	s.updateConnectivityActivity(statusClusterDTO{
		OK:      false,
		Context: "dev",
		Cluster: "dev-cluster",
		Message: "dial tcp: connection refused",
	})
	second, ok, err := rt.Registry().Get(context.Background(), "connectivity:dev")
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("connectivity activity disappeared")
	}
	if second.ID != first.ID {
		t.Fatalf("id changed: got %q, want %q", second.ID, first.ID)
	}
	if !second.CreatedAt.Equal(first.CreatedAt) {
		t.Fatalf("createdAt changed: got %s, want %s", second.CreatedAt, first.CreatedAt)
	}
	if second.Status != runtime.ActivityStatusFailed {
		t.Fatalf("status: got %q, want %q", second.Status, runtime.ActivityStatusFailed)
	}
	if second.Metadata["state"] != "disconnected" {
		t.Fatalf("state: got %q, want disconnected", second.Metadata["state"])
	}
	if second.Metadata["message"] != "dial tcp: connection refused" {
		t.Fatalf("message: got %q", second.Metadata["message"])
	}
}

func TestStopInactiveConnectivityActivitiesExceptStopsUnusedContext(t *testing.T) {
	rt := runtime.NewManager()
	s := &Server{rt: rt, sessions: session.NewInMemoryManager(rt.Registry())}

	s.updateConnectivityActivity(statusClusterDTO{OK: true, Context: "old"})
	s.updateConnectivityActivity(statusClusterDTO{OK: true, Context: "new"})

	s.stopInactiveConnectivityActivitiesExcept("new")

	oldAct, ok, err := rt.Registry().Get(context.Background(), "connectivity:old")
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("old connectivity activity disappeared")
	}
	if oldAct.Status != runtime.ActivityStatusStopped {
		t.Fatalf("old status: got %q, want %q", oldAct.Status, runtime.ActivityStatusStopped)
	}
	if oldAct.Metadata["state"] != "inactive" {
		t.Fatalf("old state: got %q, want inactive", oldAct.Metadata["state"])
	}

	newAct, ok, err := rt.Registry().Get(context.Background(), "connectivity:new")
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("new connectivity activity disappeared")
	}
	if newAct.Status != runtime.ActivityStatusRunning {
		t.Fatalf("new status: got %q, want %q", newAct.Status, runtime.ActivityStatusRunning)
	}
}

func TestStopInactiveConnectivityActivitiesExceptKeepsContextWithOpenSession(t *testing.T) {
	rt := runtime.NewManager()
	sessions := session.NewInMemoryManager(rt.Registry())
	s := &Server{rt: rt, sessions: sessions}

	s.updateConnectivityActivity(statusClusterDTO{OK: true, Context: "old"})
	s.updateConnectivityActivity(statusClusterDTO{OK: true, Context: "new"})
	_, err := sessions.Create(context.Background(), session.Session{
		ID:            "sess-old",
		Type:          session.TypeTerminal,
		Title:         "old shell",
		Status:        session.StatusRunning,
		TargetCluster: "old",
	})
	if err != nil {
		t.Fatal(err)
	}

	s.stopInactiveConnectivityActivitiesExcept("new")

	oldAct, ok, err := rt.Registry().Get(context.Background(), "connectivity:old")
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("old connectivity activity disappeared")
	}
	if oldAct.Status != runtime.ActivityStatusRunning {
		t.Fatalf("old status: got %q, want %q", oldAct.Status, runtime.ActivityStatusRunning)
	}

	if err := sessions.Stop(context.Background(), "sess-old"); err != nil {
		t.Fatal(err)
	}
	s.stopInactiveConnectivityActivitiesExcept("new")

	oldAct, ok, err = rt.Registry().Get(context.Background(), "connectivity:old")
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("old connectivity activity disappeared")
	}
	if oldAct.Status != runtime.ActivityStatusStopped {
		t.Fatalf("old status after session stop: got %q, want %q", oldAct.Status, runtime.ActivityStatusStopped)
	}
}

func TestIsBackgroundPollingPath(t *testing.T) {
	polling := []string{
		"/api/status",
		"/api/activity",
		"/api/dashboard/cluster",
		"/api/dataplane/work/live",
		"/api/dataplane/revision",
		"/api/namespaces/enrichment",
		"/api/sessions",
	}
	for _, path := range polling {
		if !isBackgroundPollingPath(path) {
			t.Fatalf("%s should be treated as background polling", path)
		}
	}
	if isBackgroundPollingPath("/api/namespaces") {
		t.Fatal("/api/namespaces should be treated as user/request activity")
	}
}
