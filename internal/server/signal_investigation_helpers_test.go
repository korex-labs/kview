package server

import (
	"context"
	"testing"

	"github.com/korex-labs/kview/v5/internal/dataplane"
)

func TestAnalyzeInvestigationYAMLFindsSelectorMismatch(t *testing.T) {
	ref := dataplane.SignalInvestigationResourceRef{
		Kind: "Deployment",
		Name: "api",
	}
	raw := `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: default
spec:
  selector:
    matchLabels:
      app: api
      tier: backend
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
      - name: api
        image: example/api:latest
        env:
        - name: TOKEN
          valueFrom:
            secretKeyRef:
              name: missing-secret
              key: token
        - name: CONFIG
          valueFrom:
            configMapKeyRef:
              name: present-config
              key: config.yaml
`

	items := analyzeInvestigationYAML(context.Background(), nil, ref, raw)
	if !hasInvestigationItem(items, "Selector") {
		t.Fatalf("expected selector mismatch item, got %+v", items)
	}
}

func TestReferencedResourceNamesFindsSecretAndConfigMapRefs(t *testing.T) {
	raw := map[string]any{
		"spec": map[string]any{
			"template": map[string]any{
				"spec": map[string]any{
					"volumes": []any{
						map[string]any{"secret": map[string]any{"secretName": "token-secret"}},
						map[string]any{"configMap": map[string]any{"name": "app-config"}},
						map[string]any{"persistentVolumeClaim": map[string]any{"claimName": "data"}},
					},
					"serviceAccountName": "api-sa",
					"imagePullSecrets": []any{
						map[string]any{"name": "registry-secret"},
					},
				},
			},
		},
	}
	refs := referencedResourceNames(raw)
	if !refs.secrets["token-secret"] {
		t.Fatalf("expected token-secret ref, got %+v", refs.secrets)
	}
	if !refs.secrets["registry-secret"] {
		t.Fatalf("expected registry-secret ref, got %+v", refs.secrets)
	}
	if !refs.configMaps["app-config"] {
		t.Fatalf("expected app-config ref, got %+v", refs.configMaps)
	}
	if !refs.pvcs["data"] {
		t.Fatalf("expected data pvc ref, got %+v", refs.pvcs)
	}
	if !refs.serviceAccounts["api-sa"] {
		t.Fatalf("expected api-sa service account ref, got %+v", refs.serviceAccounts)
	}
}

func TestEventTroubleshootingStepClassifiesCommonReasons(t *testing.T) {
	cases := []struct {
		reason string
		msg    string
		want   string
	}{
		{reason: "FailedScheduling", msg: "0/3 nodes are available: insufficient cpu", want: "Scheduling"},
		{reason: "FailedMount", msg: "MountVolume.SetUp failed for volume config", want: "Volume mount"},
		{reason: "ErrImagePull", msg: "failed to pull image", want: "Image pull"},
		{reason: "BackOff", msg: "Back-off restarting failed container", want: "Container restart"},
		{reason: "Unhealthy", msg: "Readiness probe failed", want: "Health probe"},
	}
	for _, tc := range cases {
		step := eventTroubleshootingStep(tc.reason, tc.msg, dataplane.SignalInvestigationResourceRef{Kind: "Pod"})
		if step == nil || step.Label != tc.want {
			t.Fatalf("eventTroubleshootingStep(%q, %q) = %+v, want label %q", tc.reason, tc.msg, step, tc.want)
		}
	}
}

func TestAnalyzeLogTextFindsActionablePatterns(t *testing.T) {
	items := analyzeLogText("api", true, `
starting
panic: failed to connect
permission denied opening /etc/app/config
`)
	if !hasInvestigationItem(items, "Application exception") {
		t.Fatalf("expected application exception finding, got %+v", items)
	}
	if !hasInvestigationItem(items, "Permission failure") {
		t.Fatalf("expected permission failure finding, got %+v", items)
	}
}

func hasInvestigationItem(items []dataplane.SignalInvestigationItem, label string) bool {
	for _, item := range items {
		if item.Label == label {
			return true
		}
	}
	return false
}
