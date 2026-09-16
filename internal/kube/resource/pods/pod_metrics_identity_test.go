package pods

import (
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestMapPodListItemsPreservesMetricsInstanceEvidence(t *testing.T) {
	pods := []corev1.Pod{{ObjectMeta: metav1.ObjectMeta{Name: "p", Namespace: "ns", UID: "A", CreationTimestamp: metav1.NewTime(time.Unix(100, 500000000))}}, {ObjectMeta: metav1.ObjectMeta{Name: "unknown", Namespace: "ns"}}}
	for _, now := range []time.Time{time.Unix(200, 0), time.Unix(300, 0)} {
		got := MapPodListItems(pods, nil, now)
		if got[0].UID != "A" || got[0].CreatedAt != 100 {
			t.Fatalf("creation evidence changed with list age: %+v", got[0])
		}
		if got[1].CreatedAt != 0 {
			t.Fatalf("unknown creation invented: %+v", got[1])
		}
	}
}
