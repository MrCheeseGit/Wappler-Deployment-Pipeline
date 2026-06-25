#!/usr/bin/env bash
# Expose the host Docker API on TCP without any container mounting docker.sock
# (Docker Desktop + Wappler break when a container bind-mounts the socket).
#
# WDP containers use WDP_DOCKER_MODE=host-tcp / tcp://host.docker.internal:2375
set -euo pipefail

PORT="${WDP_DOCKER_TCP_PORT:-2375}"
SOCK="${WDP_DOCKER_SOCK:-/var/run/docker.sock}"
PIDFILE="${WDP_DOCKER_TCP_PIDFILE:-/tmp/wdp-docker-tcp-bridge.pids}"
LEGACY_CONTAINER="${WDP_DOCKER_TCP_BRIDGE_NAME:-wdp-docker-tcp}"

cmd="${1:-status}"

need_socat() {
  if ! command -v socat >/dev/null 2>&1; then
    echo "socat is required. Install it (e.g. apt install socat) or use: ./scripts/run.sh --native" >&2
    exit 1
  fi
}

bind_addresses() {
  echo 127.0.0.1
  if command -v docker >/dev/null 2>&1; then
    local gw
    gw="$(docker network inspect bridge --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}' 2>/dev/null || true)"
    if [[ -n "$gw" && "$gw" != "127.0.0.1" ]]; then
      echo "$gw"
    fi
  fi
  if command -v ip >/dev/null 2>&1 && ip -4 addr show docker0 &>/dev/null; then
    ip -4 addr show docker0 | awk '/inet / {print $2}' | cut -d/ -f1
  fi
}

is_listening() {
  local bind="$1"
  curl -sf -m 2 "http://${bind}:${PORT}/_ping" >/dev/null 2>&1
}

remove_legacy_container() {
  if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$LEGACY_CONTAINER"; then
    echo "Removing legacy socket-mounted bridge container: $LEGACY_CONTAINER"
    docker rm -f "$LEGACY_CONTAINER" >/dev/null 2>&1 || true
  fi
}

start_bridge() {
  need_socat
  remove_legacy_container

  if [[ -f "$PIDFILE" ]]; then
    local alive=0
    while read -r pid; do
      [[ -n "$pid" ]] || continue
      if kill -0 "$pid" 2>/dev/null; then
        alive=1
      fi
    done <"$PIDFILE"
    if [[ "$alive" -eq 1 ]]; then
      echo "Host bridge already running (pid file: $PIDFILE)"
      status_bridge
      return 0
    fi
    rm -f "$PIDFILE"
  fi

  if [[ ! -S "$SOCK" ]]; then
    echo "Docker socket not found: $SOCK (is Docker running?)" >&2
    exit 1
  fi

  : >"$PIDFILE"
  local started=0
  local bind seen=""
  while read -r bind; do
    [[ -n "$bind" ]] || continue
    if [[ " $seen " == *" $bind "* ]]; then
      continue
    fi
    seen="$seen $bind"
    if is_listening "$bind"; then
      echo "Already listening on ${bind}:${PORT}"
      continue
    fi
    socat "TCP-LISTEN:${PORT},fork,reuseaddr,bind=${bind}" "UNIX-CONNECT:${SOCK}" &
    echo $! >>"$PIDFILE"
    started=1
    echo "Listening on ${bind}:${PORT} -> ${SOCK}"
  done < <(bind_addresses | sort -u)

  if [[ "$started" -eq 0 ]]; then
    status_bridge
    return 0
  fi

  sleep 0.3
  status_bridge
}

stop_bridge() {
  if [[ -f "$PIDFILE" ]]; then
    while read -r pid; do
      [[ -n "$pid" ]] || continue
      kill "$pid" 2>/dev/null || true
    done <"$PIDFILE"
    rm -f "$PIDFILE"
    echo "Stopped host bridge (socat)"
  else
    echo "No host bridge pid file ($PIDFILE)"
  fi
  remove_legacy_container
}

status_bridge() {
  local ok=0
  local bind
  while read -r bind; do
    [[ -n "$bind" ]] || continue
    if is_listening "$bind"; then
      echo "OK — Docker API on http://${bind}:${PORT}/_ping"
      ok=1
    fi
  done < <(bind_addresses | sort -u)
  if [[ "$ok" -eq 1 ]]; then
    if [[ -f "$PIDFILE" ]]; then
      echo "Pids: $(tr '\n' ' ' <"$PIDFILE" | sed 's/ $//')"
    fi
    return 0
  fi
  echo "Not reachable on port ${PORT} (run: $0 start)"
  return 1
}

case "$cmd" in
  start)  start_bridge ;;
  stop)   stop_bridge ;;
  status) status_bridge ;;
  *)
    echo "Usage: $0 {start|stop|status}"
    exit 1
    ;;
esac
