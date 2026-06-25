'use strict';

const { normalizeHostname } = require('./hostname');

/**
 * Apex + www host pair for Traefik TLS and routing.
 * @param {string} rawDomain — user-entered domain (Step 5)
 * @returns {{ primary: string, alternate: string|null }}
 */
function resolveDomainPair(rawDomain) {
  const primary = normalizeHostname(rawDomain) || 'your-domain.com';
  if (primary.startsWith('www.')) {
    const apex = primary.slice(4);
    return { primary, alternate: apex || null };
  }
  return { primary, alternate: `www.${primary}` };
}

/**
 * Traefik Host() rule for one or two hostnames (compose uses ${DOMAIN} / ${TRAEFIK_ALT_HOST}).
 * @param {boolean} [includeWww=true]
 */
function traefikHostRuleEnv(includeWww = true) {
  if (includeWww === false) {
    return 'Host(`${DOMAIN}`)';
  }
  return 'Host(`${DOMAIN}`) || Host(`${TRAEFIK_ALT_HOST}`)';
}

/**
 * Env lines for .env.deploy (DOMAIN always; TRAEFIK_ALT_HOST when www pair enabled).
 */
function traefikDomainEnvLines(rawDomain, includeWww = true) {
  const { primary, alternate } = resolveDomainPair(rawDomain);
  const lines = [`DOMAIN=${primary}`];
  if (includeWww !== false && alternate) {
    lines.push(`TRAEFIK_ALT_HOST=${alternate}`);
  }
  return { primary, alternate: includeWww !== false ? alternate : null, lines };
}

module.exports = {
  resolveDomainPair,
  traefikHostRuleEnv,
  traefikDomainEnvLines,
};
