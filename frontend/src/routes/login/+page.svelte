<script>
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { authStatus } from '$lib/stores.js';
  import { _ } from 'svelte-i18n';
  import LanguageSelector from '$lib/components/LanguageSelector.svelte';

  const REMEMBER_KEY = 'wdp_remember_me';

  let username = '';
  let password = '';
  let rememberMe = typeof localStorage !== 'undefined'
    ? localStorage.getItem(REMEMBER_KEY) !== '0'
    : true;
  let error = '';
  let submitting = false;

  async function handleLogin() {
    error = '';
    submitting = true;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(REMEMBER_KEY, rememberMe ? '1' : '0');
      }
      await api.post('/api/auth/login', {
        username: username.trim(),
        password,
        rememberMe,
      });
      const status = await api.get('/api/auth/status');
      authStatus.set(status);
      await goto('/dashboard');
    } catch (err) {
      error = err.message || $_('auth.login.errorInvalid');
    } finally {
      submitting = false;
    }
  }
</script>

<div class="min-h-screen flex items-center justify-center bg-gray-950 px-4 relative">
  <div class="absolute top-4 right-4">
    <LanguageSelector />
  </div>
  <div class="w-full max-w-md">

    <div class="mb-8 text-center">
      <h1 class="text-2xl font-bold text-white tracking-tight">Wappler Deployment Pipeline</h1>
      <p class="mt-2 text-gray-400 text-sm">{$_('auth.login.subtitle')}</p>
    </div>

    <div class="bg-gray-900 border border-gray-800 rounded-xl p-8">
      <h2 class="text-lg font-semibold text-white mb-6">{$_('auth.login.heading')}</h2>

      <form onsubmit={(e) => { e.preventDefault(); handleLogin(); }} class="space-y-5">

        <div>
          <label for="username" class="block text-sm font-medium text-gray-300 mb-1.5">
            {$_('auth.login.username')}
          </label>
          <input
            id="username"
            type="text"
            bind:value={username}
            autocomplete="username"
            required
            class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3.5 py-2.5 text-white
                   placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500
                   focus:border-transparent transition"
          />
        </div>

        <div>
          <label for="password" class="block text-sm font-medium text-gray-300 mb-1.5">
            {$_('auth.login.password')}
          </label>
          <input
            id="password"
            type="password"
            bind:value={password}
            autocomplete="current-password"
            required
            class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3.5 py-2.5 text-white
                   placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500
                   focus:border-transparent transition"
          />
        </div>

        <label class="flex items-center gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            bind:checked={rememberMe}
            class="w-4 h-4 rounded border-gray-600 bg-gray-800 text-indigo-600
                   focus:ring-2 focus:ring-indigo-500 focus:ring-offset-0"
          />
          <span class="text-sm text-gray-400">{$_('auth.login.rememberMe')}</span>
        </label>

        {#if error}
          <p class="text-red-400 text-sm bg-red-950/40 border border-red-800/50 rounded-lg px-3.5 py-2.5">
            {error}
          </p>
        {/if}

        <button
          type="submit"
          disabled={submitting}
          class="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed
                 text-white font-medium text-sm rounded-lg px-4 py-2.5 transition"
        >
          {submitting ? $_('auth.login.signing') : $_('auth.login.submit')}
        </button>

      </form>
    </div>

  </div>
</div>
