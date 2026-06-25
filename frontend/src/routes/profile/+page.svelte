<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import LanguageSelector from '$lib/components/LanguageSelector.svelte';
  import AboutModal from '$lib/components/AboutModal.svelte';
  import { _, locale } from 'svelte-i18n';
  import { get } from 'svelte/store';

  let aboutOpen = $state(false);

  // ── Contact details ───────────────────────────────────────────────────────
  let username    = $state('');
  let email       = $state('');
  let mobile      = $state('');
  let dialingCode = $state('+44');
  let savingInfo  = $state(false);
  let infoStatus  = $state('');   // '' | 'saved' | error string

  // ── Password change ───────────────────────────────────────────────────────
  let currentPassword  = $state('');
  let newPassword      = $state('');
  let confirmPassword  = $state('');
  let savingPassword   = $state(false);
  let passwordStatus   = $state('');   // '' | 'saved' | error string

  const DIALING_CODES = [
    { code: '+1',   label: '🇺🇸🇨🇦 +1 (US/CA)' },
    { code: '+7',   label: '🇷🇺 +7 (RU)' },
    { code: '+20',  label: '🇪🇬 +20 (EG)' },
    { code: '+27',  label: '🇿🇦 +27 (ZA)' },
    { code: '+30',  label: '🇬🇷 +30 (GR)' },
    { code: '+31',  label: '🇳🇱 +31 (NL)' },
    { code: '+32',  label: '🇧🇪 +32 (BE)' },
    { code: '+33',  label: '🇫🇷 +33 (FR)' },
    { code: '+34',  label: '🇪🇸 +34 (ES)' },
    { code: '+36',  label: '🇭🇺 +36 (HU)' },
    { code: '+39',  label: '🇮🇹 +39 (IT)' },
    { code: '+40',  label: '🇷🇴 +40 (RO)' },
    { code: '+41',  label: '🇨🇭 +41 (CH)' },
    { code: '+43',  label: '🇦🇹 +43 (AT)' },
    { code: '+44',  label: '🇬🇧 +44 (GB)' },
    { code: '+45',  label: '🇩🇰 +45 (DK)' },
    { code: '+46',  label: '🇸🇪 +46 (SE)' },
    { code: '+47',  label: '🇳🇴 +47 (NO)' },
    { code: '+48',  label: '🇵🇱 +48 (PL)' },
    { code: '+49',  label: '🇩🇪 +49 (DE)' },
    { code: '+51',  label: '🇵🇪 +51 (PE)' },
    { code: '+52',  label: '🇲🇽 +52 (MX)' },
    { code: '+54',  label: '🇦🇷 +54 (AR)' },
    { code: '+55',  label: '🇧🇷 +55 (BR)' },
    { code: '+56',  label: '🇨🇱 +56 (CL)' },
    { code: '+57',  label: '🇨🇴 +57 (CO)' },
    { code: '+60',  label: '🇲🇾 +60 (MY)' },
    { code: '+61',  label: '🇦🇺 +61 (AU)' },
    { code: '+62',  label: '🇮🇩 +62 (ID)' },
    { code: '+63',  label: '🇵🇭 +63 (PH)' },
    { code: '+64',  label: '🇳🇿 +64 (NZ)' },
    { code: '+65',  label: '🇸🇬 +65 (SG)' },
    { code: '+66',  label: '🇹🇭 +66 (TH)' },
    { code: '+81',  label: '🇯🇵 +81 (JP)' },
    { code: '+82',  label: '🇰🇷 +82 (KR)' },
    { code: '+84',  label: '🇻🇳 +84 (VN)' },
    { code: '+86',  label: '🇨🇳 +86 (CN)' },
    { code: '+90',  label: '🇹🇷 +90 (TR)' },
    { code: '+91',  label: '🇮🇳 +91 (IN)' },
    { code: '+92',  label: '🇵🇰 +92 (PK)' },
    { code: '+93',  label: '🇦🇫 +93 (AF)' },
    { code: '+94',  label: '🇱🇰 +94 (LK)' },
    { code: '+98',  label: '🇮🇷 +98 (IR)' },
    { code: '+212', label: '🇲🇦 +212 (MA)' },
    { code: '+213', label: '🇩🇿 +213 (DZ)' },
    { code: '+216', label: '🇹🇳 +216 (TN)' },
    { code: '+218', label: '🇱🇾 +218 (LY)' },
    { code: '+220', label: '🇬🇲 +220 (GM)' },
    { code: '+221', label: '🇸🇳 +221 (SN)' },
    { code: '+234', label: '🇳🇬 +234 (NG)' },
    { code: '+254', label: '🇰🇪 +254 (KE)' },
    { code: '+255', label: '🇹🇿 +255 (TZ)' },
    { code: '+256', label: '🇺🇬 +256 (UG)' },
    { code: '+260', label: '🇿🇲 +260 (ZM)' },
    { code: '+263', label: '🇿🇼 +263 (ZW)' },
    { code: '+351', label: '🇵🇹 +351 (PT)' },
    { code: '+352', label: '🇱🇺 +352 (LU)' },
    { code: '+353', label: '🇮🇪 +353 (IE)' },
    { code: '+354', label: '🇮🇸 +354 (IS)' },
    { code: '+358', label: '🇫🇮 +358 (FI)' },
    { code: '+370', label: '🇱🇹 +370 (LT)' },
    { code: '+371', label: '🇱🇻 +371 (LV)' },
    { code: '+372', label: '🇪🇪 +372 (EE)' },
    { code: '+380', label: '🇺🇦 +380 (UA)' },
    { code: '+381', label: '🇷🇸 +381 (RS)' },
    { code: '+385', label: '🇭🇷 +385 (HR)' },
    { code: '+386', label: '🇸🇮 +386 (SI)' },
    { code: '+420', label: '🇨🇿 +420 (CZ)' },
    { code: '+421', label: '🇸🇰 +421 (SK)' },
    { code: '+966', label: '🇸🇦 +966 (SA)' },
    { code: '+971', label: '🇦🇪 +971 (AE)' },
    { code: '+972', label: '🇮🇱 +972 (IL)' },
    { code: '+974', label: '🇶🇦 +974 (QA)' },
  ];

  onMount(async () => {
    try {
      const p = await api.get('/api/auth/profile');
      username    = p.username    || '';
      email       = p.email       || '';
      mobile      = p.mobile      || '';
      dialingCode = p.dialingCode || '+44';
    } catch { /* ignore */ }
  });

  async function saveInfo() {
    savingInfo = true;
    infoStatus = '';
    try {
      await api.post('/api/auth/profile', { email, mobile, dialingCode, locale: get(locale) });
      infoStatus = 'saved';
    } catch (err) {
      infoStatus = err.message || $_('profile.errorGeneric');
    } finally {
      savingInfo = false;
    }
  }

  async function changePassword() {
    passwordStatus = '';
    if (!currentPassword || !newPassword || !confirmPassword) {
      passwordStatus = $_('profile.password.errorAllRequired');
      return;
    }
    if (newPassword !== confirmPassword) {
      passwordStatus = $_('profile.password.errorMatch');
      return;
    }
    if (newPassword.length < 8) {
      passwordStatus = $_('profile.password.errorShort');
      return;
    }
    savingPassword = true;
    try {
      await api.post('/api/auth/change-password', { currentPassword, newPassword });
      passwordStatus  = 'saved';
      currentPassword = '';
      newPassword     = '';
      confirmPassword = '';
    } catch (err) {
      passwordStatus = err.message || $_('profile.errorGeneric');
    } finally {
      savingPassword = false;
    }
  }
