package stream

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	corev1client "k8s.io/client-go/kubernetes/typed/core/v1"
	"k8s.io/client-go/tools/remotecommand"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube/poddebug"
	"github.com/korex-labs/kview/v5/internal/session"
)

type TerminalWS struct {
	Mgr      *cluster.Manager
	Sessions session.Manager
}

type wsWriter struct {
	conn *websocket.Conn
}

type terminalControlMessage struct {
	Type string `json:"type"`
	Cols uint16 `json:"cols"`
	Rows uint16 `json:"rows"`
}

type terminalSizeQueue struct {
	mu     sync.Mutex
	ch     chan remotecommand.TerminalSize
	closed bool
}

func newTerminalSizeQueue() *terminalSizeQueue {
	q := &terminalSizeQueue{ch: make(chan remotecommand.TerminalSize, 1)}
	q.Push(80, 24)
	return q
}

func (q *terminalSizeQueue) Push(cols, rows uint16) {
	if cols == 0 || rows == 0 {
		return
	}
	size := remotecommand.TerminalSize{Width: cols, Height: rows}
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed {
		return
	}
	select {
	case q.ch <- size:
		return
	default:
	}
	select {
	case <-q.ch:
	default:
	}
	select {
	case q.ch <- size:
	default:
	}
}

func (q *terminalSizeQueue) Next() *remotecommand.TerminalSize {
	size, ok := <-q.ch
	if !ok {
		return nil
	}
	return &size
}

func (q *terminalSizeQueue) Close() {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed {
		return
	}
	q.closed = true
	close(q.ch)
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
	defer func() { _ = conn.Close() }()

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

	var clients *cluster.Clients
	if sess.TargetCluster != "" {
		clients, _, err = t.Mgr.GetClientsForContext(ctx, sess.TargetCluster)
	} else {
		clients, _, err = t.Mgr.GetClients(ctx)
	}
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

	// Update session to starting/connecting before waiting for a debug container.
	sess.Status = session.StatusStarting
	sess.ConnectionState = session.ConnectionConnecting
	sess.UpdatedAt = time.Now().UTC()
	_ = t.Sessions.Update(ctx, sess)

	streamMode := sess.Metadata["streamMode"]
	if sess.Metadata["terminalKind"] == poddebug.TerminalKindPodDebug {
		waitCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
		defer cancel()
		lastStatus := ""
		err := waitForEphemeralContainer(waitCtx, clients.Clientset.CoreV1().Pods(ns), pod, container, func(status string) {
			if status == "" || status == lastStatus {
				return
			}
			lastStatus = status
			_ = conn.WriteMessage(websocket.TextMessage, []byte("\r\n\x1b[36m[pod-debug]\x1b[0m "+status+"\r\n"))
		})
		if err != nil {
			_ = conn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\nerror: debug container did not become ready: %v", err)))
			sess.Status = session.StatusFailed
			sess.ConnectionState = session.ConnectionClosed
			sess.UpdatedAt = time.Now().UTC()
			_ = t.Sessions.Update(ctx, sess)
			return
		}
	}

	restClient := clients.Clientset.CoreV1().RESTClient()
	req := restClient.Post().
		Resource("pods").
		Namespace(ns).
		Name(pod).
		Param("container", container).
		Param("stdin", "true").
		Param("stdout", "true").
		Param("stderr", "true").
		Param("tty", "true")

	if streamMode == poddebug.StreamModeAttach {
		req = req.SubResource("attach")
	} else {
		req = req.SubResource("exec")
		var cmd []string
		if shell, ok := sess.Metadata["shell"]; ok && shell != "" {
			// Explicit shell requested for this session.
			cmd = []string{"/bin/sh", "-c", "export TERM=xterm-256color COLORTERM=truecolor; exec \"$0\"", shell}
		} else {
			// Prefer bash when available, otherwise fall back to POSIX sh.
			cmd = []string{"/bin/sh", "-c", "export TERM=xterm-256color COLORTERM=truecolor; [ -x /bin/bash ] && exec /bin/bash || exec /bin/sh"}
		}
		for _, c := range cmd {
			req = req.Param("command", c)
		}
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

	stdinReader, stdinWriter := io.Pipe()
	sizeQueue := newTerminalSizeQueue()
	defer sizeQueue.Close()

	go func() {
		defer func() { _ = stdinWriter.Close() }()
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
			if mt == websocket.TextMessage {
				var control terminalControlMessage
				if err := json.Unmarshal(msg, &control); err == nil && control.Type == "resize" {
					sizeQueue.Push(control.Cols, control.Rows)
					continue
				}
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

	err = exec.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdin:             stdinReader,
		Stdout:            stdoutWriter,
		Stderr:            stdoutWriter,
		Tty:               true,
		TerminalSizeQueue: sizeQueue,
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

func waitForEphemeralContainer(ctx context.Context, pods corev1client.PodInterface, podName, containerName string, onStatus func(string)) error {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for {
		pod, err := pods.Get(ctx, podName, metav1.GetOptions{})
		if err != nil {
			return err
		}
		foundSpec := false
		for _, container := range pod.Spec.EphemeralContainers {
			if container.Name == containerName {
				foundSpec = true
				break
			}
		}
		if !foundSpec {
			return fmt.Errorf("ephemeral container %q is no longer present", containerName)
		}

		statusFound := false
		for _, status := range pod.Status.EphemeralContainerStatuses {
			if status.Name != containerName {
				continue
			}
			statusFound = true
			switch {
			case status.State.Running != nil:
				onStatus("debug container is running; attaching")
				return nil
			case status.State.Terminated != nil:
				terminated := status.State.Terminated
				return fmt.Errorf("container terminated (reason=%s, exitCode=%d): %s", terminated.Reason, terminated.ExitCode, terminated.Message)
			case status.State.Waiting != nil:
				waiting := status.State.Waiting
				message := "waiting for debug container"
				if waiting.Reason != "" {
					message += ": " + waiting.Reason
				}
				if waiting.Message != "" {
					message += " — " + waiting.Message
				}
				onStatus(message)
			}
			break
		}
		if !statusFound {
			onStatus("waiting for kubelet to create the debug container")
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}
