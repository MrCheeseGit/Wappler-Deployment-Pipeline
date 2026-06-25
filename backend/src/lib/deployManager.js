'use strict';

const { randomUUID } = require('crypto');
const EventEmitter   = require('events');

// In-memory store of all deployments (active and recently completed)
// Map<deployId, DeployEntry>
const store = new Map();

const MAX_LOG_LINES = 500;

/**
 * Create a new deployment entry and return the deployId.
 */
function create(profileName) {
  const deployId = randomUUID();
  store.set(deployId, {
    deployId,
    profile:     profileName,
    status:      'pending',   // pending | running | success | failed | cancelled
    logs:        [],
    scanResults: [],          // ScanResult[] from securityScanner
    emitter:     new EventEmitter(),
    subscribers: new Set(),
    startedAt:   new Date().toISOString(),
    completedAt: null,
    exitCode:    null,
    cancelFn:    null,        // set by the deployment runner to abort in-flight work
  });
  return deployId;
}

/**
 * Mark a deployment as running.
 */
function start(deployId) {
  const d = store.get(deployId);
  if (d) d.status = 'running';
}

/**
 * Append a log line to a deployment and broadcast to all subscribers.
 */
function log(deployId, line, stream = 'stdout') {
  const d = store.get(deployId);
  if (!d) return;

  const entry = { line, stream, ts: Date.now() };
  d.logs.push(entry);
  if (d.logs.length > MAX_LOG_LINES) d.logs.shift();

  d.emitter.emit('log', entry);
}

/**
 * Store structured scan results and broadcast to subscribers.
 */
function setScanResults(deployId, results) {
  const d = store.get(deployId);
  if (!d) return;
  d.scanResults = results;
  d.emitter.emit('scan_results', results);
}

/**
 * Mark a deployment as complete (success or failed) and broadcast.
 */
function complete(deployId, success, exitCode = 0, deployUrl = null) {
  const d = store.get(deployId);
  if (!d) return;

  d.status      = success ? 'success' : 'failed';
  d.exitCode    = exitCode;
  d.completedAt = new Date().toISOString();
  if (deployUrl) d.deployUrl = deployUrl;

  d.emitter.emit('complete', { success, exitCode, deployUrl });

  // Clean up emitter listeners after a brief window
  setTimeout(() => {
    d.emitter.removeAllListeners();
    d.subscribers.clear();
  }, 30000);
}

/**
 * Get deployment status and logs.
 */
function get(deployId) {
  return store.get(deployId) || null;
}

/**
 * Subscribe a WebSocket to a deployment's log stream.
 * Replays buffered logs immediately, then streams new events.
 */
function subscribe(deployId, ws) {
  const d = store.get(deployId);
  if (!d) {
    safeSend(ws, { type: 'deploy_error', message: 'Deployment not found' });
    return;
  }

  // Replay buffered logs
  for (const entry of d.logs) {
    safeSend(ws, { type: 'log', deployId, ...entry });
  }

  // Replay scan results if already available
  if (d.scanResults && d.scanResults.length > 0) {
    safeSend(ws, { type: 'scan_results', deployId, results: d.scanResults });
  }

  // If already complete, send final status immediately
  if (d.status === 'success' || d.status === 'failed') {
    safeSend(ws, { type: 'deploy_complete', deployId, success: d.status === 'success', exitCode: d.exitCode });
    return;
  }

  // Subscribe to future events
  const onLog        = (entry)   => safeSend(ws, { type: 'log',          deployId, ...entry });
  const onComplete   = (result)  => safeSend(ws, { type: 'deploy_complete', deployId, ...result });
  const onScanResult = (results) => safeSend(ws, { type: 'scan_results', deployId, results });

  d.emitter.on('log',          onLog);
  d.emitter.once('complete',   onComplete);
  d.emitter.on('scan_results', onScanResult);
  d.subscribers.add({ ws, onLog, onComplete, onScanResult });
}

/**
 * Unsubscribe a WebSocket from all deployments (called on WS close).
 */
function unsubscribe(ws) {
  for (const [, d] of store) {
    for (const sub of d.subscribers) {
      if (sub.ws === ws) {
        d.emitter.off('log',          sub.onLog);
        d.emitter.off('complete',     sub.onComplete);
        d.emitter.off('scan_results', sub.onScanResult);
        d.subscribers.delete(sub);
      }
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeSend(ws, payload) {
  try {
    if (ws.readyState === 1 /* OPEN */) ws.send(JSON.stringify(payload));
  } catch { /* ignore */ }
}

/**
 * Active (pending/running) deployments keyed by profile name.
 */
function getActiveByProfile() {
  const map = {};
  for (const d of store.values()) {
    if (d.status !== 'pending' && d.status !== 'running') continue;
    map[d.profile] = {
      deployId:  d.deployId,
      status:    d.status,
      startedAt: d.startedAt,
      deployUrl: d.deployUrl || null,
    };
  }
  return map;
}

module.exports = {
  create, start, log, complete, get, setScanResults, subscribe, unsubscribe, cancel, setCancelFn,
  getActiveByProfile,
};

/**
 * Register a cancellation callback for an active deployment.
 * The runner calls this to expose an abort handle.
 */
function setCancelFn(deployId, fn) {
  const d = store.get(deployId);
  if (d) d.cancelFn = fn;
}

/**
 * Cancel an active deployment.
 * Invokes the registered cancelFn (if any) and marks the deployment failed.
 */
function cancel(deployId) {
  const d = store.get(deployId);
  if (!d) return false;
  if (d.status !== 'running' && d.status !== 'pending') return false;

  if (typeof d.cancelFn === 'function') {
    try { d.cancelFn(); } catch { /* ignore */ }
  }
  log(deployId, '[WDP] ⛔ Deployment cancelled by user', 'stderr');
  complete(deployId, false, 130);  // exit code 130 = SIGINT convention
  return true;
}
