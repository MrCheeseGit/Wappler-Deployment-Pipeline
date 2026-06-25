<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { marked } from 'marked';
  import { api } from '$lib/api.js';
  import LanguageSelector from '$lib/components/LanguageSelector.svelte';
  import { _ } from 'svelte-i18n';

  let docs = [];
  let loadingList = true;
  let loadingDoc = false;
  let loadError = '';
  let html = '';

  $: slug = $page.url.searchParams.get('doc') || 'how-it-works';

  onMount(loadCatalog);

  $: if (slug && docs.length) loadDoc(slug);

  async function loadCatalog() {
    loadingList = true;
    loadError = '';
    try {
      const res = await api.get('/api/help/docs');
      docs = res.docs || [];
      if (!docs.some((d) => d.slug === slug) && docs.length) {
        goto(`/help?doc=${docs[0].slug}`, { replaceState: true });
      } else if (docs.length) {
        await loadDoc(slug);
      }
    } catch (err) {
      loadError = err.message || 'Failed to load help.';
    } finally {
      loadingList = false;
    }
  }

  async function loadDoc(nextSlug) {
    if (!nextSlug) return;
    loadingDoc = true;
    loadError = '';
    try {
      const res = await api.get(`/api/help/docs/${encodeURIComponent(nextSlug)}`);
      let md = res.markdown || '';
      md = md.replace(/\]\(([^)]+\.md)(#[^)]*)?\)/g, (_m, file, hash = '') => {
        const base = file.replace(/^.*\//, '').replace(/\.md$/, '');
        return `](/help?doc=${base}${hash})`;
      });
      html = marked.parse(md);
    } catch (err) {
      html = '';
      loadError = err.message || 'Failed to load topic.';
    } finally {
      loadingDoc = false;
    }
  }

  function selectDoc(nextSlug) {
    goto(`/help?doc=${nextSlug}`);
  }
</script>

<div class="min-h-screen bg-gray-950 flex flex-col">
  <header class="border-b border-gray-800 px-4 py-4 shrink-0">
    <div class="max-w-6xl mx-auto flex items-center justify-between gap-4">
      <div class="flex items-center gap-3 min-w-0">
        <a href="/dashboard" class="text-gray-400 hover:text-white text-sm transition shrink-0">
          {$_('nav.backToDashboard')}
        </a>
        <h1 class="text-white font-semibold tracking-tight truncate">{$_('help.title')}</h1>
      </div>
      <LanguageSelector />
    </div>
  </header>

  <main class="flex-1 max-w-6xl mx-auto w-full px-4 py-8 flex flex-col lg:flex-row gap-8">
    <nav class="lg:w-56 shrink-0">
      <p class="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">{$_('help.topics')}</p>
      {#if loadingList}
        <p class="text-sm text-gray-500">{$_('common.loading')}</p>
      {:else if docs.length === 0}
        <p class="text-sm text-gray-500">{$_('help.noDocs')}</p>
      {:else}
        <ul class="space-y-1">
          {#each docs as doc}
            <li>
              <button
                type="button"
                onclick={() => selectDoc(doc.slug)}
                class="w-full text-left text-sm px-3 py-2 rounded-lg transition
                  {doc.slug === slug
                    ? 'bg-indigo-950/50 text-indigo-200 border border-indigo-700/40'
                    : 'text-gray-400 hover:text-white hover:bg-gray-900'}"
              >{$_(doc.titleKey)}</button>
            </li>
          {/each}
        </ul>
      {/if}
    </nav>

    <article class="flex-1 min-w-0">
      {#if loadError}
        <p class="text-sm text-red-400">{loadError}</p>
      {:else if loadingDoc}
        <p class="text-sm text-gray-500">{$_('common.loading')}</p>
      {:else if html}
        <div class="help-prose max-w-none text-gray-300 text-sm leading-relaxed">
          {@html html}
        </div>
      {/if}
    </article>
  </main>
</div>

<style>
  :global(.help-prose h1) {
    font-size: 1.35rem;
    font-weight: 600;
    color: #fff;
    margin: 0 0 1rem;
  }
  :global(.help-prose h2) {
    font-size: 1.1rem;
    font-weight: 600;
    color: #e5e7eb;
    margin: 1.75rem 0 0.75rem;
  }
  :global(.help-prose h3) {
    font-size: 1rem;
    font-weight: 600;
    color: #d1d5db;
    margin: 1.25rem 0 0.5rem;
  }
  :global(.help-prose p) {
    margin: 0.75rem 0;
  }
  :global(.help-prose ul, .help-prose ol) {
    margin: 0.75rem 0;
    padding-left: 1.25rem;
  }
  :global(.help-prose li) {
    margin: 0.35rem 0;
  }
  :global(.help-prose a) {
    color: #a5b4fc;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  :global(.help-prose a:hover) {
    color: #c7d2fe;
  }
  :global(.help-prose code) {
    font-family: ui-monospace, monospace;
    font-size: 0.85em;
    background: #111827;
    border: 1px solid #374151;
    border-radius: 0.25rem;
    padding: 0.1rem 0.35rem;
  }
  :global(.help-prose pre) {
    background: #030712;
    border: 1px solid #374151;
    border-radius: 0.5rem;
    padding: 0.75rem 1rem;
    overflow-x: auto;
    margin: 1rem 0;
  }
  :global(.help-prose pre code) {
    background: none;
    border: none;
    padding: 0;
  }
  :global(.help-prose table) {
    width: 100%;
    border-collapse: collapse;
    margin: 1rem 0;
    font-size: 0.85rem;
  }
  :global(.help-prose th, .help-prose td) {
    border: 1px solid #374151;
    padding: 0.5rem 0.75rem;
    text-align: left;
  }
  :global(.help-prose th) {
    background: #111827;
    color: #e5e7eb;
  }
  :global(.help-prose hr) {
    border-color: #374151;
    margin: 1.5rem 0;
  }
  :global(.help-prose blockquote) {
    border-left: 3px solid #4f46e5;
    padding-left: 1rem;
    color: #9ca3af;
    margin: 1rem 0;
  }
</style>
