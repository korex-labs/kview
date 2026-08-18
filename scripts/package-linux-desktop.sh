#!/bin/sh
set -eu

if [ "$#" -ne 4 ]; then
  echo "usage: $0 <binary> <version> <arch> <output.tar.gz>" >&2
  exit 2
fi

binary=$1
version=$2
arch=$3
output=$4
root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

if [ ! -x "${binary}" ]; then
  echo "desktop binary is missing or not executable: ${binary}" >&2
  exit 2
fi

case ${version} in
  *[!A-Za-z0-9._-]*) echo "invalid version for archive path: ${version}" >&2; exit 2 ;;
esac
case ${arch} in
  amd64|arm64) ;;
  *) echo "unsupported Linux desktop architecture: ${arch}" >&2; exit 2 ;;
esac

output=$(mkdir -p "$(dirname -- "${output}")" && CDPATH= cd -- "$(dirname -- "${output}")" && printf '%s/%s' "$PWD" "$(basename -- "${output}")")
staging=$(mktemp -d)
trap 'rm -rf "${staging}"' EXIT HUP INT TERM
bundle_name="kview-${version}-linux-${arch}-desktop"
bundle_dir="${staging}/${bundle_name}"
mkdir -p "${bundle_dir}/icons"

install -m 0755 "${binary}" "${bundle_dir}/kview"
install -m 0755 "${root_dir}/packaging/linux/install.sh" "${bundle_dir}/install.sh"
install -m 0644 "${root_dir}/packaging/linux/kview.desktop" "${bundle_dir}/kview.desktop"
install -m 0644 "${root_dir}/packaging/linux/README.md" "${bundle_dir}/README.md"
install -m 0644 "${root_dir}/packaging/icons/kview.svg" "${bundle_dir}/icons/kview.svg"
for size in 16 32 48 64 128 256 512; do
  install -m 0644 "${root_dir}/packaging/icons/png/kview-${size}.png" "${bundle_dir}/icons/kview-${size}.png"
done

tar -czf "${output}" -C "${staging}" "${bundle_name}"
echo "Packaged ${output}"
