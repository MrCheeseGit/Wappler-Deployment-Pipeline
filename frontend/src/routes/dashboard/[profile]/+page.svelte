<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { wizardStore } from '$lib/wizardStore.js';
  import { mergeProfileIntoWizard } from '$lib/profileWizardSync.js';
  import DeployPanel from '$lib/components/DeployPanel.svelte';
  import Terminal from '$lib/Terminal.svelte';
  import GitPanel from '$lib/components/GitPanel.svelte';
  import KnowledgePanel from '$lib/components/KnowledgePanel.svelte';
  import ServerPanel from '$lib/components/ServerPanel.svelte';
  import DeployActivityHeatmap from '$lib/components/DeployActivityHeatmap.svelte';
  import AboutModal from '$lib/components/AboutModal.svelte';
  import SshKeyPathInput from '$lib/components/SshKeyPathInput.svelte';
  import { _ } from 'svelte-i18n';

  let aboutOpen = false;
  $: profileName = $page.params.profile;

  let activeTab    = 'deploy';
  let profileData  = null;
  let history      = [];
  let loadingHist  = false;
  let histError    = '';
  let rollbackBusy = '';
  let deleting     = false;

  // Webhook token (Settings tab)
  let webhookToken    = '';
  let generatingToken = false;

  // SSH connection (Settings tab)
  let connSshHost     = '';
  let connSshUser     = 'root';
  let connSshKeyPath  = '~/.ssh/id_ed25519';
  let connRemotePath  = '';
  let connSaving      = false;
  let connMessage     = '';
  let connError       = false;
  let connTestState   = 'idle';
  let connTestMessage = '';

  $: target   = profileData?.hostingTarget || '';
  $: hasSsh   = target === 'vps' || target === 'digitalocean';
  $: hasDo    = target === 'digitalocean';
  $: webhookUrl = `/api/webhook/deploy/${profileName}`;

  onMount(async () => {
    if (!profileName) { goto('/dashboard'); return; }
    try {
      const cfg = await api.get('/api/config');
      profileData = cfg.profiles?.[profileName] || null;
      syncConnectionFields();
    } catch { /* ignore */ }
    loadHistory();
  });

  function syncConnectionFields() {
    if (!profileData) return;
    const s4 = profileData.wizardConfig?.step4 || {};
    connSshHost    = profileData.sshHost    || s4.sshHost    || '';
    connSshUser    = profileData.sshUser    || s4.sshUser    || 'root';
    connSshKeyPath = profileData.sshKeyPath || s4.sshKeyPath || '~/.ssh/id_ed25519';
    connRemotePath = profileData.remotePath || s4.remotePath || '';
  }

  async function saveConnection() {
    connSaving = true;
    connMessage = '';
    connError = false;
    try {
      const res = await api.patch(
        `/api/config/profiles/${encodeURIComponent(profileName)}/connection`,
        {
          sshHost: connSshHost.trim(),
          sshUser: connSshUser.trim(),
          sshKeyPath: connSshKeyPath.trim(),
          remotePath: connRemotePath.trim(),
        },
      );
      connMessage = $_('profile.settings.connectionSaved');
      profileData = {
        ...profileData,
        sshHost: res.sshHost,
        sshUser: res.sshUser,
        sshKeyPath: res.sshKeyPath,
        remotePath: res.remotePath,
      };
    } catch (err) {
      connError = true;
      connMessage = err.message;
    } finally {
      connSaving = false;
    }
  }

  async function testConnectionSettings() {
    connTestState = 'testing';
    connTestMessage = '';
    try {
      const result = await api.post('/api/config/test-ssh', {
        sshHost: connSshHost.trim(),
        sshUser: connSshUser.trim(),
        sshKeyPath: connSshKeyPath.trim(),
      });
      connTestState = result.ok ? 'ok' : 'fail';
      connTestMessage = result.message;
    } catch (err) {
      connTestState = 'fail';
      connTestMessage = err.message || 'Connection failed';
    }
  }

  async function loadHistory() {
    loadingHist = true;
    histError   = '';
    try {
      const result = await api.get(`/api/deploy/${profileName}/history`);
      history = result.entries || [];
    } catch (err) {
      histError = err.message;
    } finally {
      loadingHist = false;
    }
  }

  async function rollback(entry) {
    if (!confirm(`Rollback "${profileName}" to deployment from ${fmtDate(entry.startedAt)}?`)) return;
    rollbackBusy = entry.id;
    try {
      const result = await api.post(`/api/deploy/${profileName}/rollback/${entry.id}`);
      activeTab = 'deploy';
      // DeployPanel will show the new deploy via its own mechanism
    } catch (err) {
      alert(`Rollback failed: ${err.message}`);
    } finally {
      rollbackBusy = '';
    }
  }

  async function generateWebhookToken() {
    generatingToken = true;
    try {
      const res = await api.post(`/api/profiles/${encodeURIComponent(profileName)}/webhook-token`, {});
      webhookToken = res.token;
      // reload profile to pick up the saved token
      const cfg = await api.get('/api/config');
      profileData = cfg.profiles?.[profileName] || profileData;
    } catch (err) {
      alert(`Failed to generate token: ${err.message}`);
    } finally {
      generatingToken = false;
    }
  }

  let exportBusy  = false;
  let exportError = '';

  async function downloadZip() {
    exportBusy  = true;
    exportError = '';
    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(profileName)}/export.zip`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        exportError = body.error || $_('profile.header.exportError');
        return;
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `wdp-${profileName}-export.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      exportError = err.message || $_('profile.header.exportError');
    } finally {
      exportBusy = false;
    }
  }

  async function deleteProfile() {
    if (!confirm(`Delete profile "${profileName}"?\n\nThis removes it from WDP. Generated files in your project folder are NOT deleted.`)) return;
    deleting = true;
    try {
      await api.delete(`/api/config/profiles/${profileName}`);
      goto('/dashboard');
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
      deleting = false;
    }
  }

  function editProfile() {
    if (profileData?.wizardConfig) {
      wizardStore.set(
        mergeProfileIntoWizard(profileData, profileName) ||
          { ...profileData.wizardConfig, activeProfile: profileName },
      );
    } else {
      wizardStore.reset();
      wizardStore.setProfile(profileName);
      wizardStore.setStep(1, { profileMode: 'existing', selectedProfile: profileName });
    }
    goto('/wizard/step1');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  /** How long the deploy run took (not the deploy clock time). */
  function fmtDuration(start, end) {
    if (!start || !end) return '';
    const ms = new Date(end) - new Date(start);
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  }

  function fmtRelative(iso) {
    if (!iso) return '';
    const sec = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
    const abs = Math.abs(sec);
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    if (abs < 60) return rtf.format(sec, 'second');
    if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(sec / 3600), 'hour');
    return rtf.format(Math.round(sec / 86400), 'day');
  }
