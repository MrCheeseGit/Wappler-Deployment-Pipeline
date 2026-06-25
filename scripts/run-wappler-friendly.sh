#!/usr/bin/env bash
# Deprecated — use ./scripts/run.sh --docker
exec "$(dirname "$0")/run.sh" --docker "$@"
