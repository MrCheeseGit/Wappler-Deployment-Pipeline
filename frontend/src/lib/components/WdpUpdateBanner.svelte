<!--
  WdpUpdateBanner.svelte
  Shows when a newer WDP release is available on GitHub.
-->
<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { _ } from 'svelte-i18n';

  /** 'compact' = dashboard pill; 'full' = settings panel with install steps */
  export let variant = 'full';

  let info = null;
  let loading = true;
  let showInstructions = false;
  let installTab = 'git';
  let dismissing = false;

  onMount(() => loadVersion(false));

  async function loadVersion(force = false) {
    loading = true;
    try {
      const q = force ? '?force=1' : '';
      info = await api.get(`/api/app/version${q}`);
    } catch {
      info = null;
    } finally {
      loading = false;
    }
  }

  async function dismiss() {
    dismissing = true;
    try {
      await api.post('/api/app/dismiss-update', { days: 7 });
      if (info) info = { ...info, showBanner: false };
    } catch {
      /* ignore */
    } finally {
      dismissing = false;
    }
  }

  function copyCommands(lines) {
    const text = (lines || []).join('\n');
    navigator.clipboard?.writeText(text).catch(() => {});
  }
</script>

{#if !loading && info?.showBanner}
  {#if variant === 'compact'}
    <div class="rounded-lg border border-amber-700/50 bg-amber-950/30 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-sm">
      <span class="text-amber-200">
        {$_('app.update.compact', { values: { current: info.current, latest: info.latest } })}
      </span>
      <div class="flex items-center gap-2">
        <a
          href="/settings"
          class="text-xs px-2.5 py-1 rounded bg-amber-600/80 text-white hover:bg-amber-500"
        >{$_('app.update.howToUpdate')}</a>
        <button
          type="button"
          onclick={dismiss}
          disabled={dismissing}
          class="text-xs text-amber-300/80 hover:text-amber-200"
        >{$_('app.update.remindLater')}</button>
      </div>
    </div>
  {:else}
    <section class="rounded-xl border border-amber-700/50 bg-amber-950/25 p-5 space-y-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-sm font-semibold text-amber-100">{$_('app.update.title')}</h2>
          <p class="text-sm text-amber-200/90 mt-1">
            {$_('app.update.body', { values: { current: info.current, latest: info.latest } })}
          </p>
          <p class="text-xs text-gray-400 mt-2">{$_('app.update.profilesNote')}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            onclick={() => loadVersion(true)}
            class="text-xs px-3 py-1.5 rounded border border-gray-600 text-gray-300 hover:bg-gray-800"
          >{$_('app.update.checkNow')}</button>
          <button
            type="button"
            onclick={dismiss}
            disabled={dismissing}
            class="text-xs px-3 py-1.5 rounded border border-gray-600 text-gray-400 hover:bg-gray-800"
          >{$_('app.update.remindLater')}</button>
        </div>
      </div>

      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          onclick={() => { showInstructions = !showInstructions; }}
          class="text-xs px-3 py-1.5 rounded bg-amber-600 text-white hover:bg-amber-500"
        >{showInstructions ? $_('app.update.hideSteps') : $_('app.update.showSteps')}</button>
        {#if info.releaseUrl}
          <a
            href={info.releaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="text-xs px-3 py-1.5 rounded border border-gray-600 text-indigo-300 hover:bg-gray-800"
          >{$_('app.update.releaseNotes')}</a>
        {/if}
      </div>

      {#if showInstructions}
        <div class="space-y-3">
          <div class="flex gap-2 text-xs">
            <button
              type="button"
              onclick={() => installTab = 'git'}
              class="px-2.5 py-1 rounded {installTab === 'git' ? 'bg-gray-700 text-white' : 'text-gray-400'}"
            >{$_('app.update.tabGit')}</button>
            <button
              type="button"
              onclick={() => installTab = 'zip'}
              class="px-2.5 py-1 rounded {installTab === 'zip' ? 'bg-gray-700 text-white' : 'text-gray-400'}"
            >{$_('app.update.tabZip')}</button>
          </div>
          <div class="relative rounded-lg bg-gray-950 border border-gray-800">
            <button
              type="button"
              onclick={() => copyCommands(installTab === 'git' ? info.installHints?.git : info.installHints?.zip)}
              class="absolute top-2 right-2 text-xs px-2 py-1 rounded bg-gray-800 text-gray-300 hover:text-white"
            >{$_('app.update.copy')}</button>
            <pre class="p-4 pt-10 text-xs text-gray-300 font-mono whitespace-pre-wrap overflow-x-auto">{#if installTab === 'git'}{info.installHints?.git?.join('\n')}{:else}{info.installHints?.zip?.join('\n')}{/if}</pre>
          </div>
          <p class="text-xs text-gray-500">{$_('app.update.docHint')}</p>
        </div>
      {/if}
    </section>
  {/if}
{/if}

{#if !loading && info && !info.showBanner && variant === 'full'}
  <p class="text-xs text-gray-500">
    {$_('app.update.upToDate', { values: { version: info.current } })}
    <button type="button" onclick={() => loadVersion(true)} class="text-indigo-400 hover:text-indigo-300 ml-1">
      {$_('app.update.checkNow')}
    </button>
  </p>
{/if}
