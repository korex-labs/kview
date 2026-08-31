package pods

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestPodListMapperEnrichesExplicitReferencesAndHiddenLabels(t *testing.T) {
	labels := map[string]string{"app": "api"}
	pod := corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "apps", Labels: labels},
		Spec: corev1.PodSpec{
			NodeName: "worker-a",
			Volumes: []corev1.Volume{{VolumeSource: corev1.VolumeSource{ConfigMap: &corev1.ConfigMapVolumeSource{
				LocalObjectReference: corev1.LocalObjectReference{Name: "settings"},
			}}}},
		},
	}

	item := podListItems([]corev1.Pod{pod}, nil, time.Unix(1_700_000_000, 0))[0]
	record := item.ResourceRelationshipMetadata()
	assertPodFamilyFull(t, record.FamilyCoverage[dto.ResourceRelationshipFamilyObjectReference])
	assertPodFamilyFull(t, record.FamilyCoverage[dto.ResourceRelationshipFamilyLabels])
	want := map[string]string{
		"spec.nodeName":                  "worker-a",
		"spec.serviceAccountName":        "default",
		"spec.volumes[0].configMap.name": "settings",
	}
	for _, ref := range record.References {
		if want[ref.Source.FieldPath] != ref.Target.Name {
			t.Fatalf("unexpected reference: %+v", ref)
		}
		delete(want, ref.Source.FieldPath)
	}
	if len(want) != 0 {
		t.Fatalf("missing references: %+v", want)
	}

	labels["app"] = "mutated"
	if record.Labels["app"] != "api" {
		t.Fatalf("carrier labels alias source: %+v", record.Labels)
	}
	if item.Labels["app"] != "mutated" {
		t.Fatalf("visible DTO labels behavior changed: %+v", item.Labels)
	}
	payload, err := json.Marshal(item)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(payload), `"labels"`) || strings.Contains(string(payload), "settings") {
		t.Fatalf("hidden relationship/label data leaked into list JSON: %s", payload)
	}
}

func TestPodListMapperKeepsValidReferencesWhenFamilyIsPartial(t *testing.T) {
	pod := corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "bad", Namespace: "apps"},
		Spec:       corev1.PodSpec{Volumes: []corev1.Volume{{VolumeSource: corev1.VolumeSource{ConfigMap: &corev1.ConfigMapVolumeSource{}}}}},
	}
	record := podListItems([]corev1.Pod{pod}, nil, time.Unix(1_700_000_000, 0))[0].ResourceRelationshipMetadata()
	coverage := record.FamilyCoverage[dto.ResourceRelationshipFamilyObjectReference]
	if coverage.Coverage != dto.ResourceRelationshipCoveragePartial || coverage.Completeness != dto.ResourceRelationshipCompletenessPartial {
		t.Fatalf("malformed family coverage = %+v", coverage)
	}
	if len(record.References) != 1 || record.References[0].Target.Name != "default" || record.References[0].Source.FieldPath != "spec.serviceAccountName" {
		t.Fatalf("partial family lost valid default SA or retained malformed ref: %+v", record.References)
	}
}

func assertPodFamilyFull(t *testing.T, got dto.ResourceRelationshipCoverageDTO) {
	t.Helper()
	if got.Coverage != dto.ResourceRelationshipCoverageFull || got.Completeness != dto.ResourceRelationshipCompletenessComplete {
		t.Fatalf("family coverage = %+v, want full/complete", got)
	}
}
