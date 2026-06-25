#!/usr/bin/env bash
# Stop WDP Docker experiments that break Wappler Server Actions on Docker Desktop.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.wdp.yml"

if [[ -x "$ROOT/scripts/docker-tcp-bridge.sh" ]]; then
  "$ROOT/scripts/docker-tcp-bridge.sh" stop 2>/dev/null || true
fi

docker rm -f wdp wdp-docker-api-1 wdp-docker-tcp 2>/dev/null || true

if command -v docker >/dev/null 2>&1 && [[ -f "$COMPOSE_FILE" ]]; then
  docker compose -f "$COMPOSE_FILE" down 2>/dev/null || true
fi
