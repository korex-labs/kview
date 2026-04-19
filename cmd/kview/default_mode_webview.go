//go:build webview

package main

import "github.com/korex-labs/kview/internal/launcher"

// For webview builds, prefer webview as the default launcher mode when --mode is not set.
var defaultMode = launcher.ModeWebview

