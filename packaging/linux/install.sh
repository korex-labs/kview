#!/bin/sh
set -eu

bundle_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
bin_dir=${HOME}/.local/bin
data_dir=${XDG_DATA_HOME:-${HOME}/.local/share}
applications_dir=${data_dir}/applications
icons_dir=${data_dir}/icons/hicolor

mkdir -p "${bin_dir}" "${applications_dir}"
install -m 0755 "${bundle_dir}/kview" "${bin_dir}/kview"

desktop_exec=$(printf '%s' "${bin_dir}/kview" | sed 's/\\/\\\\\\\\/g; s/"/\\"/g; s/`/\\`/g; s/\$/\\$/g')
sed_exec=$(printf '%s' "${desktop_exec}" | sed 's/[\\&|]/\\&/g')
sed "s|@KVIEW_EXEC@|${sed_exec}|g" "${bundle_dir}/kview.desktop" > "${applications_dir}/kview.desktop"
chmod 0644 "${applications_dir}/kview.desktop"

for size in 16 32 48 64 128 256 512; do
  target_dir="${icons_dir}/${size}x${size}/apps"
  mkdir -p "${target_dir}"
  install -m 0644 "${bundle_dir}/icons/kview-${size}.png" "${target_dir}/kview.png"
done
mkdir -p "${icons_dir}/scalable/apps"
install -m 0644 "${bundle_dir}/icons/kview.svg" "${icons_dir}/scalable/apps/kview.svg"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${applications_dir}" >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t "${icons_dir}" >/dev/null 2>&1 || true
fi

printf 'Installed kview to %s\n' "${bin_dir}/kview"
printf 'Desktop launcher: %s\n' "${applications_dir}/kview.desktop"
