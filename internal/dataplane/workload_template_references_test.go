package dataplane

import (
	"github.com/korex-labs/kview/v5/internal/kube/dto"
	"reflect"
	"testing"
)

func TestTemplateReferenceComparatorAvailabilityAndPrecedence(t *testing.T) {
	refs := TemplateReferenceCandidates(dto.PodTemplateSummaryDTO{ImagePullSecrets: []string{" shared ", "shared"}}, []dto.VolumeDTO{
		{Name: "one", Type: "Secret", Source: "shared"}, {Name: "two", Type: "Secret", Source: "s"}, {Name: "three", Type: "Secret", Source: "s"},
		{Name: "one", Type: "ConfigMap", Source: "c"}, {Name: "two", Type: "ConfigMap", Source: "c"}, {Name: "skip", Type: "Projected", Source: "ignored"},
	})
	want := []dto.MissingReferenceDTO{{Kind: "ConfigMap", Name: "c", Source: "volume/two"}, {Kind: "Secret", Name: "s", Source: "volume/two"}, {Kind: "Secret", Name: "shared", Source: "imagePullSecret"}}
	if !reflect.DeepEqual(refs, want) {
		t.Fatalf("detail precedence changed: %+v", refs)
	}
	missing, complete := MissingTemplateReferences(refs, TemplateReferenceInventory{}, TemplateReferenceInventory{Available: true})
	if complete || !reflect.DeepEqual(missing, want[:1]) {
		t.Fatalf("unknown secret inventory fabricated negative: %+v %v", missing, complete)
	}
	missing, complete = MissingTemplateReferences(refs, TemplateReferenceInventory{Available: true}, TemplateReferenceInventory{Available: true})
	if !complete || !reflect.DeepEqual(missing, want) {
		t.Fatalf("complete-empty not missing: %+v %v", missing, complete)
	}
}
