#!/bin/sh
# Runs the TOML parser against the official toml-test suite (TOML 1.0 cases).
# Fetches a pinned toml-test release into .cache/toml-test (gitignored) on first use.
# Dev only: nothing here ships, and `pnpm test` skips the suite when TOML_TEST_DIR is unset.
set -eu

TAG="v2.2.0"
COMMIT="ce08da1ddb075d1c7596d663c7fcba9a2ae02c5c"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIR="$ROOT/.cache/toml-test/$TAG"

if [ ! -f "$DIR/tests/files-toml-1.0.0" ]; then
  rm -rf "$DIR"
  mkdir -p "$(dirname "$DIR")"
  git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$TAG" \
    https://github.com/toml-lang/toml-test.git "$DIR"
fi

ACTUAL=$(git -C "$DIR" rev-parse HEAD)
if [ "$ACTUAL" != "$COMMIT" ]; then
  echo "toml-test $TAG is at $ACTUAL, expected $COMMIT. Delete $DIR and retry." >&2
  exit 1
fi

TOML_TEST_DIR="$DIR" exec node --test "$ROOT/packages/core/test/toml-conformance.test.ts"
