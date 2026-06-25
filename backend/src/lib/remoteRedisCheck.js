'use strict';

const { exec } = require('./ssh');

const PROBE_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
docker ps -a --format '{{.Names}}\\t{{.Image}}\\t{{.Status}}' 2>/dev/null | grep -iE 'redis' | while IFS=$'\\t' read -r name image status; do
  [ -n "$name" ] || continue
  nets=$(docker inspect "$name" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' 2>/dev/null | xargs echo || true)
  printf '%s\\t%s\\t%s\\t%s\\n' "$name" "$image" "$status" "$nets"
done
`;

/**
 * List Redis-like containers on a remote Docker host (with Docker networks).
 * @param {object} sshCfg
 */
async function inspectRemoteRedis(sshCfg) {
  const b64 = Buffer.from(PROBE_SCRIPT, 'utf8').toString('base64');
  let stdout = '';
  try {
    ({ stdout } = await exec(sshCfg, `echo ${JSON.stringify(b64)} | base64 -d | bash`));
  } catch (err) {
    return { ok: false, error: err.message, containers: [] };
  }

  const containers = stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, image, status, networks] = line.split('\t');
      return {
        name: name || '',
        image: image || '',
        status: status || '',
        networks: (networks || '').trim(),
      };
    })
    .filter((c) => c.name);

  return {
    ok: true,
    found: containers.length > 0,
    containers,
  };
}

module.exports = { inspectRemoteRedis };
