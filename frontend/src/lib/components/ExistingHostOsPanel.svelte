<script>
  import { _ } from 'svelte-i18n';

  /** @type {{ imageLabel?: string, imageSlug?: string, name?: string, ipv4?: string, hostOsWizard?: string|null, hostArchWizard?: string|null }} */
  export let hostOs = null;
  export let loading = false;
  export let loadError = '';

  const ARCH_LABELS = {
    x86_64: 'x86_64 (Intel / AMD)',
    arm64: 'ARM64',
  };

  $: prefix = 'wizard.step4.hostOs';
  $: detected = hostOs?.imageLabel || '';
  $: detectedArch = hostOs?.hostArchWizard
    || (hostOs?.imageSlug?.includes('aarch64') ? 'arm64' : hostOs?.imageSlug?.includes('x64') ? 'x86_64' : '');
  $: archLabel = ARCH_LABELS[detectedArch] || detectedArch || '';
</script>

{#if loading}
  <div class="rounded-lg border border-gray-700/60 bg-gray-800/30 px-4 py-3 text-sm text-gray-400">
    {$_('common.loading')}
  </div>
{:else if loadError}
  <div class="rounded-lg border border-amber-700/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100/90" role="alert">
    {loadError}
  </div>
{:else}
  <div class="rounded-lg border border-amber-700/50 bg-amber-950/40 px-4 py-3 space-y-2" role="alert">
    <p class="text-sm font-semibold text-amber-200">
      {$_(`${prefix}.title`)}
    </p>
    <p class="text-sm text-amber-100/90 leading-relaxed">
      {$_(`${prefix}.body`)}
    </p>
    {#if detected}
      <p class="text-sm text-amber-50">
        <span class="text-amber-200/80">{$_(`${prefix}.detectedLabel`)}</span>
        <strong class="font-semibold">{detected}</strong>
        {#if hostOs?.imageSlug && hostOs.imageSlug !== '—'}
          <span class="text-amber-200/60 text-xs ml-1">({hostOs.imageSlug})</span>
        {/if}
        {#if hostOs?.name}
          <span class="text-amber-200/60 text-xs block mt-0.5">
            {$_(`${prefix}.dropletName`, { values: { name: hostOs.name, ip: hostOs.ipv4 || '' } })}
          </span>
        {/if}
      </p>
    {/if}
    {#if archLabel}
      <p class="text-sm text-amber-50">
        <span class="text-amber-200/80">{$_(`${prefix}.archDetectedLabel`)}</span>
        <strong class="font-semibold">{archLabel}</strong>
      </p>
    {/if}
  </div>
{/if}
