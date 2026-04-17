//go:build !webview

package main

import "github.com/alex-mamchenkov/kview/internal/launcher"

// defaultMode is the fallback launcher mode when no explicit --mode is provided.
// For regular builds (no webview tag) we keep the current behavior: browser.
var defaultMode = launcher.ModeBrowser

