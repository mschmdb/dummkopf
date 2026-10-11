#!/bin/sh
# Prints the CHANGELOG.md section of one version, without its heading: the text of the GitHub release.
# Usage: scripts/release-notes.sh 0.3.1
set -eu

VERSION="$1"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
NOTES=$(awk -v heading="## [$VERSION]" '
  index($0, heading) == 1 { found = 1; next }
  found && /^## \[/ { exit }
  found { print }
' "$ROOT/CHANGELOG.md")

if [ -z "$(printf '%s' "$NOTES" | tr -d '[:space:]')" ]; then
  echo "CHANGELOG.md has no section for $VERSION" >&2
  exit 1
fi
printf '%s\n' "$NOTES" | sed -e '/./,$!d'
