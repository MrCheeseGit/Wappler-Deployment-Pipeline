<script>
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { wizardStore } from '$lib/wizardStore.js';
  import { mergeProfileIntoWizard, applyMergedWizardConfig } from '$lib/profileWizardSync.js';
  import { api } from '$lib/api.js';
  import { _ } from 'svelte-i18n';

  let profiles    = [];
  let profileData = {};   // { [name]: profileConfig } — holds wizardConfig for restore
  let open        = false;
  let container;

  onMount(loadProfiles);

  async function loadProfiles() {
    try {
      const config = await api.get('/api/config');
      profiles    = Object.keys(config.profiles || {});
      profileData = config.profiles || {};
    } catch { /* ignore — no profiles yet */ }
  }

  function handleWindowClick(e) {
    if (container && !container.contains(e.target)) open = false;
  }

  function switchProfile(profile) {
    const saved = profileData[profile];
    if (saved?.wizardConfig) {
      const merged = mergeProfileIntoWizard(saved, profile) || { ...saved.wizardConfig, activeProfile: profile };
      wizardStore.set(applyMergedWizardConfig(get(wizardStore), merged));
    } else {
      wizardStore.setProfile(profile);
    }
    open = false;
  }

  function newProfile() {
    wizardStore.reset();
    open = false;
    goto('/wizard/step1');
  }
</script>

<svelte:window onclick={handleWindowClick} />

<div bind:this={container} class="relative">
  <button
    type="button"
    onclick={(e) => { e.stopPropagation(); open = !open; }}
    class="flex items-center gap-1.5 text-sm text-gray-300 hover:text-white
           bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg
           px-3 py-1.5 transition"
  >
    <span class="w-2 h-2 rounded-full bg-indigo-400 shrink-0"></span>
    <span class="font-medium max-w-[120px] truncate">
      {$wizardStore.activeProfile || $_('profileSwitcher.noProfile')}
    </span>
    <svg class="w-3.5 h-3.5 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
    </svg>
  </button>

  {#if open}
    <div
      class="absolute right-0 top-full mt-1.5 w-52 bg-gray-800 border border-gray-700
             rounded-xl shadow-2xl py-1.5 z-50"
    >
      {#if profiles.length > 0}
        <p class="px-3.5 py-1.5 text-[10px] text-gray-500 uppercase tracking-widest font-medium">
          {$_('profileSwitcher.switchProfile')}
        </p>
        {#each profiles as profile}
          <button
            type="button"
            onclick={() => switchProfile(profile)}
            class="w-full text-left px-3.5 py-2 text-sm text-gray-200 hover:bg-gray-700
                   hover:text-white transition flex items-center gap-2"
          >
            <span class="w-1.5 h-1.5 rounded-full shrink-0
              {profile === $wizardStore.activeProfile ? 'bg-indigo-400' : 'bg-gray-600'}"></span>
            {profile}
          </button>
        {/each}
        <hr class="border-gray-700 my-1" />
      {/if}
      <button
        type="button"
        onclick={newProfile}
        class="w-full text-left px-3.5 py-2 text-sm text-indigo-400 hover:bg-gray-700
               hover:text-indigo-300 transition flex items-center gap-2"
      >
        {$_('profileSwitcher.newProfile')}
      </button>
    </div>
  {/if}
</div>
