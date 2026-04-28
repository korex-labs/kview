package dataplane

import (
	"testing"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestEnrichServiceListItemsForAPI(t *testing.T) {
	items := []dto.ServiceListItemDTO{
		{Name: "api", Type: "ClusterIP", EndpointsReady: 2, EndpointsNotReady: 0},
		{Name: "web", Type: "LoadBalancer", EndpointsReady: 0, EndpointsNotReady: 1},
	}
	got := EnrichServiceListItemsForAPI(items)
	if got[0].EndpointHealthBucket != deployBucketHealthy || got[0].ExposureHint != "internal" || got[0].NeedsAttention {
		t.Fatalf("service 0 enrichment unexpected: %+v", got[0])
	}
	if got[1].EndpointHealthBucket != deployBucketDegraded || got[1].ExposureHint != "public" || !got[1].NeedsAttention {
		t.Fatalf("service 1 enrichment unexpected: %+v", got[1])
	}
}

func TestEnrichIngressListItemsForAPI(t *testing.T) {
	items := []dto.IngressListItemDTO{
		{Name: "ok", Hosts: []string{"a.example"}, Addresses: []string{"1.2.3.4"}, TLSCount: 1},
		{Name: "pending", Hosts: []string{"b.example"}},
	}
	got := EnrichIngressListItemsForAPI(items)
	if got[0].RoutingHealthBucket != deployBucketHealthy || got[0].AddressState != "ready" || got[0].TLSHint != "enabled" {
		t.Fatalf("ingress 0 enrichment unexpected: %+v", got[0])
	}
	if got[1].RoutingHealthBucket != deployBucketProgressing || got[1].AddressState != "pending" || got[1].TLSHint != "none" || !got[1].NeedsAttention {
		t.Fatalf("ingress 1 enrichment unexpected: %+v", got[1])
	}
}

func TestEnrichPVCListItemsForAPI(t *testing.T) {
	items := []dto.PersistentVolumeClaimDTO{
		{Name: "data", Phase: "Bound", RequestedStorage: "10Gi", Capacity: "10Gi"},
		{Name: "resize", Phase: "Pending", RequestedStorage: "20Gi", Capacity: "10Gi"},
	}
	got := EnrichPVCListItemsForAPI(items)
	if got[0].HealthBucket != deployBucketHealthy || got[0].NeedsAttention || got[0].ResizePending {
		t.Fatalf("pvc 0 enrichment unexpected: %+v", got[0])
	}
	if got[1].HealthBucket != deployBucketProgressing || !got[1].NeedsAttention || !got[1].ResizePending {
		t.Fatalf("pvc 1 enrichment unexpected: %+v", got[1])
	}
}

func TestEnrichPersistentVolumeListItemsForAPI(t *testing.T) {
	got := EnrichPersistentVolumeListItemsForAPI([]dto.PersistentVolumeDTO{
		{Name: "bound", Phase: "Bound", ClaimRef: "app/data"},
		{Name: "released", Phase: "Released"},
	})
	if got[0].HealthBucket != deployBucketHealthy || got[0].BindingHint != "bound" || got[0].NeedsAttention {
		t.Fatalf("bound pv enrichment unexpected: %+v", got[0])
	}
	if got[1].HealthBucket != deployBucketDegraded || got[1].BindingHint != "released" || !got[1].NeedsAttention {
		t.Fatalf("released pv enrichment unexpected: %+v", got[1])
	}
}
