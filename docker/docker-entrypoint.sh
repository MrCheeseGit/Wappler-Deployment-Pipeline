#!/bin/sh
set -e

if [ -z "${HOME:-}" ]; then
  echo '[WDP] ERROR: HOME is not set.'
  echo '  Linux/macOS: run docker compose from your normal user terminal.'
  echo '  Windows: copy .env.example to .env and set HOME (see installation.md).'
  exit 1
fi

exec node src/server.js
