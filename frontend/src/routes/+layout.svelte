<script>
  import '../app.css';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { api } from '$lib/api.js';
  import { authStatus } from '$lib/stores.js';
  import { initI18n } from '$lib/i18n.js';
  import { isLoading } from 'svelte-i18n';
  import AiPanel from '$lib/components/AiPanel.svelte';
  import { _ } from 'svelte-i18n';

  initI18n();

  let checking = true;
  const PUBLIC_PATHS = ['/setup', '/login'];

  onMount(async () => {
    try {
      const status = await api.get('/api/auth/status');
      authStatus.set(status);

      const currentPath = $page.url.pathname;

      if (status.needsSetup) {
        if (currentPath !== '/setup') await goto('/setup');
      } else if (!status.isAuthenticated) {
        if (!PUBLIC_PATHS.includes(currentPath)) await goto('/login');
      } else {
        // Authenticated — redirect away from public pages and root
        if (PUBLIC_PATHS.includes(currentPath) || currentPath === '/') {
          await goto('/dashboard');
        }
      }
    } catch (err) {
      console.error('[WDP] Auth check failed:', err);
    } finally {
      checking = false;
    }
  });
</script>

{#if checking || $isLoading}
  <div class="min-h-screen flex items-center justify-center bg-gray-950">
    <p class="text-gray-500 text-sm tracking-widest uppercase">Loading…</p>
  </div>
{:else}
  <div class="relative z-0">
    <slot />
  </div>
  {#if $authStatus?.isAuthenticated}
    {@const activeProfile = $page.params.profile || ''}
    <AiPanel profile={activeProfile} />
  {/if}
  <!-- Fixed footer -->
  <footer class="fixed bottom-0 inset-x-0 z-30 h-8 bg-gray-950/90 backdrop-blur-sm
                 border-t border-gray-800/60 flex items-center justify-center gap-3 pointer-events-none">
    <p class="text-[10px] text-gray-600 tracking-wide select-none">
      Wappler Deployment Pipeline · Built by Cheese for the Wappler Community · v1.0.0
    </p>
    <a
      href="https://buymeacoffee.com/mrcheese"
      target="_blank"
      rel="noopener noreferrer"
      class="text-[10px] text-amber-600/70 hover:text-amber-400 transition tracking-wide pointer-events-auto"
    >☕ Buy me a coffee</a>
  </footer>
{/if}
