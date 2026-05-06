package buildinfo

import (
	"runtime/debug"
	"testing"
)

func TestResolvedVersionPrefersInjectedVersion(t *testing.T) {
	prev := Version
	Version = "v9.9.9-test"
	defer func() { Version = prev }()

	if got := ResolvedVersion(); got != "v9.9.9-test" {
		t.Fatalf("ResolvedVersion() = %q, want %q", got, "v9.9.9-test")
	}
}

func TestModuleVersionFromBuildInfo(t *testing.T) {
	tests := []struct {
		name string
		info *debug.BuildInfo
		want string
	}{
		{
			name: "tagged module",
			info: &debug.BuildInfo{Main: debug.Module{Version: "v5.5.0"}},
			want: "v5.5.0",
		},
		{
			name: "development build",
			info: &debug.BuildInfo{Main: debug.Module{Version: "(devel)"}},
			want: "",
		},
		{
			name: "empty version",
			info: &debug.BuildInfo{Main: debug.Module{Version: ""}},
			want: "",
		},
		{
			name: "nil build info",
			info: nil,
			want: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := moduleVersionFromBuildInfo(tt.info); got != tt.want {
				t.Fatalf("moduleVersionFromBuildInfo() = %q, want %q", got, tt.want)
			}
		})
	}
}
