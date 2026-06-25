#!/usr/bin/env bash
# Developer helper — users run: docker compose up -d --build
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ "${1:-}" == "--native" ]] && exec "$ROOT/scripts/run-native.sh"
cd "$ROOT"
"$ROOT/scripts/compose-preflight.sh"
exec docker compose up -d --build "$@"
