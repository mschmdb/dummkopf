#!/bin/sh
# Packs both packages like `pnpm publish` would, installs the tarballs into a temporary folder with npm
# and runs the installed CLI. Catches missing dist/ or template files and unresolved workspace: ranges.
# Then lints the tarballs with publint and checks the types of @rcllr/core with arethetypeswrong.
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
  if tar -xOzf "$tarball" package/package.json | grep -q '"\./src/'; then
    echo "$(basename "$tarball") points into src/, which is not published" >&2
    exit 1
  fi
done

# Lint the tarballs pnpm packed, not the folders: only the tarballs carry publishConfig.exports.
for tarball in "$TMP"/*.tgz; do
  pnpm exec publint run --strict "$tarball"
done
# The packages are ESM-only, so the CommonJS resolutions are out of scope. The CLI ships only bins and has
# no import entry point for attw to check.
pnpm exec attw "$TMP"/rcllr-core-*.tgz --profile esm-only --no-color

mkdir "$TMP/install"
npm install --prefix "$TMP/install" --no-audit --no-fund --silent "$TMP"/*.tgz
BIN="$TMP/install/node_modules/.bin"
"$BIN/rcllr" --help >/dev/null
"$BIN/dk" --help >/dev/null
"$BIN/rcllr" init "$TMP/brain" --serious >/dev/null
test -f "$TMP/brain/AGENTS.md"
"$BIN/rcllr" --root "$TMP/brain" check >/dev/null
echo "Packed, installed and ran rcllr from the tarballs."
