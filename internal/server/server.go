package server

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	apierrors "k8s.io/apimachinery/pkg/api/errors"

	"kview/internal/cluster"
	"kview/internal/dataplane"
	"kview/internal/kube"
	"kview/internal/runtime"
	"kview/internal/session"
	"kview/internal/stream"
)

//go:embed ui_dist
var uiFS embed.FS

type Server struct {
	mgr            *cluster.Manager
	token          string
	actions        *kube.ActionRegistry
	rt             runtime.RuntimeManager
	dp             dataplane.DataPlaneManager
	sessions       session.Manager
	deniedLogMu    sync.Mutex
	deniedLogUntil map[string]time.Time
}

func New(mgr *cluster.Manager, rt runtime.RuntimeManager, token string) *Server {
	dpMgr := dataplane.NewManager(dataplane.ManagerConfig{
		ClusterManager: mgr,
	})

	s := &Server{
		mgr:            mgr,
		token:          token,
		actions:        kube.NewActionRegistry(),
		rt:             rt,
		dp:             dpMgr,
		sessions:       session.NewInMemoryManager(rt.Registry()),
		deniedLogUntil: map[string]time.Time{},
	}
	// Best-effort runtime manager startup; failures are logged via regular logs.
	_ = s.rt.Start(context.Background())
	return s
}

// Actions returns the action registry for registering handlers.
func (s *Server) Actions() *kube.ActionRegistry {
	return s.actions
}

// Runtime exposes the runtime manager for startup/launcher logging.
func (s *Server) Runtime() runtime.RuntimeManager {
	return s.rt
}

