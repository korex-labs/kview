package helm

import (
	"context"
	"strings"
	"testing"

	kubeactions "github.com/korex-labs/kview/v5/internal/kube/actions"
)

func TestHandleHelmInstallValidation(t *testing.T) {
	tests := []struct {
		name    string
		req     kubeactions.ActionRequest
		wantMsg string
	}{
		{
			name: "missing namespace and release",
			req: kubeactions.ActionRequest{
				Resource: "helmreleases",
				Action:   "helm.install",
			},
			wantMsg: "namespace and release name are required",
		},
		{
			name: "missing chart",
			req: kubeactions.ActionRequest{
				Resource:  "helmreleases",
				Action:    "helm.install",
				Namespace: "default",
				Name:      "app",
			},
			wantMsg: "params.chart is required",
		},
		{
			name: "invalid createNamespace",
			req: kubeactions.ActionRequest{
				Resource:  "helmreleases",
				Action:    "helm.install",
				Namespace: "default",
				Name:      "app",
				Params: map[string]any{
					"chart":           "repo/app",
					"createNamespace": "yes",
				},
			},
			wantMsg: "params.createNamespace must be a boolean",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := HandleHelmInstall(context.Background(), nil, tt.req)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result == nil || result.Status != "error" {
				t.Fatalf("result: got %#v, want error status", result)
			}
			if !strings.Contains(result.Message, tt.wantMsg) {
				t.Fatalf("message: got %q, want containing %q", result.Message, tt.wantMsg)
			}
		})
	}
}
