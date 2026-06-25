#!/usr/bin/env bash
# Troubleshooting only — run WDP without a Docker container (Wappler conflicts on some PCs).
# Users run: docker compose up -d --build
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${WDP_DATA_DIR:-$HOME/.wdp}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required. Install from https://nodejs.org/ or your package manager." >&2
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "Node.js 20+ is required (found $(node -v))." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for local deployments. Install Docker Desktop or Engine." >&2
  exit 1
fi

# Stop container/bridge installs so Wappler is not affected.
"$ROOT/scripts/wappler-cleanup.sh"

# Import from Docker volume wdp-data before creating any local files (profiles live there).
import_from_docker_volume() {
  local vol="$1"
  command -v docker >/dev/null 2>&1 || return 0
  docker volume inspect "$vol" >/dev/null 2>&1 || return 0
  docker run --rm -v "${vol}:/from:ro" alpine test -f /from/wdp-config.json 2>/dev/null || return 0

  mkdir -p "$DATA_DIR/sessions"
  if [[ ! -f "$DATA_DIR/wdp-config.json" ]]; then
    echo "[WDP] Importing settings from Docker volume ${vol} → $DATA_DIR"
    docker run --rm -v "${vol}:/from:ro" -v "$DATA_DIR:/to" alpine sh -c '
      cp -a /from/wdp-config.json /from/deploy-history.json /to/ 2>/dev/null || cp -a /from/wdp-config.json /to/
      cp -a /from/wdp-session-secret /to/ 2>/dev/null || true
      mkdir -p /to/sessions
      cp -a /from/sessions/. /to/sessions/ 2>/dev/null || true
    '
    return 0
  fi

  # Local dir exists but empty shell (sessions only) — still import if volume is the source of truth.
  if [[ ! -s "$DATA_DIR/wdp-config.json" ]] 2>/dev/null; then
    echo "[WDP] Replacing empty local data from Docker volume ${vol}"
    docker run --rm -v "${vol}:/from:ro" -v "$DATA_DIR:/to" alpine sh -c '
      cp -a /from/wdp-config.json /from/deploy-history.json /to/ 2>/dev/null || cp -a /from/wdp-config.json /to/
      cp -a /from/wdp-session-secret /to/ 2>/dev/null || true
      mkdir -p /to/sessions
      cp -a /from/sessions/. /to/sessions/ 2>/dev/null || true
    '
  fi
}

import_from_docker_volume wdp-data
import_from_docker_volume wdp_wdp-data

mkdir -p "$DATA_DIR/sessions"

echo "[WDP] Installing backend dependencies…"
(cd "$ROOT/backend" && npm ci --omit=dev)

needs_frontend_build() {
  [[ ! -f "$ROOT/frontend/build/index.html" ]] && return 0
  find "$ROOT/frontend/src" -type f -newer "$ROOT/frontend/build/index.html" -print -quit 2>/dev/null | grep -q .
}

if needs_frontend_build; then
  echo "[WDP] Building frontend…"
  (cd "$ROOT/frontend" && npm ci && npm run build)
fi

export PORT="${PORT:-8900}"
export HOST="${HOST:-127.0.0.1}"
export CONFIG_PATH="$DATA_DIR/wdp-config.json"
export SESSION_DIR="$DATA_DIR/sessions"
export SESSION_SECRET_PATH="$DATA_DIR/wdp-session-secret"
export HISTORY_PATH="$DATA_DIR/deploy-history.json"
export DISMISSALS_PATH="$DATA_DIR/security-dismissals.json"
export FRONTEND_BUILD="$ROOT/frontend/build"

echo "[WDP] Data: $DATA_DIR"
echo "[WDP] Open http://127.0.0.1:${PORT}"
echo "[WDP] Runs on the host — safe to use while Wappler is open."
echo "[WDP] Press Ctrl+C to stop."

cd "$ROOT/backend"
exec node src/server.js
