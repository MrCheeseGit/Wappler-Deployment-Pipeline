'use strict';

/**
 * Traefik must be v3.6.1+ to talk to Docker Engine 29+ (minimum API 1.44).
 * Older images (e.g. v3.0) negotiate API 1.24 and Traefik serves 404 with no routes.
 * @see https://github.com/traefik/traefik/issues/12253
 */
const TRAEFIK_IMAGE = 'traefik:v3.6.7';

const DOCKER29_API_ERROR = 'client version 1.24 is too old';

/** @param {string} image e.g. traefik:v3.0, traefik:v3.6.7 */
function parseTraefikTag(image) {
  const m = String(image || '').trim().match(/traefik:v?(\d+)\.(\d+)(?:\.(\d+))?/i);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +(m[3] || 0) };
}

function isTraefikImageDocker29Compatible(image) {
  const t = parseTraefikTag(image);
  if (!t) return false;
  if (t.major > 3) return true;
  if (t.major < 3) return false;
  if (t.minor > 6) return true;
  if (t.minor < 6) return false;
  return t.patch >= 1;
}

/** Read traefik `image:` line from a compose YAML string. */
function extractTraefikImageFromCompose(yaml) {
  const m = String(yaml || '').match(/^\s{2}traefik:\s*\n(?:^[ \t].*\n)*?^[ \t]+image:\s*(\S+)/m);
  return m ? m[1] : null;
}

/** Replace any traefik image tag in compose text with TRAEFIK_IMAGE. */
function ensureTraefikImageInComposeYaml(yaml) {
  const text = String(yaml || '');
  const current = extractTraefikImageFromCompose(text);
  if (!current || current === TRAEFIK_IMAGE) {
    return { yaml: text, changed: false, previous: current };
  }
  const next = text.replace(
    /(^[ \t]{2}traefik:\s*\n(?:^[ \t].*\n)*?^[ \t]+image:\s*)\S+/m,
    `$1${TRAEFIK_IMAGE}`,
  );
  return { yaml: next, changed: next !== text, previous: current };
}

module.exports = {
  TRAEFIK_IMAGE,
  DOCKER29_API_ERROR,
  parseTraefikTag,
  isTraefikImageDocker29Compatible,
  extractTraefikImageFromCompose,
  ensureTraefikImageInComposeYaml,
};
