#!/usr/bin/env sh
set -eu

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIRECTORY=$(CDPATH= cd -- "$SCRIPT_DIRECTORY/.." && pwd)

"$SCRIPT_DIRECTORY/forge-setup.sh"
"$SCRIPT_DIRECTORY/mavenw.sh" \
  --file "$PROJECT_DIRECTORY/forge-bridge/pom.xml" \
  --batch-mode \
  --no-transfer-progress \
  clean package
