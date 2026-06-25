<script>
  import { createEventDispatcher } from 'svelte';
  import { _ } from 'svelte-i18n';

  /** @type {'step2' | 'step4' | 'deploy'} */
  export let context = 'deploy';
  /** @type {{ name?: string, imageLabel?: string, ipv4?: string, hostOsWizard?: string|null }} */
  export let hostOs = null;
  export let rebuildTargetOs = 'ubuntu-24.04';
  export let architecture = 'x86_64';
  export let deploying = false;

  const dispatch = createEventDispatcher();

  let expanded = false;
  let acknowledgeDataLoss = false;
  let confirmDropletName = '';

  const OS_OPTIONS = [
    { value: 'ubuntu-24.04', label: 'Ubuntu Server 24.04 LTS', badge: 'Recommended' },
    { value: 'ubuntu-22.04', label: 'Ubuntu Server 22.04 LTS', badge: null },
    { value: 'debian-12', label: 'Debian 12 (Bookworm)', badge: null },
    { value: 'alpine', label: 'Alpine Linux (→ Ubuntu 24.04 on DO)', badge: null },
  ];

  const ARCH_LABELS = {
    x86_64: 'x86_64 (Intel / AMD)',
    arm64: 'ARM64',
  };

  $: dropletName = hostOs?.name || '';
  $: currentHostOs = hostOs?.hostOsWizard || '';
  $: nameMatches = Boolean(dropletName && confirmDropletName.trim() === dropletName);
  $: wantsDifferentOs = Boolean(currentHostOs && rebuildTargetOs && rebuildTargetOs !== currentHostOs);
  $: canExecuteRebuild = acknowledgeDataLoss && nameMatches && rebuildTargetOs && wantsDifferentOs && !deploying;
  $: prefix = context === 'step2'
    ? 'wizard.step2.rebuild'
    : context === 'step4'
    ? 'wizard.step4.rebuild'
    : 'deploy.rebuild';

  function cancelRebuild() {
    expanded = false;
    acknowledgeDataLoss = false;
    confirmDropletName = '';
    if (currentHostOs) {
      rebuildTargetOs = currentHostOs;
      dispatch('targetChange', currentHostOs);
    }
    dispatch('cancel');
  }
</script>

