'use strict';

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const SECRET_PATH = process.env.SESSION_SECRET_PATH || '/data/wdp-session-secret';

/** Default browser session — 24 hours. */
const SESSION_MS_DEFAULT = 24 * 60 * 60 * 1000;
/** “Remember me” — 30 days (self-hosted / local use). */
const SESSION_MS_REMEMBER = 30 * 24 * 60 * 60 * 1000;

const SESSION_TTL_SECONDS = Math.ceil(SESSION_MS_REMEMBER / 1000);

/**
 * Stable secret across container rebuilds (persisted under /data unless SESSION_SECRET is set).
 */
function loadOrCreateSessionSecret() {
  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv) return fromEnv;

  try {
    const existing = fs.readFileSync(SECRET_PATH, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const secret = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
  fs.writeFileSync(SECRET_PATH, secret, { encoding: 'utf8', mode: 0o600 });
  return secret;
}

function applySessionDuration(req, rememberMe) {
  if (!req.session?.cookie) return;
  req.session.cookie.maxAge = rememberMe ? SESSION_MS_REMEMBER : SESSION_MS_DEFAULT;
}

module.exports = {
  loadOrCreateSessionSecret,
  SESSION_MS_DEFAULT,
  SESSION_MS_REMEMBER,
  SESSION_TTL_SECONDS,
  applySessionDuration,
};
