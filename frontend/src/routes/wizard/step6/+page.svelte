<script>
  import { get } from 'svelte/store';
  import { wizardStore } from '$lib/wizardStore.js';
  import { stepValid } from '$lib/stepValid.js';
  import Tooltip from '$lib/components/Tooltip.svelte';
  import { _ } from 'svelte-i18n';

  const s6 = get(wizardStore).step6;
  let scaleHorizontal = s6.scaleHorizontal ?? false;
  let replicas        = s6.replicas        ?? 1;
  let memLimit        = s6.memLimit        ?? '';
  let cpuLimit        = s6.cpuLimit        ?? '';
  let healthcheck     = s6.healthcheck     ?? true;

  // Always valid — all fields have defaults
  $: {
    stepValid.set(true);
    wizardStore.setStep(6, { scaleHorizontal, replicas, memLimit, cpuLimit, healthcheck });
  }
</script>

<h2 class="text-xl font-semibold text-white mb-1">{$_('wizard.step6.title')}</h2>
<p class="text-gray-400 text-sm mb-8">
  {$_('wizard.step6.subtitle')}
</p>

<div class="space-y-6">

  <!-- Horizontal scaling -->
  <div class="border border-gray-700 rounded-xl p-5
    {scaleHorizontal ? 'border-indigo-600/50 bg-indigo-950/20' : ''}">
    <div class="flex items-start gap-4">
      <button
        type="button"
        onclick={() => { scaleHorizontal = !scaleHorizontal; if (!scaleHorizontal) replicas = 1; }}
        class="relative rounded-full transition-colors shrink-0 focus:outline-none
               focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-950
               {scaleHorizontal ? 'bg-indigo-600' : 'bg-gray-700'}"
        aria-pressed={scaleHorizontal}
        style="width: 40px; height: 22px; margin-top: 2px;"
      >
        <span class="absolute top-0.5 left-0.5 rounded-full bg-white transition-transform
                     {scaleHorizontal ? 'translate-x-4' : 'translate-x-0'}"
              style="width: 18px; height: 18px;"></span>
      </button>
      <div class="flex-1">
        <div class="flex items-center">
          <p class="text-sm font-medium text-white">{$_('wizard.step6.horizontal')}</p>
          <Tooltip
            title={$_('wizard.step6.tooltip.horizontal.title')}
            body={$_('wizard.step6.tooltip.horizontal.body')}
            gotcha={$_('wizard.step6.tooltip.horizontal.gotcha')}
          />
        </div>
        <p class="text-xs text-gray-400 mt-0.5">{$_('wizard.step6.horizontalDesc')}</p>
      </div>
    </div>

    {#if scaleHorizontal}
      <div class="mt-4 pt-4 border-t border-gray-700/60">
        <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
          {$_('wizard.step6.replicaCount')}
          <Tooltip title={$_('wizard.step6.tooltip.replicaCount.title')} body={$_('wizard.step6.tooltip.replicaCount.body')} defaultHint={$_('wizard.step6.tooltip.replicaCount.defaultHint')} />
        </label>
        <input
          type="number" bind:value={replicas} min="2" max="20"
          class="w-32 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />

        <div class="mt-4 space-y-2.5">
          <div class="flex items-start gap-2 text-sm text-amber-200 bg-amber-950/30
                      border border-amber-800/40 rounded-lg px-3.5 py-3">
            <span class="shrink-0 mt-0.5">⚠</span>
            <!-- svelte-ignore html_unsafe -->
            <p>{@html $_('wizard.step6.redisRequired')}</p>
          </div>
          <div class="flex items-start gap-2 text-sm text-blue-200 bg-blue-950/30
                      border border-blue-800/40 rounded-lg px-3.5 py-3">
            <span class="shrink-0 mt-0.5">💡</span>
            <!-- svelte-ignore html_unsafe -->
            <p>{@html $_('wizard.step6.minioRecommended')}</p>
          </div>
        </div>
      </div>
    {/if}
  </div>

  <!-- Memory limit -->
  <div>
    <label class="flex items-center text-sm font-medium text-gray-300 mb-1.5">
      {$_('wizard.step6.memLimitLabel')}
      <Tooltip
        title={$_('wizard.step6.tooltip.memLimit.title')}
        body={$_('wizard.step6.tooltip.memLimit.body')}
        defaultHint={$_('wizard.step6.tooltip.memLimit.defaultHint')}
        gotcha={$_('wizard.step6.tooltip.memLimit.gotcha')}
      />
    </label>
    <div class="flex items-center gap-3">
      <input
        type="text" bind:value={memLimit}
        placeholder={$_('wizard.step6.memLimitPlaceholder')}
        class="w-64 bg-gray-800 border border-gray-700 rounded-lg px-3.5 py-2.5 text-white
               placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </div>
  </div>

  <!-- CPU limit -->
  <div>
    <label class="flex items-center text-sm font-medium text-gray-300 mb-1.5">
      {$_('wizard.step6.cpuLimitLabel')}
      <Tooltip
        title={$_('wizard.step6.tooltip.cpuLimit.title')}
        body={$_('wizard.step6.tooltip.cpuLimit.body')}
        defaultHint={$_('wizard.step6.tooltip.cpuLimit.defaultHint')}
      />
    </label>
    <input
      type="text" bind:value={cpuLimit}
      placeholder={$_('wizard.step6.cpuLimitPlaceholder')}
      class="w-64 bg-gray-800 border border-gray-700 rounded-lg px-3.5 py-2.5 text-white
             placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
    />
  </div>

  <!-- Docker HEALTHCHECK -->
  <div class="flex items-start gap-4 border border-gray-700 rounded-xl p-5
    {healthcheck ? 'border-green-700/40 bg-green-950/10' : ''}">
    <button
      type="button"
      onclick={() => { healthcheck = !healthcheck; }}
      class="relative rounded-full transition-colors shrink-0 focus:outline-none
             focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-950
             {healthcheck ? 'bg-indigo-600' : 'bg-gray-700'}"
      aria-pressed={healthcheck}
      style="width: 40px; height: 22px; margin-top: 2px;"
    >
      <span class="absolute top-0.5 left-0.5 rounded-full bg-white transition-transform
                   {healthcheck ? 'translate-x-4' : 'translate-x-0'}"
            style="width: 18px; height: 18px;"></span>
    </button>
    <div>
      <div class="flex items-center">
        <p class="text-sm font-medium text-white">{$_('wizard.step6.healthcheckLabel')}</p>
        <Tooltip
          title={$_('wizard.step6.tooltip.healthcheck.title')}
          body={$_('wizard.step6.tooltip.healthcheck.body')}
          defaultHint={$_('wizard.step6.tooltip.healthcheck.defaultHint')}
          gotcha={$_('wizard.step6.tooltip.healthcheck.gotcha')}
        />
      </div>
      <!-- svelte-ignore html_unsafe -->
      <p class="text-xs text-gray-400 mt-0.5">{@html $_('wizard.step6.healthcheckDesc')}</p>
    </div>
  </div>

</div>
