package helm

import (
	"testing"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestManifestCustomResourcesExtractsHelmManagedCRs(t *testing.T) {
	manifest := `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app
---
apiVersion: rabbitmq.com/v1beta1
kind: RabbitmqCluster
metadata:
  name: rabbit
---
apiVersion: operator.victoriametrics.com/v1beta1
kind: VMCluster
metadata:
  name: metrics
  namespace: observability
`
	crds := []dto.CRDListItemDTO{
		{
			Group:          "rabbitmq.com",
			Scope:          "Namespaced",
			Kind:           "RabbitmqCluster",
			StorageVersion: "v1beta1",
			Plural:         "rabbitmqclusters",
		},
		{
			Group:          "operator.victoriametrics.com",
			Scope:          "Namespaced",
			Kind:           "VMCluster",
			StorageVersion: "v1beta1",
			Plural:         "vmclusters",
		},
	}

	got := ManifestCustomResources(manifest, "messaging", crds)
	if len(got) != 2 {
		t.Fatalf("expected 2 custom resources, got %+v", got)
	}
	if got[0].Kind != "RabbitmqCluster" || got[0].Namespace != "messaging" || got[0].Resource != "rabbitmqclusters" {
		t.Fatalf("rabbitmq row: %+v", got[0])
	}
	if got[1].Kind != "VMCluster" || got[1].Namespace != "observability" || got[1].Resource != "vmclusters" {
		t.Fatalf("victoriametrics row: %+v", got[1])
	}
}
