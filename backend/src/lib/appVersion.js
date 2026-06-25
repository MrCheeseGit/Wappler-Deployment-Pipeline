'use strict';

const fs = require('fs');
const path = require('path');
const { readConfig, writeConfig } = require('./configStore');

const PKG_PATH = path.join(__dirname, '..', '..', 'package.json');
const GITHUB_REPO = process.env.WDP_GITHUB_REPO || 'MrCheeseGit/Wappler-Deployment-Pipeline';
const CACHE_MS = 24 * 60 * 60 * 1000;
const DISMISS_DAYS_DEFAULT = 7;

let memoryCache = { at: 0, payload: null };

function readCurrentVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function parseSemver(v) {
  const m = String(v || '').replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}

function isNewer(latest, current) {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  if (!a || !b) return String(latest) !== String(current);
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  return a.patch > b.patch;
}

async function fetchLatestFromGitHub() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Wappler-Deployment-Pipeline',
  };

  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const body = await res.json();
      const version = String(body.tag_name || '').replace(/^v/i, '');
      if (version) {
        return {
          version,
          releaseUrl: body.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`,
          releaseNotes: typeof body.body === 'string' ? body.body.slice(0, 800) : '',
        };
      }
    }
  } catch {
    /* try fallback */
  }

  try {
    const res = await fetch(
      `https://raw.githubusercontent.com/${GITHUB_REPO}/main/backend/package.json`,
      { signal: AbortSignal.timeout(15000) },
    );
    if (res.ok) {
      const pkg = await res.json();
      if (pkg.version) {
        return {
          version: String(pkg.version),
          releaseUrl: `https://github.com/${GITHUB_REPO}/releases`,
          releaseNotes: '',
        };
      }
    }
  } catch {
    /* offline */
  }

  return null;
}

function installHints() {
  return {
    git: [
      'cd /path/to/Wappler-Deployment-Pipeline',
      'git pull',
      'docker compose up -d --build',
    ],
    zip: [
      'docker compose down',
      '# Replace WDP files with the new download (keep .env if you use one)',
      'docker compose up -d --build',
    ],
    note: 'Your deployment profiles stay in the wdp-data Docker volume.',
  };
}

/**
 * Check GitHub for a newer WDP release. Results are cached for 24 hours unless force=true.
 */
async function checkForUpdates(options = {}) {
  const force = options.force === true;
  const current = readCurrentVersion();
  const now = Date.now();

  let config = {};
  try {
    config = await readConfig();
  } catch {
    /* ignore */
  }
  const dismissedUntil = config.app?.updateDismissedUntil || 0;

  if (!force && memoryCache.payload && now - memoryCache.at < CACHE_MS) {
    const cached = { ...memoryCache.payload, current };
    cached.showBanner = cached.updateAvailable && now > dismissedUntil;
    cached.dismissedUntil = dismissedUntil;
    return cached;
  }

  let remote = null;
  let checkError = null;
  try {
    remote = await fetchLatestFromGitHub();
  } catch (err) {
    checkError = err.message || 'Could not reach GitHub';
  }

  const latest = remote?.version || current;
  const updateAvailable = remote ? isNewer(latest, current) : false;

  const payload = {
    current,
    latest,
    updateAvailable,
    releaseUrl: remote?.releaseUrl || `https://github.com/${GITHUB_REPO}/releases`,
    releaseNotes: remote?.releaseNotes || '',
    checkedAt: new Date().toISOString(),
    checkError,
    dismissedUntil,
    showBanner: updateAvailable && now > dismissedUntil,
    installHints: installHints(),
    repo: GITHUB_REPO,
  };

  memoryCache = { at: now, payload: { ...payload, current: undefined } };
  return payload;
}

async function dismissUpdateReminder(days = DISMISS_DAYS_DEFAULT) {
  const config = await readConfig();
  const n = Math.max(1, Math.min(90, parseInt(days, 10) || DISMISS_DAYS_DEFAULT));
  const until = Date.now() + n * 24 * 60 * 60 * 1000;
  config.app = { ...(config.app || {}), updateDismissedUntil: until };
  await writeConfig(config);
  memoryCache = { at: 0, payload: null };
  return { dismissedUntil: until, days: n };
}

module.exports = {
  readCurrentVersion,
  checkForUpdates,
  dismissUpdateReminder,
  GITHUB_REPO,
};
