<!--
  RemoteDockerReadiness.svelte
  Remote Docker / Compose health check with optional install.
-->
<script>
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { api } from '$lib/api.js';
  import { _ } from 'svelte-i18n';

  const dispatch = createEventDispatcher();

  /** Saved profile name — used when no live sshProbe */
  export let profileName = '';
  /** Wizard Step 4 probe when profile not saved yet */
  export let sshProbe = null; // { sshHost, sshUser, sshKeyPath }
  /** Run check automatically on mount / when refreshKey changes */
  export let autoCheck = true;
  export let refreshKey = 0;
  /** 'card' | 'banner' */
  export let variant = 'card';
  /** Show "Skip for now" — does not block wizard or deploy */
  export let dismissible = false;

  let status = null;
  let loading = false;
  let error = '';
  let installing = false;
  let installJobId = null;
  let installLogs = [];
  let showInstallLog = false;
  let skipped = false;
  let ws = null;

  $: canProbe = profileName || (sshProbe?.sshHost && sshProbe?.sshKeyPath);
  $: canInstallHere = status?.canInstall && (profileName || (sshProbe?.sshHost && sshProbe?.sshKeyPath));
  $: helpHref = '/help?doc=troubleshooting-deploy-server';

  onMount(() => {
    if (autoCheck && canProbe && !skipped) checkStatus();
  });

  $: if (refreshKey && canProbe && autoCheck && !skipped) checkStatus();

  onDestroy(closeWs);

  async function checkStatus() {
    if (!canProbe || skipped) return;
    loading = true;
    error = '';
    try {
      if (sshProbe?.sshHost?.trim() && sshProbe?.sshKeyPath?.trim()) {
        status = await api.post('/api/config/probe-docker', {
          sshHost: sshProbe.sshHost.trim(),
          sshUser: (sshProbe.sshUser || 'root').trim(),
          sshKeyPath: sshProbe.sshKeyPath.trim(),
        });
      } else if (profileName) {
        status = await api.get(`/api/config/profiles/${encodeURIComponent(profileName)}/docker-status`);
      }
    } catch (err) {
      status = null;
      error = err.message || $_('remoteDocker.checkFailed');
    } finally {
      loading = false;
    }
  }

  async function installDocker() {
    if (!canInstallHere) return;
    if (!confirm($_('remoteDocker.installConfirm'))) return;
    installing = true;
    installLogs = [];
    showInstallLog = true;
    error = '';
    try {
      let res;
      if (sshProbe?.sshHost?.trim() && sshProbe?.sshKeyPath?.trim()) {
        res = await api.post('/api/config/probe-docker/install', {
          sshHost: sshProbe.sshHost.trim(),
          sshUser: (sshProbe.sshUser || 'root').trim(),
          sshKeyPath: sshProbe.sshKeyPath.trim(),
          acknowledge: true,
          targetOS: status?.targetOS,
        });
      } else {
        res = await api.post(
          `/api/config/profiles/${encodeURIComponent(profileName)}/install-docker`,
          { acknowledge: true, targetOS: status?.targetOS },
        );
      }
      installJobId = res.jobId;
      openWs(res.jobId);
    } catch (err) {
      installing = false;
      error = err.message;
    }
  }

  function skipForNow() {
    skipped = true;
    closeWs();
    installing = false;
    dispatch('skip');
  }

  function showAgain() {
    skipped = false;
    checkStatus();
  }

  function openWs(jobId) {
    closeWs();
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'deploy_subscribe', deployId: jobId }));
    };
    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'log') {
        installLogs = [...installLogs, { line: msg.line, stream: msg.stream }];
      } else if (msg.type === 'deploy_complete') {
        installing = false;
        closeWs();
        checkStatus();
      } else if (msg.type === 'deploy_error') {
        installing = false;
        installLogs = [...installLogs, { line: `ERROR: ${msg.message}`, stream: 'stderr' }];
        closeWs();
      }
    };
    ws.onclose = () => {
      if (installing) installing = false;
    };
  }

  function closeWs() {
    if (ws) { try { ws.close(); } catch {} ws = null; }
  }

  function fixMessage() {
    if (!status?.fixHint) return '';
    const key = `remoteDocker.fix.${status.fixHint}`;
    const t = $_(key);
    return t === key ? status.detail : t;
  }
