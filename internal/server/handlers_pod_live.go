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
	"github.com/korex-labs/kview/v5/internal/dataplane"
	"k8s.io/apimachinery/pkg/util/validation"
)

func (s *Server) podLiveScope(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	name := r.Header.Get("X-Kview-Context")
	ns := chi.URLParam(r, "ns")
	if len(r.Header.Values("X-Kview-Context")) != 1 || name == "" || name != strings.TrimSpace(name) || len(validation.IsDNS1123Label(ns)) != 0 {
		writeErrorResponse(w, http.StatusBadRequest, "explicit context and namespace required")
		return "", "", false
	}
	if s.mgr == nil {
		writeErrorResponse(w, http.StatusServiceUnavailable, "context unavailable")
		return "", "", false
	}
	if _, ok := s.mgr.ContextInfo(name); !ok {
		writeErrorResponse(w, http.StatusBadRequest, "unknown context")
		return "", "", false
	}
	if s.dp == nil {
		writeErrorResponse(w, http.StatusServiceUnavailable, "dataplane unavailable")
		return "", "", false
	}
	return name, ns, true
}
func (s *Server) handlePodLive(w http.ResponseWriter, r *http.Request) {
	s.handleResourceLive(w, r, dataplane.ResourceKindPods)
}

func (s *Server) handleResourceLive(w http.ResponseWriter, r *http.Request, resource dataplane.ResourceKind) {
	if r.URL.Query().Has("token") || len(r.Header.Values("Authorization")) != 1 || !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") || strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ") != s.token || s.token == "" {
		writeErrorResponse(w, http.StatusUnauthorized, "bearer authorization required")
		return
	}
	name, ns, ok := s.podLiveScope(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()
	var sub dataplane.ResourceLiveSubscription
	var err error
	if resource == dataplane.ResourceKindPods {
		sub, err = s.dp.SubscribePods(ctx, name, ns)
	} else {
		sub, err = s.dp.SubscribeResourceLive(ctx, name, ns, resource)
	}
	if err != nil {
		status := http.StatusServiceUnavailable
		if errors.Is(err, dataplane.ErrPodLiveCapacity) {
			status = http.StatusTooManyRequests
		}
		if errors.Is(err, dataplane.ErrPodLiveScope) {
			status = http.StatusBadRequest
		}
		writeErrorResponse(w, status, "live "+string(resource)+" unavailable")
		return
	}
	defer sub.Close()
	rc := http.NewResponseController(w)
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	write := func(payload string) bool {
		if err := rc.SetWriteDeadline(time.Now().Add(5 * time.Second)); err != nil && !errors.Is(err, http.ErrNotSupported) {
			return false
		}
		if _, err := fmt.Fprint(w, payload); err != nil {
			return false
		}
		return rc.Flush() == nil
	}
	defer func() { _ = rc.SetWriteDeadline(time.Time{}) }()
	for {
		select {
		case <-ctx.Done():
			return
		case <-heartbeat.C:
			if !write(": heartbeat\n\n") {
				return
			}
		case update, ok := <-sub.Updates():
			if !ok {
				return
			}
			event := "pods"
			var payload any
			if resource == dataplane.ResourceKindPods {
				// Preserve the original Pod wire shape despite shared backend notifications.
				update.Resource = ""
				payload = update
			} else {
				event = "resource"
				update.Resource = resource
				payload = struct {
					dataplane.PodLiveUpdate
					Scope string `json:"scope"`
				}{update, "Namespaced"}
			}
			data, err := json.Marshal(payload)
			if err != nil {
				return
			}
			if !write("event: " + event + "\ndata: " + string(data) + "\n\n") {
				return
			}
		}
	}
}

// CloseStreams releases stream-owned upstream leases before HTTP shutdown.
func (s *Server) CloseStreams() {
	if s.dp != nil {
		// The compatibility-named backend hook closes all allowlisted Live kinds.
		s.dp.ClosePodsLive()
	}
}
