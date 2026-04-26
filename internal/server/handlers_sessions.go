package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"

	"github.com/korex-labs/kview/internal/cluster"
	"github.com/korex-labs/kview/internal/kube"
	"github.com/korex-labs/kview/internal/kube/jobdebug"
	"github.com/korex-labs/kview/internal/runtime"
	"github.com/korex-labs/kview/internal/session"
	"github.com/korex-labs/kview/internal/stream"
	svcs "github.com/korex-labs/kview/internal/kube/resource/services"
)

func (s *Server) registerSessionRoutes(api chi.Router) {
	api.Get("/sessions", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutStatus)
		defer cancel()

		items, err := s.sessions.List(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to list sessions"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
	})

	api.Get("/sessions/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		if id == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing session id"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutStatus)
		defer cancel()

		sess, ok, err := s.sessions.Get(ctx, id)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to get session"})
			return
		}
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "session not found"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"item": sess})
	})

	api.Delete("/sessions/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		if id == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing session id"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutStatus)
		defer cancel()

		// Best-effort fetch before stopping so we can log which session was terminated.
		sess, _, _ := s.sessions.Get(ctx, id)

		if err := s.sessions.Stop(ctx, id); err != nil {
			if errors.Is(err, session.ErrNotFound) {
				writeJSON(w, http.StatusNotFound, map[string]any{"error": "session not found"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to stop session"})
			return
		}

		// Log termination into runtime logs so it appears in the Activity Panel Logs tab.
		if sess.ID != "" {
			logStructured(s.rt, runtime.LogLevelInfo, "sessions", "success",
				fmt.Sprintf("stopped session %s (%s)", sess.ID, sess.Title),
				"session_id", sess.ID, "kind", string(sess.Type))
			s.stopConnectivityActivityIfUnused(sess.TargetCluster)
		}

		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})

	// Optional placeholder endpoint to create fake sessions for testing.
	api.Post("/sessions", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutStatus)
		defer cancel()

		var body struct {
			Type            string `json:"type"`
			Title           string `json:"title"`
			TargetCluster   string `json:"targetCluster"`
			TargetNamespace string `json:"targetNamespace"`
			TargetResource  string `json:"targetResource"`
			TargetContainer string `json:"targetContainer"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid body"})
			return
		}

		var t session.Type
		switch body.Type {
		case string(session.TypeTerminal):
			t = session.TypeTerminal
		case string(session.TypePortForward):
			t = session.TypePortForward
		default:
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "unsupported session type"})
			return
		}

		sess := session.Session{
			Type:            t,
			Title:           body.Title,
			Status:          session.StatusPending,
			TargetCluster:   body.TargetCluster,
			TargetNamespace: body.TargetNamespace,
			TargetResource:  body.TargetResource,
			TargetContainer: body.TargetContainer,
			ConnectionState: session.ConnectionDisconnected,
		}

		created, err := s.sessions.Create(ctx, sess)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to create session"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"item": created})
	})

	api.Post("/sessions/terminal", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutDetail)
		defer cancel()

		var body struct {
			Namespace string `json:"namespace"`
			Pod       string `json:"pod"`
			Container string `json:"container"`
			Title     string `json:"title"`
			Shell     string `json:"shell"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid body"})
			return
		}
		if strings.TrimSpace(body.Namespace) == "" || strings.TrimSpace(body.Pod) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "namespace and pod are required"})
			return
		}

		clusterName := s.mgr.ActiveContext()
		title := strings.TrimSpace(body.Title)
		if title == "" {
			title = body.Pod
		}

		metadata := map[string]string{}
		if shell := strings.TrimSpace(body.Shell); shell != "" {
			metadata["shell"] = shell
		}

		sess := session.Session{
			Type:            session.TypeTerminal,
			Title:           title,
			Status:          session.StatusPending,
			CreatedAt:       time.Now().UTC(),
			UpdatedAt:       time.Now().UTC(),
			TargetCluster:   clusterName,
			TargetNamespace: body.Namespace,
			TargetResource:  body.Pod,
			TargetContainer: body.Container,
			ConnectionState: session.ConnectionDisconnected,
			Metadata:        metadata,
		}

		created, err := s.sessions.Create(ctx, sess)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to create terminal session"})
			return
		}
		logStructured(s.rt, runtime.LogLevelInfo, "sessions", "success",
			fmt.Sprintf("created terminal session %s for pod %s/%s (container=%s)", created.ID, body.Namespace, body.Pod, body.Container),
			"session_id", created.ID, "kind", "terminal", "namespace", body.Namespace, "name", body.Pod)
		writeJSON(w, http.StatusOK, map[string]any{"item": created})
	})

	api.Post("/container-commands/run", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutExec)
		defer cancel()

		var body kube.ContainerCommandRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid body"})
			return
		}
		if strings.TrimSpace(body.Namespace) == "" ||
			strings.TrimSpace(body.Pod) == "" ||
			strings.TrimSpace(body.Container) == "" ||
			strings.TrimSpace(body.Command) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "namespace, pod, container, and command are required"})
			return
		}

		contextName := s.readContextName(r)
		clients, clusterName, err := s.mgr.GetClientsForContext(ctx, contextName)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to get Kubernetes client"})
			return
		}

		runner := kube.ContainerCommandClient{
			Clientset:  clients.Clientset,
			RestConfig: clients.RestConfig,
		}
		result, err := runner.Run(ctx, body)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
			return
		}

		status := "success"
		level := runtime.LogLevelInfo
		if result.ExitCode != 0 {
			status = "failed"
			level = runtime.LogLevelWarn
		}
		logStructured(s.rt, level, "container-commands", status,
			fmt.Sprintf("ran container command for pod %s/%s (container=%s, exit=%d)", body.Namespace, body.Pod, body.Container, result.ExitCode),
			"context", clusterName, "namespace", body.Namespace, "name", body.Pod, "container", body.Container, "exitCode", fmt.Sprintf("%d", result.ExitCode))
		writeJSON(w, http.StatusOK, map[string]any{"item": result})
	})

	api.Post("/sessions/portforward", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutPortForward)
		defer cancel()

		var body struct {
			Namespace  string `json:"namespace"`
			Pod        string `json:"pod"`
			Service    string `json:"service"`
			RemotePort int    `json:"remotePort"`
			LocalPort  int    `json:"localPort"`
			LocalHost  string `json:"localHost"`
			Title      string `json:"title"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid body"})
			return
		}
		ns := strings.TrimSpace(body.Namespace)
		pod := strings.TrimSpace(body.Pod)
		serviceName := strings.TrimSpace(body.Service)
		if ns == "" || (pod == "" && serviceName == "") {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "namespace and one of pod/service are required"})
			return
		}
		if body.RemotePort <= 0 {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "remotePort must be > 0"})
			return
		}
		targetKind := "pod"
		targetResource := pod
		if serviceName != "" {
			targetKind = "service"
			targetResource = serviceName
		}

		clusterName := s.mgr.ActiveContext()
		title := strings.TrimSpace(body.Title)
		if title == "" {
			title = fmt.Sprintf("Port-forward %s/%s :%d", ns, targetResource, body.RemotePort)
		}

		baseMeta := map[string]string{
			"targetKind": targetKind,
			"remotePort": fmt.Sprintf("%d", body.RemotePort),
			"localHost":  strings.TrimSpace(body.LocalHost),
			"localPort":  "",
		}
		if pod != "" {
			baseMeta["pod"] = pod
		}
		if serviceName != "" {
			baseMeta["service"] = serviceName
			baseMeta["targetService"] = serviceName
		}

		sess := session.Session{
			Type:            session.TypePortForward,
			Title:           title,
			Status:          session.StatusPending,
			CreatedAt:       time.Now().UTC(),
			UpdatedAt:       time.Now().UTC(),
			TargetCluster:   clusterName,
			TargetNamespace: ns,
			TargetResource:  targetResource,
			ConnectionState: session.ConnectionDisconnected,
			Metadata:        baseMeta,
		}

		created, err := s.sessions.Create(ctx, sess)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to create port-forward session"})
			return
		}

		// Move to starting before initiating Kubernetes port-forward.
		created.Status = session.StatusStarting
		created.ConnectionState = session.ConnectionConnecting
		created.UpdatedAt = time.Now().UTC()
		if err := s.sessions.Update(ctx, created); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to update port-forward session"})
			return
		}

		clients, active, err := s.mgr.GetClients(ctx)
		if err != nil {
			logStructured(s.rt, runtime.LogLevelError, "portforward", "failure",
				fmt.Sprintf("failed to get clients for port-forward session %s: %v", created.ID, err),
				"session_id", created.ID, "kind", "portforward", "namespace", ns, "name", targetResource)
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
			return
		}

		localPort := 0
		if body.LocalPort > 0 {
			localPort = body.LocalPort
		} else if kube.IsTCPPortAvailable(strings.TrimSpace(body.LocalHost), body.RemotePort) {
			// Prefer same local port as remote when available.
			localPort = body.RemotePort
		}

		forwardPod := ""
		startForward := func(requestedLocal int) (int, func(), error) {
			if targetKind == "service" && forwardPod == "" {
				return kube.StartServicePortForward(ctx, clients, ns, targetResource, body.LocalHost, requestedLocal, body.RemotePort)
			}
			podTarget := targetResource
			if forwardPod != "" {
				podTarget = forwardPod
			}
			return kube.StartPodPortForward(ctx, clients, ns, podTarget, body.LocalHost, requestedLocal, body.RemotePort)
		}

		var effectiveLocal int
		var stopFn func()
		effectiveLocal, stopFn, err = startForward(localPort)
		if err != nil && body.LocalPort <= 0 && localPort == body.RemotePort {
			// Preferred local=remote was unavailable by start time; retry with random local port.
			effectiveLocal, stopFn, err = startForward(0)
		}

		if err != nil && targetKind == "service" {
			// Some clusters/kube-proxies do not support service port-forward robustly.
			// Fallback to one backing Pod while preserving service metadata in session.
			if podName, podErr := svcs.ResolveServiceTargetPod(ctx, clients, ns, targetResource); podErr == nil && podName != "" {
				forwardPod = podName
				effectiveLocal, stopFn, err = startForward(localPort)
				if err != nil && body.LocalPort <= 0 && localPort == body.RemotePort {
					effectiveLocal, stopFn, err = startForward(0)
				}
				if err == nil {
					if created.Metadata == nil {
						created.Metadata = map[string]string{}
					}
					created.Metadata["pod"] = podName
					created.Metadata["forwardMode"] = "service-via-pod"
					s.rt.Log(runtime.LogLevelWarn, "portforward",
						fmt.Sprintf("service port-forward fallback for session %s: %s/%s via pod %s",
							created.ID, ns, targetResource, podName))
				}
			}
		}
		if err != nil {
			logStructured(s.rt, runtime.LogLevelError, "portforward", "failure",
				fmt.Sprintf("failed to start port-forward for session %s: %v", created.ID, err),
				"session_id", created.ID, "kind", "portforward", "namespace", ns, "name", targetResource)
			created.Status = session.StatusFailed
			created.ConnectionState = session.ConnectionDisconnected
			created.UpdatedAt = time.Now().UTC()
			_ = s.sessions.Update(ctx, created)
			_ = s.sessions.Stop(ctx, created.ID)
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to start port-forward"})
			return
		}

		// Update session metadata with the effective local endpoint.
		created.Status = session.StatusRunning
		created.ConnectionState = session.ConnectionConnected
		if created.Metadata == nil {
			created.Metadata = map[string]string{}
		}
		created.Metadata["localPort"] = fmt.Sprintf("%d", effectiveLocal)
		if host := strings.TrimSpace(body.LocalHost); host != "" {
			created.Metadata["localHost"] = host
		} else {
			created.Metadata["localHost"] = "127.0.0.1"
		}
		created.UpdatedAt = time.Now().UTC()
		if err := s.sessions.Update(ctx, created); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to finalize port-forward session"})
			return
		}

		// Ensure Stop() will tear down the live port-forward bridge.
		if inMem, ok := s.sessions.(*session.InMemoryManager); ok {
			inMem.RegisterPortForward(created.ID, stopFn)
		}

		logStructured(s.rt, runtime.LogLevelInfo, "portforward", "success",
			fmt.Sprintf("started port-forward session %s for %s %s/%s local %s:%d -> %d",
				created.ID, targetKind, ns, targetResource, created.Metadata["localHost"], effectiveLocal, body.RemotePort),
			"session_id", created.ID, "kind", "portforward", "namespace", ns, "name", targetResource)

		writeJSON(w, http.StatusOK, map[string]any{
			"item":       created,
			"localPort":  effectiveLocal,
			"localHost":  created.Metadata["localHost"],
			"remotePort": body.RemotePort,
		})
	})

	api.Get("/sessions/{id}/terminal/ws", (&stream.TerminalWS{Mgr: s.mgr, Sessions: s.sessions}).ServeHTTP)

	api.Post("/namespaces/{ns}/job-runs/debug", func(w http.ResponseWriter, r *http.Request) {
		ctxName := r.Header.Get("X-Kview-Context")
		if ctxName == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error": &APIError{Code: ErrCodeValidation, Message: "missing X-Kview-Context header"},
			})
			return
		}
		ns := chi.URLParam(r, "ns")
		var body struct {
			Kind string `json:"kind"`
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Kind) == "" || strings.TrimSpace(body.Name) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": validationError("invalid body")})
			return
		}
		if body.Kind != string(jobdebug.SourceJob) && body.Kind != string(jobdebug.SourceCronJob) {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": validationError("kind must be Job or CronJob")})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutHelmMutate)
		defer cancel()
		clients, _, err := s.mgr.GetClientsForContext(ctx, ctxName)
		if err != nil {
			if errors.Is(err, cluster.ErrUnknownContext) {
				writeJSON(w, http.StatusNotFound, map[string]any{
					"error": &APIError{Code: ErrCodeNotFound, Message: err.Error()},
				})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]any{
				"error": &APIError{Code: ErrCodeInternal, Message: err.Error()},
			})
			return
		}

		resp, err := s.jobRuns.Start(ctx, clients, jobdebug.StartRequest{
			Context:   ctxName,
			Kind:      jobdebug.SourceKind(body.Kind),
			Namespace: ns,
			Name:      body.Name,
		})
		if err != nil {
			status, apiErr := mapKubeError(err)
			writeJSON(w, status, map[string]any{"context": ctxName, "error": apiErr})
			return
		}
		_ = s.dp.InvalidateJobsSnapshot(ctx, ctxName, ns)
		writeJSON(w, http.StatusOK, resp)
	})

	api.Get("/job-runs/{id}/ws", func(w http.ResponseWriter, r *http.Request) {
		sess, ok := s.jobRuns.Get(chi.URLParam(r, "id"))
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": &APIError{Code: ErrCodeNotFound, Message: "debug run not found"}})
			return
		}
		conn, err := (&websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }()
		sess.Stream(r.Context(), conn)
	})

	api.Post("/job-runs/{id}/stop", func(w http.ResponseWriter, r *http.Request) {
		ctxName := r.Header.Get("X-Kview-Context")
		if ctxName == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error": &APIError{Code: ErrCodeValidation, Message: "missing X-Kview-Context header"},
			})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutDetail)
		defer cancel()
		resp, err := s.jobRuns.Stop(ctx, chi.URLParam(r, "id"))
		if err != nil {
			status, apiErr := mapKubeError(err)
			writeJSON(w, status, map[string]any{"context": ctxName, "error": apiErr})
			return
		}
		_ = s.dp.InvalidateJobsSnapshot(ctx, ctxName, resp.Namespace)
		writeJSON(w, http.StatusOK, resp)
	})

	api.Delete("/job-runs/{id}", func(w http.ResponseWriter, r *http.Request) {
		s.jobRuns.Close(chi.URLParam(r, "id"))
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
	})
}
