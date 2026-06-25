<!--
  DirBrowser.svelte
  Modal file-system browser for selecting a directory or a specific file.

  Props:
    open       — boolean, controls visibility
    mode       — 'directory' (default) | 'file'
    fileName   — when mode is 'file', selectable file name (default project.json)
    heading    — optional dialog title override
    onselect   — callback(path: string) — directory or full file path
    onclose    — callback() called on cancel / close
-->
<script>
  import { api } from '$lib/api.js';
  import { _ } from 'svelte-i18n';

  let {
    open = false,
    mode = 'directory',
    fileName = 'project.json',
    heading = '',
    onselect,
    onclose,
  } = $props();

  let currentPath = $state('');
  let parent      = $state(null);
  let dirs        = $state([]);
  let files       = $state([]);
  let loading     = $state(false);
  let error       = $state('');
  let manualInput = $state('');
  let selectedFilePath = $state('');

  const isFileMode = $derived(mode === 'file');
  const anyFile = $derived(isFileMode && !fileName);
  const canConfirm = $derived(
    isFileMode
      ? Boolean(selectedFilePath || (fileName && files.includes(fileName) && currentPath))
      : Boolean(currentPath),
  );
  const confirmLabel = $derived(
    isFileMode ? $_('dirBrowser.selectFile') : $_('dirBrowser.select'),
  );

  $effect(() => {
    if (open) {
      selectedFilePath = '';
      browse('');
    }
  });

  async function browse(dir) {
    loading = true;
    error   = '';
    try {
      const hidden = isFileMode ? '&showHidden=1' : '';
      const data = await api.get(
        `/api/fs/browse?path=${encodeURIComponent(dir)}${hidden}`,
      );
      currentPath = data.path;
      parent      = data.parent;
      dirs        = data.dirs;
      files       = data.files;
      manualInput = data.path;
      if (data.error) error = data.error;
      if (isFileMode && files.includes(fileName)) {
        selectedFilePath = `${currentPath}/${fileName}`.replace(/\/+/g, '/');
      } else if (isFileMode) {
        selectedFilePath = '';
      }
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  async function submitManual() {
    if (manualInput.trim()) await browse(manualInput.trim());
  }

  function selectFile(name) {
    selectedFilePath = `${currentPath}/${name}`.replace(/\/+/g, '/');
  }

  function confirm() {
    if (isFileMode) {
      const path =
        selectedFilePath ||
        (files.includes(fileName) ? `${currentPath}/${fileName}`.replace(/\/+/g, '/') : '');
      if (path && onselect) onselect(path);
      return;
    }
    if (currentPath && onselect) onselect(currentPath);
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') onclose?.();
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
    onkeydown={handleKeydown}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div
      class="absolute inset-0"
      onclick={() => onclose?.()}
    ></div>

    <div
      class="relative w-full max-w-xl bg-gray-900 border border-gray-700 rounded-2xl
             shadow-2xl flex flex-col overflow-hidden"
      style="max-height: 80vh;"
    >
      <div class="flex items-center justify-between px-5 py-4 border-b border-gray-700/60">
        <h3 class="text-base font-semibold text-white">
          {heading || (isFileMode ? $_('dirBrowser.headingFile') : $_('dirBrowser.heading'))}
        </h3>
        <button
          type="button"
          onclick={() => onclose?.()}
          class="text-gray-500 hover:text-gray-300 transition text-xl leading-none"
        >✕</button>
      </div>

      {#if isFileMode}
        <p class="px-5 py-2 text-xs text-amber-400/80 border-b border-gray-700/40 bg-amber-950/20">
          {$_('dirBrowser.hiddenFoldersHint')}
        </p>
      {/if}

      <div class="flex gap-2 px-5 py-3 border-b border-gray-700/40 bg-gray-800/40">
        {#if parent !== null}
          <button
            type="button"
            onclick={() => browse(parent)}
            class="shrink-0 px-2.5 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300
                   rounded-lg transition font-mono"
            title="Up"
          >↑</button>
        {/if}
        <input
          type="text"
          bind:value={manualInput}
          onkeydown={(e) => e.key === 'Enter' && submitManual()}
          class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm
                 text-white font-mono placeholder-gray-500 focus:outline-none focus:ring-2
                 focus:ring-indigo-500 focus:border-transparent"
          placeholder="/path/to/directory"
        />
        <button
          type="button"
          onclick={submitManual}
          class="shrink-0 px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300
                 rounded-lg transition"
        >{$_('dirBrowser.go')}</button>
      </div>

      <div class="overflow-y-auto flex-1 px-3 py-2">
        {#if loading}
          <p class="text-sm text-gray-500 px-3 py-4 text-center">{$_('common.loading')}</p>
        {:else if error}
          <p class="text-sm text-red-400 px-3 py-2">{error}</p>
        {:else if dirs.length === 0 && files.length === 0}
          <p class="text-sm text-gray-500 px-3 py-4 text-center">{$_('dirBrowser.empty')}</p>
        {:else}
          <ul class="space-y-0.5">
            {#each dirs as dir}
              <li>
                <button
                  type="button"
                  onclick={() => browse(`${currentPath}/${dir}`)}
                  class="w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg
                         hover:bg-gray-800 text-gray-200 text-sm transition group"
                >
                  <span class="text-amber-400 shrink-0 text-base leading-none group-hover:text-amber-300">📁</span>
                  <span class="truncate font-mono">{dir}</span>
                </button>
              </li>
            {/each}
            {#each files as file}
              <li>
                {#if isFileMode && (anyFile || file === fileName)}
                  <button
                    type="button"
                    onclick={() => selectFile(file)}
                    class="w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm
                           transition group
                           {selectedFilePath.endsWith('/' + file)
                             ? 'bg-indigo-600/30 text-indigo-200 ring-1 ring-indigo-500/50'
                             : 'hover:bg-gray-800 text-gray-200'}"
                  >
                    <span class="text-indigo-300 shrink-0 text-base leading-none">📄</span>
                    <span class="truncate font-mono">{file}</span>
                  </button>
                {:else}
                  <span class="flex items-center gap-2.5 px-3 py-2 text-gray-600 text-sm select-none">
                    <span class="shrink-0 text-base leading-none">📄</span>
                    <span class="truncate font-mono">{file}</span>
                  </span>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <div class="flex items-center justify-between px-5 py-3.5 border-t border-gray-700/60
                   bg-gray-800/40 gap-3">
        <div class="flex items-center gap-2 min-w-0 flex-1">
          <span class="text-xs text-gray-500 shrink-0">{$_('dirBrowser.selected')}</span>
          <code class="text-xs text-indigo-300 font-mono truncate">
            {isFileMode ? (selectedFilePath || '—') : (currentPath || '—')}
          </code>
        </div>
        <div class="flex gap-2 shrink-0">
          <button
            type="button"
            onclick={() => onclose?.()}
            class="px-4 py-2 text-sm rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition"
          >{$_('common.cancel')}</button>
          <button
            type="button"
            onclick={confirm}
            disabled={!canConfirm}
            class="px-4 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white
                   font-medium transition disabled:opacity-40 disabled:cursor-not-allowed"
          >{confirmLabel}</button>
        </div>
      </div>
    </div>
  </div>
{/if}
