'use strict';

/**
 * Traefik deployment mode helpers (bundled stack vs existing server Traefik).
 */

/** @param {object|undefined} traefikCfg — step5.addons.traefik */
function isExternalTraefik(traefikCfg) {
  if (!traefikCfg?.enabled) return false;
  if (traefikCfg.traefikMode === 'external') return true;
  if (traefikCfg.useExistingTraefik === true) return true;
  return false;
}

/** @param {object|undefined} traefikCfg */
function isBundledTraefik(traefikCfg) {
  return Boolean(traefikCfg?.enabled) && !isExternalTraefik(traefikCfg);
}

/** @param {object|undefined} traefikCfg */
function getTraefikNetwork(traefikCfg) {
  const raw = String(traefikCfg?.network || 'traefik-public').trim();
  return sanitizeDockerNetworkName(raw || 'traefik-public');
}

function sanitizeDockerNetworkName(name) {
  const cleaned = String(name || '')
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, '');
  return cleaned || 'traefik-public';
}

/**
 * Host ports WDP may stop before compose up (SSH deploy).
 * @param {object} profile
 * @param {string} composeYaml
 */
function resolveDeployHostPorts(profile, composeYaml) {
  const traefik = profile.wizardConfig?.step5?.addons?.traefik;
  const yaml = String(composeYaml || '');

  if (traefik?.enabled) {
    if (isExternalTraefik(traefik)) {
      return yaml.includes('3000:3000') ? [3000] : [];
    }
    if (extractTraefikServiceInCompose(yaml)) {
      const ports = [80, 443];
      if (yaml.includes('3000:3000')) ports.push(3000);
      return ports;
    }
  }

  return yaml.includes('3000:3000') ? [3000] : [];
}

function extractTraefikServiceInCompose(yaml) {
  return /^\s*traefik:\s*$/m.test(String(yaml || ''));
}

module.exports = {
  isExternalTraefik,
  isBundledTraefik,
  getTraefikNetwork,
  sanitizeDockerNetworkName,
  resolveDeployHostPorts,
  extractTraefikServiceInCompose,
};
