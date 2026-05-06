package buildinfo

import "runtime/debug"

const devVersion = "dev"

// Version is injected at build time via -ldflags for release artifacts.
var Version = "dev"

// ResolvedVersion returns the best available application version.
//
// Release builds set Version with -ldflags. Direct Go installs, such as:
//
//	go install github.com/korex-labs/kview/v5/cmd/kview@latest
//
// do not run the release build pipeline, but Go embeds the resolved main module
// version in build metadata. Use that before falling back to "dev".
func ResolvedVersion() string {
	if Version != "" && Version != devVersion {
		return Version
	}
	if info, ok := debug.ReadBuildInfo(); ok {
		if version := moduleVersionFromBuildInfo(info); version != "" {
			return version
		}
	}
	return devVersion
}

func moduleVersionFromBuildInfo(info *debug.BuildInfo) string {
	if info == nil {
		return ""
	}
	version := info.Main.Version
	if version == "" || version == "(devel)" {
		return ""
	}
	return version
}
