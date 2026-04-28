package server

import (
	"context"
	"fmt"
	"strings"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/korex-labs/kview/v5/internal/buildinfo"
	"github.com/korex-labs/kview/v5/internal/runtime"
	"github.com/korex-labs/kview/v5/internal/session"
)

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

// isAccessDeniedOrUnauthorized reports whether err is a Kubernetes 401/403
// response (or a transport-level wrap of one). Multi-tenant clusters behind
// proxies frequently deny unauthenticated endpoints like /version while still
// allowing namespace-scoped RBAC; we use this check to decide whether a
// connectivity probe should fall back to a namespace-scoped read instead of
// declaring the cluster unreachable.
func isAccessDeniedOrUnauthorized(err error) bool {
	if err == nil {
		return false
	}
	if apierrors.IsForbidden(err) || apierrors.IsUnauthorized(err) {
		return true
	}
	// REST transport wraps upstream responses as plain errors whose text
	// contains "Forbidden"/"Unauthorized" when the proxy itself rejects the
	// request before reaching the kube apiserver. Cover those too so the
	// fallback still triggers for capsule-proxy-style gateways.
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "forbidden") || strings.Contains(msg, "unauthorized")
}

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
				// On restricted / multi-tenant clusters (e.g. capsule-proxy,
				// BYOK gateways) the global /version endpoint is commonly
				// denied even when the user has namespace-scoped RBAC that
				// works perfectly. Treating that as "cluster unreachable"
				// would then hide every list in the UI for a cluster that is
				// in reality perfectly usable. Fall back to a cheap
				// namespace-level probe (LIST namespaces with limit=1) to
				// decide. Any success at all means the cluster is reachable
				// from the operator's identity — we just don't know the
				// server version. If the fallback also fails, we surface the
				// original /version error since that is the more meaningful
				// signal for the operator.
				if isAccessDeniedOrUnauthorized(versionErr) && clients.Clientset != nil {
					probeCtx, probeCancel := context.WithTimeout(ctx, ctxTimeoutConnectivity)
					if _, listErr := clients.Clientset.CoreV1().Namespaces().List(probeCtx, metav1.ListOptions{Limit: 1}); listErr == nil {
						clusterStatus.OK = true
						// ServerVersion stays empty; the UI treats it as
						// "unknown version" without degrading connectivity.
						clusterStatus.Message = "server version unavailable (RBAC-restricted); namespace probe succeeded"
						probeCancel()
					} else {
						probeCancel()
						// Both probes failed. Use the /version error because
						// it is the canonical reachability signal and is
						// typically the root cause; the namespace-probe
						// error is often a follow-on of the same restriction.
						err = versionErr
					}
				} else {
					err = versionErr
				}
			} else {
				clusterStatus.OK = true
				clusterStatus.ServerVersion = version.GitVersion
			}
		}
		if err != nil && !clusterStatus.OK {
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
