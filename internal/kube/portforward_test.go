package kube

import (
	"context"
	"net"
	"strings"
	"testing"

	"k8s.io/client-go/rest"

	"github.com/korex-labs/kview/internal/cluster"
)

// fakeClients returns a *cluster.Clients with a non-nil RestConfig so that
// validation checks past the nil guard are exercised without a real cluster.
func fakeClients() *cluster.Clients {
	return &cluster.Clients{RestConfig: &rest.Config{Host: "https://localhost:6443"}}
}

func TestIsTCPPortAvailable_ZeroPort(t *testing.T) {
	if IsTCPPortAvailable("127.0.0.1", 0) {
		t.Error("port 0 should not be available")
	}
}

func TestIsTCPPortAvailable_NegativePort(t *testing.T) {
	if IsTCPPortAvailable("127.0.0.1", -1) {
		t.Error("negative port should not be available")
	}
}

func TestIsTCPPortAvailable_FreePort(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	_ = ln.Close()

	if !IsTCPPortAvailable("127.0.0.1", port) {
		t.Errorf("port %d should be available after close", port)
	}
}

func TestIsTCPPortAvailable_OccupiedPort(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer func() { _ = ln.Close() }()
	port := ln.Addr().(*net.TCPAddr).Port

	if IsTCPPortAvailable("127.0.0.1", port) {
		t.Errorf("port %d should not be available while occupied", port)
	}
}

func TestIsTCPPortAvailable_EmptyHostDefaultsToLoopback(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	_ = ln.Close()

	if !IsTCPPortAvailable("", port) {
		t.Errorf("empty host with free port %d should be available", port)
	}
}

func TestStartPortForward_NilClients(t *testing.T) {
	_, _, err := startPortForward(context.Background(), nil, "ns", "pods", "pod", "127.0.0.1", 0, 8080)
	if err == nil || !strings.Contains(err.Error(), "rest config") {
		t.Errorf("expected rest config error, got %v", err)
	}
}

func TestStartPortForward_NilRestConfig(t *testing.T) {
	c := &cluster.Clients{} // RestConfig is nil
	_, _, err := startPortForward(context.Background(), c, "ns", "pods", "pod", "127.0.0.1", 0, 8080)
	if err == nil {
		t.Fatal("expected error for nil RestConfig")
	}
}

func TestStartPortForward_EmptyNamespace(t *testing.T) {
	_, _, err := startPortForward(context.Background(), fakeClients(), "", "pods", "pod", "127.0.0.1", 0, 8080)
	if err == nil {
		t.Fatal("expected error for empty namespace")
	}
}

func TestStartPortForward_WhitespaceResourceName(t *testing.T) {
	_, _, err := startPortForward(context.Background(), fakeClients(), "ns", "pods", "   ", "127.0.0.1", 0, 8080)
	if err == nil {
		t.Fatal("expected error for whitespace resource name")
	}
}

func TestStartPortForward_ZeroRemotePort(t *testing.T) {
	_, _, err := startPortForward(context.Background(), fakeClients(), "ns", "pods", "pod", "127.0.0.1", 0, 0)
	if err == nil {
		t.Fatal("expected error for zero remote port")
	}
}

func TestStartPortForward_NegativeRemotePort(t *testing.T) {
	_, _, err := startPortForward(context.Background(), fakeClients(), "ns", "pods", "pod", "127.0.0.1", 0, -1)
	if err == nil {
		t.Fatal("expected error for negative remote port")
	}
}

func TestStartPodPortForward_NilClients(t *testing.T) {
	_, _, err := StartPodPortForward(context.Background(), nil, "ns", "pod", "127.0.0.1", 0, 8080)
	if err == nil {
		t.Fatal("expected error for nil clients")
	}
}

func TestStartServicePortForward_NilClients(t *testing.T) {
	_, _, err := StartServicePortForward(context.Background(), nil, "ns", "svc", "127.0.0.1", 0, 8080)
	if err == nil {
		t.Fatal("expected error for nil clients")
	}
}
