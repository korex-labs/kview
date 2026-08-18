#!/bin/sh
set -eu

if [ "$#" -ne 4 ]; then
  echo "usage: $0 <binary> <version> <arch> <output.zip>" >&2
  exit 2
fi

if [ "$(uname -s)" != "Darwin" ]; then
  echo "macOS app bundles must be packaged on macOS" >&2
  exit 2
fi

binary=$1
release_version=${2#v}
bundle_version=${release_version%%-*}
bundle_version=${bundle_version%%+*}
arch=$3
output=$4
root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

if [ ! -x "${binary}" ]; then
  echo "webview binary is missing or not executable: ${binary}" >&2
  exit 2
fi
case ${bundle_version} in
  ''|*[!0-9.]*) echo "macOS bundle version must have a numeric core: ${release_version}" >&2; exit 2 ;;
esac
case ${arch} in
  amd64|arm64) ;;
  *) echo "unsupported macOS architecture: ${arch}" >&2; exit 2 ;;
esac
for tool in iconutil codesign ditto plutil; do
  if ! command -v "${tool}" >/dev/null 2>&1; then
    echo "required macOS tool is missing: ${tool}" >&2
    exit 2
  fi
done

output=$(mkdir -p "$(dirname -- "${output}")" && CDPATH= cd -- "$(dirname -- "${output}")" && printf '%s/%s' "$PWD" "$(basename -- "${output}")")
staging=$(mktemp -d)
trap 'rm -rf "${staging}"' EXIT HUP INT TERM
app_dir="${staging}/kview.app"
contents_dir="${app_dir}/Contents"
iconset_dir="${staging}/kview.iconset"
mkdir -p "${contents_dir}/MacOS" "${contents_dir}/Resources" "${iconset_dir}"

install -m 0755 "${binary}" "${contents_dir}/MacOS/kview"
sed "s|@VERSION@|${bundle_version}|g" "${root_dir}/packaging/macos/Info.plist.in" > "${contents_dir}/Info.plist"
plutil -lint "${contents_dir}/Info.plist"

install -m 0644 "${root_dir}/packaging/icons/png/kview-16.png" "${iconset_dir}/icon_16x16.png"
install -m 0644 "${root_dir}/packaging/icons/png/kview-32.png" "${iconset_dir}/icon_16x16@2x.png"
install -m 0644 "${root_dir}/packaging/icons/png/kview-32.png" "${iconset_dir}/icon_32x32.png"
install -m 0644 "${root_dir}/packaging/icons/png/kview-64.png" "${iconset_dir}/icon_32x32@2x.png"
install -m 0644 "${root_dir}/packaging/icons/png/kview-128.png" "${iconset_dir}/icon_128x128.png"
install -m 0644 "${root_dir}/packaging/icons/png/kview-256.png" "${iconset_dir}/icon_128x128@2x.png"
install -m 0644 "${root_dir}/packaging/icons/png/kview-256.png" "${iconset_dir}/icon_256x256.png"
install -m 0644 "${root_dir}/packaging/icons/png/kview-512.png" "${iconset_dir}/icon_256x256@2x.png"
install -m 0644 "${root_dir}/packaging/icons/png/kview-512.png" "${iconset_dir}/icon_512x512.png"
install -m 0644 "${root_dir}/packaging/icons/png/kview-1024.png" "${iconset_dir}/icon_512x512@2x.png"
iconutil -c icns "${iconset_dir}" -o "${contents_dir}/Resources/kview.icns"

codesign --force --deep --sign - "${app_dir}"
codesign --verify --deep --strict --verbose "${app_dir}"
"${contents_dir}/MacOS/kview" --version
ditto -c -k --sequesterRsrc --keepParent "${app_dir}" "${output}"
echo "Packaged ${output}"
