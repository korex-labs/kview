package stream

import (
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"k8s.io/client-go/tools/remotecommand"

	"kview/internal/cluster"
	"kview/internal/session"
)

type TerminalWS struct {
	Mgr      *cluster.Manager
	Sessions session.Manager
}

type wsWriter struct {
	conn *websocket.Conn
}

func (w *wsWriter) Write(p []byte) (int, error) {
	if err := w.conn.WriteMessage(websocket.BinaryMessage, p); err != nil {
		return 0, err
	}
	return len(p), nil
}

func (t *TerminalWS) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	id := chi.URLParam(r, "id")
	if id == "" {
		http.Error(w, "missing session id", http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	sess, ok, err := t.Sessions.Get(ctx, id)
	if err != nil {
		_ = conn.WriteMessage(websocket.TextMessage, []byte("error: failed to get session"))
		return
	}
	if !ok {
		_ = conn.WriteMessage(websocket.TextMessage, []byte("error: session not found"))
		return
	}
	if sess.Type != session.TypeTerminal {
		_ = conn.WriteMessage(websocket.TextMessage, []byte("error: session is not terminal type"))
		return
	}

	clients, _, err := t.Mgr.GetClients(ctx)
	if err != nil {
		_ = conn.WriteMessage(websocket.TextMessage, []byte("error: failed to get Kubernetes client"))
		sess.Status = session.StatusFailed
		sess.ConnectionState = session.ConnectionClosed
		sess.UpdatedAt = time.Now().UTC()
		_ = t.Sessions.Update(ctx, sess)
		return
	}

	ns := sess.TargetNamespace
	pod := sess.TargetResource
	container := sess.TargetContainer
	if ns == "" || pod == "" {
		_ = conn.WriteMessage(websocket.TextMessage, []byte("error: session is missing namespace or pod"))
		sess.Status = session.StatusFailed
		sess.ConnectionState = session.ConnectionClosed
		sess.UpdatedAt = time.Now().UTC()
		_ = t.Sessions.Update(ctx, sess)
		return
	}

	var cmd []string
	if shell, ok := sess.Metadata["shell"]; ok && shell != "" {
		// Explicit shell requested for this session.
		cmd = []string{shell}
	} else {
		// Prefer bash when available, otherwise fall back to POSIX sh.
		cmd = []string{"/bin/sh", "-c", "[ -x /bin/bash ] && exec /bin/bash || exec /bin/sh"}
	}

	restClient := clients.Clientset.CoreV1().RESTClient()
	req := restClient.Post().
		Resource("pods").
		Namespace(ns).
		Name(pod).
		SubResource("exec").
		Param("container", container).
		Param("stdin", "true").
		Param("stdout", "true").
		Param("stderr", "true").
		Param("tty", "true")

	for _, c := range cmd {
		req = req.Param("command", c)
	}

	exec, err := remotecommand.NewSPDYExecutor(clients.RestConfig, http.MethodPost, req.URL())
	if err != nil {
		_ = conn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("error: failed to create executor: %v", err)))
		sess.Status = session.StatusFailed
		sess.ConnectionState = session.ConnectionClosed
		sess.UpdatedAt = time.Now().UTC()
		_ = t.Sessions.Update(ctx, sess)
		return
	}

	// Update session to starting/connecting.
	sess.Status = session.StatusStarting
	sess.ConnectionState = session.ConnectionConnecting
	sess.UpdatedAt = time.Now().UTC()
	_ = t.Sessions.Update(ctx, sess)

	stdinReader, stdinWriter := io.Pipe()

	go func() {
		defer stdinWriter.Close()
		for {
			mt, msg, err := conn.ReadMessage()
			if err != nil {
				return
			}
			if mt != websocket.TextMessage && mt != websocket.BinaryMessage {
				continue
			}
			if len(msg) == 0 {
				continue
			}
			if _, err := stdinWriter.Write(msg); err != nil {
				return
			}
		}
	}()

	stdoutWriter := &wsWriter{conn: conn}

	// Update session to running/connected once streaming starts.
	sess.Status = session.StatusRunning
	sess.ConnectionState = session.ConnectionConnected
	sess.UpdatedAt = time.Now().UTC()
	_ = t.Sessions.Update(ctx, sess)

	err = exec.Stream(remotecommand.StreamOptions{
		Stdin:  stdinReader,
		Stdout: stdoutWriter,
		Stderr: stdoutWriter,
		Tty:    true,
	})

	if err != nil {
		_ = conn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("error: stream ended: %v", err)))
		sess.Status = session.StatusFailed
	} else {
		sess.Status = session.StatusStopped
	}
	sess.ConnectionState = session.ConnectionClosed
	sess.UpdatedAt = time.Now().UTC()
	_ = t.Sessions.Update(ctx, sess)
}
