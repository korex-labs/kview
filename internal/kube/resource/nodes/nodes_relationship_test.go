package nodes

import (
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

func TestNodeListMapperCapturesClusterIdentityWithEmptyNamespace(t *testing.T) {
	node := corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "worker", Namespace: "ignored", UID: types.UID("node-uid")}}
	items := nodeListItems([]corev1.Node{node}, nil, time.Unix(1_700_000_000, 0))
	got := items[0].ResourceRelationshipMetadata().Resource
	if got.Resource != "nodes" || got.Kind != "Node" || got.Scope != "cluster" || got.Namespace != "" || got.UID != "node-uid" {
		t.Fatalf("node identity = %+v", got)
	}
}
