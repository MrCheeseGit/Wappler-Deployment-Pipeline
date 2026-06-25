'use strict';

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const http  = require('http');
const https = require('https');
const { spawn } = require('child_process');

const express = require('express');
const router  = express.Router();

const { readConfig, writeConfig } = require('../lib/configStore');
const { withResolvedDoApiKey } = require('../lib/digitalocean');
const { rebuildDropletAndPrepare } = require('../lib/dropletProvision');
const { runChecks }       = require('../lib/preDeployChecks');
const { getPublishEligibility } = require('../lib/profilePublish');
const { runScanners }     = require('../lib/securityScanner');
const { buildSshConfig, execStream, testConnection, exec: sshExec, expandTilde, transferDirectory } = require('../lib/ssh');
const { hintsForDeployOutput } = require('../lib/deployLogHints');
const { dockerImageSlug } = require('../lib/generators/generateCompose');
const {
  dockerfileHasBuildKitCaches,
  dockerfileUsesLegacyBookwormProdStage,
  dockerfileInstallsLibvipsDev,
} = require('../lib/generators/generateDockerfile');
const {
  TRAEFIK_IMAGE,
  DOCKER29_API_ERROR,
  ensureTraefikImageInComposeYaml,
  isTraefikImageDocker29Compatible,
  extractTraefikImageFromCompose,
} = require('../lib/traefikCompat');
const deployManager       = require('../lib/deployManager');
const { send: notify }    = require('../lib/notify');
const { dispatchSms }     = require('../lib/clicksend');
const git                 = require('../lib/git');
const {
  rebuildRollupIfEmpty,
  applyEntryToRollup,
  buildActivityFromHistory,
} = require('../lib/deployActivity');
const { readHistoryFile, writeHistoryFile } = require('../lib/deployHistory');
const { dockerCliEnv } = require('../lib/dockerHost');

const HISTORY_PATH     = process.env.HISTORY_PATH     || '/data/deploy-history.json';
const DISMISSALS_PATH  = process.env.DISMISSALS_PATH  || '/data/security-dismissals.json';
const MAX_HISTORY  = 50; // entries per profile
const MAX_HISTORY_LOG_LINES = 80; // cap stored deploy log lines per entry (keeps history JSON bounded)

// ── Dismissal helpers ─────────────────────────────────────────────────────────

async function readDismissals(profileName) {
  try {
    const raw  = await fs.promises.readFile(DISMISSALS_PATH, 'utf8');
    const data = JSON.parse(raw);
    return data[profileName] || {};
  } catch { return {}; }
}