func (s *Server) Sessions() session.Manager {
	return s.sessions
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"http://localhost:*", "http://127.0.0.1:*"},
		AllowedMethods:   []string{"GET", "POST", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Kview-Context"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	// Protected API
	r.Route("/api", func(api chi.Router) {
		api.Use(s.authMiddleware)
		api.Use(s.activityAccessDeniedLogMiddleware)

		api.Get("/activity", func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
			defer cancel()

			activities, err := s.rt.Registry().List(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to list activities"})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{
				"items": activities,
			})
		})

		api.Get("/activity/{id}/logs", func(w http.ResponseWriter, r *http.Request) {
			id := chi.URLParam(r, "id")
			if id == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing activity id"})
				return
			}

			// Phase 2A: only runtime/system activity exposes logs.
			if id != runtime.RuntimeActivityID {
				writeJSON(w, http.StatusNotFound, map[string]any{"error": "logs not available for this activity"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
			defer cancel()

			logs := s.rt.Logs().List(ctx)
			writeJSON(w, http.StatusOK, map[string]any{"items": logs})
		})

		api.Get("/sessions", func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
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
			ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
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
			ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
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
			}

			writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		})

		// Optional placeholder endpoint to create fake sessions for testing.
		api.Post("/sessions", func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
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
			ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
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

		api.Post("/sessions/portforward", func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
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
				if podName, podErr := kube.ResolveServiceTargetPod(ctx, clients, ns, targetResource); podErr == nil && podName != "" {
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

		api.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, http.StatusOK, map[string]any{
				"ok":            true,
				"activeContext": s.mgr.ActiveContext(),
			})
		})

		api.Get("/contexts", func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, http.StatusOK, map[string]any{
				"active":   s.mgr.ActiveContext(),
				"contexts": s.mgr.ListContexts(),
			})
		})

		api.Post("/context/select", func(w http.ResponseWriter, r *http.Request) {
			var body struct {
				Name string `json:"name"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid body"})
				return
			}
			if err := s.mgr.SetActiveContext(body.Name); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"active": s.mgr.ActiveContext()})
		})

		api.Get("/namespaces", func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			nss, err := kube.ListNamespaces(ctx, clients)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{
				"active":  active,
				"limited": false,
				"items":   nss,
			})
		})

		api.Get("/namespaces/{name}", func(w http.ResponseWriter, r *http.Request) {
			name := chi.URLParam(r, "name")
			if name == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace name"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := kube.GetNamespaceDetails(ctx, clients, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": det})
		})

		api.Get("/namespaces/{name}/summary", func(w http.ResponseWriter, r *http.Request) {
			name := chi.URLParam(r, "name")
			if name == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace name"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			summary, err := kube.GetNamespaceSummary(ctx, clients, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": summary})
		})

		api.Get("/namespaces/{name}/resourcequotas", func(w http.ResponseWriter, r *http.Request) {
			name := chi.URLParam(r, "name")
			if name == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace name"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			result, err := kube.ListResourceQuotas(ctx, clients, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": result.Items})
		})

		api.Post("/auth/can-i", func(w http.ResponseWriter, r *http.Request) {
			var body struct {
				Verb      string  `json:"verb"`
				Resource  string  `json:"resource"`
				Group     string  `json:"group"`
				Namespace *string `json:"namespace"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Verb == "" || body.Resource == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid body"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			res, err := kube.SelfSubjectAccessReview(ctx, clients, kube.AccessReviewRequest{
				Verb:      body.Verb,
				Resource:  body.Resource,
				Group:     body.Group,
				Namespace: body.Namespace,
			})
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"allowed": res.Allowed, "reason": res.Reason})
		})

		api.Get("/nodes", func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			items, err := kube.ListNodes(ctx, clients)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": items})
		})

		api.Get("/nodes/{name}", func(w http.ResponseWriter, r *http.Request) {
			name := chi.URLParam(r, "name")
			if name == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing node name"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := kube.GetNodeDetails(ctx, clients, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": det})
		})

		api.Get("/clusterroles", func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			items, err := kube.ListClusterRoles(ctx, clients)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": items})
		})

		api.Get("/clusterroles/{name}", func(w http.ResponseWriter, r *http.Request) {
			name := chi.URLParam(r, "name")
			if name == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing clusterrole name"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := kube.GetClusterRoleDetails(ctx, clients, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": det})
		})

		api.Get("/clusterroles/{name}/events", func(w http.ResponseWriter, r *http.Request) {
			name := chi.URLParam(r, "name")
			if name == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing clusterrole name"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kube.ListEventsForObject(ctx, clients, "", "ClusterRole", name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": evs})
		})

		api.Get("/clusterroles/{name}/yaml", func(w http.ResponseWriter, r *http.Request) {
			name := chi.URLParam(r, "name")
			if name == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing clusterrole name"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			y, err := kube.GetClusterRoleYAML(ctx, clients, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "yaml": y})
		})

		api.Get("/clusterrolebindings", func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			items, err := kube.ListClusterRoleBindings(ctx, clients)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": items})
		})

		api.Get("/clusterrolebindings/{name}", func(w http.ResponseWriter, r *http.Request) {
			name := chi.URLParam(r, "name")
			if name == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing clusterrolebinding name"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := kube.GetClusterRoleBindingDetails(ctx, clients, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": det})
		})

		api.Get("/clusterrolebindings/{name}/events", func(w http.ResponseWriter, r *http.Request) {
			name := chi.URLParam(r, "name")
			if name == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing clusterrolebinding name"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kube.ListEventsForObject(ctx, clients, "", "ClusterRoleBinding", name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": evs})
		})

		api.Get("/clusterrolebindings/{name}/yaml", func(w http.ResponseWriter, r *http.Request) {
			name := chi.URLParam(r, "name")
			if name == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing clusterrolebinding name"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			y, err := kube.GetClusterRoleBindingYAML(ctx, clients, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "yaml": y})
		})

		api.Get("/customresourcedefinitions", func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			items, err := kube.ListCustomResourceDefinitions(ctx, clients)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": items})
		})

		api.Get("/customresourcedefinitions/{name}", func(w http.ResponseWriter, r *http.Request) {
			name := chi.URLParam(r, "name")
			if name == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing customresourcedefinition name"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := kube.GetCustomResourceDefinitionDetails(ctx, clients, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": det})
		})

		api.Get("/customresourcedefinitions/{name}/events", func(w http.ResponseWriter, r *http.Request) {
			name := chi.URLParam(r, "name")
			if name == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing customresourcedefinition name"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kube.ListEventsForObject(ctx, clients, "", "CustomResourceDefinition", name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": evs})
		})

		api.Get("/customresourcedefinitions/{name}/yaml", func(w http.ResponseWriter, r *http.Request) {
			name := chi.URLParam(r, "name")
			if name == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing customresourcedefinition name"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			y, err := kube.GetCustomResourceDefinitionYAML(ctx, clients, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "yaml": y})
		})

		api.Get("/persistentvolumes", func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			items, err := kube.ListPersistentVolumes(ctx, clients)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": items})
		})

		api.Get("/persistentvolumes/{name}", func(w http.ResponseWriter, r *http.Request) {
			name := chi.URLParam(r, "name")
			if name == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing persistentvolume name"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := kube.GetPersistentVolumeDetails(ctx, clients, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": det})
		})

		api.Get("/persistentvolumes/{name}/events", func(w http.ResponseWriter, r *http.Request) {
			name := chi.URLParam(r, "name")
			if name == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing persistentvolume name"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kube.ListEventsForObject(ctx, clients, "", "PersistentVolume", name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": evs})
		})

		api.Get("/persistentvolumes/{name}/yaml", func(w http.ResponseWriter, r *http.Request) {
			name := chi.URLParam(r, "name")
			if name == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing persistentvolume name"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			y, err := kube.GetPersistentVolumeYAML(ctx, clients, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "yaml": y})
		})

		api.Get("/namespaces/{ns}/pods", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			if ns == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			pods, err := kube.ListPods(ctx, clients, ns)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": pods})
		})

		api.Get("/namespaces/{ns}/pods/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := kube.GetPodDetails(ctx, clients, ns, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": det})
		})

		api.Get("/namespaces/{ns}/pods/{name}/events", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kube.ListEventsForPod(ctx, clients, ns, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": evs})
		})

		api.Get("/namespaces/{ns}/pods/{name}/services", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			items, err := kube.ListServicesSelectingPod(ctx, clients, ns, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": items})
		})

		api.Get("/namespaces/{ns}/pods/{name}/logs/ws", (&stream.LogsWS{Mgr: s.mgr}).ServeHTTP)
		api.Get("/sessions/{id}/terminal/ws", (&stream.TerminalWS{Mgr: s.mgr, Sessions: s.sessions}).ServeHTTP)

		api.Get("/namespaces/{ns}/deployments", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			if ns == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			items, err := kube.ListDeployments(ctx, clients, ns)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": items})
		})

		api.Get("/namespaces/{ns}/deployments/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := kube.GetDeploymentDetails(ctx, clients, ns, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": det})
		})

		api.Get("/namespaces/{ns}/deployments/{name}/events", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kube.ListEventsForObject(ctx, clients, ns, "Deployment", name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": evs})
		})

		api.Get("/namespaces/{ns}/daemonsets", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			if ns == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			items, err := kube.ListDaemonSets(ctx, clients, ns)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": items})
		})

		api.Get("/namespaces/{ns}/daemonsets/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := kube.GetDaemonSetDetails(ctx, clients, ns, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": det})
		})

		api.Get("/namespaces/{ns}/daemonsets/{name}/events", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kube.ListEventsForObject(ctx, clients, ns, "DaemonSet", name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": evs})
		})

		api.Get("/namespaces/{ns}/daemonsets/{name}/yaml", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			y, err := kube.GetDaemonSetYAML(ctx, clients, ns, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "yaml": y})
		})

		api.Get("/namespaces/{ns}/statefulsets", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			if ns == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			items, err := kube.ListStatefulSets(ctx, clients, ns)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": items})
		})

		api.Get("/namespaces/{ns}/statefulsets/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := kube.GetStatefulSetDetails(ctx, clients, ns, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": det})
		})

		api.Get("/namespaces/{ns}/statefulsets/{name}/events", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kube.ListEventsForObject(ctx, clients, ns, "StatefulSet", name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": evs})
		})

		api.Get("/namespaces/{ns}/statefulsets/{name}/yaml", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			y, err := kube.GetStatefulSetYAML(ctx, clients, ns, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "yaml": y})
		})

		api.Get("/namespaces/{ns}/replicasets", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			if ns == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			items, err := kube.ListReplicaSets(ctx, clients, ns)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": items})
		})

		api.Get("/namespaces/{ns}/replicasets/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := kube.GetReplicaSetDetails(ctx, clients, ns, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": det})
		})

		api.Get("/namespaces/{ns}/replicasets/{name}/events", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kube.ListEventsForObject(ctx, clients, ns, "ReplicaSet", name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": evs})
		})

		api.Get("/namespaces/{ns}/jobs", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			if ns == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			items, err := kube.ListJobs(ctx, clients, ns)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": items})
		})

		api.Get("/namespaces/{ns}/jobs/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := kube.GetJobDetails(ctx, clients, ns, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": det})
		})

		api.Get("/namespaces/{ns}/jobs/{name}/events", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kube.ListEventsForObject(ctx, clients, ns, "Job", name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": evs})
		})

		api.Get("/namespaces/{ns}/cronjobs", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			if ns == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			items, err := kube.ListCronJobs(ctx, clients, ns)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": items})
		})

		api.Get("/namespaces/{ns}/cronjobs/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := kube.GetCronJobDetails(ctx, clients, ns, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": det})
		})

		api.Get("/namespaces/{ns}/cronjobs/{name}/events", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kube.ListEventsForObject(ctx, clients, ns, "CronJob", name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": evs})
		})

		api.Get("/namespaces/{ns}/services", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			if ns == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			items, err := kube.ListServices(ctx, clients, ns)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": items})
		})

		api.Get("/namespaces/{ns}/services/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := kube.GetServiceDetails(ctx, clients, ns, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": det})
		})

		api.Get("/namespaces/{ns}/services/{name}/events", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kube.ListEventsForObject(ctx, clients, ns, "Service", name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": evs})
		})

		api.Get("/namespaces/{ns}/services/{name}/ingresses", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			items, err := kube.ListIngressesForService(ctx, clients, ns, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": items})
		})

		api.Get("/namespaces/{ns}/configmaps", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			if ns == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			items, err := kube.ListConfigMaps(ctx, clients, ns)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": items})
		})

		api.Get("/namespaces/{ns}/configmaps/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := kube.GetConfigMapDetails(ctx, clients, ns, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": det})
		})

		api.Get("/namespaces/{ns}/configmaps/{name}/events", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kube.ListEventsForObject(ctx, clients, ns, "ConfigMap", name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": evs})
		})

		api.Get("/namespaces/{ns}/serviceaccounts", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			if ns == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			items, err := kube.ListServiceAccounts(ctx, clients, ns)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": items})
		})

		api.Get("/namespaces/{ns}/serviceaccounts/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := kube.GetServiceAccountDetails(ctx, clients, ns, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": det})
		})

		api.Get("/namespaces/{ns}/serviceaccounts/{name}/events", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kube.ListEventsForObject(ctx, clients, ns, "ServiceAccount", name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": evs})
		})

		api.Get("/namespaces/{ns}/serviceaccounts/{name}/yaml", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			y, err := kube.GetServiceAccountYAML(ctx, clients, ns, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "yaml": y})
		})

		api.Get("/namespaces/{ns}/serviceaccounts/{name}/rolebindings", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			items, err := kube.ListRoleBindingsForServiceAccount(ctx, clients, ns, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": items})
		})

		api.Get("/namespaces/{ns}/roles", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			if ns == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			items, err := kube.ListRoles(ctx, clients, ns)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": items})
		})

		api.Get("/namespaces/{ns}/roles/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := kube.GetRoleDetails(ctx, clients, ns, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": det})
		})

		api.Get("/namespaces/{ns}/roles/{name}/events", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kube.ListEventsForObject(ctx, clients, ns, "Role", name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": evs})
		})

		api.Get("/namespaces/{ns}/roles/{name}/yaml", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			y, err := kube.GetRoleYAML(ctx, clients, ns, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "yaml": y})
		})

		api.Get("/namespaces/{ns}/rolebindings", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			if ns == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			items, err := kube.ListRoleBindings(ctx, clients, ns)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": items})
		})

		api.Get("/namespaces/{ns}/rolebindings/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := kube.GetRoleBindingDetails(ctx, clients, ns, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": det})
		})

		api.Get("/namespaces/{ns}/rolebindings/{name}/events", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kube.ListEventsForObject(ctx, clients, ns, "RoleBinding", name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": evs})
		})

		api.Get("/namespaces/{ns}/rolebindings/{name}/yaml", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			y, err := kube.GetRoleBindingYAML(ctx, clients, ns, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "yaml": y})
		})

		api.Get("/namespaces/{ns}/persistentvolumeclaims", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			if ns == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			items, err := kube.ListPersistentVolumeClaims(ctx, clients, ns)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": items})
		})

		api.Get("/namespaces/{ns}/persistentvolumeclaims/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := kube.GetPersistentVolumeClaimDetails(ctx, clients, ns, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": det})
		})

		api.Get("/namespaces/{ns}/persistentvolumeclaims/{name}/events", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kube.ListEventsForObject(ctx, clients, ns, "PersistentVolumeClaim", name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": evs})
		})

		api.Get("/namespaces/{ns}/persistentvolumeclaims/{name}/yaml", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			y, err := kube.GetPersistentVolumeClaimYAML(ctx, clients, ns, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "yaml": y})
		})

		api.Get("/namespaces/{ns}/secrets", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			if ns == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			items, err := kube.ListSecrets(ctx, clients, ns)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": items})
		})

		api.Get("/namespaces/{ns}/secrets/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := kube.GetSecretDetails(ctx, clients, ns, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": det})
		})

		api.Get("/namespaces/{ns}/secrets/{name}/events", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kube.ListEventsForObject(ctx, clients, ns, "Secret", name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": evs})
		})

		api.Get("/namespaces/{ns}/helmreleases", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			if ns == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			items, err := kube.ListHelmReleases(ctx, clients, ns)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": items})
		})

		api.Get("/namespaces/{ns}/helmreleases/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := kube.GetHelmReleaseDetails(ctx, clients, ns, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": det})
		})

		api.Get("/helmcharts", func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			items, err := kube.ListHelmCharts(ctx, clients)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": items})
		})

		api.Get("/namespaces/{ns}/ingresses", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			if ns == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			items, err := kube.ListIngresses(ctx, clients, ns)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": items})
		})

		api.Get("/namespaces/{ns}/ingresses/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := kube.GetIngressDetails(ctx, clients, ns, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": det})
		})

		api.Get("/namespaces/{ns}/ingresses/{name}/events", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kube.ListEventsForObject(ctx, clients, ns, "Ingress", name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": evs})
		})

		// --- Helm mutation endpoints ---

		api.Post("/helm/uninstall", func(w http.ResponseWriter, r *http.Request) {
			ctxName := r.Header.Get("X-Kview-Context")
			if ctxName == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{
					"error": &APIError{Code: ErrCodeValidation, Message: "missing X-Kview-Context header"},
				})
				return
			}

			var body kube.HelmUninstallRequest
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Namespace == "" || body.Release == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": validationError("namespace and release are required")})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
			defer cancel()

			clients, _, err := s.mgr.GetClientsForContext(ctx, ctxName)
			if err != nil {
				if errors.Is(err, cluster.ErrUnknownContext) {
					writeJSON(w, http.StatusNotFound, map[string]any{"error": &APIError{Code: ErrCodeNotFound, Message: err.Error()}})
					return
				}
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": &APIError{Code: ErrCodeInternal, Message: err.Error()}})
				return
			}

			result, err := kube.HelmUninstall(ctx, clients, body)
			if err != nil {
				status, apiErr := mapHelmError(err)
				writeJSON(w, status, map[string]any{"context": ctxName, "error": apiErr})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"context": ctxName, "result": result})
		})

		api.Post("/helm/upgrade", func(w http.ResponseWriter, r *http.Request) {
			ctxName := r.Header.Get("X-Kview-Context")
			if ctxName == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{
					"error": &APIError{Code: ErrCodeValidation, Message: "missing X-Kview-Context header"},
				})
				return
			}

			var body kube.HelmUpgradeRequest
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Namespace == "" || body.Release == "" || body.Chart == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": validationError("namespace, release, and chart are required")})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
			defer cancel()

			clients, _, err := s.mgr.GetClientsForContext(ctx, ctxName)
			if err != nil {
				if errors.Is(err, cluster.ErrUnknownContext) {
					writeJSON(w, http.StatusNotFound, map[string]any{"error": &APIError{Code: ErrCodeNotFound, Message: err.Error()}})
					return
				}
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": &APIError{Code: ErrCodeInternal, Message: err.Error()}})
				return
			}

			result, err := kube.HelmUpgrade(ctx, clients, body)
			if err != nil {
				status, apiErr := mapHelmError(err)
				writeJSON(w, status, map[string]any{"context": ctxName, "error": apiErr})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"context": ctxName, "result": result})
		})

		api.Post("/helm/install", func(w http.ResponseWriter, r *http.Request) {
			ctxName := r.Header.Get("X-Kview-Context")
			if ctxName == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{
					"error": &APIError{Code: ErrCodeValidation, Message: "missing X-Kview-Context header"},
				})
				return
			}

			var body kube.HelmInstallRequest
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Namespace == "" || body.Release == "" || body.Chart == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": validationError("namespace, release, and chart are required")})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
			defer cancel()

			clients, _, err := s.mgr.GetClientsForContext(ctx, ctxName)
			if err != nil {
				if errors.Is(err, cluster.ErrUnknownContext) {
					writeJSON(w, http.StatusNotFound, map[string]any{"error": &APIError{Code: ErrCodeNotFound, Message: err.Error()}})
					return
				}
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": &APIError{Code: ErrCodeInternal, Message: err.Error()}})
				return
			}

			result, err := kube.HelmInstall(ctx, clients, body)
			if err != nil {
				status, apiErr := mapHelmError(err)
				writeJSON(w, status, map[string]any{"context": ctxName, "error": apiErr})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"context": ctxName, "result": result})
		})

		api.Post("/helm/reinstall", func(w http.ResponseWriter, r *http.Request) {
			ctxName := r.Header.Get("X-Kview-Context")
			if ctxName == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{
					"error": &APIError{Code: ErrCodeValidation, Message: "missing X-Kview-Context header"},
				})
				return
			}

			var body kube.HelmReinstallRequest
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Namespace == "" || body.Release == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": validationError("namespace and release are required")})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
			defer cancel()

			clients, _, err := s.mgr.GetClientsForContext(ctx, ctxName)
			if err != nil {
				if errors.Is(err, cluster.ErrUnknownContext) {
					writeJSON(w, http.StatusNotFound, map[string]any{"error": &APIError{Code: ErrCodeNotFound, Message: err.Error()}})
					return
				}
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": &APIError{Code: ErrCodeInternal, Message: err.Error()}})
				return
			}

			result, err := kube.HelmReinstall(ctx, clients, body)
			if err != nil {
				status, apiErr := mapHelmError(err)
				writeJSON(w, status, map[string]any{"context": ctxName, "error": apiErr})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"context": ctxName, "result": result})
		})

		api.Post("/capabilities", func(w http.ResponseWriter, r *http.Request) {
			ctxName := r.Header.Get("X-Kview-Context")
			if ctxName == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{
					"error": &APIError{Code: ErrCodeValidation, Message: "missing X-Kview-Context header"},
				})
				return
			}

			var body struct {
				Group     string `json:"group"`
				Resource  string `json:"resource"`
				Namespace string `json:"namespace"`
				Name      string `json:"name"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Resource == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": validationError("invalid body")})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
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

			caps, err := kube.CheckCapabilities(ctx, clients, kube.CapabilitiesRequest{
				Group:     body.Group,
				Resource:  body.Resource,
				Namespace: body.Namespace,
				Name:      body.Name,
			})
			if err != nil {
				status, apiErr := mapKubeError(err)
				writeJSON(w, status, map[string]any{"context": ctxName, "error": apiErr})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"context": ctxName, "capabilities": caps})
		})

		api.Post("/actions", func(w http.ResponseWriter, r *http.Request) {
			ctxName := r.Header.Get("X-Kview-Context")
			if ctxName == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{
					"error": &APIError{Code: ErrCodeValidation, Message: "missing X-Kview-Context header"},
				})
				return
			}

			var body kube.ActionRequest
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Resource == "" || body.Action == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": validationError("invalid body")})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
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

			result, err := s.actions.Execute(ctx, clients, body)
			if err != nil {
				if errors.Is(err, kube.ErrUnknownAction) {
					writeJSON(w, http.StatusBadRequest, map[string]any{
						"context": ctxName,
						"error":   validationError(err.Error()),
					})
					return
				}

				status, apiErr := mapKubeError(err)
				writeJSON(w, status, map[string]any{"context": ctxName, "error": apiErr})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"context": ctxName, "result": result})
		})
	})

	// Public UI (SPA)
	r.Get("/*", s.serveUI)

	return r
}

func (s *Server) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Prefer Authorization: Bearer. Query "token" is fallback only for WebSocket
		// endpoints, where the browser WebSocket API cannot set custom headers.
		token := r.Header.Get("Authorization")
		if strings.HasPrefix(token, "Bearer ") {
			token = strings.TrimPrefix(token, "Bearer ")
		} else {
			token = r.URL.Query().Get("token")
		}

		if token != s.token {
			writeErrorResponse(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next.ServeHTTP(w, r)
	})
}

type statusCapturingWriter struct {
	http.ResponseWriter
	statusCode int
}

func (w *statusCapturingWriter) WriteHeader(statusCode int) {
	w.statusCode = statusCode
	w.ResponseWriter.WriteHeader(statusCode)
}

func (s *Server) activityAccessDeniedLogMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// WebSocket upgrade requires optional interfaces (Hijacker, etc.).
		// Wrapping ResponseWriter here can break upgrades for terminal/log streams.
		if isWebSocketUpgradeRequest(r) {
			next.ServeHTTP(w, r)
			return
		}

		sw := &statusCapturingWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(sw, r)
		if sw.statusCode != http.StatusForbidden {
			return
		}

		// Avoid flooding runtime logs for periodic polling endpoints.
		key := r.Method + " " + r.URL.Path
		now := time.Now().UTC()
		s.deniedLogMu.Lock()
		until, exists := s.deniedLogUntil[key]
		if exists && now.Before(until) {
			s.deniedLogMu.Unlock()
			return
		}
		s.deniedLogUntil[key] = now.Add(60 * time.Second)
		s.deniedLogMu.Unlock()

		s.rt.Log(runtime.LogLevelWarn, "rbac", fmt.Sprintf("access denied: %s", key))
	})
}

func isWebSocketUpgradeRequest(r *http.Request) bool {
	connection := strings.ToLower(r.Header.Get("Connection"))
	upgrade := strings.ToLower(r.Header.Get("Upgrade"))
	return strings.Contains(connection, "upgrade") && upgrade == "websocket"
}

func (s *Server) serveUI(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/")
	if path == "" {
		path = "ui_dist/index.html"
	} else {
		path = "ui_dist/" + path
	}

	b, err := uiFS.ReadFile(path)
	if err != nil {
		b, err = uiFS.ReadFile("ui_dist/index.html")
		if err != nil {
			http.Error(w, "UI not built", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(b)
		return
	}

	w.Header().Set("Content-Type", contentTypeByPath(path))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(b)
}

func contentTypeByPath(p string) string {
	switch {
	case strings.HasSuffix(p, ".html"):
		return "text/html; charset=utf-8"
	case strings.HasSuffix(p, ".js"):
		return "application/javascript; charset=utf-8"
	case strings.HasSuffix(p, ".css"):
		return "text/css; charset=utf-8"
	case strings.HasSuffix(p, ".svg"):
		return "image/svg+xml"
	case strings.HasSuffix(p, ".png"):
		return "image/png"
	default:
		return "application/octet-stream"
	}
}

// writeErrorResponse sends a consistent error envelope for API errors.
// Use {"message": msg} so the frontend can extract it consistently (see api.ts extractJsonMessage).
func writeErrorResponse(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{"message": message})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	if status >= http.StatusBadRequest {
		if payload, ok := v.(map[string]any); ok {
			if msg, ok := payload["error"].(string); ok && strings.TrimSpace(msg) != "" {
				if status >= http.StatusInternalServerError && looksLikeForbiddenMessage(msg) {
					status = http.StatusForbidden
				}
				payload["error"] = sanitizeErrorMessage(status)
				v = payload
			}
		}
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func looksLikeForbiddenMessage(msg string) bool {
	lower := strings.ToLower(strings.TrimSpace(msg))
	return strings.Contains(lower, "forbidden") ||
		strings.Contains(lower, "not allowed") ||
		strings.Contains(lower, "cannot list resource")
}

func sanitizeErrorMessage(status int) string {
	switch status {
	case http.StatusBadRequest:
		return "bad request"
	case http.StatusUnauthorized:
		return "unauthorized"
	case http.StatusForbidden:
		return "forbidden"
	case http.StatusNotFound:
		return "not found"
	case http.StatusConflict:
		return "conflict"
	case http.StatusTooManyRequests:
		return "too many requests"
	default:
		return "request failed"
	}
}

// logStructured writes a runtime log with a consistent key=value prefix for observability.
// Outcome is one of: start, success, failure. Optional kv pairs (key, value) follow outcome.
// Example: "outcome=success session_id=abc kind=terminal namespace=default name=pod-1 | created terminal session"
func logStructured(rt runtime.RuntimeManager, level runtime.LogLevel, source, outcome string, msg string, kv ...string) {
	var b strings.Builder
	b.WriteString("outcome=")
	b.WriteString(outcome)
	for i := 0; i+1 < len(kv); i += 2 {
		if kv[i] == "" || kv[i+1] == "" {
			continue
		}
		b.WriteString(" ")
		b.WriteString(kv[i])
		b.WriteString("=")
		b.WriteString(kv[i+1])
	}
	if msg != "" {
		b.WriteString(" | ")
		b.WriteString(msg)
	}
	rt.Log(level, source, b.String())
}
