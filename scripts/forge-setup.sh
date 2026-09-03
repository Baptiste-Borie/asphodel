#!/usr/bin/env sh
set -eu

EXPECTED_FORGE_REVISION="6356c1ad565029c82513c96e42ad5492c1b09c4e"
SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIRECTORY=$(CDPATH= cd -- "$SCRIPT_DIRECTORY/.." && pwd)

git -C "$PROJECT_DIRECTORY" submodule update --init --depth 1 vendor/forge
ACTUAL_FORGE_REVISION=$(git -C "$PROJECT_DIRECTORY/vendor/forge" rev-parse HEAD)

if [ "$ACTUAL_FORGE_REVISION" != "$EXPECTED_FORGE_REVISION" ]; then
  echo "Forge revision mismatch: expected $EXPECTED_FORGE_REVISION, got $ACTUAL_FORGE_REVISION" >&2
  exit 1
fi

"$SCRIPT_DIRECTORY/mavenw.sh" --version
