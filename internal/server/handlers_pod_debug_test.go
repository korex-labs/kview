package server

import (
	"context"
	"testing"

	"github.com/korex-labs/kview/v5/internal/kube/poddebug"
	kviewruntime "github.com/korex-labs/kview/v5/internal/runtime"
	"github.com/korex-labs/kview/v5/internal/session"
)

func TestFindPodDebugSessionRequiresExactRequestIdentity(t *testing.T) {
	manager := session.NewInMemoryManager(kviewruntime.NewInMemoryActivityRegistry())
	server := &Server{sessions: manager}
	request := podDebugSessionRequest{
		Namespace:       "default",
		Pod:             "api-0",
		ExpectedUID:     "pod-uid",
		TargetContainer: "app",
		Image:           "debug:v1",
		Shell:           "/bin/sh",
		Profile:         poddebug.ProfileBaseline,
		RequestID:       "request-1",
	}
	created, err := manager.Create(context.Background(), session.Session{
		Type:            session.TypeTerminal,
		TargetCluster:   "kind-dev",
		TargetNamespace: request.Namespace,
		TargetResource:  request.Pod,
		TargetContainer: "kview-debug-abc",
		Metadata: map[string]string{
			"terminalKind":         poddebug.TerminalKindPodDebug,
			"debugRequestID":       request.RequestID,
			"debugTargetContainer": request.TargetContainer,
			"debugImage":           request.Image,
			"debugProfile":         request.Profile,
			"shell":                request.Shell,
			"podUID":               request.ExpectedUID,
		},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	found, ok := server.findPodDebugSession(context.Background(), "kind-dev", request, "kview-debug-abc")
	if !ok || found.ID != created.ID {
		t.Fatalf("expected exact session match, got %#v, ok=%v", found, ok)
	}

	changedImage := request
	changedImage.Image = "debug:v2"
	if _, ok := server.findPodDebugSession(context.Background(), "kind-dev", changedImage, "kview-debug-abc"); ok {
		t.Fatal("session with a different image must not be reused")
	}
	changedUID := request
	changedUID.ExpectedUID = "new-pod-uid"
	if _, ok := server.findPodDebugSession(context.Background(), "kind-dev", changedUID, "kview-debug-abc"); ok {
		t.Fatal("session from a previous Pod UID must not be reused")
	}
}
