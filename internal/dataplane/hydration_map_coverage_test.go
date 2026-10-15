package dataplane

import (
	"testing"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

// Publishing a lightweight plane must not turn its unhydrated stores into
// authoritative empty relationship inventories. A map must stay cache-only.
func TestResourceMapHydrationPendingRetainsMissingCoverage(t *testing.T) {
	p := newClusterPlane("ctx", "", "", ObservationScope{}, nil, func() snapshotPersistence {
		t.Fatal("cache-only map attempted persistence access")
		return nil
	}, nil)
	p.persistHydrating.Store(true)
	target := resourceMapIdentity("apps", "v1", "deployments", "Deployment", "apps", "api", "deployment")
	setNamespacedSnapshot(&p.depsStore, "apps", DeploymentsSnapshot{
		Items:                make([]dto.DeploymentListItemDTO, 1),
		Meta:                 resourceMapMeta(),
		Relationships:        []dto.ResourceRelationshipRecord{testResourceMapRecord(target)},
		RelationshipMetadata: completeResourceMapRelationshipMetadata(1, 1),
	})
	got, err := p.ResourceMap(ResourceMapRequest{Target: target})
	if err != nil {
		t.Fatal(err)
	}
	if got.Cache.SnapshotsMissing == 0 {
		t.Fatal("unhydrated stores reported as present")
	}
	if got.Coverage.Completeness == dto.ResourceRelationshipCompletenessComplete {
		t.Fatalf("partially hydrated map reported complete: %+v", got.Coverage)
	}
	if node := findResourceMapNode(got, target); node == nil || node.Availability != ResourceMapAvailabilityPresent {
		t.Fatalf("already available target lost during partial hydration: %+v", got.Nodes)
	}
}
