#!/usr/bin/env sh
set -eu

if [ "${GOVULNCHECK_TEST_SCANNER:-0}" = "1" ]; then
	case "${GOVULNCHECK_TEST_MODE:-}" in
		clean)
			exit 0
			;;
		allowed)
			printf '%s\n' 'Vulnerability #1: GO-2026-5932'
			exit 3
			;;
		allowed-unexpected)
			printf '%s\n' \
				'Vulnerability #1: GO-2026-5932' \
				'Vulnerability #2: GO-2099-9999'
			exit 3
			;;
		failure-after-allowed)
			printf '%s\n' \
				'Vulnerability #1: GO-2026-5932' \
				'analysis failed'
			exit 1
			;;
		failure-without-ids)
			printf '%s\n' 'analysis failed'
			exit 1
			;;
		*)
			printf 'unknown fake scanner mode: %s\n' "${GOVULNCHECK_TEST_MODE:-}" >&2
			exit 2
			;;
	esac
fi

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
checker="$root_dir/scripts/check-go-vulnerabilities.sh"
self="$root_dir/scripts/test-govulncheck-wrapper.sh"
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM

run_case() {
	name=$1
	expectation=$2
	mode=$3
	allowlist=$4
	expected_message=$5
	allowlist_file="$tmp_dir/${name}.allowlist"
	output_file="$tmp_dir/${name}.output"
	printf '%s' "$allowlist" >"$allowlist_file"

	set +e
	GOVULNCHECK_BIN="$self" \
		GOVULNCHECK_ALLOWLIST_FILE="$allowlist_file" \
		GOVULNCHECK_TEST_SCANNER=1 \
		GOVULNCHECK_TEST_MODE="$mode" \
		sh "$checker" >"$output_file" 2>&1
	status=$?
	set -e

	case "$expectation:$status" in
		pass:0|fail:[1-9]|fail:[1-9][0-9]|fail:1[0-9][0-9]|fail:2[0-4][0-9]|fail:25[0-5])
			;;
		*)
			printf 'govulncheck wrapper test %s: expected %s, got status %s\n' \
				"$name" "$expectation" "$status" >&2
			sed -n 'p' "$output_file" >&2
			exit 1
			;;
	esac

	if ! grep -Fq "$expected_message" "$output_file"; then
		printf 'govulncheck wrapper test %s: missing output %s\n' \
			"$name" "$expected_message" >&2
		sed -n 'p' "$output_file" >&2
		exit 1
	fi
}

run_case clean pass clean '' 'govulncheck: no reachable vulnerabilities'
run_case allowed pass allowed 'GO-2026-5932' 'govulncheck: only documented residual-risk vulnerabilities remain'
run_case allowed-unexpected fail allowed-unexpected 'GO-2026-5932' 'govulncheck: unexpected reachable vulnerability GO-2099-9999'
run_case failure-after-allowed fail failure-after-allowed 'GO-2026-5932' 'govulncheck: scanner failed with exit status 1'
run_case failure-without-ids fail failure-without-ids 'GO-2026-5932' 'govulncheck: scanner failed with exit status 1'

printf '%s\n' 'govulncheck wrapper tests: 5 passed'
