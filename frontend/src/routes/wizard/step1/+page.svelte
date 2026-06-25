<script>
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { wizardStore } from '$lib/wizardStore.js';
  import { stepValid } from '$lib/stepValid.js';
  import { api } from '$lib/api.js';
  import { _ } from 'svelte-i18n';
  import Tooltip from '$lib/components/Tooltip.svelte';
  import DirBrowser from '$lib/components/DirBrowser.svelte';
  import SshKeyPathInput from '$lib/components/SshKeyPathInput.svelte';

  const s1 = get(wizardStore).step1;
  let projectPath  = s1.projectPath;
  let profileMode  = s1.profileMode  || 'new';
  let selectedProfile = s1.selectedProfile || '';
  let newProfileName  = s1.newProfileName  || '';

  let validating   = false;
  let pathValid    = !!s1.detectedName;
  let pathError    = '';
  let projectMeta  = s1.detectedName ? { name: s1.detectedName, version: s1.detectedVersion, nodeVersion: s1.detectedNodeVersion } : null;
  let existingProfiles = [];
  let showBrowser  = false;
  let showImportBrowser = false;

  // ── Wappler import ─────────────────────────────────────────────────────────
  let showImport       = false;
  let importPath       = s1.wapplerImportPath || '';
  let importApplied    = !!s1.wapplerImportApplied;
  let importLoading    = false;
  let importError      = '';
  let importResult     = null;  // { projectName, targets[], doApiKey, doSshKeyId, sshKeyFound }
  let importTarget     = s1.wapplerImportTarget ?? 0;
  let importEdits      = {
    hostingTarget: 'vps',
    sshHost: '',
    sshUser: 'root',
    sshKeyPath: '~/.ssh/id_ed25519',
    profileSlug: '',
  };

  const HOSTING_OPTIONS = [
    { value: 'digitalocean', label: 'DigitalOcean Droplet' },
    { value: 'vps', label: 'Self-hosted VPS' },
  ];

  function syncImportEditsFromTarget() {
    if (!importResult?.targets?.length) return;
    const idx = Math.min(importTarget, importResult.targets.length - 1);
    const t = importResult.targets[idx];
    importEdits = {
      hostingTarget: t.hostingTarget || 'vps',
      sshHost: t.sshHost || '',
      sshUser: t.sshUser || 'root',
      sshKeyPath: t.sshKeyPath || '~/.ssh/id_ed25519',
      profileSlug: t.slug || '',
    };
  }

  function onImportTargetChange() {
    importApplied = false;
    syncImportEditsFromTarget();
  }

  async function loadImportPreview(resetApplied = false) {
    if (!importPath.trim()) return;
    importLoading = true;
    importError   = '';
    if (resetApplied) importApplied = false;
    try {
      importResult = await api.post('/api/config/import-wappler', { filePath: importPath.trim() });
      if (importTarget >= importResult.targets.length) importTarget = 0;
      syncImportEditsFromTarget();
    } catch (err) {
      importResult = null;
      importError  = err.message || 'Failed to parse project.json';
    } finally {
      importLoading = false;
    }
  }

  async function runImport() {
    if (!importPath.trim()) return;
    importResult = null;
    await loadImportPreview(true);
  }

  function onImportFileSelected(filePath) {
    importPath = filePath;
    importApplied = false;
    showImportBrowser = false;
    const normalized = filePath.replace(/\\/g, '/');
    const suffix = '/.wappler/project.json';
    if (normalized.endsWith(suffix)) {
      projectPath = normalized.slice(0, -suffix.length);
      validatePath();
    }
    loadImportPreview(true);
  }

  function applyImport() {
    const slug = importEdits.profileSlug.trim();
    if (!slug) return;
    newProfileName = slug;
    profileMode    = 'new';
    importApplied  = true;
    wizardStore.setStep(1, {
      newProfileName: slug,
      profileMode: 'new',
      wapplerImportPath: importPath.trim(),
      wapplerImportApplied: true,
      wapplerImportTarget: importTarget,
    });
    wizardStore.setProfile(slug);
    wizardStore.setStep(4, {
      hostingTarget: importEdits.hostingTarget,
      sshHost:       importEdits.sshHost.trim(),
      sshUser:       importEdits.sshUser.trim() || 'root',
      sshKeyPath:    importEdits.sshKeyPath.trim(),
      doSshKeyId:    importEdits.hostingTarget === 'digitalocean' ? (importResult.doSshKeyId || '') : '',
      doApiKey:      importEdits.hostingTarget === 'digitalocean' ? (importResult.doApiKey || '') : '',
    });
    showImport = false;
  }

  $: profileValue = profileMode === 'new' ? newProfileName.trim() : selectedProfile;
  $: isValid = pathValid && profileValue.length > 0;
  $: {
    stepValid.set(isValid);
    wizardStore.setStep(1, {
      projectPath,
      profileMode,
      selectedProfile,
      newProfileName,
      wapplerImportPath: importPath.trim(),
      wapplerImportApplied: importApplied,
      wapplerImportTarget: importTarget,
    });
    if (profileValue) wizardStore.setProfile(profileValue);
  }

  onMount(async () => {
    try {
      const config = await api.get('/api/config');
      existingProfiles = Object.keys(config.profiles || {});
      if (existingProfiles.length > 0 && !get(wizardStore).step1.profileMode) {
        profileMode = 'existing';
      }
    } catch { /* no profiles yet */ }
    if (projectPath) await validatePath();
    if (importPath.trim()) await loadImportPreview(false);
  });

  async function validatePath() {
    if (!projectPath.trim()) return;
    validating = true;
    pathError = '';
    pathValid = false;
    projectMeta = null;
    try {
      const result = await api.post('/api/config/validate-path', { projectPath: projectPath.trim() });
      pathValid = result.valid;
      if (result.valid) {
        projectMeta = result;
        wizardStore.setStep(1, {
          detectedName: result.name,
          detectedVersion: result.version,
          detectedNodeVersion: result.nodeVersion
        });
      } else {
        pathError = result.message || 'Invalid path.';
      }
    } catch (err) {
      pathError = err.message || 'Could not validate path.';
    } finally {
      validating = false;
    }
  }
