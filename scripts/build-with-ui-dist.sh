#!/bin/sh
set -eu

if [ "$#" -eq 0 ]; then
	echo "usage: $0 <build-command> [args...]" >&2
	exit 2
fi

ui_dir=${UI_DIR:-ui}
embed_dir=${EMBED_DIR:-internal/server/ui_dist}
backup_dir=$(mktemp -d)
had_embed=0

restore_embed() {
	status=$?
	rm -rf "$embed_dir"
	if [ "$had_embed" -eq 1 ]; then
		mkdir -p "$embed_dir"
		cp -a "$backup_dir/original/." "$embed_dir/"
	fi
	rm -rf "$backup_dir"
	exit "$status"
}

trap restore_embed EXIT INT TERM

if [ -d "$embed_dir" ]; then
	had_embed=1
	mkdir -p "$backup_dir/original"
	cp -a "$embed_dir/." "$backup_dir/original/"
fi

(cd "$ui_dir" && npm ci && npm run build)
mkdir -p "$embed_dir"
find "$embed_dir" -mindepth 1 ! -name placeholder.txt -exec rm -rf {} +
cp -r "$ui_dir/dist/." "$embed_dir/"

"$@"
