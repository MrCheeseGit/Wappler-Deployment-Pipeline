'use strict';

const { encodeRedisPassword } = require('./envDeployFormat');

/** @param {object|undefined} redisCfg — step5.addons.redis */
function getRedisMode(redisCfg) {
  if (!redisCfg?.enabled) return 'none';
  return redisCfg.redisMode || 'managed';
}

function isManagedRedis(redisCfg) {
  return getRedisMode(redisCfg) === 'managed';
}

function isExistingRedis(redisCfg) {
  return getRedisMode(redisCfg) === 'existing';
}

function isExternalRedis(redisCfg) {
  return getRedisMode(redisCfg) === 'external';
}

function shouldDeployRedisContainer(redisCfg) {
  return Boolean(redisCfg?.enabled) && isManagedRedis(redisCfg);
}

/**
 * @param {object|undefined} redisCfg
 * @returns {{ host: string, port: number, password: string, db: number } | null}
 */
function getRedisConnection(redisCfg) {
  if (!redisCfg?.enabled) return null;
  const mode = getRedisMode(redisCfg);
  const db = Number.isFinite(Number(redisCfg.db)) ? Number(redisCfg.db) : 0;
  if (mode === 'managed') {
    return {
      host: 'redis',
      port: 6379,
      password: String(redisCfg.password || '').trim(),
      db,
    };
  }
  const host = String(redisCfg.host || '').trim();
  if (!host) return null;
  return {
    host,
    port: Number(redisCfg.port) || 6379,
    password: String(redisCfg.password || '').trim(),
    db,
  };
}

/**
 * @param {{ host: string, port: number, password?: string, db?: number }} conn
 */
function buildRedisUrl(conn) {
  const host = conn.host || 'redis';
  const port = conn.port || 6379;
  const db = conn.db ?? 0;
  const dbSuffix = `/${db}`;
  const pass = String(conn.password || '').trim();
  if (pass) {
    return `redis://:${encodeRedisPassword(pass)}@${host}:${port}${dbSuffix}`;
  }
  return `redis://${host}:${port}${dbSuffix}`;
}

/** Optional Docker network to join when using existing Redis on the host. */
function getRedisNetwork(redisCfg) {
  if (!isExistingRedis(redisCfg)) return null;
  const net = String(redisCfg.network || '').trim();
  return net || null;
}

function sanitizeDockerNetworkName(name) {
  const cleaned = String(name || '')
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, '');
  return cleaned || '';
}

/** redis-server command array for managed Redis service. */
function buildRedisServerCommand(redisCfg) {
  const cmd = ['redis-server'];
  const pass = String(redisCfg?.password || '').trim();
  if (pass) cmd.push('--requirepass', pass);
  const maxMem = String(redisCfg?.maxMemory || '').trim();
  if (maxMem) {
    cmd.push('--maxmemory', maxMem);
    cmd.push('--maxmemory-policy', redisCfg.evictionPolicy || 'allkeys-lru');
  }
  return cmd;
}

module.exports = {
  getRedisMode,
  isManagedRedis,
  isExistingRedis,
  isExternalRedis,
  shouldDeployRedisContainer,
  getRedisConnection,
  buildRedisUrl,
  getRedisNetwork,
  sanitizeDockerNetworkName,
  buildRedisServerCommand,
};
