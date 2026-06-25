<script>
  import { goto } from '$app/navigation';
  import { wizardStore } from '$lib/wizardStore.js';
  import { _ } from 'svelte-i18n';

  /** @type {{ stale?: boolean, reasons?: string[] }} */
  export let staleInfo = { stale: false, reasons: [] };
  export let profileName = '';
  export let compact = false;
  /** When true (Step 8 review), CTA scrolls to the generate panel instead of navigating away. */
  export let atGenerateStep = false;

  $: reasons = staleInfo?.reasons || [];
  $: primaryReason = reasons.includes('never_generated') || reasons.includes('missing_files')
    ? (reasons.includes('config_changed') || reasons.includes('unsaved_wizard') ? 'config_changed' : reasons[0])
    : (reasons.includes('unsaved_wizard') ? 'unsaved_wizard' : reasons.includes('config_changed') ? 'config_changed' : reasons[0]);

  function goRegenerate() {
    if (atGenerateStep) {
      document.getElementById('wdp-step8-generate')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (profileName) {
      wizardStore.update(s => ({
        ...s,
        activeProfile: profileName,
        currentStep: 8,
        maxReachedStep: Math.max(s.maxReachedStep, 8),
      }));
    } else {
      wizardStore.update(s => ({ ...s, currentStep: 8 }));
    }
    goto('/wizard/step8');
  }
</script>

{#if staleInfo?.stale}
  <div
    class="rounded-lg border border-amber-700/50 bg-amber-950/40 text-amber-100
           {compact ? 'px-3 py-2.5 mb-4' : 'px-4 py-3 mb-6'}"
    role="alert"
  >
    <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
      <div class="min-w-0">
        <p class="text-sm font-semibold text-amber-200">
          {$_('staleGenerate.title')}
        </p>
        <p class="text-sm text-amber-100/90 mt-1 leading-relaxed">
          {#if primaryReason === 'never_generated'}
            {$_('staleGenerate.bodyNever')}
          {:else if primaryReason === 'missing_files'}
            {$_('staleGenerate.bodyMissing')}
          {:else}
            {$_('staleGenerate.bodyChanged')}
          {/if}
        </p>
      </div>
      <button
        type="button"
        onclick={goRegenerate}
        class="shrink-0 text-xs font-semibold px-3 py-2 rounded-lg
               bg-amber-600 hover:bg-amber-500 text-white transition"
      >
        {atGenerateStep ? $_('staleGenerate.ctaOnStep8') : $_('staleGenerate.cta')}
      </button>
    </div>
  </div>
{/if}
