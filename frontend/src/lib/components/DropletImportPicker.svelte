<script>
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { wizardStore } from '$lib/wizardStore.js';
  import { _ } from 'svelte-i18n';

  /** Profile name when saved in WDP; omit for wizard-only client apply */
  export let profileName = '';
  /** Local Wappler project root (Step 1) — when empty, show nudge after import */
  export let projectPath = '';
  /** Optional Step 4 profile-specific API key */
  export let apiKey = '';
  export let hasDoAuth = false;
  /** Called after successful import with normalised droplet */
  export let onApplied = () => {};
  /** 'wizard' | 'server' — i18n prefix */
  export let context = 'wizard';

  let droplets = [];
  let selectedId = '';
  let loading = false;
  let importing = false;
  let error = '';
  let success = '';
  let expanded = false;
  let showProjectNudge = false;

  $: i18n = (key) => $_(`${context === 'server' ? 'profile.server' : 'wizard.step4'}.${key}`);
  $: if (projectPath?.trim()) showProjectNudge = false;

  function goStep1Project() {
    if (profileName) {
      wizardStore.update((s) => ({
        ...s,
        activeProfile: profileName,
        currentStep: 1,
        maxReachedStep: Math.max(s.maxReachedStep, 1),
      }));
    } else {
      wizardStore.update((s) => ({ ...s, currentStep: 1 }));
    }
    goto('/wizard/step1');
  }

  /** Server tab only — wizard uses config API so global Settings token works before profile is saved. */
  function useServerDropletsApi() {
    return context === 'server' && profileName && !apiKey?.trim();
  }

  async function loadDroplets() {
    if (!hasDoAuth) return;
    loading = true;
    error = '';
    success = '';
    droplets = [];
    selectedId = '';
    try {
      const params = new URLSearchParams();
      if (profileName) params.set('profile', profileName);
      if (apiKey?.trim()) params.set('apiKey', apiKey.trim());
      const qs = params.toString();
      const url = useServerDropletsApi()
        ? `/api/server/${encodeURIComponent(profileName)}/droplets`
        : `/api/config/digitalocean/droplets${qs ? `?${qs}` : ''}`;
      const res = await api.get(url);
      droplets = res.droplets || [];
      if (droplets.length === 0) {
        error = i18n('importDropletEmpty');
      }
    } catch (err) {
      error = err.message || i18n('importDropletLoadFail');
    } finally {
      loading = false;
      expanded = true;
    }
  }

  async function importSelected() {
    if (!selectedId) return;
    importing = true;
    error = '';
    success = '';
    try {
      const d = droplets.find((x) => String(x.id) === String(selectedId));
      if (!d) throw new Error(i18n('importDropletSelect'));

      if (useServerDropletsApi()) {
        const res = await api.post(
          `/api/server/${encodeURIComponent(profileName)}/droplet/import`,
          { dropletId: selectedId },
        );
        success = res.message || i18n('importDropletOk');
        onApplied(res.droplet || d);
      } else if (profileName && context !== 'server') {
        try {
          const res = await api.post(
            `/api/config/profiles/${encodeURIComponent(profileName)}/import-droplet`,
            { dropletId: selectedId },
          );
          success = res.message || i18n('importDropletOk');
          onApplied(res.droplet || d);
        } catch (err) {
          if (err.status === 404 || /profile not found/i.test(err.message || '')) {
            onApplied(d);
            success = i18n('importDropletOk');
          } else {
            throw err;
          }
        }
      } else {
        onApplied(d);
        success = i18n('importDropletOk');
      }
      showProjectNudge = !String(projectPath || '').trim();
    } catch (err) {
      error = err.message || i18n('importDropletFail');
    } finally {
      importing = false;
    }
  }

  function dropletLabel(d) {
    const ip = d.ipv4 || '—';
    const region = d.region && d.region !== '—' ? d.region : '';
    const os = d.imageLabel && d.imageLabel !== '—' ? d.imageLabel : '';
    const status = d.status || '';
    const parts = [d.name, ip, os, region, status].filter(Boolean);
    return parts.join(' · ');
  }
</script>

<div class="rounded-lg border border-indigo-700/30 bg-indigo-950/10 px-4 py-3 space-y-3">
  <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
    <div>
      <p class="text-sm font-medium text-indigo-200">{i18n('importDropletTitle')}</p>
      <p class="text-xs text-indigo-300/70 mt-0.5 leading-relaxed">{i18n('importDropletDesc')}</p>
    </div>
    <button
      type="button"
      onclick={loadDroplets}
      disabled={!hasDoAuth || loading}
      class="shrink-0 text-xs px-3 py-2 rounded-lg font-medium transition
             {!hasDoAuth || loading
        ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
        : 'bg-indigo-600 hover:bg-indigo-500 text-white'}"
    >
      {loading ? $_('common.loading') : i18n('importDropletLoad')}
    </button>
  </div>

  {#if expanded && droplets.length > 0}
    <div class="flex flex-col sm:flex-row gap-2 sm:items-end">
      <div class="flex-1 min-w-0">
        <label class="text-xs font-medium text-gray-400 mb-1 block">{i18n('importDropletSelectLabel')}</label>
        <select
          bind:value={selectedId}
          class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">{i18n('importDropletSelectPlaceholder')}</option>
          {#each droplets as d}
            <option value={d.id} disabled={!d.ipv4}>{dropletLabel(d)}</option>
          {/each}
        </select>
      </div>
      <button
        type="button"
        onclick={importSelected}
        disabled={!selectedId || importing}
        class="shrink-0 text-xs px-4 py-2.5 rounded-lg font-semibold transition
               {!selectedId || importing
          ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
          : 'bg-green-700 hover:bg-green-600 text-white'}"
      >
        {importing ? $_('common.loading') : i18n('importDropletApply')}
      </button>
    </div>
  {/if}

  {#if error}
    <p class="text-xs text-red-400">{error}</p>
  {/if}
  {#if success}
    <p class="text-xs text-green-400">{success}</p>
  {/if}

  {#if showProjectNudge}
    <div
      class="rounded-lg border border-amber-700/40 bg-amber-950/30 px-3 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
      role="status"
    >
      <p class="text-xs text-amber-100/90 leading-relaxed">{i18n('importDropletNudgeBody')}</p>
      <button
        type="button"
        onclick={goStep1Project}
        class="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white transition"
      >
        {i18n('importDropletNudgeCta')}
      </button>
    </div>
  {/if}
</div>
