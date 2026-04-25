package launcher

import (
	"log"
	"os/exec"
	"runtime"
)

// launchBrowser starts the system browser pointing at the given URL.
func launchBrowser(url string) error {
	var cmd *exec.Cmd

	switch runtime.GOOS {
	case "linux":
		cmd = exec.Command("xdg-open", url)
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		// No-op on unsupported platforms.
		return nil
	}

	return cmd.Start()
}

// Launch dispatches to the appropriate launcher for the given mode.
// For ModeServer it is a no-op.
func Launch(mode Mode, url string) error {
	switch mode {
	case ModeServer:
		log.Printf("starting in server-only mode")
		return nil
	case ModeBrowser:
		log.Printf("starting in browser mode")
		return launchBrowser(url)
	case ModeWebview:
		log.Printf("starting in webview mode")
		return launchWebview(url)
	default:
		// Should not happen if ResolveMode is used.
		log.Printf("unknown launch mode %q, defaulting to browser", mode)
		return launchBrowser(url)
	}
}
