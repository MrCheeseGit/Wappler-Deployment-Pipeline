'use strict';

const { buildSshConfig, openShell } = require('./ssh');

// WeakMap: WebSocket → { shell, pingInterval }
const sessions = new WeakMap();

/**
 * Open an SSH PTY session and bind it to a WebSocket.
 * Reads SSH config from the saved profile in wdp-config.json.
 */
async function open(ws, profileName, cols, rows) {
  const { readConfig } = require('./configStore');
  const config = await readConfig();
  const profile = config.profiles && config.profiles[profileName];

  if (!profile) {
    safeSend(ws, { type: 'terminal_error', message: `Profile "${profileName}" not found` });
    return;
  }

  const target = profile.hostingTarget || profile.wizardConfig?.step4?.hostingTarget;

  if (target === 'local' || target === 'railway') {
    safeSend(ws, { type: 'terminal_error', message: 'SSH Terminal is not available for local or Railway targets' });
    return;
  }

  let sshCfg;
  try {
    sshCfg = buildSshConfig(profile);
  } catch (err) {
    safeSend(ws, { type: 'terminal_error', message: err.message });
    return;
  }

  safeSend(ws, { type: 'terminal_connecting' });

  let shell;
  try {
    shell = await openShell(sshCfg, {
      cols: cols || 80,
      rows: rows || 24,
      onData: (data) => {
        if (ws.readyState === 1) {
          safeSend(ws, { type: 'terminal_data', data: Buffer.from(data).toString('base64') });
        }
      },
      onClose: () => {
        safeSend(ws, { type: 'terminal_closed' });
        sessions.delete(ws);
      },
      onError: (err) => {
        safeSend(ws, { type: 'terminal_error', message: err.message });
        sessions.delete(ws);
      },
    });
  } catch (err) {
    safeSend(ws, { type: 'terminal_error', message: `SSH connection failed: ${err.message}` });
    return;
  }

  sessions.set(ws, { shell });
  safeSend(ws, { type: 'terminal_ready' });
}

/**
 * Send input data to the PTY attached to this WebSocket.
 */
function input(ws, data) {
  const session = sessions.get(ws);
  if (session && session.shell) {
    session.shell.write(data);
  }
}

/**
 * Resize the PTY attached to this WebSocket.
 */
function resize(ws, cols, rows) {
  const session = sessions.get(ws);
  if (session && session.shell) {
    session.shell.resize(cols, rows);
  }
}

/**
 * Close the PTY session attached to this WebSocket (called on WS close).
 */
function close(ws) {
  const session = sessions.get(ws);
  if (session && session.shell) {
    try { session.shell.close(); } catch { /* ignore */ }
    sessions.delete(ws);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeSend(ws, payload) {
  try {
    if (ws.readyState === 1) ws.send(JSON.stringify(payload));
  } catch { /* ignore */ }
}

module.exports = { open, input, resize, close };