</script>

<svelte:head>
  <title>{$_('profile.pageTitle')} — WDP</title>
</svelte:head>

<div class="min-h-screen bg-gray-950 text-white flex flex-col pb-10">
  <header class="border-b border-gray-800 px-4 py-4">
    <div class="max-w-5xl mx-auto flex items-center justify-between">
      <div class="flex items-center gap-2 text-sm">
        <a href="/dashboard" class="text-gray-400 hover:text-white transition">{$_('nav.backToDashboard')}</a>
        <span class="text-gray-700">/</span>
        <h1 class="text-white font-semibold tracking-tight">{$_('profile.pageTitle')}</h1>
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

    <!-- ── Account details ────────────────────────────────────────────────── -->
    <section>
      <h2 class="text-base font-semibold text-white mb-1">{$_('profile.detailsSection')}</h2>
      <p class="text-sm text-gray-400 mb-6">{$_('profile.detailsSubtitle')}</p>

      <div class="bg-gray-800/40 border border-gray-700/60 rounded-2xl p-5 space-y-4">

        <!-- Username (read-only) -->
        <div>
          <label class="block text-xs font-medium text-gray-400 mb-1.5">{$_('profile.username')}</label>
          <div class="flex items-center bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-2.5">
            <span class="text-white text-sm">{username}</span>
            <span class="ml-auto text-[10px] text-gray-600 uppercase tracking-wider">{$_('profile.usernameReadOnly')}</span>
          </div>
        </div>

        <!-- Email -->
        <div>
          <label for="email" class="block text-xs font-medium text-gray-400 mb-1.5">{$_('profile.email')}</label>
          <input
            id="email"
            type="email"
            bind:value={email}
            placeholder={$_('profile.emailPlaceholder')}
            autocomplete="email"
            class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                   placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <!-- Mobile -->
        <div>
          <label class="block text-xs font-medium text-gray-400 mb-1.5">{$_('profile.mobile')}</label>
          <div class="flex gap-2">
            <select
              bind:value={dialingCode}
              class="bg-gray-800 border border-gray-700 rounded-lg px-2 py-2.5 text-white text-sm
                     focus:outline-none focus:ring-2 focus:ring-indigo-500 shrink-0 w-44"
            >
              {#each DIALING_CODES as d}
                <option value={d.code}>{d.label}</option>
              {/each}
            </select>
            <input
              type="tel"
              bind:value={mobile}
              placeholder={$_('profile.mobilePlaceholder')}
              autocomplete="tel-national"
              class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                     placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        <!-- Save -->
        <div class="flex items-center gap-3 pt-1">
          <button
            type="button"
            onclick={saveInfo}
            disabled={savingInfo}
            class="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg
                   transition disabled:opacity-40 disabled:cursor-not-allowed"
          >{savingInfo ? $_('profile.saving') : $_('profile.saveDetails')}</button>
          {#if infoStatus === 'saved'}
            <span class="text-sm text-green-400">{$_('profile.saved')}</span>
          {:else if infoStatus}
            <span class="text-sm text-red-400">{infoStatus}</span>
          {/if}
        </div>
      </div>
    </section>

    <!-- ── Change password ────────────────────────────────────────────────── -->
    <section>
      <h2 class="text-base font-semibold text-white mb-1">{$_('profile.passwordSection')}</h2>
      <p class="text-sm text-gray-400 mb-6">{$_('profile.passwordSubtitle')}</p>

      <div class="bg-gray-800/40 border border-gray-700/60 rounded-2xl p-5 space-y-4">

        <div>
          <label for="currentPassword" class="block text-xs font-medium text-gray-400 mb-1.5">{$_('profile.password.current')}</label>
          <input
            id="currentPassword"
            type="password"
            bind:value={currentPassword}
            autocomplete="current-password"
            class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                   placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label for="newPassword" class="block text-xs font-medium text-gray-400 mb-1.5">{$_('profile.password.new')}</label>
          <input
            id="newPassword"
            type="password"
            bind:value={newPassword}
            autocomplete="new-password"
            class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                   placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label for="confirmPassword" class="block text-xs font-medium text-gray-400 mb-1.5">{$_('profile.password.confirm')}</label>
          <input
            id="confirmPassword"
            type="password"
            bind:value={confirmPassword}
            autocomplete="new-password"
            class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                   placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div class="flex items-center gap-3 pt-1">
          <button
            type="button"
            onclick={changePassword}
            disabled={savingPassword}
            class="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg
                   transition disabled:opacity-40 disabled:cursor-not-allowed"
          >{savingPassword ? $_('profile.saving') : $_('profile.password.change')}</button>
          {#if passwordStatus === 'saved'}
            <span class="text-sm text-green-400">{$_('profile.password.changed')}</span>
          {:else if passwordStatus}
            <span class="text-sm text-red-400">{passwordStatus}</span>
          {/if}
        </div>
      </div>
    </section>

  </main>
</div>
