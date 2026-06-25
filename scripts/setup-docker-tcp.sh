#!/usr/bin/env bash
# Prepare host Docker TCP for WDP container mode (./scripts/run.sh --docker).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${WDP_DOCKER_TCP_PORT:-2375}"

if curl -sf -m 2 "http://127.0.0.1:${PORT}/_ping" >/dev/null 2>&1; then
  echo "Docker API already responds on http://127.0.0.1:${PORT}/_ping"
  exit 0
fi

# Docker Desktop (all recent versions) — no GUI “expose on 2375” option anymore.
if command -v docker >/dev/null && docker context show 2>/dev/null | grep -qi desktop; then
  cat <<EOF
Docker Desktop does not offer a “expose daemon on tcp://2375” setting in current versions.

Use the WDP host TCP bridge (socat on the host, not a Docker container):

  ./scripts/docker-tcp-bridge.sh start
  ./scripts/run.sh --docker

No WDP-related container mounts docker.sock (required for Wappler on Docker Desktop).

Easier: ./scripts/run.sh --native   (no bridge, works with Wappler)
EOF
  exec "$ROOT/scripts/docker-tcp-bridge.sh" start
fi

# Native Linux Docker Engine — optional systemd drop-in
DROP_IN="/etc/systemd/system/docker.service.d/wdp-tcp-local.conf"
echo "Linux Docker Engine: add a localhost-only API listener."
echo "This requires sudo and will restart Docker."
read -r -p "Write ${DROP_IN} and restart docker? [y/N] " ans
if [[ "${ans,,}" != "y" ]]; then
  echo "Cancelled. Try: ./scripts/docker-tcp-bridge.sh start  OR  ./scripts/run.sh --native"
  exit 1
fi

sudo mkdir -p /etc/systemd/system/docker.service.d
sudo tee "$DROP_IN" >/dev/null <<EOF
[Service]
ExecStart=
ExecStart=/usr/bin/dockerd -H fd:// -H tcp://127.0.0.1:${PORT}
EOF

sudo systemctl daemon-reload
sudo systemctl restart docker
sleep 2
curl -sf "http://127.0.0.1:${PORT}/_ping" && echo "OK"
