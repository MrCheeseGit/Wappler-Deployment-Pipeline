'use strict';

const fs = require('fs');

const DEFAULT_HISTORY = { entries: [], rollup: { byProfile: {} } };

/**
 * Parse deploy-history.json; recover from trailing garbage after a complete root object.
 * @returns {{ history: object, repaired: boolean }}
 */
function parseHistoryRaw(raw) {
  if (!raw || !String(raw).trim()) {
    return { history: { ...DEFAULT_HISTORY, entries: [] }, repaired: false };
  }

  const text = String(raw);

  try {
    const history = JSON.parse(text);
    return { history: normalizeHistory(history), repaired: false };
  } catch (err) {
    const posMatch = /position (\d+)/i.exec(err.message || '');
    if (posMatch) {
      const cut = parseInt(posMatch[1], 10);
      try {
        const history = JSON.parse(text.slice(0, cut));
        return { history: normalizeHistory(history), repaired: true };
      } catch {
        // fall through
      }
    }

    // Truncated write: find last closing brace of root object
    const tail = text.lastIndexOf('\n}\n');
    if (tail > 0) {
      try {
        const history = JSON.parse(text.slice(0, tail + 2));
        return { history: normalizeHistory(history), repaired: true };
      } catch {
        // fall through
      }
    }

    throw err;
  }
}

function normalizeHistory(data) {
  const history = data && typeof data === 'object' ? data : {};
  if (!Array.isArray(history.entries)) history.entries = [];
  if (!history.rollup || typeof history.rollup !== 'object') {
    history.rollup = { byProfile: {} };
  }
  if (!history.rollup.byProfile || typeof history.rollup.byProfile !== 'object') {
    history.rollup.byProfile = {};
  }
  return history;
}

async function readHistoryFile(filePath) {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const { history, repaired } = parseHistoryRaw(raw);
    return { history, repaired };
  } catch (e) {
    if (e.code === 'ENOENT') {
      return { history: { entries: [], rollup: { byProfile: {} } }, repaired: false };
    }
    throw e;
  }
}

/** Atomic write to avoid torn / appended files on crash or concurrent writers. */
async function writeHistoryFile(filePath, history) {
  const dir = require('path').dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const body = JSON.stringify(history, null, 2);
  await fs.promises.writeFile(tmp, body, 'utf8');
  await fs.promises.rename(tmp, filePath);
}

module.exports = {
  parseHistoryRaw,
  readHistoryFile,
  writeHistoryFile,
  DEFAULT_HISTORY,
};
