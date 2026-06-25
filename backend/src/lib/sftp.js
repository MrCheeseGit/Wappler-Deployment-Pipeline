'use strict';

const path = require('path');
const { Client } = require('ssh2');
const { buildSshConfig } = require('./ssh');

const MAX_READ_BYTES = 512 * 1024;

function resolveRemoteRoot(profile) {
  const root = (profile.remotePath || '/root').trim() || '/root';
  return path.posix.normalize(root.endsWith('/') ? root.slice(0, -1) : root);
}

function assertUnderRoot(root, targetPath) {
  const resolved = path.posix.normalize(targetPath);
  if (resolved !== root && !resolved.startsWith(root + '/')) {
    throw new Error('Path is outside the allowed directory.');
  }
  return resolved;
}

function withSftp(profile, fn) {
  return new Promise((resolve, reject) => {
    let sshCfg;
    try {
      sshCfg = buildSshConfig(profile);
    } catch (e) {
      return reject(e);
    }
    const conn = new Client();
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) { conn.end(); return reject(err); }
        Promise.resolve(fn(sftp, conn))
          .then(resolve)
          .catch(reject)
          .finally(() => { try { conn.end(); } catch { /* ignore */ } });
      });
    });
    conn.on('error', reject);
    conn.connect(sshCfg);
  });
}

function sftpReaddir(sftp, dirPath) {
  return new Promise((resolve, reject) => {
    sftp.readdir(dirPath, (err, list) => {
      if (err) return reject(err);
      resolve(list || []);
    });
  });
}

function sftpStat(sftp, filePath) {
  return new Promise((resolve, reject) => {
    sftp.stat(filePath, (err, stats) => {
      if (err) return reject(err);
      resolve(stats);
    });
  });
}

function sftpReadFile(sftp, filePath) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const stream = sftp.createReadStream(filePath);
    stream.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_READ_BYTES) {
        stream.destroy();
        return reject(new Error(`File exceeds ${MAX_READ_BYTES / 1024} KB preview limit.`));
      }
      chunks.push(chunk);
    });
    stream.on('error', reject);
    stream.on('close', () => resolve(Buffer.concat(chunks)));
  });
}

function sftpWriteFile(sftp, filePath, buffer) {
  return new Promise((resolve, reject) => {
    const stream = sftp.createWriteStream(filePath);
    stream.on('error', reject);
    stream.on('close', resolve);
    stream.end(buffer);
  });
}

function sftpUnlink(sftp, filePath) {
  return new Promise((resolve, reject) => {
    sftp.unlink(filePath, (err) => (err ? reject(err) : resolve()));
  });
}

function sftpRmdir(sftp, dirPath) {
  return new Promise((resolve, reject) => {
    sftp.rmdir(dirPath, (err) => (err ? reject(err) : resolve()));
  });
}

function sftpRename(sftp, oldPath, newPath) {
  return new Promise((resolve, reject) => {
    sftp.rename(oldPath, newPath, (err) => (err ? reject(err) : resolve()));
  });
}

function formatMode(mode) {
  if (mode == null) return '—';
  return (mode & parseInt('777', 8)).toString(8).padStart(3, '0');
}

async function listDirectory(profile, relativePath = '', showHidden = false) {
  const root = resolveRemoteRoot(profile);
  const target = relativePath
    ? assertUnderRoot(root, path.posix.join(root, relativePath))
    : root;

  return withSftp(profile, async (sftp) => {
    const entries = await sftpReaddir(sftp, target);
    const items = [];
    for (const e of entries) {
      if (!showHidden && e.filename.startsWith('.')) continue;
      const full = path.posix.join(target, e.filename);
      let stats = e.attrs;
      try {
        stats = await sftpStat(sftp, full);
      } catch { /* use attrs from readdir */ }
      const isDir = stats.isDirectory ? stats.isDirectory() : (stats.mode & 0o40000) === 0o40000;
      items.push({
        name: e.filename,
        path: relativePath ? path.posix.join(relativePath, e.filename) : e.filename,
        isDirectory: isDir,
        size: stats.size ?? 0,
        mode: formatMode(stats.mode),
        mtime: stats.mtime ? new Date(stats.mtime * 1000).toISOString() : null,
      });
    }
    items.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return { root, path: relativePath || '', entries: items };
  });
}

async function readTextFile(profile, relativePath) {
  const root = resolveRemoteRoot(profile);
  const full = assertUnderRoot(root, path.posix.join(root, relativePath));
  const buf = await withSftp(profile, (sftp) => sftpReadFile(sftp, full));
  return buf.toString('utf8');
}

async function downloadFile(profile, relativePath) {
  const root = resolveRemoteRoot(profile);
  const full = assertUnderRoot(root, path.posix.join(root, relativePath));
  return withSftp(profile, (sftp) => sftpReadFile(sftp, full));
}

async function uploadFile(profile, relativeDir, filename, buffer) {
  const root = resolveRemoteRoot(profile);
  const dir = relativeDir
    ? assertUnderRoot(root, path.posix.join(root, relativeDir))
    : root;
  const safeName = path.posix.basename(filename);
  const full = assertUnderRoot(root, path.posix.join(dir, safeName));
  await withSftp(profile, (sftp) => sftpWriteFile(sftp, full, buffer));
  return { path: relativeDir ? path.posix.join(relativeDir, safeName) : safeName };
}

async function deletePath(profile, relativePath) {
  const root = resolveRemoteRoot(profile);
  const full = assertUnderRoot(root, path.posix.join(root, relativePath));
  return withSftp(profile, async (sftp) => {
    const st = await sftpStat(sftp, full);
    if (st.isDirectory()) {
      await sftpRmdir(sftp, full);
    } else {
      await sftpUnlink(sftp, full);
    }
  });
}

async function renamePath(profile, relativePath, newName) {
  const root = resolveRemoteRoot(profile);
  const oldFull = assertUnderRoot(root, path.posix.join(root, relativePath));
  const parent = path.posix.dirname(relativePath);
  const newRel = parent === '.' ? newName : path.posix.join(parent, newName);
  const newFull = assertUnderRoot(root, path.posix.join(root, newRel));
  await withSftp(profile, (sftp) => sftpRename(sftp, oldFull, newFull));
  return { path: newRel };
}

module.exports = {
  resolveRemoteRoot,
  listDirectory,
  readTextFile,
  downloadFile,
  uploadFile,
  deletePath,
  renamePath,
  MAX_READ_BYTES,
};
