package deployments

import (
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

func boolPtr(v bool) *bool { return &v }

func TestParseRevision(t *testing.T) {
	cases := []struct {
		in   string
		want int32
	}{
		{"", 0},
		{"7", 7},
		{"not-a-number", 0},
		{"-1", -1},
		{"2147483648", 0},
	}
	for _, tc := range cases {
		if got := ParseRevision(tc.in); got != tc.want {
			t.Fatalf("ParseRevision(%q) = %d, want %d", tc.in, got, tc.want)
		}
	}
}

func TestMapContainerSummariesIncludesRequestsAndLimits(t *testing.T) {
	got := MapContainerSummaries([]corev1.Container{
		{
			Name:  "api",
			Image: "repo/api:v1",
			Resources: corev1.ResourceRequirements{
				Requests: corev1.ResourceList{
					corev1.ResourceCPU:    resource.MustParse("100m"),
					corev1.ResourceMemory: resource.MustParse("128Mi"),
				},
				Limits: corev1.ResourceList{
					corev1.ResourceCPU:    resource.MustParse("500m"),
					corev1.ResourceMemory: resource.MustParse("512Mi"),
				},
			},
		},
	})

	if len(got) != 1 {
		t.Fatalf("MapContainerSummaries() length = %d", len(got))
	}
	if got[0].Name != "api" || got[0].Image != "repo/api:v1" {
		t.Fatalf("summary identity = %#v", got[0])
	}
	if got[0].CPURequest == "" || got[0].CPULimit == "" || got[0].MemoryRequest == "" || got[0].MemoryLimit == "" {
		t.Fatalf("summary resources should be populated: %#v", got[0])
	}
}

func TestDeploymentOwnerHelpers(t *testing.T) {
	depUID := types.UID("deployment-uid")
	rs := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			OwnerReferences: []metav1.OwnerReference{{UID: depUID, Controller: boolPtr(true)}},
		},
	}
	if !isReplicaSetOwnedBy(rs, depUID) {
		t.Fatal("expected controller owner reference to match")
	}
	if isReplicaSetOwnedBy(rs, "other") {
		t.Fatal("unexpected owner match for different UID")
	}
	rs.OwnerReferences[0].Controller = boolPtr(false)
	if isReplicaSetOwnedBy(rs, depUID) {
		t.Fatal("non-controller owner should not match")
	}

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			OwnerReferences: []metav1.OwnerReference{{Kind: "ReplicaSet", Name: "api-rs"}},
		},
	}
	if !isPodOwnedByReplicaSet(pod, map[string]struct{}{"api-rs": {}}) {
		t.Fatal("expected pod replicaset owner to match")
	}
	if isPodOwnedByReplicaSet(pod, map[string]struct{}{"other-rs": {}}) {
		t.Fatal("unexpected pod owner match")
	}
}