</script>

<div class="min-h-screen bg-gray-950 flex flex-col">

  <!-- Header -->
  <header class="border-b border-gray-800 px-4 py-4">
    <div class="max-w-5xl mx-auto flex items-center justify-between gap-4">
      <div class="flex items-center gap-3">
        <a href="/dashboard" class="text-gray-500 hover:text-white transition text-sm">{$_('profile.header.profiles')}</a>
        <span class="text-gray-700">/</span>
        <h1 class="text-white font-semibold">{profileName}</h1>
        {#if target}
          <span class="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 border border-gray-700">
            {target === 'local' ? '🐳 Local' :
             target === 'digitalocean' ? '🌊 DO' :
             target === 'vps' ? '🖥️ VPS' :
             target === 'railway' ? '🚂 Railway' : target}
          </span>
        {/if}
      </div>
      <div class="flex items-center gap-3">
        <button
          type="button"
          onclick={() => aboutOpen = true}
          class="text-gray-400 hover:text-white text-sm transition"
        >{$_('profile.header.about')}</button>
        <a href="/help" class="text-gray-400 hover:text-white text-sm transition">{$_('nav.help')}</a>
        <a href="/profile" class="text-gray-400 hover:text-white text-sm transition">{$_('nav.userProfile')}</a>
        <button
          onclick={downloadZip}
          disabled={exportBusy}
          class="text-sm text-gray-400 hover:text-gray-200 transition disabled:opacity-50"
          title={$_('profile.header.exportZipTitle')}
        >{exportBusy ? $_('common.loading') : $_('profile.header.exportZip')}</button>
        {#if exportError}
          <span class="text-xs text-red-400">{exportError}</span>
        {/if}
        <button
          onclick={editProfile}
          class="text-sm text-indigo-400 hover:text-indigo-300 transition"
        >
          {$_('profile.header.editWizard')}
        </button>
        <button
          onclick={deleteProfile}
          disabled={deleting}
          class="text-sm text-red-500 hover:text-red-400 transition disabled:opacity-50"
        >
          {deleting ? $_('profile.header.deleting') : $_('profile.header.deleteProfile')}
        </button>
      </div>
    </div>
  </header>

  <AboutModal bind:open={aboutOpen} />

  <main class="flex-1 max-w-5xl mx-auto w-full px-4 py-8">

    <!-- Tab bar -->
    <div class="flex gap-1 mb-8 border-b border-gray-800">
      {#each [
        { id: 'deploy',   label: $_('profile.tabs.deploy') },
        { id: 'history',  label: $_('profile.tabs.history') },
        ...(hasDo ? [{ id: 'server', label: $_('profile.tabs.server') }] : []),
        ...(hasSsh ? [{ id: 'terminal', label: $_('profile.tabs.terminal') }] : []),
        { id: 'git',      label: $_('profile.tabs.git') },
        { id: 'knowledge', label: $_('profile.tabs.knowledge') },
        { id: 'settings', label: $_('profile.tabs.settings') },
      ] as tab}
        <button
          type="button"
          onclick={() => activeTab = tab.id}
          class="px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-px
                 {activeTab === tab.id
                   ? 'border-indigo-500 text-white'
                   : 'border-transparent text-gray-400 hover:text-gray-200'}"
        >
          {tab.label}
        </button>
      {/each}
    </div>

    <!-- ── Deploy tab ───────────────────────────────────────────────────── -->
    {#if activeTab === 'deploy'}
      <DeployPanel profile={profileName} />
    {/if}

    <!-- ── History tab ──────────────────────────────────────────────────── -->
    {#if activeTab === 'history'}
      <div class="mb-6">
        <DeployActivityHeatmap profile={profileName} />
      </div>

      <div class="flex items-center justify-between mb-4">
        <h2 class="text-sm font-semibold text-gray-300">{$_('profile.history.title')}</h2>
        <button
          onclick={loadHistory}
          class="text-xs text-gray-500 hover:text-gray-300 transition"
        >
          {$_('profile.history.refresh')}
        </button>
      </div>

      {#if loadingHist}
        <div class="flex items-center gap-2 text-sm text-gray-500 py-4">
          <div class="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          {$_('profile.history.loading')}
        </div>
      {:else if histError}
        <p class="text-sm text-red-400">{histError}</p>
      {:else if history.length === 0}
        <div class="text-center py-12 text-gray-500">
          <div class="text-3xl mb-3">📋</div>
          <p class="text-sm">{$_('profile.history.noDeployments')}</p>
        </div>
      {:else}
        <div class="space-y-3">
          {#each history as entry}
            <div class="border border-gray-700/60 rounded-xl p-4 bg-gray-800/20">
              <div class="flex items-start justify-between gap-4">
                <div class="flex items-center gap-3 min-w-0">
                  <span class="text-lg leading-none shrink-0">
                    {entry.outcome === 'success' ? '✅' : entry.outcome === 'failed' ? '❌' : '⏳'}
                  </span>
                  <p class="text-sm font-medium text-white capitalize">{entry.outcome}</p>
                </div>
                <div class="flex items-center gap-3 shrink-0 text-right">
                  <div class="flex flex-col items-end gap-0.5">
                    <p class="text-xs text-gray-300" title={entry.startedAt || ''}>
                      {fmtDate(entry.startedAt)}
                    </p>
                    {#if entry.startedAt}
                      <p class="text-xs text-gray-500">{fmtRelative(entry.startedAt)}</p>
                    {/if}
                    {#if entry.completedAt}
                      <p class="text-xs text-gray-600">
                        {$_('profile.history.durationTook', {
                          values: { duration: fmtDuration(entry.startedAt, entry.completedAt) },
                        })}
                      </p>
                    {/if}
                  </div>
                  {#if entry.generatedFiles && entry.outcome === 'success'}
                    <button
                      type="button"
                      onclick={() => rollback(entry)}
                      disabled={rollbackBusy === entry.id}
                      class="text-xs px-3 py-1.5 rounded-md font-medium transition
                             {rollbackBusy === entry.id
                               ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                               : 'bg-gray-700 hover:bg-gray-600 text-white border border-gray-600'}"
                    >
                      {rollbackBusy === entry.id ? $_('profile.history.rollingBack') : '⏪ ' + $_('profile.history.rollback')}
                    </button>
                  {/if}
                </div>
              </div>

              {#if entry.logs && entry.logs.length > 0}
                <details class="mt-3">
                  <summary class="text-xs text-gray-500 cursor-pointer hover:text-gray-300 transition">
                    {$_('profile.history.viewLogs', {values: {n: entry.logs.length}})}
                  </summary>
                  <div class="mt-2 bg-gray-950 rounded-lg p-3 font-mono text-xs text-gray-400
                              overflow-y-auto max-h-48 space-y-0.5 border border-gray-800">
                    {#each entry.logs as line}
                      <div class="whitespace-pre-wrap break-all leading-relaxed">{line}</div>
                    {/each}
                  </div>
                </details>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {/if}

    <!-- ── Server tab (DigitalOcean) ─────────────────────────────────────── -->
    {#if activeTab === 'server'}
      <ServerPanel profile={profileName} projectPath={profileData?.projectPath || ''} />
    {/if}

    <!-- ── Terminal tab ─────────────────────────────────────────────────── -->
    {#if activeTab === 'terminal'}
      <div class="h-[520px]">
        <Terminal profile={profileName} />
      </div>
    {/if}

    <!-- ── Git tab ───────────────────────────────────────────────────────── -->
    {#if activeTab === 'git'}
      {#if profileData}
        <GitPanel profile={profileName} />
      {:else}
        <p class="text-sm text-gray-500">{$_('common.loading')}</p>
      {/if}
    {/if}

    <!-- ── Knowledge tab ─────────────────────────────────────────────────── -->
    {#if activeTab === 'knowledge'}
      <KnowledgePanel profile={profileName} />
    {/if}

    <!-- ── Settings tab ──────────────────────────────────────────────────── -->
    {#if activeTab === 'settings'}
      <div class="space-y-8 w-full">

        {#if hasSsh}
          <div class="w-full">
            <h3 class="text-sm font-semibold text-white mb-1">{$_('profile.settings.connectionTitle')}</h3>
            <p class="text-xs text-gray-400 mb-4">{$_('profile.settings.connectionDesc')}</p>
            <div class="w-full space-y-3 rounded-xl border border-gray-800 bg-gray-900/40 p-4">
              <label class="block text-xs text-gray-500">
                {$_('wizard.step4.sshHostLabel')}
                <input bind:value={connSshHost} class="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
              </label>
              <label class="block text-xs text-gray-500">
                {$_('wizard.step4.sshUserLabel')}
                <input bind:value={connSshUser} class="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
              </label>
              <div>
                <span class="block text-xs text-gray-500 mb-1">{$_('wizard.step4.sshKeyLabel')}</span>
                <SshKeyPathInput bind:value={connSshKeyPath} onpathchange={() => { connTestState = 'idle'; }} />
              </div>
              <label class="block text-xs text-gray-500">
                {$_('wizard.step4.remotePathLabel')}
                <input bind:value={connRemotePath} class="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
              </label>
              <div class="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onclick={testConnectionSettings}
                  disabled={!connSshHost.trim() || !connSshKeyPath.trim() || connTestState === 'testing'}
                  class="text-xs px-3 py-1.5 rounded border border-gray-600 text-gray-300 hover:bg-gray-800 disabled:opacity-50"
                >{connTestState === 'testing' ? $_('common.loading') : $_('wizard.step4.testConn')}</button>
                <button
                  type="button"
                  onclick={saveConnection}
                  disabled={connSaving}
                  class="text-xs px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50"
                >{connSaving ? $_('common.loading') : $_('common.save')}</button>
              </div>
              {#if connTestMessage}
                <p class="text-xs {connTestState === 'ok' ? 'text-green-400' : 'text-red-400'}">{connTestMessage}</p>
              {/if}
              {#if connMessage}
                <p class="text-xs {connError ? 'text-red-400' : 'text-green-400'}">{connMessage}</p>
              {/if}
            </div>
          </div>
        {/if}

        <!-- CI/CD Webhook -->
        <div class="w-full">
          <h3 class="text-sm font-semibold text-white mb-1">CI/CD Webhook</h3>
          <p class="text-xs text-gray-400 mb-4">
            Trigger a deployment from GitHub Actions, GitLab CI, or any system that can
            make an HTTP request. Send a <code class="text-gray-300">POST</code> to the
            endpoint below with your token in the <code class="text-gray-300">Authorization</code> header.
          </p>

          <div class="space-y-3">
            <div>
              <p class="text-xs text-gray-500 mb-1">Endpoint</p>
              <div class="flex items-center gap-2">
                <code class="flex-1 text-xs bg-gray-800 border border-gray-700 rounded-lg px-3 py-2
                             text-indigo-300 font-mono truncate">
                  POST {webhookUrl}
                </code>
              </div>
            </div>

            <div>
              <p class="text-xs text-gray-500 mb-1">Token</p>
              {#if profileData?.webhookToken || webhookToken}
                <div class="flex items-center gap-2">
                  <code class="flex-1 text-xs bg-gray-800 border border-gray-700 rounded-lg px-3 py-2
                               text-green-300 font-mono truncate">
                    {webhookToken || profileData.webhookToken}
                  </code>
                  <button
                    onclick={generateWebhookToken}
                    disabled={generatingToken}
                    class="shrink-0 text-xs px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600
                           text-gray-300 transition disabled:opacity-50"
                  >
                    Regenerate
                  </button>
                </div>
                <p class="text-xs text-amber-400 mt-1.5">
                  ⚠ Store this token securely — it is not shown again after regeneration.
                </p>
              {:else}
                <button
                  onclick={generateWebhookToken}
                  disabled={generatingToken}
                  class="text-sm px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500
                         text-white font-medium transition disabled:opacity-50"
                >
                  {generatingToken ? $_('profile.generatingToken') : $_('profile.generateToken')}
                </button>
              {/if}
            </div>

            <div class="bg-gray-800/40 border border-gray-700/60 rounded-xl p-4 mt-2">
              <p class="text-xs text-gray-400 font-medium mb-2">GitHub Actions example</p>
              <pre class="text-xs text-gray-300 font-mono whitespace-pre-wrap leading-relaxed">{@html `- name: Deploy via WDP
  run: |
    curl -X POST \\
      -H "Authorization: Bearer \${{ secrets.WDP_TOKEN }}" \\
      https://your-wdp-host${webhookUrl}`}</pre>
            </div>
          </div>
        </div>

      </div>
    {/if}

  </main>

</div>
