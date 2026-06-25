<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { _ } from 'svelte-i18n';

  export let profile = '';

  let status = null;   // { isRepo, branch, commitHash, dirty }

  let initBusy          = false;
  let initInitialCommit = true;
  let initMessage       = '';
  let initResult        = null;
  let initError         = '';

  onMount(loadStatus);

  async function loadStatus() {
    status = null;
    try {
      status = await api.get(`/api/git/${encodeURIComponent(profile)}/status`);
    } catch { status = { isRepo: false }; }
  }

  async function initGit() {
    initBusy   = true;
    initError  = '';
    initResult = null;
    try {
      const res = await api.post(`/api/git/${encodeURIComponent(profile)}/init`, {
        initialCommit: initInitialCommit,
        commitMessage: initMessage.trim() || undefined,
      });
      initResult = res;
      status = res.status || (await api.get(`/api/git/${encodeURIComponent(profile)}/status`));
    } catch (err) {
      initError = err.message;
    } finally {
      initBusy = false;
    }
  }
</script>

{#if status === null}
  <div class="flex items-center gap-2 text-sm text-gray-500 py-2">
    <div class="w-3.5 h-3.5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
    {$_('git.loadingStatus')}
  </div>

{:else if !status.isRepo}
  <div class="rounded-lg border border-gray-700 bg-gray-900/40 p-5 space-y-4">
    {#if status.projectPath}
      <p class="text-xs text-gray-500 font-mono break-all">
        {$_('git.projectFolder')}: {status.projectPath}
      </p>
    {/if}
    {#if status.sharedWith?.length}
      <p class="text-sm text-amber-300 bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2">
        {$_('git.sharedPathWarning', { values: { profiles: status.sharedWith.join(', ') } })}
      </p>
    {/if}
    <div>
      <p class="text-sm font-medium text-white">{$_('git.initTitle')}</p>
      <p class="text-sm text-gray-400 mt-1 leading-relaxed">{$_('git.initBody')}</p>
    </div>
    <label class="flex items-center gap-2.5 cursor-pointer select-none">
      <input
        type="checkbox"
        bind:checked={initInitialCommit}
        class="w-4 h-4 rounded border-gray-600 bg-gray-800 text-indigo-600 focus:ring-indigo-500"
      />
      <span class="text-sm text-gray-300">{$_('git.initFirstCommit')}</span>
    </label>
    {#if initInitialCommit}
      <input
        type="text"
        bind:value={initMessage}
        placeholder={$_('git.initCommitPlaceholder', { values: { profile } })}
        class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white
               placeholder-gray-500 focus:outline-none focus:border-indigo-500"
      />
    {/if}
    <button
      type="button"
      onclick={initGit}
      disabled={initBusy}
      class="w-full sm:w-auto px-4 py-2.5 text-sm font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500
             text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {initBusy ? $_('git.initBusy') : $_('git.initButton')}
    </button>
    {#if initError}
      <p class="text-sm text-red-400">{initError}</p>
    {/if}
    {#if initResult}
      <p class="text-sm text-green-400">{$_('git.initSuccess')}</p>
      <ul class="text-xs text-gray-500 space-y-1 list-disc list-inside">
        {#if initResult.initialized}
          <li>{$_('git.initDoneRepo')}</li>
        {/if}
        {#if initResult.gitignoreUpdated}
          <li>{$_('git.initDoneGitignore')}</li>
        {/if}
        {#if initResult.initialCommit}
          <li>{$_('git.initDoneCommit', { values: { hash: initResult.initialCommit } })}</li>
        {/if}
        {#if initResult.alreadyRepo}
          <li>{$_('git.initAlreadyRepo')}</li>
        {/if}
      </ul>
      <p class="text-xs text-gray-500 mt-2">{$_('git.initRemoteHint')}</p>
    {/if}
  </div>

{:else}
  <div class="rounded-lg border border-gray-700 bg-gray-900/40 p-5 space-y-4">
    {#if status.projectPath}
      <p class="text-xs text-gray-500 font-mono break-all">
        {$_('git.projectFolder')}: {status.projectPath}
      </p>
    {/if}
    {#if status.sharedWith?.length}
      <p class="text-sm text-amber-300 bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2">
        {$_('git.sharedPathWarning', { values: { profiles: status.sharedWith.join(', ') } })}
      </p>
    {/if}
    <div class="flex items-center gap-3 flex-wrap">
      <span class="flex items-center gap-1.5 text-sm">
        <span class="text-base" aria-hidden="true">🌿</span>
        <span class="text-white font-mono font-medium">{status.branch}</span>
      </span>
      {#if status.commitHash}
        <span class="font-mono text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">
          {status.commitHash}
        </span>
      {/if}
      {#if status.dirty}
        <span class="text-xs text-amber-400 bg-amber-900/30 px-2 py-0.5 rounded-full border border-amber-700/40">
          {$_('git.dirty')}
        </span>
      {:else}
        <span class="text-xs text-green-400 bg-green-900/30 px-2 py-0.5 rounded-full border border-green-700/40">
          {$_('git.clean')}
        </span>
      {/if}
      <button
        type="button"
        onclick={loadStatus}
        class="text-xs text-gray-600 hover:text-gray-400 transition ml-auto"
      >
        {$_('git.refresh')}
      </button>
    </div>

    <div>
      <p class="text-sm font-medium text-white">{$_('git.repoActiveTitle')}</p>
      <p class="text-sm text-gray-400 mt-1 leading-relaxed">{$_('git.repoActiveBody')}</p>
    </div>

    <p class="text-xs text-gray-500 border-t border-gray-800 pt-3 leading-relaxed">
      {$_('git.comingSoonNote')}
    </p>
  </div>
{/if}
