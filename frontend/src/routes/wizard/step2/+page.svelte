<script>
  import { wizardStore } from '$lib/wizardStore.js';
  import { stepValid } from '$lib/stepValid.js';
  import { _ } from 'svelte-i18n';

  $: stepValid.set(true);
</script>

<h2 class="text-xl font-semibold text-white mb-1">{$_('wizard.step2.title')}</h2>
<p class="text-gray-400 text-sm mb-4">
  {$_('wizard.step2.subtitle')}
</p>

<div class="rounded-lg border border-gray-700/60 bg-gray-800/30 px-4 py-3 text-sm text-gray-300 leading-relaxed">
  {$_('wizard.step2.containerNote')}
</div>
