'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const { readConfig, writeConfig } = require('../lib/configStore');
const {
  evaluateProfileStale,
  latestGeneratedFileMtime,
  missingGeneratedFiles,
  wizardConfigFingerprint,
  generateRelevantWizardFingerprint,
  resolveFingerprintAtGenerate,
} = require('../lib/profileGeneratedFiles');
const { normalizeHostname } = require('../lib/hostname');
const { parseWapplerProjectJson } = require('../lib/importWappler');
const {
  getGlobalDoApiKey,
  resolveDoApiKey,
  listAccountDroplets,
  importDropletToProfile,
  getDroplet,
  findDropletByIp,
} = require('../lib/digitalocean');
const { buildSshConfig, testConnection } = require('../lib/ssh');
const deployManager = require('../lib/deployManager');
const { inspectRemoteDocker, installDockerViaSsh, TROUBLESHOOTING_DOC } = require('../lib/remoteDockerCheck');
const { inspectRemoteRedis } = require('../lib/remoteRedisCheck');
const clicksend = require('../lib/clicksend');
const { buildMessage, SUPPORTED } = require('../lib/clicksendMessages');
const { profilesSharingProjectPath } = require('../lib/projectPathGuards');

/** Align wizard step4 ↔ top-level profile fields (provision/deploy vs wizard). */
function enrichProfiles(config) {
  for (const p of Object.values(config.profiles || {})) {
    const s4 = p?.wizardConfig?.step4;
    if (!s4) continue;

    // Wizard save historically kept doSshKeyId only in step4 — promote to profile root for deploy.
    if (!String(p.doSshKeyId || '').trim() && String(s4.doSshKeyId || '').trim()) {
      p.doSshKeyId = String(s4.doSshKeyId).trim();
    }
    if (!p.doMode && s4.doMode) p.doMode = s4.doMode;
    if (!p.hostingTarget && s4.hostingTarget) p.hostingTarget = s4.hostingTarget;

    if (p.domain) {
      const clean = normalizeHostname(p.domain);
      if (clean !== p.domain) p.domain = clean;
    }
    const traefikDomain = p.wizardConfig?.step5?.addons?.traefik?.domain;
    if (traefikDomain) {
      const clean = normalizeHostname(traefikDomain);
      if (clean !== traefikDomain) {
        p.wizardConfig.step5.addons.traefik.domain = clean;
      }
    }

    if (!p?.sshHost) continue;
    const stale = !s4.sshHost || (p.doMode === 'existing' && s4.doMode === 'provision');
    if (!stale) continue;
    p.wizardConfig.step4 = {
      ...s4,
      hostingTarget: p.hostingTarget || s4.hostingTarget || 'digitalocean',
      sshHost:       p.sshHost,
      sshKeyPath:    p.sshKeyPath || s4.sshKeyPath,
      sshUser:       p.sshUser    || s4.sshUser    || 'root',
      remotePath:    p.remotePath || s4.remotePath,
      doMode:        'existing',
    };
  }
  return config;
}

function safeConfigResponse(config) {
  const { auth, digitalOcean, clickSend, ...rest } = config;
  const cs = clickSend || {};
  return {
    ...rest,
    digitalOcean: { hasKey: Boolean(digitalOcean?.apiKey) },
    clickSend: {
      hasCredentials: clicksend.hasCredentials(cs),
      username: cs.username || '',
      onSuccess: cs.onSuccess !== false,
      onFailure: cs.onFailure !== false,
      onRollback: cs.onRollback !== false,
    },
  };
}

// GET /api/config
// Returns the project config, with secrets redacted.
router.get('/', async (req, res) => {
  try {
    const config = enrichProfiles(await readConfig());
    res.json(safeConfigResponse(config));
  } catch (err) {
    res.status(500).json({ message: 'Failed to read configuration.' });
  }
});

// POST /api/config
// Saves the project config, preserving the existing auth block.
router.post('/', async (req, res) => {
  try {
    const existing = await readConfig();
    const updated = {
      ...req.body,
      auth: existing.auth,
      digitalOcean: existing.digitalOcean,
      clickSend: existing.clickSend,
    };
    await writeConfig(updated);
    res.json(safeConfigResponse(updated));
  } catch (err) {
    res.status(500).json({ message: 'Failed to save configuration.' });
  }
});

