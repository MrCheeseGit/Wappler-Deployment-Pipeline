'use strict';

const { readConfig, writeConfig } = require('./configStore');
const { normalizeHostname } = require('./hostname');
const { formatDropletImage } = require('./dropletOs');

const DO_API = 'https://api.digitalocean.com/v2';

function doHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function requireDoToken(token) {
  const trimmed = typeof token === 'string' ? token.trim() : '';
  if (!trimmed) {
    const err = new Error(
      'DigitalOcean API token is not saved for this profile. Enter your token below or in Wizard Step 4, then save.'
    );
    err.status = 400;
    throw err;
  }
  return trimmed;
}

async function doFetch(token, path, options = {}) {
  const apiKey = requireDoToken(token);
  const res = await fetch(`${DO_API}${path}`, {
    ...options,
    headers: { ...doHeaders(apiKey), ...options.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    let msg = body.message || body.id || res.statusText || `HTTP ${res.status}`;
    if (typeof msg !== 'string') msg = JSON.stringify(msg);
    if (res.status === 401) {
      msg = 'DigitalOcean rejected the API token (invalid or revoked). Enter a valid token below or in Wizard Step 4.';
    }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return body;
}

function getGlobalDoApiKey(config) {
  return (config?.digitalOcean?.apiKey || '').trim();
}

/** Profile-specific key, else global Settings key. */
function resolveDoApiKey(config, profile) {
  const step4 = profile?.wizardConfig?.step4 || {};
  const profileKey = (profile?.doApiKey || step4.doApiKey || '').trim();
  if (profileKey) return profileKey;
  return getGlobalDoApiKey(config);
}

function hasProfileDoApiKey(profile) {
  const step4 = profile?.wizardConfig?.step4 || {};
  return Boolean((profile?.doApiKey || step4.doApiKey || '').trim());
}

function withResolvedDoApiKey(config, profile) {
  if (!profile) return profile;
  return { ...profile, doApiKey: resolveDoApiKey(config, profile) };
}

/**
 * Load profile + normalise DO-related fields from stored config.
 */
async function getProfileContext(profileName) {
  const config = await readConfig();
  const profile = config.profiles?.[profileName];
  if (!profile) {
    const err = new Error('Profile not found.');
    err.status = 404;
    throw err;
  }
  const wiz = profile.wizardConfig || {};
  const step4 = wiz.step4 || {};
  const step5 = wiz.step5 || {};
  const doApiKey = resolveDoApiKey(config, profile);

  return {
    profile,
    profileName,
    hostingTarget: profile.hostingTarget || step4.hostingTarget || '',
    doApiKey,
    hasProfileDoApiKey: hasProfileDoApiKey(profile),
    usesGlobalDoApiKey: Boolean(doApiKey) && !hasProfileDoApiKey(profile),
    doDropletId: profile.doDropletId || null,
    sshHost: profile.sshHost || step4.sshHost || '',
    domain: normalizeHostname(profile.domain || step5.addons?.traefik?.domain || ''),
    remotePath: profile.remotePath || step4.remotePath || '/root',
  };
}

async function saveDropletId(profileName, dropletId) {
  const config = await readConfig();
  if (!config.profiles?.[profileName]) return;
  config.profiles[profileName].doDropletId = dropletId;
  await writeConfig(config);
}

function publicIpv4(droplet) {
  const nets = droplet.networks?.v4 || [];
  const pub = nets.find(n => n.type === 'public');
  return pub?.ip_address || null;
}

function publicIpv6(droplet) {
  const v6 = droplet.networks?.v6 || [];
  const pub = v6.find(n => n.type === 'public');
  return pub?.ip_address || null;
}

function normaliseDroplet(d) {
  const created = d.created_at ? new Date(d.created_at) : null;
  let uptimeLabel = '—';
  if (created && d.status === 'active') {
    const ms = Date.now() - created.getTime();
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    uptimeLabel = days > 0 ? `${days}d ${hours}h since created` : `${hours}h since created`;
  }

  const image = formatDropletImage(d.image || {});

  return {
    id: d.id,
    name: d.name,
    status: d.status,
    ipv4: publicIpv4(d),
    ipv6: publicIpv6(d),
    region: d.region?.slug || d.region?.name || '—',
    sizeSlug: d.size_slug || d.size?.slug || '—',
    vcpus: d.vcpus ?? d.size?.vcpus ?? '—',
    memoryMb: d.memory ?? d.size?.memory ?? '—',
    diskGb: d.disk ?? d.size?.disk ?? '—',
    createdAt: d.created_at || null,
    uptimeLabel,
    tags: d.tags || [],
    volumeIds: d.volume_ids || [],
    imageSlug: image.imageSlug,
    imageName: image.imageName,
    imageLabel: image.imageLabel,
    hostOsWizard: image.wizardOs,
    hostArchWizard: image.wizardArch,
    imageDistribution: image.distribution,
  };
}

async function getDroplet(token, dropletId) {
  const { droplet } = await doFetch(token, `/droplets/${dropletId}`);
  return normaliseDroplet(droplet);
}

/** Rebuild an existing Droplet from a new base image (destructive — wipes the disk). */
async function rebuildDroplet(token, dropletId, imageSlug) {
  const body = await doFetch(token, `/droplets/${dropletId}/actions`, {
    method: 'POST',
    body: JSON.stringify({ type: 'rebuild', image: imageSlug }),
  });
  return body.action;
}

function normaliseSnapshot(s) {
  return {
    id: s.id,
    name: s.name || `snapshot-${s.id}`,
    createdAt: s.created_at || null,
    sizeGb: s.size_gigabytes ?? null,
    regions: s.regions || [],
    minDiskSize: s.min_disk_size ?? null,
  };
}

/** List snapshots created from a Droplet (newest first). */
async function listDropletSnapshots(token, dropletId) {
  const out = [];
  let page = 1;
  while (page <= 20) {
    const data = await doFetch(token, `/droplets/${dropletId}/snapshots?per_page=200&page=${page}`);
    for (const s of data.snapshots || []) {
      out.push(normaliseSnapshot(s));
    }
    if (!data.links?.pages?.next) break;
    page += 1;
  }
  return out.sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });
}

async function dropletAction(token, dropletId, body) {
  const res = await doFetch(token, `/droplets/${dropletId}/actions`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.action;
}

async function pollDropletStatus(token, dropletId, wantStatus, { log, timeoutMs = 8 * 60 * 1000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const d = await getDroplet(token, dropletId);
    if (d.status === wantStatus) return d;
    if (log) log(`[WDP] Droplet status ${d.status} — waiting for ${wantStatus}…`);
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error(`Timed out waiting for Droplet ${dropletId} to reach status "${wantStatus}".`);
}

/**
 * Create a Droplet snapshot. Optionally power off first (recommended by DO for consistency).
 * @returns {{ action: object, poweredOff: boolean }}
 */
async function createDropletSnapshot(token, dropletId, name, { powerOffFirst = false, log } = {}) {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    const err = new Error('Snapshot name is required.');
    err.status = 400;
    throw err;
  }

  let poweredOff = false;
  if (powerOffFirst) {
    const off = await dropletAction(token, dropletId, { type: 'power_off' });
    await waitForDropletAction(token, off.id, { log });
    await pollDropletStatus(token, dropletId, 'off', { log });
    poweredOff = true;
  }

  const action = await dropletAction(token, dropletId, { type: 'snapshot', name: trimmed });
  await waitForDropletAction(token, action.id, { log, timeoutMs: 30 * 60 * 1000 });

  if (poweredOff) {
    const on = await dropletAction(token, dropletId, { type: 'power_on' });
    await waitForDropletAction(token, on.id, { log });
    await pollDropletStatus(token, dropletId, 'active', { log });
  }

  return { action, poweredOff };
}

/** Restore this Droplet from a snapshot image (destructive — disk reverted to snapshot point). */
async function restoreDropletFromSnapshot(token, dropletId, imageId, { log } = {}) {
  const id = Number(imageId);
  if (!Number.isFinite(id) || id <= 0) {
    const err = new Error('Valid snapshot image ID is required.');
    err.status = 400;
    throw err;
  }
  const action = await dropletAction(token, dropletId, { type: 'restore', image: id });
  await waitForDropletAction(token, action.id, { log, timeoutMs: 30 * 60 * 1000 });
  await pollDropletStatus(token, dropletId, 'active', { log });
  return action;
}

/** Poll a Droplet action until completed or errored. */
async function waitForDropletAction(token, actionId, { log, timeoutMs = 20 * 60 * 1000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { action } = await doFetch(token, `/actions/${actionId}`);
    if (action.status === 'completed') return action;
    if (action.status === 'errored') {
      throw new Error(action.message || `Droplet action failed (${action.type || 'unknown'})`);
    }
    if (log) log(`[WDP] Droplet action in progress (${action.status})…`);
    await new Promise(r => setTimeout(r, 10000));
  }
  throw new Error(`Timed out waiting for Droplet action ${actionId}`);
}

async function findDropletByIp(token, ipAddress) {
  if (!ipAddress) return null;
  let page = 1;
  while (page <= 20) {
    const data = await doFetch(token, `/droplets?per_page=200&page=${page}`);
    for (const d of data.droplets || []) {
      if (publicIpv4(d) === ipAddress) return normaliseDroplet(d);
    }
    if (!data.links?.pages?.next) break;
    page += 1;
  }
  return null;
}

/** All Droplets in the account (paginated, normalised). */
async function listAccountDroplets(token) {
  const out = [];
  let page = 1;
  while (page <= 20) {
    const data = await doFetch(token, `/droplets?per_page=200&page=${page}`);
    for (const d of data.droplets || []) {
      out.push(normaliseDroplet(d));
    }
    if (!data.links?.pages?.next) break;
    page += 1;
  }
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/**
 * Link an existing DO Droplet to a profile — fills sshHost, doDropletId, region, size.
 */
async function importDropletToProfile(profileName, dropletId) {
  const config = await readConfig();
  const profile = config.profiles?.[profileName];
  if (!profile) {
    const err = new Error('Profile not found.');
    err.status = 404;
    throw err;
  }
  const apiKey = resolveDoApiKey(config, profile);
  const droplet = await getDroplet(apiKey, dropletId);
  if (!droplet.ipv4) {
    const err = new Error(
      `Droplet "${droplet.name}" has no public IPv4 yet (status: ${droplet.status}). Wait until it is active.`
    );
    err.status = 400;
    throw err;
  }

  profile.hostingTarget = 'digitalocean';
  profile.doMode = 'existing';
  profile.doDropletId = String(droplet.id);
  profile.sshHost = droplet.ipv4;
  profile.sshUser = profile.sshUser || profile.wizardConfig?.step4?.sshUser || 'root';
  if (droplet.region && droplet.region !== '—') profile.doRegion = droplet.region;
  if (droplet.sizeSlug && droplet.sizeSlug !== '—') profile.doSize = droplet.sizeSlug;
  profile.hostOsLabel = droplet.imageLabel || '';
  profile.hostOsSlug = droplet.imageSlug || '';
  profile.hostOsWizard = droplet.hostOsWizard || null;
  profile.hostArchWizard = droplet.hostArchWizard || null;

  if (profile.wizardConfig?.step4) {
    profile.wizardConfig.step4 = {
      ...profile.wizardConfig.step4,
      hostingTarget: 'digitalocean',
      doMode: 'existing',
      doDropletId: String(droplet.id),
      sshHost: droplet.ipv4,
      sshUser: profile.sshUser,
      doRegion: profile.doRegion || profile.wizardConfig.step4.doRegion,
      doSize: profile.doSize || profile.wizardConfig.step4.doSize,
      hostOsLabel: profile.hostOsLabel || '',
      hostOsSlug: profile.hostOsSlug || '',
      hostOsWizard: profile.hostOsWizard || '',
      hostArchWizard: profile.hostArchWizard || '',
    };
  }
  if (profile.wizardConfig?.step2) {
    if (droplet.hostOsWizard) profile.wizardConfig.step2.targetOS = droplet.hostOsWizard;
    if (droplet.hostArchWizard) profile.wizardConfig.step2.architecture = droplet.hostArchWizard;
  }

  profile.configUpdatedAt = new Date().toISOString();
  await writeConfig(config);
  return droplet;
}

async function resolveDroplet(ctx) {
  requireDoToken(ctx.doApiKey);
  const apiKey = ctx.doApiKey.trim();
  if (ctx.doDropletId) {
    try {
      return await getDroplet(apiKey, ctx.doDropletId);
    } catch (e) {
      if (e.status === 404) {
        // Stale ID — fall through to IP lookup
      } else {
        throw e;
      }
    }
  }
  if (ctx.sshHost) {
    const found = await findDropletByIp(apiKey, ctx.sshHost);
    if (found) return found;
  }
  return null;
}

// ── DNS ───────────────────────────────────────────────────────────────────────

async function listDomainRecords(token, domain) {
  const data = await doFetch(token, `/domains/${encodeURIComponent(domain)}/records?per_page=200`);
  return (data.domain_records || []).map(r => ({
    id: r.id,
    type: r.type,
    name: r.name,
    data: r.data,
    ttl: r.ttl,
    priority: r.priority ?? null,
    port: r.port ?? null,
    weight: r.weight ?? null,
    flags: r.flags ?? null,
  }));
}

async function createDomainRecord(token, domain, record) {
  const body = await doFetch(token, `/domains/${encodeURIComponent(domain)}/records`, {
    method: 'POST',
    body: JSON.stringify(record),
  });
  return body.domain_record;
}

async function updateDomainRecord(token, domain, recordId, record) {
  const body = await doFetch(token, `/domains/${encodeURIComponent(domain)}/records/${recordId}`, {
    method: 'PUT',
    body: JSON.stringify(record),
  });
  return body.domain_record;
}

async function deleteDomainRecord(token, domain, recordId) {
  await doFetch(token, `/domains/${encodeURIComponent(domain)}/records/${recordId}`, {
    method: 'DELETE',
  });
}

/**
 * Returns { needsFix, dropletIp, existingARecords, suggestedName }
 */
function analyseDnsForDroplet(records, domain, dropletIp) {
  const rootName = domain;
  const aRecords = records.filter(
    r => r.type === 'A' && (r.name === '@' || r.name === rootName || r.name === '' || r.name === domain.split('.')[0])
  );
  const matching = aRecords.filter(r => r.data === dropletIp);
  return {
    needsFix: Boolean(dropletIp && matching.length === 0),
    dropletIp,
    aRecords,
    matching,
    suggestedName: '@',
  };
}

async function saveDoApiKey(profileName, apiKey) {
  const trimmed = requireDoToken(apiKey);
  const config = await readConfig();
  if (!config.profiles?.[profileName]) {
    const err = new Error('Profile not found.');
    err.status = 404;
    throw err;
  }
  config.profiles[profileName].doApiKey = trimmed;
  if (config.profiles[profileName].wizardConfig?.step4) {
    config.profiles[profileName].wizardConfig.step4.doApiKey = trimmed;
  }
  await writeConfig(config);
}

module.exports = {
  getProfileContext,
  getGlobalDoApiKey,
  resolveDoApiKey,
  hasProfileDoApiKey,
  withResolvedDoApiKey,
  saveDropletId,
  saveDoApiKey,
  requireDoToken,
  resolveDroplet,
  getDroplet,
  rebuildDroplet,
  waitForDropletAction,
  listDropletSnapshots,
  createDropletSnapshot,
  restoreDropletFromSnapshot,
  dropletAction,
  findDropletByIp,
  listAccountDroplets,
  importDropletToProfile,
  normaliseDroplet,
  listDomainRecords,
  createDomainRecord,
  updateDomainRecord,
  deleteDomainRecord,
  analyseDnsForDroplet,
};
