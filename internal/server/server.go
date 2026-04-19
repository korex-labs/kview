package server

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	apierrors "k8s.io/apimachinery/pkg/api/errors"

	"github.com/korex-labs/kview/internal/buildinfo"
	"github.com/korex-labs/kview/internal/cluster"
	"github.com/korex-labs/kview/internal/dataplane"
	"github.com/korex-labs/kview/internal/kube"
	"github.com/korex-labs/kview/internal/kube/dto"
	crbindings "github.com/korex-labs/kview/internal/kube/resource/clusterrolebindings"
	clusterroles "github.com/korex-labs/kview/internal/kube/resource/clusterroles"
	configmaps "github.com/korex-labs/kview/internal/kube/resource/configmaps"
	cronjobs "github.com/korex-labs/kview/internal/kube/resource/cronjobs"
	crds "github.com/korex-labs/kview/internal/kube/resource/customresourcedefinitions"
	daemonsets "github.com/korex-labs/kview/internal/kube/resource/daemonsets"
	deployments "github.com/korex-labs/kview/internal/kube/resource/deployments"
	kubeevents "github.com/korex-labs/kview/internal/kube/resource/events"
	kubehelm "github.com/korex-labs/kview/internal/kube/resource/helm"
	hpas "github.com/korex-labs/kview/internal/kube/resource/horizontalpodautoscalers"
	ingresses "github.com/korex-labs/kview/internal/kube/resource/ingresses"
	jobs "github.com/korex-labs/kview/internal/kube/resource/jobs"
	namespaces "github.com/korex-labs/kview/internal/kube/resource/namespaces"
	nodes "github.com/korex-labs/kview/internal/kube/resource/nodes"
	pvcs "github.com/korex-labs/kview/internal/kube/resource/persistentvolumeclaims"
	pvs "github.com/korex-labs/kview/internal/kube/resource/persistentvolumes"
	pods "github.com/korex-labs/kview/internal/kube/resource/pods"
	replicasets "github.com/korex-labs/kview/internal/kube/resource/replicasets"
	rolebindings "github.com/korex-labs/kview/internal/kube/resource/rolebindings"
	roles "github.com/korex-labs/kview/internal/kube/resource/roles"
	secrets "github.com/korex-labs/kview/internal/kube/resource/secrets"
	serviceaccounts "github.com/korex-labs/kview/internal/kube/resource/serviceaccounts"
	svcs "github.com/korex-labs/kview/internal/kube/resource/services"
	statefulsets "github.com/korex-labs/kview/internal/kube/resource/statefulsets"
	"github.com/korex-labs/kview/internal/runtime"
	"github.com/korex-labs/kview/internal/session"
	"github.com/korex-labs/kview/internal/stream"
)

//go:embed ui_dist
var uiFS embed.FS

const (
	ctxTimeoutStatus        = 5 * time.Second   // health / status / capabilities endpoints
	ctxTimeoutDetail        = 10 * time.Second  // single-resource detail reads
	ctxTimeoutPortForward   = 15 * time.Second  // port-forward session setup
	ctxTimeoutList          = 20 * time.Second  // dataplane list reads
	ctxTimeoutProjection    = 30 * time.Second  // composite projections (namespace insights, Helm charts)
	ctxTimeoutExec          = 45 * time.Second  // exec / terminal sessions
	ctxTimeoutHelmUninstall = 60 * time.Second  // Helm uninstall
	ctxTimeoutHelmMutate    = 120 * time.Second // Helm upgrade / install / generic actions
	ctxTimeoutConnectivity  = 3 * time.Second   // connectivity ping

	deniedLogSuppressTTL = 60 * time.Second // rate-limit interval for repeated access-denied log lines
)

type Server struct {
	mgr            *cluster.Manager
	token          string
	actions        *kube.ActionRegistry
	rt             runtime.RuntimeManager
	dp             dataplane.DataPlaneManager
	sessions       session.Manager
	deniedLogMu    sync.Mutex
	deniedLogUntil map[string]time.Time
	statusLogMu    sync.Mutex
	clusterOnline  map[string]bool
}

