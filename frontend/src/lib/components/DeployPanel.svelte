<script>
  import { onMount, onDestroy } from 'svelte';
  import { api } from '$lib/api.js';
  import { _ } from 'svelte-i18n';
  import StaleGenerateBanner from '$lib/components/StaleGenerateBanner.svelte';
  import RebuildDropletPanel from '$lib/components/RebuildDropletPanel.svelte';
  import { fetchHostOs } from '$lib/hostOsApi.js';
  import { saveStep2Prefs } from '$lib/step2PrefsApi.js';
  import { wizardStore } from '$lib/wizardStore.js';

  // props
  export let profile = '';    // profile name (required)
  export let config  = null;  // wizard store snapshot; if null, loaded from API

  // ── State ─────────────────────────────────────────────────────────────────

  let profileData   = null;  // merged profile info from config or API
  let loadError     = '';
  let staleInfo     = { stale: false, reasons: [] };

  let checksRunning = false;
  let checksDone    = false;
  let checks        = [];

  let deployId      = null;
  let deploying     = false;
  let deployDone    = false;
  let deploySuccess = false;
  let deployUrl     = null;
  let logLines      = [];    // { line, stream, ts }
  let logEl;

  // Security scan results
  let scanResults    = [];   // ScanResult[]
  let dismissals     = {};   // { [findingId]: { dismissedAt, reason } }
  let expandedScanner = null; // scanner key currently expanded
  let fixRunning      = false;
  let fixForceRunning = false;
  let fixId          = null;
  let fixWs          = null;
  let backupBeforeFix = true;
  let lastBackupTs    = null;  // timestamp string of most recent backup
  let restoreRunning  = false;
  let restoreDone     = false;
  let lockfileRunning = false;
  let fixingPkgs     = {}; // { [findingId]: true } while a per-finding fix is in flight
  let installingTools = {}; // { [toolKey]: true } while an install is in flight

  let healthResult  = null;
  let healthRunning = false;

  let showCleanup   = false;
  let cleanupRunning = false;
  let cleanupMode   = 'dangling';
  let cleanupDone   = false;

  let canPublish         = false;
  let publishEligibility = { hasSuccessfulDeploy: false, reason: null };

  let hostOsInfo      = null;
  let hostOsLoading   = false;
  let rebuildTargetOs = 'ubuntu-24.04';
  let rebuildArch     = 'x86_64';
  /** @type {boolean | null} null = follow saved profile / wizard config */
  let rebuildDismissedLocal = null;
  let showRebuildAdvanced = false;

  let ws = null;

  // ── Computed ──────────────────────────────────────────────────────────────

  $: target       = profileData?.hostingTarget || config?.step4?.hostingTarget || '';
  $: isLocal      = target === 'local';
  $: isRailway    = target === 'railway';
  $: needsSsh     = !isLocal && !isRailway;
  $: checksOk     = checksDone && checks.every(c => c.ok);
  $: canDeploy    = checksOk && !deploying && !deployDone;
  $: canPublishNow = canPublish && !deploying && !deployDone;
  $: traefikOn    = profileData?.wizardConfig?.step5?.addons?.traefik?.enabled
                    ?? config?.step5?.addons?.traefik?.enabled ?? false;
  $: appPort      = profileData?.appPort || 3000;
  $: domainHost   = (profileData?.domain || config?.step5?.addons?.traefik?.domain || '')
                    .replace(/^https?:\/\//, '').replace(/\/$/, '');
  // Local profiles may still carry sshHost from a duplicated remote profile — ignore it in the UI.
  $: displayHost  = isLocal ? 'localhost' : (profileData?.sshHost || '');
  $: showHostRow  = isLocal || !!profileData?.sshHost;
  $: doMode       = profileData?.doMode || config?.step4?.doMode || 'existing';
  $: doDropletId  = profileData?.doDropletId || config?.step4?.doDropletId || '';
  $: canRebuildDo = target === 'digitalocean' && doMode === 'existing' && Boolean(doDropletId || profileData?.sshHost);
  $: rebuildDismissedSaved = config?.step2?.rebuildDismissed === true
    || profileData?.wizardConfig?.step2?.rebuildDismissed === true;
  $: rebuildDismissed = rebuildDismissedLocal !== null ? rebuildDismissedLocal : rebuildDismissedSaved;
  $: showRebuildPanel = canRebuildDo && !deployDone && (!rebuildDismissed || showRebuildAdvanced);
  $: liveUrl      = traefikOn && domainHost
    ? `https://${domainHost}`
    : domainHost && !isLocal
      ? `http://${domainHost}:${appPort}`
      : isLocal
        ? `http://localhost:${appPort}`
        : displayHost
          ? `http://${displayHost}:${appPort}`
          : null;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  onMount(async () => {
    if (!config) {
      // Dashboard context — load from API
      try {
        const cfg = await api.get('/api/config');
        profileData = cfg.profiles?.[profile] || null;
        if (profileData?.wizardConfig?.step2?.rebuildTargetOS) {
          rebuildTargetOs = profileData.wizardConfig.step2.rebuildTargetOS;
        } else if (profileData?.wizardConfig?.step2?.targetOS) {
          rebuildTargetOs = profileData.wizardConfig.step2.targetOS;
        }
        if (profileData?.wizardConfig?.step2?.architecture) {
          rebuildArch = profileData.wizardConfig.step2.architecture;
        }
        if (!profileData) loadError = `Profile "${profile}" not found. Complete the wizard and generate files first.`;
        if (profile) {
          try {
            staleInfo = await api.get(`/api/config/profiles/${encodeURIComponent(profile)}/stale`);
          } catch { /* non-fatal */ }
        }
      } catch (err) {
        loadError = err.message;
      }
    } else {
      profileData = {
        hostingTarget: config.step4?.hostingTarget,
        sshHost:       config.step4?.sshHost,
        doMode:        config.step4?.doMode,
        doDropletId:   config.step4?.doDropletId,
        doApiKey:      config.step4?.doApiKey,
        domain:        config.step5?.addons?.traefik?.domain || '',
      };
      rebuildTargetOs = config.step2?.rebuildTargetOS || config.step2?.targetOS || 'ubuntu-24.04';
      rebuildArch = config.step2?.architecture || 'x86_64';
    }
    // Load persisted dismissals for this profile
    try {
      const d = await api.get(`/api/deploy/${profile}/dismissals`);
      dismissals = d.dismissals || {};
    } catch { /* non-fatal */ }
    if (profile) {
      try {
        publishEligibility = await api.get(`/api/deploy/${encodeURIComponent(profile)}/eligibility`);
        canPublish = !!publishEligibility.canPublish;
      } catch { /* non-fatal */ }
    }
    const ht = profileData?.hostingTarget || config?.step4?.hostingTarget || '';
    const dm = profileData?.doMode || config?.step4?.doMode || 'existing';
    const did = profileData?.doDropletId || config?.step4?.doDropletId || '';
    const sh = profileData?.sshHost || config?.step4?.sshHost || '';
    if (ht === 'digitalocean' && dm === 'existing' && (did || sh)) {
      loadRebuildHostOs();
    }
  });

  async function loadRebuildHostOs() {
    hostOsLoading = true;
    try {
      const res = await fetchHostOs(api, {
        profile,
        dropletId: doDropletId,
        sshHost: profileData?.sshHost || config?.step4?.sshHost,
        apiKey: profileData?.doApiKey || config?.step4?.doApiKey,
      });
      hostOsInfo = res?.droplet || null;
      if (hostOsInfo?.hostArchWizard) rebuildArch = hostOsInfo.hostArchWizard;
      if (hostOsInfo?.hostOsWizard) rebuildTargetOs = hostOsInfo.hostOsWizard;
      if (!config && profileData?.wizardConfig?.step2?.rebuildTargetOS) {
        rebuildTargetOs = profileData.wizardConfig.step2.rebuildTargetOS;
      }
    } catch {
      hostOsInfo = null;
    } finally {
      hostOsLoading = false;
    }
  }

  async function refreshPublishEligibility() {
    if (!profile) return;
    try {
      publishEligibility = await api.get(`/api/deploy/${encodeURIComponent(profile)}/eligibility`);
      canPublish = !!publishEligibility.canPublish;
    } catch { /* non-fatal */ }
  }

  onDestroy(() => {
    closeWs();
  });

  // ── Checks ────────────────────────────────────────────────────────────────

  async function runChecks(mode = 'full') {
    checksRunning = true;
    checksDone    = false;
    checks        = [];
    try {
      const result = await api.post(`/api/deploy/${profile}/checks`, { mode });
      checks     = result.results || [];
      checksDone = true;
    } catch (err) {
      checks     = [{ id: 'error', label: 'Error', ok: false, detail: err.message }];
      checksDone = true;
    } finally {
      checksRunning = false;
    }
  }

  // ── Deploy ────────────────────────────────────────────────────────────────

  async function persistRebuildDismissed(dismissed) {
    const patch = {
      rebuildDismissed: dismissed,
      rebuildTargetOS: rebuildTargetOs,
    };
    if (config) {
      wizardStore.setStep(2, { ...(config.step2 || {}), ...patch });
    }
    if (profileData?.wizardConfig) {
      profileData = {
        ...profileData,
        wizardConfig: {
          ...profileData.wizardConfig,
          step2: { ...(profileData.wizardConfig.step2 || {}), ...patch },
        },
      };
    }
    try {
      await saveStep2Prefs(api, profile, patch);
    } catch { /* non-fatal */ }
  }

  function handleRebuildCancel() {
    rebuildDismissedLocal = true;
    showRebuildAdvanced = false;
    if (hostOsInfo?.hostOsWizard) {
      rebuildTargetOs = hostOsInfo.hostOsWizard;
    }
    persistRebuildDismissed(true);
  }

  function handleRebuildTargetChange(os) {
    rebuildTargetOs = os;
    const current = hostOsInfo?.hostOsWizard;
    if (current && os !== current) {
      rebuildDismissedLocal = false;
      showRebuildAdvanced = true;
      persistRebuildDismissed(false);
    }
  }

  function showRebuildAdvancedPanel() {
    showRebuildAdvanced = true;
    rebuildDismissedLocal = false;
  }

  async function startRebuildDeploy({ targetOS, confirmDropletName, acknowledgeDataLoss }) {
    if (deploying) return;
    deploying   = true;
    deployDone  = false;
    logLines    = [];
    scanResults = [];
    deployUrl   = null;
    healthResult = null;
    showCleanup = false;
    cleanupDone = false;

    try {
      const { deployId: id } = await api.post(`/api/deploy/${profile}/run`, {
        mode: 'rebuild',
        targetOS,
        confirmDropletName,
        acknowledgeDataLoss,
      });
      deployId = id;
      openWs(id);
    } catch (err) {
      addLog(`ERROR: ${err.message}`, 'stderr');
      deploying = false;
      deployDone = true;
      deploySuccess = false;
    }
  }

  async function startDeploy(mode = 'full') {
    if (deploying) return;
    deploying   = true;
    deployDone  = false;
    logLines    = [];
    if (mode !== 'publish') scanResults = [];
    deployUrl    = null;
    healthResult = null;
    showCleanup  = false;
    cleanupDone  = false;

    try {
      const { deployId: id } = await api.post(`/api/deploy/${profile}/run`, { mode });
      deployId = id;
      openWs(id);
    } catch (err) {
      addLog(`ERROR: ${err.message}`, 'stderr');
      deploying   = false;
      deployDone  = true;
      deploySuccess = false;
    }
  }

  async function startPublish() {
    if (deploying || !canPublish) return;
    checksRunning = true;
    checksDone    = false;
    checks        = [];
    try {
      const result = await api.post(`/api/deploy/${profile}/checks`, { mode: 'publish' });
      checks     = result.results || [];
      checksDone = true;
      if (!checks.every((c) => c.ok)) return;
      await startDeploy('publish');
    } catch (err) {
      checks     = [{ id: 'error', label: 'Error', ok: false, detail: err.message }];
      checksDone = true;
    } finally {
      checksRunning = false;
    }
  }

  function openWs(id) {
    closeWs();
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws`);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'deploy_subscribe', deployId: id }));
    };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.type === 'log') {
        addLog(msg.line, msg.stream);
      } else if (msg.type === 'scan_results') {
        scanResults = msg.results || [];
        // Auto-expand the first scanner with findings, or first skipped scanner
        const first = scanResults.find(r => r.findings?.length > 0)
                   || scanResults.find(r => r.status === 'skipped');
        if (first) expandedScanner = first.scanner;
      } else if (msg.type === 'deploy_complete') {
        deploying     = false;
        deployDone    = true;
        deploySuccess = msg.success;
        if (msg.deployUrl) deployUrl = msg.deployUrl;
        closeWs();
        if (msg.success) {
          canPublish = true;
          refreshPublishEligibility();
          addLog('', 'stdout');
          addLog('[WDP] ✓ All services are running.', 'stdout');
        }
      } else if (msg.type === 'deploy_error') {
        addLog(`ERROR: ${msg.message}`, 'stderr');
        deploying   = false;
        deployDone  = true;
        deploySuccess = false;
        closeWs();
      }
    };

    ws.onclose = () => {
      if (deploying) {
        deploying = false;
        deployDone = true;
        deploySuccess = false;
        addLog('[WDP] WebSocket connection closed unexpectedly', 'stderr');
      }
    };
  }

  function addLog(line, stream = 'stdout') {
    logLines = [...logLines, { line, stream, ts: Date.now() }];
    // Auto-scroll log output
    if (logEl) {
      setTimeout(() => { logEl.scrollTop = logEl.scrollHeight; }, 10);
    }
  }

  function closeWs() {
    if (ws) { try { ws.close(); } catch {} ws = null; }
  }

  // ── Health check ──────────────────────────────────────────────────────────

  async function runHealthCheck() {
    healthRunning = true;
    healthResult  = null;
    try {
      healthResult = await api.post(`/api/deploy/${profile}/health-check`);
      if (healthResult.ok) showCleanup = true;
    } catch (err) {
      healthResult = { ok: false, message: err.message };
    } finally {
      healthRunning = false;
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  async function cancelDeploy() {
    if (!deployId || !deploying) return;
    try {
      await api.post(`/api/deploy/${profile}/cancel`, { deployId });
    } catch { /* ignore — WS complete event will handle state */ }
  }

  async function runCleanup() {
    cleanupRunning = true;
    try {
      const { cleanupId } = await api.post(`/api/deploy/${profile}/cleanup`, { mode: cleanupMode });
      // subscribe to cleanup log stream via WS
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const cws = new WebSocket(`${proto}//${location.host}/ws`);
      cws.onopen = () => cws.send(JSON.stringify({ type: 'deploy_subscribe', deployId: cleanupId }));
      cws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.type === 'log') addLog(m.line, m.stream);
        if (m.type === 'deploy_complete') { cws.close(); cleanupRunning = false; cleanupDone = true; }
      };
    } catch (err) {
      addLog(`Cleanup error: ${err.message}`, 'stderr');
      cleanupRunning = false;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function reset() {
    checksDone    = false;
    checks        = [];
    deployId      = null;
    deploying     = false;
    deployDone    = false;
    deploySuccess = false;
    logLines      = [];
    scanResults   = [];
    expandedScanner = null;
    healthResult  = null;
    showCleanup   = false;
    cleanupDone   = false;
    refreshPublishEligibility();
  }

  // ── Security scan helpers ──────────────────────────────────────────────────

  const SEV_META = {
    CRITICAL: { label: 'CRITICAL', cls: 'bg-red-700/30 text-red-300 border-red-700/50' },
    HIGH:     { label: 'HIGH',     cls: 'bg-orange-700/30 text-orange-300 border-orange-700/50' },
    MEDIUM:   { label: 'MEDIUM',   cls: 'bg-yellow-700/30 text-yellow-300 border-yellow-700/50' },
    LOW:      { label: 'LOW',      cls: 'bg-blue-700/30 text-blue-300 border-blue-700/50' },
    INFO:     { label: 'INFO',     cls: 'bg-gray-700/30 text-gray-400 border-gray-700/50' },
  };

  function scanStatusMeta(status) {
    if (status === 'pass')    return { icon: '✓', cls: 'text-green-400', bg: 'border-green-800/30 bg-green-950/10' };
    if (status === 'warn')    return { icon: '⚠', cls: 'text-amber-400',  bg: 'border-amber-800/30 bg-amber-950/10' };
    if (status === 'fail')    return { icon: '✗', cls: 'text-red-400',   bg: 'border-red-800/30 bg-red-950/10' };
    if (status === 'skipped') return { icon: '⏭', cls: 'text-gray-500',  bg: 'border-gray-700/30 bg-gray-800/20' };
    return                           { icon: '!', cls: 'text-gray-400',  bg: 'border-gray-700/30 bg-gray-800/20' };
  }

  function countBySeverity(findings) {
    const c = {};
    for (const f of findings || []) c[f.severity] = (c[f.severity] || 0) + 1;
    return c;
  }

  function hasCriticalBlocking() {
    return scanResults.some(r =>
      r.findings?.some(f => f.severity === 'CRITICAL' && !dismissals[f.id])
    );
  }

  async function dismissFinding(id) {
    try {
      await api.post(`/api/deploy/${profile}/dismissals`, { id });
      dismissals = { ...dismissals, [id]: { dismissedAt: new Date().toISOString() } };
    } catch (err) { console.error('dismiss failed', err); }
  }

  async function undismissFinding(id) {
    try {
      await api.delete(`/api/deploy/${profile}/dismissals/${encodeURIComponent(id)}`);
      const d = { ...dismissals };
      delete d[id];
      dismissals = d;
    } catch (err) { console.error('undismiss failed', err); }
  }

  async function runNpmAuditFix(force = false) {
    if (force) fixForceRunning = true; else fixRunning = true;
    logLines   = [];
    lastBackupTs = null;
    restoreDone  = false;
    try {
      const params = new URLSearchParams();
      if (force) params.set('force', '1');
      if (!backupBeforeFix) params.set('backup', '0');
      const qs  = params.toString() ? '?' + params.toString() : '';
      const url = `/api/deploy/${profile}/security/npm-audit-fix${qs}`;
      const { fixId: id } = await api.post(url);
      fixId = id;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      fixWs = new WebSocket(`${proto}//${location.host}/ws`);
      fixWs.onopen = () => fixWs.send(JSON.stringify({ type: 'deploy_subscribe', deployId: id }));
      fixWs.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.type === 'log') {
          addLog(m.line, m.stream);
          // pick up backup timestamp from log line
          const bm = m.line.match(/\[WDP\] Backed up package files with timestamp (\S+)/);
          if (bm) lastBackupTs = bm[1];
        }
        if (m.type === 'deploy_complete') {
          fixWs.close(); fixWs = null;
          fixRunning = false; fixForceRunning = false;
          scanResults = [];
        }
      };
    } catch (err) {
      addLog(`npm audit fix error: ${err.message}`, 'stderr');
      fixRunning = false; fixForceRunning = false;
    }
  }

  async function restoreBackup() {
    if (!lastBackupTs || restoreRunning) return;
    if (!confirm(`Restore package.json and package-lock.json from backup ${lastBackupTs}?`)) return;
    restoreRunning = true;
    try {
      await api.post(`/api/deploy/${profile}/security/restore-backup`, { timestamp: lastBackupTs });
      restoreDone = true;
      addLog(`[WDP] ✓ Restored package files from backup ${lastBackupTs}`, 'stdout');
    } catch (err) {
      addLog(`Restore error: ${err.message}`, 'stderr');
    } finally {
      restoreRunning = false;
    }
  }

  async function fixPackage(finding) {
    const version = finding.fixedIn?.split(/[,\s]+/)[0]?.trim();
    if (!version || !finding.pkg) return;
    fixingPkgs = { ...fixingPkgs, [finding.id]: true };
    logLines = [];
    try {
      const { fixId: id } = await api.post(`/api/deploy/${profile}/security/fix-package`, { pkg: finding.pkg, version });
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}/ws`);
      ws.onopen = () => ws.send(JSON.stringify({ type: 'deploy_subscribe', deployId: id }));
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.type === 'log') addLog(m.line, m.stream);
        if (m.type === 'deploy_complete') {
          ws.close();
          const { [finding.id]: _, ...rest } = fixingPkgs;
          fixingPkgs = rest;
          if (m.success) scanResults = [];
        }
      };
    } catch (err) {
      addLog(`Fix failed: ${err.message}`, 'stderr');
      const { [finding.id]: _, ...rest } = fixingPkgs;
      fixingPkgs = rest;
    }
  }

  async function installTool(toolKey) {
    installingTools = { ...installingTools, [toolKey]: true };
    logLines = [];
    try {
      const { fixId: id } = await api.post(`/api/deploy/${profile}/security/install-tool`, { tool: toolKey });
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}/ws`);
      ws.onopen = () => ws.send(JSON.stringify({ type: 'deploy_subscribe', deployId: id }));
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.type === 'log') addLog(m.line, m.stream);
        if (m.type === 'deploy_complete') {
          ws.close();
          const { [toolKey]: _, ...rest } = installingTools;
          installingTools = rest;
          if (m.success) scanResults = [];
        }
      };
    } catch (err) {
      addLog(`Install failed: ${err.message}`, 'stderr');
      const { [toolKey]: _, ...rest } = installingTools;
      installingTools = rest;
    }
  }

  async function genLockfile() {
    lockfileRunning = true;
    logLines = [];
    try {
      const { fixId: id } = await api.post(`/api/deploy/${profile}/security/gen-lockfile`);
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}/ws`);
      ws.onopen = () => ws.send(JSON.stringify({ type: 'deploy_subscribe', deployId: id }));
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.type === 'log') addLog(m.line, m.stream);
        if (m.type === 'deploy_complete') {
          ws.close(); lockfileRunning = false;
          scanResults = [];
        }
      };
    } catch (err) {
      addLog(`Generate lockfile error: ${err.message}`, 'stderr');
      lockfileRunning = false;
    }
  }
</script>

{#if loadError}
  <div class="rounded-lg bg-red-950/40 border border-red-700/50 px-4 py-3 text-sm text-red-300 mb-6">
    {loadError}
  </div>
{:else}

<StaleGenerateBanner {staleInfo} profileName={profile} />

<!-- ── Target summary ──────────────────────────────────────────────────────── -->
<div class="mb-6 px-4 py-3 rounded-lg bg-gray-800/40 border border-gray-700/60 flex flex-wrap gap-4 text-sm">
  <div>
    <span class="text-gray-500 text-xs uppercase tracking-wide mr-1">{$_("deploy.targetLabel")}</span>
    <span class="text-white font-medium">
      {#if target === 'local'}🐳 Local Docker
      {:else if target === 'digitalocean'}🌊 DigitalOcean
      {:else if target === 'vps'}🖥️ Self-hosted VPS
      {:else if target === 'railway'}🚂 Railway
      {:else}{target || '—'}
      {/if}
    </span>
  </div>
  {#if showHostRow}
    <div>
      <span class="text-gray-500 text-xs uppercase tracking-wide mr-1">{$_("deploy.hostLabel")}</span>
      <a
        href="http://{displayHost}:{appPort}"
        target="_blank"
        rel="noopener noreferrer"
        class="text-gray-300 hover:text-indigo-300 transition font-mono text-xs"
      >{displayHost}:{appPort}</a>
    </div>
    {#if liveUrl}
    <div>
      <a
        href={liveUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md
               bg-green-900/30 border border-green-700/40 text-green-400
               hover:bg-green-900/50 hover:text-green-300 transition"
      >
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4
                   M14 4h6m0 0v6m0-6L10 14"/>
        </svg>
        {$_("deploy.viewLive")}
      </a>
    </div>
    {/if}
  {/if}
  {#if profileData?.domain}
    <div>
      <span class="text-gray-500 text-xs uppercase tracking-wide mr-1">{$_("deploy.domainLabel")}</span>
      <span class="text-gray-300">{profileData.domain}</span>
    </div>
  {/if}
</div>

{#if domainHost && !traefikOn && needsSsh}
  <div class="mb-6 px-4 py-3 rounded-lg border border-amber-700/50 bg-amber-950/20 text-sm text-amber-200/90">
    {$_('deploy.domainPortHint', { values: { domain: domainHost, port: appPort } })}
  </div>
{/if}

{#if canRebuildDo && !deployDone}
  <div class="mb-6">
    {#if rebuildDismissed && !showRebuildAdvanced}
      <button
        type="button"
        onclick={showRebuildAdvancedPanel}
        class="text-sm text-gray-400 hover:text-indigo-300 transition underline-offset-2 hover:underline"
      >
        {$_('deploy.rebuild.showAdvanced')}
      </button>
    {:else if hostOsLoading}
      <p class="text-xs text-gray-500">{$_('common.loading')}</p>
    {:else}
      <RebuildDropletPanel
        context="deploy"
        hostOs={hostOsInfo}
        bind:rebuildTargetOs
        architecture={rebuildArch}
        {deploying}
        on:targetChange={(e) => handleRebuildTargetChange(e.detail)}
        on:cancel={handleRebuildCancel}
        on:rebuild={(e) => startRebuildDeploy(e.detail)}
      />
    {/if}
  </div>
{/if}

<!-- ── Pre-deploy readiness checks ───────────────────────────────────────── -->
{#if !deployDone}
  <div class="mb-6">
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-sm font-semibold text-gray-300">{$_("deploy.checksHeading")}</h3>
      <button
        type="button"
        onclick={() => runChecks('full')}
        disabled={checksRunning}
        class="text-xs px-3 py-1.5 rounded-md font-medium transition
               {checksRunning
                 ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                 : 'bg-indigo-600 hover:bg-indigo-500 text-white'}"
      >
        {checksRunning ? $_('deploy.running') : checksDone ? $_('deploy.reRunChecks') : $_('deploy.runChecks')}
      </button>
    </div>

    {#if checks.length === 0 && !checksRunning}
      <p class="text-xs text-gray-500 italic">{$_("deploy.checksHint")}</p>
    {:else if checksRunning && checks.length === 0}
      <div class="flex items-center gap-2 text-sm text-gray-400 py-2">
        <div class="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin shrink-0"></div>
        {$_("deploy.checksRunningSpinner")}
      </div>
    {:else}
      <div class="space-y-2">
        {#each checks as check}
          <div class="flex items-start gap-3 px-4 py-3 rounded-lg border
                      {check.ok ? 'border-green-800/40 bg-green-950/20' : 'border-red-800/40 bg-red-950/20'}">
            <div class="mt-0.5 shrink-0 text-base leading-none">
              {check.ok ? '✓' : '✗'}
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium {check.ok ? 'text-green-300' : 'text-red-300'}">{check.label}</p>
              <p class="text-xs text-gray-400 mt-0.5">{check.detail}</p>
              {#if !check.ok && check.fixHint}
                <p class="text-xs text-amber-400/90 mt-1.5">
                  {$_(`remoteDocker.fix.${check.fixHint}`, { default: check.detail })}
                </p>
                <p class="text-xs text-gray-500 mt-1">{$_('remoteDocker.deployCheckHint')}</p>
              {/if}
            </div>
          </div>
        {/each}
      </div>

      {#if checksDone && !checksOk}
        <p class="text-xs text-amber-400 mt-3">
          {$_("deploy.checksWarning")}
        </p>
      {/if}
    {/if}
  </div>
{/if}

<!-- ── Deploy / Publish buttons (before scan panel so logs sit directly under deploy) ── -->
{#if !deployDone}
  <div class="mb-6 space-y-3">
    {#if canPublish}
      <p class="text-xs text-gray-500 leading-relaxed">{$_('deploy.publishAvailableHint')}</p>
    {/if}
    <div class="flex items-center gap-3 flex-wrap">
      {#if canPublish}
        <button
          type="button"
          onclick={startPublish}
          disabled={!canPublishNow || checksRunning}
          class="flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold transition focus:outline-none
                 focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-950
                 {!canPublishNow || checksRunning
            ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
            : 'bg-green-700 hover:bg-green-600 text-white'}"
        >
          {#if deploying}
            <div class="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></div>
            {$_('deploy.publishing')}
          {:else}
            {'📤 ' + $_('deploy.publishChanges')}
          {/if}
        </button>
      {/if}
      <button
        type="button"
        onclick={() => startDeploy('full')}
        disabled={deploying || (!checksDone)}
        class="flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold transition focus:outline-none
               focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-950
               {deploying || !checksDone
                 ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                 : checksOk
                   ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                   : 'bg-amber-700 hover:bg-amber-600 text-white'}"
      >
        {#if deploying && !canPublish}
          <div class="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></div>
          {$_('deploy.deploying')}
        {:else}
          {'🚀 ' + (canPublish ? $_('deploy.fullDeploy') : $_('deploy.deploy', { values: { target: target || 'target' } }))}
        {/if}
      </button>
      {#if deploying}
        <button type="button" onclick={cancelDeploy}
          class="px-4 py-3 rounded-lg text-sm font-semibold transition
                 bg-red-900/60 hover:bg-red-800/70 text-red-200 border border-red-700/50">
          {$_('deploy.cancel')}
        </button>
      {/if}
    </div>
    {#if !canPublish && !publishEligibility.hasSuccessfulDeploy}
      <p class="text-xs text-gray-500">{$_('deploy.publishAfterFirstDeploy')}</p>
    {:else if !checksDone && !canPublish}
      <p class="text-xs text-gray-500">{$_('deploy.checksFirstHint')}</p>
    {:else if !checksDone && canPublish}
      <p class="text-xs text-gray-500">{$_('deploy.publishRunsChecks')}</p>
    {:else if hasCriticalBlocking() && !deploying}
      <p class="text-xs text-red-400">{$_('deploy.scanBlockingDeploy')}</p>
    {:else if !checksOk && !canPublish}
      <p class="text-xs text-amber-400">{$_('deploy.checksWarningDeploy')}</p>
    {/if}
  </div>
{/if}

<!-- ── Log output (directly under deploy — build/sync logs appear here) ── -->
{#if logLines.length > 0 || deploying}
  <div class="mb-6">
    <h3 class="text-sm font-semibold text-gray-300 mb-2">{$_('deploy.logs')}</h3>
    <div
      bind:this={logEl}
      class="bg-gray-950 rounded-lg border border-gray-800 p-4 font-mono text-xs
             overflow-y-auto max-h-[420px] space-y-0.5"
    >
      {#each logLines as entry}
        <div class="leading-relaxed whitespace-pre-wrap break-all
                    {entry.stream === 'stderr' ? 'text-red-400' : 'text-gray-300'}">
          {entry.line}
        </div>
      {/each}
      {#if deploying}
        <div class="flex items-center gap-2 text-gray-500 mt-1">
          <div class="w-3 h-3 border-2 border-gray-500 border-t-gray-300 rounded-full animate-spin"></div>
          <span>{$_('deploy.running')}</span>
        </div>
      {/if}
    </div>
  </div>
{/if}

<!-- ── Security scan results (after log; scans run before build in the log) ── -->
{#if scanResults.length > 0}
  {@const totalFindings = scanResults.reduce((n, r) => n + (r.findings?.length || 0), 0)}
  {@const anyCritical   = scanResults.some(r => r.findings?.some(f => f.severity === 'CRITICAL' && !dismissals[f.id]))}
  <div class="mb-6">
    <p class="text-xs text-gray-500 mb-3">{$_('deploy.scanTimingNote')}</p>
    <details class="rounded-xl border border-gray-700/60 bg-gray-800/20" open={!deploying}>
      <summary class="cursor-pointer px-4 py-3 text-sm font-semibold text-gray-300">
        {$_('deploy.scanHeading')} ({totalFindings})
      </summary>
    <div class="px-4 pb-4 border-t border-gray-700/40">
    <div class="flex items-center justify-between mb-3 mt-3">
      <span class="text-xs text-gray-500">{scanResults.length} scanner{scanResults.length !== 1 ? 's' : ''}</span>
    </div>

    {#if anyCritical}
      <div class="mb-3 flex items-start gap-3 px-4 py-3 rounded-lg border border-red-700/60 bg-red-950/20 text-sm">
        <span class="text-red-400 text-base shrink-0">⛔</span>
        <div>
          <p class="text-red-300 font-semibold">{$_("deploy.scanBlocked")}</p>
          <p class="text-xs text-gray-400 mt-0.5">
            {$_("deploy.scanBlockedHint")}
          </p>
        </div>
      </div>
    {/if}

    <div class="space-y-2">
      {#each scanResults as result}
        {@const meta   = scanStatusMeta(result.status)}
        {@const counts = countBySeverity(result.findings)}
        {@const isOpen = expandedScanner === result.scanner}
        <div class="rounded-xl border {meta.bg} overflow-hidden">
          <!-- Scanner header row -->
          <button
            type="button"
            onclick={() => expandedScanner = isOpen ? null : result.scanner}
            class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition"
          >
            <span class="text-base leading-none shrink-0">{result.icon || '🔍'}</span>
            <span class="flex-1 text-sm font-medium text-gray-200">{result.label}</span>

            <!-- Severity pill counts -->
            {#each ['CRITICAL','HIGH','MEDIUM','LOW'] as sev}
              {#if counts[sev]}
                {@const sm = SEV_META[sev]}
                <span class="text-xs px-2 py-0.5 rounded-full border font-mono {sm.cls}">{counts[sev]} {sm.label}</span>
              {/if}
            {/each}

            {#if result.status === 'pass'}
              <span class="text-xs text-green-400">{$_("deploy.scanClean")}</span>
            {:else if result.status === 'skipped'}
              <span class="text-xs text-gray-500 italic">{$_("deploy.scanSkipped")}</span>
            {:else if result.status === 'error'}
              <span class="text-xs text-gray-400 italic">{$_("deploy.scanError")}</span>
            {/if}

            <span class="text-gray-500 text-xs ml-1">{isOpen ? '▲' : '▼'}</span>
          </button>

          {#if isOpen}
            <div class="border-t border-gray-700/40 px-4 py-3 space-y-2">

              <!-- Skipped / error explanation -->
              {#if result.status === 'skipped'}
                {@const isLockfile   = result.skipReason?.includes('package-lock')}
                {@const cmdMatch     = result.skipReason?.match(/run:\s*(.+)/i)}
                {@const urlMatch     = result.skipReason?.match(/install from\s+(https?:\/\/\S+)/i)}
                {@const isSocketCli  = result.scanner === 'socketCli'}
                {@const isDockerScout = result.scanner === 'dockerScout'
                                     && result.skipReason?.includes('plugin not installed')}
                {@const plainText    = result.skipReason
                  ?.replace(/run:\s*.+/i, '')
                  ?.replace(/install from\s+https?:\/\/\S+/i, '')
                  ?.trim()}
                <div class="space-y-2">
                  {#if plainText}
                    <p class="text-xs text-amber-400/80">{plainText}</p>
                  {/if}
                  {#if cmdMatch}
                    <div class="flex items-center gap-2">
                      <code class="flex-1 text-xs bg-gray-900 border border-gray-700 rounded px-2 py-1 text-amber-300 font-mono select-all">{cmdMatch[1]}</code>
                    </div>
                  {/if}
                  {#if urlMatch}
                    <a href={urlMatch[1]} target="_blank" rel="noreferrer"
                       class="text-xs text-indigo-400 hover:underline inline-block">{$_("deploy.installInstructions")}</a>
                  {/if}
                  {#if isSocketCli}
                    {@const busy = !!installingTools['socket-cli']}
                    <button type="button" onclick={() => installTool('socket-cli')} disabled={busy}
                      class="text-xs px-3 py-1.5 rounded-lg font-medium transition
                             {busy ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                                   : 'bg-indigo-800/60 hover:bg-indigo-700/60 text-indigo-100 border border-indigo-600/40'}"
                    >{busy ? $_('deploy.installing') : $_('deploy.installSocketCli')}</button>
                  {/if}
                  {#if isDockerScout}
                    {@const busy = !!installingTools['docker-scout']}
                    <button type="button" onclick={() => installTool('docker-scout')} disabled={busy}
                      class="text-xs px-3 py-1.5 rounded-lg font-medium transition
                             {busy ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                                   : 'bg-blue-800/60 hover:bg-blue-700/60 text-blue-100 border border-blue-600/40'}"
                    >{busy ? $_('deploy.installing') : $_('deploy.installDockerScout')}</button>
                  {/if}
                  {#if isLockfile}
                    <button
                      type="button"
                      onclick={genLockfile}
                      disabled={lockfileRunning}
                      class="text-xs px-3 py-1.5 rounded-lg font-medium transition
                             {lockfileRunning
                               ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                               : 'bg-amber-700/60 hover:bg-amber-600/60 text-amber-100 border border-amber-600/40'}"
                    >{lockfileRunning ? $_('deploy.generatingLockfile') : $_('deploy.genLockfile')}</button>
                  {/if}
                </div>
              {:else if result.status === 'error'}
                <p class="text-xs text-red-400">
                  {$_("deploy.scanFailed")}: {result.rawOutput?.slice(0, 200) || 'Unknown error'}
                </p>
              {:else if result.findings?.length === 0}
                <p class="text-xs text-green-400">{$_("deploy.noIssues")}</p>
              {:else}
                <!-- Findings list -->
                {#each result.findings as finding}
                  {@const sevMeta   = SEV_META[finding.severity] || SEV_META.INFO}
                  {@const dismissed = !!dismissals[finding.id]}
                  <div class="rounded-lg border {dismissed ? 'border-gray-700/30 bg-gray-800/10 opacity-60' : `border ${sevMeta.cls.includes('red') ? 'border-red-800/30' : 'border-gray-700/30'} bg-gray-900/40`} px-3 py-2.5 text-xs">
                    <div class="flex flex-wrap items-start gap-2">
                      <!-- Severity badge -->
                      <span class="shrink-0 px-1.5 py-0.5 rounded border font-mono text-[10px] {sevMeta.cls}">
                        {sevMeta.label}
                      </span>

                      <!-- Title + detail -->
                      <div class="flex-1 min-w-0">
                        <p class="text-gray-200 font-medium leading-snug">{finding.title}</p>
                        {#if finding.detail}
                          <p class="text-gray-400 mt-0.5 leading-relaxed">{finding.detail}</p>
                        {/if}
                        {#if finding.fixedIn}
                          {#if finding.vulnerablePkg && finding.pkg !== finding.vulnerablePkg}
                            <p class="text-green-400 mt-0.5">Fix: install {finding.pkg}@{finding.fixedIn} (resolves {finding.vulnerablePkg} vulnerability)</p>
                          {:else}
                            <p class="text-green-400 mt-0.5">Fix available: upgrade to {finding.fixedIn}</p>
                          {/if}
                        {:else if finding.fixForce}
                          <p class="text-amber-400 mt-0.5">Fix requires a breaking change — use the <strong>npm audit fix --force</strong> button above</p>
                        {/if}
                        {#if finding.url}
                          <a href={finding.url} target="_blank" rel="noreferrer"
                             class="text-indigo-400 hover:underline mt.0.5 inline-block">{$_("deploy.viewAdvisory")}</a>
                        {/if}
                      </div>

                      <!-- Actions -->
                      <div class="flex items-center gap-2 shrink-0">
                        {#if dismissed}
                          <span class="text-gray-500 italic text-[10px]">{$_("deploy.dismissed")}</span>
                          <button
                            type="button"
                            onclick={() => undismissFinding(finding.id)}
                            class="text-[10px] px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition"
                          >{$_("deploy.restore")}</button>
                        {:else}
                          {#if finding.fixedIn && finding.pkg}
                            {@const fixVer    = finding.fixedIn.split(/[,\s]+/)[0]?.trim()}
                            {@const isFixing  = !!fixingPkgs[finding.id]}
                            <button
                              type="button"
                              onclick={() => fixPackage(finding)}
                              disabled={isFixing}
                              class="text-[10px] px-2 py-1 rounded font-medium transition
                                     {isFixing
                                       ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                       : 'bg-green-800/60 hover:bg-green-700/60 text-green-200 border border-green-700/40'}"
                              title="Pins {finding.pkg}>={fixVer} in package.json overrides and runs npm install — fixes both direct and transitive versions"
                            >{isFixing ? $_('deploy.fixing') : $_('deploy.fix')}</button>
                          {/if}
                          <button
                            type="button"
                            onclick={() => dismissFinding(finding.id)}
                            class="text-[10px] px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition"
                            title="Dismiss — finding will not block future deploys"
                          >{$_("deploy.dismiss")}</button>
                        {/if}
                      </div>
                    </div>
                  </div>
                {/each}

                <!-- npm audit fix shortcut -->
                {#if result.scanner === 'npmAudit' && result.findings?.some(f => f.fixable)}
                  {@const anyRunning = fixRunning || fixForceRunning}
                  <div class="mt-2 pt-2 border-t border-gray-700/40 space-y-2">
                    <!-- Backup checkbox -->
                    <label class="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        bind:checked={backupBeforeFix}
                        disabled={anyRunning}
                        class="accent-indigo-500"
                      />
                      <span class="text-xs text-gray-300">{$_("deploy.backupBeforeFix")}</span>
                    </label>

                    <div class="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onclick={() => runNpmAuditFix(false)}
                        disabled={anyRunning}
                        class="text-xs px-3 py-1.5 rounded-lg font-medium transition
                               {fixRunning
                                 ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                 : anyRunning ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                 : 'bg-green-700 hover:bg-green-600 text-white'}"
                      >{fixRunning ? $_('deploy.running') : $_('deploy.npmAuditFix')}</button>

                      <button
                        type="button"
                        onclick={() => runNpmAuditFix(true)}
                        disabled={anyRunning}
                        class="text-xs px-3 py-1.5 rounded-lg font-medium transition
                               {fixForceRunning
                                 ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                 : anyRunning ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                 : 'bg-orange-800/70 hover:bg-orange-700/70 text-orange-100 border border-orange-600/40'}"
                      >{fixForceRunning ? $_('deploy.running') : $_('deploy.npmAuditFixForce')}</button>

                      <span class="text-xs text-gray-500">{$_("deploy.reDeployHint")}</span>
                    </div>

                    <!-- Restore backup button (shown after a fix if backup was made) -->
                    {#if lastBackupTs}
                      <div class="flex items-center gap-3 pt-1">
                        <button
                          type="button"
                          onclick={restoreBackup}
                          disabled={restoreRunning || restoreDone}
                          class="text-xs px-3 py-1.5 rounded-lg font-medium transition
                                 {restoreDone
                                   ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                   : restoreRunning
                                   ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                   : 'bg-gray-700 hover:bg-gray-600 text-gray-200 border border-gray-600'}"
                        >{restoreDone ? $_('deploy.restored') : restoreRunning ? $_('deploy.restoring') : $_('deploy.restoreBackup')}</button>
                        <span class="text-[10px] text-gray-500">Backup: {lastBackupTs}</span>
                      </div>
                    {/if}

                    <p class="text-[10px] text-orange-400/70 leading-relaxed">
                      {$_("deploy.forceWarning")}
                    </p>
                  </div>
                {/if}
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
    </div>
    </details>
  </div>
{/if}

{#if deployDone}
  <div class="mb-6 rounded-lg px-4 py-3 border
              {deploySuccess ? 'bg-green-950/30 border-green-700/50' : 'bg-red-950/30 border-red-700/50'}">
    <div class="flex items-center gap-3 flex-wrap">
      <span class="text-lg">{deploySuccess ? '✅' : '❌'}</span>
      <p class="text-sm font-semibold {deploySuccess ? 'text-green-300' : 'text-red-300'}">
        {deploySuccess ? $_('deploy.success') : $_('deploy.failed')}
      </p>
      {#if deploySuccess && canPublish}
        <p class="text-xs text-gray-400 w-full mt-1">{$_('deploy.publishNextHint')}</p>
      {/if}
      {#if deploySuccess && deployUrl}
        <a
          href={deployUrl}
          target="_blank"
          rel="noreferrer"
          class="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                 bg-green-800/50 hover:bg-green-700/50 text-green-200 border border-green-700/40
                 transition"
        >
          {$_('deploy.openApp')}
        </a>
      {/if}
    </div>
  </div>
{/if}

<!-- ── Post-deploy health check ───────────────────────────────────────────── -->
{#if deployDone && deploySuccess}
  <div class="mb-6 p-4 rounded-lg border border-gray-700/60 bg-gray-800/30">
    <h3 class="text-sm font-semibold text-gray-300 mb-3">{$_("deploy.healthHeading")}</h3>

    {#if !healthResult}
      <button
        type="button"
        onclick={runHealthCheck}
        disabled={healthRunning}
        class="text-sm px-4 py-2 rounded-md font-medium transition
               {healthRunning ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}"
      >
        {healthRunning ? $_('deploy.healthChecking') : $_('deploy.healthCheck')}
      </button>
      <p class="text-xs text-gray-500 mt-2">
        {$_("deploy.healthHint")}
      </p>
    {:else}
      <div class="flex items-start gap-3 px-4 py-3 rounded-lg border
                  {healthResult.ok ? 'bg-green-950/20 border-green-800/40' : 'bg-red-950/20 border-red-800/40'}">
        <span class="text-lg leading-none mt-0.5">{healthResult.ok ? '✅' : '❌'}</span>
        <div>
          <p class="text-sm font-medium {healthResult.ok ? 'text-green-300' : 'text-red-300'}">
            {healthResult.message}
          </p>
          {#if healthResult.url}
            <p class="text-xs text-gray-400 mt-0.5">{healthResult.url}</p>
          {/if}
        </div>
      </div>
    {/if}
  </div>
{/if}

<!-- ── Post-deploy Docker cleanup ────────────────────────────────────────── -->
{#if showCleanup && !cleanupDone}
  <div class="mb-6 p-4 rounded-lg border border-gray-700/60 bg-gray-800/30">
    <h3 class="text-sm font-semibold text-gray-300 mb-1">{$_("deploy.cleanupHeading")}</h3>
    <p class="text-xs text-gray-500 mb-4">
      {$_("deploy.cleanupHint")}
    </p>

    <div class="flex flex-wrap items-center gap-3">
      <label class="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
        <input type="radio" bind:group={cleanupMode} value="dangling" class="accent-indigo-500" />
        {$_("deploy.cleanupDangling")}
      </label>
      <label class="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
        <input type="radio" bind:group={cleanupMode} value="all" class="accent-indigo-500" />
        {$_("deploy.cleanupAll")}
      </label>
    </div>

    <button
      type="button"
      onclick={runCleanup}
      disabled={cleanupRunning}
      class="mt-4 text-sm px-4 py-2 rounded-md font-medium transition
             {cleanupRunning ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-gray-700 hover:bg-gray-600 text-white border border-gray-600'}"
    >
      {cleanupRunning ? $_('deploy.cleaningUp') : $_('deploy.runCleanup')}
    </button>
  </div>
{:else if cleanupDone}
  <div class="mb-6 rounded-lg px-4 py-2 bg-green-950/20 border border-green-800/40 text-sm text-green-300">
    {$_('deploy.cleanupDone')}
  </div>
{/if}

<!-- ── Re-deploy / back actions ──────────────────────────────────────────── -->
{#if deployDone}
  <div class="flex gap-3 mt-2">
    <button
      type="button"
      onclick={reset}
      class="text-sm px-4 py-2 rounded-md font-medium bg-gray-700 hover:bg-gray-600
             text-white border border-gray-600 transition"
    >
      {$_('deploy.reDeploy')}
    </button>
  </div>
{/if}

{/if}
