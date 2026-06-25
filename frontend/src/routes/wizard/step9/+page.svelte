<script>
  import { wizardStore } from '$lib/wizardStore.js';
  import { stepValid } from '$lib/stepValid.js';
  import DeployPanel from '$lib/components/DeployPanel.svelte';
  import WizardProfileMismatchBanner from '$lib/components/WizardProfileMismatchBanner.svelte';
  import { _ } from 'svelte-i18n';

  // Step 9 is the last step — no Next button in WizardShell
  stepValid.set(true);
  wizardStore.setStep(9, {});

  $: wz = $wizardStore;
</script>

<h2 class="text-xl font-semibold text-white mb-1">{$_('wizard.step9.title')}</h2>
<p class="text-gray-400 text-sm mb-6">
  {$_('wizard.step9.subtitle')}
</p>

<WizardProfileMismatchBanner />

{#if !wz.activeProfile}
  <div class="rounded-lg bg-amber-950/40 border border-amber-700/50 px-4 py-3 text-sm text-amber-300">
    {$_('wizard.step9.noProfile')}
  </div>
{:else}
  <DeployPanel profile={wz.activeProfile} config={wz} />
{/if}
