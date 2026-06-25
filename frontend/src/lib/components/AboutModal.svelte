<!--
  AboutModal.svelte
  Shows WDP version, purpose, and attribution.
  Usage: <AboutModal bind:open />
-->
<script>
  import { _ } from 'svelte-i18n';
  import { api } from '$lib/api.js';

  let { open = $bindable(false) } = $props();

  let versionInfo = $state(null);

  const AUTHOR_LINKS = [
    {
      href: 'https://github.com/MrCheeseGit',
      labelKey: 'about.linkGitHub',
      icon: 'github',
    },
    {
      href: 'https://mrcheese.co.uk',
      labelKey: 'about.linkWebsite',
      icon: 'globe',
    },
  ];

  $effect(() => {
    if (!open) return;
    api.get('/api/app/version')
      .then((v) => { versionInfo = v; })
      .catch(() => { versionInfo = { current: '?', updateAvailable: false }; });
  });
</script>

{#if open}
  <!-- Backdrop -->
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
    onclick={() => open = false}
  >
    <!-- Modal -->
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div
      class="relative w-full max-w-lg bg-gray-900 border border-gray-700/60 rounded-2xl shadow-2xl
             overflow-hidden"
      onclick={(e) => e.stopPropagation()}
    >
      <!-- Top accent bar -->
      <div class="h-1 w-full bg-gradient-to-r from-indigo-600 via-violet-500 to-indigo-400"></div>

      <div class="px-7 py-7">
        <!-- Logo row -->
        <div class="flex items-start justify-between mb-5">
          <div class="flex items-center gap-3">
            <div class="w-11 h-11 rounded-xl bg-indigo-600/20 border border-indigo-500/30
                        flex items-center justify-center text-2xl select-none">🚀</div>
            <div>
              <h2 class="text-lg font-bold text-white tracking-tight">
                Wappler Deployment Pipeline
              </h2>
              <span class="text-xs font-mono text-indigo-400 bg-indigo-500/10 border border-indigo-500/20
                           rounded px-1.5 py-0.5 select-all">
                v{versionInfo?.current || '…'}
              </span>
              {#if versionInfo?.updateAvailable}
                <a
                  href={versionInfo.releaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="ml-2 text-xs text-amber-400 hover:text-amber-300"
                >{$_('about.updateAvailable', { values: { latest: versionInfo.latest } })}</a>
              {/if}
            </div>
          </div>
          <button
            type="button"
            onclick={() => open = false}
            class="text-gray-500 hover:text-gray-300 transition text-xl leading-none mt-0.5"
          >✕</button>
        </div>

        <!-- Purpose -->
        <p class="text-sm text-gray-300 leading-relaxed mb-5">
          <!-- svelte-ignore html_unsafe -->
          {@html $_('about.purpose')}
        </p>

        <!-- Feature pills -->
        <div class="flex flex-wrap gap-2 mb-6">
          {#each [
            '🐳 Docker Compose',
            '🔒 Traefik + SSL',
            '🛡 Security scanning',
            '🔑 SSH deployment',
            '🧠 AI assistant',
            '📦 Wappler-native',
          ] as feat}
            <span class="text-xs px-2.5 py-1 rounded-full bg-gray-800 border border-gray-700
                         text-gray-300">{feat}</span>
          {/each}
        </div>

        <!-- Divider -->
        <div class="border-t border-gray-700/60 mb-5"></div>

        <!-- Attribution -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div class="flex items-start gap-3 min-w-0">
            <div class="w-9 h-9 rounded-full bg-amber-500/20 border border-amber-500/30
                        flex items-center justify-center text-lg select-none shrink-0">🧀</div>
            <div class="min-w-0">
              <p class="text-sm text-white font-medium">{$_('about.builtBy')}</p>
              <p class="text-xs text-gray-400 leading-relaxed">
                {$_('about.tagline')}
              </p>
              <div class="flex flex-wrap items-center gap-2 mt-2.5">
                {#each AUTHOR_LINKS as link}
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg
                           bg-gray-800/80 border border-gray-700 text-gray-300
                           hover:text-white hover:border-gray-600 hover:bg-gray-800 transition"
                  >
                    {#if link.icon === 'github'}
                      <svg class="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path fill-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clip-rule="evenodd" />
                      </svg>
                    {:else}
                      <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 21a9 9 0 100-18 9 9 0 000 18z" />
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.6 9h16.8M3.6 15h16.8M12 3c2.2 2.4 3.5 5.1 3.5 9s-1.3 6.6-3.5 9M12 3c-2.2 2.4-3.5 5.1-3.5 9s1.3 6.6 3.5 9" />
                      </svg>
                    {/if}
                    <span>{$_(link.labelKey)}</span>
                    <span class="text-gray-500" aria-hidden="true">↗</span>
                  </a>
                {/each}
              </div>
            </div>
          </div>
          <a
            href="https://buymeacoffee.com/mrcheese"
            target="_blank"
            rel="noopener noreferrer"
            class="shrink-0 self-start sm:self-center inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2
                   rounded-xl bg-amber-400 hover:bg-amber-300 text-gray-900 transition shadow-sm"
          >{$_('about.coffee')}</a>
        </div>
      </div>

      <!-- Footer links -->
      <div class="px-7 py-3.5 bg-gray-800/50 border-t border-gray-700/40 flex items-center
                  justify-between gap-3">
        <a
          href="https://www.mrcheese.co.uk/extension-license"
          target="_blank"
          rel="noopener noreferrer"
          class="text-xs text-gray-500 hover:text-gray-300 transition shrink min-w-0"
        >
          {$_('about.license')}
        </a>
        <a
          href="https://wappler.io/pricing/?ref=VCENXZYP"
          target="_blank"
          rel="noopener noreferrer"
          class="text-xs text-indigo-400 hover:text-indigo-300 transition shrink-0"
        >
          {$_('about.referralLink')}
        </a>
      </div>
    </div>
  </div>
{/if}
