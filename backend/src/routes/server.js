'use strict';

const express = require('express');
const multer = require('multer');
const os = require('os');
const path = require('path');

const router = express.Router();
const { readConfig } = require('../lib/configStore');
const doApi = require('../lib/digitalocean');
const sftp = require('../lib/sftp');

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

async function loadCtx(profileName) {
  const ctx = await doApi.getProfileContext(profileName);
  if (ctx.hostingTarget !== 'digitalocean') {
    const err = new Error('Server management is only available for DigitalOcean profiles.');
    err.status = 400;
    throw err;
  }
  return ctx;
}

function sendErr(res, err, fallback = 500) {
  res.status(err.status || fallback).json({ message: err.message });
}

async function loadProfileForSftp(profileName) {
  const config = await readConfig();
  const profile = config.profiles?.[profileName];
  if (!profile) {
    const err = new Error('Profile not found.');
    err.status = 404;
    throw err;
  }
  const target = profile.hostingTarget || profile.wizardConfig?.step4?.hostingTarget || '';
  if (target !== 'digitalocean' && target !== 'vps') {
    const err = new Error('Remote files require an SSH-based profile.');
    err.status = 400;
    throw err;
  }
  return profile;
}

// ── Credentials ─────────────────────────────────────────────────────────────────

router.get('/:profile/credentials', async (req, res) => {
  try {
    const ctx = await loadCtx(req.params.profile);
    res.json({
      hasDoApiKey: Boolean(ctx.doApiKey),
      hasProfileDoApiKey: ctx.hasProfileDoApiKey,
      usesGlobalDoApiKey: ctx.usesGlobalDoApiKey,
    });
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/:profile/do-token', async (req, res) => {
  try {
    await loadCtx(req.params.profile);
    const apiKey = req.body?.apiKey;
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return res.status(400).json({ message: 'API key is required.' });
    }
    const trimmed = apiKey.trim();
    const headers = { Authorization: `Bearer ${trimmed}`, 'Content-Type': 'application/json' };
    const accountRes = await fetch('https://api.digitalocean.com/v2/account', { headers });
    if (!accountRes.ok) {
      const msg = accountRes.status === 401
        ? 'Invalid token — DigitalOcean authentication failed.'
        : `DigitalOcean API returned HTTP ${accountRes.status}.`;
      return res.status(400).json({ message: msg });
    }
    const accountData = await accountRes.json();
    await doApi.saveDoApiKey(req.params.profile, trimmed);
    res.json({
      success: true,
      message: `Token saved. Authenticated as ${accountData.account?.email || 'your account'}.`,
    });
  } catch (err) {
    sendErr(res, err);
  }
});

// ── Droplet ───────────────────────────────────────────────────────────────────

