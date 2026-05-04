#!/usr/bin/env sh
set -eu

usage() {
	printf "%s\n" "usage: $0 [--rev <git-rev>] <tag-name>" >&2
}

rev=""
if [ "${1:-}" = "--rev" ]; then
	if [ "$#" -lt 3 ]; then
		usage
		exit 2
	fi
	rev="$2"
	shift 2
fi

if [ "$#" -ne 1 ]; then
	usage
	exit 2
fi

tag_name="$1"

case "$tag_name" in
	v[0-9]*.[0-9]*.[0-9]*)
		;;
	*)
		exit 0
		;;
esac

version="${tag_name#v}"
major="${version%%.*}"

if [ -n "$rev" ]; then
	go_mod="$(git show "${rev}^{commit}:go.mod")"
else
	go_mod="$(cat go.mod)"
fi

module_path="$(printf "%s\n" "$go_mod" | awk '$1 == "module" { print $2; exit }')"
has_replace=0
if printf "%s\n" "$go_mod" | awk '$1 == "replace" { found = 1 } END { exit found ? 0 : 1 }'; then
	has_replace=1
fi

case "$major" in
	0|1)
		expected="github.com/korex-labs/kview"
		;;
	*)
		expected="github.com/korex-labs/kview/v${major}"
		;;
esac

if [ "$module_path" = "$expected" ]; then
	if [ "$has_replace" -eq 0 ]; then
		exit 0
	fi
	cat >&2 <<EOF
Refusing release tag ${tag_name}.

Go rejects 'go install module/path@version' when the released module's go.mod
contains replace directives.

Fix before tagging:
  1. Remove replace directives from go.mod
  2. Use normal module requirements or move local-only replacements outside
     the released module metadata
  3. Run go test ./...
  4. Commit the installability fix
  5. Recreate the tag on that commit, then push it
EOF

	exit 1
fi

cat >&2 <<EOF
Refusing release tag ${tag_name}.

Go semantic import versioning requires:
  module ${expected}

but the tagged go.mod declares:
  module ${module_path}

Fix before tagging:
  1. Update go.mod to declare ${expected}
  2. Update internal imports and build ldflags to use ${expected}
  3. Run go test ./...
  4. Commit the module-path migration
  5. Recreate the tag on that commit, then push it

Tip: v2+ Go module tags are ignored by 'go install @latest' unless the
module path includes the matching /vN suffix.
EOF

exit 1
