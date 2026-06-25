<!--
  AiPanel.svelte
  Floating AI assistant slide-over panel.
  Reads profile + knowledge context from parent via props.

  Props:
    profile   — optional profile name for context injection
-->
<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { marked } from 'marked';
  import { _ } from 'svelte-i18n';

  let { profile = '' } = $props();

  // ── State ────────────────────────────────────────────────────────────────
  let open      = $state(false);
  let messages  = $state([]);    // { role: 'user'|'assistant', content: string }
  let input     = $state('');
  let sending   = $state(false);
  let hasKey    = $state(false);
  let model     = $state('');
  let error     = $state('');
  let skillsCtx = $state('');   // loaded once from /api/ai/skills (future)
  let inputEl;

  onMount(loadSettings);

  async function loadSettings() {
    try {
      const s = await api.get('/api/ai/settings');
      hasKey = s.hasKey;
      model  = s.model;
    } catch { /* ignore */ }
  }

  async function send() {
    const text = input.trim();
    if (!text || sending) return;

    error   = '';
    input   = '';
    sending = true;
    messages = [...messages, { role: 'user', content: text }];

    // Add empty assistant placeholder
    const idx = messages.length;
    messages = [...messages, { role: 'assistant', content: '' }];

    try {
      const payload = {
        messages: messages.slice(0, idx).map(m => ({ role: m.role, content: m.content })),
        profile,
      };

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        if (res.status === 402) {
          error = 'No OpenRouter API key set. Go to Settings → AI to add one.';
        } else {
          error = err.error || 'Request failed.';
        }
        messages = messages.slice(0, idx);
        return;
      }

      const reader = res.body.getReader();
      const dec    = new TextDecoder();
      let buf      = '';

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
            if (ev.delta) {
              messages = messages.map((m, i) =>
                i === idx ? { ...m, content: m.content + ev.delta } : m
              );
            }
            if (ev.error) error = ev.error;
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      error = err.message;
      messages = messages.slice(0, idx);
    } finally {
      sending = false;
    }
  }

  function clearChat() {
    messages = [];
    error = '';
  }

  function saveChat() {
    const date = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const heading = profile
      ? `# AI Assistant Chat — ${profile}\n\n*Exported: ${date}*\n`
      : `# AI Assistant Chat\n\n*Exported: ${date}*\n`;

    const body = messages.map(m => {
      const role = m.role === 'user' ? '**You**' : '**Assistant**';
      return `---\n\n${role}\n\n${m.content}\n`;
    }).join('\n');

    const md = heading + '\n' + body;
    const blob = new Blob([md], { type: 'text/markdown' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const slug = profile ? `ai-chat-${profile}` : 'ai-chat';
    a.href     = url;
    a.download = `${slug}-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function renderMd(text) {
    try { return marked.parse(text || ''); } catch { return text; }
  }
</script>

<!-- Floating button — hidden while panel is open -->
{#if !open}
  <button
    type="button"
    onclick={() => { open = true; loadSettings(); }}
    class="fixed bottom-12 left-6 z-50 w-12 h-12 rounded-full bg-indigo-600 hover:bg-indigo-500
           text-white shadow-2xl flex items-center justify-center text-xl transition
           border border-indigo-400/30"
    title="AI Assistant"
  >🤖</button>
{/if}

<!-- Slide-over panel -->
{#if open}
  <div
    class="fixed inset-y-0 right-0 z-40 w-full max-w-md bg-gray-900 border-l border-gray-700
           flex flex-col shadow-2xl"
  >
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3.5 border-b border-gray-700/60">
      <div>
        <p class="text-sm font-semibold text-white">{$_('ai.title')}</p>
        {#if model}
          <p class="text-[11px] text-gray-500 font-mono mt-0.5">{model}</p>
        {/if}
      </div>
      <div class="flex items-center gap-2">
        {#if messages.length > 0}
          <button
            type="button"
            onclick={saveChat}
            class="text-xs text-gray-500 hover:text-gray-300 transition px-2 py-1 rounded"
            title="Save chat as Markdown"
          >{$_('ai.saveChat')}</button>
        {/if}
        <button
          type="button"
          onclick={clearChat}
          class="text-xs text-gray-500 hover:text-gray-300 transition px-2 py-1 rounded"
        >{$_('ai.clearChat')}</button>
        <button
          type="button"
          onclick={() => open = false}
          class="text-gray-500 hover:text-gray-300 text-lg leading-none transition"
        >✕</button>
      </div>
    </div>

    <!-- No key banner -->
    {#if !hasKey}
      <div class="mx-4 mt-3 px-3.5 py-3 bg-amber-900/30 border border-amber-700/50 rounded-xl text-xs text-amber-300 flex items-start gap-2">
        <span class="shrink-0">⚠</span>
        <span>{$_('ai.noKey')} <a href="/settings" class="underline hover:text-amber-200" onclick={() => open = false}>{$_('ai.goToSettings')}</a></span>
      </div>
    {/if}

    <!-- Messages -->
    <div class="flex-1 overflow-y-auto px-4 py-3 space-y-4">
      {#if messages.length === 0}
        <div class="flex flex-col items-center justify-center h-full text-center py-16 select-none">
          <p class="text-4xl mb-3">🤖</p>
          <p class="text-sm text-gray-400">{$_('ai.placeholder')}</p>
          {#if profile}
            <p class="mt-3 text-xs text-indigo-400/70">{$_("ai.context", { values: { profile } })}</p>
          {/if}
        </div>
      {:else}
        {#each messages as msg}
          <div class="flex {msg.role === 'user' ? 'justify-end' : 'justify-start'}">
            <div
              class="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed
                {msg.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-sm'
                  : 'bg-gray-800 text-gray-200 rounded-bl-sm'}"
            >
              {#if msg.role === 'assistant'}
                {#if msg.content}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div class="ai-md">
                    {@html renderMd(msg.content)}
                  </div>
                {:else if sending}
                  <span class="text-gray-500 animate-pulse">{$_('ai.thinking')}</span>
                {/if}
              {:else}
                {msg.content}
              {/if}
            </div>
          </div>
        {/each}
      {/if}

      {#if error}
        <div class="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded-xl px-3.5 py-2.5">
          {error}
        </div>
      {/if}
    </div>

    <!-- Input -->
    <div class="px-4 py-3 border-t border-gray-700/60">
      <div class="flex gap-2 items-end">
        <textarea
          bind:this={inputEl}
          bind:value={input}
          onkeydown={handleKeydown}
          placeholder={$_('ai.placeholder')}
          rows="2"
          disabled={sending || !hasKey}
          class="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3.5 py-2.5 text-sm
                 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500
                 focus:border-transparent transition resize-none disabled:opacity-40"
        ></textarea>
        <button
          type="button"
          onclick={send}
          disabled={sending || !input.trim() || !hasKey}
          class="shrink-0 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm
                 font-medium transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {sending ? '…' : '↑'}
        </button>
      </div>
      <p class="text-[10px] text-gray-600 mt-1.5">{$_("ai.inputHint")}</p>
    </div>
  </div>
{/if}

<style>
  /* Markdown rendered inside assistant bubbles */
  :global(.ai-md) {
    font-size: 0.8125rem;
    line-height: 1.6;
    word-wrap: break-word;
    overflow-wrap: break-word;
    color: #e5e7eb;
  }
  :global(.ai-md p)          { margin: 0.4em 0; }
  :global(.ai-md p:first-child) { margin-top: 0; }
  :global(.ai-md p:last-child)  { margin-bottom: 0; }
  :global(.ai-md strong)     { font-weight: 600; color: #f9fafb; }
  :global(.ai-md em)         { font-style: italic; }
  :global(.ai-md h1, .ai-md h2, .ai-md h3, .ai-md h4) {
    font-weight: 600;
    color: #f9fafb;
    margin: 0.75em 0 0.3em;
    line-height: 1.3;
  }
  :global(.ai-md h1) { font-size: 1rem; }
  :global(.ai-md h2) { font-size: 0.9375rem; }
  :global(.ai-md h3) { font-size: 0.875rem; }
  :global(.ai-md ul, .ai-md ol) {
    margin: 0.4em 0;
    padding-left: 1.25em;
  }
  :global(.ai-md ul)  { list-style: disc; }
  :global(.ai-md ol)  { list-style: decimal; }
  :global(.ai-md li)  { margin: 0.2em 0; }
  :global(.ai-md code) {
    font-family: ui-monospace, 'Cascadia Code', monospace;
    font-size: 0.78rem;
    background: #1f2937;
    border: 1px solid #374151;
    border-radius: 4px;
    padding: 0.1em 0.35em;
    color: #a5b4fc;
  }
  :global(.ai-md pre) {
    background: #111827;
    border: 1px solid #374151;
    border-radius: 8px;
    padding: 0.75em 1em;
    overflow-x: auto;
    margin: 0.6em 0;
  }
  :global(.ai-md pre code) {
    background: none;
    border: none;
    padding: 0;
    font-size: 0.75rem;
    color: #d1d5db;
  }
  :global(.ai-md blockquote) {
    border-left: 3px solid #4f46e5;
    margin: 0.5em 0;
    padding: 0.25em 0.75em;
    color: #9ca3af;
  }
  :global(.ai-md table) {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.78rem;
    margin: 0.6em 0;
  }
  :global(.ai-md th) {
    background: #1f2937;
    color: #f9fafb;
    font-weight: 600;
    text-align: left;
    padding: 0.4em 0.6em;
    border: 1px solid #374151;
  }
  :global(.ai-md td) {
    padding: 0.35em 0.6em;
    border: 1px solid #374151;
    vertical-align: top;
  }
  :global(.ai-md tr:nth-child(even) td) { background: #1a2233; }
  :global(.ai-md hr) {
    border: none;
    border-top: 1px solid #374151;
    margin: 0.75em 0;
  }
  :global(.ai-md a) {
    color: #818cf8;
    text-decoration: underline;
  }
</style>
