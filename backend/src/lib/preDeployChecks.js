'use strict';

const dns = require('dns').promises;
const fs  = require('fs');
const path = require('path');
const { buildSshConfig, testConnection, exec } = require('./ssh');
const { readConfig } = require('./configStore');
const { resolveDoApiKey } = require('./digitalocean');
const {
  TRAEFIK_IMAGE,
  isTraefikImageDocker29Compatible,
  extractTraefikImageFromCompose,
} = require('./traefikCompat');
const { normalizeHostname } = require('./hostname');
const { probeDockerApi, localDockerHelpMessage } = require('./dockerHost');
const {
  isExternalTraefik,
  getTraefikNetwork,
  sanitizeDockerNetworkName,
} = require('./traefikDeploy');
const { inspectRemoteDocker, TROUBLESHOOTING_DOC } = require('./remoteDockerCheck');
const { inspectRemoteRedis } = require('./remoteRedisCheck');
const { isManagedDb } = require('./dbDeploy');
const {
  isManagedRedis,
  isExistingRedis,
  isExternalRedis,
  getRedisConnection,
} = require('./redisDeploy');

const MIN_DISK_MB      = 2048;
const MIN_DOCKER_MAJOR = 24;
const MIN_COMPOSE_MAJOR = 2;

/**
 * Run all pre-deploy readiness checks for a profile.
 * Returns an array of { id, label, ok, detail } objects.
 * For local Docker targets, SSH checks are skipped.
 * For DigitalOcean provision mode, SSH checks are replaced with a DO API check.
 */