</script>

<h2 class="text-xl font-semibold text-white mb-1">{$_('wizard.step1.title')}</h2>
<p class="text-gray-400 text-sm mb-6">
  {$_('wizard.step1.subtitle')}</p>

<!-- ── Wappler import banner ── -->
<div class="mb-8 rounded-lg border border-indigo-700/40 bg-indigo-950/30">
  <button
    type="button"
    onclick={() => { showImport = !showImport; importError = ''; }}
    class="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-indigo-300 hover:text-indigo-200 transition"
  >
    <span class="flex items-center gap-2 min-w-0">
      {$_('wizard.step1.importTitle')}
      <code class="text-xs bg-indigo-900/50 px-1.5 py-0.5 rounded shrink-0">.wappler/project.json</code>
      {#if importPath.trim()}
        <span class="text-xs text-gray-500 truncate" title={importPath.trim()}>{importPath.trim()}</span>
      {/if}
    </span>
    <span class="text-gray-500 text-xs">{showImport ? $_('wizard.step1.hide') : $_('wizard.step1.expand')}</span>
  </button>

  {#if showImport}
    <div class="px-4 pb-4 space-y-4 border-t border-indigo-700/30 pt-4">
      <!-- svelte-ignore html_unsafe -->
      <p class="text-xs text-gray-400">{@html $_('wizard.step1.importDesc')}</p>
      <!-- svelte-ignore html_unsafe -->
      <p class="text-xs text-amber-400/70">{@html $_('wizard.step1.importTip')}</p>
      <p class="text-xs text-gray-500">
        {$_('wizard.step1.wapplerSignUpLead')}
        <a href="https://wappler.io/pricing/?ref=VCENXZYP" target="_blank" rel="noopener noreferrer"
          class="text-indigo-400 hover:text-indigo-300">{$_('wizard.step1.wapplerSignUp')}</a>.
      </p>

      <div class="flex gap-2">
        <input
          type="text"
          bind:value={importPath}
          placeholder={$_('wizard.step1.importPlaceholder')}
          class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white
                 placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="button"
          onclick={() => showImportBrowser = true}
          class="px-3 py-2 text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg
                 transition shrink-0"
          title={$_('wizard.step1.importBrowseTitle')}
        >📁</button>
        <button
          type="button"
          onclick={runImport}
          disabled={importLoading || !importPath.trim()}
          class="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg
                 transition disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >{importLoading ? $_('wizard.step1.reading') : $_('wizard.step1.import')}</button>
      </div>

      <DirBrowser
        open={showImportBrowser}
        mode="file"
        fileName="project.json"
        heading={$_('wizard.step1.importBrowseHeading')}
        onselect={onImportFileSelected}
        onclose={() => showImportBrowser = false}
      />

      {#if importError}
        <p class="text-sm text-red-400">{importError}</p>
      {/if}

      {#if importResult}
        <div class="space-y-3">
          {#if importResult.projectName}
            <p class="text-xs text-gray-400">Project: <span class="text-white font-medium">{importResult.projectName}</span></p>
          {/if}

          {#if importResult.targets.length > 1}
            <div>
              <label class="block text-xs text-gray-400 mb-1">{$_('wizard.step1.selectTarget')}</label>
              <select
                bind:value={importTarget}
                onchange={onImportTargetChange}
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm
                       focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {#each importResult.targets as t, i}
                  <option value={i}>{t.name} — {t.sshHost}</option>
                {/each}
              </select>
            </div>
          {/if}

          {#if importTarget !== null}
            {@const t = importResult.targets[importTarget]}
            <div class="rounded-lg bg-gray-800/60 border border-gray-700/50 px-4 py-3 space-y-3">
              <div>
                <p class="text-gray-400 uppercase tracking-wider font-medium text-xs mb-1">{$_('wizard.step1.importReviewTitle')}</p>
                <p class="text-xs text-gray-500 leading-relaxed">{$_('wizard.step1.importReviewHint')}</p>
              </div>

              <div class="grid gap-3 sm:grid-cols-2">
                <div class="sm:col-span-2">
                  <label class="block text-xs text-gray-400 mb-1">{$_('wizard.step1.hostingTarget')}</label>
                  <select
                    bind:value={importEdits.hostingTarget}
                    onchange={() => { importApplied = false; }}
                    class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm
                           focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {#each HOSTING_OPTIONS as opt}
                      <option value={opt.value}>{opt.label}</option>
                    {/each}
                  </select>
                </div>

                <div>
                  <label class="block text-xs text-gray-400 mb-1">{$_('wizard.step1.sshHost')}</label>
                  <input
                    type="text"
                    bind:value={importEdits.sshHost}
                    oninput={() => { importApplied = false; }}
                    class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm
                           focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label class="block text-xs text-gray-400 mb-1">{$_('wizard.step1.sshUser')}</label>
                  <input
                    type="text"
                    bind:value={importEdits.sshUser}
                    oninput={() => { importApplied = false; }}
                    placeholder="root"
                    class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm
                           focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div class="sm:col-span-2">
                  <label class="block text-xs text-gray-400 mb-1">{$_('wizard.step1.sshKey')}</label>
                  <SshKeyPathInput
                    bind:value={importEdits.sshKeyPath}
                    inputClass="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    onpathchange={() => { importApplied = false; }}
                  />
                  {#if t.sshKeySource === 'os'}
                    <p class="text-xs text-green-400/80 mt-1">{$_('wizard.step1.sshKeyOsFound')}</p>
                  {:else if !t.sshKeyFound}
                    <p class="text-xs text-amber-400/80 mt-1">{$_('wizard.step1.sshKeyOsHint')}</p>
                  {/if}
                </div>

                <div>
                  <label class="block text-xs text-gray-400 mb-1">{$_('wizard.step1.newProfileName')}</label>
                  <input
                    type="text"
                    bind:value={importEdits.profileSlug}
                    oninput={() => { importApplied = false; }}
                    class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm
                           focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label class="block text-xs text-gray-400 mb-1">{$_('wizard.step1.appPort')}</label>
                  <p class="text-sm text-gray-300 py-2">{t.appPort}</p>
                </div>
              </div>
            </div>

            <p class="text-xs text-amber-400/80">{$_('wizard.step1.addonsWarning')}</p>
            {#if importApplied}
              <p class="text-xs text-green-400/90 bg-green-950/30 border border-green-800/40 rounded-lg px-3 py-2">
                {$_('wizard.step1.importApplied')}
              </p>
            {:else}
              <button
                type="button"
                onclick={applyImport}
                disabled={!importEdits.profileSlug.trim() || !importEdits.sshHost.trim()}
                class="w-full py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition font-medium
                       disabled:opacity-40 disabled:cursor-not-allowed"
              >{$_('wizard.step1.applyContinue')}</button>
            {/if}
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<div class="space-y-8">

  <!-- Project path -->
  <div>
    <label class="flex items-center text-sm font-medium text-gray-300 mb-1.5">
      {$_('wizard.step1.projectPath')}
      <Tooltip
        title={$_('wizard.step1.tooltip.projectPath.title')}
        body={$_('wizard.step1.tooltip.projectPath.body')}
        defaultHint={$_('wizard.step1.tooltip.projectPath.defaultHint')}
        gotcha={$_('wizard.step1.tooltip.projectPath.gotcha')}
      />
    </label>
    <div class="flex gap-2">
      <input
        type="text"
        bind:value={projectPath}
        onblur={validatePath}
        placeholder="/path/to/your/project"
        class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3.5 py-2.5 text-white
               placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500
               focus:border-transparent transition"
      />
      <button
        type="button"
        onclick={() => showBrowser = true}
        class="px-3.5 py-2.5 text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg
               transition shrink-0" title="Browse filesystem"
      >📁</button>
      <button
        type="button"
        onclick={validatePath}
        disabled={validating || !projectPath.trim()}
        class="px-4 py-2.5 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded-lg
               transition disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
      >
        {validating ? $_('wizard.step1.validating') : $_('wizard.step1.validate')}
      </button>
    </div>

    <DirBrowser
      open={showBrowser}
      onselect={(dir) => { projectPath = dir; showBrowser = false; validatePath(); }}
      onclose={() => showBrowser = false}
    />

    {#if pathError}
      <p class="mt-2 text-sm text-red-400">{pathError}</p>
    {/if}

    {#if pathValid && projectMeta}
      <div class="mt-3 bg-gray-800/50 border border-gray-700/60 rounded-lg px-4 py-3 text-sm space-y-1">
        <p class="text-green-400 font-medium text-xs uppercase tracking-wider mb-2">{$_('wizard.step1.detected')}</p>
        {#if projectMeta.name}
          <p class="text-gray-300"><span class="text-gray-500">{$_('wizard.step1.name')}:</span>{projectMeta.name}</p>
        {/if}
        {#if projectMeta.version}
          <p class="text-gray-300"><span class="text-gray-500">{$_('wizard.step1.version')}:</span>{projectMeta.version}</p>
        {/if}
        {#if projectMeta.nodeVersion}
          <p class="text-gray-300"><span class="text-gray-500">{$_('wizard.step1.nodeVersion')}:</span>{projectMeta.nodeVersion}</p>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Profile selection -->
  <div>
    <label class="flex items-center text-sm font-medium text-gray-300 mb-3">
      {$_('wizard.step1.profileMode')}
      <Tooltip
        title={$_('wizard.step1.tooltip.profileMode.title')}
        body={$_('wizard.step1.tooltip.profileMode.body')}
        defaultHint={$_('wizard.step1.tooltip.profileMode.defaultHint')}
        gotcha={$_('wizard.step1.tooltip.profileMode.gotcha')}
      />
    </label>

    {#if existingProfiles.length > 0}
      <div class="flex gap-2 mb-4">
        <button
          type="button"
          onclick={() => { profileMode = 'existing'; }}
          class="px-4 py-2 text-sm rounded-lg border transition
            {profileMode === 'existing'
              ? 'bg-indigo-600 border-indigo-600 text-white'
              : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'}"
        >
          {$_('wizard.step1.existingProfile')}
        </button>
        <button
          type="button"
          onclick={() => { profileMode = 'new'; }}
          class="px-4 py-2 text-sm rounded-lg border transition
            {profileMode === 'new'
              ? 'bg-indigo-600 border-indigo-600 text-white'
              : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'}"
        >
          {$_('wizard.step1.createNew')}
        </button>
      </div>
    {/if}

    {#if profileMode === 'existing' && existingProfiles.length > 0}
      <select
        bind:value={selectedProfile}
        class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3.5 py-2.5 text-white
               text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        <option value="" disabled>{$_('wizard.step1.selectProfile')}…</option>
        {#each existingProfiles as p}
          <option value={p}>{p}</option>
        {/each}
      </select>
    {:else}
      <input
        type="text"
        bind:value={newProfileName}
        placeholder={$_('wizard.step1.newProfilePlaceholder')}
        class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3.5 py-2.5 text-white
               placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500
               focus:border-transparent transition"
      />
      <p class="mt-1.5 text-xs text-gray-500">{$_('wizard.step1.profileHint')}</p>
    {/if}
  </div>

</div>
