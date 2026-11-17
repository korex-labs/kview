package nodes

import (
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

func TestNodeListMapperCapturesClusterIdentityWithEmptyNamespace(t *testing.T) {
	created := time.Unix(1_699_000_000, 0)
	node := corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "worker", Namespace: "ignored", UID: types.UID("node-uid"), CreationTimestamp: metav1.NewTime(created)}}
	items := nodeListItems([]corev1.Node{node}, nil, time.Unix(1_700_000_000, 0))
	if items[0].UID != "node-uid" || items[0].CreatedAt != created.Unix() {
		t.Fatalf("native identity lost at DTO boundary: %+v", items[0])
	}
	legacy := nodeListItems([]corev1.Node{{ObjectMeta: metav1.ObjectMeta{Name: "unknown"}}}, nil, time.Now())[0]
	if legacy.UID != "" || legacy.CreatedAt != 0 {
		t.Fatalf("invented missing identity: %+v", legacy)
	}
	got := items[0].ResourceRelationshipMetadata().Resource
	if got.Resource != "nodes" || got.Kind != "Node" || got.Scope != "cluster" || got.Namespace != "" || got.UID != "node-uid" {
		t.Fatalf("node identity = %+v", got)
	}
}
