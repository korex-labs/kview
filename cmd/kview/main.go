package main

import (
	"crypto/rand"
	"encoding/hex"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"runtime"

	"kview/internal/cluster"
	"kview/internal/kube"
	"kview/internal/server"
)

func main() {
	addr := flag.String("listen", "127.0.0.1:10443", "listen address")
	open := flag.Bool("open", true, "open browser")
	flag.Parse()

	mgr, err := cluster.NewManager()
	if err != nil {
		log.Fatalf("init cluster manager: %v", err)
	}

	token := randomToken(24)
	srv := server.New(mgr, token)

	srv.Actions().Register("scale", kube.HandleDeploymentScale)
	srv.Actions().Register("restart", kube.HandleDeploymentRestart)
	srv.Actions().Register("delete", kube.HandleDeploymentDelete)

	url := fmt.Sprintf("http://%s/?token=%s", *addr, token)
	log.Printf("kview listening on http://%s", *addr)
	log.Printf("open: %s", url)

	if *open {
		_ = openBrowser(url)
	}

	if err := http.ListenAndServe(*addr, srv.Router()); err != nil {
		log.Fatalf("listen: %v", err)
	}
}

func randomToken(nbytes int) string {
	b := make([]byte, nbytes)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func openBrowser(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "linux":
		cmd = exec.Command("xdg-open", url)
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		return nil
	}
	return cmd.Start()
}

