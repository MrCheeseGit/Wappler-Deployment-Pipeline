<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import LanguageSelector from '$lib/components/LanguageSelector.svelte';
  import AboutModal from '$lib/components/AboutModal.svelte';
  import WdpUpdateBanner from '$lib/components/WdpUpdateBanner.svelte';
  import { _, locale } from 'svelte-i18n';
  import { get } from 'svelte/store';

  let aboutOpen   = $state(false);
  let model       = $state('minimax/minimax-m2.7');
  let hasKey      = $state(false);
  let keyInput    = $state('');
  let savingKey   = $state(false);
  let keyStatus   = $state('');   // 'saved' | 'cleared' | ''
  let savingModel = $state(false);
  let modelStatus = $state('');

  let doHasKey      = $state(false);
  let doKeyInput    = $state('');
  let savingDoKey   = $state(false);
  let doKeyStatus   = $state('');

  let csHasCreds    = $state(false);
  let csUsername    = $state('');
  let csApiKey      = $state('');
  let csOnSuccess   = $state(true);
  let csOnFailure   = $state(true);
  let csOnRollback  = $state(true);
  let savingCs      = $state(false);
  let csStatus      = $state('');
  let testingCs     = $state(false);
  let testCsStatus  = $state('');
  let testCsOk      = $state(false);

  const SUGGESTED_MODELS = [
    'minimax/minimax-m2.7',
    'google/gemini-2.0-flash-001',
    'anthropic/claude-3.5-haiku',
    'openai/gpt-4o-mini',
    'meta-llama/llama-3.3-70b-instruct',
  ];

  onMount(async () => {
    try {
      const s = await api.get('/api/ai/settings');
      hasKey = s.hasKey;
      model  = s.model;
    } catch { /* ignore */ }
    try {
      const d = await api.get('/api/config/digitalocean');
      doHasKey = d.hasKey;
    } catch { /* ignore */ }
    try {
      const c = await api.get('/api/config/clicksend');
      csHasCreds   = c.hasCredentials;
      csUsername   = c.username || '';
      csOnSuccess  = c.onSuccess !== false;
      csOnFailure  = c.onFailure !== false;
      csOnRollback = c.onRollback !== false;
    } catch { /* ignore */ }
  });

  async function saveKey() {
    if (!keyInput.trim()) return;
    savingKey = true;
    keyStatus = '';
    try {
      await api.post('/api/ai/settings', { apiKey: keyInput.trim() });
      hasKey   = true;
      keyInput = '';
      keyStatus = 'saved';
    } catch (err) {
      keyStatus = `Error: ${err.message}`;
    } finally {
      savingKey = false;
    }
  }

  async function clearKey() {
    if (!confirm('Clear the stored API key?')) return;
    try {
      await api.delete('/api/ai/settings/key');
      hasKey    = false;
      keyStatus = 'cleared';
    } catch (err) {
      keyStatus = `Error: ${err.message}`;
    }
  }

  async function saveDoKey() {
    if (!doKeyInput.trim()) return;
    savingDoKey = true;
    doKeyStatus = '';
    try {
      const res = await api.post('/api/config/digitalocean', { apiKey: doKeyInput.trim() });
      if (!res.ok) {
        doKeyStatus = res.message || 'Failed to save token';
        return;
      }
      doHasKey   = true;
      doKeyInput = '';
      doKeyStatus = res.message || 'saved';
    } catch (err) {
      doKeyStatus = err.message;
    } finally {
      savingDoKey = false;
    }
  }

  async function clearDoKey() {
    if (!confirm($_('settings.clearDoKeyConfirm'))) return;
    try {
      await api.delete('/api/config/digitalocean');
      doHasKey    = false;
      doKeyStatus = 'cleared';
    } catch (err) {
      doKeyStatus = err.message;
    }
  }

  async function saveClickSendNotifications() {
    if (!csHasCreds) return;
    try {
      await api.post('/api/config/clicksend/notifications', {
        onSuccess: csOnSuccess,
        onFailure: csOnFailure,
        onRollback: csOnRollback,
      });
      csStatus = 'notifications';
    } catch (err) {
      csStatus = err.message;
    }
  }

  async function saveClickSend() {
    if (!csUsername.trim() && !csHasCreds) return;
    if (!csHasCreds && !csApiKey.trim()) return;
    savingCs = true;
    csStatus = '';
    try {
      await api.post('/api/config/clicksend', {
        username: csUsername.trim(),
        apiKey: csApiKey.trim(),
        onSuccess: csOnSuccess,
        onFailure: csOnFailure,
        onRollback: csOnRollback,
      });
      csHasCreds = true;
      csApiKey   = '';
      csStatus   = 'saved';
    } catch (err) {
      csStatus = err.message;
    } finally {
      savingCs = false;
    }
  }

  async function clearClickSend() {
    if (!confirm($_('settings.clearCsConfirm'))) return;
    try {
      await api.delete('/api/config/clicksend/credentials');
      csHasCreds = false;
      csApiKey   = '';
      csStatus   = 'cleared';
    } catch (err) {
      csStatus = err.message;
    }
  }

  async function testClickSend() {
    testingCs = true;
    testCsStatus = '';
    testCsOk = false;
    try {
      const res = await api.post('/api/config/clicksend/test', { locale: get(locale) });
      testCsOk = true;
      testCsStatus = res.message || $_('settings.csTestSent');
    } catch (err) {
      testCsStatus = err.message;
    } finally {
      testingCs = false;
    }
  }

  async function saveModel() {
    savingModel = true;
    modelStatus = '';
    try {
      await api.post('/api/ai/settings', { model });
      modelStatus = 'saved';
    } catch (err) {
      modelStatus = `Error: ${err.message}`;
    } finally {
      savingModel = false;
    }
  }
