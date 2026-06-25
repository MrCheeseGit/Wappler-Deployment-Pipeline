'use strict';

/**
 * Format a value for a dotenv / .env.deploy line (Docker Compose --env-file).
 * Quotes values that contain characters which break parsers or shell layers.
 */
function formatEnvValue(value) {
  const s = String(value ?? '');
  if (!s) return s;
  if (/[\s"'\\$#`!&|<>^]/.test(s) || s.startsWith('[') || s.startsWith('{')) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

/** Password segment for redis:// URLs in REDIS_URL */
function encodeRedisPassword(password) {
  return encodeURIComponent(String(password ?? ''));
}

module.exports = { formatEnvValue, encodeRedisPassword };
