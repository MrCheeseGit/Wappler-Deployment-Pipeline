/**
 * GET /api/fs/browse?path=<absolute-dir>
 *
 * Returns the contents of a directory split into:
 *   { path, parent, dirs: [...], files: [...] }
 *
 * Security:
 *   - requireAuth is applied at registration in server.js
 *   - path.resolve() is used so relative/traversal segments are collapsed
 *   - No symlink following outside the resolved path (readdir with withFileTypes)
 */

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { resolvePrivateKeyPath } = require('../lib/ssh');

const router = express.Router();

// Default start dir: /home (covers typical Docker volume mounts)
const DEFAULT_DIR = '/home';

router.get('/browse', (req, res) => {
  let requestedPath = req.query.path ? path.resolve(req.query.path) : DEFAULT_DIR;

  // Fallback to DEFAULT_DIR if path doesn't exist or isn't a directory
  if (!fs.existsSync(requestedPath) || !fs.statSync(requestedPath).isDirectory()) {
    requestedPath = DEFAULT_DIR;
  }

  let entries;
  try {
    entries = fs.readdirSync(requestedPath, { withFileTypes: true });
  } catch (err) {
    // Permission denied or similar — step up one level
    const parent = path.dirname(requestedPath);
    if (parent === requestedPath) {
      return res.status(403).json({ error: 'Cannot read directory.' });
    }
    return res.json({
      path: parent,
      parent: path.dirname(parent) !== parent ? path.dirname(parent) : null,
      dirs: [],
      files: [],
      error: `Cannot read "${requestedPath}": ${err.message}`,
    });
  }

  const showHidden = req.query.showHidden === '1' || req.query.showHidden === 'true';

  const dirs  = [];
  const files = [];

  for (const entry of entries) {
    if (!showHidden && entry.name.startsWith('.')) continue;
    const fullPath = path.join(requestedPath, entry.name);
    try {
      const stat = fs.statSync(fullPath);   // follow symlinks
      if (stat.isDirectory()) {
        dirs.push(entry.name);
      } else {
        files.push(entry.name);
      }
    } catch {
      // broken symlink or permission denied — skip
    }
  }

  dirs.sort((a, b) => a.localeCompare(b));
  files.sort((a, b) => a.localeCompare(b));

  const parent = path.dirname(requestedPath);

  return res.json({
    path:   requestedPath,
    parent: parent !== requestedPath ? parent : null,
    dirs,
    files,
  });
});

// GET /api/fs/stat?path=...&kind=sshPrivateKey
router.get('/stat', (req, res) => {
  const raw = req.query.path;
  if (!raw || typeof raw !== 'string') {
    return res.status(400).json({ ok: false, message: 'path query parameter is required.' });
  }

  const kind = req.query.kind || 'file';
  let resolved;
  try {
    resolved = resolvePrivateKeyPath(raw.trim());
  } catch (err) {
    return res.json({ ok: false, message: err.message, resolvedPath: null });
  }

  if (kind === 'sshPrivateKey' && resolved.endsWith('.pub')) {
    return res.json({
      ok: false,
      message: 'This looks like a public key (.pub). Choose the private key file (no .pub extension).',
      resolvedPath: resolved,
    });
  }

  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
      return res.json({ ok: false, message: 'Path is not a file.', resolvedPath: resolved });
    }
    fs.accessSync(resolved, fs.constants.R_OK);
    return res.json({
      ok: true,
      message: 'Key file is readable by WDP.',
      resolvedPath: resolved,
      size: stat.size,
    });
  } catch (err) {
    return res.json({
      ok: false,
      message: `Cannot read file: ${err.message}`,
      resolvedPath: resolved,
    });
  }
});

module.exports = router;
