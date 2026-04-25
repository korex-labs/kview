package launcher

import (
	"fmt"
	"strings"
)

type Mode string

const (
	ModeBrowser Mode = "browser"
	ModeWebview Mode = "webview"
	ModeServer  Mode = "server"
)

// ResolveMode chooses the effective launch mode, preserving the old --open flag semantics.
//
// Rules:
//   - if rawMode is non-empty, it wins (must be browser|webview|server)
//   - if rawMode is empty and open=false, use server mode
//   - otherwise default to browser mode
func ResolveMode(rawMode string, open bool, fallback Mode) (Mode, error) {
	if rawMode != "" {
		m := Mode(strings.ToLower(strings.TrimSpace(rawMode)))
		switch m {
		case ModeBrowser, ModeWebview, ModeServer:
			return m, nil
		default:
			return "", fmt.Errorf("invalid mode %q (expected browser, webview, or server)", rawMode)
		}
	}

	if !open {
		return ModeServer, nil
	}

	return fallback, nil
}