</script>

<div class="min-h-screen bg-gray-950 flex flex-col">

  <header class="border-b border-gray-800 px-4 py-4">
    <div class="max-w-2xl mx-auto flex items-center justify-between">
      <div class="flex items-center gap-3">
        <a href="/dashboard" class="text-gray-400 hover:text-white text-sm transition">{$_('nav.backToDashboard')}</a>
        <span class="text-gray-700">/</span>
        <h1 class="text-white font-semibold tracking-tight">{$_('settings.title')}</h1>
      </div>
      <div class="flex items-center gap-3">
        <button
          type="button"
          onclick={() => aboutOpen = true}
          class="text-gray-400 hover:text-white text-sm transition"
        >{$_('nav.about')}</button>
        <a href="/help" class="text-gray-400 hover:text-white text-sm transition">{$_('nav.help')}</a>
        <LanguageSelector />
      </div>
    </div>
  </header>

  <AboutModal bind:open={aboutOpen} />

  <main class="flex-1 max-w-2xl mx-auto w-full px-4 py-10 space-y-10">

    <WdpUpdateBanner variant="full" />

    <!-- ── AI Assistant ──────────────────────────────────────────────────── -->
    <section>
      <h2 class="text-base font-semibold text-white mb-1">{$_('settings.aiSection')}</h2>
      <p class="text-sm text-gray-400 mb-6">
        The AI assistant uses <a href="https://openrouter.ai" target="_blank" rel="noopener"
          class="text-indigo-400 hover:text-indigo-300 underline">OpenRouter</a> to connect to LLM models.
        Your API key is stored on the server and never exposed to the browser.
      </p>

      <!-- API key -->
      <div class="bg-gray-800/40 border border-gray-700/60 rounded-2xl p-5 space-y-4">
        <div>
          <p class="text-sm font-medium text-gray-300 mb-0.5">{$_('settings.openrouterKey')}</p>
          <p class="text-xs text-gray-500 mb-3">
            Get a key at
            <a href="https://openrouter.ai/keys" target="_blank" rel="noopener"
              class="text-indigo-400 hover:text-indigo-300">openrouter.ai/keys</a>.
            Keys are write-only — once saved they cannot be retrieved.
          </p>

          {#if hasKey}
            <div class="flex items-center gap-3 bg-green-900/20 border border-green-800/40
                         rounded-xl px-4 py-3 mb-3">
              <span class="text-green-400 text-sm">{$_('settings.keyConfigured')}</span>
              <button
                type="button"
                onclick={clearKey}
                class="ml-auto text-xs text-red-400 hover:text-red-300 transition"
              >{$_('settings.clearKey')}</button>
            </div>
          {/if}

          <div class="flex gap-2">
            <input
              type="password"
              bind:value={keyInput}
              placeholder="sk-or-…"
              autocomplete="off"
              class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3.5 py-2.5 text-white
                     placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500
                     focus:border-transparent transition font-mono"
            />
            <button
              type="button"
              onclick={saveKey}
              disabled={savingKey || !keyInput.trim()}
              class="shrink-0 px-4 py-2.5 text-sm bg-indigo-600 hover:bg-indigo-500 text-white
                     font-medium rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {savingKey ? $_('settings.savingKey') : hasKey ? $_('settings.replaceKey') : $_('settings.saveKey')}
            </button>
          </div>
          {#if keyStatus === 'saved'}
            <p class="text-xs text-green-400 mt-1.5">{$_('settings.keySavedCheck')}</p>
          {:else if keyStatus === 'cleared'}
            <p class="text-xs text-gray-400 mt-1.5">{$_('settings.keyCleared')}</p>
          {:else if keyStatus}
            <p class="text-xs text-red-400 mt-1.5">{keyStatus}</p>
          {/if}
        </div>

        <!-- Model selector -->
        <div class="border-t border-gray-700/40 pt-4">
          <p class="text-sm font-medium text-gray-300 mb-3">{$_('settings.model')}</p>
          <div class="flex gap-2">
            <div class="flex-1">
              <input
                type="text"
                bind:value={model}
                placeholder="provider/model-name"
                list="model-suggestions"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3.5 py-2.5 text-white
                       placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500
                       focus:border-transparent transition font-mono"
              />
              <datalist id="model-suggestions">
                {#each SUGGESTED_MODELS as m}
                  <option value={m}></option>
                {/each}
              </datalist>
              <p class="text-[11px] text-gray-600 mt-1">
                Any model available on OpenRouter. See
                <a href="https://openrouter.ai/models" target="_blank" rel="noopener"
                  class="text-indigo-500 hover:text-indigo-400">openrouter.ai/models</a>.
              </p>
            </div>
            <button
              type="button"
              onclick={saveModel}
              disabled={savingModel}
              class="shrink-0 self-start px-4 py-2.5 text-sm bg-gray-700 hover:bg-gray-600 text-white
                     rounded-lg transition disabled:opacity-40"
            >
              {savingModel ? $_('settings.savingModel') : $_('settings.saveModel')}
            </button>
          </div>
          {#if modelStatus === 'saved'}
            <p class="text-xs text-green-400 mt-1.5">{$_('settings.modelSavedCheck')}</p>
          {:else if modelStatus}
            <p class="text-xs text-red-400 mt-1.5">{modelStatus}</p>
          {/if}
        </div>
      </div>
    </section>

    <!-- ── DigitalOcean ──────────────────────────────────────────────────── -->
    <section>
      <h2 class="text-base font-semibold text-white mb-1">{$_('settings.doSection')}</h2>
      <p class="text-sm text-gray-400 mb-6">
        {$_('settings.doSectionDesc')}
      </p>

      <div class="bg-gray-800/40 border border-gray-700/60 rounded-2xl p-5 space-y-4">
        <p class="text-xs text-gray-500">
          {$_('settings.doSignUpLead')}
          <a href="https://m.do.co/c/8f8dcde15590" target="_blank" rel="noopener noreferrer"
            class="text-indigo-400 hover:text-indigo-300">{$_('settings.doSignUp')}</a>.
        </p>

        <div>
          <p class="text-sm font-medium text-gray-300 mb-0.5">{$_('settings.doApiKey')}</p>
          <p class="text-xs text-gray-500 mb-3">
            {$_('settings.doApiKeyHint')}
            <a href="https://cloud.digitalocean.com/account/api/tokens" target="_blank" rel="noopener"
              class="text-indigo-400 hover:text-indigo-300">cloud.digitalocean.com/account/api/tokens</a>.
          </p>

          {#if doHasKey}
            <div class="flex items-center gap-3 bg-green-900/20 border border-green-800/40
                         rounded-xl px-4 py-3 mb-3">
              <span class="text-green-400 text-sm">{$_('settings.doKeyConfigured')}</span>
              <button
                type="button"
                onclick={clearDoKey}
                class="ml-auto text-xs text-red-400 hover:text-red-300 transition"
              >{$_('settings.clearDoKey')}</button>
            </div>
          {/if}

          <div class="flex gap-2">
            <input
              type="password"
              bind:value={doKeyInput}
              placeholder="dop_v1_…"
              autocomplete="off"
              class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3.5 py-2.5 text-white
                     placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500
                     focus:border-transparent transition font-mono"
            />
            <button
              type="button"
              onclick={saveDoKey}
              disabled={savingDoKey || !doKeyInput.trim()}
              class="shrink-0 px-4 py-2.5 text-sm bg-indigo-600 hover:bg-indigo-500 text-white
                     font-medium rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {savingDoKey ? $_('settings.savingDoKey') : doHasKey ? $_('settings.replaceDoKey') : $_('settings.saveDoKey')}
            </button>
          </div>
          {#if doKeyStatus === 'cleared'}
            <p class="text-xs text-gray-400 mt-1.5">{$_('settings.doKeyCleared')}</p>
          {:else if doKeyStatus === 'saved' || (doKeyStatus && doKeyStatus !== 'cleared' && !doKeyStatus.startsWith('Error'))}
            <p class="text-xs text-green-400 mt-1.5">{doKeyStatus === 'saved' ? $_('settings.doKeySavedCheck') : doKeyStatus}</p>
          {:else if doKeyStatus}
            <p class="text-xs text-red-400 mt-1.5">{doKeyStatus}</p>
          {/if}
        </div>
      </div>
    </section>

    <!-- ── ClickSend SMS ─────────────────────────────────────────────────── -->
    <section>
      <h2 class="text-base font-semibold text-white mb-1">{$_('settings.csSection')}</h2>
      <p class="text-sm text-gray-400 mb-6">{$_('settings.csSectionDesc')}</p>

      <div class="bg-gray-800/40 border border-gray-700/60 rounded-2xl p-5 space-y-4">
        <p class="text-xs text-gray-500">
          {$_('settings.csSignUpLead')}
          <a href="https://clicksend.com/?u=647542" target="_blank" rel="noopener noreferrer"
            class="text-indigo-400 hover:text-indigo-300">{$_('settings.csSignUp')}</a>.
        </p>

        {#if csHasCreds}
          <div class="flex items-center gap-3 bg-green-900/20 border border-green-800/40 rounded-xl px-4 py-3">
            <span class="text-green-400 text-sm">{$_('settings.csConfigured')}</span>
            <button type="button" onclick={clearClickSend}
              class="ml-auto text-xs text-red-400 hover:text-red-300 transition">
              {$_('settings.clearCs')}
            </button>
          </div>
        {/if}

        <div>
          <label class="block text-xs font-medium text-gray-400 mb-1.5">{$_('settings.csUsername')}</label>
          <input type="password" bind:value={csUsername} autocomplete="off"
            class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm
                   focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-400 mb-1.5">{$_('settings.csApiKey')}</label>
          <input type="password" bind:value={csApiKey} placeholder="••••••••" autocomplete="off"
            class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm
                   focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono" />
          <p class="text-[11px] text-gray-600 mt-1">{$_('settings.csApiKeyHint')}</p>
        </div>

        <div class="border-t border-gray-700/40 pt-4 space-y-2">
          <p class="text-sm font-medium text-gray-300 mb-2">{$_('settings.csEvents')}</p>
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" bind:checked={csOnSuccess} onchange={saveClickSendNotifications}
              class="rounded bg-gray-700 border-gray-600 text-indigo-600" />
            <span class="text-sm text-gray-300">{$_('settings.csOnSuccess')}</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" bind:checked={csOnFailure} onchange={saveClickSendNotifications}
              class="rounded bg-gray-700 border-gray-600 text-indigo-600" />
            <span class="text-sm text-gray-300">{$_('settings.csOnFailure')}</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" bind:checked={csOnRollback} onchange={saveClickSendNotifications}
              class="rounded bg-gray-700 border-gray-600 text-indigo-600" />
            <span class="text-sm text-gray-300">{$_('settings.csOnRollback')}</span>
          </label>
        </div>

        <div class="flex flex-wrap items-center gap-2 pt-2">
          <button type="button" onclick={saveClickSend}
            disabled={savingCs || !csUsername.trim() || (!csHasCreds && !csApiKey.trim())}
            class="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg
                   disabled:opacity-40 disabled:cursor-not-allowed">
            {savingCs ? $_('settings.savingCs') : $_('settings.saveCs')}
          </button>
          <button type="button" onclick={testClickSend}
            disabled={testingCs || !csHasCreds}
            class="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded-lg border border-gray-600
                   disabled:opacity-40 disabled:cursor-not-allowed">
            {testingCs ? $_('settings.csTesting') : $_('settings.csTest')}
          </button>
        </div>
        <p class="text-xs text-gray-500">{$_('settings.csTestHint')}</p>

        {#if csStatus === 'notifications'}
          <p class="text-xs text-green-400 mt-2">{$_('settings.csNotificationsSaved')}</p>
        {:else if csStatus === 'saved'}
          <p class="text-xs text-green-400">{$_('settings.csSaved')}</p>
        {:else if csStatus === 'cleared'}
          <p class="text-xs text-gray-400">{$_('settings.csCleared')}</p>
        {:else if csStatus}
          <p class="text-xs text-red-400">{csStatus}</p>
        {/if}
        {#if testCsStatus}
          <p class="text-xs {testCsOk ? 'text-green-400' : 'text-red-400'}">{testCsStatus}</p>
        {/if}
      </div>
    </section>

  </main>
</div>
