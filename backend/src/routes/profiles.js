'use strict';

const express  = require('express');
const router   = express.Router();
const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const crypto   = require('crypto');
const multer   = require('multer');
const AdmZip   = require('adm-zip');

const { readConfig, writeConfig } = require('../lib/configStore');
const {
  patchGeneratedFilesForRename,
  migrateDeployHistoryProfile,
} = require('../lib/profileRename');

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 50 * 1024 * 1024 }   // 50 MB cap
});

function validateName(name) {
  return typeof name === 'string' &&
         name.length > 0 &&
         path.basename(name) === name &&
         !name.includes('..');
}

// Resolve the project path from wherever it may be stored
function resolveProjectPath(profileData) {
  return profileData.projectPath ||
         profileData.wizardConfig?.step1?.projectPath ||
         null;
}

// ── POST /api/profiles/:profile/duplicate ─────────────────────────────────────
router.post('/:profile/duplicate', async (req, res) => {
  const { profile } = req.params;
  const { newName } = req.body;

  if (!validateName(newName)) {
    return res.status(400).json({ error: 'Invalid new profile name.' });
  }
  try {
    const config = await readConfig();
    if (!config.profiles?.[profile]) {
      return res.status(404).json({ error: 'Profile not found.' });
    }
    if (config.profiles[newName]) {
      return res.status(409).json({ error: `Profile "${newName}" already exists.` });
    }

    const clone = JSON.parse(JSON.stringify(config.profiles[profile]));
    if (clone.wizardConfig) clone.wizardConfig.activeProfile = newName;
    config.profiles[newName] = clone;
    await writeConfig(config);

    const projectPath = resolveProjectPath(clone);
    if (projectPath) {
      const src = path.join(projectPath, 'wdp', profile);
      const dst = path.join(projectPath, 'wdp', newName);
      if (fs.existsSync(src)) fs.cpSync(src, dst, { recursive: true });
    }

    res.json({ success: true, profile: newName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/profiles/:profile/rename ────────────────────────────────────────
router.post('/:profile/rename', async (req, res) => {
  const { profile } = req.params;
  const { newName } = req.body;

  if (!validateName(newName)) {
    return res.status(400).json({ error: 'Invalid new profile name.' });
  }
  try {
    const config = await readConfig();
    if (!config.profiles?.[profile]) {
      return res.status(404).json({ error: 'Profile not found.' });
    }
    if (config.profiles[newName]) {
      return res.status(409).json({ error: `Profile "${newName}" already exists.` });
    }

    const data = config.profiles[profile];
    if (data.wizardConfig) data.wizardConfig.activeProfile = newName;
    config.profiles[newName] = data;
    delete config.profiles[profile];
    await writeConfig(config);

    const projectPath = resolveProjectPath(data);
    if (projectPath) {
      const src = path.join(projectPath, 'wdp', profile);
      const dst = path.join(projectPath, 'wdp', newName);
      if (fs.existsSync(src)) {
        try { fs.renameSync(src, dst); } catch { /* non-fatal */ }
      }
      patchGeneratedFilesForRename(projectPath, profile, newName);
    }

    await migrateDeployHistoryProfile(profile, newName).catch((err) => {
      console.warn('[WDP] deploy history profile rename:', err.message);
    });

    res.json({
      success: true,
      profile: newName,
      needsRegenerate: true,
      message: 'Profile renamed. Regenerate files in Wizard Step 8, then run a Full deploy.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/profiles/:profile/webhook-token ─────────────────────────────────
router.post('/:profile/webhook-token', async (req, res) => {
  const { profile } = req.params;
  try {
    const config = await readConfig();
    if (!config.profiles?.[profile]) {
      return res.status(404).json({ error: 'Profile not found.' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    config.profiles[profile].webhookToken = token;
    await writeConfig(config);
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/profiles/:profile/export.zip ─────────────────────────────────────
// Exports the full profile: manifest + profile config + generated files (if any).
router.get('/:profile/export.zip', async (req, res) => {
  const { profile } = req.params;
  try {
    const config      = await readConfig();
    const profileData = config.profiles?.[profile];
    if (!profileData) return res.status(404).json({ error: 'Profile not found.' });

    const zip = new AdmZip();

    // Manifest — used by the import route to identify valid WDP exports
    const manifest = {
      wdpVersion: '1.0.0',
      exportedAt: new Date().toISOString(),
      profileName: profile,
      sourceHost: os.hostname()
    };
    zip.addFile('wdp-export-manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));

    // Profile config — full entry from wdp-config.json, minus the webhook token
    const exportConfig = JSON.parse(JSON.stringify(profileData));
    delete exportConfig.webhookToken;
    zip.addFile('profile-config.json', Buffer.from(JSON.stringify(exportConfig, null, 2), 'utf8'));

    // Generated files — include wdp/{profile}/ directory if it exists
    const projectPath = resolveProjectPath(profileData);
    if (projectPath) {
      const wdpDir = path.join(projectPath, 'wdp', profile);
      if (fs.existsSync(wdpDir)) {
        zip.addLocalFolder(wdpDir, 'files');
      }
    }

    const zipBuffer = zip.toBuffer();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="wdp-${profile}-export.zip"`);
    res.setHeader('Content-Length', zipBuffer.length);
    res.send(zipBuffer);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ── POST /api/profiles/import ─────────────────────────────────────────────────
// Accepts a WDP profile export zip. Optionally pass targetName in the form body
// to override the profile name from the manifest (used when resolving conflicts).
router.post('/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const tmpPath = req.file.path;

  try {
    // Parse the zip
    let zip;
    try {
      zip = new AdmZip(tmpPath);
    } catch {
      return res.status(400).json({ error: 'The uploaded file is not a valid zip archive.' });
    }

    // Read and validate manifest
    const manifestEntry = zip.getEntry('wdp-export-manifest.json');
    if (!manifestEntry) {
      return res.status(400).json({ error: 'Not a valid WDP export — manifest not found.' });
    }
    let manifest;
    try {
      manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'Manifest is corrupt or unreadable.' });
    }

    // Read profile config
    const configEntry = zip.getEntry('profile-config.json');
    if (!configEntry) {
      return res.status(400).json({ error: 'Not a valid WDP export — profile config not found.' });
    }
    let importedProfile;
    try {
      importedProfile = JSON.parse(configEntry.getData().toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'Profile config is corrupt or unreadable.' });
    }

    // Determine the target profile name
    const targetName = (req.body?.targetName || manifest.profileName || '').trim();
    if (!validateName(targetName)) {
      return res.status(400).json({ error: 'Invalid profile name in export.' });
    }

    // Load current config and check for name conflict
    const config = await readConfig();
    if (!config.profiles) config.profiles = {};

    if (config.profiles[targetName]) {
      return res.status(409).json({
        error: `Profile "${targetName}" already exists.`,
        conflict: true,
        suggestedName: `${targetName}-imported`
      });
    }

    // Update internal profile name references
    if (importedProfile.wizardConfig) {
      importedProfile.wizardConfig.activeProfile = targetName;
    }

    // Save profile into config
    config.profiles[targetName] = importedProfile;
    await writeConfig(config);

    // Extract generated files if the project path exists on this machine
    const projectPath = resolveProjectPath(importedProfile);
    let filesExtracted = false;

    if (projectPath && fs.existsSync(projectPath)) {
      const targetDir = path.join(projectPath, 'wdp', targetName);
      fs.mkdirSync(targetDir, { recursive: true });

      const resolvedTarget = path.resolve(targetDir);
      zip.getEntries().forEach(entry => {
        if (!entry.entryName.startsWith('files/')) return;
        const relative = entry.entryName.slice('files/'.length);
        if (!relative) return;

        // Strict path traversal guard
        const resolved = path.resolve(targetDir, relative);
        if (!resolved.startsWith(resolvedTarget + path.sep) && resolved !== resolvedTarget) return;

        if (entry.isDirectory) {
          fs.mkdirSync(resolved, { recursive: true });
        } else {
          fs.mkdirSync(path.dirname(resolved), { recursive: true });
          fs.writeFileSync(resolved, entry.getData());
        }
      });
      filesExtracted = true;
    }

    res.json({
      ok: true,
      profile: targetName,
      filesExtracted,
      projectPathExists: !!(projectPath && fs.existsSync(projectPath))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* always clean up the temp file */ }
  }
});

module.exports = router;
