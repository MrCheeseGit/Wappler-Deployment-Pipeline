'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const IN_DOCKER = fs.existsSync('/.dockerenv');
const HAS_SOCKET_MOUNT = fs.existsSync('/var/run/docker.sock');
const WDP_DOCKER_CLI_CONFIG = process.env.WDP_DOCKER_CONFIG || '/app/.wdp-docker-cli';

/** Avoid mounted ~/.docker/config.json (desktop socket, docker-credential-desktop, etc.). */
function ensureWdpDockerCliConfig() {
  const dir = WDP_DOCKER_CLI_CONFIG;
  const configPath = path.join(dir, 'config.json');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, '{}\n', 'utf8');
  }
  return dir;
}

/** Resolved after initDockerConnectivity(): string = tcp URL, null = unix socket, false = unreachable */
let cachedDockerHost;

/**
 * Hosts to try for tcp://…:2375 (Docker Desktop gateway, bridge gateway, etc.)
 */
function tcpCandidateUrls() {
  const port = process.env.WDP_DOCKER_TCP_PORT || '2375';
  const hosts = new Set();

  if (process.env.WDP_DOCKER_TCP_HOST) hosts.add(process.env.WDP_DOCKER_TCP_HOST);
  hosts.add('host.docker.internal');

  try {
    for (const line of fs.readFileSync('/etc/hosts', 'utf8').split('\n')) {
      if (!line.includes('host.docker.internal')) continue;
      const ip = line.trim().split(/\s+/)[0];
      if (ip && ip !== '127.0.0.1') hosts.add(ip);
    }
  } catch { /* ignore */ }

  try {
    for (const line of fs.readFileSync('/proc/net/route', 'utf8').split('\n').slice(1)) {
      const p = line.trim().split(/\s+/);
      if (p[1] === '00000000' && p[2]) {
        const hex = p[2];
        const o = [
          parseInt(hex.slice(6, 8), 16),
          parseInt(hex.slice(4, 6), 16),
          parseInt(hex.slice(2, 4), 16),
          parseInt(hex.slice(0, 2), 16),
        ];
        if (o.every((n) => !Number.isNaN(n))) hosts.add(o.join('.'));
        break;
      }
    }
  } catch { /* ignore */ }

  return [...hosts].map((h) => `tcp://${h}:${port}`);
}

function probeTcpUrl(url, timeoutMs = 2000) {
  let hostport = url.slice('tcp://'.length).split('/')[0];
  const [host, portStr] = hostport.includes(':') ? hostport.split(':') : [hostport, '2375'];
  const port = parseInt(portStr, 10) || 2375;

  return new Promise((resolve) => {
    const req = http.get({ host, port, path: '/_ping', timeout: timeoutMs }, (res) => {
      res.resume();
      resolve({ ok: res.statusCode === 200, dockerHost: url, statusCode: res.statusCode });
    });
    req.on('error', (err) => resolve({ ok: false, dockerHost: url, error: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, dockerHost: url, error: 'timeout' });
    });
  });
}

async function findWorkingTcpHost() {
  for (const url of tcpCandidateUrls()) {
    const r = await probeTcpUrl(url);
    if (r.ok) return url;
  }
  return null;
}

/**
 * Call once at startup (and safe to call again).
 */
async function initDockerConnectivity() {
  if (process.env.WDP_DOCKER_HOST) {
    cachedDockerHost = process.env.WDP_DOCKER_HOST;
    return cachedDockerHost;
  }

  const mode = (process.env.WDP_DOCKER_MODE || '').toLowerCase();

  if (mode === 'socket' || (HAS_SOCKET_MOUNT && mode !== 'host-tcp')) {
    cachedDockerHost = null;
    return null;
  }

  if (mode === 'host-tcp') {
    const tcp = await findWorkingTcpHost();
    if (tcp) {
      cachedDockerHost = tcp;
      return tcp;
    }
  }

  if (!IN_DOCKER) {
    cachedDockerHost = null;
    return null;
  }

  if (HAS_SOCKET_MOUNT && process.env.WDP_DOCKER_FALLBACK_SOCKET === '1') {
    cachedDockerHost = null;
    return null;
  }

  cachedDockerHost = false;
  return false;
}

function dockerCliEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  const mode = (process.env.WDP_DOCKER_MODE || '').toLowerCase();

  // Mounted $HOME brings in Docker Desktop config (credential helper, context).
  if (IN_DOCKER) {
    env.DOCKER_CONFIG = ensureWdpDockerCliConfig();
  }

  if (process.env.WDP_DOCKER_HOST) {
    env.DOCKER_HOST = process.env.WDP_DOCKER_HOST;
    return env;
  }

  if (typeof cachedDockerHost === 'string') {
    env.DOCKER_HOST = cachedDockerHost;
    return env;
  }

  // Use the host engine via socket mount, not desktop-linux from ~/.docker.
  if (IN_DOCKER && HAS_SOCKET_MOUNT && mode !== 'host-tcp') {
    env.DOCKER_HOST = 'unix:///var/run/docker.sock';
    delete env.DOCKER_CONTEXT;
    return env;
  }

  const explicit = env.DOCKER_HOST;
  if (explicit) {
    env.DOCKER_HOST = explicit;
    return env;
  }

  if (cachedDockerHost === null || (cachedDockerHost === undefined && HAS_SOCKET_MOUNT)) {
    return env;
  }

  if (mode === 'host-tcp' || (IN_DOCKER && cachedDockerHost === false)) {
    env.DOCKER_HOST = tcpCandidateUrls()[0] || buildHostTcpUrl();
  }

  return env;
}

function buildHostTcpUrl() {
  const host = process.env.WDP_DOCKER_TCP_HOST || 'host.docker.internal';
  const port = process.env.WDP_DOCKER_TCP_PORT || '2375';
  return `tcp://${host}:${port}`;
}

function describeDockerMode() {
  const env = dockerCliEnv();
  const host = env.DOCKER_HOST || 'unix:///var/run/docker.sock';
  if (IN_DOCKER && HAS_SOCKET_MOUNT && !process.env.WDP_DOCKER_MODE && !process.env.WDP_DOCKER_HOST) {
    return { mode: 'socket-mount', dockerHost: host, wapplerFriendly: false };
  }
  if (host.startsWith('tcp://')) {
    return { mode: 'host-tcp', dockerHost: host, wapplerFriendly: !HAS_SOCKET_MOUNT };
  }
  return { mode: 'socket', dockerHost: host, wapplerFriendly: !IN_DOCKER };
}

async function probeDockerCli(timeoutMs = 2000) {
  const env = dockerCliEnv();
  const host = env.DOCKER_HOST || 'unix:///var/run/docker.sock';
  try {
    await execFileAsync('docker', ['info', '--format', '{{.ServerVersion}}'], {
      env,
      timeout: timeoutMs,
    });
    return { ok: true, dockerHost: host };
  } catch (err) {
    return {
      ok: false,
      dockerHost: host,
      error: err.message,
      help: localDockerHelpMessage(err.message),
    };
  }
}

async function probeDockerApi(timeoutMs = 2000) {
  if (cachedDockerHost === undefined) await initDockerConnectivity();

  const mode = (process.env.WDP_DOCKER_MODE || '').toLowerCase();
  if (IN_DOCKER && HAS_SOCKET_MOUNT && mode !== 'host-tcp' && cachedDockerHost !== false) {
    return probeDockerCli(timeoutMs);
  }

  if (!IN_DOCKER && !process.env.WDP_DOCKER_HOST && !process.env.DOCKER_HOST) {
    return probeDockerCli(timeoutMs);
  }

  if (cachedDockerHost === null || (!process.env.WDP_DOCKER_MODE && HAS_SOCKET_MOUNT && cachedDockerHost !== false)) {
    return probeDockerCli(timeoutMs);
  }

  if (typeof cachedDockerHost === 'string') {
    return probeTcpUrl(cachedDockerHost, timeoutMs);
  }

  const tried = tcpCandidateUrls();
  const last = tried[tried.length - 1] || buildHostTcpUrl();
  const err = await probeTcpUrl(last, timeoutMs);
  return {
    ok: false,
    dockerHost: last,
    error: err.error || 'unreachable',
    help: localDockerHelpMessage(err.error),
  };
}

function localDockerHelpMessage(detail) {
  const extra = detail ? ` (${detail})` : '';
  const d = String(detail || '');
  if (d.includes('docker-credential-desktop')) {
    return (
      'Docker credential helper from Docker Desktop is not available inside WDP. ' +
      'Rebuild the wdp container (docker compose up -d --build) — WDP now uses an isolated Docker CLI config for deploys.'
    );
  }
  if (d.includes('desktop/docker.sock')) {
    return (
      'Docker Desktop is not running, or your CLI context points at its socket. ' +
      'Start Docker Desktop, or on the host run: docker context use default — then retry deploy.'
    );
  }
  if (!IN_DOCKER) {
    return `Docker is not reachable${extra}. Is Docker running?`;
  }
  return (
    'WDP cannot reach the Docker API' + extra + '. ' +
    'Is Docker Engine running on the host? Restart the wdp container after Docker is up.'
  );
}

function wapplerCoexistenceHint() {
  if (!IN_DOCKER || !HAS_SOCKET_MOUNT) return null;
  return (
    'If Wappler Server Actions spin while WDP is running, see installation.md → Wappler troubleshooting.'
  );
}

module.exports = {
  dockerCliEnv,
  describeDockerMode,
  probeDockerApi,
  initDockerConnectivity,
  localDockerHelpMessage,
  wapplerCoexistenceHint,
  IN_DOCKER,
  HAS_SOCKET_MOUNT,
};
