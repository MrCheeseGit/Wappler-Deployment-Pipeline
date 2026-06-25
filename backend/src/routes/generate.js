'use strict';

const fs   = require('fs');
const path = require('path');
const express = require('express');
const router = express.Router();

const { generateDockerfile } = require('../lib/generators/generateDockerfile');
const { generateCompose }    = require('../lib/generators/generateCompose');
const { generateEnv }        = require('../lib/generators/generateEnv');
const { readConfig, writeConfig } = require('../lib/configStore');
const { generateRelevantWizardFingerprint } = require('../lib/profileGeneratedFiles');
const { normalizeHostname } = require('../lib/hostname');
const { ensureProjectGitignore } = require('../lib/git');

/**
 * POST /api/generate
 * Body: { config: <wizard store snapshot> }
 * Generates Dockerfile.deploy, docker-compose.deploy.yml, .env.deploy and
 * writes them to {projectRoot}/wdp/{profile}/.
 * Saves the profile config to wdp-config.json for use by the deploy route.
 * Returns the generated file contents for preview.
 */
router.post('/', async (req, res) => {
  try {
    const config = req.body.config;
    if (!config) return res.status(400).json({ error: 'Missing config in request body.' });

    const step1   = config.step1 || {};
    const profile = config.activeProfile;

    if (!step1.projectPath) return res.status(400).json({ error: 'No project path in config.' });
    if (!profile)           return res.status(400).json({ error: 'No active profile in config.' });

    // Validate project path still exists
    const pkgPath = path.join(step1.projectPath, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      return res.status(400).json({ error: `package.json not found at: ${pkgPath}` });
    }

    // Sanitise profile name to prevent path traversal
    const safeProfile = path.basename(profile);
    if (safeProfile !== profile || profile.includes('..')) {
      return res.status(400).json({ error: 'Invalid profile name.' });
    }

    // Output directory: {projectRoot}/wdp/{profile}/
    const outputDir = path.join(step1.projectPath, 'wdp', safeProfile);
    fs.mkdirSync(outputDir, { recursive: true });

    const packageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    // Generate file contents
    const dockerfileContent = generateDockerfile(config, packageJson);
    const composeContent    = generateCompose(config);
    const envContent        = generateEnv(config);

    // Write files
    const dockerfilePath = path.join(outputDir, 'Dockerfile.deploy');
    const composePath    = path.join(outputDir, 'docker-compose.deploy.yml');
    const envPath        = path.join(outputDir, '.env.deploy');

    fs.writeFileSync(dockerfilePath, dockerfileContent, 'utf8');
    fs.writeFileSync(composePath,    composeContent,    'utf8');
    fs.writeFileSync(envPath,        envContent,        'utf8');

    // Write .dockerignore to the project root so Docker's build context excludes large dirs.
    // This is what makes DOCKER_HOST=ssh:// fast — only source files are sent to the remote daemon.
    const dockerignorePath = path.join(step1.projectPath, '.dockerignore');
    if (!fs.existsSync(dockerignorePath)) {
      fs.writeFileSync(dockerignorePath, [
        'node_modules',
        '.git',
        '.wappler',
        '.wappler_backup',
        'uploads',
        '*.log',
        '.env',
        '.env.*',
        '.DS_Store',
      ].join('\n') + '\n', 'utf8');
    }

    // Ensure wdp/ directory entries are gitignored for secrets
    ensureProjectGitignore(step1.projectPath, safeProfile);

    // Persist the profile config to wdp-config.json so deploy route can read it
    const step4 = config.step4 || {};
    const wdpConfig = await readConfig();
    wdpConfig.profiles = wdpConfig.profiles || {};

    // Preserve runtime fields set by a previous provision so that re-generating
    // files (e.g. to add Redis) does NOT reset doMode back to 'provision' and
    // accidentally create a new Droplet on the next deploy.
    const existing = wdpConfig.profiles[safeProfile] || {};
    const isLocal = step4.hostingTarget === 'local';
    const alreadyProvisioned = !isLocal && existing.doMode === 'existing' && existing.sshHost;
    const incomingDoKey = (step4.doApiKey || '').trim();
    const doApiKey = incomingDoKey || existing.doApiKey || '';
    const step4Saved = isLocal ? { ...step4, sshHost: '' } : step4;

    wdpConfig.profiles[safeProfile] = {
      ...existing,
      projectPath:   step1.projectPath,
      detectedName:  step1.detectedName  || '',
      hostingTarget: step4.hostingTarget || '',
      sshHost:       isLocal ? '' : (alreadyProvisioned ? existing.sshHost : (step4.sshHost || '')),
      sshUser:       step4.sshUser       || 'root',
      sshKeyPath:    isLocal ? '' : (alreadyProvisioned ? existing.sshKeyPath : (step4.sshKeyPath || '')),
      remotePath:    step4.remotePath    || '',
      doDropletId:   existing.doDropletId || null,
      doMode:        alreadyProvisioned ? 'existing'          : (step4.doMode     || 'existing'),
      doApiKey,
      doRegion:      step4.doRegion      || 'lon1',
      doSize:        step4.doSize        || 's-1vcpu-1gb',
      doSshKeyId:    String(step4.doSshKeyId || '').trim(),
      doDropletId:   step4.doDropletId ? String(step4.doDropletId) : (existing.doDropletId || null),
      // Strip protocol prefix stored by the UI (e.g. https://example.com → example.com)
      domain:        normalizeHostname(config.step5?.addons?.traefik?.domain || ''),
      appPort:       3000,
      wizardConfig:  {
        ...config,
        step4: { ...step4Saved, doApiKey },
      },
      generatedAt:     new Date().toISOString(),
      configUpdatedAt: new Date().toISOString(),
      wizardFingerprintAtGenerate: generateRelevantWizardFingerprint({
        ...config,
        step4: { ...step4Saved, doApiKey },
      }),
    };
    await writeConfig(wdpConfig);

    const generatedAt = wdpConfig.profiles[safeProfile].generatedAt;
    return res.json({
      success: true,
      profile: safeProfile,
      outputDir,
      generatedAt,
      files: {
        'Dockerfile.deploy':          dockerfileContent,
        'docker-compose.deploy.yml':  composeContent,
        '.env.deploy':                envContent,
      }
    });
  } catch (err) {
    console.error('[generate] Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/generate/:profile
 * Returns previously generated file contents for a profile if they exist on disk.
 */
router.get('/:profile', async (req, res) => {
  try {
    const profile = req.params.profile;
    if (!profile) return res.status(400).json({ error: 'Missing profile.' });

    // We need the project path — read it from the saved config
    const config = await readConfig();
    const profileData = config.profiles && config.profiles[profile];
    if (!profileData || !profileData.projectPath) {
      return res.status(404).json({ error: 'Profile not found or has no project path.' });
    }

    const safeProfile = path.basename(profile);
    const outputDir = path.join(profileData.projectPath, 'wdp', safeProfile);

    const files = {};
    for (const name of ['Dockerfile.deploy', 'docker-compose.deploy.yml', '.env.deploy']) {
      const filePath = path.join(outputDir, name);
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        files[name] = {
          content: fs.readFileSync(filePath, 'utf8'),
          mtime: stat.mtime.toISOString(),
        };
      }
    }

    if (Object.keys(files).length === 0) {
      return res.status(404).json({ error: 'No generated files found for this profile.' });
    }

    return res.json({ success: true, profile: safeProfile, files });
  } catch (err) {
    console.error('[generate] GET error:', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