async function runChecks(profile, profileName, options = {}) {
  const publish = options.mode === 'publish';
  const config = await readConfig();
  profile = { ...profile, doApiKey: resolveDoApiKey(config, profile) };

  const isLocal      = profile.hostingTarget === 'local';
  const isRailway    = profile.hostingTarget === 'railway';
  const isProvision  = profile.hostingTarget === 'digitalocean' && profile.doMode === 'provision';
  const needsSsh     = !isLocal && !isRailway && !isProvision;

  const results = [];

  // ── Generated files ────────────────────────────────────────────────────────
  const filesResult = checkFiles(profile.projectPath, profileName);
  results.push({
    id: 'files',
    label: 'Generated files',
    ok: filesResult.ok,
    detail: filesResult.ok
      ? 'Dockerfile.deploy and docker-compose.deploy.yml found'
      : `Missing: ${[
          !filesResult.dockerfileExists && 'Dockerfile.deploy',
          !filesResult.composeExists    && 'docker-compose.deploy.yml',
        ].filter(Boolean).join(', ')} — please complete Step 8 first`,
  });

  if (filesResult.ok) {
    results.push(checkTraefikDocker29Compat(profile, profileName, filesResult.composePath));
    results.push(checkRedisEnv(profile, profileName, filesResult.composePath));
    results.push(checkDbManaged(profile));
  }

  const traefikCfg = profile.wizardConfig?.step5?.addons?.traefik;

  if (isLocal) {
    const probe = await probeDockerApi();
    if (probe.ok) {
      results.push({
        id: 'docker_local',
        label: 'Local Docker daemon',
        ok: true,
        detail: `Reachable via ${probe.dockerHost || 'docker socket'}`,
      });
    } else {
      results.push({
        id: 'docker_local',
        label: 'Local Docker daemon',
        ok: false,
        detail: probe.help || localDockerHelpMessage(probe.error),
      });
    }
    return results;
  }

  if (isRailway) {
    results.push({
      id: 'railway',
      label: 'Railway deployment',
      ok: true,
      detail: 'Railway deployments are triggered via Railway API — no SSH needed',
    });
    return results;
  }

  // ── DigitalOcean provision mode ────────────────────────────────────────────
  // The Droplet does not exist yet — skip all SSH checks and validate the DO API token instead.
  if (isProvision) {
    const apiKey = profile.doApiKey || '';
    if (!apiKey) {
      results.push({
        id: 'do_api',
        label: 'DigitalOcean API token',
        ok: false,
        detail: 'No API token saved — add one in Settings → DigitalOcean or Wizard Step 4',
      });
      return results;
    }
    try {
      const res  = await fetch('https://api.digitalocean.com/v2/account', {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const data  = await res.json();
        const email = data.account?.email || 'unknown';
        results.push({
          id: 'do_api',
          label: 'DigitalOcean API token',
          ok: true,
          detail: `Authenticated as ${email} — Droplet will be provisioned on first deploy`,
        });
      } else {
        results.push({
          id: 'do_api',
          label: 'DigitalOcean API token',
          ok: false,
          detail: `DO API returned HTTP ${res.status} — check your API token in Step 4`,
        });
      }
    } catch (err) {
      results.push({
        id: 'do_api',
        label: 'DigitalOcean API token',
        ok: false,
        detail: `Could not reach DigitalOcean API: ${err.message}`,
      });
    }

    const doSshKeyId = String(profile.doSshKeyId || profile.wizardConfig?.step4?.doSshKeyId || '').trim();
    results.push({
      id: 'do_ssh_key',
      label: 'DigitalOcean SSH key',
      ok: Boolean(doSshKeyId),
      detail: doSshKeyId
        ? `SSH key ID ${doSshKeyId} — will be installed on the new Droplet`
        : 'No SSH key selected — open Wizard Step 4 (provision mode) and choose a key from the dropdown',
    });

    if (!publish) {
      results.push(await checkDnsResult(profile));
    }
    return results;
  }

  // ── SSH checks ────────────────────────────────────────────────────────────
  let sshCfg;
  try {
    sshCfg = buildSshConfig(profile);
  } catch (err) {
    results.push({ id: 'ssh', label: 'SSH authentication', ok: false, detail: err.message });
    // Cannot run further SSH checks without a valid config
    for (const id of ['ports', 'dns', 'disk', 'docker']) {
      results.push({ id, label: labelFor(id), ok: false, detail: 'Skipped — SSH key error' });
    }
    return results;
  }

  // SSH authentication
  try {
    await testConnection(sshCfg);
    results.push({ id: 'ssh', label: 'SSH authentication', ok: true, detail: `Authenticated as ${profile.sshUser}@${profile.sshHost}` });
  } catch (err) {
    results.push({ id: 'ssh', label: 'SSH authentication', ok: false, detail: err.message });
    for (const id of ['ports', 'disk', 'docker']) {
      results.push({ id, label: labelFor(id), ok: false, detail: 'Skipped — SSH failed' });
    }
    // Still attempt DNS
    results.push(...await Promise.all([checkDnsResult(profile)]));
    return results;
  }

  // Run remaining SSH checks in parallel (publish skips ports/DNS — stack already running)
  const externalTraefik = isExternalTraefik(traefikCfg);
  const parallel = [
    publish ? Promise.resolve(null) : checkPorts(sshCfg, externalTraefik),
    checkDisk(sshCfg),
    checkDocker(sshCfg),
    publish ? Promise.resolve(null) : checkDnsResult(profile),
    externalTraefik ? checkTraefikExternalNetwork(sshCfg, traefikCfg) : Promise.resolve(null),
    externalTraefik ? checkTraefikExternalInstance(sshCfg, traefikCfg) : Promise.resolve(null),
    checkRedisHostContainers(sshCfg, profile),
  ];
  const [portsRes, diskRes, dockerRes, dnsRes, traefikNetRes, traefikInstRes, redisHostRes] =
    await Promise.allSettled(parallel);

  if (!publish) {
    results.push(settled(portsRes, 'ports', 'Port availability'));
  }
  results.push(settled(diskRes, 'disk', 'Disk space'));
  results.push(settled(dockerRes, 'docker', 'Docker version'));
  if (!publish) {
    results.push(settled(dnsRes, 'dns', 'DNS resolution'));
  }
  if (externalTraefik && traefikNetRes) {
    results.push(settled(traefikNetRes, 'traefik_network', 'Traefik Docker network'));
  }
  if (externalTraefik && traefikInstRes) {
    results.push(settled(traefikInstRes, 'traefik_instance', 'Existing Traefik'));
  }
  if (redisHostRes) {
    results.push(settled(redisHostRes, 'redis_host', 'Redis on server'));
  }

  return results;
}

// ── Individual checkers ───────────────────────────────────────────────────────

function checkFiles(projectPath, profileName) {
  if (!projectPath) return { ok: false, dockerfileExists: false, composeExists: false };
  const dir = path.join(projectPath, 'wdp', profileName);
  const dockerfileExists = fs.existsSync(path.join(dir, 'Dockerfile.deploy'));
  const composeExists    = fs.existsSync(path.join(dir, 'docker-compose.deploy.yml'));
  const composePath = path.join(dir, 'docker-compose.deploy.yml');
  return { ok: dockerfileExists && composeExists, dockerfileExists, composeExists, composePath };
}

async function checkPorts(sshCfg, externalTraefik = false) {
  const { stdout } = await exec(sshCfg, "ss -tlnp 2>/dev/null | grep -E ':80 |:443 ' | head -5 || echo ''");
  const port80InUse  = stdout.includes(':80 ');
  const port443InUse = stdout.includes(':443 ');

  if (!port80InUse && !port443InUse) {
    return { ok: true, label: 'Port availability', detail: 'Ports 80 and 443 are free' };
  }
  if (externalTraefik) {
    const detail = `Port ${port80InUse ? '80' : ''}${port80InUse && port443InUse ? ' and ' : ''}${port443InUse ? '443' : ''} in use — expected when using existing Traefik (WDP will not take over 80/443)`;
    return { ok: true, label: 'Port availability', detail };
  }
  const detail = `Port ${port80InUse ? '80' : ''}${port80InUse && port443InUse ? ' and ' : ''}${port443InUse ? '443' : ''} in use — may be an existing Traefik instance (redeploy will update it)`;
  return { ok: true, label: 'Port availability', detail };
}

async function checkTraefikExternalNetwork(sshCfg, traefikCfg) {
  const net = sanitizeDockerNetworkName(getTraefikNetwork(traefikCfg));
  try {
    const { stdout } = await exec(
      sshCfg,
      `docker network inspect ${JSON.stringify(net)} --format '{{.Name}}' 2>/dev/null || echo ''`,
    );
    const found = stdout.trim() === net;
    return {
      ok: found,
      label: 'Traefik Docker network',
      detail: found
        ? `Network "${net}" exists — app will join it for existing Traefik`
        : `Network "${net}" not found — create it on the server or fix the name in Step 5, then deploy`,
    };
  } catch (err) {
    return {
      ok: false,
      label: 'Traefik Docker network',
      detail: err.message || `Could not inspect network "${net}"`,
    };
  }
}

/** External mode requires a running Traefik on the host (not only this project's old container). */
async function checkTraefikExternalInstance(sshCfg, traefikCfg) {
  const net = sanitizeDockerNetworkName(getTraefikNetwork(traefikCfg));
  try {
    const { stdout } = await exec(
      sshCfg,
      [
        'set +e',
        'lines=$(docker ps --format \'{{.Names}}|{{.Image}}\' 2>/dev/null | grep -i traefik | head -5)',
        'if [ -z "$lines" ]; then',
        '  echo NO_TRAEFIK',
        '  exit 0',
        'fi',
        'echo "$lines" | while IFS= read -r line; do echo "TRAEFIK:$line"; done',
        `on_net=$(docker ps --filter network=${JSON.stringify(net)} --format '{{.Names}}' 2>/dev/null | grep -i traefik | head -1)`,
        'if [ -n "$on_net" ]; then echo ON_NET:yes; else echo ON_NET:no; fi',
      ].join('\n'),
    );

    if (stdout.includes('NO_TRAEFIK')) {
      return {
        ok: false,
        label: 'Existing Traefik',
        detail:
          'Use existing Traefik is enabled but no Traefik container is running on this host. ' +
          'Your site will not be reachable on ports 80/443. Use “Deploy Traefik with this stack” in Step 5 for a dedicated server, or start shared Traefik first.',
      };
    }

    const containers = stdout
      .split('\n')
      .filter((l) => l.startsWith('TRAEFIK:'))
      .map((l) => l.slice('TRAEFIK:'.length).trim())
      .filter(Boolean);

    const onNet = stdout.includes('ON_NET:yes');

    if (!onNet && containers.length > 0) {
      const sample = containers[0].split('|')[0] || containers[0];
      return {
        ok: false,
        label: 'Existing Traefik',
        detail:
          `Traefik is running (${sample}) but not on network "${net}". ` +
          'Fix the Docker network name in Step 5 to match your server Traefik, or use bundled mode.',
      };
    }

    const summary = containers
      .slice(0, 2)
      .map((c) => c.split('|')[0] || c)
      .join(', ');

    return {
      ok: true,
      label: 'Existing Traefik',
      detail: summary
        ? `Running Traefik found (${summary}) on network "${net}"`
        : `Running Traefik found on network "${net}"`,
    };
  } catch (err) {
    return {
      ok: false,
      label: 'Existing Traefik',
      detail: err.message || 'Could not detect Traefik on the remote host',
    };
  }
}

async function checkDisk(sshCfg) {
  const { stdout } = await exec(sshCfg, "df -m / | tail -1 | awk '{print $4}'");
  const freeMb = parseInt(stdout.trim(), 10);
  if (isNaN(freeMb)) throw new Error('Could not read disk space');
  const ok = freeMb >= MIN_DISK_MB;
  return {
    ok,
    label: 'Disk space',
    detail: ok
      ? `${freeMb} MB free (minimum ${MIN_DISK_MB} MB required)`
      : `Only ${freeMb} MB free — at least ${MIN_DISK_MB} MB required`,
  };
}

async function checkDocker(sshCfg) {
  const status = await inspectRemoteDocker(sshCfg);
  return {
    ok: status.ok,
    label: 'Docker version',
    detail: status.detail,
    fixHint: status.fixHint,
    troubleshootingDoc: TROUBLESHOOTING_DOC,
    canInstallDocker: status.canInstall,
  };
}

async function checkDnsResult(profile) {
  const raw = profile.domain ||
    profile.wizardConfig?.step5?.addons?.traefik?.domain || null;
  const domain = normalizeHostname(raw);
  if (!domain) {
    return { ok: true, label: 'DNS resolution', detail: 'No domain configured — skipped' };
  }
  try {
    const addresses = await dns.resolve4(domain);
    const expected  = profile.sshHost || null;
    const matches   = expected ? addresses.includes(expected) : null;
    if (matches === false) {
      // Domain resolves but to a different IP — likely Cloudflare or another proxy
      return {
        ok: true,
        label: 'DNS resolution',
        detail: `${domain} → ${addresses.join(', ')} (proxied — SSH host ${expected} not in DNS)`,
      };
    }
    return {
      ok: true,
      label: 'DNS resolution',
      detail: `${domain} → ${addresses.join(', ')}`,
    };
  } catch (err) {
    return { ok: false, label: 'DNS resolution', detail: `${domain} — ${err.message}` };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function settled(settledResult, id, label) {
  if (settledResult.status === 'fulfilled') {
    return { id, ...settledResult.value };
  }
  return { id, label, ok: false, detail: settledResult.reason?.message || 'Check failed' };
}

function labelFor(id) {
  const map = {
    ports: 'Port availability',
    disk: 'Disk space',
    docker: 'Docker version',
    dns: 'DNS resolution',
    traefik_image: 'Traefik (Docker 29)',
    traefik_network: 'Traefik Docker network',
    traefik_instance: 'Existing Traefik',
    redis_env: 'Redis configuration',
    redis_host: 'Redis on server',
    db_managed: 'Managed database',
  };
  return map[id] || id;
}

function checkDbManaged(profile) {
  const step3 = profile.wizardConfig?.step3;
  if (!isManagedDb(step3)) {
    return { id: 'db_managed', label: 'Managed database', ok: true, detail: 'Not using a managed DB container — skipped' };
  }
  if (!step3.managedDbAck) {
    return {
      id: 'db_managed',
      label: 'Managed database',
      ok: false,
      detail: 'Confirm the managed database notice in Step 3, then regenerate (Step 8)',
    };
  }
  return {
    id: 'db_managed',
    label: 'Managed database',
    ok: true,
    detail: 'WDP will run a new database container in this stack. Existing databases elsewhere are not imported or modified.',
  };
}

async function checkRedisHostContainers(sshCfg, profile) {
  const redisCfg = profile.wizardConfig?.step5?.addons?.redis;
  if (!redisCfg?.enabled) {
    return { id: 'redis_host', label: 'Redis on server', ok: true, detail: 'Redis not enabled — skipped' };
  }

  try {
    const probe = await inspectRemoteRedis(sshCfg);
    if (!probe.ok) {
      return { id: 'redis_host', label: 'Redis on server', ok: true, detail: `Could not scan Docker: ${probe.error}` };
    }

    if (isManagedRedis(redisCfg) && probe.found) {
      const names = probe.containers.map((c) => c.name).slice(0, 3).join(', ');
      return {
        id: 'redis_host',
        label: 'Redis on server',
        ok: true,
        detail: `Other Redis container(s) on this host (${names}). WDP will deploy a separate Redis in this stack unless you switch to "Use existing Redis".`,
      };
    }

    if (isExistingRedis(redisCfg) && !probe.found) {
      return {
        id: 'redis_host',
        label: 'Redis on server',
        ok: true,
        detail: 'No Redis containers detected on this host — confirm hostname and Docker network are correct.',
      };
    }

    if (isExistingRedis(redisCfg) && probe.found) {
      const names = probe.containers.map((c) => c.name).join(', ');
      return {
        id: 'redis_host',
        label: 'Redis on server',
        ok: true,
        detail: `Found Redis container(s): ${names}. Use the container name as host if sharing a Docker network.`,
      };
    }

    return { id: 'redis_host', label: 'Redis on server', ok: true, detail: 'No conflicting Redis containers detected' };
  } catch (err) {
    return { id: 'redis_host', label: 'Redis on server', ok: true, detail: err.message };
  }
}

function checkRedisEnv(profile, profileName, composePath) {
  const redisCfg = profile.wizardConfig?.step5?.addons?.redis;
  if (!redisCfg?.enabled) {
    return { id: 'redis_env', label: 'Redis configuration', ok: true, detail: 'Redis not enabled — skipped' };
  }

  const conn = getRedisConnection(redisCfg);
  if (!conn) {
    return {
      id: 'redis_env',
      label: 'Redis configuration',
      ok: false,
      detail: 'Redis enabled but connection details are incomplete — check Step 5 and regenerate (Step 8)',
    };
  }

  if (isManagedRedis(redisCfg)) {
    const pass = String(redisCfg.password || '').trim();
    if (!pass) {
      return {
        id: 'redis_env',
        label: 'Redis configuration',
        ok: false,
        detail: 'Managed Redis requires a password — set it in Step 5 and regenerate (Step 8)',
      };
    }
    if (!redisCfg.managedConfirm) {
      return {
        id: 'redis_env',
        label: 'Redis configuration',
        ok: false,
        detail: 'Confirm the managed Redis notice in Step 5, then regenerate (Step 8)',
      };
    }
  }

  if (isExistingRedis(redisCfg) || isExternalRedis(redisCfg)) {
    if (!conn.host) {
      return {
        id: 'redis_env',
        label: 'Redis configuration',
        ok: false,
        detail: 'Redis host is required for existing/external mode — set it in Step 5',
      };
    }
  }

  try {
    const compose = fs.readFileSync(composePath, 'utf8');
    const envPath = path.join(path.dirname(composePath), '.env.deploy');
    const expectsService = isManagedRedis(redisCfg);
    const hasService = /^\s{2}redis:\s*$/m.test(compose);

    if (expectsService && !hasService) {
      return {
        id: 'redis_env',
        label: 'Redis configuration',
        ok: false,
        detail: 'Managed Redis enabled but no redis service in compose — regenerate files in Step 8',
      };
    }
    if (!expectsService && hasService) {
      return {
        id: 'redis_env',
        label: 'Redis configuration',
        ok: false,
        detail: 'Compose still includes a redis service but Step 5 uses existing/external mode — regenerate Step 8',
      };
    }

    if (!fs.existsSync(envPath)) {
      return {
        id: 'redis_env',
        label: 'Redis configuration',
        ok: false,
        detail: '.env.deploy missing — regenerate files in Step 8',
      };
    }

    const env = fs.readFileSync(envPath, 'utf8');
    const hasUrl = /^REDIS_URL=/m.test(env);
    const usesInterpolation = compose.includes('${REDIS_PASSWORD}');

    if (usesInterpolation) {
      return {
        id: 'redis_env',
        label: 'Redis configuration',
        ok: false,
        detail: 'Compose still uses ${REDIS_PASSWORD} — regenerate files (Step 8)',
      };
    }
    if (!hasUrl) {
      return {
        id: 'redis_env',
        label: 'Redis configuration',
        ok: false,
        detail: 'REDIS_URL not in .env.deploy — regenerate files in Step 8',
      };
    }

    const modeLabel = redisCfg.redisMode || 'managed';
    return {
      id: 'redis_env',
      label: 'Redis configuration',
      ok: true,
      detail: `REDIS_URL set (${modeLabel} mode${expectsService ? '; redis service in compose' : ''})`,
    };
  } catch (err) {
    return { id: 'redis_env', label: 'Redis configuration', ok: false, detail: err.message };
  }
}

function checkTraefikDocker29Compat(profile, profileName, composePath) {
  const traefikCfg = profile.wizardConfig?.step5?.addons?.traefik;
  const traefikOn = traefikCfg?.enabled;
  if (!traefikOn) {
    return { id: 'traefik_image', label: 'Traefik (Docker 29)', ok: true, detail: 'Traefik not enabled — skipped' };
  }
  if (isExternalTraefik(traefikCfg)) {
    const net = getTraefikNetwork(traefikCfg);
    return {
      id: 'traefik_image',
      label: 'Traefik (Docker 29)',
      ok: true,
      detail: `Using existing Traefik on network "${net}" — bundled image check skipped`,
    };
  }
  try {
    const yaml = fs.readFileSync(composePath, 'utf8');
    const image = extractTraefikImageFromCompose(yaml);
    if (!image) {
      return {
        id: 'traefik_image',
        label: 'Traefik (Docker 29)',
        ok: false,
        detail: 'Traefik enabled (bundled mode) but no traefik service in compose — regenerate files (Step 8)',
      };
    }
    if (!isTraefikImageDocker29Compatible(image)) {
      return {
        id: 'traefik_image',
        label: 'Traefik (Docker 29)',
        ok: false,
        detail:
          `Compose pins ${image}; Docker Engine 29+ needs ${TRAEFIK_IMAGE} or newer (v3.6.1+). ` +
          'Regenerate files in Step 8, then deploy again.',
      };
    }
    return {
      id: 'traefik_image',
      label: 'Traefik (Docker 29)',
      ok: true,
      detail: `${image} — compatible with Docker Engine 29+`,
    };
  } catch (err) {
    return {
      id: 'traefik_image',
      label: 'Traefik (Docker 29)',
      ok: false,
      detail: err.message,
    };
  }
}

module.exports = { runChecks, checkFiles };
