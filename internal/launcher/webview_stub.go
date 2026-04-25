//go:build !webview

package launcher

import "fmt"

// launchWebview is a stub used when the "webview" build tag is not enabled.
// It allows the main binary to build without native WebKit/GTK dependencies.
func launchWebview(url string) error {
	return fmt.Errorf("webview mode is not available in this build (missing 'webview' build tag)")
}
