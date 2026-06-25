<script>
  import { get } from 'svelte/store';
  import { onMount } from 'svelte';
  import { wizardStore } from '$lib/wizardStore.js';
  import { stepValid } from '$lib/stepValid.js';
  import { api } from '$lib/api.js';
  import { _ } from 'svelte-i18n';
  import { goto } from '$app/navigation';
  import GitPanel from '$lib/components/GitPanel.svelte';
  import StaleGenerateBanner from '$lib/components/StaleGenerateBanner.svelte';

  const wz = get(wizardStore);
  const s1 = wz.step1;
  const s2 = wz.step2;
  const s3 = wz.step3;
  const s4 = wz.step4;
  const s5 = wz.step5;
  const s6 = wz.step6;
  const s7 = wz.step7;

  const OS_LABELS = {
    'ubuntu-24.04': 'Ubuntu 24.04 LTS',
    'ubuntu-22.04': 'Ubuntu 22.04 LTS',
    'debian-12':    'Debian 12',
    'alpine':       'Alpine Linux'
  };

  const DB_TYPE_LABELS = {
    postgres: 'PostgreSQL',
    mysql:    'MySQL / MariaDB',
    sqlite:   'SQLite'
  };

  const DB_LOC_LABELS = {
    managed:     'Managed (containerised, same Compose file)',
    external:    'External / cloud-managed',
    selfhosted:  'Self-hosted (separate server)'
  };

  const TARGET_LABELS = {
    digitalocean: 'DigitalOcean Droplet',
    railway:      'Railway',
    vps:          'Self-hosted VPS',
    local:        'Local Docker'
  };

  function enabledAddons(addons) {
    return Object.entries(addons || {}).filter(([, v]) => v.enabled).map(([k]) => k);
  }

  const activeAddons = enabledAddons(s5.addons);

  const ADDON_LABELS = {
    traefik:   'Traefik',
    redis:     'Redis',
    minio:     'MinIO',
    portainer: 'Portainer CE',
    kuma:      'Uptime Kuma',
    plausible: 'Plausible CE (self-hosted)',
    mailpit:   'Mailpit',
    n8n:       'n8n',
    restic:    'Restic + REST backend',
    apprise:   'Apprise / Webhook'
  };

  const SCANNER_LABELS = {
    npmAudit:    'npm audit',
    osvScanner:  'OSV-Scanner',
    socketCli:   'Socket CLI',
    gitleaks:    'Gitleaks',
    trivy:       'Trivy',
    grype:       'Grype + Syft',
    dockerScout: 'Docker Scout'
  };

  function enabledScanners(s) {
    return Object.entries(SCANNER_LABELS)
      .filter(([k]) => s[k])
      .map(([, v]) => v);
  }

  // ── File preview state ────────────────────────────────────────────────────
  const FILE_TABS = ['Dockerfile.deploy', 'docker-compose.deploy.yml', '.env.deploy'];
  let activeTab      = FILE_TABS[0];
  let generating     = false;
  let generateError  = '';
  let generatedFiles = null;   // { 'Dockerfile.deploy': string, ... }
  let generatedAt    = null;   // ISO string
  let copiedTab      = '';     // which tab's copy button was just clicked
  let staleInfo      = { stale: false, reasons: [] };

  // Step 8 is always valid
  stepValid.set(true);
  wizardStore.setStep(8, {});

  function jumpTo(step) {
    goto(`/wizard/step${step}`);
  }

  async function loadStaleState() {
    if (!wz.activeProfile) return;
    try {
      staleInfo = await api.get(`/api/config/profiles/${encodeURIComponent(wz.activeProfile)}/stale`);
    } catch {
      staleInfo = { stale: false, reasons: [] };
    }
  }

  onMount(async () => {
    await loadStaleState();
    if (wz.activeProfile) {
      try {
        const res = await api.get(`/api/generate/${encodeURIComponent(wz.activeProfile)}`);
        if (res.files) {
          const contents = {};
          let latestMtime = null;
          for (const [name, data] of Object.entries(res.files)) {
            contents[name] = data.content;
            if (!latestMtime || data.mtime > latestMtime) latestMtime = data.mtime;
          }
          generatedFiles = contents;
          generatedAt    = latestMtime;
        }
      } catch {
        // Files don't exist yet
      }
    }
  });

  async function generate() {
    generating    = true;
    generateError = '';
    try {
      const snapshot = get(wizardStore);
      const res = await api.post('/api/generate', { config: snapshot });
      generatedFiles = res.files;
      generatedAt    = res.generatedAt;
      await loadStaleState();
    } catch (err) {
      generateError = err.message || 'Generation failed.';
    } finally {
      generating = false;
    }
  }

  async function copyToClipboard(content) {
    try {
      await navigator.clipboard.writeText(content);
      copiedTab = activeTab;
      setTimeout(() => { copiedTab = ''; }, 2000);
    } catch { /* clipboard not available */ }
  }

  function downloadFile(name, content) {
    const blob = new Blob([content], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadAll() {
    if (!generatedFiles) return;
    for (const [name, content] of Object.entries(generatedFiles)) {
      downloadFile(name, content);
    }
  }

  function timeAgo(isoString) {
    if (!isoString) return '';
    const diff = Math.round((Date.now() - new Date(isoString).getTime()) / 1000);
    if (diff < 60)   return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function highlight(code) {
    return code.split('\n').map((line, i) => {
      const num = `<span class="line-num">${String(i + 1).padStart(3, ' ')}</span>  `;
      const escaped = escapeHtml(line);
      const coloured = escaped
        .replace(/(#[^\n]*)/g, '<span class="hl-comment">$1</span>')
        .replace(/(\$\{[^}]+\})/g, '<span class="hl-var">$1</span>');
      return num + coloured;
    }).join('\n');
  }
</script>

<style>
  .hl-comment { color: #6b7280; font-style: italic; }
  .hl-var     { color: #fbbf24; }
  .line-num   { color: #374151; user-select: none; }
  .code-block {
    font-family: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
    font-size: 0.72rem;
    line-height: 1.6;
    white-space: pre;
    overflow-x: auto;
  }
</style>

<h2 class="text-xl font-semibold text-white mb-1">{$_('wizard.step8.title')}</h2>
<p class="text-gray-400 text-sm mb-4">
  {$_('wizard.step8.subtitle')}
</p>

<StaleGenerateBanner {staleInfo} profileName={wz.activeProfile} atGenerateStep />

<div class="space-y-4 mb-8">

  <!-- Step 1 -->
  <div class="border border-gray-700 rounded-xl overflow-hidden">
    <button type="button" onclick={() => jumpTo(1)}
      class="w-full flex items-center justify-between px-4 py-3 text-left
             hover:bg-gray-800/50 transition-colors">
      <span class="text-sm font-semibold text-indigo-400">{$_('wizard.step8.s1Title')}</span>
      <span class="text-xs text-gray-500">{$_('wizard.step8.editLink')}</span>
    </button>
    <dl class="px-4 pb-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm border-t border-gray-700/40">
      <dt class="text-gray-500 mt-2">{$_('wizard.step8.profileLabel')}</dt>
      <dd class="text-white mt-2 truncate">{wz.activeProfile || '—'}</dd>
      <dt class="text-gray-500">{$_('wizard.step8.projectPathLabel')}</dt>
      <dd class="text-white truncate">{s1.projectPath || '—'}</dd>
      <dt class="text-gray-500">{$_('wizard.step8.modeLabel')}</dt>
      <dd class="text-white">{s1.profileMode === 'new' ? $_('wizard.step8.newProfile') : $_('wizard.step8.existingProfile')}</dd>
    </dl>
  </div>

  <!-- Step 2 -->
  <div class="border border-gray-700 rounded-xl overflow-hidden">
    <button type="button" onclick={() => jumpTo(2)}
      class="w-full flex items-center justify-between px-4 py-3 text-left
             hover:bg-gray-800/50 transition-colors">
      <span class="text-sm font-semibold text-indigo-400">{$_('wizard.step8.s2Title')}</span>
      <span class="text-xs text-gray-500">{$_('wizard.step8.editLink')}</span>
    </button>
    <dl class="px-4 pb-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm border-t border-gray-700/40">
      <dt class="text-gray-500 mt-2 col-span-2">{$_('wizard.step8.containerNoteLabel')}</dt>
      <dd class="text-gray-400 col-span-2 text-xs leading-relaxed">{$_('wizard.step2.containerNote')}</dd>
    </dl>
  </div>

  <!-- Step 3 -->
  <div class="border border-gray-700 rounded-xl overflow-hidden">
    <button type="button" onclick={() => jumpTo(3)}
      class="w-full flex items-center justify-between px-4 py-3 text-left
             hover:bg-gray-800/50 transition-colors">
      <span class="text-sm font-semibold text-indigo-400">{$_('wizard.step8.s3Title')}</span>
      <span class="text-xs text-gray-500">{$_('wizard.step8.editLink')}</span>
    </button>
    <dl class="px-4 pb-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm border-t border-gray-700/40">
      {#if s3.skipDb}
        <dt class="text-gray-500 mt-2 col-span-2 italic">{$_('wizard.step8.noDb')}</dt>
      {:else}
        <dt class="text-gray-500 mt-2">{$_('wizard.step8.typeLabel')}</dt>
        <dd class="text-white mt-2">{DB_TYPE_LABELS[s3.dbType] || s3.dbType}</dd>
        <dt class="text-gray-500">{$_('wizard.step8.locationLabel')}</dt>
        <dd class="text-white">{$_('wizard.step3.loc.' + s3.dbLocation) || s3.dbLocation}</dd>
        {#if s3.dbHost}
          <dt class="text-gray-500">{$_('wizard.step8.hostLabel')}</dt>
          <dd class="text-white truncate">{s3.dbHost}:{s3.dbPort}</dd>
        {/if}
        {#if s3.dbName}
          <dt class="text-gray-500">{$_('wizard.step8.databaseLabel')}</dt>
          <dd class="text-white">{s3.dbName}</dd>
        {/if}
        {#if s3.sslMode && s3.sslMode !== 'disable'}
          <dt class="text-gray-500">{$_('wizard.step8.sslModeLabel')}</dt>
          <dd class="text-white">{s3.sslMode}</dd>
        {/if}
      {/if}
    </dl>
  </div>

  <!-- Step 4 -->
  <div class="border border-gray-700 rounded-xl overflow-hidden">
    <button type="button" onclick={() => jumpTo(4)}
      class="w-full flex items-center justify-between px-4 py-3 text-left
             hover:bg-gray-800/50 transition-colors">
      <span class="text-sm font-semibold text-indigo-400">{$_('wizard.step8.s4Title')}</span>
      <span class="text-xs text-gray-500">{$_('wizard.step8.editLink')}</span>
    </button>
    <dl class="px-4 pb-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm border-t border-gray-700/40">
      <dt class="text-gray-500 mt-2">{$_('wizard.step8.targetLabel')}</dt>
      <dd class="text-white mt-2">{TARGET_LABELS[s4.hostingTarget] || s4.hostingTarget || '—'}</dd>
      {#if s4.hostingTarget === 'digitalocean'}
        <dt class="text-gray-500">{$_('wizard.step8.hostOsLabel')}</dt>
        <dd class="text-white">
          {#if s4.doMode === 'provision'}
            {OS_LABELS[s2.targetOS] || s2.targetOS || '—'}
          {:else if s4.hostOsLabel}
            {s4.hostOsLabel}
          {:else}
            —
          {/if}
        </dd>
      {/if}
      <dt class="text-gray-500">{$_('wizard.step8.archLabel')}</dt>
      <dd class="text-white">{s2.architecture || '—'}</dd>
      {#if s4.sshHost}
        <dt class="text-gray-500">{$_('wizard.step8.sshHostLabel')}</dt>
        <dd class="text-white truncate">{s4.sshUser}@{s4.sshHost}</dd>
        <dt class="text-gray-500">{$_('wizard.step8.keyPathLabel')}</dt>
        <dd class="text-white truncate">{s4.sshKeyPath}</dd>
      {/if}
    </dl>
  </div>

  <!-- Step 5 -->
  <div class="border border-gray-700 rounded-xl overflow-hidden">
    <button type="button" onclick={() => jumpTo(5)}
      class="w-full flex items-center justify-between px-4 py-3 text-left
             hover:bg-gray-800/50 transition-colors">
      <span class="text-sm font-semibold text-indigo-400">{$_('wizard.step8.s5Title')}</span>
      <span class="text-xs text-gray-500">{$_('wizard.step8.editLink')}</span>
    </button>
    <div class="px-4 pb-4 border-t border-gray-700/40 pt-3">
      {#if activeAddons.length === 0}
        <p class="text-sm text-gray-500 italic">{$_('wizard.step8.noAddons')}</p>
      {:else}
        <div class="flex flex-wrap gap-2">
          {#each activeAddons as key}
            <span class="text-xs bg-indigo-900/50 text-indigo-300 px-2.5 py-1 rounded-full">
              {ADDON_LABELS[key] || key}
            </span>
          {/each}
        </div>
      {/if}
    </div>
  </div>
  <!-- Step 6 -->
  <div class="border border-gray-700 rounded-xl overflow-hidden">
    <button type="button" onclick={() => jumpTo(6)}
      class="w-full flex items-center justify-between px-4 py-3 text-left
             hover:bg-gray-800/50 transition-colors">
      <span class="text-sm font-semibold text-indigo-400">{$_('wizard.step8.s6Title')}</span>
      <span class="text-xs text-gray-500">{$_('wizard.step8.editLink')}</span>
    </button>
    <dl class="px-4 pb-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm border-t border-gray-700/40">
      <dt class="text-gray-500 mt-2">{$_('wizard.step8.replicasLabel')}</dt>
      <dd class="text-white mt-2">{s6.scaleHorizontal ? s6.replicas : 1}</dd>
      <dt class="text-gray-500">{$_('wizard.step8.memLimitLabel')}</dt>
      <dd class="text-white">{s6.memLimit || $_('common.none')}</dd>
      <dt class="text-gray-500">{$_('wizard.step8.cpuLimitLabel')}</dt>
      <dd class="text-white">{s6.cpuLimit || $_('common.none')}</dd>
      <dt class="text-gray-500">{$_('wizard.step8.healthcheckLabel')}</dt>
      <dd class="text-white">{s6.healthcheck ? $_('common.enabled') : $_('common.disabled')}</dd>
    </dl>
  </div>

  <!-- Step 7 -->
  <div class="border border-gray-700 rounded-xl overflow-hidden">
    <button type="button" onclick={() => jumpTo(7)}
      class="w-full flex items-center justify-between px-4 py-3 text-left
             hover:bg-gray-800/50 transition-colors">
      <span class="text-sm font-semibold text-indigo-400">{$_('wizard.step8.s7Title')}</span>
      <span class="text-xs text-gray-500">{$_('wizard.step8.editLink')}</span>
    </button>
    <div class="px-4 pb-4 border-t border-gray-700/40 pt-3">
      <div class="flex flex-wrap gap-2 mb-2">
        {#each enabledScanners(s7) as label}
          <span class="text-xs bg-green-900/40 text-green-300 px-2.5 py-1 rounded-full">{label}</span>
        {/each}
      </div>
      <p class="text-xs text-gray-500">
        {$_('wizard.step8.blockOnCritical')} <span class="text-gray-300">{s7.blockOnCritical ? $_('common.yes') : $_('common.no')}</span>
      </p>
    </div>
  </div>

</div>

<!-- ── Git panel ─────────────────────────────────────────────────────────── -->
{#if wz.activeProfile}
  <div class="mt-6 border border-gray-700 rounded-xl overflow-hidden">
    <details>
      <summary class="flex items-center justify-between px-5 py-3 bg-gray-800/60
                       cursor-pointer hover:bg-gray-800/80 transition list-none">
        <p class="text-sm font-semibold text-white flex items-center gap-2">
          🌿 {$_('wizard.step8.gitLabel')}
        </p>
        <span class="text-xs text-gray-500">{$_('wizard.step8.gitSection')}</span>
      </summary>
      <div class="px-5 py-4 border-t border-gray-700/40">
        <GitPanel profile={wz.activeProfile} />
      </div>
    </details>
  </div>
{/if}

<!-- ── File Generation Panel ────────────────────────────────────────────── -->
<div id="wdp-step8-generate" class="mt-8 border border-gray-700 rounded-xl overflow-hidden scroll-mt-24">

  <!-- Panel header -->
  <div class="flex items-center justify-between px-5 py-3 bg-gray-800/60 border-b border-gray-700">
    <div>
      <p class="text-sm font-semibold text-white">{$_('wizard.step8.generatedTitle')}</p>
      {#if generatedAt}
        <p class="text-xs text-gray-500 mt-0.5">
          {$_('wizard.step8.lastGenerated', { values: { ago: timeAgo(generatedAt), profile: wz.activeProfile } })}
        </p>
      {:else}
        <p class="text-xs text-gray-500 mt-0.5">{$_('wizard.step8.notGeneratedProfile')}</p>
      {/if}
    </div>
    <div class="flex items-center gap-2">
      {#if generatedFiles}
        <button type="button" onclick={downloadAll}
          class="text-xs px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600
                 text-gray-300 hover:text-white transition-colors">
          {$_('wizard.step8.downloadAll')}
        </button>
      {/if}
      <button type="button" onclick={generate} disabled={generating}
        class="text-xs px-4 py-1.5 rounded-lg font-semibold transition-colors
               {generating
                 ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                 : generatedFiles
                   ? 'bg-amber-600 hover:bg-amber-500 text-white'
                   : 'bg-indigo-600 hover:bg-indigo-500 text-white'}">
        {generating ? $_('wizard.step8.generating') : generatedFiles ? $_('wizard.step8.regenerate') : $_('wizard.step8.generate')}
      </button>
    </div>
  </div>

  {#if generateError}
    <div class="px-5 py-3 bg-red-900/30 border-b border-red-700/40 text-sm text-red-300">
      {generateError}
    </div>
  {/if}

  {#if generatedFiles}
    <!-- File tabs -->
    <div class="flex border-b border-gray-700 bg-gray-900/40">
      {#each FILE_TABS as tab}
        <button type="button" onclick={() => activeTab = tab}
          class="px-4 py-2.5 text-xs font-mono transition-colors border-b-2
                 {activeTab === tab
                   ? 'border-indigo-500 text-indigo-300 bg-gray-800/60'
                   : 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-gray-800/30'}">
          {tab}
        </button>
      {/each}
    </div>

    <!-- File action bar -->
    <div class="flex items-center justify-between px-4 py-2 bg-gray-900/30 border-b border-gray-700/40">
      <span class="text-xs text-gray-600 font-mono">
        wdp/{wz.activeProfile}/{activeTab}
      </span>
      <div class="flex gap-2">
        <button type="button"
          onclick={() => downloadFile(activeTab, generatedFiles[activeTab])}
          class="text-xs px-2.5 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white transition-colors">
          {$_('wizard.step8.download')}
        </button>
        <button type="button"
          onclick={() => copyToClipboard(generatedFiles[activeTab])}
          class="text-xs px-2.5 py-1 rounded transition-colors
                 {copiedTab === activeTab
                   ? 'bg-green-700 text-green-200'
                   : 'bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white'}">
          {copiedTab === activeTab ? $_('common.copied') : $_('common.copy')}
        </button>
      </div>
    </div>

    <!-- Code view -->
    <div class="bg-gray-950 overflow-auto" style="max-height: 480px;">
      {#if generatedFiles[activeTab]}
        <pre class="code-block px-4 py-4 text-gray-300">{@html highlight(generatedFiles[activeTab])}</pre>
      {:else}
        <p class="px-5 py-6 text-sm text-gray-600 italic">{$_('wizard.step8.fileNotFound')}</p>
      {/if}
    </div>

    <!-- .env.deploy security notice -->
    {#if activeTab === '.env.deploy'}
      <div class="px-5 py-3 bg-amber-900/20 border-t border-amber-700/30 text-xs text-amber-400 flex items-start gap-2">
        <span class="mt-0.5 shrink-0">⚠</span>
        <span>{$_('wizard.step8.envNotice')}</span>
      </div>
    {/if}

  {:else if !generating}
    <!-- Empty state -->
    <div class="px-5 py-10 text-center">
      <p class="text-sm text-gray-500">{$_('wizard.step8.emptyStateBody')}</p>
    </div>
  {:else}
    <div class="px-5 py-10 text-center">
      <div class="inline-block w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3"></div>
      <p class="text-sm text-gray-500">{$_('wizard.step8.generatingMsg')}</p>
    </div>
  {/if}

</div>
