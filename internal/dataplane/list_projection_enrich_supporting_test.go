package dataplane

import (
	"testing"
	"time"

	"github.com/korex-labs/kview/internal/kube/dto"
)

func TestEnrichHelmReleaseListItemsForAPI(t *testing.T) {
	now := time.Now()
	bucket, transitional, attention := helmReleaseListSignals(dto.HelmReleaseDTO{
		Status:  "pending-upgrade",
		Updated: now.Add(-2 * time.Hour).Unix(),
	}, now)
	if bucket != deployBucketProgressing || !transitional || !attention {
		t.Fatalf("pending helm signal = %q/%v/%v, want progressing/true/true", bucket, transitional, attention)
	}
	bucket, transitional, attention = helmReleaseListSignals(dto.HelmReleaseDTO{Status: "deployed"}, now)
	if bucket != deployBucketHealthy || transitional || attention {
		t.Fatalf("deployed helm signal = %q/%v/%v, want healthy/false/false", bucket, transitional, attention)
	}
}

func TestEnrichConfigMapAndSecretListItemsForAPI(t *testing.T) {
	cms := EnrichConfigMapListItemsForAPI([]dto.ConfigMapDTO{{Name: "empty"}, {Name: "normal", KeysCount: 3}})
	if cms[0].ContentHint != "empty" || !cms[0].NeedsAttention {
		t.Fatalf("empty configmap signal unexpected: %+v", cms[0])
	}
	if cms[1].ContentHint != "normal" || cms[1].NeedsAttention {
		t.Fatalf("normal configmap signal unexpected: %+v", cms[1])
	}

	secrets := EnrichSecretListItemsForAPI([]dto.SecretDTO{{Name: "cert", Type: "kubernetes.io/tls", KeysCount: 2}})
	if secrets[0].ContentHint != "small" || secrets[0].TypeHint != "tls" || secrets[0].NeedsAttention {
		t.Fatalf("secret signal unexpected: %+v", secrets[0])
	}
}

func TestEnrichServiceAccountListItemsForAPI(t *testing.T) {
	disabled := false
	enabled := true
	items := EnrichServiceAccountListItemsForAPI([]dto.ServiceAccountListItemDTO{
		{Name: "default"},
		{Name: "builder", AutomountServiceAccountToken: &disabled, ImagePullSecretsCount: 1},
		{Name: "legacy", AutomountServiceAccountToken: &enabled},
	})
	if items[0].TokenMountPolicy != "default" || items[0].PullSecretHint != "none" {
		t.Fatalf("default serviceaccount signal unexpected: %+v", items[0])
	}
	if items[1].TokenMountPolicy != "disabled" || items[1].PullSecretHint != "configured" {
		t.Fatalf("builder serviceaccount signal unexpected: %+v", items[1])
	}
	if items[2].TokenMountPolicy != "enabled" {
		t.Fatalf("legacy serviceaccount signal unexpected: %+v", items[2])
	}
}

func TestEnrichCRDListItemsForAPI(t *testing.T) {
	items := EnrichCRDListItemsForAPI([]dto.CRDListItemDTO{
		{Name: "widgets.example.com", Versions: "v1", Established: true},
		{Name: "gadgets.example.com", Versions: "v1, v1beta1", Established: false},
	})
	if items[0].HealthBucket != deployBucketHealthy || items[0].VersionBreadth != "single" || items[0].NeedsAttention {
		t.Fatalf("established crd signal unexpected: %+v", items[0])
	}
	if items[1].HealthBucket != deployBucketDegraded || items[1].VersionBreadth != "multi" || !items[1].NeedsAttention {
		t.Fatalf("unestablished crd signal unexpected: %+v", items[1])
	}
}
