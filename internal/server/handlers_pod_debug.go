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
	"k8s.io/apimachinery/pkg/types"

	"github.com/korex-labs/kview/v5/internal/cluster"
	"github.com/korex-labs/kview/v5/internal/kube"
	"github.com/korex-labs/kview/v5/internal/kube/poddebug"
	"github.com/korex-labs/kview/v5/internal/runtime"
	"github.com/korex-labs/kview/v5/internal/session"
)

type podDebugSessionRequest struct {
	Namespace       string `json:"namespace"`
	Pod             string `json:"pod"`
	ExpectedUID     string `json:"expectedUID"`
	TargetContainer string `json:"targetContainer"`
	Image           string `json:"image"`
	Shell           string `json:"shell"`
	Profile         string `json:"profile"`
	RequestID       string `json:"requestId"`
}

func (s *Server) registerPodDebugSessionRoute(api chi.Router) {
	api.Post("/sessions/pod-debug", func(w http.ResponseWriter, r *http.Request) {
		ctxName := strings.TrimSpace(r.Header.Get("X-Kview-Context"))
		if ctxName == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": validationError("missing X-Kview-Context header")})
			return
		}

		var body podDebugSessionRequest
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": validationError("invalid body")})
			return
		}
		body.Namespace = strings.TrimSpace(body.Namespace)
		body.Pod = strings.TrimSpace(body.Pod)
		body.ExpectedUID = strings.TrimSpace(body.ExpectedUID)
		body.TargetContainer = strings.TrimSpace(body.TargetContainer)
		body.Image = strings.TrimSpace(body.Image)
		body.Shell = strings.TrimSpace(body.Shell)
		body.Profile = strings.TrimSpace(body.Profile)
		body.RequestID = strings.TrimSpace(body.RequestID)
		if body.Namespace == "" || body.Pod == "" || body.ExpectedUID == "" || body.TargetContainer == "" || body.Image == "" || body.RequestID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": validationError("namespace, pod, expectedUID, targetContainer, image, and requestId are required")})
			return
		}
		if body.Shell == "" {
			body.Shell = poddebug.DefaultShell
		}
		if body.Profile == "" {
			body.Profile = poddebug.ProfileBaseline
		}

		ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutExec)
		defer cancel()

		lockKey := fmt.Sprintf("%q/%q/%q/%q/%q", ctxName, body.Namespace, body.Pod, body.ExpectedUID, body.RequestID)
		release, lockErr := s.podDebugLocks.acquire(ctx, lockKey)
		if lockErr != nil {
			status, apiErr := mapKubeError(lockErr)
			writeJSON(w, status, map[string]any{"context": ctxName, "error": apiErr})
			return
		}
		defer release()

		clients, clusterName, err := s.mgr.GetClientsForContext(ctx, ctxName)
		if err != nil {
			if errors.Is(err, cluster.ErrUnknownContext) {
				writeJSON(w, http.StatusNotFound, map[string]any{"error": &APIError{Code: ErrCodeNotFound, Message: err.Error()}})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": &APIError{Code: ErrCodeInternal, Message: err.Error()}})
			return
		}

		for _, check := range []kube.AccessReviewRequest{
			{Verb: "get", Resource: "pods", Namespace: &body.Namespace, Name: body.Pod},
			{Verb: "patch", Resource: "pods", Subresource: "ephemeralcontainers", Namespace: &body.Namespace, Name: body.Pod},
			{Verb: "create", Resource: "pods", Subresource: "attach", Namespace: &body.Namespace, Name: body.Pod},
		} {
			result, reviewErr := kube.SelfSubjectAccessReview(ctx, clients, check)
			if reviewErr != nil {
				status, apiErr := mapKubeError(reviewErr)
				writeJSON(w, status, map[string]any{"context": ctxName, "error": apiErr})
				return
			}
			if !result.Allowed {
				message := fmt.Sprintf("Kubernetes RBAC denies %s pods/%s", check.Verb, check.Subresource)
				if check.Subresource == "" {
					message = fmt.Sprintf("Kubernetes RBAC denies %s pods", check.Verb)
				}
				if strings.TrimSpace(result.Reason) != "" {
					message += ": " + result.Reason
				}
				writeJSON(w, http.StatusForbidden, map[string]any{"context": ctxName, "error": &APIError{Code: ErrCodeForbidden, Message: message}})
				return
			}
		}

		result, err := poddebug.Start(ctx, clients.Clientset.CoreV1().Pods(body.Namespace), poddebug.StartRequest{
			Pod:             body.Pod,
			ExpectedUID:     types.UID(body.ExpectedUID),
			TargetContainer: body.TargetContainer,
			Image:           body.Image,
			Shell:           body.Shell,
			Profile:         body.Profile,
			RequestID:       body.RequestID,
		})
		if err != nil {
			switch {
			case errors.Is(err, poddebug.ErrInvalidRequest):
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": validationError(err.Error())})
			case errors.Is(err, poddebug.ErrPodChanged), errors.Is(err, poddebug.ErrConflict):
				writeJSON(w, http.StatusConflict, map[string]any{"error": &APIError{Code: ErrCodeConflict, Message: err.Error()}})
			case errors.Is(err, poddebug.ErrPodNotRunning), errors.Is(err, poddebug.ErrTargetNotRunning), errors.Is(err, poddebug.ErrStaticPod), errors.Is(err, poddebug.ErrWindowsPod):
				writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": validationError(err.Error())})
			default:
				status, apiErr := mapKubeError(err)
				writeJSON(w, status, map[string]any{"context": ctxName, "error": apiErr})
			}
			return
		}

		if existing, ok := s.findPodDebugSession(ctx, clusterName, body, result.DebugContainer); ok {
			writeJSON(w, http.StatusOK, map[string]any{"item": existing, "reused": true})
			return
		}

		now := time.Now().UTC()
		created, err := s.sessions.Create(ctx, session.Session{
			Type:            session.TypeTerminal,
			Title:           "Debug " + body.Pod,
			Status:          session.StatusPending,
			CreatedAt:       now,
			UpdatedAt:       now,
			TargetCluster:   clusterName,
			TargetNamespace: body.Namespace,
			TargetResource:  body.Pod,
			TargetContainer: result.DebugContainer,
			ConnectionState: session.ConnectionDisconnected,
			Metadata: map[string]string{
				"terminalKind":         poddebug.TerminalKindPodDebug,
				"streamMode":           poddebug.StreamModeAttach,
				"debugRequestID":       body.RequestID,
				"debugTargetContainer": body.TargetContainer,
				"debugImage":           body.Image,
				"debugProfile":         body.Profile,
				"shell":                body.Shell,
				"podUID":               body.ExpectedUID,
			},
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": &APIError{Code: ErrCodeInternal, Message: "failed to create pod debug session"}})
			return
		}
		logStructured(s.rt, runtime.LogLevelInfo, "sessions", "success",
			fmt.Sprintf("created pod debug session %s for pod %s/%s", created.ID, body.Namespace, body.Pod),
			"session_id", created.ID, "kind", "pod-debug", "namespace", body.Namespace, "name", body.Pod,
			"target_container", body.TargetContainer, "debug_container", result.DebugContainer, "image", body.Image)
		writeJSON(w, http.StatusOK, map[string]any{"item": created, "reused": result.Reused})
	})
}

func (s *Server) findPodDebugSession(ctx context.Context, clusterName string, request podDebugSessionRequest, debugContainer string) (session.Session, bool) {
	items, err := s.sessions.List(ctx)
	if err != nil {
		return session.Session{}, false
	}
	for _, item := range items {
		if item.Type != session.TypeTerminal || item.TargetCluster != clusterName || item.TargetNamespace != request.Namespace || item.TargetResource != request.Pod || item.TargetContainer != debugContainer {
			continue
		}
		metadata := item.Metadata
		if metadata["terminalKind"] == poddebug.TerminalKindPodDebug &&
			metadata["debugRequestID"] == request.RequestID &&
			metadata["debugTargetContainer"] == request.TargetContainer &&
			metadata["debugImage"] == request.Image &&
			metadata["debugProfile"] == request.Profile &&
			metadata["shell"] == request.Shell &&
			metadata["podUID"] == request.ExpectedUID {
			return item, true
		}
	}
	return session.Session{}, false
}
