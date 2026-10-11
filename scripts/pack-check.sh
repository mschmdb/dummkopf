#!/bin/sh
# Packs both packages like `pnpm publish` would, installs the tarballs into a temporary folder with npm
# and runs the installed CLI. Catches missing dist/ or template files and unresolved workspace: ranges.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

cd "$ROOT"
pnpm build
for package in core cli; do
  (cd "packages/$package" && pnpm pack --pack-destination "$TMP" >/dev/null)
done

for tarball in "$TMP"/*.tgz; do
  if tar -xOzf "$tarball" package/package.json | grep -q '"workspace:'; then
    echo "$(basename "$tarball") still has a workspace: range" >&2
    exit 1
  fi
done

mkdir "$TMP/install"
npm install --prefix "$TMP/install" --no-audit --no-fund --silent "$TMP"/*.tgz
BIN="$TMP/install/node_modules/.bin"
"$BIN/dummkopf" --help >/dev/null
"$BIN/dk" --help >/dev/null
"$BIN/dummkopf" init "$TMP/brain" --serious >/dev/null
test -f "$TMP/brain/AGENTS.md"
"$BIN/dummkopf" --root "$TMP/brain" check >/dev/null
echo "Packed, installed and ran dummkopf from the tarballs."
