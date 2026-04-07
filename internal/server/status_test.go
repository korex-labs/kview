package server

import (
	"context"
	"testing"

	"kview/internal/runtime"
)

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