<div class="rounded-xl border-2 border-red-700/70 bg-red-950/30 overflow-hidden" role="region" aria-label={$_(`${prefix}.title`)}>
  <button
    type="button"
    class="w-full flex items-start gap-3 px-4 py-4 text-left hover:bg-red-950/50 transition"
    onclick={() => { expanded = !expanded; }}
  >
    <span class="text-xl shrink-0" aria-hidden="true">⚠️</span>
    <div class="flex-1 min-w-0">
      <p class="text-sm font-bold text-red-200">{$_(`${prefix}.title`)}</p>
      <p class="text-xs text-red-100/80 mt-1 leading-relaxed">{$_(`${prefix}.summary`)}</p>
    </div>
    <span class="text-red-300 text-xs shrink-0 mt-1">{expanded ? '▲' : '▼'}</span>
  </button>

  {#if expanded}
    <div class="px-4 pt-4 pb-4 border-t border-red-700/50 space-y-4">
      <div class="rounded-lg border border-red-600/60 bg-red-950/50 px-4 py-3 space-y-2" role="alert">
        <p class="text-sm font-bold text-red-100 uppercase tracking-wide">{$_(`${prefix}.dangerHeading`)}</p>
        <ul class="text-sm text-red-50/95 space-y-1.5 list-disc pl-5 leading-relaxed">
          <li>{$_(`${prefix}.dangerItem1`)}</li>
          <li>{$_(`${prefix}.dangerItem2`)}</li>
          <li>{$_(`${prefix}.dangerItem3`)}</li>
          <li>{$_(`${prefix}.dangerItem4`)}</li>
        </ul>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onclick={cancelRebuild}
          disabled={deploying}
          class="px-4 py-2.5 rounded-lg text-sm font-semibold border-2 border-green-700/60 text-green-100
                 bg-green-950/40 hover:bg-green-900/50 transition disabled:opacity-50"
        >
          {$_(`${prefix}.keepCurrentOs`)}
        </button>
        <p class="text-xs text-gray-500 leading-relaxed flex-1 min-w-[200px]">
          {$_(`${prefix}.keepCurrentOsHint`)}
        </p>
      </div>

      {#if hostOs?.imageLabel}
        <p class="text-sm text-gray-300">
          <span class="text-gray-500">{$_(`${prefix}.currentOs`)}</span>
          <strong class="text-white">{hostOs.imageLabel}</strong>
          {#if dropletName}
            <span class="text-gray-500 text-xs block mt-0.5">
              {$_('wizard.step2.hostOs.dropletName', { values: { name: dropletName, ip: hostOs.ipv4 || '' } })}
            </span>
          {/if}
        </p>
      {/if}

      <div>
        <p class="text-sm font-medium text-gray-200 mb-2">{$_(`${prefix}.newOs`)}</p>
        <p class="text-xs text-gray-500 mb-3">{$_(`${prefix}.archLocked`, { values: { arch: ARCH_LABELS[architecture] || architecture } })}</p>
        <div class="grid gap-2 sm:grid-cols-2">
          {#each OS_OPTIONS as os}
            <button
              type="button"
              onclick={() => {
                rebuildTargetOs = os.value;
                dispatch('targetChange', os.value);
              }}
              class="flex items-start gap-3 p-3 rounded-lg border text-left transition
                {rebuildTargetOs === os.value
                  ? 'border-red-500 bg-red-950/40'
                  : 'border-gray-700 bg-gray-900/40 hover:border-gray-600'}"
            >
              <div class="w-4 h-4 rounded-full border-2 mt-0.5 flex items-center justify-center shrink-0
                {rebuildTargetOs === os.value ? 'border-red-400' : 'border-gray-600'}">
                {#if rebuildTargetOs === os.value}
                  <div class="w-2 h-2 rounded-full bg-red-400"></div>
                {/if}
              </div>
              <div class="min-w-0">
                <p class="text-sm font-medium text-white">{os.label}</p>
                {#if os.badge}
                  <span class="mt-1 inline-block text-[10px] font-medium bg-indigo-600/30 text-indigo-300
                               border border-indigo-600/40 rounded px-1.5 py-0.5">{os.badge}</span>
                {/if}
              </div>
            </button>
          {/each}
        </div>
      </div>

      {#if context === 'step2'}
        <p class="text-sm text-gray-500 leading-relaxed border-t border-red-800/40 pt-4">
          {$_(`${prefix}.step9Hint`)}
        </p>
      {:else}
        <div class="space-y-3 border-t border-red-800/40 pt-3">
          <label class="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              bind:checked={acknowledgeDataLoss}
              disabled={deploying}
              class="mt-1 accent-red-500 shrink-0"
            />
            <span class="text-sm text-red-100 leading-relaxed font-medium">{$_(`${prefix}.acknowledge`)}</span>
          </label>

          {#if dropletName}
            <div>
              <label class="block text-sm text-gray-300 mb-1.5" for="rebuild-confirm-name">
                {$_(`${prefix}.confirmLabel`, { values: { name: dropletName } })}
              </label>
              <input
                id="rebuild-confirm-name"
                type="text"
                bind:value={confirmDropletName}
                disabled={deploying}
                autocomplete="off"
                placeholder={dropletName}
                class="w-full max-w-md rounded-lg bg-gray-900 border px-3 py-2 text-sm text-white
                       {nameMatches && confirmDropletName ? 'border-green-600/60' : 'border-red-700/60'}
                       focus:outline-none focus:ring-2 focus:ring-red-500/40"
              />
              {#if confirmDropletName && !nameMatches}
                <p class="text-xs text-red-300 mt-1">{$_(`${prefix}.confirmMismatch`)}</p>
              {/if}
            </div>
          {/if}

          <div class="flex flex-wrap gap-3 items-center">
            <button
              type="button"
              onclick={cancelRebuild}
              disabled={deploying}
              class="px-4 py-2.5 rounded-lg text-sm font-medium border border-gray-600 text-gray-200
                     bg-gray-800/80 hover:bg-gray-700/80 transition disabled:opacity-50"
            >
              {$_(`${prefix}.keepCurrentOs`)}
            </button>
            <button
              type="button"
              disabled={!canExecuteRebuild}
              onclick={() => dispatch('rebuild', {
                targetOS: rebuildTargetOs,
                confirmDropletName: confirmDropletName.trim(),
                acknowledgeDataLoss,
              })}
              class="flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-bold transition
                     {canExecuteRebuild
                ? 'bg-red-700 hover:bg-red-600 text-white border border-red-500'
                : 'bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700'}"
            >
              {deploying ? $_(`${prefix}.running`) : $_(`${prefix}.button`)}
            </button>
          </div>

          {#if currentHostOs && rebuildTargetOs === currentHostOs}
            <p class="text-xs text-gray-400 leading-relaxed">{$_(`${prefix}.sameOsHint`)}</p>
          {/if}

          <p class="text-xs text-gray-500 leading-relaxed">{$_(`${prefix}.checksNote`)}</p>
        </div>
      {/if}
    </div>
  {/if}
</div>