async function writeDismissals(profileName, profileDismissals) {
  let data = {};
  try { data = JSON.parse(await fs.promises.readFile(DISMISSALS_PATH, 'utf8')); } catch {}
  data[profileName] = profileDismissals;
  await fs.promises.writeFile(DISMISSALS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// ── History helpers ────────────────────────────────────────────────────────────

async function readHistory() {
  const { history, repaired } = await readHistoryFile(HISTORY_PATH);
  if (repaired) {
    console.warn('[WDP] deploy-history.json was corrupt — repaired truncated/trailing data');
    writeHistoryFile(HISTORY_PATH, history).catch((err) => {
      console.error('[WDP] Failed to persist repaired deploy-history.json:', err.message);
    });
  }
  return history;
}

async function appendHistory(entry) {
  const history = await readHistory();
  rebuildRollupIfEmpty(history);
  applyEntryToRollup(history, entry);
  history.entries.unshift(entry);
  // Cap per-profile to MAX_HISTORY
  const profileEntries = history.entries.filter(e => e.profile === entry.profile);
  if (profileEntries.length > MAX_HISTORY) {
    const oldest = profileEntries.slice(MAX_HISTORY).map(e => e.id);
    history.entries = history.entries.filter(e => !oldest.includes(e.id));
  }
  await writeHistoryFile(HISTORY_PATH, history);
}

// ── GET /api/deploy/summary ─────────────────────────────────────────────────────
// Last deploy snapshot per profile for the dashboard overview.
router.get('/summary', async (req, res) => {
  try {
    const [history, config] = await Promise.all([readHistory(), readConfig()]);
    const profiles = config.profiles || {};
    const activeByProfile = deployManager.getActiveByProfile();
    const summary = {};

    for (const name of Object.keys(profiles)) {
      const p = profiles[name];
      const entries = history.entries.filter(e => e.profile === name);
      let latest = null;
      for (const e of entries) {
        if (!latest || new Date(e.startedAt) > new Date(latest.startedAt)) latest = e;
      }

      const active = activeByProfile[name];
      let lastDeploy = null;
      if (active) {
        lastDeploy = {
          outcome:     'running',
          startedAt:   active.startedAt,
          completedAt: null,
          deployUrl:   active.deployUrl,
        };
      } else if (latest) {
        lastDeploy = {
          outcome:     latest.outcome,
          startedAt:   latest.startedAt,
          completedAt: latest.completedAt,
          deployUrl:   latest.deployUrl || null,
        };
      }

      summary[name] = {
        hostingTarget: p.hostingTarget || p.wizardConfig?.step4?.hostingTarget || '',
        domain:        p.domain || p.wizardConfig?.step5?.addons?.traefik?.domain || '',
        detectedName:  p.detectedName || p.wizardConfig?.step1?.detectedName || '',
        lastDeploy,
      };
    }

    res.json({ summary });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/deploy/activity — fleet deploy heatmap (last 52 weeks) ───────────
router.get('/activity', async (req, res) => {
  try {
    const history = await readHistory();
    const activity = buildActivityFromHistory(history, null);
    res.json({ activity });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/deploy/:profile/activity — per-profile deploy heatmap ────────────
router.get('/:profile/activity', async (req, res) => {
  try {
    const profile = req.params.profile;
    const config = await readConfig();
    if (!config.profiles?.[profile]) {
      return res.status(404).json({ message: `Profile "${profile}" not found.` });
    }
    const history = await readHistory();
    const activity = buildActivityFromHistory(history, profile);
    res.json({ activity, profile });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/deploy/:profile/history ──────────────────────────────────────────
router.get('/:profile/history', async (req, res) => {
  try {
    const profile = req.params.profile;
    const history = await readHistory();
    const entries = history.entries.filter(e => e.profile === profile);
    res.json({ entries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/deploy/:profile/dismissals ──────────────────────────────────────
router.get('/:profile/dismissals', async (req, res) => {
  try {
    const dismissals = await readDismissals(req.params.profile);
    res.json({ dismissals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/deploy/:profile/dismissals ──────────────────────────────────────
// body: { id: string, reason?: string }
router.post('/:profile/dismissals', async (req, res) => {
  try {
    const { id, reason = '' } = req.body;
    if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Missing finding id' });
    const dismissals = await readDismissals(req.params.profile);
    dismissals[id]   = { dismissedAt: new Date().toISOString(), reason };
    await writeDismissals(req.params.profile, dismissals);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/deploy/:profile/dismissals/:findingId ─────────────────────────
router.delete('/:profile/dismissals/:findingId', async (req, res) => {
  try {
    const { profile: profileName, findingId } = req.params;
    const dismissals = await readDismissals(profileName);
    delete dismissals[decodeURIComponent(findingId)];
    await writeDismissals(profileName, dismissals);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/deploy/:profile/dismissals ──────────────────────────────────────
router.get('/:profile/dismissals', async (req, res) => {
  try {
    const dismissals = await readDismissals(req.params.profile);
    res.json({ dismissals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/deploy/:profile/dismissals  body: { id, reason? } ─────────────────
router.post('/:profile/dismissals', async (req, res) => {
  try {
    const { id, reason = '' } = req.body;
    if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Missing finding id' });
    const dismissals = await readDismissals(req.params.profile);
    dismissals[id]   = { dismissedAt: new Date().toISOString(), reason };
    await writeDismissals(req.params.profile, dismissals);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/deploy/:profile/dismissals/:findingId ─────────────────────────
router.delete('/:profile/dismissals/:findingId', async (req, res) => {
  try {
    const { profile: profileName, findingId } = req.params;
    const dismissals = await readDismissals(profileName);
    delete dismissals[decodeURIComponent(findingId)];
    await writeDismissals(profileName, dismissals);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/deploy/:profile/security/npm-audit-fix ─────────────────────────
router.post('/:profile/security/npm-audit-fix', async (req, res) => {
  try {
    const config  = await readConfig();
    const profile = config.profiles?.[req.params.profile];
    if (!profile)             return res.status(404).json({ error: 'Profile not found' });
    if (!profile.projectPath) return res.status(400).json({ error: 'No project path configured' });

    const fixId = deployManager.create(`${req.params.profile}-security-fix`);
    deployManager.start(fixId);
    res.json({ fixId });

    const force  = req.query.force === '1';
    const backup = req.query.backup !== '0';

    // ── Backup package files ─────────────────────────────────────────────
    let backupTs = null;
    if (backup) {
      const now = new Date();
      backupTs = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
        '-',
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
        String(now.getSeconds()).padStart(2, '0'),
      ].join('');
      const filesToBackup = ['package.json', 'package-lock.json'];
      for (const f of filesToBackup) {
        const src = path.join(profile.projectPath, f);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, `${src}.wdp-backup-${backupTs}`);
        }
      }
      deployManager.log(fixId, `[WDP] Backed up package files with timestamp ${backupTs}`);
    }

    const args = force ? ['audit', 'fix', '--force'] : ['audit', 'fix'];
    deployManager.log(fixId, `[WDP] Running: npm ${args.join(' ')}`);
    // npm audit fix exits 1 when unfixable vulns remain — treat as success
    spawnAndStream('npm', args, fixId, { cwd: profile.projectPath, ignoreExitCode: true })
      .then(() => {
        deployManager.log(fixId, '[WDP] ✓ npm audit fix complete — re-run deployment to re-scan');
        deployManager.complete(fixId, true, 0);
      })
      .catch(err => {
        deployManager.log(fixId, `ERROR: ${err.message}`, 'stderr');
        deployManager.complete(fixId, false, 1);
      });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/deploy/:profile/security/restore-backup ────────────────────────
router.post('/:profile/security/restore-backup', async (req, res) => {
  try {
    const config  = await readConfig();
    const profile = config.profiles?.[req.params.profile];
    if (!profile)             return res.status(404).json({ error: 'Profile not found' });
    if (!profile.projectPath) return res.status(400).json({ error: 'No project path configured' });

    const { timestamp } = req.body;
    if (!timestamp || !/^\d{8}-\d{6}$/.test(timestamp)) {
      return res.status(400).json({ error: 'Invalid or missing timestamp' });
    }

    const restored = [];
    for (const f of ['package.json', 'package-lock.json']) {
      const backup = path.join(profile.projectPath, `${f}.wdp-backup-${timestamp}`);
      const dest   = path.join(profile.projectPath, f);
      if (fs.existsSync(backup)) {
        fs.copyFileSync(backup, dest);
        restored.push(f);
      }
    }

    if (restored.length === 0) {
      return res.status(404).json({ error: `No backup files found for timestamp ${timestamp}` });
    }

    res.json({ ok: true, restored });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/deploy/:profile/security/fix-package ───────────────────────────
router.post('/:profile/security/fix-package', async (req, res) => {
  try {
    const config  = await readConfig();
    const profile = config.profiles?.[req.params.profile];
    if (!profile)             return res.status(404).json({ error: 'Profile not found' });
    if (!profile.projectPath) return res.status(400).json({ error: 'No project path configured' });

    const { pkg, version } = req.body;
    if (!pkg || typeof pkg !== 'string' || !/^[@\w/._-]+$/.test(pkg)) {
      return res.status(400).json({ error: 'Invalid package name' });
    }
    if (!version || typeof version !== 'string' || !/^[\w.^~*-]+$/.test(version)) {
      return res.status(400).json({ error: 'Invalid version' });
    }

    const fixId = deployManager.create(`${req.params.profile}-fix-pkg`);
    deployManager.start(fixId);
    res.json({ fixId });

    // Step 1: Add package to "overrides" in package.json so npm forces this version
    // across ALL transitive deps (not just the root install).
    const pkgJsonPath = path.join(profile.projectPath, 'package.json');
    try {
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      pkgJson.overrides = pkgJson.overrides || {};
      // Pin to the exact safe version — using >= would allow npm to pull a
      // newer major (e.g. uuid v9 is ESM-only; >= would break CJS projects).
      pkgJson.overrides[pkg] = version;
      fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n');
      deployManager.log(fixId, `[WDP] Added overrides.${pkg}="${version}" to package.json`);
    } catch (e) {
      deployManager.log(fixId, `[WDP] Warning: could not update package.json overrides: ${e.message}`, 'stderr');
    }

    // Step 2: Run npm install to apply the override and update the lockfile
    deployManager.log(fixId, `[WDP] Running: npm install (applying override for ${pkg}@${version})`);
    spawnAndStream('npm', ['install'], fixId, { cwd: profile.projectPath, ignoreExitCode: true })
      .then(() => {
        deployManager.log(fixId, `[WDP] ✓ ${pkg}@${version} pinned via overrides — re-run deployment to re-scan`);
        deployManager.complete(fixId, true, 0);
      })
      .catch(err => {
        deployManager.log(fixId, `ERROR: ${err.message}`, 'stderr');
        deployManager.complete(fixId, false, 1);
      });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/deploy/:profile/security/install-tool ──────────────────────────
// Runs a whitelisted install command and streams output via WS.
const ALLOWED_INSTALL_CMDS = {
  'socket-cli':    { cmd: 'npm',    args: ['install', '-g', '@socketsecurity/cli'] },
  'docker-scout':  { cmd: 'docker', args: ['plugin', 'install', 'dockerscout/scout'] },
};

router.post('/:profile/security/install-tool', async (req, res) => {
  try {
    const { tool } = req.body;
    const entry = ALLOWED_INSTALL_CMDS[tool];
    if (!entry) return res.status(400).json({ error: `Unknown tool: ${tool}` });

    const config  = await readConfig();
    const profile = config.profiles?.[req.params.profile];
    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    const fixId = deployManager.create(`${req.params.profile}-install-${tool}`);
    deployManager.start(fixId);
    res.json({ fixId });

    const label = `${entry.cmd} ${entry.args.join(' ')}`;
    deployManager.log(fixId, `[WDP] Running: ${label}`);
    spawnAndStream(entry.cmd, entry.args, fixId, { ignoreExitCode: true })
      .then(() => {
        deployManager.log(fixId, `[WDP] ✓ ${tool} installed — re-run deployment to re-scan`);
        deployManager.complete(fixId, true, 0);
      })
      .catch(err => {
        deployManager.log(fixId, `ERROR: ${err.message}`, 'stderr');
        deployManager.complete(fixId, false, 1);
      });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/deploy/:profile/security/gen-lockfile ──────────────────────────
router.post('/:profile/security/gen-lockfile', async (req, res) => {
  try {
    const config  = await readConfig();
    const profile = config.profiles?.[req.params.profile];
    if (!profile)             return res.status(404).json({ error: 'Profile not found' });
    if (!profile.projectPath) return res.status(400).json({ error: 'No project path configured' });

    const fixId = deployManager.create(`${req.params.profile}-gen-lockfile`);
    deployManager.start(fixId);
    res.json({ fixId });

    deployManager.log(fixId, '[WDP] Generating package-lock.json (npm i --package-lock-only)…');
    spawnAndStream('npm', ['install', '--package-lock-only'], fixId, { cwd: profile.projectPath, ignoreExitCode: true })
      .then(() => {
        deployManager.log(fixId, '[WDP] ✓ package-lock.json generated — re-run deployment to re-scan');
        deployManager.complete(fixId, true, 0);
      })
      .catch(err => {
        deployManager.log(fixId, `ERROR: ${err.message}`, 'stderr');
        deployManager.complete(fixId, false, 1);
      });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/deploy/:profile/eligibility ────────────────────────────────────
router.get('/:profile/eligibility', async (req, res) => {
  try {
    const profileName = req.params.profile;
    const config      = await readConfig();
    const profile     = config.profiles?.[profileName];
    if (!profile) return res.status(404).json({ error: `Profile "${profileName}" not found` });

    const eligibility = await getPublishEligibility(profileName, profile);
    res.json(eligibility);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/deploy/:profile/checks ─────────────────────────────────────────
// body: { mode?: 'publish' | 'full' }
router.post('/:profile/checks', async (req, res) => {
  try {
    const profileName = req.params.profile;
    const config      = await readConfig();
    const profile     = config.profiles?.[profileName];
    if (!profile) return res.status(404).json({ error: `Profile "${profileName}" not found` });

    const mode = req.body?.mode === 'publish' ? 'publish' : 'full';
    const results = await runChecks(profile, profileName, { mode });
    res.json({ results, mode });
  } catch (err) {
    console.error('[checks]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/deploy/:profile/run ─────────────────────────────────────────────
// body: { mode?: 'publish' | 'full' | 'rebuild', targetOS?, confirmDropletName?, acknowledgeDataLoss? }
router.post('/:profile/run', async (req, res) => {
  try {
    const profileName = req.params.profile;
    const config      = await readConfig();
    const profile     = config.profiles?.[profileName];
    if (!profile) return res.status(404).json({ error: `Profile "${profileName}" not found` });

    const rawMode = req.body?.mode;
    const mode = rawMode === 'publish' ? 'publish' : rawMode === 'rebuild' ? 'rebuild' : 'full';

    if (mode === 'publish') {
      const eligibility = await getPublishEligibility(profileName, profile);
      if (!eligibility.canPublish) {
        return res.status(400).json({
          error: 'Publish is not available yet. Complete a full deploy first, or finish provisioning this profile.',
          reason: eligibility.reason,
        });
      }
    }

    if (mode === 'rebuild') {
      const wiz = profile.wizardConfig || {};
      const s4 = wiz.step4 || {};
      const hostingTarget = profile.hostingTarget || s4.hostingTarget || '';
      const doMode = profile.doMode || s4.doMode || 'existing';
      if (hostingTarget !== 'digitalocean' || doMode !== 'existing') {
        return res.status(400).json({
          error: 'Rebuild is only available for profiles using an existing DigitalOcean Droplet.',
        });
      }
      if (!profile.doDropletId && !s4.doDropletId) {
        return res.status(400).json({
          error: 'No Droplet linked to this profile. Import a Droplet in Step 4 first.',
        });
      }
      if (!req.body?.targetOS) {
        return res.status(400).json({ error: 'targetOS is required for rebuild.' });
      }
      if (!req.body?.confirmDropletName?.trim()) {
        return res.status(400).json({ error: 'Type the Droplet name to confirm rebuild.' });
      }
      if (!req.body?.acknowledgeDataLoss) {
        return res.status(400).json({
          error: 'You must acknowledge that ALL data on the Droplet will be permanently deleted.',
        });
      }
    }

    const deployId = deployManager.create(profileName);
    res.json({ deployId, mode });

    const runOptions = { mode };
    if (mode === 'rebuild') {
      runOptions.targetOS = req.body.targetOS;
      runOptions.confirmDropletName = req.body.confirmDropletName;
      runOptions.acknowledgeDataLoss = true;
    }

    // Run asynchronously — do not await
    runDeployment(deployId, profile, profileName, runOptions).catch((err) => {
      console.error(`[deploy] Unhandled error for ${deployId}:`, err);
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/deploy/:profile/cancel ─────────────────────────────────────────
router.post('/:profile/cancel', (req, res) => {
  const { deployId } = req.body;
  if (!deployId) return res.status(400).json({ error: 'deployId is required.' });
  const cancelled = deployManager.cancel(deployId);
  if (!cancelled) return res.status(409).json({ error: 'Deployment not found or already complete.' });
  res.json({ ok: true });
});

/**
 * Exported helper for the webhook route — creates a deployId and starts
 * deployment asynchronously. Returns the deployId.
 */
async function triggerDeploy(profileName) {
  const config  = await readConfig();
  const profile = config.profiles?.[profileName];
  if (!profile) throw new Error(`Profile "${profileName}" not found`);
  const deployId = deployManager.create(profileName);
  runDeployment(deployId, profile, profileName).catch((err) => {
    console.error(`[webhook-deploy] Unhandled error for ${deployId}:`, err);
  });
  return deployId;
}

// ── POST /api/deploy/:profile/rollback/:deployId ──────────────────────────────
router.post('/:profile/rollback/:historyId', async (req, res) => {
  try {
    const { profile: profileName, historyId } = req.params;
    const config = await readConfig();
    const profile = config.profiles?.[profileName];
    if (!profile) return res.status(404).json({ error: `Profile "${profileName}" not found` });

    // Find the history entry
    const history = await readHistory();
    const entry   = history.entries.find(e => e.id === historyId && e.profile === profileName);
    if (!entry) return res.status(404).json({ error: 'History entry not found' });
    if (!entry.generatedFiles) return res.status(400).json({ error: 'History entry has no stored files' });

    // Restore the generated files to disk
    const outputDir = path.join(profile.projectPath, 'wdp', profileName);
    fs.mkdirSync(outputDir, { recursive: true });
    for (const [name, content] of Object.entries(entry.generatedFiles)) {
      fs.writeFileSync(path.join(outputDir, name), content, 'utf8');
    }

    // Trigger a new deployment
    const deployId = deployManager.create(profileName);
    res.json({ deployId, note: `Rolled back to ${entry.startedAt}` });

    if (config.clickSend?.onRollback !== false) {
      dispatchSms(config, 'rollback', {
        profile: profileName,
        timestamp: new Date().toISOString(),
        locale: config.auth?.locale,
      });
    }

    runDeployment(deployId, profile, profileName).catch((err) => {
      console.error(`[rollback] Unhandled error for ${deployId}:`, err);
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/deploy/:profile/health-check ────────────────────────────────────
router.post('/:profile/health-check', async (req, res) => {
  try {
    const profileName = req.params.profile;
    const config      = await readConfig();
    const profile     = config.profiles?.[profileName];
    if (!profile) return res.status(404).json({ error: `Profile "${profileName}" not found` });

    const result = await performHealthCheck(profile);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/deploy/:profile/cleanup ─────────────────────────────────────────
// Streams output via WebSocket; returns cleanupId for subscription.
router.post('/:profile/cleanup', async (req, res) => {
  try {
    const { profile: profileName } = req.params;
    const { mode = 'dangling' }    = req.body; // 'dangling' | 'all'

    const config  = await readConfig();
    const raw     = config.profiles?.[profileName];
    if (!raw) return res.status(404).json({ error: `Profile "${profileName}" not found` });

    const profile = mergeStep4IntoProfile(raw);

    const cleanupId = deployManager.create(`${profileName}-cleanup`);
    res.json({ cleanupId });

    // Run cleanup asynchronously
    runCleanup(cleanupId, profile, mode).catch(console.error);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Deployment engine ─────────────────────────────────────────────────────────

function mergeWizardIntoProfile(profile) {
  const wiz = profile.wizardConfig || {};
  const s2 = wiz.step2 || profile.step2 || {};
  const s4 = wiz.step4 || {};
  return {
    ...profile,
    step2: {
      targetOS: s2.targetOS || 'ubuntu-24.04',
      architecture: s2.architecture || 'x86_64',
    },
    hostingTarget: profile.hostingTarget || s4.hostingTarget || '',
    doMode:        profile.doMode        || s4.doMode        || 'existing',
    doSshKeyId:    String(profile.doSshKeyId || s4.doSshKeyId || '').trim(),
    doRegion:      profile.doRegion      || s4.doRegion      || 'lon1',
    doSize:        profile.doSize        || s4.doSize        || 's-1vcpu-2gb',
  };
}

/** @deprecated alias */
const mergeStep4IntoProfile = mergeWizardIntoProfile;

async function runDeployment(deployId, profile, profileName, options = {}) {
  const publish = options.mode === 'publish';
  const rebuild = options.mode === 'rebuild';
  deployManager.start(deployId);

  const config = await readConfig();
  profile = mergeStep4IntoProfile(withResolvedDoApiKey(config, profile));

  // Wire up AbortController so cancel endpoint can interrupt in-flight SSH work
  const ac = new AbortController();
  deployManager.setCancelFn(deployId, () => ac.abort());

  const target = profile.hostingTarget;
  const wiz    = profile.wizardConfig || {};

  // Read the current generated file contents for history snapshot
  const outputDir = path.join(profile.projectPath, 'wdp', profileName);
  const generatedFiles = {};
  for (const name of ['Dockerfile.deploy', 'docker-compose.deploy.yml', '.env.deploy']) {
    const fp = path.join(outputDir, name);
    if (fs.existsSync(fp)) generatedFiles[name] = fs.readFileSync(fp, 'utf8');
  }

  const historyEntry = {
    id:             deployId,
    profile:        profileName,
    hostingTarget:  target,
    deployMode:     rebuild ? 'rebuild' : publish ? 'publish' : 'full',
    startedAt:      new Date().toISOString(),
    completedAt:    null,
    outcome:        'running',
    exitCode:       null,
    commitHash:     null,
    deployTag:      null,
    generatedFiles,
    scanResults:    [],
    logs:           [],
  };

  // ── Security scanning + main deployment (one try/catch so blocking throws are handled) ──
  const step7   = wiz.step7 || {};
  const anyScan = !publish && !rebuild && step7.scanOnDeploy !== false && (
    step7.npmAudit || step7.osvScanner || step7.socketCli ||
    step7.gitleaks  || step7.trivy      || step7.grype     || step7.dockerScout
  );

  try {
    if (rebuild) {
      deployManager.log(deployId, '[WDP] ── Rebuild Droplet + Full deploy ─────────────────────────────');
      deployManager.log(deployId, '');
    } else if (publish) {
      deployManager.log(deployId, '[WDP] ── Publish changes (sync + rebuild app) ─────────────────────');
      deployManager.log(deployId, '[WDP] Skipping security scans — use Full deploy to run scanners.');
      deployManager.log(deployId, '');
    }

    if (anyScan && profile.projectPath) {
      deployManager.log(deployId, '[WDP] ── Security scanning ─────────────────────────────');
      deployManager.log(deployId, '');

      const dismissals = await readDismissals(profileName);

      let scanResults;
      try {
        scanResults = await runScanners(
          step7,
          profile.projectPath,
          (line, stream) => deployManager.log(deployId, line, stream),
        );
      } catch (err) {
        deployManager.log(deployId, `[Security] Scan phase error: ${err.message}`, 'stderr');
        scanResults = [];
      }

      historyEntry.scanResults = scanResults;
      deployManager.setScanResults(deployId, scanResults);

      // Block if blockOnCritical is enabled and there are undismissed CRITICAL findings
      if (step7.blockOnCritical) {
        const allFindings = scanResults.flatMap(r => r.findings);
        const criticalFindings = allFindings.filter(f => f.severity === 'CRITICAL');
        const blocking = criticalFindings.filter(f => !dismissals[f.id]);

        if (blocking.length > 0) {
          const titles = blocking.slice(0, 3).map(f => f.title).join('; ');
          deployManager.log(deployId, `\n⛔ Deployment blocked: ${blocking.length} undismissed CRITICAL finding(s) — ${titles}`, 'stderr');
          throw new Error(
            `Deployment blocked: ${blocking.length} undismissed CRITICAL finding(s) — ${titles}. ` +
            'Dismiss or fix these findings then re-deploy.',
          );
        }
      }

      deployManager.log(deployId, '');
      deployManager.log(deployId, '[WDP] ── Scanning complete — proceeding with deployment ───────────');
      deployManager.log(deployId, '');
    }

    if (target === 'local') {
      await deployLocal(deployId, profile, profileName);
    } else if (target === 'digitalocean' || target === 'vps') {
      if (target === 'digitalocean' && rebuild) {
        profile = await rebuildDropletAndPrepare(deployId, profile, profileName, options);
        deployManager.log(deployId, '[WDP] ── Full deploy to rebuilt Droplet ────────────────────────────');
        deployManager.log(deployId, '');
      } else if (target === 'digitalocean' && profile.doMode === 'provision' && !publish) {
        // Provision a new DigitalOcean Droplet if needed before SSH deploy
        profile = await provisionDroplet(deployId, profile, profileName);
      } else if (target === 'digitalocean' && profile.doMode !== 'provision' && !rebuild) {
        const osLabel = profile.step2?.targetOS || wiz.step2?.targetOS;
        if (osLabel) {
          deployManager.log(
            deployId,
            `[WDP] Using existing Droplet — Step 2 OS (${osLabel}) is not applied; only "Provision new Droplet" creates a server with that image.`,
          );
          deployManager.log(deployId, '');
        }
      }
      await deploySsh(deployId, profile, profileName, ac.signal, { publish });
    } else if (target === 'railway') {
      await deployRailway(deployId, profile, profileName);
    } else {
      throw new Error(`Unsupported hosting target: ${target}`);
    }

    // Determine the deployment URL from the health check (best-effort)
    let deployUrl = null;
    try {
      const hc = await performHealthCheck(profile);
      deployUrl = hc.url || null;
      if (deployUrl) {
        deployManager.log(deployId, `[WDP] 🌐 App available at: ${deployUrl}`);
      }
    } catch { /* non-fatal */ }

    deployManager.complete(deployId, true, 0, deployUrl);
    historyEntry.outcome     = 'success';
    historyEntry.exitCode    = 0;
    historyEntry.completedAt = new Date().toISOString();
    if (deployUrl) historyEntry.deployUrl = deployUrl;

    // Record current git commit hash and create a deploy tag (best-effort)
    try {
      const gitStatus = await git.getStatus(profile.projectPath);
      if (gitStatus.isRepo) {
        historyEntry.commitHash = gitStatus.commitHash;
        const tag = await git.createDeployTag(profile.projectPath, profileName);
        historyEntry.deployTag = tag;
        deployManager.log(deployId, `[WDP] Git tag created: ${tag}`);
      }
    } catch { /* non-fatal */ }

    // Dispatch success notification
    const cfgSuccess = await readConfig();
    const deployStateSuccess = deployManager.get(deployId);
    const logExcerpt = deployStateSuccess?.logs?.slice(-3).map(l => l.line).join(' ') || '';
    const notifyUrl = wiz.step5?.addons?.apprise?.notifyUrl;

    if (cfgSuccess.clickSend?.onSuccess !== false) {
      dispatchSms(cfgSuccess, 'deploy_success', {
        profile: profileName,
        timestamp: historyEntry.completedAt,
        locale: cfgSuccess.auth?.locale,
        logExcerpt,
        deployUrl: historyEntry.deployUrl,
      });
    }
    if (notifyUrl && wiz.step5.addons.apprise.onSuccess !== false) {
      notify(notifyUrl, {
        event: 'deploy_success',
        profile: profileName,
        success: true,
        message: `✅ Deployment of ${profileName} completed successfully`,
        timestamp: historyEntry.completedAt,
      }).catch(console.error);
    }

  } catch (err) {
    deployManager.log(deployId, `\nERROR: ${err.message}`, 'stderr');
    deployManager.complete(deployId, false, 1);
    historyEntry.outcome     = 'failed';
    historyEntry.exitCode    = 1;
    historyEntry.completedAt = new Date().toISOString();

    const notifyUrl = wiz.step5?.addons?.apprise?.notifyUrl;
    if (notifyUrl && wiz.step5.addons.apprise.onFailure !== false) {
      notify(notifyUrl, {
        event: 'deploy_failed',
        profile: profileName,
        success: false,
        message: `❌ Deployment of ${profileName} failed: ${err.message}`,
        timestamp: historyEntry.completedAt,
      }).catch(console.error);
    }
    const cfgFail = await readConfig();
    if (cfgFail.clickSend?.onFailure !== false) {
      dispatchSms(cfgFail, 'deploy_failed', {
        profile: profileName,
        timestamp: historyEntry.completedAt,
        locale: cfgFail.auth?.locale,
        detail: String(err.message || '').slice(0, 160),
      });
    }
  }

  // Capture the last N log lines for the history entry
  const deployState = deployManager.get(deployId);
  if (deployState) {
    historyEntry.logs = deployState.logs.slice(-MAX_HISTORY_LOG_LINES).map(l => l.line);
  }

  await appendHistory(historyEntry).catch(console.error);
}

// ── Local Docker deployment ───────────────────────────────────────────────────

async function deployLocal(deployId, profile, profileName) {
  const projectPath = profile.projectPath;
  const composePath = path.join(projectPath, 'wdp', profileName, 'docker-compose.deploy.yml');

  deployManager.log(deployId, `[WDP] Starting local Docker deployment`);
  deployManager.log(deployId, `[WDP] Profile:      ${profileName}`);
  deployManager.log(deployId, `[WDP] Project path: ${projectPath}`);
  deployManager.log(deployId, `[WDP] Compose file: ${composePath}`);
  deployManager.log(deployId, '');

  if (!fs.existsSync(composePath)) {
    throw new Error(`docker-compose.deploy.yml not found at ${composePath} — please complete Step 8 first`);
  }

  const envPath = path.join(projectPath, 'wdp', profileName, '.env.deploy');
  const args = [
    'compose',
    ...(fs.existsSync(envPath) ? ['--env-file', envPath] : []),
    '--project-directory', projectPath,
    '-f', composePath,
    'up', '-d', '--build',
  ];

  deployManager.log(deployId, `[WDP] Running: docker ${args.join(' ')}`);
  deployManager.log(deployId, '');

  await spawnAndStream('docker', args, deployId, {
    env: {
      ...dockerCliEnv(),
      DOCKER_BUILDKIT: '1',
      COMPOSE_DOCKER_CLI_BUILD: '1',
      COMPOSE_BAKE: '0',
    },
  });
  deployManager.log(deployId, '');
  deployManager.log(deployId, '[WDP] ✓ Deployment complete');
}

// ── SSH deployment ────────────────────────────────────────────────────────────

async function provisionDroplet(deployId, profile, profileName) {
  profile = mergeWizardIntoProfile(profile);
  const { doApiKey, doRegion = 'lon1', doSize = 's-1vcpu-2gb' } = profile;
  const doSshKeyId = String(profile.doSshKeyId || '').trim();
  if (!doApiKey) throw new Error('DigitalOcean API token is missing — return to Step 4.');

  const headers = {
    Authorization:  `Bearer ${doApiKey}`,
    'Content-Type': 'application/json',
  };

  deployManager.log(deployId, '[WDP] ── Provisioning new DigitalOcean Droplet ─────────────────────');
  deployManager.log(deployId, `[WDP] Region: ${doRegion}  Size: ${doSize}`);
  deployManager.log(deployId, '');

  // ── Step 1: Verify SSH key BEFORE creating the Droplet ───────────────────
  // Fail fast here — no point spending money on a Droplet we can't connect to.
  deployManager.log(deployId, '[WDP] Step 1/4 — Verifying SSH key...');
  let resolvedKeyPath = null;

  if (doSshKeyId) {
    const keyRes = await fetch(`https://api.digitalocean.com/v2/account/keys/${doSshKeyId}`, { headers });
    if (!keyRes.ok) throw new Error(`DO API ${keyRes.status} fetching SSH key details`);
    const { ssh_key } = await keyRes.json();
    deployManager.log(deployId, `[WDP] DO key: "${ssh_key.name}" (${ssh_key.fingerprint})`);

    const doParts      = ssh_key.public_key.trim().split(/\s+/);
    const doKeyMaterial = `${doParts[0]} ${doParts[1]}`;

    const sshDirs = [];
    try {
      fs.readdirSync('/home').filter(d => !d.startsWith('.')).forEach(u => sshDirs.push(`/home/${u}/.ssh`));
    } catch {}
    sshDirs.push('/root/.ssh');

    deployManager.log(deployId, `[WDP] Scanning .pub files in: ${sshDirs.join(', ')}`);

    outer: for (const dir of sshDirs) {
      try {
        for (const pubFile of fs.readdirSync(dir).filter(f => f.endsWith('.pub'))) {
          try {
            const content  = fs.readFileSync(path.join(dir, pubFile), 'utf8').trim();
            const parts    = content.split(/\s+/);
            const material = `${parts[0]} ${parts[1]}`;
            if (material === doKeyMaterial) {
              const privatePath = path.join(dir, pubFile.replace(/\.pub$/, ''));
              if (fs.existsSync(privatePath)) {
                resolvedKeyPath = privatePath;
                deployManager.log(deployId, `[WDP] ✓ Matched: ${pubFile} → ${privatePath}`);
                break outer;
              }
              deployManager.log(deployId, `[WDP] Public key matched (${pubFile}) but no private key at ${privatePath}`);
            }
          } catch {}
        }
      } catch {}
    }

    if (!resolvedKeyPath) {
      throw new Error(
        `Cannot find the private key for DO key "${ssh_key.name}".\n` +
        `Searched .pub files in: ${sshDirs.join(', ')}\n` +
        `Ensure your home directory is mounted: -v /home/youruser:/home/youruser`
      );
    }
  } else {
    throw new Error('No DO SSH key selected. Please return to Step 4 and select a key from the dropdown.');
  }

  deployManager.log(deployId, '[WDP] ✓ SSH key verified — proceeding to create Droplet.');
  deployManager.log(deployId, '');

  // ── Step 2: Resolve OS image ──────────────────────────────────────────────

  // Map wizard step2 values → DO image slug + Docker install script (from wizardConfig.step2)
  const targetOS   = profile.step2.targetOS;
  const archSlug   = profile.step2.architecture === 'arm64' ? 'aarch64' : 'x64';

  const OS_IMAGE_MAP = {
    'ubuntu-24.04': `ubuntu-24-04-${archSlug}`,
    'ubuntu-22.04': `ubuntu-22-04-${archSlug}`,
    'debian-12':    `debian-12-${archSlug}`,
    'alpine':       `ubuntu-24-04-${archSlug}`, // DO has no Alpine image; fall back to Ubuntu 24.04
  };
  const doImage = OS_IMAGE_MAP[targetOS] || `ubuntu-24-04-${archSlug}`;

  if (targetOS === 'alpine') {
    deployManager.log(deployId, '[WDP] Warning: DigitalOcean does not offer Alpine images — falling back to Ubuntu 24.04 LTS.');
  }

  // Docker CE install script — Debian uses the same apt method as Ubuntu, just a different repo URL
  const isDebian = targetOS === 'debian-12';
  const dockerDistro = isDebian ? 'debian' : 'ubuntu';
  const dockerUserData = [
    '#!/bin/bash',
    'set -e',   // abort on any error so sentinel is only written on full success
    'apt-get update -qq',
    'apt-get install -y -qq ca-certificates curl',
    'install -m 0755 -d /etc/apt/keyrings',
    `curl -fsSL https://download.docker.com/linux/${dockerDistro}/gpg -o /etc/apt/keyrings/docker.asc`,
    'chmod a+r /etc/apt/keyrings/docker.asc',
    `echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${dockerDistro} $(awk -F= '/^VERSION_CODENAME/{print $2}' /etc/os-release) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null`,
    'apt-get update -qq',
    'apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin',
    'systemctl enable docker',
    'systemctl start docker',
    'touch /tmp/wdp-docker-ready',   // sentinel — only written after Docker is fully up
  ].join('\n');

  deployManager.log(deployId, `[WDP] OS: ${targetOS} → image: ${doImage}`);

  // ── Step 3: Create the Droplet ────────────────────────────────────────────
  const body = {
    name:      `wdp-${profileName}-${Date.now()}`,
    region:    doRegion,
    size:      doSize,
    image:     doImage,
    ssh_keys:  doSshKeyId ? [doSshKeyId] : [],
    tags:      ['wdp', profileName],
    user_data: dockerUserData,
  };

  deployManager.log(deployId, `[WDP] Step 2/4 — Creating Droplet: ${body.name}...`);
  const createRes = await fetch('https://api.digitalocean.com/v2/droplets', {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  if (!createRes.ok) {
    const errBody = await createRes.json().catch(() => ({}));
    throw new Error(`DO API error ${createRes.status}: ${errBody.message || createRes.statusText}`);
  }
  const { droplet } = await createRes.json();
  const dropletId = droplet.id;
  deployManager.log(deployId, `[WDP] Droplet created (ID: ${dropletId}) — waiting for it to become active...`);

  // Poll until the droplet has a public IPv4 address (up to 5 minutes)
  let ipAddress = null;
  const pollStart = Date.now();
  const POLL_TIMEOUT = 5 * 60 * 1000;
  while (!ipAddress) {
    if (Date.now() - pollStart > POLL_TIMEOUT) {
      throw new Error(`Timed out waiting for Droplet ${dropletId} to become active after 5 minutes.`);
    }
    await new Promise(r => setTimeout(r, 8000));
    const pollRes = await fetch(`https://api.digitalocean.com/v2/droplets/${dropletId}`, { headers });
    if (!pollRes.ok) continue;
    const { droplet: d } = await pollRes.json();
    if (d.status === 'active') {
      ipAddress = d.networks?.v4?.find(n => n.type === 'public')?.ip_address || null;
    }
    if (!ipAddress) {
      const elapsed = Math.round((Date.now() - pollStart) / 1000);
      deployManager.log(deployId, `[WDP] Waiting for Droplet IP... (${elapsed}s elapsed, status: ${d.status})`);
    }
  }

  deployManager.log(deployId, `[WDP] ✓ Droplet is active — IP: ${ipAddress}`);
  deployManager.log(deployId, '');

  // ── Step 3: Poll SSH ──────────────────────────────────────────────────────
  // resolvedKeyPath was verified in Step 1 — build the SSH config now.
  deployManager.log(deployId, '[WDP] Step 3/4 — Waiting for SSH to become available...');
  let provisionSshCfg;
  try {
    provisionSshCfg = buildSshConfig({ sshHost: ipAddress, sshUser: 'root', sshKeyPath: resolvedKeyPath });
  } catch (err) {
    throw new Error(`Cannot load SSH key: ${err.message}`);
  }

  deployManager.log(deployId, '[WDP] Polling until SSH is ready...');
  const sshPollStart = Date.now();
  const SSH_POLL_TIMEOUT = 8 * 60 * 1000;
  let sshReady = false;
  while (!sshReady) {
    if (Date.now() - sshPollStart > SSH_POLL_TIMEOUT) {
      throw new Error(`SSH on ${ipAddress} did not become available within 8 minutes. The Droplet was created — check manually or increase the timeout.`);
    }
    try {
      // Update host in config for each attempt (port/timeouts stay the same)
      await testConnection({ ...provisionSshCfg, host: ipAddress });
      sshReady = true;
    } catch (err) {
      const elapsed = Math.round((Date.now() - sshPollStart) / 1000);
      deployManager.log(deployId, `[WDP] SSH not ready yet (${elapsed}s, ${err.message}) — retrying in 10s...`);
      await new Promise(r => setTimeout(r, 10000));
    }
  }
  deployManager.log(deployId, '[WDP] ✓ SSH is ready — Step 4/4: waiting for Docker to finish installing...');

  // Poll for the sentinel file written by cloud-init AFTER Docker is fully installed.
  // SSH comes up long before apt finishes — polling docker info immediately gives exit 127.
  const dockerSshCfg = { ...provisionSshCfg, host: ipAddress };
  const DOCKER_POLL_TIMEOUT = 12 * 60 * 1000;
  const dockerPollStart = Date.now();
  let dockerReady = false;
  while (!dockerReady) {
    if (Date.now() - dockerPollStart > DOCKER_POLL_TIMEOUT) {
      let ciLog = '(unavailable)';
      try {
        const r = await sshExec(dockerSshCfg, 'cloud-init status 2>/dev/null; echo "---"; tail -30 /var/log/cloud-init-output.log 2>/dev/null');
        ciLog = r.stdout.trim();
      } catch {}
      throw new Error(`Docker install did not complete on ${ipAddress} within 12 minutes.\ncloud-init log:\n${ciLog}`);
    }
    try {
      // Check sentinel first — only exists once Docker is fully installed + started
      const { code: sentinelCode } = await sshExec(dockerSshCfg, 'test -f /tmp/wdp-docker-ready');
      if (sentinelCode === 0) {
        // Sentinel exists — do a final sanity check
        const { code: infoCode, stderr } = await sshExec(dockerSshCfg, 'docker info > /dev/null 2>&1');
        if (infoCode === 0) {
          dockerReady = true;
        } else {
          throw new Error(`sentinel found but docker info failed${stderr ? ': ' + stderr.trim().split('\n')[0] : ''}`);
        }
      } else {
        // Still installing — check whether cloud-init already errored out
        const { stdout: ciStatus } = await sshExec(dockerSshCfg, 'cloud-init status 2>/dev/null || true');
        if (ciStatus.includes('error')) {
          const { stdout: ciLog } = await sshExec(dockerSshCfg, 'tail -30 /var/log/cloud-init-output.log 2>/dev/null').catch(() => ({ stdout: '' }));
          throw new Error(`cloud-init reported an error. Install log:\n${ciLog}`);
        }
        const elapsed = Math.round((Date.now() - dockerPollStart) / 1000);
        deployManager.log(deployId, `[WDP] Docker install in progress (${elapsed}s elapsed) — retrying in 15s...`);
        await new Promise(r => setTimeout(r, 15000));
      }
    } catch (err) {
      if (err.message.startsWith('cloud-init reported') || err.message.startsWith('sentinel found')) throw err;
      const elapsed = Math.round((Date.now() - dockerPollStart) / 1000);
      deployManager.log(deployId, `[WDP] Waiting for Docker install (${elapsed}s, ${err.message}) — retrying in 15s...`);
      await new Promise(r => setTimeout(r, 15000));
    }
  }
  deployManager.log(deployId, '[WDP] ✓ Docker is ready');
  deployManager.log(deployId, '');

  // Persist the IP back into the profile so future deploys use existing mode
  try {
    const cfg = await readConfig();
    if (cfg.profiles?.[profileName]) {
      const p = cfg.profiles[profileName];
      p.sshHost     = ipAddress;
      p.sshKeyPath  = resolvedKeyPath;
      p.doMode      = 'existing';
      p.doDropletId = dropletId;
      if (p.wizardConfig?.step4) {
        p.wizardConfig.step4 = {
          ...p.wizardConfig.step4,
          sshHost:    ipAddress,
          sshKeyPath: resolvedKeyPath,
          doMode:     'existing',
          hostingTarget: p.wizardConfig.step4.hostingTarget || p.hostingTarget || 'digitalocean',
        };
      }
      await writeConfig(cfg);
      deployManager.log(deployId, `[WDP] Profile updated: sshHost=${ipAddress}, doDropletId=${dropletId}, doMode=existing`);
    }
  } catch (e) {
    deployManager.log(deployId, `[WDP] Warning: could not persist Droplet IP to profile: ${e.message}`);
  }

  // Return updated profile object for the SSH deploy step
  return {
    ...profile,
    sshHost:    ipAddress,
    sshKeyPath: resolvedKeyPath,   // already verified & expanded — deploySsh must use this exact path
    doMode:     'existing',
  };
}

async function deploySsh(deployId, profile, profileName, signal, options = {}) {
  const publish = options.publish === true;
  const projectPath = profile.projectPath;
  const sshHost     = profile.sshHost;
  const sshKeyPath  = expandTilde(profile.sshKeyPath || '~/.ssh/id_ed25519');

  const composePath = path.join(projectPath, 'wdp', profileName, 'docker-compose.deploy.yml');
  if (!fs.existsSync(composePath)) {
    throw new Error(`Compose file not found at ${composePath} — run Generate Files first.`);
  }

  const composeRaw = fs.readFileSync(composePath, 'utf8');
  const {
    isExternalTraefik,
    isBundledTraefik,
    getTraefikNetwork,
    resolveDeployHostPorts,
  } = require('../lib/traefikDeploy');
  const traefikCfg = profile.wizardConfig?.step5?.addons?.traefik;
  const traefikRouting = Boolean(traefikCfg?.enabled);
  const traefikExternal = isExternalTraefik(traefikCfg);
  const traefikBundled = isBundledTraefik(traefikCfg);

  // Upgrade stale traefik:v3.0 pins before sync (bundled Traefik only; Docker Engine 29+)
  const { yaml: patchedYaml, changed, previous } = ensureTraefikImageInComposeYaml(composeRaw);
  if (changed) {
    fs.writeFileSync(composePath, patchedYaml, 'utf8');
    deployManager.log(
      deployId,
      `[WDP] Updated Traefik image ${previous} → ${TRAEFIK_IMAGE} (required for Docker Engine 29+)`,
    );
    deployManager.log(deployId, '');
  } else {
    const traefikImg = traefikBundled ? extractTraefikImageFromCompose(composeRaw) : null;
    if (traefikImg && !isTraefikImageDocker29Compatible(traefikImg)) {
      throw new Error(
        `Traefik image ${traefikImg} is incompatible with Docker Engine 29+. ` +
        `Regenerate files (Step 8) — WDP uses ${TRAEFIK_IMAGE}.`,
      );
    }
  }

  const remotePath = resolveRemoteDeployPath(profile, profileName);
  const sshCfg     = buildSshConfig({ ...profile, sshHost, sshKeyPath });
  let deployLogBuf = '';
  const onLine = (line, stream) => {
    deployLogBuf = `${deployLogBuf}${line}\n`.slice(-8000);
    deployManager.log(deployId, line, stream);
  };
  const logDeployHints = () => {
    for (const hint of hintsForDeployOutput(deployLogBuf)) {
      deployManager.log(deployId, hint, 'stderr');
    }
  };
  const hasEnvFile = fs.existsSync(path.join(projectPath, 'wdp', profileName, '.env.deploy'));

  deployManager.log(deployId, `[WDP] Starting SSH deployment`);
  deployManager.log(deployId, `[WDP] Profile:      ${profileName}`);
  deployManager.log(deployId, `[WDP] Host:         ${sshHost}`);
  deployManager.log(deployId, `[WDP] Remote path:  ${remotePath}`);
  deployManager.log(deployId, '');

  // 1. Sync project source to the server (Server → Files tab uses this path too)
  deployManager.log(deployId, `[WDP] Syncing project files to ${sshHost}:${remotePath}...`);
  deployManager.log(deployId, '[WDP] Excludes node_modules, .git, .wappler — dependencies install during Docker build');
  deployManager.log(deployId, '[WDP] Large projects may take a few minutes — progress lines appear below');
  deployManager.log(deployId, '');

  const syncHeartbeat = setInterval(() => {
    deployManager.log(deployId, '[WDP] Still syncing…');
  }, 30000);

  try {
    await transferDirectory(sshCfg, projectPath, remotePath, onLine, signal);
  } finally {
    clearInterval(syncHeartbeat);
  }

  deployManager.log(deployId, '');
  deployManager.log(deployId, '[WDP] ✓ Project files synced');
  deployManager.log(deployId, '');

  if (!(profile.remotePath || '').trim()) {
    try {
      const cfg = await readConfig();
      if (cfg.profiles?.[profileName]) {
        cfg.profiles[profileName].remotePath = remotePath;
        await writeConfig(cfg);
        deployManager.log(deployId, `[WDP] Remote path saved on profile (Server → Files): ${remotePath}`);
        deployManager.log(deployId, '');
      }
    } catch (e) {
      deployManager.log(deployId, `[WDP] Warning: could not save remotePath: ${e.message}`);
    }
  }

  // 2. Build image on the server (full deploy: explicit build; publish: combined with up below)
  if (!publish) {
    deployManager.log(deployId, `[WDP] Building Docker image on ${sshHost}...`);
    deployManager.log(deployId, '[WDP] (first deploy pulls base image — may take a few minutes)');
    deployManager.log(
      deployId,
      '[WDP] Step "npm ci" can take 5–15 min with no new lines — normal on small Droplets. '
        + 'Projects with sharp need more RAM; if SSH or the site dies, reboot the Droplet and regenerate Dockerfile (Step 8).',
    );
    deployManager.log(deployId, '');

    const buildExit = await execStream(
      sshCfg,
      remoteComposeShell(remotePath, profileName, 'build', { hasEnvFile }),
      onLine,
      signal,
    );
    if (buildExit !== 0) throw new Error(`docker compose build failed (exit ${buildExit})`);

    deployManager.log(deployId, '');
    deployManager.log(deployId, '[WDP] ✓ Image built');
    deployManager.log(deployId, '');
  } else {
    deployManager.log(deployId, `[WDP] Publish: rebuilding app on ${sshHost} (BuildKit layer cache + npm cache)`);
    deployManager.log(deployId, '[WDP] When package-lock.json is unchanged, apt/npm steps should show CACHED — only app files rebuild');
    deployManager.log(deployId, '');

    const dockerfilePath = path.join(projectPath, 'wdp', profileName, 'Dockerfile.deploy');
    try {
      const dockerfileRaw = fs.readFileSync(dockerfilePath, 'utf8');
      if (!dockerfileHasBuildKitCaches(dockerfileRaw)) {
        deployManager.log(
          deployId,
          '[WDP] ⚠ Dockerfile.deploy is missing BuildKit cache mounts — apt/npm may reinstall on every publish.',
        );
        deployManager.log(deployId, '[WDP]   Fix: Step 8 → Regenerate files for this profile, then Publish again.');
        deployManager.log(deployId, '');
      } else if (dockerfileInstallsLibvipsDev(dockerfileRaw)) {
        deployManager.log(
          deployId,
          '[WDP] ⚠ Dockerfile installs libvips-dev — Debian pulls ImageMagick (libmagickcore, libxml2, …) on every uncached build.',
        );
        deployManager.log(
          deployId,
          '[WDP]   sharp uses prebuilt binaries on bookworm — only wget is needed. Regenerate Step 8 after updating WDP.',
        );
        deployManager.log(deployId, '');
      } else if (dockerfileUsesLegacyBookwormProdStage(dockerfileRaw)) {
        deployManager.log(
          deployId,
          '[WDP] ⚠ Dockerfile uses an older two-stage bookworm layout (duplicate apt on each publish).',
        );
        deployManager.log(deployId, '[WDP]   Fix: Step 8 → Regenerate files — WDP now uses single-stage bookworm for faster publish.');
        deployManager.log(deployId, '');
      }
    } catch {
      deployManager.log(deployId, '[WDP] Warning: could not read Dockerfile.deploy for cache preflight');
      deployManager.log(deployId, '');
    }

    const cacheProbe = await execStream(
      sshCfg,
      'docker buildx version 2>/dev/null | head -1 || docker version --format "Engine {{.Server.Version}}"',
      onLine,
      signal,
    );
    if (cacheProbe !== 0) {
      deployManager.log(deployId, '[WDP] Warning: could not verify remote Docker BuildKit support', 'stderr');
    }
    deployManager.log(deployId, '');

    const buildExit = await execStream(
      sshCfg,
      remoteComposeShell(remotePath, profileName, 'build --pull=false app', { hasEnvFile }),
      onLine,
      signal,
    );
    if (buildExit !== 0) throw new Error('docker compose build app failed during publish');

    deployManager.log(deployId, '');
    deployManager.log(deployId, '[WDP] ✓ App image built');
    deployManager.log(deployId, '');
  }

  // 3. Ensure external Traefik Docker network exists on the remote host
  const composeForPorts = changed ? patchedYaml : composeRaw;
  const isRemoteHost = profile.hostingTarget !== 'local';
  if (traefikRouting && isRemoteHost) {
    const traefikNet = getTraefikNetwork(traefikCfg);
    deployManager.log(deployId, `[WDP] Ensuring Docker network "${traefikNet}" exists on remote...`);
    await execStream(
      sshCfg,
      `docker network create ${shellQuote(traefikNet)} 2>/dev/null || true`,
      onLine,
      signal,
    );
    if (traefikExternal) {
      deployManager.log(deployId, '[WDP] Using existing Traefik on the server — ports 80/443 will not be released');
    }
    deployManager.log(deployId, '');
  }

  // 4. Start / update containers
  deployManager.log(deployId, `[WDP] Starting containers...`);
  const hostPorts = resolveDeployHostPorts(profile, composeForPorts);
  if (!publish && hostPorts.length) {
    await releaseHostPorts(sshCfg, deployId, hostPorts, onLine, signal);
  }

  deployManager.log(deployId, '');

  const upSubcmd = publish
    ? 'up -d --remove-orphans'
    : 'up -d --remove-orphans --force-recreate';

  let upExit = await execStream(
    sshCfg,
    remoteComposeShell(remotePath, profileName, upSubcmd, { hasEnvFile }),
    onLine,
    signal,
  );

  if (upExit !== 0 && !publish) {
    deployManager.log(deployId, '[WDP] ⚠ up failed — tearing down stale stack and retrying...');
    deployManager.log(deployId, '');
    await execStream(
      sshCfg,
      remoteComposeShell(remotePath, profileName, 'down --remove-orphans', { hasEnvFile }),
      onLine,
      signal,
    );
    const projectSlug = path.basename(remotePath.replace(/\/+$/, ''));
    await execStream(
      sshCfg,
      `docker ps -aq --filter label=com.docker.compose.project=${projectSlug} | xargs -r docker rm -f 2>/dev/null || true`,
      onLine,
      signal,
    );
    await releaseHostPorts(sshCfg, deployId, hostPorts, onLine, signal);
    deployManager.log(deployId, '');
    upExit = await execStream(
      sshCfg,
      remoteComposeShell(remotePath, profileName, 'up -d --remove-orphans', { hasEnvFile }),
      onLine,
      signal,
    );
  } else if (upExit !== 0 && publish) {
    logDeployHints();
    throw new Error('docker compose up failed during publish — try Full deploy if the stack is stuck');
  }

  if (upExit !== 0) {
    logDeployHints();
    throw new Error(`docker compose up failed (exit ${upExit})`);
  }

  if (traefikBundled) {
    await assertTraefikDockerProviderHealthy(sshCfg, deployId, onLine, signal);
  } else if (traefikExternal) {
    deployManager.log(deployId, '[WDP] Skipping bundled Traefik log check — using existing server Traefik');
    deployManager.log(deployId, '');
  }

  deployManager.log(deployId, '');
  deployManager.log(deployId, '[WDP] ✓ Deployment complete');
}

/** Fail fast if Traefik cannot talk to Docker 29+ (classic symptom: site 404, API 1.24 too old). */
async function assertTraefikDockerProviderHealthy(sshCfg, deployId, onLine, signal) {
  deployManager.log(deployId, '[WDP] Verifying Traefik can read Docker routes (Engine 29+)...');
  const script = [
    'sleep 3',
    'c=$(docker ps --format "{{.Names}}" | grep -i traefik | head -1)',
    'if [ -z "$c" ]; then echo "NO_TRAEFIK_CONTAINER"; exit 0; fi',
    'docker logs "$c" 2>&1 | tail -30',
  ].join('; ');
  let buf = '';
  const code = await execStream(sshCfg, script, (line) => {
    buf += `${line}\n`;
    onLine(line);
  }, signal);
  if (code !== 0) return;
  if (buf.includes('NO_TRAEFIK_CONTAINER')) {
    deployManager.log(deployId, '[WDP] ⚠ No Traefik container found — skip route verification', 'stderr');
    return;
  }
  if (buf.includes(DOCKER29_API_ERROR)) {
    throw new Error(
      `Traefik cannot connect to Docker Engine 29+ (API version mismatch). ` +
      `Ensure compose uses ${TRAEFIK_IMAGE} or newer, then redeploy.`,
    );
  }
  deployManager.log(deployId, '[WDP] ✓ Traefik Docker provider OK');
}

// ── Railway deployment ────────────────────────────────────────────────────────

async function deployRailway(deployId, profile, profileName) {
  deployManager.log(deployId, '[WDP] Railway deployment via CLI');
  deployManager.log(deployId, '');
  deployManager.log(deployId, 'Railway deployments require the Railway CLI to be installed and authenticated.');
  deployManager.log(deployId, 'Run the following command in your project directory:');
  deployManager.log(deployId, '');
  deployManager.log(deployId, `  railway up --service ${profileName}`);
  deployManager.log(deployId, '');
  deployManager.log(deployId, 'See https://docs.railway.app/develop/cli for setup instructions.');
  deployManager.log(deployId, '');
  deployManager.log(deployId, '[WDP] Railway API integration coming in a future update.');
  // Not a hard failure — user can follow manual steps
}

// ── Post-deploy health check ──────────────────────────────────────────────────

// When WDP runs inside Docker, localhost is the container — not the host.
// host.docker.internal resolves to the host gateway (requires --add-host or extra_hosts).
const IN_DOCKER = fs.existsSync('/.dockerenv');

async function performHealthCheck(profile) {
  const target     = profile.hostingTarget;
  const wiz        = profile.wizardConfig || {};
  const traefikOn  = wiz.step5?.addons?.traefik?.enabled;
  const domain     = profile.domain || wiz.step5?.addons?.traefik?.domain;
  const appPort    = profile.appPort || 3000;

  let checkUrl;
  let displayUrl; // shown to the user — host.docker.internal → localhost

  if (target === 'local') {
    const probeHost = IN_DOCKER ? 'host.docker.internal' : 'localhost';
    checkUrl   = `http://${probeHost}:${appPort}/`;
    displayUrl = `http://localhost:${appPort}/`;
  } else if (traefikOn && domain) {
    const host = String(domain).replace(/^https?:\/\//, '').replace(/\/$/, '');
    checkUrl   = `https://${host}/`;
    displayUrl = checkUrl;
  } else if (domain && profile.sshHost) {
    const host = String(domain).replace(/^https?:\/\//, '').replace(/\/$/, '');
    checkUrl   = `http://${host}:${appPort}/`;
    displayUrl = checkUrl;
  } else if (profile.sshHost) {
    checkUrl   = `http://${profile.sshHost}:${appPort}/`;
    displayUrl = checkUrl;
  } else {
    return { ok: false, message: 'Cannot determine health check URL — no domain or host configured' };
  }

  try {
    const { statusCode } = await httpHead(checkUrl);
    const ok = statusCode >= 200 && statusCode < 500;
    return {
      ok,
      url:        displayUrl,
      statusCode,
      message:    ok ? `App responded with ${statusCode}` : `App returned ${statusCode}`,
    };
  } catch (err) {
    return { ok: false, url: displayUrl || checkUrl, message: `Health check failed: ${err.message}` };
  }
}

function httpHead(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https://') ? https : http;
    const req = lib.get(url, { timeout: 10000 }, (res) => {
      res.resume();
      resolve({ statusCode: res.statusCode });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Health check timed out')); });
  });
}

// ── Docker cleanup ────────────────────────────────────────────────────────────

async function runCleanup(cleanupId, profile, mode) {
  deployManager.start(cleanupId);

  const target    = profile.hostingTarget;
  const pruneFlag = mode === 'all' ? '-af' : '-f';

  deployManager.log(cleanupId, `[WDP] Running docker system prune ${pruneFlag}`);

  try {
    if (target === 'local') {
      await spawnAndStream('docker', ['system', 'prune', pruneFlag], cleanupId);
    } else {
      if (!profile.sshHost) {
        throw new Error('No SSH host configured for this profile.');
      }
      const sshCfg = buildSshConfig(profile);
      deployManager.log(cleanupId, `[WDP] Host: ${profile.sshHost}`);
      deployManager.log(cleanupId, '');
      const exitCode = await execStream(
        sshCfg,
        `docker system prune ${pruneFlag}`,
        (line, stream) => deployManager.log(cleanupId, line, stream),
      );
      if (exitCode !== 0) throw new Error(`docker prune exited with code ${exitCode}`);
    }
    deployManager.log(cleanupId, '[WDP] ✓ Cleanup complete');
    deployManager.complete(cleanupId, true, 0);
  } catch (err) {
    deployManager.log(cleanupId, `ERROR: ${err.message}`, 'stderr');
    deployManager.complete(cleanupId, false, 1);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/** Remote directory for synced source + docker compose (Server → Files tab). */
function resolveRemoteDeployPath(profile, profileName) {
  const custom = (profile.remotePath || '').trim();
  if (custom) return custom.replace(/\/+$/, '');
  const app = dockerImageSlug(profile.detectedName || profileName);
  return `/opt/wdp/${app}`;
}

/**
 * Stop anything on the Droplet holding host ports (Docker + compose filters miss some cases).
 */
async function releaseHostPorts(sshCfg, deployId, ports, onLine, signal) {
  deployManager.log(deployId, `[WDP] Releasing host ports ${ports.join(', ')} if in use...`);
  const portChecks = ports.map((p) => `
echo "[WDP] port ${p}"
docker ps -q --filter publish=${p} 2>/dev/null | xargs -r docker rm -f 2>/dev/null || true
for cid in $(docker ps -q 2>/dev/null); do
  docker port "$cid" 2>/dev/null | grep -q ":${p}->" && docker rm -f "$cid" 2>/dev/null || true
done
`).join('');
  const script = `set +e
${portChecks}
command -v fuser >/dev/null 2>&1 && for p in ${ports.join(' ')}; do fuser -k "$p/tcp" 2>/dev/null || true; done
true`;
  await execStream(sshCfg, script, onLine, signal);
}

/** Shell command to run docker compose on the server after files are synced. */
function remoteComposeShell(remotePath, profileName, subcmd, { hasEnvFile } = {}) {
  const composeFile = `wdp/${profileName}/docker-compose.deploy.yml`;
  const envFlag     = hasEnvFile ? ` --env-file wdp/${profileName}/.env.deploy` : '';
  const exports     = 'export DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 COMPOSE_BAKE=0 NO_COLOR=1 COMPOSE_ANSI=never; ';
  // --project-directory must be the synced project root (where package.json lives).
  // Without it, Compose uses the compose file's folder and resolves dockerfile as
  // wdp/profile/wdp/profile/... (see generateCompose build.dockerfile path).
  return (
    `${exports}cd ${shellQuote(remotePath)} && ` +
    `docker compose --progress plain${envFlag} --project-directory . -f ${shellQuote(composeFile)} ${subcmd}`
  );
}

/**
 * Spawn a local process and stream stdout/stderr line-by-line.
 * Supports AbortSignal for cancellation.
 */
function spawnStream(command, args, opts, onLine, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Cancelled'));

    const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });

    const onAbort = () => {
      try { proc.kill('SIGTERM'); } catch {}
      reject(new Error('Cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    let buf = '';
    const flush = (chunk, isStderr) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (line.trim()) onLine && onLine(line, isStderr ? 'stderr' : 'stdout');
      }
    };

    proc.stdout.on('data', (d) => flush(d.toString(), false));
    proc.stderr.on('data', (d) => flush(d.toString(), true));

    proc.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (buf.trim()) onLine && onLine(buf, 'stdout');
      resolve(code);
    });
    proc.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      reject(err);
    });
  });
}

function spawnAndStream(command, args, deployId, opts = {}) {
  const ignoreExitCode = opts.ignoreExitCode || false;
  const spawnOpts = { stdio: ['ignore', 'pipe', 'pipe'], ...opts };
  delete spawnOpts.ignoreExitCode;
  if (command === 'docker') {
    spawnOpts.env = dockerCliEnv(spawnOpts.env || process.env);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, spawnOpts);

    const handleChunk = (chunk, stream) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) deployManager.log(deployId, line, stream);
      }
    };

    proc.stdout.on('data', (d) => handleChunk(d, 'stdout'));
    proc.stderr.on('data', (d) => handleChunk(d, 'stderr'));

    proc.on('close', (code) => {
      if (code === 0 || ignoreExitCode) resolve(code);
      else reject(new Error(`Command "${command}" exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

module.exports = router;
module.exports.triggerDeploy = triggerDeploy;
