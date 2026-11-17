package server

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/korex-labs/kview/v5/internal/dataplane"
	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

type templateReferenceDetailPlane struct {
	dataplane.DataPlaneManager
	secretCalls, configCalls int
	secretErr                error
}

func (p *templateReferenceDetailPlane) SecretsSnapshot(_ context.Context, cluster, namespace string) (dataplane.SecretsSnapshot, error) {
	if cluster != "exact-context" || namespace != "apps" {
		panic("detail reference scope changed")
	}
	p.secretCalls++
	return dataplane.SecretsSnapshot{}, p.secretErr
}
func (p *templateReferenceDetailPlane) ConfigMapsSnapshot(_ context.Context, cluster, namespace string) (dataplane.ConfigMapsSnapshot, error) {
	if cluster != "exact-context" || namespace != "apps" {
		panic("detail reference scope changed")
	}
	p.configCalls++
	return dataplane.ConfigMapsSnapshot{}, nil
}

func TestTemplateReferenceDetailHelperPreservesBestEffortAndNarrowReads(t *testing.T) {
	p := &templateReferenceDetailPlane{secretErr: errors.New("denied")}
	refs := missingTemplateRefsFromDataplane(context.Background(), p, "exact-context", "apps", dto.PodTemplateSummaryDTO{ImagePullSecrets: []string{"pull", "pull"}}, []dto.VolumeDTO{
		{Name: "first", Type: "ConfigMap", Source: "config"}, {Name: "last", Type: "ConfigMap", Source: "config"}, {Name: "ignored", Type: "Projected", Source: "other"},
	})
	want := []dto.MissingReferenceDTO{{Kind: "ConfigMap", Name: "config", Source: "volume/last"}}
	if !reflect.DeepEqual(refs, want) || p.secretCalls != 1 || p.configCalls != 1 {
		t.Fatalf("detail compatibility changed: %+v / %+v", refs, p)
	}
	p = &templateReferenceDetailPlane{}
	refs = missingTemplateRefsFromDataplane(context.Background(), p, "exact-context", "apps", dto.PodTemplateSummaryDTO{}, nil)
	if len(refs) != 0 || p.secretCalls != 0 || p.configCalls != 0 {
		t.Fatal("empty template added reads")
	}
}
