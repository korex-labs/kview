#!/usr/bin/env sh
set -eu

usage() {
	printf "%s\n" "usage: $0 <tag-name>" >&2
}

if [ "$#" -ne 1 ]; then
	usage
	exit 2
fi

tag_name="$1"
notes_file="CHANGELOG.md"
codex_bin="${CODEX:-codex}"
codex_model="${CODEX_MODEL:-gpt-5.4}"

case "$tag_name" in
	v[0-9]*.[0-9]*.[0-9]*)
		;;
	*)
		printf "%s\n" "release notes require a semantic v* tag, got: ${tag_name}" >&2
		exit 2
		;;
esac

if git rev-parse -q --verify "refs/tags/${tag_name}" >/dev/null; then
	printf "%s\n" "tag already exists: ${tag_name}" >&2
	exit 1
fi

if ! command -v "$codex_bin" >/dev/null 2>&1; then
	printf "%s\n" "Codex CLI not found. Install it or set CODEX=/path/to/codex." >&2
	exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
	printf "%s\n" "working tree must be clean before preparing release notes" >&2
	exit 1
fi

if [ -f "$notes_file" ] && grep -Fq "## ${tag_name} - " "$notes_file"; then
	printf "%s\n" "${notes_file} already contains release notes for ${tag_name}" >&2
	exit 0
fi

latest_tag="$(git tag --merged HEAD --sort=-version:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+' | head -n 1 || true)"
if [ -z "$latest_tag" ]; then
	printf "%s\n" "no previous release tag found" >&2
	exit 1
fi

range="${latest_tag}..HEAD"
commit_count="$(git rev-list --count "$range")"
if [ "$commit_count" -eq 0 ]; then
	printf "%s\n" "no commits found in ${range}; nothing to release" >&2
	exit 1
fi

release_date="$(date +%F)"
repo_root="$(git rev-parse --show-toplevel)"
prompt_file="$(mktemp)"
log_file="$(mktemp)"
trap 'rm -f "$prompt_file" "$log_file"' EXIT INT TERM

git log --reverse --format='- %h %s' "$range" > "$log_file"

cat > "$prompt_file" <<EOF
You are preparing kview release notes.

Task:
- Update only ${notes_file}.
- Add a new release section for ${tag_name} dated ${release_date}.
- Insert it as the newest release section, preserving the existing changelog structure.
- Summarize changes from git range ${range}.
- Write concise user-facing notes grouped into bullets. Prefer meaningful product/workflow summaries over a raw commit list.
- Mention infrastructure, tests, docs, and fixes when they are relevant to the release.
- Do not create commits, tags, or modify any file except ${notes_file}; the release script will commit the changelog after you finish.

Commits in ${range}:
$(cat "$log_file")
EOF

"$codex_bin" exec -m "$codex_model" -C "$repo_root" -s workspace-write - < "$prompt_file"

changed_files="$(git diff --name-only)"
if [ "$changed_files" != "$notes_file" ]; then
	printf "%s\n" "Codex must modify only ${notes_file}; changed files were:" >&2
	printf "%s\n" "$changed_files" >&2
	exit 1
fi

if ! grep -Fq "## ${tag_name} - " "$notes_file"; then
	printf "%s\n" "${notes_file} does not contain a release section for ${tag_name}" >&2
	exit 1
fi

git add "$notes_file"
git commit \
	-m "docs(changelog): update release notes for ${tag_name}" \
	-m "Generated release notes from ${range} before tagging ${tag_name}." \
	-m "Verification: scripts/prepare-release-notes.sh ${tag_name}"
