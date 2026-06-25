<script>
  import { onMount } from 'svelte';
  import { wizardStore } from '$lib/wizardStore.js';
  import { api } from '$lib/api.js';
  import { getWizardProfileMismatch } from '$lib/wizardProfileMismatch.js';
  import { _ } from 'svelte-i18n';

  let profileData = {};

  $: wz = $wizardStore;
  $: mismatch = getWizardProfileMismatch(wz, profileData);
  $: primarySuggested = mismatch?.suggested?.[0] || '';

  onMount(async () => {
    try {
      const cfg = await api.get('/api/config');
      profileData = cfg.profiles || {};
    } catch {
      /* non-fatal */
    }
  });

  function useProfile(name) {
    wizardStore.switchActiveProfile(name);
  }
</script>

{#if mismatch}
  <div
    class="rounded-lg border border-amber-700/50 bg-amber-950/40 text-amber-100 px-4 py-3 mb-6"
    role="alert"
  >
    <p class="text-sm font-semibold text-amber-200">
      {$_('wizard.profileMismatch.title')}
    </p>
    <p class="text-sm text-amber-100/90 mt-1 leading-relaxed">
      {#if mismatch.kind === 'missing'}
        {#if primarySuggested}
          {$_('wizard.profileMismatch.bodyMissing', {
            values: { active: mismatch.active, suggested: primarySuggested },
          })}
        {:else}
          {$_('wizard.profileMismatch.bodyMissingUnknown', {
            values: { active: mismatch.active },
          })}
        {/if}
      {:else}
        {$_('wizard.profileMismatch.bodyServerName', {
          values: { active: mismatch.active, suggested: primarySuggested },
        })}
      {/if}
    </p>
  {#if mismatch.suggested.length}
    <div class="mt-3 flex flex-wrap gap-2">
      {#each mismatch.suggested as name}
        <button
          type="button"
          onclick={() => useProfile(name)}
          class="text-xs font-semibold px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white transition"
        >
          {$_('wizard.profileMismatch.useProfile', { values: { name } })}
        </button>
      {/each}
    </div>
  {/if}
  </div>
{/if}
