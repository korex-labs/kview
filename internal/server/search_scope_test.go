package server

import (
	"context"
	"net/http"
	"testing"

	"github.com/korex-labs/kview/v5/internal/dataplane"
)

type scopedSearchDataplane struct {
	dataplane.DataPlaneManager
	cluster, query string
	limit, offset  int
	scope          dataplane.SearchScope
	calls          int
}

func (s *scopedSearchDataplane) SearchCachedResources(_ context.Context, cluster, query string, limit, offset int, scopes ...dataplane.SearchScope) (dataplane.CachedResourceSearch, error) {
	s.calls++
	s.cluster, s.query, s.limit, s.offset = cluster, query, limit, offset
	if len(scopes) > 0 {
		s.scope = scopes[0]
	}
	return dataplane.CachedResourceSearch{Active: cluster, Query: query, Limit: limit, Offset: offset}, nil
}

func TestDataplaneSearchForwardsNamespacePhaseAndContext(t *testing.T) {
	for _, tc := range []struct {
		suffix string
		scope  dataplane.SearchScope
	}{
		{"", dataplane.SearchScope{}},
		{"&namespace=app", dataplane.SearchScope{Namespace: "app"}},
		{"&excludeNamespace=app", dataplane.SearchScope{ExcludeNamespace: "app"}},
	} {
		t.Run(tc.suffix, func(t *testing.T) {
			s, h := newTestServer(t)
			dp := &scopedSearchDataplane{DataPlaneManager: s.dp}
			s.dp = dp
			rec := doReqWithHeader(t, h, http.MethodGet, "/api/dataplane/search?q=kind%3Aingress&limit=3&offset=6"+tc.suffix, map[string]string{
				"Authorization":   "Bearer " + testToken,
				"X-Kview-Context": "test-context",
			}, nil)
			if rec.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
			if dp.calls != 1 || dp.cluster != "test-context" || dp.query != "kind:ingress" || dp.limit != 3 || dp.offset != 6 || dp.scope != tc.scope {
				t.Fatalf("forwarded request: %+v", dp)
			}
		})
	}
}