func New(mgr *cluster.Manager, rt runtime.RuntimeManager, token string) *Server {
	dpMgr := dataplane.NewManager(dataplane.ManagerConfig{
		ClusterManager: mgr,
		Runtime:        rt,
	})

	s := &Server{
		mgr:            mgr,
		token:          token,
		actions:        kube.NewActionRegistry(),
		rt:             rt,
		dp:             dpMgr,
		sessions:       session.NewInMemoryManager(rt.Registry()),
		deniedLogUntil: map[string]time.Time{},
		clusterOnline:  map[string]bool{},
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

func (s *Server) readContextName(r *http.Request) string {
	if ctxName := strings.TrimSpace(r.Header.Get("X-Kview-Context")); ctxName != "" {
		return ctxName
	}
	return s.mgr.ActiveContext()
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
		api.Use(s.dataplaneUserActivityMiddleware)

		// Read-path ownership (dataplane snapshot vs projection vs direct kube in handler):
		// Keep docs/API_READ_OWNERSHIP.md in sync when adding GET routes.
		// Projections must not perform hidden live kube reads; use snapshots only.

		api.Get("/activity", func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutStatus)
			defer cancel()

			activities, err := runtime.ListActivitiesSorted(ctx, s.rt.Registry())
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to list activities"})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{
				"items": activities,
			})
		})

		api.Get("/dataplane/work/live", func(w http.ResponseWriter, _ *http.Request) {
			if s.dp == nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "dataplane unavailable"})
				return
			}
			writeJSON(w, http.StatusOK, s.dp.SchedulerLiveWork())
		})

		api.Get("/dataplane/search", func(w http.ResponseWriter, r *http.Request) {
			if s.dp == nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "dataplane unavailable"})
				return
			}
			limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
			offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
			res, err := s.dp.SearchCachedResources(r.Context(), s.readContextName(r), r.URL.Query().Get("q"), limit, offset)
			if err != nil {
				writeErrorResponse(w, http.StatusInternalServerError, "failed to search dataplane cache")
				return
			}
			writeJSON(w, http.StatusOK, res)
		})

		api.Get("/dataplane/config", func(w http.ResponseWriter, _ *http.Request) {
			if s.dp == nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "dataplane unavailable"})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"item": s.dp.Policy()})
		})

		api.Post("/dataplane/config", func(w http.ResponseWriter, r *http.Request) {
			if s.dp == nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "dataplane unavailable"})
				return
			}
			var body dataplane.DataplanePolicy
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid dataplane config"})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"item": s.dp.SetPolicy(body)})
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutStatus)
			defer cancel()

			logs := s.rt.Logs().List(ctx)
			writeJSON(w, http.StatusOK, map[string]any{"items": logs})
		})

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

		api.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, http.StatusOK, map[string]any{
				"ok":            true,
				"activeContext": s.mgr.ActiveContext(),
			})
		})

		api.Get("/status", func(w http.ResponseWriter, r *http.Request) {
			status := s.buildStatus(r.Context(), s.readContextName(r))
			writeJSON(w, http.StatusOK, status)
		})

		api.Get("/dashboard/cluster", func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutDetail)
			defer cancel()

			active := s.readContextName(r)

			// Ensure observers are running for the active cluster so snapshots stay reasonably fresh.
			s.dp.EnsureObservers(ctx, active)

			summary := s.dp.DashboardSummary(ctx, active, parseClusterDashboardListOptions(r))
			writeJSON(w, http.StatusOK, map[string]any{
				"active": active,
				"item":   summary,
			})
		})

		api.Get("/dataplane/revision", func(w http.ResponseWriter, r *http.Request) {
			kindStr := strings.TrimSpace(r.URL.Query().Get("kind"))
			kind, ok := dataplane.ParseListRevisionResourceKind(kindStr)
			if !ok {
				writeJSON(w, http.StatusBadRequest, map[string]any{
					"error":  "unknown or missing kind query parameter",
					"active": s.readContextName(r),
				})
				return
			}
			ns := strings.TrimSpace(r.URL.Query().Get("namespace"))
			if dataplane.ListRevisionKindNeedsNamespace(kind) && ns == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{
					"error":  "namespace query parameter is required for this kind",
					"active": s.readContextName(r),
				})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutStatus)
			defer cancel()

			active := s.readContextName(r)
			s.dp.EnsureObservers(ctx, active)

			env, err := s.dp.ListSnapshotRevision(ctx, active, kind, ns)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}
			writeJSON(w, http.StatusOK, env)
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
			previous := s.mgr.ActiveContext()
			if err := s.mgr.SetActiveContext(body.Name); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
				return
			}
			active := s.mgr.ActiveContext()
			if previous != active {
				s.stopConnectivityActivityIfUnused(previous)
			}
			writeJSON(w, http.StatusOK, map[string]any{"active": active})
		})

		api.Get("/namespaces", func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutExec)
			defer cancel()

			active := s.readContextName(r)

			// Warm dataplane observers for the active cluster so snapshots stay reasonably fresh.
			s.dp.EnsureObservers(ctx, active)

			snap, err := s.dp.NamespacesSnapshot(ctx, active)
			if err != nil {
				if len(snap.Items) == 0 {
					status := http.StatusInternalServerError
					if apierrors.IsForbidden(err) {
						status = http.StatusForbidden
					}
					writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
					return
				}
			}

			state := dataplane.CoarseState(snap.Err, len(snap.Items))

			items := snap.Items
			cachedItems, cachedEnriched := s.dp.MergeCachedNamespaceRowProjection(ctx, active, items)
			items = cachedItems
			hints := dataplane.ParseNamespaceEnrichHints(r.URL.Query())
			rev := s.dp.BeginNamespaceListProgressiveEnrichment(active, items, hints)
			policy := s.dp.Policy().NamespaceEnrichment
			rowProj := dto.NamespaceListRowProjectionMetaDTO{
				TotalRows:    len(items),
				EnrichedRows: cachedEnriched,
				Cap:          policy.MaxTargets,
				Revision:     rev,
				Loading:      rev != 0,
				Stage:        "list",
				Note:         "Pod and deployment counts for current, recent, and favourite namespaces appear shortly after you stop interacting with the app.",
			}
			if err != nil {
				rowProj.Note = "Namespace list is using cached data because the latest refresh failed. Row metrics may update after the next successful refresh."
			}
			if rev == 0 {
				rowProj.Loading = false
				if len(items) > 0 && err == nil {
					if !policy.Enabled {
						rowProj.Note = "Namespace row enrichment is disabled in settings."
					} else {
						rowProj.Note = "Row metrics run only for current, recent, and favourite namespaces after idle. Select a namespace, browse resources, or star namespaces."
					}
				}
			} else if policy.Sweep.Enabled {
				rowProj.Note = "Focused namespace enrichment is active; the opt-in background sweep may add a few extra idle namespaces per cycle."
			}

			writeJSON(w, http.StatusOK, map[string]any{
				"active":        active,
				"limited":       false,
				"items":         items,
				"rowProjection": rowProj,
				"observed":      snap.Meta.ObservedAt,
				"meta": map[string]any{
					"revision":     strconv.FormatUint(snap.Meta.Revision, 10),
					"freshness":    snap.Meta.Freshness,
					"coverage":     snap.Meta.Coverage,
					"degradation":  snap.Meta.Degradation,
					"completeness": snap.Meta.Completeness,
					"state":        state,
				},
			})
		})

		api.Get("/namespaces/enrichment", func(w http.ResponseWriter, r *http.Request) {
			active := s.readContextName(r)
			revStr := r.URL.Query().Get("revision")
			rev, err := strconv.ParseUint(revStr, 10, 64)
			if err != nil || rev == 0 {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid or missing revision query parameter", "active": active})
				return
			}

			poll := s.dp.NamespaceListEnrichmentPoll(active, rev)
			writeJSON(w, http.StatusOK, poll)
		})

		api.Get("/namespaces/{name}", func(w http.ResponseWriter, r *http.Request) {
			name := chi.URLParam(r, "name")
			if name == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace name"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			active := s.readContextName(r)
			clients, active, err := s.mgr.GetClientsForContext(ctx, active)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := namespaces.GetNamespaceDetails(ctx, clients, name)
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

		api.Get("/namespaces/{name}/events", func(w http.ResponseWriter, r *http.Request) {
			name := chi.URLParam(r, "name")
			if name == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace name"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kubeevents.ListEventsForNamespace(ctx, clients, name)
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

		api.Get("/namespaces/{name}/insights", func(w http.ResponseWriter, r *http.Request) {
			name := chi.URLParam(r, "name")
			if name == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace name"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutProjection)
			defer cancel()

			active := s.readContextName(r)

			proj, err := s.dp.NamespaceInsightsProjection(ctx, active, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{
				"active": active,
				"item":   proj.Insights,
			})
		})

		api.Get("/namespaces/{name}/summary", func(w http.ResponseWriter, r *http.Request) {
			name := chi.URLParam(r, "name")
			if name == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace name"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutProjection)
			defer cancel()

			active := s.readContextName(r)

			proj, err := s.dp.NamespaceSummaryProjection(ctx, active, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{
				"active": active,
				"item":   proj.Resources,
			})
		})

		api.Get("/namespaces/{name}/resourcequotas", func(w http.ResponseWriter, r *http.Request) {
			name := chi.URLParam(r, "name")
			if name == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace name"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			active := s.readContextName(r)

			snap, err := s.dp.ResourceQuotasSnapshot(ctx, active, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeDataplaneListResponse(w, active, snap.Items, snap.Meta, snap.Err)
		})

		api.Get("/namespaces/{name}/limitranges", func(w http.ResponseWriter, r *http.Request) {
			name := chi.URLParam(r, "name")
			if name == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace name"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			active := s.readContextName(r)
			snap, err := s.dp.LimitRangesSnapshot(ctx, active, name)
			if err != nil {
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeDataplaneListResponse(w, active, snap.Items, snap.Meta, snap.Err)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutDetail)
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
			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			active := s.readContextName(r)
			if s.dp != nil {
				s.dp.EnsureObservers(ctx, active)
			}
			snap, err := s.dp.NodesSnapshot(ctx, active)
			if derived, derr := s.dp.DerivedNodesSnapshot(ctx, active); derr == nil && len(derived.Items) > 0 {
				if len(snap.Items) == 0 {
					writeDataplaneListResponse(w, active, dataplane.EnrichNodeListItemsForAPI(derived.Items), derived.Meta, derived.Err)
					return
				}
				merged := dataplane.MergeDirectAndDerivedNodeListItems(snap.Items, derived.Items)
				if len(merged) > len(snap.Items) {
					meta := snap.Meta
					meta.Coverage = dataplane.CoverageClassPartial
					meta.Completeness = dataplane.CompletenessClassInexact
					if meta.Degradation == dataplane.DegradationClassNone || meta.Degradation == "" {
						meta.Degradation = dataplane.DegradationClassMinor
					}
					writeDataplaneListResponse(w, active, dataplane.EnrichNodeListItemsForAPI(merged), meta, snap.Err)
					return
				}
			}
			if listLength(snap.Items) == 0 {
				if err != nil {
					writeDataplaneListError(w, active, err)
					return
				}
				if snap.Err != nil {
					writeDataplaneNormalizedListError(w, active, snap.Err)
					return
				}
			}
			writeDataplaneListResponse(w, active, dataplane.EnrichNodeListItemsForAPI(snap.Items), snap.Meta, snap.Err)
		})

		api.Get("/nodes/{name}", func(w http.ResponseWriter, r *http.Request) {
			name := chi.URLParam(r, "name")
			if name == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing node name"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			active := s.readContextName(r)
			clients, active, err := s.mgr.GetClientsForContext(ctx, active)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := nodes.GetNodeDetails(ctx, clients, name)
			if err != nil {
				if derived, ok, derr := s.dp.DerivedNodeDetails(ctx, active, name); derr == nil && ok {
					writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": derived})
					return
				}
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "item": det})
		})

		api.Get("/clusterroles", dataplaneClusterListHandler(s, s.dp.ClusterRolesSnapshot, func(items []dto.ClusterRoleListItemDTO) any {
			return dataplane.EnrichClusterRoleListItemsForAPI(items)
		}))

		api.Get("/clusterroles/{name}", func(w http.ResponseWriter, r *http.Request) {
			name := chi.URLParam(r, "name")
			if name == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing clusterrole name"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := clusterroles.GetClusterRoleDetails(ctx, clients, name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kubeevents.ListEventsForObject(ctx, clients, "", "ClusterRole", name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			y, err := clusterroles.GetClusterRoleYAML(ctx, clients, name)
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

		api.Get("/clusterrolebindings", dataplaneClusterListHandler(s, s.dp.ClusterRoleBindingsSnapshot, func(items []dto.ClusterRoleBindingListItemDTO) any {
			return dataplane.EnrichClusterRoleBindingListItemsForAPI(items)
		}))

		api.Get("/clusterrolebindings/{name}", func(w http.ResponseWriter, r *http.Request) {
			name := chi.URLParam(r, "name")
			if name == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing clusterrolebinding name"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := crbindings.GetClusterRoleBindingDetails(ctx, clients, name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kubeevents.ListEventsForObject(ctx, clients, "", "ClusterRoleBinding", name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			y, err := crbindings.GetClusterRoleBindingYAML(ctx, clients, name)
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

		api.Get("/customresourcedefinitions", dataplaneClusterListHandler(s, s.dp.CRDsSnapshot, func(items []dto.CRDListItemDTO) any {
			return dataplane.EnrichCRDListItemsForAPI(items)
		}))

		api.Get("/customresourcedefinitions/{name}", func(w http.ResponseWriter, r *http.Request) {
			name := chi.URLParam(r, "name")
			if name == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing customresourcedefinition name"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := crds.GetCustomResourceDefinitionDetails(ctx, clients, name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kubeevents.ListEventsForObject(ctx, clients, "", "CustomResourceDefinition", name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			y, err := crds.GetCustomResourceDefinitionYAML(ctx, clients, name)
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

		api.Get("/persistentvolumes", dataplaneClusterListHandler(s, s.dp.PersistentVolumesSnapshot, func(items []dto.PersistentVolumeDTO) any {
			return dataplane.EnrichPersistentVolumeListItemsForAPI(items)
		}))

		api.Get("/persistentvolumes/{name}", func(w http.ResponseWriter, r *http.Request) {
			name := chi.URLParam(r, "name")
			if name == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing persistentvolume name"})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := pvs.GetPersistentVolumeDetails(ctx, clients, name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kubeevents.ListEventsForObject(ctx, clients, "", "PersistentVolume", name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			y, err := pvs.GetPersistentVolumeYAML(ctx, clients, name)
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

		api.Get("/namespaces/{ns}/pods", dataplaneNamespacedListHandler(s, s.dp.PodsSnapshot, func(items []dto.PodListItemDTO) any {
			return dataplane.EnrichPodListItemsForAPI(items)
		}))

		api.Get("/namespaces/{ns}/pods/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := pods.GetPodDetails(ctx, clients, ns, name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kubeevents.ListEventsForPod(ctx, clients, ns, name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			items, err := pods.ListServicesSelectingPod(ctx, clients, ns, name)
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

		api.Get("/namespaces/{ns}/deployments", dataplaneNamespacedListHandler(s, s.dp.DeploymentsSnapshot, func(items []dto.DeploymentListItemDTO) any {
			return dataplane.EnrichDeploymentListItemsForAPI(items)
		}))

		api.Get("/namespaces/{ns}/deployments/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := deployments.GetDeploymentDetails(ctx, clients, ns, name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kubeevents.ListEventsForObject(ctx, clients, ns, "Deployment", name)
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

		// Namespaced workload list routes below (daemonsets, statefulsets, replicasets, jobs, cronjobs, HPAs) are
		// dataplane-backed: s.dp.*Snapshot + writeDataplaneListResponse. kube.List* for these kinds runs only
		// inside internal/dataplane snapshot executors, not in handlers. Detail/events/yaml stay direct-read.
		api.Get("/namespaces/{ns}/daemonsets", dataplaneNamespacedListHandler(s, s.dp.DaemonSetsSnapshot, func(items []dto.DaemonSetDTO) any {
			return dataplane.EnrichDaemonSetListItemsForAPI(items)
		}))

		api.Get("/namespaces/{ns}/daemonsets/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := daemonsets.GetDaemonSetDetails(ctx, clients, ns, name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kubeevents.ListEventsForObject(ctx, clients, ns, "DaemonSet", name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			y, err := daemonsets.GetDaemonSetYAML(ctx, clients, ns, name)
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

		api.Get("/namespaces/{ns}/statefulsets", dataplaneNamespacedListHandler(s, s.dp.StatefulSetsSnapshot, func(items []dto.StatefulSetDTO) any {
			return dataplane.EnrichStatefulSetListItemsForAPI(items)
		}))

		api.Get("/namespaces/{ns}/statefulsets/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := statefulsets.GetStatefulSetDetails(ctx, clients, ns, name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kubeevents.ListEventsForObject(ctx, clients, ns, "StatefulSet", name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			y, err := statefulsets.GetStatefulSetYAML(ctx, clients, ns, name)
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

		api.Get("/namespaces/{ns}/replicasets", dataplaneNamespacedListHandler(s, s.dp.ReplicaSetsSnapshot, func(items []dto.ReplicaSetDTO) any {
			return dataplane.EnrichReplicaSetListItemsForAPI(items)
		}))

		api.Get("/namespaces/{ns}/replicasets/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := replicasets.GetReplicaSetDetails(ctx, clients, ns, name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kubeevents.ListEventsForObject(ctx, clients, ns, "ReplicaSet", name)
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

		api.Get("/namespaces/{ns}/jobs", dataplaneNamespacedListHandler(s, s.dp.JobsSnapshot, func(items []dto.JobDTO) any {
			return dataplane.EnrichJobListItemsForAPI(items)
		}))

		api.Get("/namespaces/{ns}/jobs/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := jobs.GetJobDetails(ctx, clients, ns, name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kubeevents.ListEventsForObject(ctx, clients, ns, "Job", name)
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

		api.Get("/namespaces/{ns}/cronjobs", dataplaneNamespacedListHandler(s, s.dp.CronJobsSnapshot, func(items []dto.CronJobDTO) any {
			return dataplane.EnrichCronJobListItemsForAPI(items)
		}))

		api.Get("/namespaces/{ns}/cronjobs/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := cronjobs.GetCronJobDetails(ctx, clients, ns, name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kubeevents.ListEventsForObject(ctx, clients, ns, "CronJob", name)
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

		api.Get("/namespaces/{ns}/horizontalpodautoscalers", dataplaneNamespacedListHandler(s, s.dp.HPAsSnapshot, func(items []dto.HorizontalPodAutoscalerDTO) any {
			return items
		}))

		api.Get("/namespaces/{ns}/horizontalpodautoscalers/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := hpas.GetHorizontalPodAutoscalerDetails(ctx, clients, ns, name)
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

		api.Get("/namespaces/{ns}/horizontalpodautoscalers/{name}/events", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kubeevents.ListEventsForObject(ctx, clients, ns, "HorizontalPodAutoscaler", name)
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

		api.Get("/namespaces/{ns}/services", dataplaneNamespacedListHandler(s, s.dp.ServicesSnapshot, func(items []dto.ServiceListItemDTO) any {
			return dataplane.EnrichServiceListItemsForAPI(items)
		}))

		api.Get("/namespaces/{ns}/services/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := svcs.GetServiceDetails(ctx, clients, ns, name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kubeevents.ListEventsForObject(ctx, clients, ns, "Service", name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			items, err := ingresses.ListIngressesForService(ctx, clients, ns, name)
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

		api.Get("/namespaces/{ns}/configmaps", dataplaneNamespacedListHandler(s, s.dp.ConfigMapsSnapshot, func(items []dto.ConfigMapDTO) any {
			return dataplane.EnrichConfigMapListItemsForAPI(items)
		}))

		api.Get("/namespaces/{ns}/configmaps/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := configmaps.GetConfigMapDetails(ctx, clients, ns, name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kubeevents.ListEventsForObject(ctx, clients, ns, "ConfigMap", name)
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

		api.Get("/namespaces/{ns}/serviceaccounts", dataplaneNamespacedListHandler(s, s.dp.ServiceAccountsSnapshot, func(items []dto.ServiceAccountListItemDTO) any {
			return dataplane.EnrichServiceAccountListItemsForAPI(items)
		}))

		api.Get("/namespaces/{ns}/serviceaccounts/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := serviceaccounts.GetServiceAccountDetails(ctx, clients, ns, name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kubeevents.ListEventsForObject(ctx, clients, ns, "ServiceAccount", name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			y, err := serviceaccounts.GetServiceAccountYAML(ctx, clients, ns, name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			items, err := serviceaccounts.ListRoleBindingsForServiceAccount(ctx, clients, ns, name)
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

		api.Get("/namespaces/{ns}/roles", dataplaneNamespacedListHandler(s, s.dp.RolesSnapshot, func(items []dto.RoleListItemDTO) any {
			return dataplane.EnrichRoleListItemsForAPI(items)
		}))

		api.Get("/namespaces/{ns}/roles/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := roles.GetRoleDetails(ctx, clients, ns, name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kubeevents.ListEventsForObject(ctx, clients, ns, "Role", name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			y, err := roles.GetRoleYAML(ctx, clients, ns, name)
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

		api.Get("/namespaces/{ns}/rolebindings", dataplaneNamespacedListHandler(s, s.dp.RoleBindingsSnapshot, func(items []dto.RoleBindingListItemDTO) any {
			return dataplane.EnrichRoleBindingListItemsForAPI(items)
		}))

		api.Get("/namespaces/{ns}/rolebindings/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := rolebindings.GetRoleBindingDetails(ctx, clients, ns, name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kubeevents.ListEventsForObject(ctx, clients, ns, "RoleBinding", name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			y, err := rolebindings.GetRoleBindingYAML(ctx, clients, ns, name)
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

		api.Get("/namespaces/{ns}/persistentvolumeclaims", dataplaneNamespacedListHandler(s, s.dp.PVCsSnapshot, func(items []dto.PersistentVolumeClaimDTO) any {
			return dataplane.EnrichPVCListItemsForAPI(items)
		}))

		api.Get("/namespaces/{ns}/persistentvolumeclaims/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := pvcs.GetPersistentVolumeClaimDetails(ctx, clients, ns, name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kubeevents.ListEventsForObject(ctx, clients, ns, "PersistentVolumeClaim", name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			y, err := pvcs.GetPersistentVolumeClaimYAML(ctx, clients, ns, name)
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

		api.Get("/namespaces/{ns}/secrets", dataplaneNamespacedListHandler(s, s.dp.SecretsSnapshot, func(items []dto.SecretDTO) any {
			return dataplane.EnrichSecretListItemsForAPI(items)
		}))

		api.Get("/namespaces/{ns}/secrets/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := secrets.GetSecretDetails(ctx, clients, ns, name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kubeevents.ListEventsForObject(ctx, clients, ns, "Secret", name)
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

		api.Get("/namespaces/{ns}/helmreleases", dataplaneNamespacedListHandler(s, s.dp.HelmReleasesSnapshot, func(items []dto.HelmReleaseDTO) any {
			return dataplane.EnrichHelmReleaseListItemsForAPI(items)
		}))

		api.Get("/namespaces/{ns}/helmreleases/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := kubehelm.GetHelmReleaseDetails(ctx, clients, ns, name)
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
			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutProjection)
			defer cancel()

			active := s.readContextName(r)
			clients, active, err := s.mgr.GetClientsForContext(ctx, active)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			items, err := kubehelm.ListHelmCharts(ctx, clients)
			if err != nil {
				if derived, derr := s.dp.DerivedHelmChartsSnapshot(ctx, active); derr == nil {
					writeJSON(w, http.StatusOK, map[string]any{
						"active":   active,
						"items":    derived.Items,
						"observed": derived.Meta.ObservedAt,
						"meta": map[string]any{
							"freshness":    derived.Meta.Freshness,
							"coverage":     derived.Meta.Coverage,
							"degradation":  derived.Meta.Degradation,
							"completeness": derived.Meta.Completeness,
							"state":        dataplane.CoarseState(derived.Err, len(derived.Items)),
						},
					})
					return
				}
				status := http.StatusInternalServerError
				if apierrors.IsForbidden(err) {
					status = http.StatusForbidden
				}
				writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{"active": active, "items": items})
		})

		api.Get("/namespaces/{ns}/ingresses", dataplaneNamespacedListHandler(s, s.dp.IngressesSnapshot, func(items []dto.IngressListItemDTO) any {
			return dataplane.EnrichIngressListItemsForAPI(items)
		}))

		api.Get("/namespaces/{ns}/ingresses/{name}", func(w http.ResponseWriter, r *http.Request) {
			ns := chi.URLParam(r, "ns")
			name := chi.URLParam(r, "name")

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			det, err := ingresses.GetIngressDetails(ctx, clients, ns, name)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
			defer cancel()

			clients, active, err := s.mgr.GetClients(ctx)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error(), "active": active})
				return
			}

			evs, err := kubeevents.ListEventsForObject(ctx, clients, ns, "Ingress", name)
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

			var body kubehelm.HelmUninstallRequest
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Namespace == "" || body.Release == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": validationError("namespace and release are required")})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutHelmUninstall)
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

			result, err := kubehelm.HelmUninstall(ctx, clients, body)
			if err != nil {
				status, apiErr := mapHelmError(err)
				writeJSON(w, status, map[string]any{"context": ctxName, "error": apiErr})
				return
			}
			_ = s.dp.InvalidateHelmReleasesSnapshot(ctx, ctxName, body.Namespace)
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

			var body kubehelm.HelmUpgradeRequest
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Namespace == "" || body.Release == "" || body.Chart == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": validationError("namespace, release, and chart are required")})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutHelmMutate)
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

			result, err := kubehelm.HelmUpgrade(ctx, clients, body)
			if err != nil {
				status, apiErr := mapHelmError(err)
				writeJSON(w, status, map[string]any{"context": ctxName, "error": apiErr})
				return
			}
			_ = s.dp.InvalidateHelmReleasesSnapshot(ctx, ctxName, body.Namespace)
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

			var body kubehelm.HelmInstallRequest
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Namespace == "" || body.Release == "" || body.Chart == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": validationError("namespace, release, and chart are required")})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutHelmMutate)
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

			result, err := kubehelm.HelmInstall(ctx, clients, body)
			if err != nil {
				status, apiErr := mapHelmError(err)
				writeJSON(w, status, map[string]any{"context": ctxName, "error": apiErr})
				return
			}
			_ = s.dp.InvalidateHelmReleasesSnapshot(ctx, ctxName, body.Namespace)
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

			var body kubehelm.HelmReinstallRequest
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Namespace == "" || body.Release == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": validationError("namespace and release are required")})
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutHelmMutate)
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

			result, err := kubehelm.HelmReinstall(ctx, clients, body)
			if err != nil {
				status, apiErr := mapHelmError(err)
				writeJSON(w, status, map[string]any{"context": ctxName, "error": apiErr})
				return
			}
			_ = s.dp.InvalidateHelmReleasesSnapshot(ctx, ctxName, body.Namespace)
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

			ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
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

			if body.Resource == "helmreleases" && body.Namespace != "" {
				_ = s.dp.InvalidateHelmReleasesSnapshot(ctx, ctxName, body.Namespace)
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
		s.deniedLogUntil[key] = now.Add(deniedLogSuppressTTL)
		s.deniedLogMu.Unlock()

		s.rt.Log(runtime.LogLevelWarn, "rbac", fmt.Sprintf("access denied: %s", key))
	})
}

func isWebSocketUpgradeRequest(r *http.Request) bool {
	connection := strings.ToLower(r.Header.Get("Connection"))
	upgrade := strings.ToLower(r.Header.Get("Upgrade"))
	return strings.Contains(connection, "upgrade") && upgrade == "websocket"
}

func (s *Server) dataplaneUserActivityMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Namespace enrichment idle gate: background polling routes must not count as "activity".
		p := strings.TrimSuffix(r.URL.Path, "/")
		if !isBackgroundPollingPath(p) {
			s.dp.NoteUserActivity()
		}
		next.ServeHTTP(w, r)
	})
}

func isBackgroundPollingPath(p string) bool {
	switch p {
	case "/api/namespaces/enrichment",
		"/api/status",
		"/api/activity",
		"/api/activity/runtime/logs",
		"/api/dataplane/work/live",
		"/api/dataplane/config",
		"/api/dashboard/cluster",
		"/api/sessions":
		return true
	default:
		return p == "/api/dataplane/revision"
	}
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

func writeDataplaneListResponse(w http.ResponseWriter, active string, items any, meta dataplane.SnapshotMetadata, nerr *dataplane.NormalizedError) {
	writeJSON(w, http.StatusOK, map[string]any{
		"active":   active,
		"items":    items,
		"observed": meta.ObservedAt,
		"meta": map[string]any{
			"revision":     strconv.FormatUint(meta.Revision, 10),
			"freshness":    meta.Freshness,
			"coverage":     meta.Coverage,
			"degradation":  meta.Degradation,
			"completeness": meta.Completeness,
			"state":        dataplane.CoarseState(nerr, listLength(items)),
		},
	})
}

func dataplaneClusterListHandler[I any](
	s *Server,
	fetch func(context.Context, string) (dataplane.Snapshot[I], error),
	transform func([]I) any,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		active := s.readContextName(r)
		if s.dp != nil {
			s.dp.EnsureObservers(ctx, active)
		}
		snap, err := fetch(ctx, active)
		if err != nil && listLength(snap.Items) == 0 {
			writeDataplaneListError(w, active, err)
			return
		}
		items := any(snap.Items)
		if transform != nil {
			items = transform(snap.Items)
		}
		writeDataplaneListResponse(w, active, items, snap.Meta, snap.Err)
	}
}

func dataplaneNamespacedListHandler[I any](
	s *Server,
	fetch func(context.Context, string, string) (dataplane.Snapshot[I], error),
	transform func([]I) any,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "ns")
		if ns == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing namespace"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutList)
		defer cancel()

		active := s.readContextName(r)
		if s.dp != nil {
			s.dp.EnsureObservers(ctx, active)
		}
		snap, err := fetch(ctx, active, ns)
		if err != nil && listLength(snap.Items) == 0 {
			writeDataplaneListError(w, active, err)
			return
		}
		items := any(snap.Items)
		if transform != nil {
			items = transform(snap.Items)
		}
		writeDataplaneListResponse(w, active, items, snap.Meta, snap.Err)
	}
}

func writeDataplaneListError(w http.ResponseWriter, active string, err error) {
	status := http.StatusInternalServerError
	if apierrors.IsForbidden(err) {
		status = http.StatusForbidden
	}
	writeJSON(w, status, map[string]any{"error": err.Error(), "active": active})
}

func writeDataplaneNormalizedListError(w http.ResponseWriter, active string, err *dataplane.NormalizedError) {
	if err == nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "dataplane snapshot unavailable", "active": active})
		return
	}
	status := http.StatusInternalServerError
	if err.Class == dataplane.NormalizedErrorClassAccessDenied || err.Class == dataplane.NormalizedErrorClassUnauthorized {
		status = http.StatusForbidden
	}
	message := err.UpstreamMessage
	if message == "" {
		message = string(err.Class)
	}
	writeJSON(w, status, map[string]any{"error": message, "active": active})
}

func listLength(items any) int {
	// Handles strongly typed DTO slices without endpoint-specific assertions.
	rv := reflect.ValueOf(items)
	if rv.Kind() == reflect.Slice {
		return rv.Len()
	}
	return 0
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

type statusBackendDTO struct {
	OK      bool   `json:"ok"`
	Version string `json:"version,omitempty"`
}

type statusClusterDTO struct {
	OK            bool   `json:"ok"`
	Context       string `json:"context"`
	Cluster       string `json:"cluster,omitempty"`
	AuthInfo      string `json:"authInfo,omitempty"`
	Namespace     string `json:"namespace,omitempty"`
	ServerVersion string `json:"serverVersion,omitempty"`
	Message       string `json:"message,omitempty"`
}

type statusDTO struct {
	OK            bool             `json:"ok"`
	ActiveContext string           `json:"activeContext"`
	Backend       statusBackendDTO `json:"backend"`
	Cluster       statusClusterDTO `json:"cluster"`
	CheckedAt     time.Time        `json:"checkedAt"`
}

const connectivityActivityTTL = 3 * time.Minute

func (s *Server) buildStatus(parent context.Context, contextName string) statusDTO {
	checkedAt := time.Now().UTC()
	clusterStatus := statusClusterDTO{Context: contextName}
	if s.mgr != nil {
		if info, ok := s.mgr.ContextInfo(contextName); ok {
			clusterStatus.Cluster = info.Cluster
			clusterStatus.AuthInfo = info.AuthInfo
			clusterStatus.Namespace = info.Namespace
		}

		ctx, cancel := context.WithTimeout(parent, ctxTimeoutConnectivity)
		defer cancel()

		clients, active, err := s.mgr.GetClientsForContext(ctx, contextName)
		if active != "" {
			clusterStatus.Context = active
		}
		if err == nil {
			version, versionErr := clients.Discovery.ServerVersion()
			if versionErr != nil {
				err = versionErr
			} else {
				clusterStatus.OK = true
				clusterStatus.ServerVersion = version.GitVersion
			}
		}
		if err != nil {
			clusterStatus.OK = false
			clusterStatus.Message = err.Error()
		}
	}

	if s.rt != nil {
		s.updateConnectivityActivity(clusterStatus)
		s.stopInactiveConnectivityActivitiesExcept(clusterStatus.Context)
		s.logClusterStatusTransition(clusterStatus)
	}

	return statusDTO{
		OK:            clusterStatus.OK,
		ActiveContext: clusterStatus.Context,
		Backend:       statusBackendDTO{OK: true, Version: buildinfo.Version},
		Cluster:       clusterStatus,
		CheckedAt:     checkedAt,
	}
}

func (s *Server) updateConnectivityActivity(clusterStatus statusClusterDTO) {
	contextName := clusterStatus.Context
	if contextName == "" {
		contextName = "(none)"
	}

	now := time.Now().UTC()
	id := fmt.Sprintf("connectivity:%s", contextName)
	status := runtime.ActivityStatusRunning
	if !clusterStatus.OK {
		status = runtime.ActivityStatusFailed
	}

	metadata := map[string]string{
		"context": contextName,
		"state":   "connected",
	}
	if clusterStatus.Cluster != "" {
		metadata["cluster"] = clusterStatus.Cluster
	}
	if clusterStatus.AuthInfo != "" {
		metadata["authInfo"] = clusterStatus.AuthInfo
	}
	if clusterStatus.Namespace != "" {
		metadata["namespace"] = clusterStatus.Namespace
	}
	if clusterStatus.ServerVersion != "" {
		metadata["version"] = clusterStatus.ServerVersion
	}
	if !clusterStatus.OK {
		metadata["state"] = "disconnected"
		if clusterStatus.Message != "" {
			msg := clusterStatus.Message
			if len(msg) > 240 {
				msg = msg[:240] + "..."
			}
			metadata["message"] = msg
		}
	}

	existing, ok, _ := s.rt.Registry().Get(context.Background(), id)
	if ok && !existing.CreatedAt.IsZero() {
		existing.Status = status
		existing.UpdatedAt = now
		existing.Title = fmt.Sprintf("Cluster connectivity · %s", contextName)
		existing.ResourceType = "cluster:connectivity"
		existing.Metadata = metadata
		_ = s.rt.Registry().Update(context.Background(), existing)
		return
	}

	_ = s.rt.Registry().Register(context.Background(), runtime.Activity{
		ID:           id,
		Kind:         runtime.ActivityKindWorker,
		Type:         runtime.ActivityTypeConnectivity,
		Title:        fmt.Sprintf("Cluster connectivity · %s", contextName),
		Status:       status,
		CreatedAt:    now,
		UpdatedAt:    now,
		StartedAt:    now,
		ResourceType: "cluster:connectivity",
		Metadata:     metadata,
	})
}

func (s *Server) stopInactiveConnectivityActivitiesExcept(activeContext string) {
	if s == nil || s.rt == nil || s.rt.Registry() == nil {
		return
	}
	activities, err := s.rt.Registry().List(context.Background())
	if err != nil {
		return
	}
	for _, act := range activities {
		if act.Type != runtime.ActivityTypeConnectivity {
			continue
		}
		contextName := act.Metadata["context"]
		if contextName == "" {
			contextName = strings.TrimPrefix(act.ID, "connectivity:")
		}
		if contextName == "" || contextName == activeContext {
			continue
		}
		s.stopConnectivityActivityIfUnused(contextName)
	}
}

func (s *Server) stopConnectivityActivityIfUnused(contextName string) {
	contextName = strings.TrimSpace(contextName)
	if contextName == "" || s == nil || s.rt == nil || s.rt.Registry() == nil {
		return
	}
	if s.hasOpenSessionForContext(context.Background(), contextName) {
		return
	}

	id := fmt.Sprintf("connectivity:%s", contextName)
	act, ok, err := s.rt.Registry().Get(context.Background(), id)
	if err != nil || !ok || act.Type != runtime.ActivityTypeConnectivity {
		return
	}
	if act.Status == runtime.ActivityStatusStopped {
		return
	}
	act.Status = runtime.ActivityStatusStopped
	act.UpdatedAt = time.Now().UTC()
	if act.Metadata == nil {
		act.Metadata = map[string]string{}
	}
	act.Metadata["context"] = contextName
	act.Metadata["state"] = "inactive"
	act.Metadata["reason"] = "context not active"
	_ = s.rt.Registry().Update(context.Background(), act)
	runtime.ScheduleActivityTTLRemoval(s.rt.Registry(), id, act.UpdatedAt, connectivityActivityTTL)
}

func (s *Server) hasOpenSessionForContext(ctx context.Context, contextName string) bool {
	if s == nil || s.sessions == nil || contextName == "" {
		return false
	}
	items, err := s.sessions.List(ctx)
	if err != nil {
		return false
	}
	for _, item := range items {
		if item.TargetCluster != contextName {
			continue
		}
		if item.Type != session.TypeTerminal && item.Type != session.TypePortForward {
			continue
		}
		if item.Status == session.StatusPending ||
			item.Status == session.StatusStarting ||
			item.Status == session.StatusRunning ||
			item.Status == session.StatusStopping {
			return true
		}
	}
	return false
}

func (s *Server) logClusterStatusTransition(clusterStatus statusClusterDTO) {
	contextName := clusterStatus.Context
	if contextName == "" {
		contextName = "(none)"
	}

	s.statusLogMu.Lock()
	prev, seen := s.clusterOnline[contextName]
	if seen && prev == clusterStatus.OK {
		s.statusLogMu.Unlock()
		return
	}
	s.clusterOnline[contextName] = clusterStatus.OK
	s.statusLogMu.Unlock()

	if clusterStatus.OK {
		logStructured(s.rt, runtime.LogLevelInfo, "connectivity", "success",
			fmt.Sprintf("cluster connection restored for context %s", contextName),
			"context", contextName, "cluster", clusterStatus.Cluster, "version", clusterStatus.ServerVersion)
		return
	}

	logStructured(s.rt, runtime.LogLevelError, "connectivity", "failure",
		fmt.Sprintf("cluster connection failed for context %s: %s", contextName, clusterStatus.Message),
		"context", contextName, "cluster", clusterStatus.Cluster)
}

func parseClusterDashboardListOptions(r *http.Request) dataplane.ClusterDashboardListOptions {
	q := r.URL.Query()
	return dataplane.ClusterDashboardListOptions{
		SignalsFilter: q.Get("signalsFilter"),
		SignalsQuery:  q.Get("signalsQ"),
		SignalsOffset: parseNonNegativeQueryInt(q.Get("signalsOffset")),
		SignalsLimit:  parseNonNegativeQueryInt(q.Get("signalsLimit")),
	}
}

func parseNonNegativeQueryInt(raw string) int {
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || n < 0 {
		return 0
	}
	return n
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
