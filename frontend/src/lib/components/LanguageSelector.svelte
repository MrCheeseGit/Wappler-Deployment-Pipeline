<script>
  import { locale, SUPPORTED, setLocale } from '$lib/i18n.js';
  import { api } from '$lib/api.js';

  const labels = {
    en: 'EN', pt: 'PT', es: 'ES', de: 'DE', nl: 'NL'
  };

  let open = $state(false);
  let container;

  function pick(lang) {
    setLocale(lang);
    open = false;
    api.post('/api/auth/locale', { locale: lang }).catch(() => {});
  }

  function handleWindowClick(e) {
    if (container && !container.contains(e.target)) open = false;
  }
</script>

<svelte:window onclick={handleWindowClick} />

<div bind:this={container} class="relative">
  <button
    type="button"
    onclick={() => open = !open}
    class="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-400
           hover:text-gray-200 bg-gray-800/60 hover:bg-gray-700/60 rounded-lg border
           border-gray-700/40 transition"
    title="Change language"
  >
    🌐 {labels[$locale] ?? 'EN'}
  </button>

  {#if open}
    <div
      class="absolute right-0 top-full mt-1.5 bg-gray-800 border border-gray-700 rounded-xl
             shadow-2xl py-1 z-50 min-w-[7rem]"
    >
      {#each SUPPORTED as lang}
        <button
          type="button"
          onclick={() => pick(lang)}
          class="w-full text-left px-3.5 py-1.5 text-sm transition flex items-center gap-2
                 {$locale === lang
                   ? 'text-indigo-400 bg-gray-700/60'
                   : 'text-gray-300 hover:bg-gray-700 hover:text-white'}"
        >
          <span class="font-mono text-xs w-5 shrink-0">{labels[lang]}</span>
          <span class="text-xs text-gray-400">
            {#if lang === 'en'}English
            {:else if lang === 'pt'}Português
            {:else if lang === 'es'}Español
            {:else if lang === 'de'}Deutsch
            {:else if lang === 'nl'}Nederlands
            {/if}
          </span>
        </button>
      {/each}
    </div>
  {/if}
</div>
