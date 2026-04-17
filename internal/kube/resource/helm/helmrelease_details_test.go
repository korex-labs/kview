package helm

import (
	"strings"
	"testing"

	"helm.sh/helm/v3/pkg/release"
)

func TestBuildReleaseYAMLUsesLiteralManifestBlock(t *testing.T) {
	rel := &release.Release{
		Name:      "backend",
		Namespace: "apps",
		Version:   3,
		Manifest:  "---\napiVersion: v1\nkind: ServiceAccount\nmetadata:\n  name: backend\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: backend\n",
	}

	out := buildReleaseYAML(rel)

	if !strings.Contains(out, "manifest: |\n") {
		t.Fatalf("expected literal manifest block, got:\n%s", out)
	}
	if strings.Contains(out, "\\n") {
		t.Fatalf("expected rendered newlines instead of escaped newlines, got:\n%s", out)
	}
	if !strings.Contains(out, "  kind: ServiceAccount\n") || !strings.Contains(out, "  kind: Service\n") {
		t.Fatalf("expected all manifest documents to be preserved, got:\n%s", out)
	}
}
