package pods

import (
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

func TestPodListMapperCapturesIdentityAndCompleteOwnerReferences(t *testing.T) {
	controller := true
	blockOwnerDeletion := false
	pod := corev1.Pod{ObjectMeta: metav1.ObjectMeta{
		Name: "api-0", Namespace: "apps", UID: types.UID("pod-uid"),
		OwnerReferences: []metav1.OwnerReference{
			{APIVersion: "apps/v1", Kind: "ReplicaSet", Name: "api-rs", UID: types.UID("rs-uid"), Controller: &controller, BlockOwnerDeletion: &blockOwnerDeletion},
			{APIVersion: "example.io/v1", Kind: "Tenant", Name: "apps", UID: types.UID("tenant-uid")},
		},
	}}

	items := podListItems([]corev1.Pod{pod}, nil, time.Unix(1_700_000_000, 0))
	if len(items) != 1 {
		t.Fatalf("items = %d, want 1", len(items))
	}
	got := items[0].ResourceRelationshipMetadata()
	if got.Resource.Name != "api-0" || got.Resource.Namespace != "apps" || got.Resource.UID != "pod-uid" || got.Resource.Resource != "pods" || got.Resource.Kind != "Pod" {
		t.Fatalf("pod identity = %+v", got.Resource)
	}
	if len(got.Owners) != 2 || got.Owners[0].Controller == nil || !*got.Owners[0].Controller || got.Owners[0].BlockOwnerDeletion == nil || *got.Owners[0].BlockOwnerDeletion {
		t.Fatalf("pod owners incomplete: %+v", got.Owners)
	}

	controller = false
	blockOwnerDeletion = true
	if !*items[0].ResourceRelationshipMetadata().Owners[0].Controller || *items[0].ResourceRelationshipMetadata().Owners[0].BlockOwnerDeletion {
		t.Fatal("mapped pod owner pointers alias source values")
	}
}
