package server

import (
	"context"
	"net/http"
	"testing"

	"github.com/korex-labs/kview/v5/internal/dataplane"
)

func (s *stubDataplane) PodsCachedSnapshot(string, string) (dataplane.PodsSnapshot, bool) {
	return dataplane.PodsSnapshot{}, false
}
func (s *stubDataplane) SubscribePods(context.Context, string, string) (dataplane.PodLiveSubscription, error) {
	return nil, dataplane.ErrPodLiveUnavailable
}
func (s *stubDataplane) ClosePodsLive() {}

func TestPodLiveScopeAndBearerValidation(t *testing.T) {
	_, router := newTestServer(t)
	for _, tt := range []struct {
		path, auth, ctx string
		code            int
	}{
		{"/api/namespaces/apps/pods/live?token=" + testToken, "", "test-context", 401},
		{"/api/namespaces/apps/pods/live?token=" + testToken, "Bearer " + testToken, "test-context", 401},
		{"/api/namespaces/apps/pods/live", "Bearer " + testToken, "", 400},
		{"/api/namespaces/apps/pods/live", "Bearer " + testToken, " test-context", 400},
		{"/api/namespaces/apps/pods/live", "Bearer " + testToken, "unknown", 400},
		{"/api/namespaces/ALL/pods/live", "Bearer " + testToken, "test-context", 400},
		{"/api/namespaces/apps/pods/live", "Bearer " + testToken, "test-context", 503},
		{"/api/namespaces/apps/pods?refresh=revision", "Bearer " + testToken, "", 400},
		{"/api/namespaces/apps/pods?refresh=revision", "Bearer " + testToken, "test-context", 503},
	} {
		r := doReqWithHeader(t, router, http.MethodGet, tt.path, map[string]string{"Authorization": tt.auth, "X-Kview-Context": tt.ctx}, nil)
		if r.Code != tt.code {
			t.Errorf("%s context=%q code=%d want=%d: %s", tt.path, tt.ctx, r.Code, tt.code, r.Body.String())
		}
	}
}
