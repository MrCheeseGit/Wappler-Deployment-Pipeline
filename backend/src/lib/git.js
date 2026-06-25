'use strict';

const fs   = require('fs');
const path = require('path');
const { execFile } = require('child_process');

/**
 * Run a git command in the given directory.
 * Resolves with trimmed stdout; rejects on non-zero exit.
 */
function run(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: 15000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolve(stdout.trim());
    });
  });
}

/**
 * Returns true if projectPath is inside a git repository.
 */
async function isGitRepo(projectPath) {
  try {
    await run(projectPath, ['rev-parse', '--git-dir']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns git status for a project directory.
 * @returns {{ isRepo, branch, commitHash, dirty }}
 */
async function getStatus(projectPath) {
  const repo = await isGitRepo(projectPath);
  if (!repo) return { isRepo: false };

  const [branch, commitHash, statusOut] = await Promise.all([
    run(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => ''),
    run(projectPath, ['rev-parse', '--short', 'HEAD']).catch(() => ''),
    run(projectPath, ['status', '--porcelain']).catch(() => ''),
  ]);

  return {
    isRepo:     true,
    branch:     branch || 'HEAD',
    commitHash: commitHash || '',
    dirty:      statusOut.length > 0,
  };
}

/**
 * Returns the unified diff of wdp/{profile}/ against HEAD.
 * Returns '' if no tracked files or no diff.
 */
async function getDiff(projectPath, profile) {
  try {
    const tracked = await run(projectPath, ['ls-files', `wdp/${profile}/`]).catch(() => '');
    if (!tracked) return '';
    return run(projectPath, ['diff', 'HEAD', '--', `wdp/${profile}/`]).catch(() => '');
  } catch {
    return '';
  }
}

/**
 * Stage wdp/{profile}/ files and create a commit.
 * Returns the short commit hash of the new commit.
 */
async function commitWdpFiles(projectPath, profile, message) {
  await run(projectPath, ['add', `wdp/${profile}/`]);
  await run(projectPath, ['commit', '-m', message]);
  return run(projectPath, ['rev-parse', '--short', 'HEAD']);
}

/**
 * Create a local tag deploy/{profile}/{timestamp} and push it (push is best-effort).
 * Returns the tag name.
 */
async function createDeployTag(projectPath, profile) {
  const ts      = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const tagName = `deploy/${profile}/${ts}`;
  await run(projectPath, ['tag', tagName]);
  run(projectPath, ['push', 'origin', tagName]).catch(() => {}); // non-fatal
  return tagName;
}

/**
 * Append WDP-safe .gitignore rules for a profile (secrets + common local noise).
 * @returns {boolean} true if file was modified
 */
function ensureProjectGitignore(projectRoot, profile) {
  const safeProfile = path.basename(profile);
  const gitignorePath = path.join(projectRoot, '.gitignore');
  const entries = [
    '# Wappler Deployment Pipeline (auto-added by WDP)',
    `wdp/${safeProfile}/.env.deploy`,
    `wdp/${safeProfile}/docker-compose.deploy.yml`,
    '',
    '# Local / Node (WDP init)',
    'node_modules/',
    '.env',
    '.env.*',
    '!.env.example',
    '.DS_Store',
  ];

  let existing = '';
  if (fs.existsSync(gitignorePath)) {
    existing = fs.readFileSync(gitignorePath, 'utf8');
  }

  const header = '# Wappler Deployment Pipeline (auto-added by WDP)';
  const hasHeader = existing.includes(header);
  const practical = entries.filter((e) => {
    if (!e) return false;
    if (e.startsWith('#')) return !hasHeader || (e !== header && !existing.includes(e));
    return !existing.includes(e);
  });
  if (practical.length === 0) return false;

  const separator = existing.endsWith('\n') || existing === '' ? '' : '\n';
  fs.appendFileSync(gitignorePath, `${separator}\n${practical.join('\n')}\n`, 'utf8');
  return true;
}

/**
 * Initialise git in the project root for a deployment profile.
 * @param {string} projectPath
 * @param {string} profile
 * @param {{ initialCommit?: boolean, commitMessage?: string }} opts
 */
async function initRepositoryForProfile(projectPath, profile, opts = {}) {
  if (!projectPath || !fs.existsSync(projectPath)) {
    const err = new Error('Project path does not exist.');
    err.status = 400;
    throw err;
  }

  const safeProfile = path.basename(profile);
  const alreadyRepo = await isGitRepo(projectPath);
  const gitignoreUpdated = ensureProjectGitignore(projectPath, safeProfile);

  let initialized = false;
  if (!alreadyRepo) {
    try {
      await run(projectPath, ['init', '-b', 'main']);
    } catch {
      await run(projectPath, ['init']);
      try {
        await run(projectPath, ['checkout', '-b', 'main']);
      } catch { /* default branch name may already be main */ }
    }
    initialized = true;
  }

  let initialCommit = null;
  const doCommit = opts.initialCommit !== false;
  if (doCommit) {
    const wdpDir = path.join(projectPath, 'wdp', safeProfile);
    if (fs.existsSync(wdpDir)) {
      if (gitignoreUpdated || fs.existsSync(path.join(projectPath, '.gitignore'))) {
        await run(projectPath, ['add', '.gitignore']).catch(() => {});
      }
      await run(projectPath, ['add', `wdp/${safeProfile}/`]).catch(() => {});
      const staged = await run(projectPath, ['diff', '--cached', '--name-only']).catch(() => '');
      if (staged.trim()) {
        const message = (opts.commitMessage && String(opts.commitMessage).trim())
          || `chore(wdp): initialise ${safeProfile} deployment files`;
        await run(projectPath, ['commit', '-m', message]);
        initialCommit = await run(projectPath, ['rev-parse', '--short', 'HEAD']);
      }
    }
  }

  const status = await getStatus(projectPath);
  return {
    alreadyRepo,
    initialized,
    gitignoreUpdated,
    initialCommit,
    status,
  };
}

module.exports = {
  isGitRepo,
  getStatus,
  getDiff,
  commitWdpFiles,
  createDeployTag,
  ensureProjectGitignore,
  initRepositoryForProfile,
};