router.get('/:profile/droplet', async (req, res) => {
  try {
    const ctx = await loadCtx(req.params.profile);
    const droplet = await doApi.resolveDroplet(ctx);
    if (droplet?.id && !ctx.doDropletId) {
      await doApi.saveDropletId(req.params.profile, droplet.id);
    }
    res.json({ droplet, sshHost: ctx.sshHost, doDropletId: droplet?.id || ctx.doDropletId });
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/:profile/droplet/find', async (req, res) => {
  try {
    const ctx = await loadCtx(req.params.profile);
    if (!ctx.sshHost) {
      return res.status(400).json({ message: 'Profile has no sshHost to match against Droplet public IPs.' });
    }
    const found = await doApi.findDropletByIp(ctx.doApiKey, ctx.sshHost);
    if (!found) {
      return res.status(404).json({ message: `No Droplet found with public IP ${ctx.sshHost}.` });
    }
    await doApi.saveDropletId(req.params.profile, found.id);
    res.json({ droplet: found });
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/:profile/droplets', async (req, res) => {
  try {
    const ctx = await loadCtx(req.params.profile);
    const droplets = await doApi.listAccountDroplets(ctx.doApiKey);
    res.json({ droplets });
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/:profile/droplet/import', async (req, res) => {
  try {
    await loadCtx(req.params.profile);
    const dropletId = req.body?.dropletId;
    if (dropletId == null || dropletId === '') {
      return res.status(400).json({ message: 'dropletId is required.' });
    }
    const droplet = await doApi.importDropletToProfile(req.params.profile, dropletId);
    res.json({ ok: true, droplet, message: `Linked Droplet "${droplet.name}" (${droplet.ipv4}).` });
  } catch (err) {
    sendErr(res, err);
  }
});

// ── Snapshots ─────────────────────────────────────────────────────────────────

router.get('/:profile/snapshots', async (req, res) => {
  try {
    const ctx = await loadCtx(req.params.profile);
    const droplet = await doApi.resolveDroplet(ctx);
    if (!droplet?.id) {
      return res.status(404).json({ message: 'No Droplet linked to this profile.' });
    }
    const snapshots = await doApi.listDropletSnapshots(ctx.doApiKey, droplet.id);
    res.json({ droplet: { id: droplet.id, name: droplet.name, ipv4: droplet.ipv4 }, snapshots });
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/:profile/snapshots', async (req, res) => {
  try {
    const ctx = await loadCtx(req.params.profile);
    const droplet = await doApi.resolveDroplet(ctx);
    if (!droplet?.id) {
      return res.status(404).json({ message: 'No Droplet linked to this profile.' });
    }
    const name = req.body?.name;
    const powerOffFirst = req.body?.powerOffFirst === true;
    const { action, poweredOff } = await doApi.createDropletSnapshot(
      ctx.doApiKey,
      droplet.id,
      name,
      { powerOffFirst },
    );
    const snapshots = await doApi.listDropletSnapshots(ctx.doApiKey, droplet.id);
    res.json({
      ok: true,
      action,
      poweredOff,
      snapshots,
      message: `Snapshot "${String(name).trim()}" created for Droplet "${droplet.name}".`,
    });
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/:profile/snapshots/restore', async (req, res) => {
  try {
    const ctx = await loadCtx(req.params.profile);
    const droplet = await doApi.resolveDroplet(ctx);
    if (!droplet?.id) {
      return res.status(404).json({ message: 'No Droplet linked to this profile.' });
    }
    if (!req.body?.acknowledgeDataLoss) {
      return res.status(400).json({
        message: 'You must acknowledge that restoring will overwrite the Droplet disk.',
      });
    }
    const confirmName = String(req.body?.confirmDropletName || '').trim();
    if (!confirmName || confirmName !== droplet.name) {
      return res.status(400).json({
        message: `Type the Droplet name exactly to confirm: ${droplet.name}`,
      });
    }
    const imageId = req.body?.imageId;
    await doApi.restoreDropletFromSnapshot(ctx.doApiKey, droplet.id, imageId);
    const refreshed = await doApi.getDroplet(ctx.doApiKey, droplet.id);
    res.json({
      ok: true,
      droplet: refreshed,
      message: `Droplet "${droplet.name}" restored from snapshot. The disk now matches the snapshot point in time.`,
    });
  } catch (err) {
    sendErr(res, err);
  }
});

// ── DNS ───────────────────────────────────────────────────────────────────────

router.get('/:profile/dns', async (req, res) => {
  try {
    const ctx = await loadCtx(req.params.profile);
    if (!ctx.domain) {
      return res.status(400).json({ message: 'No domain configured. Add Traefik in Step 5 or set a domain on the profile.' });
    }
    const droplet = await doApi.resolveDroplet(ctx);
    const records = await doApi.listDomainRecords(ctx.doApiKey, ctx.domain);
    const analysis = doApi.analyseDnsForDroplet(records, ctx.domain, droplet?.ipv4);
    if (droplet?.id && !ctx.doDropletId) {
      await doApi.saveDropletId(req.params.profile, droplet.id);
    }
    res.json({ domain: ctx.domain, records, analysis, dropletIp: droplet?.ipv4 || null });
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/:profile/dns/fix-a', async (req, res) => {
  try {
    const ctx = await loadCtx(req.params.profile);
    if (!ctx.domain) {
      return res.status(400).json({ message: 'No domain configured on this profile.' });
    }
    const droplet = await doApi.resolveDroplet(ctx);
    if (!droplet?.ipv4) {
      return res.status(400).json({ message: 'Could not determine Droplet public IPv4.' });
    }
    const records = await doApi.listDomainRecords(ctx.doApiKey, ctx.domain);
    const analysis = doApi.analyseDnsForDroplet(records, ctx.domain, droplet.ipv4);
    const wrong = analysis.aRecords.find(r => r.data !== droplet.ipv4);
    if (wrong) {
      await doApi.updateDomainRecord(ctx.doApiKey, ctx.domain, wrong.id, {
        type: 'A',
        name: wrong.name,
        data: droplet.ipv4,
        ttl: wrong.ttl || 3600,
      });
    } else {
      await doApi.createDomainRecord(ctx.doApiKey, ctx.domain, {
        type: 'A',
        name: '@',
        data: droplet.ipv4,
        ttl: 3600,
      });
    }
    const updated = await doApi.listDomainRecords(ctx.doApiKey, ctx.domain);
    res.json({
      success: true,
      records: updated,
      analysis: doApi.analyseDnsForDroplet(updated, ctx.domain, droplet.ipv4),
    });
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/:profile/dns/records', async (req, res) => {
  try {
    const ctx = await loadCtx(req.params.profile);
    if (!ctx.domain) return res.status(400).json({ message: 'No domain configured.' });
    const record = await doApi.createDomainRecord(ctx.doApiKey, ctx.domain, req.body);
    res.json({ record });
  } catch (err) {
    sendErr(res, err);
  }
});

router.put('/:profile/dns/records/:recordId', async (req, res) => {
  try {
    const ctx = await loadCtx(req.params.profile);
    if (!ctx.domain) return res.status(400).json({ message: 'No domain configured.' });
    const record = await doApi.updateDomainRecord(
      ctx.doApiKey,
      ctx.domain,
      req.params.recordId,
      req.body
    );
    res.json({ record });
  } catch (err) {
    sendErr(res, err);
  }
});

router.delete('/:profile/dns/records/:recordId', async (req, res) => {
  try {
    const ctx = await loadCtx(req.params.profile);
    if (!ctx.domain) return res.status(400).json({ message: 'No domain configured.' });
    await doApi.deleteDomainRecord(ctx.doApiKey, ctx.domain, req.params.recordId);
    res.json({ success: true });
  } catch (err) {
    sendErr(res, err);
  }
});

// ── SFTP files ────────────────────────────────────────────────────────────────

router.get('/:profile/files', async (req, res) => {
  try {
    const profile = await loadProfileForSftp(req.params.profile);
    const relPath = typeof req.query.path === 'string' ? req.query.path : '';
    const showHidden = req.query.hidden === '1' || req.query.hidden === 'true';
    const result = await sftp.listDirectory(profile, relPath, showHidden);
    res.json(result);
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/:profile/files/view', async (req, res) => {
  try {
    const profile = await loadProfileForSftp(req.params.profile);
    const relPath = req.query.path;
    if (!relPath || typeof relPath !== 'string') {
      return res.status(400).json({ message: 'path query parameter is required.' });
    }
    const content = await sftp.readTextFile(profile, relPath);
    res.json({ path: relPath, content });
  } catch (err) {
    sendErr(res, err);
  }
});

router.get('/:profile/files/download', async (req, res) => {
  try {
    const profile = await loadProfileForSftp(req.params.profile);
    const relPath = req.query.path;
    if (!relPath || typeof relPath !== 'string') {
      return res.status(400).json({ message: 'path query parameter is required.' });
    }
    const buf = await sftp.downloadFile(profile, relPath);
    const name = path.posix.basename(relPath);
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(buf);
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/:profile/files/upload', upload.single('file'), async (req, res) => {
  try {
    const profile = await loadProfileForSftp(req.params.profile);
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
    const relDir = typeof req.body.path === 'string' ? req.body.path : '';
    const filename = req.file.originalname || req.file.filename;
    const fs = require('fs');
    const buffer = fs.readFileSync(req.file.path);
    fs.unlink(req.file.path, () => {});
    const result = await sftp.uploadFile(profile, relDir, filename, buffer);
    res.json(result);
  } catch (err) {
    sendErr(res, err);
  }
});

router.delete('/:profile/files', async (req, res) => {
  try {
    const profile = await loadProfileForSftp(req.params.profile);
    const relPath = req.query.path;
    if (!relPath || typeof relPath !== 'string') {
      return res.status(400).json({ message: 'path query parameter is required.' });
    }
    await sftp.deletePath(profile, relPath);
    res.json({ success: true });
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/:profile/files/rename', async (req, res) => {
  try {
    const profile = await loadProfileForSftp(req.params.profile);
    const { path: relPath, newName } = req.body || {};
    if (!relPath || !newName) {
      return res.status(400).json({ message: 'path and newName are required.' });
    }
    const result = await sftp.renamePath(profile, relPath, newName);
    res.json(result);
  } catch (err) {
    sendErr(res, err);
  }
});

module.exports = router;
