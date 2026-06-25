'use strict';

const fs = require('fs').promises;
const path = require('path');

function hostHomeFromPath(safePath) {
  const homeMatch = safePath.match(/^(\/home\/[^/]+)/);
  if (homeMatch) return homeMatch[1];
  const usersMatch = safePath.match(/^(\/Users\/[^/]+)/);
  if (usersMatch) return usersMatch[1];
  return process.env.HOME || '/root';
}

function expandHome(p, hostHome) {
  return String(p || '').replace(/^~/, hostHome);
}

function slugifyProfile(name) {
  return String(name || 'production')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * digitalocean only when this target's IP is a server on a cloud provider entry — not
 * because another DO target exists in the same project.json.
 */
function inferHostingTarget(target, providers) {
  const host = target.dockerHost;
  const serverLabel = (target.dockerServerName || target.name || '').toLowerCase();

  if (serverLabel.includes('digitalocean') || serverLabel.includes('digital ocean')) {
    for (const provider of Object.values(providers)) {
      const servers = Object.values(provider.server || {});
      if (servers.some((s) => s.ip_address === host) && provider['provider-api-key']) {
        return 'digitalocean';
      }
    }
  }

  for (const provider of Object.values(providers)) {
    const servers = Object.values(provider.server || {});
    const match = servers.find((s) => s.ip_address === host);
    if (match && provider['provider-api-key']) {
      return 'digitalocean';
    }
  }

  return 'vps';
}

function resolveSshUser(target, providers) {
  const direct = target.dockerUser || target.sshUser || target.dockerSshUser
    || target.remoteUser || target.dockerSshUsername;
  if (direct) return String(direct).trim();

  for (const provider of Object.values(providers)) {
    const servers = Object.values(provider.server || {});
    const match = servers.find((s) => s.ip_address === target.dockerHost);
    if (match) {
      const u = match.user || match.ssh_user || match.login || match.sshUser;
      if (u) return String(u).trim();
    }
  }
  return 'root';
}

function pickWapplerKeyPath(providers, expandHomeFn) {
  for (const provider of Object.values(providers)) {
    const sshKeys = Object.values(provider.ssh_key || {});
    const best = sshKeys.find((k) => k.name !== 'key_1' && k['ssh-key-file']) || sshKeys[0];
    if (best?.['ssh-key-file']) {
      return expandHomeFn(best['ssh-key-file'].replace(/\.pub$/, ''));
    }
    if (provider['ssh-key-file']) {
      return expandHomeFn(String(provider['ssh-key-file']).replace(/\.pub$/, ''));
    }
  }
  return '';
}

async function resolveSshKeyPath(wapplerKeyPath, hostHome) {
  const candidates = [];
  if (wapplerKeyPath) candidates.push(wapplerKeyPath);
  for (const name of ['id_ed25519', 'id_rsa', 'id_ecdsa']) {
    candidates.push(path.join(hostHome, '.ssh', name));
  }

  const seen = new Set();
  for (const raw of candidates) {
    const expanded = expandHome(raw, hostHome);
    const resolved = path.resolve(expanded);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    try {
      await fs.access(resolved);
      const display = raw.startsWith(hostHome) ? raw.replace(hostHome, '~') : raw;
      return {
        sshKeyPath: display.includes('~') ? display : expanded,
        sshKeyFound: true,
        sshKeySource: resolved.includes(`${path.sep}.wappler${path.sep}`) ? 'wappler' : 'os',
      };
    } catch { /* try next */ }
  }

  const fallback = wapplerKeyPath || path.join(hostHome, '.ssh', 'id_ed25519');
  const displayFallback = fallback.replace(hostHome, '~');
  return {
    sshKeyPath: displayFallback,
    sshKeyFound: false,
    sshKeySource: 'default',
  };
}

/**
 * @param {string} safePath — resolved absolute path to project.json
 * @param {object} proj — parsed JSON
 */
async function parseWapplerProjectJson(safePath, proj) {
  const remoteTargets = (proj.targets || []).filter(
    (t) => t.dockerHost && t.dockerProtocol === 'ssh' && t.name !== 'Development',
  );

  if (remoteTargets.length === 0) {
    const err = new Error('No remote SSH targets found in this project.json.');
    err.status = 422;
    throw err;
  }

  const hostHome = hostHomeFromPath(safePath);
  const expandHomeFn = (p) => expandHome(p, hostHome);
  const providers = proj.resources?.providers || {};

  const wapplerKeyPath = pickWapplerKeyPath(providers, expandHomeFn);
  const keyDefault = await resolveSshKeyPath(wapplerKeyPath, hostHome);

  let doApiKey = '';
  let doSshKeyId = '';
  for (const provider of Object.values(providers)) {
    if (provider['provider-api-key'] && !doApiKey) {
      doApiKey = provider['provider-api-key'];
      const sshKeys = Object.values(provider.ssh_key || {});
      const best = sshKeys.find((k) => k.name !== 'key_1' && k['ssh-key-file']) || sshKeys[0];
      doSshKeyId = String(provider['ssh-key-id'] || best?.id || '');
    }
  }

  const targets = [];
  for (const t of remoteTargets) {
    const perTargetKey = await resolveSshKeyPath(wapplerKeyPath, hostHome);
    targets.push({
      name: t.dockerServerName || t.name || 'production',
      slug: slugifyProfile(t.dockerServerName || t.name),
      hostingTarget: inferHostingTarget(t, providers),
      sshHost: t.dockerHost,
      sshUser: resolveSshUser(t, providers),
      sshKeyPath: perTargetKey.sshKeyPath,
      sshKeyFound: perTargetKey.sshKeyFound,
      sshKeySource: perTargetKey.sshKeySource,
      appPort: t.webServerPort || 3000,
      dockerServerName: t.dockerServerName || '',
    });
  }

  return {
    projectName: proj.projectName || '',
    targets,
    doApiKey,
    doSshKeyId,
    sshKeyFound: keyDefault.sshKeyFound,
    sshKeySource: keyDefault.sshKeySource,
  };
}

module.exports = {
  parseWapplerProjectJson,
  inferHostingTarget,
  resolveSshUser,
  hostHomeFromPath,
};
