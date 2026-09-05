#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PROJECT_DIRECTORY=$(cd -- "$SCRIPT_DIRECTORY/.." && pwd)

BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  trap - INT TERM EXIT
  for pid in "$BACKEND_PID" "$FRONTEND_PID"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

(cd "$PROJECT_DIRECTORY/backend" && exec npm run dev) &
BACKEND_PID=$!

(cd "$PROJECT_DIRECTORY/frontend" && exec npm run dev) &
FRONTEND_PID=$!

echo ""
echo "Asphodel development environment"
echo ""
echo "Backend   http://localhost:3000"
echo "Frontend  http://localhost:5173"
echo ""
echo "Ctrl+C to stop"
echo ""

# Waits for whichever of the two dies first; the EXIT trap then stops the other one.
wait -n "$BACKEND_PID" "$FRONTEND_PID"
