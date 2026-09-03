#!/usr/bin/env sh
set -eu

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIRECTORY=$(CDPATH= cd -- "$SCRIPT_DIRECTORY/.." && pwd)

"$SCRIPT_DIRECTORY/forge-build.sh"
cd "$PROJECT_DIRECTORY/backend"
FORGE_BRIDGE_JAR="$PROJECT_DIRECTORY/forge-bridge/app/target/asphodel-forge-bridge.jar" \
  npm run test:forge-bridge
