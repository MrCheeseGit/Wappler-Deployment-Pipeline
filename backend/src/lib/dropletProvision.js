'use strict';

const fs = require('fs');
const path = require('path');
const { testConnection, exec: sshExec } = require('./ssh');
const { getDroplet, rebuildDroplet, waitForDropletAction } = require('./digitalocean');
const { readConfig, writeConfig } = require('./configStore');
const deployManager = require('./deployManager');

function archSlugFromWizard(architecture) {
  return architecture === 'arm64' ? 'aarch64' : 'x64';
}

/** Map wizard step2 targetOS + architecture → DigitalOcean image slug. */
function wizardOsToDoImageSlug(targetOS, architecture) {
  const archSlug = archSlugFromWizard(architecture);
  const OS_IMAGE_MAP = {
    'ubuntu-24.04': `ubuntu-24-04-${archSlug}`,
    'ubuntu-22.04': `ubuntu-22-04-${archSlug}`,
    'debian-12': `debian-12-${archSlug}`,
    alpine: `ubuntu-24-04-${archSlug}`,
  };
  return OS_IMAGE_MAP[targetOS] || `ubuntu-24-04-${archSlug}`;
}

const { buildDockerInstallBash } = require('./remoteDockerCheck');

async function resolveDoSshPrivateKey(deployId, deployManager, doApiKey, doSshKeyId) {
  const headers = {
    Authorization: `Bearer ${doApiKey}`,
    'Content-Type': 'application/json',
  };
  const keyId = String(doSshKeyId || '').trim();
  if (!keyId) {
    throw new Error('No DigitalOcean SSH key selected. Return to Step 4 and choose the key added to this Droplet.');
  }

  deployManager.log(deployId, '[WDP] Verifying SSH private key for Droplet access...');
  const keyRes = await fetch(`https://api.digitalocean.com/v2/account/keys/${keyId}`, { headers });
  if (!keyRes.ok) throw new Error(`DigitalOcean API ${keyRes.status} fetching SSH key details`);
  const { ssh_key } = await keyRes.json();
  deployManager.log(deployId, `[WDP] DO key: "${ssh_key.name}" (${ssh_key.fingerprint})`);

  const doParts = ssh_key.public_key.trim().split(/\s+/);
  const doKeyMaterial = `${doParts[0]} ${doParts[1]}`;

  const sshDirs = [];
  try {
    fs.readdirSync('/home').filter(d => !d.startsWith('.')).forEach(u => sshDirs.push(`/home/${u}/.ssh`));
  } catch { /* ignore */ }
  sshDirs.push('/root/.ssh');

  let resolvedKeyPath = null;
  outer: for (const dir of sshDirs) {
    try {
      for (const pubFile of fs.readdirSync(dir).filter(f => f.endsWith('.pub'))) {
        try {
          const content = fs.readFileSync(path.join(dir, pubFile), 'utf8').trim();
          const parts = content.split(/\s+/);
          const material = `${parts[0]} ${parts[1]}`;
          if (material === doKeyMaterial) {
            const privatePath = path.join(dir, pubFile.replace(/\.pub$/, ''));
            if (fs.existsSync(privatePath)) {
              resolvedKeyPath = privatePath;
              deployManager.log(deployId, `[WDP] ✓ Matched private key: ${privatePath}`);
              break outer;
            }
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  if (!resolvedKeyPath) {
    throw new Error(
      `Cannot find the private key for DO key "${ssh_key.name}". ` +
      'Ensure your home directory is mounted into the WDP container.',
    );
  }
  return resolvedKeyPath;
}

async function waitForSshReady(deployId, deployManager, sshCfg, timeoutMs = 8 * 60 * 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await testConnection(sshCfg);
      deployManager.log(deployId, '[WDP] ✓ SSH is available');
      return;
    } catch (err) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      deployManager.log(deployId, `[WDP] SSH not ready (${elapsed}s, ${err.message}) — retrying in 10s...`);
      await new Promise(r => setTimeout(r, 10000));
    }
  }
  throw new Error(`SSH on ${sshCfg.host} did not become available within ${Math.round(timeoutMs / 60000)} minutes.`);
}

async function installDockerOnHost(deployId, deployManager, sshCfg, targetOS) {
  const { installDockerViaSsh } = require('./remoteDockerCheck');
  await installDockerViaSsh(sshCfg, targetOS, (line) => deployManager.log(deployId, line));
}

async function waitForDockerReady(deployId, deployManager, sshCfg, timeoutMs = 12 * 60 * 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { code } = await sshExec(sshCfg, 'docker info > /dev/null 2>&1');
    if (code === 0) {
      deployManager.log(deployId, '[WDP] ✓ Docker is running');
      return;
    }
    const elapsed = Math.round((Date.now() - start) / 1000);
    deployManager.log(deployId, `[WDP] Waiting for Docker (${elapsed}s)...`);
    await new Promise(r => setTimeout(r, 15000));
  }
  throw new Error('Docker did not become ready on the rebuilt Droplet within 12 minutes.');
}

async function pollDropletActive(token, dropletId, deployId, deployManager, knownIp) {
  const start = Date.now();
  const timeoutMs = 10 * 60 * 1000;
  while (Date.now() - start < timeoutMs) {
    const d = await getDroplet(token, dropletId);
    if (d.status === 'active' && d.ipv4) {
      deployManager.log(deployId, `[WDP] ✓ Droplet active — IP: ${d.ipv4}`);
      return d;
    }
    const elapsed = Math.round((Date.now() - start) / 1000);
    deployManager.log(
      deployId,
      `[WDP] Waiting for Droplet to become active (${elapsed}s, status: ${d.status || 'unknown'})...`,
    );
    await new Promise(r => setTimeout(r, 8000));
  }
  throw new Error(
    `Droplet ${dropletId} did not become active after rebuild` +
    (knownIp ? ` (last known IP: ${knownIp})` : ''),
  );
}

async function persistHostOsAfterRebuild(profileName, droplet) {
  const config = await readConfig();
  const p = config.profiles?.[profileName];
  if (!p) return;
  p.hostOsLabel = droplet.imageLabel || '';
  p.hostOsSlug = droplet.imageSlug || '';
  p.hostOsWizard = droplet.hostOsWizard || null;
  p.hostArchWizard = droplet.hostArchWizard || null;
  p.sshHost = droplet.ipv4 || p.sshHost;
  if (p.wizardConfig?.step4) {
    p.wizardConfig.step4.hostOsLabel = p.hostOsLabel;
    p.wizardConfig.step4.hostOsSlug = p.hostOsSlug;
    p.wizardConfig.step4.hostOsWizard = p.hostOsWizard || '';
    p.wizardConfig.step4.hostArchWizard = p.hostArchWizard || '';
    p.wizardConfig.step4.sshHost = p.sshHost;
  }
  if (p.wizardConfig?.step2) {
    if (droplet.hostOsWizard) p.wizardConfig.step2.targetOS = droplet.hostOsWizard;
    if (droplet.hostArchWizard) p.wizardConfig.step2.architecture = droplet.hostArchWizard;
  }
  p.configUpdatedAt = new Date().toISOString();
  await writeConfig(config);
}

/**
 * Destructive: rebuild existing DO Droplet from a new image, reinstall Docker, return profile for SSH deploy.
 */
async function rebuildDropletAndPrepare(deployId, profile, profileName, options) {
  const { buildSshConfig } = require('./ssh');
  const targetOS = options.targetOS;
  const confirmDropletName = String(options.confirmDropletName || '').trim();
  const architecture = profile.step2?.architecture || 'x86_64';
  const doApiKey = profile.doApiKey;
  const dropletId = String(
    profile.doDropletId || profile.wizardConfig?.step4?.doDropletId || '',
  ).trim();

  if (!doApiKey) throw new Error('DigitalOcean API token is missing — return to Step 4.');
  if (!dropletId) throw new Error('No Droplet ID on this profile. Import or link a Droplet in Step 4.');
  if (!targetOS) throw new Error('targetOS is required for rebuild.');
  if (!options.acknowledgeDataLoss) {
    throw new Error('Rebuild aborted — data-loss acknowledgement is required.');
  }

  const droplet = await getDroplet(doApiKey, dropletId);
  if (!confirmDropletName || confirmDropletName !== droplet.name) {
    throw new Error(
      `Droplet name confirmation failed. Type exactly: ${droplet.name}`,
    );
  }

  const doImage = wizardOsToDoImageSlug(targetOS, architecture);
  if (targetOS === 'alpine') {
    deployManager.log(deployId, '[WDP] Warning: DigitalOcean has no Alpine images — rebuilding with Ubuntu 24.04 LTS.');
  }

  deployManager.log(deployId, '');
  deployManager.log(deployId, '╔══════════════════════════════════════════════════════════════════╗');
  deployManager.log(deployId, '║  DESTRUCTIVE: DIGITALOCEAN DROPLET REBUILD                       ║');
  deployManager.log(deployId, '╠══════════════════════════════════════════════════════════════════╣');
  deployManager.log(deployId, `║  Droplet: ${droplet.name} (${droplet.ipv4 || 'no IP yet'})`.padEnd(67) + '║');
  deployManager.log(deployId, `║  New image: ${doImage}`.padEnd(67) + '║');
  deployManager.log(deployId, '║  ALL DATA ON THIS DROPLET WILL BE PERMANENTLY DELETED.           ║');
  deployManager.log(deployId, '║  Apps, Docker images/volumes, databases, configs — everything.   ║');
  deployManager.log(deployId, '╚══════════════════════════════════════════════════════════════════╝');
  deployManager.log(deployId, '');

  const resolvedKeyPath = await resolveDoSshPrivateKey(
    deployId,
    deployManager,
    doApiKey,
    profile.doSshKeyId,
  );

  deployManager.log(deployId, `[WDP] Step 1/5 — Rebuilding Droplet from image ${doImage}...`);
  const action = await rebuildDroplet(doApiKey, dropletId, doImage);
  deployManager.log(deployId, `[WDP] Rebuild action started (ID: ${action.id}) — waiting for completion...`);
  await waitForDropletAction(doApiKey, action.id, {
    log: (line) => deployManager.log(deployId, line),
  });

  deployManager.log(deployId, '[WDP] Step 2/5 — Waiting for Droplet to become active...');
  const active = await pollDropletActive(doApiKey, dropletId, deployId, deployManager, droplet.ipv4);
  const ipAddress = active.ipv4;
  if (!ipAddress) throw new Error('Rebuilt Droplet has no public IPv4 address.');

  const sshUser = profile.sshUser || profile.wizardConfig?.step4?.sshUser || 'root';
  const sshCfg = buildSshConfig({ sshHost: ipAddress, sshUser, sshKeyPath: resolvedKeyPath });

  deployManager.log(deployId, '[WDP] Step 3/5 — Waiting for SSH...');
  await waitForSshReady(deployId, deployManager, sshCfg);

  deployManager.log(deployId, '[WDP] Step 4/5 — Installing Docker (rebuild cannot use cloud-init user_data)...');
  await installDockerOnHost(deployId, deployManager, sshCfg, targetOS === 'alpine' ? 'ubuntu-24.04' : targetOS);
  await waitForDockerReady(deployId, deployManager, sshCfg);

  deployManager.log(deployId, '[WDP] Step 5/5 — Updating profile with new host OS...');
  const refreshed = await getDroplet(doApiKey, dropletId);
  await persistHostOsAfterRebuild(profileName, refreshed);
  deployManager.log(deployId, `[WDP] ✓ Rebuild complete — host OS: ${refreshed.imageLabel || doImage}`);
  deployManager.log(deployId, '');

  return {
    ...profile,
    sshHost: ipAddress,
    sshKeyPath: resolvedKeyPath,
    doMode: 'existing',
    doDropletId: dropletId,
    step2: {
      ...profile.step2,
      targetOS: refreshed.hostOsWizard || targetOS,
      architecture: refreshed.hostArchWizard || architecture,
    },
  };
}

module.exports = {
  wizardOsToDoImageSlug,
  buildDockerInstallBash,
  rebuildDropletAndPrepare,
};
