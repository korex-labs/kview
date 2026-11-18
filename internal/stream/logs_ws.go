package stream

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/v5/internal/cluster"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type LogsWS struct {
	Mgr *cluster.Manager
}

type logStreamControlMessage struct {
	KviewLogStream bool   `json:"__kviewLogStream"`
	Type           string `json:"type"`
	Message        string `json:"message"`
}

func writeLogStreamError(conn *websocket.Conn, err error) {
	if err == nil {
		return
	}
	msg, marshalErr := json.Marshal(logStreamControlMessage{
		KviewLogStream: true,
		Type:           "error",
		Message:        err.Error(),
	})
	if marshalErr != nil {
		msg = []byte("ERROR: " + err.Error())
	}
	_ = conn.WriteMessage(websocket.TextMessage, msg)
}

func (h *LogsWS) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "ns")
	pod := chi.URLParam(r, "name")
	container := r.URL.Query().Get("container")

	tail := int64(200)
	if v := r.URL.Query().Get("tail"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n >= 0 && n <= 5000 {
			tail = n
		}
	}

	previous := r.URL.Query().Get("previous") == "1" || r.URL.Query().Get("previous") == "true"
	follow := !previous && (r.URL.Query().Get("follow") == "1" || r.URL.Query().Get("follow") == "true")

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer func() { _ = conn.Close() }()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	// Observe browser disconnects even while Kubernetes is idle or opening the stream.
	conn.SetReadLimit(1024)
	go func() {
		defer cancel()
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()

	contextName := r.URL.Query().Get("context")
	var clients *cluster.Clients
	if contextName != "" {
		clients, _, err = h.Mgr.GetClientsForContext(ctx, contextName)
	} else {
		clients, _, err = h.Mgr.GetClients(ctx)
	}
	if err != nil {
		writeLogStreamError(conn, err)
		return
	}

	// Bind a drawer to the Pod instance it loaded, not a replacement with the same name.
	if expectedUID := r.URL.Query().Get("uid"); expectedUID != "" {
		current, getErr := clients.Clientset.CoreV1().Pods(ns).Get(ctx, pod, metav1.GetOptions{})
		if getErr != nil {
			writeLogStreamError(conn, getErr)
			return
		}
		if string(current.UID) != expectedUID {
			writeLogStreamError(conn, fmt.Errorf("pod identity changed; reopen the Pod drawer"))
			return
		}
	}

	opts := &v1.PodLogOptions{
		Container: container,
		Follow:    follow,
		Previous:  previous,
	}
	if tail > 0 {
		opts.TailLines = &tail
	}

	req := clients.Clientset.CoreV1().Pods(ns).GetLogs(pod, opts)
	stream, err := req.Stream(ctx)
	if err != nil {
		writeLogStreamError(conn, err)
		return
	}
	defer func() { _ = stream.Close() }()

	// keepalive ping
	go func() {
		t := time.NewTicker(20 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if err := conn.WriteControl(websocket.PingMessage, []byte("ping"), time.Now().Add(2*time.Second)); err != nil {
					cancel()
					return
				}
			}
		}
	}()

	reader := bufio.NewReader(stream)
	for {
		line, err := reader.ReadBytes('\n')
		if len(line) > 0 {
			_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := conn.WriteMessage(websocket.TextMessage, line); err != nil {
				return
			}
		}
		if err != nil {
			if err == io.EOF {
				_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""), time.Now().Add(2*time.Second))
				return
			}
			writeLogStreamError(conn, err)
			return
		}
	}
}
