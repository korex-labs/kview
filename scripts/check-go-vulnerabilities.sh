#!/usr/bin/env sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root_dir"

govulncheck_version=${GOVULNCHECK_VERSION:-v1.6.0}
govulncheck_bin=${GOVULNCHECK_BIN:-${root_dir}/.cache/tools/govulncheck-${govulncheck_version}/govulncheck}
allowlist_file=${GOVULNCHECK_ALLOWLIST_FILE:-scripts/govulncheck-allowlist.txt}
output_file=$(mktemp)
trap 'rm -f "$output_file"' EXIT HUP INT TERM

if [ ! -f "$allowlist_file" ]; then
	echo "govulncheck allowlist not found: ${allowlist_file}" >&2
	exit 2
fi
allowlisted_ids=$(sed -n 's/^[[:space:]]*\(GO-[0-9][0-9-]*\).*$/\1/p' "$allowlist_file" | sort -u)

if [ ! -x "$govulncheck_bin" ]; then
	govulncheck_bin_dir=$(dirname -- "$govulncheck_bin")
	mkdir -p "$govulncheck_bin_dir"
	GOBIN="$govulncheck_bin_dir" go install "golang.org/x/vuln/cmd/govulncheck@${govulncheck_version}"
fi

set +e
"$govulncheck_bin" ./... >"$output_file" 2>&1
status=$?
set -e

sed -n 'p' "$output_file"
if [ "$status" -eq 0 ]; then
	if [ -n "$allowlisted_ids" ]; then
		echo "govulncheck: stale allowlist entries remain after a clean scan: ${allowlisted_ids}" >&2
		exit 1
	fi
	echo "govulncheck: no reachable vulnerabilities"
	exit 0
fi

if [ "$status" -ne 3 ]; then
	echo "govulncheck: scanner failed with exit status ${status}" >&2
	exit "$status"
fi

vulnerability_ids=$(sed -n 's/^[[:space:]]*Vulnerability #[0-9][0-9]*: \(GO-[0-9][0-9-]*\)$/\1/p' "$output_file" | sort -u)
if [ -z "$vulnerability_ids" ]; then
	echo "govulncheck failed without reporting a vulnerability ID" >&2
	exit "$status"
fi

unexpected=0
for vulnerability_id in $vulnerability_ids; do
	if ! printf '%s\n' "$allowlisted_ids" | grep -Fxq "$vulnerability_id"; then
		echo "govulncheck: unexpected reachable vulnerability ${vulnerability_id}" >&2
		unexpected=1
	fi
done

for allowlisted_id in $allowlisted_ids; do
	if ! printf '%s\n' "$vulnerability_ids" | grep -Fxq "$allowlisted_id"; then
		echo "govulncheck: stale allowlist entry ${allowlisted_id}" >&2
		unexpected=1
	fi
done

if [ "$unexpected" -ne 0 ]; then
	exit "$status"
fi

echo "govulncheck: only documented residual-risk vulnerabilities remain (${vulnerability_ids})"