#!/bin/sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
source_svg="${root_dir}/packaging/icons/kview.svg"
output_dir="${root_dir}/packaging/icons/png"
windows_dir="${root_dir}/packaging/windows"

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick 'magick' is required to regenerate app icons" >&2
  exit 2
fi

mkdir -p "${output_dir}" "${windows_dir}"
for size in 16 32 48 64 128 256 512 1024; do
  magick -background none "${source_svg}" -resize "${size}x${size}" \
    -depth 8 -strip "${output_dir}/kview-${size}.png"
done

magick -background none "${source_svg}" \
  -define icon:auto-resize=256,128,64,48,32,16 \
  -depth 8 -strip "${windows_dir}/kview.ico"

echo "Generated PNG and Windows ICO assets from ${source_svg}"
