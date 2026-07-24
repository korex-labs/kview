package main

import (
	"errors"
	"sync"
	"testing"

	"github.com/korex-labs/kview/v5/internal/launcher"
)

func TestRunApplicationWebviewStartsServerBeforeSynchronousLaunch(t *testing.T) {
	var mu sync.Mutex
	var events []string
	serverRelease := make(chan struct{})

	serve := func() error {
		mu.Lock()
		events = append(events, "serve")
		mu.Unlock()
		<-serverRelease
		return nil
	}
	launch := func() error {
		mu.Lock()
		events = append(events, "launch")
		mu.Unlock()
		close(serverRelease)
		return nil
	}

	if err := runApplication(launcher.ModeWebview, serve, launch); err != nil {
		t.Fatalf("runApplication() error = %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(events) != 2 || events[0] != "serve" || events[1] != "launch" {
		t.Fatalf("events = %v, want [serve launch]", events)
	}
}

func TestRunApplicationWebviewReturnsLaunchError(t *testing.T) {
	wantErr := errors.New("webview create failed")
	serverRelease := make(chan struct{})

	serve := func() error {
		<-serverRelease
		return nil
	}
	launch := func() error {
		close(serverRelease)
		return wantErr
	}

	if err := runApplication(launcher.ModeWebview, serve, launch); !errors.Is(err, wantErr) {
		t.Fatalf("runApplication() error = %v, want %v", err, wantErr)
	}
}

func TestRunApplicationServerDoesNotLaunch(t *testing.T) {
	wantErr := errors.New("server stopped")
	launched := false

	err := runApplication(
		launcher.ModeServer,
		func() error { return wantErr },
		func() error {
			launched = true
			return nil
		},
	)

	if !errors.Is(err, wantErr) {
		t.Fatalf("runApplication() error = %v, want %v", err, wantErr)
	}
	if launched {
		t.Fatal("server mode unexpectedly launched a desktop client")
	}
}
