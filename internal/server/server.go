package server

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/dataplane"
	"github.com/korex-labs/kview/v5/internal/kube"
	"github.com/korex-labs/kview/v5/internal/kube/jobdebug"
	"github.com/korex-labs/kview/v5/internal/runtime"
	"github.com/korex-labs/kview/v5/internal/session"
)

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
	jobRuns        *jobdebug.Manager
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
		jobRuns:        jobdebug.NewManager(),
		deniedLogUntil: map[string]time.Time{},
		clusterOnline:  map[string]bool{},
	}
	// Best-effort runtime manager startup; failures are logged via regular logs.
	_ = s.rt.Start(context.Background())
	s.startAllContextEnrichmentLoop()
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

func (s *Server) clientsForRequest(ctx context.Context, r *http.Request) (*cluster.Clients, string, error) {
	return s.mgr.GetClientsForContext(ctx, s.readContextName(r))
}
