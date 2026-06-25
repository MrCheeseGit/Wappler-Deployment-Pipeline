#!/usr/bin/env bash
# Warn before "address already in use" when WDP runs on a different Docker context.
set -euo pipefail

WDP_PORT="${WDP_PORT:-8900}"
CTX="$(docker context show 2>/dev/null || echo default)"

running_on() {
  docker --context "$1" ps --filter 'name=^wdp$' --filter 'status=running' -q 2>/dev/null | grep -q .
}

if running_on "$CTX"; then
  exit 0
fi

if curl -sf "http://127.0.0.1:${WDP_PORT}/" >/dev/null 2>&1; then
  for alt in desktop-linux default; do
    [[ "$alt" == "$CTX" ]] && continue
    if running_on "$alt"; then
      echo ""
      echo "[WDP] Port ${WDP_PORT} is already in use — WDP is running on Docker context \"${alt}\","
      echo "      but your CLI is on \"${CTX}\" (same \`docker compose\` command, different engine)."
      echo ""
      echo "      Fix (pick one):"
      echo "        docker context use ${alt}"
      echo "        docker compose up -d --build"
      echo ""
      echo "      Or in one line:"
      echo "        docker --context ${alt} compose up -d --build"
      echo ""
      exit 1
    fi
  done
fi

exit 0
