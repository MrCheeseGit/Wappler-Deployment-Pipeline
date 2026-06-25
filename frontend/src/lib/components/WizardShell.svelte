<script>
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { wizardStore } from '$lib/wizardStore.js';
  import { stepValid } from '$lib/stepValid.js';
  import { api } from '$lib/api.js';
  import { isWizardDirty, mergeStaleState } from '$lib/profileStale.js';
  import { stripWizardSession } from '$lib/profileWizardSync.js';
  import ProfileSwitcher from './ProfileSwitcher.svelte';
  import LanguageSelector from './LanguageSelector.svelte';
  import StaleGenerateBanner from './StaleGenerateBanner.svelte';
  import { _ } from 'svelte-i18n';

  const STEP_KEYS = [
    'project', 'server', 'database', 'hosting',
    'addons', 'scaling', 'security', 'review', 'deploy'
  ];

  // Read currentStep directly from the store. Using $wizardStore in the template
  // guarantees Svelte re-renders on every store update without intermediate $: variables.
  let serverStale = null;
  let savedWizardConfig = null;
  let lastStaleProfile = '';

  $: currentStep = $wizardStore.currentStep;
  $: isFirstStep = currentStep === 1;
  $: isLastStep  = currentStep === 9;
  $: profileName = $wizardStore.activeProfile;
  $: showStaleBanner = profileName && currentStep >= 1 && currentStep <= 7;
  $: localDirty = profileName && savedWizardConfig
    ? isWizardDirty($wizardStore, savedWizardConfig)
    : false;
  $: staleInfo = mergeStaleState(serverStale, localDirty);

  async function refreshStale(profile) {
    if (!profile) {
      serverStale = null;
      savedWizardConfig = null;
      return;
    }
    try {
      const [stale, cfg] = await Promise.all([
        api.get(`/api/config/profiles/${encodeURIComponent(profile)}/stale`),
        api.get('/api/config'),
      ]);
      serverStale = stale;
      savedWizardConfig = cfg.profiles?.[profile]?.wizardConfig || null;
    } catch {
      serverStale = null;
    }
  }

  $: if (profileName !== lastStaleProfile) {
    lastStaleProfile = profileName;
    refreshStale(profileName);
  }

  async function persistWizard() {
    const wz = get(wizardStore);
    if (!wz.activeProfile) return;
    try {
      const res = await api.post(
        `/api/config/profiles/${encodeURIComponent(wz.activeProfile)}/wizard`,
        { wizardConfig: stripWizardSession(wz) },
      );
      serverStale = res;
      savedWizardConfig = wz;
    } catch { /* non-fatal */ }
  }

  function canJumpTo(n) {
    return n <= $wizardStore.maxReachedStep;
  }

  function jumpTo(n) {
    if (!canJumpTo(n)) return;
    wizardStore.update(s => ({ ...s, currentStep: n }));
    goto(`/wizard/step${n}`);
  }

  async function handleBack() {
    if (isFirstStep) return;
    await persistWizard();
    const prev = $wizardStore.currentStep - 1;
    wizardStore.update(s => ({ ...s, currentStep: prev }));
    goto(`/wizard/step${prev}`);
  }

  async function handleNext() {
    if (!$stepValid) return;
    await persistWizard();
    const cur = $wizardStore.currentStep;
    wizardStore.completeStep(cur);
    goto(`/wizard/step${cur + 1}`);
  }
</script>

<div class="min-h-screen bg-gray-950 flex flex-col">

  <!-- Header -->
  <header class="border-b border-gray-800 px-4 py-3.5 shrink-0">
    <div class="max-w-3xl mx-auto flex items-center justify-between gap-4">
      <a href="/dashboard" class="text-gray-400 hover:text-white text-sm transition shrink-0">
        {$_('nav.backToDashboard')}
      </a>
      <span class="text-white font-semibold text-sm tracking-tight hidden sm:block">
        Wappler Deployment Pipeline
      </span>
      <div class="flex items-center gap-2 shrink-0">
        <a href="/help" class="text-gray-400 hover:text-white text-xs sm:text-sm transition shrink-0">
          {$_('nav.help')}
        </a>
        <LanguageSelector />
        <ProfileSwitcher />
      </div>
    </div>
  </header>

  <!-- Step progress bar -->
  <div class="border-b border-gray-800 px-4 py-4 shrink-0 overflow-x-auto">
    <div class="max-w-3xl mx-auto min-w-[480px]">
      <div class="flex items-start">
        {#each STEP_KEYS as key, i}
          {@const n = i + 1}
          {@const state = $wizardStore.completedSteps.includes(n) ? 'completed' : ($wizardStore.currentStep === n ? 'current' : 'future')}
          {@const clickable = n <= $wizardStore.maxReachedStep}

          <button
            type="button"
            onclick={() => jumpTo(n)}
            disabled={!clickable}
            class="flex flex-col items-center shrink-0 disabled:cursor-default"
          >
            <div class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
                        transition border-2
              {state === 'completed' ? 'bg-indigo-600 border-indigo-600 text-white' :
               state === 'current'   ? 'bg-gray-950 border-indigo-400 text-indigo-400' :
                                       'bg-gray-800 border-gray-700 text-gray-500'}">
              {#if state === 'completed'}✓{:else}{n}{/if}
            </div>
            <span class="mt-1 text-[10px] leading-tight text-center hidden sm:block
              {state === 'current'   ? 'text-indigo-300' :
               state === 'completed' ? 'text-gray-400' : 'text-gray-600'}">
              {$_(`wizard.shell.steps.${key}`)}
            </span>
          </button>

          {#if i < STEP_KEYS.length - 1}
            <div class="flex-1 h-px mt-3.5 mx-0.5
              {$wizardStore.completedSteps.includes(n) ? 'bg-indigo-600' : 'bg-gray-800'}">
            </div>
          {/if}
        {/each}
      </div>
    </div>
  </div>

  <!-- Step content -->
  <main class="flex-1 px-4 py-8 overflow-y-auto">
    <div class="max-w-3xl mx-auto">
      {#if showStaleBanner}
        <StaleGenerateBanner {staleInfo} profileName={profileName} />
      {/if}
      <slot />
    </div>
  </main>

  <!-- Footer navigation -->
  <footer class="border-t border-gray-800 px-4 pt-4 pb-12 shrink-0">
    <div class="max-w-3xl mx-auto flex items-center justify-between">
      <button
        type="button"
        onclick={handleBack}
        disabled={isFirstStep}
        class="px-4 py-2 text-sm text-gray-400 hover:text-white border border-gray-700
               hover:border-gray-600 rounded-lg transition disabled:opacity-30
               disabled:cursor-not-allowed"
      >
        {$_('wizard.shell.back')}
      </button>

      {#if !isLastStep}
        <button
          type="button"
          onclick={handleNext}
          disabled={!$stepValid}
          class="px-6 py-2 text-sm font-medium text-white rounded-lg transition
                 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40
                 disabled:cursor-not-allowed"
        >
          {currentStep === 8 ? $_('wizard.shell.proceedToDeploy') : $_('wizard.shell.next')}
        </button>
      {/if}
    </div>
  </footer>

</div>
