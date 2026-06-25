<!--
  KnowledgePanel.svelte
  Knowledge generation + viewer for a deployment profile.
  Used in the profile detail page Knowledge tab.
-->
<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import DirBrowser from './DirBrowser.svelte';
  import { _ } from 'svelte-i18n';

  let { profile } = $props();

  // ── State ─────────────────────────────────────────────────────────────────
  let exists        = $state(false);
  let knowledgeMd   = $state('');
  let generatedAt   = $state('');
  let fileCount     = $state(0);
  let loading       = $state(true);
  let generating    = $state(false);
  let logs          = $state([]);
  let error         = $state('');
  let activeView    = $state('log');   // 'log' | 'md' | 'json'
  let knowledgeJson = $state(null);

  // Additional directories
  let additionalDirs = $state([]);
  let showBrowser    = $state(false);

  onMount(loadKnowledge);

  async function loadKnowledge() {
    loading = true;
    error   = '';
    try {
      const data = await api.get(`/api/knowledge/${encodeURIComponent(profile)}`);
      exists       = data.exists;
      knowledgeMd  = data.knowledgeMd  || '';
      generatedAt  = data.generatedAt  || '';
      knowledgeJson = data.knowledgeJson || null;
      fileCount    = knowledgeJson?.fileCount || 0;
      // Default to md view when knowledge exists and no generation is in progress
      if (data.exists && knowledgeMd && activeView === 'log') activeView = 'md';
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  async function generate() {
    generating = true;
    logs       = [];
    error      = '';
    activeView = 'log';

    try {
      const res = await fetch(
        `/api/knowledge/${encodeURIComponent(profile)}/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ additionalDirs }),
          credentials: 'include',
        }
      );

      if (!res.ok) {
        const e = await res.json().catch(() => ({ error: res.statusText }));
        error = e.error || 'Generation failed.';
        return;
      }

      const reader = res.body.getReader();
      const dec    = new TextDecoder();
      let   buf    = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          try {
            const ev = JSON.parse(line.slice(5).trim());
            if (ev.log)   logs = [...logs, ev.log];
            if (ev.error) error = ev.error;
            if (ev.done) {
              await loadKnowledge();
              if (knowledgeMd) activeView = 'md';
            }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      error = err.message;
    } finally {
      generating = false;
    }
  }

  async function deleteKnowledge() {
    if (!confirm('Delete the knowledge files for this profile?')) return;
    try {
      await api.delete(`/api/knowledge/${encodeURIComponent(profile)}`);
      exists = false;
      knowledgeMd = '';
      knowledgeJson = null;
      generatedAt = '';
      fileCount = 0;
      logs = [];
    } catch (err) {
      error = err.message;
    }
  }

  function removeDir(i) {
    additionalDirs = additionalDirs.filter((_, idx) => idx !== i);
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(undefined, {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }
</script>

<div class="space-y-6">

  <!-- Status bar -->
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      {#if loading}
        <p class="text-sm text-gray-500">{$_('common.loading')}</p>
      {:else if exists}
        <div class="flex flex-wrap gap-4 text-sm text-gray-400">
          <span>{$_('knowledge.lastGenerated')} <span class="text-white">{fmtDate(generatedAt)}</span></span>
          {#if fileCount}
            <span>{$_('knowledge.filesScanned')} <span class="text-white">{fileCount}</span></span>
          {/if}
        </div>
      {:else}
        <p class="text-sm text-gray-500">{$_('knowledge.notGenerated')}</p>
      {/if}
    </div>

    <div class="flex gap-2">
      {#if exists}
        <button
          type="button"
          onclick={deleteKnowledge}
          class="text-xs px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-red-900/40 text-gray-400
                 hover:text-red-300 border border-gray-700 transition"
        >{$_('knowledge.delete')}</button>
      {/if}
      <button
        type="button"
        onclick={generate}
        disabled={generating}
        class="text-sm px-4 py-2 rounded-lg font-medium transition
               {exists
                 ? 'bg-amber-600 hover:bg-amber-500 text-white'
                 : 'bg-indigo-600 hover:bg-indigo-500 text-white'}
               disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {generating ? $_('knowledge.generating') : exists ? $_('knowledge.update') : $_('knowledge.generate')}
      </button>
    </div>
  </div>

  {#if error}
    <div class="bg-red-900/20 border border-red-800/40 rounded-xl px-4 py-3 text-sm text-red-400">
      {error}
    </div>
  {/if}

  <!-- Additional directories -->
  <div>
    <p class="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
      {$_('knowledge.additionalDirs')}
    </p>
    <div class="space-y-1.5">
      {#each additionalDirs as dir, i}
        <div class="flex items-center gap-2">
          <code class="flex-1 text-xs bg-gray-800 border border-gray-700 rounded-lg px-3 py-2
                       text-indigo-300 font-mono truncate">{dir}</code>
          <button
            type="button"
            onclick={() => removeDir(i)}
            class="shrink-0 text-xs text-gray-500 hover:text-red-400 transition"
          >✕</button>
        </div>
      {/each}
      <button
        type="button"
        onclick={() => showBrowser = true}
        class="text-xs px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400
               hover:text-gray-200 border border-gray-700 transition"
      >{$_('knowledge.addDir')}</button>
    </div>
    <DirBrowser
      open={showBrowser}
      onselect={(dir) => { additionalDirs = [...additionalDirs, dir]; showBrowser = false; }}
      onclose={() => showBrowser = false}
    />
  </div>

  <!-- View tabs (only when content available) -->
  {#if logs.length > 0 || exists}
    <div>
      <div class="flex gap-1 mb-3 border-b border-gray-700/40 pb-0">
        {#each [['log', $_('knowledge.streamTitle')], ['md', 'knowledge.md'], ['json', 'knowledge.json']] as [id, label]}
          {#if id !== 'log' || logs.length > 0}
            {#if id !== 'md' || exists}
              {#if id !== 'json' || knowledgeJson}
                <button
                  type="button"
                  onclick={() => activeView = id}
                  class="px-3 py-2 text-xs font-medium border-b-2 -mb-px transition
                    {activeView === id
                      ? 'border-indigo-500 text-indigo-300'
                      : 'border-transparent text-gray-500 hover:text-gray-300'}"
                >{label}</button>
              {/if}
            {/if}
          {/if}
        {/each}
      </div>

      {#if activeView === 'log'}
        <div class="bg-gray-900 border border-gray-700/60 rounded-xl p-4 font-mono text-xs
                     text-gray-400 space-y-1 max-h-64 overflow-y-auto">
          {#each logs as line}
            <p class="leading-relaxed">{line}</p>
          {/each}
          {#if generating}
            <p class="text-indigo-400 animate-pulse">…</p>
          {/if}
        </div>
      {:else if activeView === 'md'}
        <div class="relative">
          <pre class="bg-gray-900 border border-gray-700/60 rounded-xl p-4 text-xs text-gray-300
                      whitespace-pre-wrap leading-relaxed max-h-[480px] overflow-y-auto font-mono">{knowledgeMd}</pre>
        </div>
      {:else if activeView === 'json'}
        <pre class="bg-gray-900 border border-gray-700/60 rounded-xl p-4 text-xs text-gray-300
                    whitespace-pre-wrap leading-relaxed max-h-[480px] overflow-y-auto font-mono"
        >{JSON.stringify(knowledgeJson, null, 2)}</pre>
      {/if}
    </div>
  {/if}

</div>
