'use strict';

const fs   = require('fs');
const path = require('path');
const { normalizeHostname } = require('./hostname');

const GENERATED_FILE_NAMES = [
  'Dockerfile.deploy',
  'docker-compose.deploy.yml',
  '.env.deploy',
];

function getOutputDir(projectPath, profile) {
  const safe = path.basename(profile);
  return path.join(projectPath, 'wdp', safe);
}

function missingGeneratedFiles(projectPath, profile) {
  if (!projectPath || !profile) return [...GENERATED_FILE_NAMES];
  const dir = getOutputDir(projectPath, profile);
  return GENERATED_FILE_NAMES.filter(name => !fs.existsSync(path.join(dir, name)));
}

/** Newest mtime among generated deploy files on disk (legacy profiles may lack generatedAt). */
function latestGeneratedFileMtime(projectPath, profile) {
  if (!projectPath || !profile) return null;
  const dir = getOutputDir(projectPath, profile);
  let maxMs = 0;
  for (const name of GENERATED_FILE_NAMES) {
    const fp = path.join(dir, name);
    try {
      if (fs.existsSync(fp)) {
        const m = fs.statSync(fp).mtimeMs;
        if (m > maxMs) maxMs = m;
      }
    } catch { /* ignore */ }
  }
  return maxMs > 0 ? new Date(maxMs).toISOString() : null;
}

function resolveGeneratedAt(profile, profileName) {
  return profile.generatedAt || latestGeneratedFileMtime(profile.projectPath, profileName);
}

/** Full wizard JSON — session dirty checks only; not used for stale deploy files. */
function wizardConfigFingerprint(wc) {
  if (!wc || typeof wc !== 'object') return '';
  const copy = { ...wc };
  delete copy.currentStep;
  delete copy.maxReachedStep;
  delete copy.completedSteps;
  delete copy.activeProfile;
  return JSON.stringify(copy);
}

/**
 * Fingerprint of wizard settings that affect Dockerfile / compose / .env.deploy.
 * Excludes runtime-only fields (SSH host, detected Droplet OS labels, rebuild UI prefs).
 */
function generateRelevantWizardFingerprint(wc) {
  if (!wc || typeof wc !== 'object') return '';

  const step1 = wc.step1 || {};
  const step2 = wc.step2 || {};
  const step3 = wc.step3 || {};
  const step4 = wc.step4 || {};
  const step5 = wc.step5 || {};
  const step6 = wc.step6 || {};

  const addons = step5.addons ? { ...step5.addons } : {};
  if (addons.traefik?.domain) {
    addons.traefik = {
      ...addons.traefik,
      domain: normalizeHostname(addons.traefik.domain),
    };
  }
  if (addons.plausible?.domain) {
    addons.plausible = {
      ...addons.plausible,
      domain: normalizeHostname(addons.plausible.domain),
    };
  }

  return JSON.stringify({
    step1: {
      projectPath: step1.projectPath || '',
      detectedName: step1.detectedName || '',
      detectedNodeVersion: step1.detectedNodeVersion || '',
    },
    step2: {
      targetOS: step2.targetOS || '',
      architecture: step2.architecture || '',
    },
    step3,
    step4: {
      hostingTarget: step4.hostingTarget || '',
    },
    step5: { ...step5, addons },
    step6,
  });
}

/** Normalize stored fingerprint (legacy full wizard JSON or current relevant JSON). */
function resolveFingerprintAtGenerate(stored) {
  if (!stored) return '';
  try {
    const parsed = JSON.parse(stored);
    if (parsed && typeof parsed === 'object') {
      return generateRelevantWizardFingerprint(parsed);
    }
  } catch { /* not JSON */ }
  return stored;
}

/**
 * Whether deploy artifacts are out of date relative to saved wizard config.
 * @returns {{ stale: boolean, reasons: string[], missingFiles: string[], generatedAt?: string, configUpdatedAt?: string }}
 */
function evaluateProfileStale(profile, profileName) {
  const reasons = [];
  if (!profile) {
    return { stale: true, reasons: ['no_profile'], missingFiles: [...GENERATED_FILE_NAMES] };
  }

  const missing = missingGeneratedFiles(profile.projectPath, profileName);
  const effectiveGeneratedAt = resolveGeneratedAt(profile, profileName);
  const hasArtifacts = Boolean(effectiveGeneratedAt);
  const allMissing = missing.length === GENERATED_FILE_NAMES.length;
  const someMissing = missing.length > 0 && !allMissing;

  if (!hasArtifacts && allMissing) {
    reasons.push('never_generated');
  } else if (someMissing || (allMissing && hasArtifacts)) {
    reasons.push('missing_files');
  }

  const genMs = effectiveGeneratedAt ? Date.parse(effectiveGeneratedAt) : 0;
  const updMs = profile.configUpdatedAt ? Date.parse(profile.configUpdatedAt) : 0;
  const fpNow = generateRelevantWizardFingerprint(profile.wizardConfig);
  const fpAtGen = resolveFingerprintAtGenerate(profile.wizardFingerprintAtGenerate || '');
  let configChanged = false;
  if (fpAtGen) {
    configChanged = fpNow !== fpAtGen;
  } else if (genMs && updMs && updMs > genMs + 500) {
    configChanged = true;
  }
  if (configChanged) {
    reasons.push('config_changed');
  }

  return {
    stale: reasons.length > 0,
    reasons,
    missingFiles: missing,
    generatedAt: effectiveGeneratedAt || null,
    configUpdatedAt: profile.configUpdatedAt || null,
  };
}

module.exports = {
  GENERATED_FILE_NAMES,
  getOutputDir,
  missingGeneratedFiles,
  latestGeneratedFileMtime,
  resolveGeneratedAt,
  wizardConfigFingerprint,
  generateRelevantWizardFingerprint,
  resolveFingerprintAtGenerate,
  evaluateProfileStale,
};
