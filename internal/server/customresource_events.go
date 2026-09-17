package server

import (
	"context"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	crs "github.com/korex-labs/kview/v5/internal/kube/resource/customresources"
	kubeevents "github.com/korex-labs/kview/v5/internal/kube/resource/events"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/rest"
)

func (s *Server) customResourceEvents(w http.ResponseWriter, r *http.Request) {
	expectedUID := r.URL.Query().Get("uid")
	if strings.TrimSpace(expectedUID) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": validationError("missing expected custom resource uid")})
		return
	}
	group, version := chi.URLParam(r, "group"), chi.URLParam(r, "version")
	resource, name := chi.URLParam(r, "resource"), chi.URLParam(r, "name")
	namespace := strings.TrimSpace(r.URL.Query().Get("namespace"))
	ctx, cancel := context.WithTimeout(r.Context(), ctxTimeoutDetail)
	defer cancel()
	clients, active, err := s.clientsForRequest(ctx, r)
	fail := func(err error) {
		status, apiErr := mapKubeError(err)
		writeJSON(w, status, map[string]any{"active": active, "error": apiErr})
	}
	if err != nil {
		fail(err)
		return
	}
	cfg := rest.CopyConfig(clients.RestConfig)
	cfg.WarningHandler = rest.NoWarnings{}
	cfg.WarningHandlerWithContext = rest.NoWarnings{}
	dynClient, err := dynamic.NewForConfig(cfg)
	if err != nil {
		fail(err)
		return
	}
	// Never let Events visibility bypass exact-object GET authorization or attach
	// events to a new incarnation of a same-name object still open in the drawer.
	item, err := crs.GetCustomResource(ctx, dynClient, group, version, resource, namespace, name)
	if err != nil {
		fail(err)
		return
	}
	if string(item.GetUID()) != expectedUID {
		writeJSON(w, http.StatusConflict, map[string]any{"active": active, "error": &APIError{Code: ErrCodeConflict, Message: "custom resource uid changed; reload the object before requesting events"}})
		return
	}
	if item.GetName() != name || item.GetNamespace() != namespace || item.GetAPIVersion() != group+"/"+version || item.GetKind() == "" {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"active": active, "error": &APIError{Code: ErrCodeInternal, Message: "custom resource GET returned an unexpected object identity"}})
		return
	}
	target := corev1.ObjectReference{APIVersion: item.GetAPIVersion(), Kind: item.GetKind(), Name: item.GetName(), Namespace: item.GetNamespace(), UID: item.GetUID()}
	result, err := kubeevents.ListEventsForExactObjectPage(ctx, clients, target, readEventListOptions(r))
	if err != nil {
		fail(err)
		return
	}
	writeEventListResponse(w, active, result)
}
