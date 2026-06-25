'use strict';

const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

/** Paths excluded from deploy sync (any directory depth). */
const TRANSFER_EXCLUDES = [
  'node_modules',
  '.git',
  '.wappler',
  '.wappler_backup',
  'uploads',
  '.env',
  '.svelte-kit',
  'build',
  'dist',
  'coverage',
  '.cache',
  '.DS_Store',
];

/**
 * Expand a leading ~ to the best available home directory.
 * Inside the WDP container the process runs as root (HOME=/root), but user keys
 * are typically mounted at /home/<user>/.ssh/.  Scan /home/ for a real user first.
 */
function listHomeDirs() {
  const homes = [];
  try {
    for (const u of fs.readdirSync('/home').filter((d) => !d.startsWith('.'))) {
      homes.push(`/home/${u}`);
    }
  } catch { /* ignore */ }
  homes.push(process.env.HOME || '/root');
  return [...new Set(homes)];
}

/**
 * Expand ~ and resolve to a readable private key path (scans mounted /home/* if needed).
 */
function expandTilde(p) {
  if (!p || !p.startsWith('~')) {
    const abs = path.resolve(p);
    if (fs.existsSync(abs)) return abs;
    return abs;
  }

  const rest = p.slice(1).replace(/^\//, '');
  for (const home of listHomeDirs()) {
    const candidate = path.join(home, rest);
    if (fs.existsSync(candidate)) return candidate;
  }

  return path.join(listHomeDirs()[0], rest);
}

/** Find private key file when path is wrong but key exists under a mounted home .ssh dir */
function resolvePrivateKeyPath(keyPath) {
  const expanded = expandTilde(keyPath);
  try {
    if (fs.existsSync(expanded) && fs.statSync(expanded).isFile()) return expanded;
  } catch { /* ignore */ }

  const base = path.basename(expanded);
  for (const home of listHomeDirs()) {
    const candidate = path.join(home, '.ssh', base);
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch { /* ignore */ }
  }

  throw new Error(
    `Cannot read SSH key at ${keyPath} (resolved: ${expanded}). ` +
    'Ensure your home directory is mounted into the WDP container, e.g. -v /home/youruser:/home/youruser',
  );
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function hasRsync() {
  try {
    return spawnSync('rsync', ['--version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
}

/**
 * Build an ssh2 connection config from a stored profile object.
 * Expands leading ~ in key paths.
 */
function buildSshConfig(profile) {
  if (!profile.sshKeyPath) {
    throw new Error('SSH key path is not configured. Please complete Step 4 of the wizard.');
  }
  const keyPath = resolvePrivateKeyPath(profile.sshKeyPath);

  let privateKey;
  try {
    privateKey = fs.readFileSync(keyPath);
  } catch (err) {
    throw new Error(`Cannot read SSH key at ${keyPath}: ${err.message}`);
  }

  return {
    host:               profile.sshHost,
    port:               parseInt(profile.sshPort || '22', 10),
    username:           profile.sshUser || 'root',
    privateKey,
    keyPath,
    readyTimeout:       20000,
    keepaliveInterval:  10000,
    keepaliveCountMax:  6,
  };
}

/**
 * Test SSH connectivity — resolves true if the connection succeeds.
 */
function testConnection(sshCfg) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => { conn.end(); resolve(true); });
    conn.on('error', reject);
    conn.connect(sshCfg);
  });
}

/**
 * Execute a command over SSH and collect stdout/stderr.
 * Resolves { code, stdout, stderr }.
 */
function exec(sshCfg, command) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = '';
    let stderr = '';

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) { conn.end(); return reject(err); }
        stream.on('close', (code) => { conn.end(); resolve({ code, stdout, stderr }); });
        stream.on('data', (d) => { stdout += d.toString(); });
        stream.stderr.on('data', (d) => { stderr += d.toString(); });
      });
    });
    conn.on('error', reject);
    conn.connect(sshCfg);
  });
}

/**
 * Execute a command over SSH and stream each line to an onData callback.
 * Resolves with the exit code when the command completes.
 * Pass an AbortSignal as the optional 4th argument to support cancellation.
 */
function execStream(sshCfg, command, onLine, signal) {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    if (signal?.aborted) { return reject(new Error('Cancelled')); }
    const onAbort = () => { try { conn.end(); } catch {} reject(new Error('Cancelled')); };
    signal?.addEventListener('abort', onAbort, { once: true });

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) { conn.end(); return reject(err); }

        let buf = '';
        const flush = (chunk, isStderr) => {
          buf += chunk;
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines) {
            if (line.trim()) onLine(line, isStderr ? 'stderr' : 'stdout');
          }
        };

        stream.on('close', (code) => {
          signal?.removeEventListener('abort', onAbort);
          if (buf.trim()) onLine(buf, 'stdout');
          conn.end();
          resolve(code);
        });
        stream.on('data', (d) => flush(d.toString(), false));
        stream.stderr.on('data', (d) => flush(d.toString(), true));
      });
    });
    conn.on('error', (err) => { signal?.removeEventListener('abort', onAbort); reject(err); });
    conn.connect(sshCfg);
  });
}

/**
 * Spawn a process, stream lines, honour AbortSignal. Resolves exit code.
 */
function spawnTransfer(cmd, args, onLine, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Cancelled'));

    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let settled = false;

    const settle = (err, code) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve(code);
    };

    const onAbort = () => {
      try { proc.kill('SIGTERM'); } catch {}
      settle(new Error('Cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    let buf = '';
    const flush = (chunk, isStderr) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (t) onLine && onLine(t, isStderr ? 'stderr' : 'stdout');
      }
    };

    proc.stdout.on('data', (d) => flush(d.toString(), false));
    proc.stderr.on('data', (d) => flush(d.toString(), true));
    proc.on('error', (e) => settle(new Error(`${cmd} failed: ${e.message}`)));
    proc.on('close', (code) => {
      if (buf.trim()) onLine && onLine(buf.trim(), 'stdout');
      settle(null, code);
    });
  });
}

