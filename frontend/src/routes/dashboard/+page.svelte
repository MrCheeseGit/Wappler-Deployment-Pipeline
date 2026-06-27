<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { authStatus } from '$lib/stores.js';
  import { wizardStore } from '$lib/wizardStore.js';
  import { mergeProfileIntoWizard } from '$lib/profileWizardSync.js';
  import { hardNavigate, profilePath } from '$lib/navigate.js';
  import LanguageSelector from '$lib/components/LanguageSelector.svelte';
  import AboutModal from '$lib/components/AboutModal.svelte';
  import WdpUpdateBanner from '$lib/components/WdpUpdateBanner.svelte';
  import DeployActivityHeatmap from '$lib/components/DeployActivityHeatmap.svelte';
  import { get } from 'svelte/store';
  import { _, locale } from 'svelte-i18n';



  let aboutOpen = false;
  let warningDismissed = typeof localStorage !== 'undefined' && localStorage.getItem('wdp_security_warning_dismissed') === '1';
  let coffeeDismissed  = typeof localStorage !== 'undefined' && localStorage.getItem('wdp_coffee_dismissed') === '1';
  $: isPublicBinding = $authStatus?.isPublicBinding ?? false;

  let profiles        = [];
  let profileData     = {};   // { [name]: full profile config incl. wizardConfig }
  let deploySummary   = {};   // { [name]: { hostingTarget, domain, lastDeploy, ... } }
  let loadingProfiles = true;
  let renamingProfile = '';   // profile name being renamed
  let renameValue     = '';
  let renameError     = '';
  let renameBusy      = false;
  let duplicateBusy   = '';

  let profileSearch   = '';
  let profilePageSize = '5';

  onMount(reloadProfiles);

  function profileHaystack(name) {
    const summary = deploySummary[name] || {};
    const p = profileData[name] || {};
    const target = summary.hostingTarget || p.hostingTarget || '';
    return [
      name,
      summary.detectedName,
      summary.domain,
      p.detectedName,
      p.domain,
      target,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  }

  $: sortedProfiles = [...profiles].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  $: filteredProfiles = sortedProfiles.filter((name) => {
    const q = profileSearch.trim().toLowerCase();
    if (!q) return true;
    return profileHaystack(name).includes(q);
  });
  $: visibleProfiles = profilePageSize === 'all'
    ? filteredProfiles
    : filteredProfiles.slice(0, Number(profilePageSize) || 5);
  $: totalFiltered = filteredProfiles.length;

  async function handleLogout() {
    try {
      await api.post('/api/auth/logout');
      authStatus.set(null);
      await goto('/login');
    } catch (err) {
      console.error('Logout failed:', err);
    }
  }

  function startNewDeployment() {
    wizardStore.reset();
    hardNavigate('/wizard/step1');
  }

  function prepareEditWizard(name) {
    const saved = profileData[name];
    if (saved?.wizardConfig) {
      wizardStore.set(mergeProfileIntoWizard(saved, name) || { ...saved.wizardConfig, activeProfile: name });
    } else {
      wizardStore.reset();
      wizardStore.setProfile(name);
      wizardStore.setStep(1, { profileMode: 'existing', selectedProfile: name });
    }
  }

  function openManage(name) {
    hardNavigate(profilePath(name));
  }

  function openEditWizard(name) {
    prepareEditWizard(name);
    hardNavigate('/wizard/step1');
  }

  const actionBtn =
    'text-sm px-2 py-1.5 -my-1 rounded-md transition cursor-pointer bg-transparent border-0';

  async function duplicateProfile(name) {
    const newName = prompt(`Duplicate "${name}" — enter a name for the copy:`);
    if (!newName || !newName.trim()) return;
    duplicateBusy = name;
    try {
      await api.post(`/api/profiles/${encodeURIComponent(name)}/duplicate`, { newName: newName.trim() });
      await reloadProfiles();
    } catch (err) {
      alert(`Duplicate failed: ${err.message}`);
    } finally {
      duplicateBusy = '';
    }
  }

  function startRename(name) {
    renamingProfile = name;
    renameValue     = name;
    renameError     = '';
  }

  async function confirmRename() {
    const newName = renameValue.trim();
    if (!newName || newName === renamingProfile) {
      renamingProfile = '';
      return;
    }
    const confirmMsg = get(_)('dashboard.renameConfirm', {
      values: { from: renamingProfile, to: newName },
    });
    if (!confirm(confirmMsg)) return;

    renameBusy  = true;
    renameError = '';
    try {
      const fromName = renamingProfile;
      await api.post(`/api/profiles/${encodeURIComponent(fromName)}/rename`, { newName });
      wizardStore.syncProfileRename(fromName, newName);
      await reloadProfiles();
      renamingProfile = '';
      alert(get(_)('dashboard.renameDoneHint'));
    } catch (err) {
      renameError = err.message;
    } finally {
      renameBusy = false;
    }
  }

  async function reloadProfiles() {
    try {
      const [config, summaryRes] = await Promise.all([
        api.get('/api/config'),
        api.get('/api/deploy/summary').catch(() => ({ summary: {} })),
      ]);
      profileData    = config.profiles || {};
      profiles       = Object.keys(profileData);
      deploySummary  = summaryRes.summary || {};
    } catch { /* ignore */ } finally {
      loadingProfiles = false;
    }
  }

  function targetBadge(target) {
    if (target === 'digitalocean') return { icon: '🌊', labelKey: 'dashboard.targetDo' };
    if (target === 'vps')          return { icon: '🖥️', labelKey: 'dashboard.targetVps' };
    if (target === 'local')        return { icon: '🐳', labelKey: 'dashboard.targetLocal' };
    if (target === 'railway')      return { icon: '🚂', labelKey: 'dashboard.targetRailway' };
    return { icon: '📋', rawLabel: target || '—' };
  }

  function fmtDeployWhen(iso, loc) {
    if (!iso) return '';
    const tag = loc && loc !== 'en' ? loc : undefined;
    return new Date(iso).toLocaleString(tag, {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function deployStatusClass(name) {
    const outcome = deploySummary[name]?.lastDeploy?.outcome;
    if (outcome === 'success') return 'text-green-400';
    if (outcome === 'failed')  return 'text-red-400';
    if (outcome === 'running') return 'text-amber-400';
    return 'text-gray-500';
  }

  // ── Import profile ──────────────────────────────────────────────────────────
  let importBusy        = false;
  let importError       = '';
  let importSuccess     = '';
  let importConflict    = false;   // true when server returns 409
  let importSuggestedName = '';    // server-suggested alternative name
  let importTargetName  = '';      // user's chosen name when resolving conflict
  let importFileInput;             // bound to the hidden <input type="file">

  function triggerImport() {
    importError       = '';
    importSuccess     = '';
    importConflict    = false;
    importTargetName  = '';
    importFilePending = null;
    importFileInput.click();
  }

  async function uploadImport(file, targetName) {
    importBusy    = true;
    importError   = '';
    importSuccess = '';
    try {
      const form = new FormData();
      form.append('file', file);
      if (targetName) form.append('targetName', targetName);

      const res = await fetch('/api/profiles/import', { method: 'POST', body: form });
      const body = await res.json();

      if (res.status === 409 && body.conflict) {
        importConflict      = true;
        importSuggestedName = body.suggestedName || '';
        importTargetName    = body.suggestedName || '';
        importBusy          = false;
        return;
      }
      if (!res.ok) {
        importError = body.error || $_('dashboard.importError');
        return;
      }

      importConflict = false;
      importSuccess  = $_('dashboard.importSuccess', { values: { name: body.profile } });
      if (!body.projectPathExists) {
        importSuccess += ' ' + $_('dashboard.importPathWarning');
      }
      await reloadProfiles();
    } catch (err) {
      importError = err.message || $_('dashboard.importError');
    } finally {
      importBusy = false;
    }
  }

  // Called when user confirms a conflict rename
  let importFilePending = null;
  async function confirmImportConflict() {
    if (!importTargetName.trim() || !importFilePending) return;
    await uploadImport(importFilePending, importTargetName.trim());
    importFilePending = null;
  }

  // We need to keep the file around for the conflict re-submit
  async function handleImportFileWithConflict(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    importFilePending = file;
    await uploadImport(file, '');
  }
</script>

<div class="min-h-screen bg-gray-950 flex flex-col">

  {#if isPublicBinding && !warningDismissed}
    <div class="bg-amber-900/40 border-b border-amber-700/50 px-4 py-3">
      <div class="max-w-5xl mx-auto flex items-start gap-3">
        <span class="text-amber-400 mt-0.5 shrink-0">⚠</span>
        <p class="text-amber-200 text-sm flex-1">
          <strong>Security warning:</strong> This tool is bound to
          <code class="bg-amber-900/50 px-1 rounded text-xs">0.0.0.0</code> and may be publicly
          reachable. Ensure port 8900 is firewalled or place this tool behind a reverse proxy with
          access controls.
        </p>
        <button
          onclick={() => { warningDismissed = true; localStorage.setItem('wdp_security_warning_dismissed', '1'); }}
          class="text-amber-400 hover:text-amber-200 shrink-0 ml-2 text-lg leading-none"
          aria-label="Dismiss warning"
        >×</button>
      </div>
    </div>
  {/if}

  <header class="border-b border-gray-800 px-4 py-4">
    <div class="max-w-5xl mx-auto flex items-center justify-between">
      <h1 class="text-white font-semibold tracking-tight">Wappler Deployment Pipeline</h1>
      <div class="flex items-center gap-3">
        <LanguageSelector />
        <button
          type="button"
          onclick={() => aboutOpen = true}
          class="text-gray-400 hover:text-white text-sm transition"
        >{$_('nav.about')}</button>
        <a href="/help" class="text-gray-400 hover:text-white text-sm transition">{$_('nav.help')}</a>
        <a href="/profile" class="text-gray-400 hover:text-white text-sm transition">{$_('nav.userProfile')}</a>
        <a href="/settings" class="text-gray-400 hover:text-white text-sm transition">{$_('settings.title')}</a>
        <button
          onclick={handleLogout}
          class="text-gray-400 hover:text-white text-sm transition"
        >
          {$_('nav.signOut')}
        </button>
      </div>
    </div>
  </header>

  <AboutModal bind:open={aboutOpen} />

  <!-- Hidden file input for profile import -->
  <input
    type="file"
    accept=".zip"
    bind:this={importFileInput}
    onchange={handleImportFileWithConflict}
    class="hidden"
  />

  <!-- Extra bottom padding: fixed app footer -->
  <main class="flex-1 max-w-5xl mx-auto w-full px-4 py-10 pb-16">

    <div class="mb-4">
      <WdpUpdateBanner variant="compact" />
    </div>

    <!-- Header row -->
    <div class="flex items-center justify-between mb-4">
      <div>
        <h2 class="text-xl font-semibold text-white">{$_('dashboard.title')}</h2>
        <p class="text-gray-400 text-sm mt-0.5">
          {$_('dashboard.subtitle')}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button
          onclick={triggerImport}
          disabled={importBusy}
          class="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white
                 text-sm font-medium px-4 py-2.5 rounded-lg transition focus:outline-none
                 focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-gray-950
                 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {importBusy ? $_('dashboard.importing') : $_('dashboard.importProfile')}
        </button>
        <button
          onclick={startNewDeployment}
          class="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white
                 text-sm font-medium px-4 py-2.5 rounded-lg transition focus:outline-none
                 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-950"
        >
          <span class="text-base leading-none">+</span> {$_('dashboard.newProfile')}
        </button>
      </div>
    </div>

    <!-- Import status messages -->
    {#if importSuccess}
      <div class="mb-4 px-4 py-3 rounded-lg bg-green-900/30 border border-green-700/50 text-green-300 text-sm">
        {importSuccess}
      </div>
    {/if}
    {#if importError}
      <div class="mb-4 px-4 py-3 rounded-lg bg-red-900/30 border border-red-700/50 text-red-300 text-sm">
        {importError}
      </div>
    {/if}

    <!-- Import conflict resolution -->
    {#if importConflict}
      <div class="mb-4 px-4 py-4 rounded-lg bg-amber-900/20 border border-amber-700/40 space-y-3">
        <p class="text-sm text-amber-200">{$_('dashboard.importConflict')}</p>
        <div class="flex items-center gap-2">
          <input
            type="text"
            bind:value={importTargetName}
            placeholder={$_('dashboard.importNewNamePlaceholder')}
            class="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm
                   text-white focus:outline-none focus:border-indigo-500"
          />
          <button
            onclick={confirmImportConflict}
            disabled={importBusy || !importTargetName.trim()}
            class="px-4 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg
                   transition disabled:opacity-50 disabled:cursor-not-allowed"
          >{$_('dashboard.importConfirmName')}</button>
          <button
            onclick={() => importConflict = false}
            class="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition"
          >{$_('common.cancel')}</button>
        </div>
      </div>
    {/if}

    <!-- Profiles list -->
    {#if loadingProfiles}
      <div class="flex items-center justify-center py-20">
        <div class="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    {:else if profiles.length === 0}
      <div class="border border-dashed border-gray-700 rounded-xl px-6 py-14 text-center">
        <div class="text-4xl mb-3">🚀</div>
        <h3 class="text-white font-medium mb-1">{$_('dashboard.noProfiles')}</h3>
        <p class="text-gray-400 text-sm max-w-sm mx-auto mb-6">
          {$_('dashboard.noProfilesHint')}
        </p>
        <button
          onclick={startNewDeployment}
          class="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium
                 px-5 py-2.5 rounded-lg transition"
        >
          {$_('dashboard.createFirst')}
        </button>
      </div>
    {:else}
      <div class="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div class="flex-1 min-w-0">
          <label for="profile-search" class="sr-only">{$_('dashboard.searchPlaceholder')}</label>
          <input
            id="profile-search"
            type="search"
            bind:value={profileSearch}
            placeholder={$_('dashboard.searchPlaceholder')}
            autocomplete="off"
            class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3.5 py-2.5 text-sm text-white
                   placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <label for="profile-page-size" class="text-sm text-gray-500 whitespace-nowrap">
            {$_('dashboard.showLabel')}
          </label>
          <select
            id="profile-page-size"
            bind:value={profilePageSize}
            class="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white
                   focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          >
            <option value="5">{$_('dashboard.show5')}</option>
            <option value="10">{$_('dashboard.show10')}</option>
            <option value="20">{$_('dashboard.show20')}</option>
            <option value="all">{$_('dashboard.showAll')}</option>
          </select>
        </div>
      </div>

      {#if totalFiltered > 0}
        <p class="text-xs text-gray-500 mb-3">
          {$_('dashboard.resultsSummary', {
            values: { shown: visibleProfiles.length, total: totalFiltered },
          })}
        </p>
      {/if}

      {#if filteredProfiles.length === 0}
        <div class="border border-dashed border-gray-700 rounded-xl px-6 py-10 text-center">
          <p class="text-sm text-gray-400">{$_('dashboard.noSearchResults')}</p>
        </div>
      {:else}
      <div class="space-y-3">
        {#each visibleProfiles as profile (profile)}
          <article class="relative border border-gray-700 rounded-xl bg-gray-800/30 hover:bg-gray-800/50 transition isolate">

            {#if renamingProfile === profile}
              <!-- Inline rename row -->
              <div class="mx-5 mt-3 mb-2 rounded-lg border border-amber-700/50 bg-amber-950/25 px-3 py-2.5 text-xs text-amber-100/90 leading-relaxed">
                {@html $_('dashboard.renameWarning')}
              </div>
              <div class="flex items-center gap-2 px-5 py-3">
                <input
                  type="text"
                  bind:value={renameValue}
                  onkeydown={(e) => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') renamingProfile = ''; }}
                  class="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm
                         text-white focus:outline-none focus:border-indigo-500"
                  autofocus
                />
                <button
                  onclick={confirmRename}
                  disabled={renameBusy}
                  class="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500
                         text-white font-medium transition disabled:opacity-50"
                >
                  {renameBusy ? '…' : $_('dashboard.renameSave')}
                </button>
                <button
                  onclick={() => renamingProfile = ''}
                  class="text-xs px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600
                         text-gray-300 transition"
                >
                  {$_('dashboard.renameCancel')}
                </button>
              </div>
              {#if renameError}
                <p class="px-5 pb-2 text-xs text-red-400">{renameError}</p>
              {/if}

            {:else}
              {@const summary = deploySummary[profile] || {}}
              {@const badge = targetBadge(summary.hostingTarget || profileData[profile]?.hostingTarget || '')}
              {@const last = summary.lastDeploy}
              <div class="px-5 pt-4 pb-3">
                <div class="min-w-0 overflow-hidden pointer-events-none select-text">
                  <div class="flex items-center gap-2 flex-wrap">
                    <p class="text-white font-medium text-sm">{profile}</p>
                    {#if badge.labelKey || badge.rawLabel}
                      <span class="text-[11px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 border border-gray-700">
                        {badge.icon}
                        {#if badge.labelKey}
                          {$_(badge.labelKey)}
                        {:else}
                          {badge.rawLabel}
                        {/if}
                      </span>
                    {/if}
                  </div>
                  {#if summary.detectedName || summary.domain}
                    <p class="text-xs text-gray-500 mt-1 truncate">
                      {#if summary.detectedName}{summary.detectedName}{/if}
                      {#if summary.detectedName && summary.domain}
                        <span class="text-gray-700 mx-1">·</span>
                      {/if}
                      {#if summary.domain}{summary.domain.replace(/^https?:\/\//, '')}{/if}
                    </p>
                  {/if}
                  <p class="text-xs mt-1.5 {deployStatusClass(profile)}">
                    {#if !last}
                      {$_('dashboard.neverDeployed')}
                    {:else}
                      {@const when = fmtDeployWhen(last.completedAt || last.startedAt, $locale)}
                      {#if last.outcome === 'running'}
                        {$_('dashboard.lastDeployRunning', { values: { when } })}
                      {:else if last.outcome === 'success'}
                        {$_('dashboard.lastDeploySuccess', { values: { when } })}
                      {:else if last.outcome === 'failed'}
                        {$_('dashboard.lastDeployFailed', { values: { when } })}
                      {:else}
                        {when}
                      {/if}
                    {/if}
                  </p>
                  {#if last?.outcome === 'success' && last.deployUrl}
                    <a
                      href={last.deployUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="pointer-events-auto block text-xs text-indigo-400 hover:text-indigo-300 mt-1 truncate max-w-full"
                      title={last.deployUrl}
                    >{$_('dashboard.openApp')} → {last.deployUrl}</a>
                  {/if}
                </div>
              </div>
              <div
                class="flex flex-wrap items-center gap-x-1 gap-y-1 px-5 py-2.5 border-t border-gray-700/60 bg-gray-900/30"
                role="toolbar"
              >
                <button
                  type="button"
                  class="{actionBtn} text-indigo-400 hover:text-indigo-300 hover:bg-indigo-950/40"
                  onclick={() => openManage(profile)}
                >
                  {$_('dashboard.manageButton')}
                </button>
                <button
                  type="button"
                  class="{actionBtn} text-gray-400 hover:text-gray-200 hover:bg-gray-700/50"
                  onclick={() => openEditWizard(profile)}
                >
                  {$_('dashboard.editWizard')}
                </button>
                <button
                  type="button"
                  class="{actionBtn} text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 disabled:opacity-50 disabled:cursor-not-allowed"
                  onclick={() => duplicateProfile(profile)}
                  disabled={duplicateBusy === profile}
                >
                  {duplicateBusy === profile ? $_('dashboard.copying') : $_('dashboard.duplicate')}
                </button>
                <button
                  type="button"
                  class="{actionBtn} text-gray-400 hover:text-gray-200 hover:bg-gray-700/50"
                  onclick={() => startRename(profile)}
                >
                  {$_('dashboard.rename')}
                </button>
              </div>
            {/if}

          </article>
        {/each}
      </div>

      <div class="mt-8 overflow-hidden pointer-events-none">
        <DeployActivityHeatmap interactive={false} />
      </div>
      {/if}
    {/if}

    <!-- Support card -->
    {#if !coffeeDismissed}
      <div class="mt-10 rounded-xl border border-amber-700/30 bg-amber-900/10 px-5 py-4
                  flex items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <span class="text-2xl select-none">☕</span>
          <div>
            <p class="text-sm font-medium text-amber-200">{$_('dashboard.coffeeTitle')}</p>
            <p class="text-xs text-amber-200/60 mt-0.5">{$_('dashboard.coffeeDesc')}</p>
          </div>
        </div>
        <div class="flex items-center gap-3 shrink-0">
          <a
            href="https://buymeacoffee.com/mrcheese"
            target="_blank"
            rel="noopener noreferrer"
            class="text-xs font-medium px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400
                   text-gray-950 transition"
          >{$_('dashboard.coffeeCta')}</a>
          <button
            type="button"
            onclick={() => { coffeeDismissed = true; localStorage.setItem('wdp_coffee_dismissed', '1'); }}
            class="text-amber-600/60 hover:text-amber-400 text-lg leading-none transition"
            aria-label="Dismiss"
          >×</button>
        </div>
      </div>
    {/if}

  </main>

</div>
