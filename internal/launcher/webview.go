//go:build webview

package launcher

import (
	"os"

	"github.com/webview/webview_go"
)

// launchWebview opens a minimal desktop webview window that loads the given URL.
// It intentionally keeps all logic here and does not depend on the rest of the app.
func launchWebview(url string) error {
	w := webview.New(true)
	defer w.Destroy()

	w.SetTitle("kview")
	w.SetSize(1200, 800, webview.HintNone)
	w.Navigate(url)
	w.Run()
	// When the webview window is closed, terminate the whole process so that
	// the kview backend exits along with the desktop shell.
	os.Exit(0)
	return nil
}
