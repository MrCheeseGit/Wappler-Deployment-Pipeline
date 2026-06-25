'use strict';

const express = require('express');
const router  = express.Router();

const path = require('path');
const { readConfig } = require('../lib/configStore');
const git = require('../lib/git');
const { profilesSharingProjectPath } = require('../lib/projectPathGuards');

/** Phase A only: init + status. Diff, commit, and deploy tags return 501 until GitHub integration ships. */
const GIT_BEYOND_INIT_ENABLED = false;

function gitBeyondInitDisabled(_req, res) {
  res.status(501).json({
    error: 'Git diff, commit, and deploy tags are not available yet. Only Initialise Git is enabled in WDP for now.',
  });
}

// ── POST /api/git/:profile/init — git init + WDP .gitignore (+ optional first commit)
router.post('/:profile/init', async (req, res) => {
  try {
    const config      = await readConfig();
    const profileName = req.params.profile;
    const profileData = config.profiles?.[profileName];
    if (!profileData) return res.status(404).json({ error: 'Profile not found.' });
    if (!profileData.projectPath) {
      return res.status(400).json({ error: 'Profile has no project path. Set it in Step 1.' });
    }

    const hostingTarget = profileData.hostingTarget || profileData.wizardConfig?.step4?.hostingTarget || '';
    const shared = profilesSharingProjectPath(config, profileData.projectPath, profileName, { hostingTarget });
    if (shared.length) {
      return res.status(409).json({
        error: `This project folder already has a ${hostingTarget || 'deployment'} profile: ${shared.join(', ')}. Local and remote targets may share one project; duplicate targets need another folder.`,
        sharedWith: shared,
        projectPath: path.resolve(profileData.projectPath),
      });
    }

    const result = await git.initRepositoryForProfile(
      profileData.projectPath,
      profileName,
      {
        initialCommit: req.body?.initialCommit !== false,
        commitMessage: req.body?.commitMessage,
      },
    );
    res.json({ ok: true, profile: profileName, ...result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── GET /api/git/:profile/status ──────────────────────────────────────────────
router.get('/:profile/status', async (req, res) => {
  try {
    const config      = await readConfig();
    const profileData = config.profiles?.[req.params.profile];
    if (!profileData) return res.status(404).json({ error: 'Profile not found.' });

    const status = await git.getStatus(profileData.projectPath);
    const sharedWith = profilesSharingProjectPath(config, profileData.projectPath, req.params.profile);
    res.json({
      ...status,
      projectPath: path.resolve(profileData.projectPath),
      sharedWith,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/git/:profile/diff ────────────────────────────────────────────────
router.get('/:profile/diff', (req, res, next) => {
  if (!GIT_BEYOND_INIT_ENABLED) return gitBeyondInitDisabled(req, res);
  next();
}, async (req, res) => {
  try {
    const config      = await readConfig();
    const profileData = config.profiles?.[req.params.profile];
    if (!profileData) return res.status(404).json({ error: 'Profile not found.' });

    const diff = await git.getDiff(profileData.projectPath, req.params.profile);
    res.json({ diff });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/git/:profile/commit ─────────────────────────────────────────────
router.post('/:profile/commit', (req, res, next) => {
  if (!GIT_BEYOND_INIT_ENABLED) return gitBeyondInitDisabled(req, res);
  next();
}, async (req, res) => {
  try {
    const config      = await readConfig();
    const profileName = req.params.profile;
    const profileData = config.profiles?.[profileName];
    if (!profileData) return res.status(404).json({ error: 'Profile not found.' });

    const message = (typeof req.body.message === 'string' && req.body.message.trim())
      || `chore(wdp): regenerate ${profileName} deployment files`;

    const commitHash = await git.commitWdpFiles(profileData.projectPath, profileName, message);
    res.json({ success: true, commitHash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/git/:profile/tag ────────────────────────────────────────────────
router.post('/:profile/tag', (req, res, next) => {
  if (!GIT_BEYOND_INIT_ENABLED) return gitBeyondInitDisabled(req, res);
  next();
}, async (req, res) => {
  try {
    const config      = await readConfig();
    const profileName = req.params.profile;
    const profileData = config.profiles?.[profileName];
    if (!profileData) return res.status(404).json({ error: 'Profile not found.' });

    const tag = await git.createDeployTag(profileData.projectPath, profileName);
    res.json({ success: true, tag });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
