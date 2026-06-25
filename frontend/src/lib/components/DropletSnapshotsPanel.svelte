<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { _ } from 'svelte-i18n';

  export let profile = '';
  export let dropletName = '';
  export let hasDoApiKey = false;

  let snapshots = [];
  let loading = false;
  let loadError = '';
  let snapshotName = '';
  let powerOffFirst = true;
  let creating = false;
  let createMessage = '';
  let createError = false;

  let restoreTarget = null;
  let restoreAck = false;
  let restoreConfirmName = '';
  let restoring = false;

  $: nameMatches = Boolean(dropletName && restoreConfirmName.trim() === dropletName);
  $: canRestore = restoreTarget && restoreAck && nameMatches && !restoring;

  onMount(() => {
    if (hasDoApiKey) loadSnapshots();
  });

  async function loadSnapshots() {
    loading = true;
    loadError = '';
    try {
      const res = await api.get(`/api/server/${encodeURIComponent(profile)}/snapshots`);
      snapshots = res.snapshots || [];
      if (!dropletName && res.droplet?.name) dropletName = res.droplet.name;
    } catch (err) {
      snapshots = [];
      loadError = err.message;
    } finally {
      loading = false;
    }
  }

  async function createSnapshot() {
    const name = snapshotName.trim();
    if (!name || creating) return;
    creating = true;
    createMessage = '';
    createError = false;
    try {
      const res = await api.post(`/api/server/${encodeURIComponent(profile)}/snapshots`, {
        name,
        powerOffFirst,
      });
      snapshots = res.snapshots || snapshots;
      createMessage = res.message || $_('profile.server.snapshots.createOk');
      snapshotName = '';
    } catch (err) {
      createMessage = err.message;
      createError = true;
    } finally {
      creating = false;
    }
  }

  function openRestore(snap) {
    restoreTarget = snap;
    restoreAck = false;
    restoreConfirmName = '';
  }

  function closeRestore() {
    restoreTarget = null;
    restoreAck = false;
    restoreConfirmName = '';
  }

  async function confirmRestore() {
    if (!canRestore) return;
    restoring = true;
    try {
      const res = await api.post(`/api/server/${encodeURIComponent(profile)}/snapshots/restore`, {
        imageId: restoreTarget.id,
        confirmDropletName: restoreConfirmName.trim(),
        acknowledgeDataLoss: true,
      });
      createMessage = res.message || $_('profile.server.snapshots.restoreOk');
      createError = false;
      closeRestore();
      await loadSnapshots();
    } catch (err) {
      alert(err.message);
    } finally {
      restoring = false;
    }
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString();
  }
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between flex-wrap gap-2">
    <div>
      <h2 class="text-sm font-semibold text-gray-300">{$_('profile.server.snapshots.title')}</h2>
      <p class="text-xs text-gray-500 mt-0.5 leading-relaxed max-w-2xl">{$_('profile.server.snapshots.subtitle')}</p>
    </div>
    <button
      type="button"
      onclick={loadSnapshots}
      disabled={loading || !hasDoApiKey}
      class="text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-300 hover:bg-gray-800 disabled:opacity-50"
    >{$_('profile.server.refresh')}</button>
  </div>

  {#if !hasDoApiKey}
    <p class="text-sm text-amber-400">{$_('profile.server.tokenRequired')}</p>
  {:else}
    <!-- Create -->
    <div class="rounded-lg border border-gray-800 bg-gray-900/40 p-4 space-y-3">
      <p class="text-sm font-medium text-gray-200">{$_('profile.server.snapshots.createTitle')}</p>
      <p class="text-xs text-gray-500 leading-relaxed">{$_('profile.server.snapshots.createHint')}</p>
      <div class="flex flex-wrap gap-3 items-end">
        <label class="flex-1 min-w-[200px]">
          <span class="text-xs text-gray-500 block mb-1">{$_('profile.server.snapshots.nameLabel')}</span>
          <input
            type="text"
            bind:value={snapshotName}
            disabled={creating}
            placeholder="pre-rebuild-2026-05-28"
            class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
          />
        </label>
        <button
          type="button"
          onclick={createSnapshot}
          disabled={creating || !snapshotName.trim()}
          class="text-sm px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50"
        >{creating ? $_('profile.server.snapshots.creating') : $_('profile.server.snapshots.createButton')}</button>
      </div>
      <label class="flex items-start gap-2 cursor-pointer select-none">
        <input type="checkbox" bind:checked={powerOffFirst} disabled={creating} class="mt-0.5 accent-indigo-500" />
        <span class="text-xs text-gray-400 leading-relaxed">{$_('profile.server.snapshots.powerOffFirst')}</span>
      </label>
      {#if createMessage}
        <p class="text-xs {createError ? 'text-red-400' : 'text-green-400'}">{createMessage}</p>
      {/if}
    </div>

    <!-- List -->
    {#if loading}
      <p class="text-sm text-gray-500">{$_('common.loading')}</p>
    {:else if loadError}
      <p class="text-sm text-red-400">{loadError}</p>
    {:else if snapshots.length === 0}
      <p class="text-sm text-gray-500">{$_('profile.server.snapshots.empty')}</p>
    {:else}
      <div class="overflow-x-auto rounded-lg border border-gray-800">
        <table class="w-full text-xs text-left">
          <thead class="bg-gray-900 text-gray-500">
            <tr>
              <th class="px-3 py-2">{$_('profile.server.snapshots.colName')}</th>
              <th class="px-3 py-2">{$_('profile.server.snapshots.colCreated')}</th>
              <th class="px-3 py-2">{$_('profile.server.snapshots.colSize')}</th>
              <th class="px-3 py-2">ID</th>
              <th class="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {#each snapshots as s}
              <tr class="border-t border-gray-800 hover:bg-gray-900/50">
                <td class="px-3 py-2 text-gray-200 font-medium">{s.name}</td>
                <td class="px-3 py-2 text-gray-400">{fmtDate(s.createdAt)}</td>
                <td class="px-3 py-2 text-gray-400">{s.sizeGb != null ? `${s.sizeGb} GB` : '—'}</td>
                <td class="px-3 py-2 text-gray-500 font-mono">{s.id}</td>
                <td class="px-3 py-2 text-right">
                  <button
                    type="button"
                    onclick={() => openRestore(s)}
                    class="text-red-400 hover:text-red-300 font-medium"
                  >{$_('profile.server.snapshots.restoreButton')}</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</div>

{#if restoreTarget}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
    <div class="bg-gray-900 border-2 border-red-700/60 rounded-xl p-6 w-full max-w-lg space-y-4 shadow-xl">
      <h3 class="text-lg font-bold text-red-200">{$_('profile.server.snapshots.restoreTitle')}</h3>
      <p class="text-sm text-gray-300 leading-relaxed">
        {$_('profile.server.snapshots.restoreIntro', { values: { name: restoreTarget.name } })}
      </p>
      <ul class="text-sm text-red-100/90 space-y-1.5 list-disc pl-5 leading-relaxed">
        <li>{$_('profile.server.snapshots.restoreWarn1')}</li>
        <li>{$_('profile.server.snapshots.restoreWarn2')}</li>
        <li>{$_('profile.server.snapshots.restoreWarn3')}</li>
      </ul>
      <label class="flex items-start gap-3 cursor-pointer select-none">
        <input type="checkbox" bind:checked={restoreAck} class="mt-1 accent-red-500" />
        <span class="text-sm text-red-100 font-medium leading-relaxed">{$_('profile.server.snapshots.restoreAck')}</span>
      </label>
      {#if dropletName}
        <label class="block">
          <span class="text-xs text-gray-400 block mb-1">
            {$_('profile.server.snapshots.restoreConfirm', { values: { name: dropletName } })}
          </span>
          <input
            type="text"
            bind:value={restoreConfirmName}
            autocomplete="off"
            class="w-full bg-gray-800 border border-red-700/50 rounded-lg px-3 py-2 text-sm text-white"
          />
        </label>
      {/if}
      <div class="flex gap-3 justify-end pt-2">
        <button type="button" onclick={closeRestore} disabled={restoring}
          class="px-4 py-2 text-sm rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800">
          {$_('common.cancel')}
        </button>
        <button type="button" onclick={confirmRestore} disabled={!canRestore}
          class="px-4 py-2 text-sm rounded-lg font-bold
                 {canRestore ? 'bg-red-700 hover:bg-red-600 text-white' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}">
          {restoring ? $_('profile.server.snapshots.restoring') : $_('profile.server.snapshots.restoreConfirmButton')}
        </button>
      </div>
    </div>
  </div>
{/if}
