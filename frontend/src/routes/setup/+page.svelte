<script>
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { authStatus } from '$lib/stores.js';
  import { _ } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import LanguageSelector from '$lib/components/LanguageSelector.svelte';

  let username = '';
  let password = '';
  let confirmPassword = '';
  let error = '';
  let submitting = false;

  async function handleSetup() {
    error = '';

    if (password !== confirmPassword) {
      error = get(_)('auth.setup.errorMatch');
      return;
    }
    if (password.length < 8) {
      error = get(_)('auth.setup.errorShort');
      return;
    }

    submitting = true;
    try {
      await api.post('/api/auth/setup', { username: username.trim(), password });
      const status = await api.get('/api/auth/status');
      authStatus.set(status);
      await goto('/dashboard');
    } catch (err) {
      error = err.message || get(_)('auth.setup.errorGeneric');
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
      <p class="mt-2 text-gray-400 text-sm">{$_('auth.setup.subtitle')}</p>
    </div>

    <div class="bg-gray-900 border border-gray-800 rounded-xl p-8">
      <h2 class="text-lg font-semibold text-white mb-6">{$_('auth.setup.heading')}</h2>

      <form onsubmit={(e) => { e.preventDefault(); handleSetup(); }} class="space-y-5">

        <div>
          <label for="username" class="block text-sm font-medium text-gray-300 mb-1.5">
            {$_('auth.setup.username')}
          </label>
          <input
            id="username"
            type="text"
            bind:value={username}
            autocomplete="username"
            required
            minlength="3"
            class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3.5 py-2.5 text-white
                   placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500
                   focus:border-transparent transition"
            placeholder="admin"
          />
        </div>

        <div>
          <label for="password" class="block text-sm font-medium text-gray-300 mb-1.5">
            {$_('auth.setup.password')}
          </label>
          <input
            id="password"
            type="password"
            bind:value={password}
            autocomplete="new-password"
            required
            minlength="8"
            class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3.5 py-2.5 text-white
                   placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500
                   focus:border-transparent transition"
            placeholder={$_('auth.setup.placeholderPassword')}
          />
        </div>

        <div>
          <label for="confirm-password" class="block text-sm font-medium text-gray-300 mb-1.5">
            {$_('auth.setup.confirm')}
          </label>
          <input
            id="confirm-password"
            type="password"
            bind:value={confirmPassword}
            autocomplete="new-password"
            required
            class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3.5 py-2.5 text-white
                   placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500
                   focus:border-transparent transition"
            placeholder={$_('auth.setup.placeholderConfirm')}
          />
        </div>

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
          {submitting ? $_('auth.setup.submitting') : $_('auth.setup.submit')}
        </button>

      </form>
    </div>

  </div>
</div>