// POST /api/config/validate-path
// Checks that a given directory contains a package.json and returns basic metadata.
router.post('/validate-path', async (req, res) => {
  const { projectPath } = req.body;

  if (!projectPath || typeof projectPath !== 'string') {
    return res.status(400).json({ valid: false, message: 'No path provided.' });
  }

  // Resolve the path to an absolute form to prevent directory traversal
  const resolved = path.resolve(projectPath);

  try {
    const pkgPath = path.join(resolved, 'package.json');
    await fs.access(pkgPath);
    const raw = await fs.readFile(pkgPath, 'utf8');
    const pkg = JSON.parse(raw);
    res.json({
      valid: true,
      name: pkg.name || null,
      version: pkg.version || null,
      nodeVersion: (pkg.engines && pkg.engines.node) || null
    });
  } catch {
    res.status(400).json({ valid: false, message: 'No package.json found at that path.' });
  }
});

// GET /api/config/docker-host — how WDP reaches Docker (Wappler coexistence diagnostics)
router.get('/docker-host', async (req, res) => {
  const { describeDockerMode, probeDockerApi, wapplerCoexistenceHint } = require('../lib/dockerHost');
  const mode = describeDockerMode();
  const probe = await probeDockerApi();
  res.json({
    ...mode,
    probe,
    hint: wapplerCoexistenceHint(),
  });
});

// POST /api/config/test-ssh
// Tests SSH connectivity with the supplied credentials.
router.post('/test-ssh', async (req, res) => {
  const { sshHost, sshUser, sshKeyPath, sshPort } = req.body;
  if (!sshHost || !sshKeyPath) {
    return res.status(400).json({ ok: false, message: 'sshHost and sshKeyPath are required.' });
  }
  try {
    const cfg = buildSshConfig({ sshHost, sshUser: sshUser || 'root', sshKeyPath, sshPort });
    await testConnection(cfg);
    res.json({ ok: true, message: `Connected to ${sshUser || 'root'}@${sshHost} successfully.` });
  } catch (err) {
    res.json({ ok: false, message: err.message });
  }
});

// POST /api/config/test-do-api
// Validates a DigitalOcean personal access token against the DO API.
// Empty apiKey uses the global token from Settings → DigitalOcean.
router.post('/test-do-api', async (req, res) => {
  let token = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
  if (!token) {
    try {
      const config = await readConfig();
      token = (config.digitalOcean?.apiKey || '').trim();
    } catch { /* ignore */ }
  }
  if (!token) {
    return res.status(400).json({
      ok: false,
      message: 'API key is required. Add one in Settings → DigitalOcean or enter a token here.',
    });
  }
  try {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const accountRes = await fetch('https://api.digitalocean.com/v2/account', { headers });
    if (!accountRes.ok) {
      return res.json({
        ok: false,
        message: accountRes.status === 401
          ? 'Invalid token — authentication failed.'
          : `DO API returned HTTP ${accountRes.status}.`
      });
    }
    const accountData = await accountRes.json();
    const email = accountData.account?.email || 'unknown';

    // Also fetch SSH keys registered on the account
    const keysRes  = await fetch('https://api.digitalocean.com/v2/account/keys?per_page=200', { headers });
    const keysData = keysRes.ok ? await keysRes.json() : {};
    const sshKeys  = (keysData.ssh_keys || []).map(k => ({
      id:          String(k.id),
      name:        k.name,
      fingerprint: k.fingerprint
    }));

    return res.json({ ok: true, message: `Authenticated as ${email}`, sshKeys });
  } catch (err) {
    res.json({ ok: false, message: `Request failed: ${err.message}` });
  }
});