/**
 * rsync over SSH — reliable for large trees; streams progress on stderr.
 */
async function transferViaRsync(sshCfg, localPath, remotePath, onLine, signal) {
  const port = sshCfg.port || 22;
  const sshShell = [
    'ssh',
    '-i', sshCfg.keyPath,
    '-p', String(port),
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'LogLevel=ERROR',
  ].join(' ');

  const args = [
    '-az',
    '--delete',
    '--info=progress2',
    ...TRANSFER_EXCLUDES.flatMap((e) => ['--exclude', e]),
    '-e', sshShell,
    `${localPath.replace(/\/+$/, '')}/`,
    `${sshCfg.username}@${sshCfg.host}:${remotePath.replace(/\/+$/, '')}/`,
  ];

  onLine && onLine('[WDP] Using rsync (progress lines below)', 'stdout');

  const code = await spawnTransfer('rsync', args, onLine, signal);
  if (code !== 0) throw new Error(`rsync failed (exit ${code})`);
}

/**
 * tar piped over SSH — fallback when rsync is unavailable.
 * Uses backpressure-safe writes to avoid stdin deadlock on large projects.
 */
function transferViaTar(sshCfg, localPath, remotePath, onLine, signal) {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    if (signal?.aborted) { return reject(new Error('Cancelled')); }
    let tarProc = null;
    let bytesSent = 0;

    const onAbort = () => {
      try { tarProc?.kill('SIGTERM'); } catch {}
      try { conn.end(); } catch {}
      reject(new Error('Cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    conn.on('ready', () => {
      const remoteCmd = `mkdir -p ${shellQuote(remotePath)} && tar -xzf - -C ${shellQuote(remotePath)}`;

      conn.exec(remoteCmd, (err, stream) => {
        if (err) { conn.end(); return reject(err); }

        let settled = false;
        const settle = (error) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          conn.end();
          if (error) reject(error);
          else resolve();
        };

        stream.on('close', (code) => {
          if (code !== 0) settle(new Error(`Remote tar extraction failed (exit ${code})`));
          else settle(null);
        });
        stream.stderr.on('data', (d) => {
          const msg = d.toString().trim();
          if (msg) onLine && onLine(msg, 'stderr');
        });

        const tarArgs = [
          '-czf', '-',
          ...TRANSFER_EXCLUDES.flatMap((e) => ['--exclude', e]),
          '-C', localPath,
          '.',
        ];

        onLine && onLine('[WDP] Using tar over SSH (no rsync)', 'stdout');

        tarProc = spawn('tar', tarArgs);

        tarProc.stdout.on('data', (chunk) => {
          bytesSent += chunk.length;
          const canWrite = stream.write(chunk);
          if (!canWrite) tarProc.stdout.pause();
        });
        stream.on('drain', () => {
          if (tarProc?.stdout) tarProc.stdout.resume();
        });

        tarProc.stderr.on('data', (d) => {
          const msg = d.toString().trim();
          if (msg) onLine && onLine(`[tar] ${msg}`, 'stderr');
        });
        tarProc.on('error', (e) => settle(new Error(`Local tar failed: ${e.message}`)));
        tarProc.on('close', (code) => {
          if (code !== 0) {
            settle(new Error(`Local tar failed (exit ${code})`));
            return;
          }
          onLine && onLine(`[WDP] Archive sent (${Math.round(bytesSent / 1024 / 1024)} MB)`, 'stdout');
          stream.end();
        });
      });
    });

    conn.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      reject(err);
    });
    conn.connect(sshCfg);
  });
}

/**
 * Transfer a local directory to a remote host (rsync preferred, tar fallback).
 */
async function transferDirectory(sshCfg, localPath, remotePath, onLine, signal) {
  if (!fs.existsSync(localPath)) {
    throw new Error(`Project path not found: ${localPath}`);
  }

  const mkdirCode = await execStream(
    sshCfg,
    `mkdir -p ${shellQuote(remotePath)}`,
    onLine,
    signal,
  );
  if (mkdirCode !== 0) throw new Error(`Could not create remote directory (exit ${mkdirCode})`);

  if (sshCfg.keyPath && hasRsync()) {
    await transferViaRsync(sshCfg, localPath, remotePath, onLine, signal);
  } else {
    await transferViaTar(sshCfg, localPath, remotePath, onLine, signal);
  }
}

/**
 * Open an interactive PTY shell session over SSH.
 * Returns a control object { write, resize, close }.
 */
function openShell(sshCfg, { cols = 80, rows = 24, onData, onClose, onError }) {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    conn.on('ready', () => {
      conn.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
        if (err) { conn.end(); return reject(err); }

        stream.on('close', () => {
          conn.end();
          onClose && onClose();
        });
        stream.on('data', (d) => onData && onData(d));
        stream.stderr.on('data', (d) => onData && onData(d));

        resolve({
          write: (data) => stream.write(data),
          resize: (c, r) => stream.setWindow(r, c, 0, 0),
          close: () => { try { stream.close(); } catch {} conn.end(); },
        });
      });
    });

    conn.on('error', (err) => {
      onError && onError(err);
      reject(err);
    });
    conn.connect(sshCfg);
  });
}

module.exports = {
  buildSshConfig,
  expandTilde,
  resolvePrivateKeyPath,
  shellQuote,
  testConnection,
  exec,
  execStream,
  transferDirectory,
  openShell,
};