</script>

{#if canProbe && skipped && dismissible}
  <button
    type="button"
    onclick={showAgain}
    class="text-xs text-gray-500 hover:text-indigo-300 underline-offset-2 hover:underline"
  >{$_('remoteDocker.showAgain')}</button>
{:else if canProbe && !skipped}
  <div
    class="w-full rounded-xl border px-4 py-3 space-y-3
           {variant === 'banner' ? 'border-amber-700/50 bg-amber-950/25' : 'border-gray-800 bg-gray-900/40'}"
  >
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div>
        <p class="text-sm font-medium {status?.ok ? 'text-green-300' : 'text-gray-200'}">
          {$_('remoteDocker.title')}
        </p>
        <p class="text-xs text-gray-500 mt-0.5">{$_('remoteDocker.subtitleOptional')}</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        {#if dismissible}
          <button
            type="button"
            onclick={skipForNow}
            disabled={installing}
            class="text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-400 hover:text-gray-200 hover:bg-gray-800 disabled:opacity-50"
          >{$_('remoteDocker.skip')}</button>
        {/if}
        <button
          type="button"
          onclick={checkStatus}
          disabled={loading || installing}
          class="text-xs px-3 py-1.5 rounded border border-gray-600 text-gray-300 hover:bg-gray-800 disabled:opacity-50"
        >{loading ? $_('common.loading') : $_('remoteDocker.checkNow')}</button>
      </div>
    </div>

    {#if loading && !status}
      <p class="text-xs text-gray-500">{$_('remoteDocker.checking')}</p>
    {:else if error}
      <p class="text-xs text-red-400">{error}</p>
    {:else if status}
      <div class="grid sm:grid-cols-2 gap-2 text-xs">
        <div class="flex justify-between gap-2 rounded-lg bg-gray-950/60 px-3 py-2">
          <span class="text-gray-500">{$_('remoteDocker.docker')}</span>
          <span class="{status.ok ? 'text-green-400' : 'text-amber-300'} font-mono">
            {status.dockerVersion || $_('remoteDocker.notFound')}
          </span>
        </div>
        <div class="flex justify-between gap-2 rounded-lg bg-gray-950/60 px-3 py-2">
          <span class="text-gray-500">{$_('remoteDocker.compose')}</span>
          <span class="{status.ok ? 'text-green-400' : 'text-amber-300'} font-mono">
            {status.composeVersion || $_('remoteDocker.notFound')}
          </span>
        </div>
      </div>

      {#if status.isPodman}
        <p class="text-xs text-amber-300">{$_('remoteDocker.podmanDetected')}</p>
      {/if}

      {#if !status.ok}
        <p class="text-xs text-amber-200/90">{fixMessage()}</p>
        <p class="text-xs text-gray-500">
          <a href={helpHref} class="text-indigo-400 hover:text-indigo-300 underline underline-offset-2">
            {$_('remoteDocker.docHintLink')}
          </a>
        </p>
        <div class="flex flex-wrap gap-2">
          {#if canInstallHere}
            <button
              type="button"
              onclick={installDocker}
              disabled={installing}
              class="text-xs px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50"
            >{installing ? $_('remoteDocker.installing') : $_('remoteDocker.install')}</button>
          {/if}
        </div>
      {:else}
        <p class="text-xs text-green-400/90">{$_('remoteDocker.ready')}</p>
      {/if}
    {/if}

    {#if showInstallLog && installLogs.length > 0}
      <div class="rounded-lg border border-gray-800 bg-gray-950 max-h-40 overflow-y-auto p-2 font-mono text-xs space-y-0.5">
        {#each installLogs as entry}
          <div class="whitespace-pre-wrap break-all {entry.stream === 'stderr' ? 'text-red-400' : 'text-gray-400'}">
            {entry.line}
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