// POST /api/config/import-wappler
// Parses a Wappler .wappler/project.json and returns wizard-compatible field values.
router.post('/import-wappler', async (req, res) => {
  const { filePath: rawPath } = req.body;
  if (!rawPath) return res.status(400).json({ error: 'filePath is required.' });

  const resolved = rawPath.replace(/^~/, process.env.HOME || '/root');
  const safePath = path.resolve(resolved);

  let raw;
  try {
    raw = await fs.readFile(safePath, 'utf8');
  } catch {
    return res.status(400).json({ error: `Cannot read file: ${safePath}` });
  }

  let proj;
  try { proj = JSON.parse(raw); } catch {
    return res.status(400).json({ error: 'File is not valid JSON.' });
  }

  try {
    const result = await parseWapplerProjectJson(safePath, proj);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});


// ── ClickSend SMS ─────────────────────────────────────────────────────────────

router.get('/clicksend', async (req, res) => {
  try {
    const config = await readConfig();
    const cs = config.clickSend || {};
    res.json({
      hasCredentials: clicksend.hasCredentials(cs),
      username: cs.username || '',
      onSuccess: cs.onSuccess !== false,
      onFailure: cs.onFailure !== false,
      onRollback: cs.onRollback !== false,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

function parseClickSendFlag(value, existingValue, defaultValue = true) {
  if (typeof value === 'boolean') return value;
  if (typeof existingValue === 'boolean') return existingValue;
  return defaultValue;
}

router.post('/clicksend/notifications', async (req, res) => {
  try {
    const { onSuccess, onFailure, onRollback } = req.body || {};
    const config = await readConfig();
    if (!config.clickSend) config.clickSend = {};
    const existing = config.clickSend;
    if (typeof onSuccess === 'boolean')  existing.onSuccess  = onSuccess;
    if (typeof onFailure === 'boolean')  existing.onFailure  = onFailure;
    if (typeof onRollback === 'boolean') existing.onRollback = onRollback;
    await writeConfig(config);
    res.json({
      ok: true,
      onSuccess:  existing.onSuccess !== false,
      onFailure:  existing.onFailure !== false,
      onRollback: existing.onRollback !== false,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/clicksend', async (req, res) => {
  try {
    const { username, apiKey, onSuccess, onFailure, onRollback } = req.body || {};
    const config = await readConfig();
    const existing = config.clickSend || {};
    const nextUser = typeof username === 'string' && username.trim()
      ? username.trim()
      : (existing.username || '');
    const nextKey = typeof apiKey === 'string' && apiKey.trim()
      ? apiKey.trim()
      : (existing.apiKey || '');
    if (!nextUser || !nextKey) {
      return res.status(400).json({ message: 'ClickSend username and API key are required.' });
    }
    config.clickSend = {
      username: nextUser,
      apiKey: nextKey,
      onSuccess:  parseClickSendFlag(onSuccess, existing.onSuccess),
      onFailure:  parseClickSendFlag(onFailure, existing.onFailure),
      onRollback: parseClickSendFlag(onRollback, existing.onRollback),
    };
    await writeConfig(config);
    res.json({
      ok: true,
      hasCredentials: true,
      username: config.clickSend.username,
      onSuccess: config.clickSend.onSuccess,
      onFailure: config.clickSend.onFailure,
      onRollback: config.clickSend.onRollback,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/clicksend/credentials', async (req, res) => {
  try {
    const config = await readConfig();
    if (config.clickSend) {
      delete config.clickSend.username;
      delete config.clickSend.apiKey;
    }
    await writeConfig(config);
    res.json({ ok: true, hasCredentials: false });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/clicksend/test', async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ message: 'Not authenticated.' });
  }
  try {
    const config = await readConfig();
    if (!clicksend.hasCredentials(config.clickSend)) {
      return res.status(400).json({ message: 'Save ClickSend credentials before testing.' });
    }
    const auth = config.auth || {};
    const to = clicksend.formatE164(auth.dialingCode, auth.mobile);
    if (!to) {
      return res.status(400).json({
        message: 'Add your mobile number and dialling code on My Profile before sending a test SMS.',
      });
    }
    const locale = SUPPORTED.includes(req.body?.locale) ? req.body.locale : (auth.locale || 'en');
    const body = buildMessage('test', locale, {});
    await clicksend.sendSms(config.clickSend, to, body);
    res.json({ ok: true, message: `Test SMS sent to ${to}.` });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ── GET /api/config/digitalocean ──────────────────────────────────────────────
router.get('/digitalocean', async (req, res) => {
  try {
    const config = await readConfig();
    res.json({ hasKey: Boolean(config.digitalOcean?.apiKey) });
  } catch (err) {
    res.status(500).json({ message: 'Failed to read configuration.' });
  }
});

// ── POST /api/config/digitalocean ─────────────────────────────────────────────
router.post('/digitalocean', async (req, res) => {
  const { apiKey } = req.body || {};
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    return res.status(400).json({ ok: false, message: 'API key is required.' });
  }
  const trimmed = apiKey.trim();
  try {
    const headers = { Authorization: `Bearer ${trimmed}`, 'Content-Type': 'application/json' };
    const accountRes = await fetch('https://api.digitalocean.com/v2/account', { headers });
    if (!accountRes.ok) {
      const msg = accountRes.status === 401
        ? 'Invalid token — DigitalOcean authentication failed.'
        : `DigitalOcean API returned HTTP ${accountRes.status}.`;
      return res.json({ ok: false, message: msg });
    }
    const accountData = await accountRes.json();
    const config = await readConfig();
    config.digitalOcean = config.digitalOcean || {};
    config.digitalOcean.apiKey = trimmed;
    await writeConfig(config);
    res.json({
      ok: true,
      hasKey: true,
      message: `Authenticated as ${accountData.account?.email || 'your account'}.`,
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── DELETE /api/config/digitalocean ───────────────────────────────────────────
router.delete('/digitalocean', async (req, res) => {
  try {
    const config = await readConfig();
    if (config.digitalOcean) delete config.digitalOcean.apiKey;
    await writeConfig(config);
    res.json({ ok: true, hasKey: false });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/config/digitalocean/droplets — list account Droplets (wizard + dashboard)
// Query: ?profile=name and/or ?apiKey=dop_v1_… (else global Settings token)
router.get('/digitalocean/droplets', async (req, res) => {
  try {
    const config = await readConfig();
    let token = typeof req.query.apiKey === 'string' ? req.query.apiKey.trim() : '';
    const profileName = req.query.profile;
    if (!token && profileName && config.profiles?.[profileName]) {
      token = resolveDoApiKey(config, config.profiles[profileName]);
    }
    if (!token) token = getGlobalDoApiKey(config);
    if (!token) {
      return res.status(400).json({
        message: 'DigitalOcean API token required. Add one in Settings → DigitalOcean or Wizard Step 4.',
      });
    }
    const droplets = await listAccountDroplets(token);
    res.json({ droplets });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// GET /api/config/digitalocean/host-os — image/OS for an existing Droplet (by id or public IP)
router.get('/digitalocean/host-os', async (req, res) => {
  try {
    const config = await readConfig();
    let token = typeof req.query.apiKey === 'string' ? req.query.apiKey.trim() : '';
    const profileName = req.query.profile;
    if (!token && profileName && config.profiles?.[profileName]) {
      token = resolveDoApiKey(config, config.profiles[profileName]);
    }
    if (!token) token = getGlobalDoApiKey(config);
    if (!token) {
      return res.status(400).json({
        message: 'DigitalOcean API token required to look up Droplet OS.',
      });
    }

    const dropletId = req.query.dropletId != null ? String(req.query.dropletId).trim() : '';
    const sshHost = typeof req.query.sshHost === 'string' ? req.query.sshHost.trim() : '';

    let droplet = null;
    if (dropletId) {
      droplet = await getDroplet(token, dropletId);
    } else if (sshHost) {
      droplet = await findDropletByIp(token, sshHost);
    } else if (profileName && config.profiles?.[profileName]) {
      const p = config.profiles[profileName];
      const id = p.doDropletId || p.wizardConfig?.step4?.doDropletId;
      const ip = p.sshHost || p.wizardConfig?.step4?.sshHost;
      if (id) droplet = await getDroplet(token, id);
      else if (ip) droplet = await findDropletByIp(token, ip);
    }

    if (!droplet) {
      return res.status(404).json({
        message: 'No matching DigitalOcean Droplet found. Import a Droplet or check the SSH host IP.',
      });
    }

    if (profileName && config.profiles?.[profileName]) {
      const p = config.profiles[profileName];
      p.hostOsLabel = droplet.imageLabel || '';
      p.hostOsSlug = droplet.imageSlug || '';
      p.hostOsWizard = droplet.hostOsWizard || null;
      p.hostArchWizard = droplet.hostArchWizard || null;
      if (p.wizardConfig?.step4) {
        p.wizardConfig.step4.hostOsLabel = p.hostOsLabel;
        p.wizardConfig.step4.hostOsSlug = p.hostOsSlug;
        p.wizardConfig.step4.hostOsWizard = p.hostOsWizard || '';
        p.wizardConfig.step4.hostArchWizard = p.hostArchWizard || '';
      }
      if (p.wizardConfig?.step2 && droplet.hostArchWizard) {
        p.wizardConfig.step2.architecture = droplet.hostArchWizard;
      }
      if (p.wizardConfig?.step2 && droplet.hostOsWizard) {
        p.wizardConfig.step2.targetOS = droplet.hostOsWizard;
      }
      await writeConfig(config);
    }

    res.json({
      ok: true,
      droplet: {
        id: droplet.id,
        name: droplet.name,
        ipv4: droplet.ipv4,
        imageLabel: droplet.imageLabel,
        imageSlug: droplet.imageSlug,
        hostOsWizard: droplet.hostOsWizard,
        hostArchWizard: droplet.hostArchWizard,
      },
    });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// POST /api/config/profiles/:profile/import-droplet
router.post('/profiles/:profile/import-droplet', async (req, res) => {
  const profile = req.params.profile;
  if (!validateProfileName(profile)) {
    return res.status(400).json({ error: 'Invalid profile name.' });
  }
  const dropletId = req.body?.dropletId;
  if (dropletId == null || dropletId === '') {
    return res.status(400).json({ message: 'dropletId is required.' });
  }
  try {
    const droplet = await importDropletToProfile(profile, dropletId);
    res.json({ ok: true, droplet, message: `Linked Droplet "${droplet.name}" (${droplet.ipv4}).` });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

function validateProfileName(profile) {
  return profile && path.basename(profile) === profile && !profile.includes('..');
}

// GET /api/config/profiles/:profile/stale
router.get('/profiles/:profile/stale', async (req, res) => {
  const profile = req.params.profile;
  if (!validateProfileName(profile)) {
    return res.status(400).json({ error: 'Invalid profile name.' });
  }
  try {
    const config = await readConfig();
    const data = config.profiles?.[profile];
    if (!data) return res.status(404).json({ error: `Profile "${profile}" not found.` });
    const inferred = latestGeneratedFileMtime(data.projectPath, profile);
    let healed = false;
    if (!data.generatedAt && inferred) {
      config.profiles[profile].generatedAt = inferred;
      data.generatedAt = inferred;
      healed = true;
    }
    const missing = missingGeneratedFiles(data.projectPath, profile);
    if (
      !data.wizardFingerprintAtGenerate
      && missing.length === 0
      && inferred
      && data.configUpdatedAt
      && Date.parse(data.configUpdatedAt) > Date.parse(inferred) + 500
    ) {
      const fp = generateRelevantWizardFingerprint(data.wizardConfig);
      config.profiles[profile].wizardFingerprintAtGenerate = fp;
      config.profiles[profile].configUpdatedAt = inferred;
      data.wizardFingerprintAtGenerate = fp;
      data.configUpdatedAt = inferred;
      healed = true;
    }
    const fpNow = generateRelevantWizardFingerprint(data.wizardConfig);
    const fpAtGen = resolveFingerprintAtGenerate(data.wizardFingerprintAtGenerate || '');
    if (fpAtGen && fpNow === fpAtGen && data.wizardFingerprintAtGenerate !== fpNow) {
      config.profiles[profile].wizardFingerprintAtGenerate = fpNow;
      data.wizardFingerprintAtGenerate = fpNow;
      healed = true;
    }
    if (healed) await writeConfig(config);
    res.json({ profile, ...evaluateProfileStale(data, profile) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/config/profiles/:profile/wizard
// Persists wizard edits and marks config newer than last file generation.
router.post('/profiles/:profile/wizard', async (req, res) => {
  const profile = req.params.profile;
  if (!validateProfileName(profile)) {
    return res.status(400).json({ error: 'Invalid profile name.' });
  }
  const wizardConfig = req.body?.wizardConfig;
  if (!wizardConfig || typeof wizardConfig !== 'object') {
    return res.status(400).json({ error: 'wizardConfig is required.' });
  }

  const addons = wizardConfig.step5?.addons;
  if (addons?.traefik?.domain) {
    addons.traefik.domain = normalizeHostname(addons.traefik.domain);
  }
  if (addons?.plausible?.domain) {
    addons.plausible.domain = normalizeHostname(addons.plausible.domain);
  }

  try {
    const config = await readConfig();
    const existing = config.profiles?.[profile];
    if (!existing) return res.status(404).json({ error: `Profile "${profile}" not found.` });

    const step1 = wizardConfig.step1 || {};
    const step4 = wizardConfig.step4 || {};
    const nextPath = (step1.projectPath || existing.projectPath || '').trim();
    if (nextPath) {
      const hostingTarget = (step4.hostingTarget || existing.hostingTarget || '').trim();
      const shared = profilesSharingProjectPath(config, nextPath, profile, { hostingTarget });
      if (shared.length) {
        return res.status(409).json({
          error: `Project path is already used by another ${hostingTarget || 'deployment'} profile: ${shared.join(', ')}. Use a different profile name, hosting target, or project folder.`,
          sharedWith: shared,
          projectPath: path.resolve(nextPath),
        });
      }
    }
    const isLocal = (step4.hostingTarget || existing.hostingTarget) === 'local';
    const alreadyProvisioned = !isLocal && existing.doMode === 'existing' && existing.sshHost;
    const incomingDoKey = (step4.doApiKey || '').trim();
    const doApiKey = incomingDoKey || existing.doApiKey || '';
    const step4Saved = isLocal ? { ...step4, sshHost: '' } : step4;
    const now = new Date().toISOString();
    const wizardChanged = generateRelevantWizardFingerprint(wizardConfig)
      !== generateRelevantWizardFingerprint(existing.wizardConfig);

    config.profiles[profile] = {
      ...existing,
      projectPath:   step1.projectPath || existing.projectPath,
      detectedName:  step1.detectedName  || existing.detectedName,
      hostingTarget: step4.hostingTarget || existing.hostingTarget,
      sshHost:       isLocal ? '' : (alreadyProvisioned ? existing.sshHost : (step4.sshHost || existing.sshHost || '')),
      sshUser:       step4.sshUser       || existing.sshUser    || 'root',
      sshKeyPath:    isLocal ? '' : (alreadyProvisioned ? existing.sshKeyPath : (step4.sshKeyPath || existing.sshKeyPath || '')),
      remotePath:    step4.remotePath    || existing.remotePath || '',
      doMode:        alreadyProvisioned ? 'existing' : (step4.doMode || existing.doMode || 'existing'),
      doApiKey,
      doRegion:      step4.doRegion      || existing.doRegion || 'lon1',
      doSize:        step4.doSize        || existing.doSize || 's-1vcpu-1gb',
      doSshKeyId:    String(step4.doSshKeyId || existing.doSshKeyId || '').trim(),
      doDropletId:   step4.doDropletId
        ? String(step4.doDropletId)
        : (existing.doDropletId || null),
      domain:        normalizeHostname(
        wizardConfig.step5?.addons?.traefik?.domain || existing.domain || '',
      ),
      wizardConfig: {
        ...wizardConfig,
        activeProfile: profile,
        step4: { ...step4Saved, doApiKey },
      },
      configUpdatedAt: wizardChanged ? now : (existing.configUpdatedAt || null),
    };

    await writeConfig(config);
    const updated = config.profiles[profile];
    res.json({
      ok: true,
      configUpdatedAt: updated.configUpdatedAt,
      ...evaluateProfileStale(updated, profile),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function loadSshProfile(config, profileName) {
  const profile = config.profiles?.[profileName];
  if (!profile) {
    const err = new Error(`Profile "${profileName}" not found.`);
    err.status = 404;
    throw err;
  }
  const target = profile.hostingTarget || profile.wizardConfig?.step4?.hostingTarget || '';
  if (target !== 'digitalocean' && target !== 'vps') {
    const err = new Error('Remote Docker checks require an SSH profile (VPS or DigitalOcean).');
    err.status = 400;
    throw err;
  }
  if (!profile.sshHost) {
    const err = new Error('SSH host is not configured. Complete Step 4 or profile Settings.');
    err.status = 400;
    throw err;
  }
  return profile;
}

// POST /api/config/probe-docker — wizard Step 4 before profile is saved
router.post('/probe-docker', async (req, res) => {
  const { sshHost, sshUser, sshKeyPath, sshPort } = req.body || {};
  if (!sshHost || !sshKeyPath) {
    return res.status(400).json({ error: 'sshHost and sshKeyPath are required.' });
  }
  try {
    const sshCfg = buildSshConfig({ sshHost, sshUser: sshUser || 'root', sshKeyPath, sshPort });
    const status = await inspectRemoteDocker(sshCfg);
    res.json({ ...status, troubleshootingDoc: TROUBLESHOOTING_DOC });
  } catch (err) {
    res.status(400).json({ message: err.message, error: err.message, ok: false });
  }
});

// POST /api/config/probe-redis — wizard Step 5 (scan host for existing Redis containers)
router.post('/probe-redis', async (req, res) => {
  const { sshHost, sshUser, sshKeyPath, sshPort } = req.body || {};
  if (!sshHost || !sshKeyPath) {
    return res.status(400).json({ error: 'sshHost and sshKeyPath are required.' });
  }
  try {
    const sshCfg = buildSshConfig({ sshHost, sshUser: sshUser || 'root', sshKeyPath, sshPort });
    const status = await inspectRemoteRedis(sshCfg);
    res.json(status);
  } catch (err) {
    res.status(400).json({ message: err.message, error: err.message, ok: false, found: false, containers: [] });
  }
});

function startRemoteDockerInstall(sshCfg, { targetOS, jobLabel }) {
  return inspectRemoteDocker(sshCfg).then((preview) => {
    if (!preview.canInstall) {
      const err = new Error('Automatic Docker install is only supported on Ubuntu and Debian servers.');
      err.status = 400;
      throw err;
    }
    const os = targetOS || preview.targetOS || 'ubuntu-24.04';
    const jobId = deployManager.create(jobLabel);
    deployManager.start(jobId);
    (async () => {
      try {
        await installDockerViaSsh(sshCfg, os, (line) => deployManager.log(jobId, line));
        deployManager.complete(jobId, true);
      } catch (err) {
        deployManager.log(jobId, `ERROR: ${err.message}`, 'stderr');
        deployManager.complete(jobId, false, 1);
      }
    })();
    return { jobId, targetOS: os, message: 'Docker install started.' };
  });
}

// POST /api/config/probe-docker/install — wizard Step 4 (live SSH, no saved profile)
router.post('/probe-docker/install', async (req, res) => {
  const { sshHost, sshUser, sshKeyPath, sshPort, acknowledge, targetOS } = req.body || {};
  if (!sshHost || !sshKeyPath) {
    return res.status(400).json({ error: 'sshHost and sshKeyPath are required.' });
  }
  if (!acknowledge) {
    return res.status(400).json({
      error: 'You must acknowledge that WDP will run apt on the remote server as root.',
    });
  }
  try {
    const sshCfg = buildSshConfig({ sshHost, sshUser: sshUser || 'root', sshKeyPath, sshPort });
    const result = await startRemoteDockerInstall(sshCfg, {
      targetOS,
      jobLabel: 'wizard-docker-install',
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/config/profiles/:profile/docker-status
router.get('/profiles/:profile/docker-status', async (req, res) => {
  const profileName = req.params.profile;
  if (!validateProfileName(profileName)) {
    return res.status(400).json({ error: 'Invalid profile name.' });
  }
  try {
    const config = await readConfig();
    const profile = loadSshProfile(enrichProfiles(config), profileName);
    const sshCfg = buildSshConfig(profile);
    const status = await inspectRemoteDocker(sshCfg);
    res.json({ ...status, troubleshootingDoc: TROUBLESHOOTING_DOC });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message, error: err.message, ok: false });
  }
});

// POST /api/config/profiles/:profile/install-docker
// body: { acknowledge: true, targetOS?: string }
router.post('/profiles/:profile/install-docker', async (req, res) => {
  const profileName = req.params.profile;
  if (!validateProfileName(profileName)) {
    return res.status(400).json({ error: 'Invalid profile name.' });
  }
  if (!req.body?.acknowledge) {
    return res.status(400).json({
      error: 'You must acknowledge that WDP will run apt on the remote server as root.',
    });
  }
  try {
    const config = await readConfig();
    const profile = loadSshProfile(enrichProfiles(config), profileName);
    const sshCfg = buildSshConfig(profile);
    const result = await startRemoteDockerInstall(sshCfg, {
      targetOS: req.body?.targetOS,
      jobLabel: profileName,
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// PATCH /api/config/profiles/:profile/connection — SSH host settings after wizard
router.patch('/profiles/:profile/connection', async (req, res) => {
  const profile = req.params.profile;
  if (!validateProfileName(profile)) {
    return res.status(400).json({ error: 'Invalid profile name.' });
  }
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Request body must be a JSON object.' });
  }
  try {
    const config = await readConfig();
    const existing = config.profiles?.[profile];
    if (!existing) return res.status(404).json({ error: `Profile "${profile}" not found.` });

    const allowed = ['sshHost', 'sshUser', 'sshKeyPath', 'sshPort', 'remotePath'];
    for (const key of allowed) {
      if (body[key] !== undefined) existing[key] = body[key];
    }
    const step4 = { ...(existing.wizardConfig?.step4 || {}) };
    for (const key of allowed) {
      if (body[key] !== undefined) step4[key] = body[key];
    }
    if (body.sshHost !== undefined) step4.sshHost = body.sshHost;
    existing.wizardConfig = { ...(existing.wizardConfig || {}), step4 };

    await writeConfig(config);
    res.json({
      ok: true,
      sshHost: existing.sshHost || '',
      sshUser: existing.sshUser || 'root',
      sshKeyPath: existing.sshKeyPath || '',
      remotePath: existing.remotePath || '',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/config/profiles/:profile/step2 — merge step2 prefs (rebuild dismiss, target OS)
router.patch('/profiles/:profile/step2', async (req, res) => {
  const profile = req.params.profile;
  if (!validateProfileName(profile)) {
    return res.status(400).json({ error: 'Invalid profile name.' });
  }
  const patch = req.body;
  if (!patch || typeof patch !== 'object') {
    return res.status(400).json({ error: 'Request body must be a JSON object.' });
  }
  try {
    const config = await readConfig();
    const existing = config.profiles?.[profile];
    if (!existing) return res.status(404).json({ error: `Profile "${profile}" not found.` });

    const allowed = ['targetOS', 'architecture', 'rebuildTargetOS', 'rebuildDismissed'];
    const step2 = { ...(existing.wizardConfig?.step2 || {}) };
    for (const key of allowed) {
      if (patch[key] !== undefined) step2[key] = patch[key];
    }

    existing.wizardConfig = { ...(existing.wizardConfig || {}), step2 };
    await writeConfig(config);
    res.json({ ok: true, step2 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Removes a profile entry from wdp-config.json.
router.delete('/profiles/:profile', async (req, res) => {
  const profile = req.params.profile;
  if (!validateProfileName(profile)) {
    return res.status(400).json({ error: 'Invalid profile name.' });
  }
  try {
    const config = await readConfig();
    if (!config.profiles || !config.profiles[profile]) {
      return res.status(404).json({ error: `Profile "${profile}" not found.` });
    }
    delete config.profiles[profile];
    await writeConfig(config);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
