<script>
  import { get } from 'svelte/store';
  import { wizardStore } from '$lib/wizardStore.js';
  import { stepValid } from '$lib/stepValid.js';
  import Tooltip from '$lib/components/Tooltip.svelte';
  import PasswordInput from '$lib/components/PasswordInput.svelte';
  import ProductLearnMore from '$lib/components/ProductLearnMore.svelte';
  import { ADDON_LINKS } from '$lib/productLinks.js';
  import { _ } from 'svelte-i18n';

  // Default config per add-on
  const DEFAULTS = {
    traefik:    { enabled: false, traefikMode: 'bundled', domain: '', acmeEmail: '', includeWww: true, network: 'traefik-public', certResolver: 'leresolver', dashboard: false, challengeType: 'http' },
    redis:      { enabled: false, redisMode: 'managed', password: '', host: '', network: '', db: 0, port: 6379, maxMemory: '', evictionPolicy: 'allkeys-lru', managedConfirm: false },
    minio:      { enabled: false, rootUser: '', rootPassword: '', defaultBucket: 'uploads', apiPort: 9000, consolePort: 9001 },
    portainer:  { enabled: false, port: 9000, agentPort: 9001 },
    kuma:       { enabled: false, port: 3001 },
    plausible:  { enabled: false, domain: '', adminEmail: '', adminPassword: '', secretKeyBase: '', port: 8000 },
    mailpit:    { enabled: false, smtpPort: 1025, uiPort: 8025 },
    n8n:        { enabled: false, adminEmail: '', adminPassword: '', encryptionKey: '', port: 5678, webhookUrl: '' },
    restic:     { enabled: false, repoPath: '', repoPassword: '', schedule: '0 2 * * *', backupUploads: true, backupDb: true, retainDaily: 7, retainWeekly: 4, retainMonthly: 3 },
    apprise:    { enabled: false, notifyUrl: '', onSuccess: true, onFailure: true, onRollback: true }
  };

  const hostingTarget = get(wizardStore).step4?.hostingTarget || '';
  const isLocal = hostingTarget === 'local';
  const step4 = get(wizardStore).step4 || {};

  let redisProbe = null;
  let redisProbing = false;
  let redisProbeError = '';

  const stored = get(wizardStore).step5.addons || {};
  let addons = Object.fromEntries(
    Object.entries(DEFAULTS).map(([k, v]) => [k, { ...v, ...(stored[k] || {}) }])
  );

  const ADDON_LIST = [
    { key: 'traefik',   label: 'Traefik',                icon: '🔀', desc: 'Reverse proxy + automatic Let\'s Encrypt SSL',
      localNote: 'Let\'s Encrypt (ACME) requires a public domain and cannot run locally. Traefik will be configured for HTTP-only routing.' },
    { key: 'redis',     label: 'Redis',                  icon: '⚡', desc: 'Session store / caching' },
    { key: 'minio',     label: 'MinIO',                  icon: '🪣', desc: 'S3-compatible self-hosted object storage for uploads' },
    { key: 'portainer', label: 'Portainer CE',           icon: '🐳', desc: 'Docker container management UI' },
    { key: 'kuma',      label: 'Uptime Kuma',            icon: '📊', desc: 'Lightweight self-hosted uptime monitoring',
      localNote: 'Uptime Kuma monitors public URLs and services — it will run locally but cannot check external URLs unless you have internet access from this machine.' },
    { key: 'plausible', label: 'Plausible CE (self-hosted)', icon: '📈',
      localNote: 'Plausible collects data from site visitors. Running it locally means your app must also be publicly accessible for real visitor analytics.' },
    { key: 'mailpit',   label: 'Mailpit',                icon: '✉️', desc: 'Local email testing (dev / staging only)' },
    { key: 'n8n',       label: 'n8n',                    icon: '🔄', desc: 'Open-source workflow automation',
      localNote: 'Webhook triggers in n8n require a publicly accessible URL. Webhooks will not receive external traffic on a local deployment.' },
    { key: 'restic',    label: 'Restic + REST backend',  icon: '💾', desc: 'Scheduled encrypted backups' },
    { key: 'apprise',   label: 'Apprise / Webhook',      icon: '🔔', desc: 'Deploy notifications to Discord, Slack, Telegram, etc.' }
  ];

  function validateAddons(a) {
    for (const [key, cfg] of Object.entries(a)) {
      if (!cfg.enabled) continue;
      switch (key) {
        // Traefik: ACME email only required when not local (local uses HTTP-only Traefik)
        case 'traefik': {
          if (!isLocal && !cfg.domain) return false;
          const mode = cfg.traefikMode || 'bundled';
          if (!isLocal && mode === 'bundled' && !cfg.acmeEmail) return false;
          if (!isLocal && mode === 'external' && !String(cfg.network || '').trim()) return false;
          break;
        }
        case 'redis': {
          const mode = cfg.redisMode || 'managed';
          if (mode === 'managed') {
            if (!cfg.password || !cfg.managedConfirm) return false;
          } else if (mode === 'existing' || mode === 'external') {
            if (!String(cfg.host || '').trim()) return false;
          }
          break;
        }
        case 'minio':     if (!cfg.rootUser || !cfg.rootPassword)     return false; break;
        case 'plausible': if (!cfg.domain || !cfg.adminEmail || !cfg.adminPassword) return false; break;
        case 'n8n':       if (!cfg.adminEmail || !cfg.adminPassword)  return false; break;
        case 'restic':    if (!cfg.repoPath || !cfg.repoPassword)     return false; break;
        case 'apprise':   if (!cfg.notifyUrl)                         return false; break;
      }
    }
    return true;
  }

  $: isValid = validateAddons(addons);
  $: {
    stepValid.set(isValid);
    wizardStore.setStep(5, { addons });
  }

  function toggle(key) {
    addons[key].enabled = !addons[key].enabled;
    addons = { ...addons };
  }

  function normalizeDomainInput(value) {
    if (typeof value !== 'string') return value;
    return value
      .trim()
      .replace(/^https?:\/\//i, '')
      .split('/')[0]
      .split('?')[0]
      .replace(/:\d+$/, '')
      .trim();
  }

  function update(key, field, value) {
    if (field === 'domain') value = normalizeDomainInput(value);
    addons[key][field] = value;
    if (key === 'redis' && field === 'redisMode') {
      if (value === 'managed') addons.redis.managedConfirm = false;
    }
    addons = { ...addons };
  }

  function pickRedisNetwork(networksStr) {
    const nets = String(networksStr || '').split(/\s+/).filter(Boolean);
    if (!nets.length) return '';
    const nonBridge = nets.filter((n) => n !== 'bridge');
    return nonBridge[0] || nets[0] || '';
  }

  function useExistingRedisContainer(container) {
    const net = pickRedisNetwork(container.networks);
    addons.redis = {
      ...addons.redis,
      redisMode: 'existing',
      host: container.name,
      ...(net ? { network: net } : {}),
    };
    addons = { ...addons };
  }

  async function probeRedisOnServer() {
    redisProbeError = '';
    redisProbe = null;
    if (isLocal) {
      redisProbeError = 'Server scan is available for remote SSH targets only.';
      return;
    }
    const host = step4.sshHost;
    const keyPath = step4.sshKeyPath;
    if (!host || !keyPath) {
      redisProbeError = 'Complete Step 4 (SSH host and key) before scanning the server.';
      return;
    }
    redisProbing = true;
    try {
      const res = await fetch('/api/config/probe-redis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sshHost: host,
          sshUser: step4.sshUser || 'root',
          sshKeyPath: keyPath,
          sshPort: step4.sshPort,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Probe failed');
      redisProbe = data;
    } catch (err) {
      redisProbeError = err.message || 'Could not scan server';
    } finally {
      redisProbing = false;
    }
  }
</script>

<h2 class="text-xl font-semibold text-white mb-1">{$_('wizard.step5.title')}</h2>
<p class="text-gray-400 text-sm mb-2">
  {$_('wizard.step5.subtitle')}
</p>
<p class="text-gray-500 text-xs mb-8">
  {$_('wizard.step5.requiredNote')}
</p>

{#if isLocal}
  <div class="mb-6 flex items-start gap-3 bg-amber-900/20 border border-amber-700/40 rounded-xl px-4 py-3.5">
    <span class="text-amber-400 text-base shrink-0 mt-0.5">⚠</span>
    <div class="text-xs text-amber-300 space-y-1">
      <p class="font-semibold text-amber-200">{$_('wizard.step5.localWarningTitle')}</p>
      <p>{$_('wizard.step5.localWarningDesc')}</p>
    </div>
  </div>
{/if}

<div class="space-y-3">
  {#each ADDON_LIST as addon}
    {@const cfg = addons[addon.key]}
    <div class="border rounded-xl transition-colors
      {cfg.enabled ? 'border-indigo-600/50 bg-indigo-950/20' : 'border-gray-700 bg-gray-800/30'}">

      <!-- Toggle row -->
      <div class="flex items-center gap-3 px-4 py-3.5">
        <button
          type="button"
          onclick={() => toggle(addon.key)}
          class="relative w-10 h-5.5 rounded-full transition-colors shrink-0 focus:outline-none
                 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-950
                 {cfg.enabled ? 'bg-indigo-600' : 'bg-gray-700'}"
          aria-pressed={cfg.enabled}
          style="height: 22px;"
        >
          <span class="absolute top-0.5 left-0.5 w-4.5 h-4.5 rounded-full bg-white transition-transform
                       {cfg.enabled ? 'translate-x-4' : 'translate-x-0'}"
                style="width: 18px; height: 18px;"></span>
        </button>
        <span class="text-lg leading-none">{addon.icon}</span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <p class="text-sm font-medium text-white">{addon.label}</p>
            <ProductLearnMore href={ADDON_LINKS[addon.key]} />
          </div>
          <p class="text-xs text-gray-400 mt-0.5">{$_('wizard.step5.addonDesc.' + addon.key)}</p>
        </div>
        {#if isLocal && addon.localNote}
          <span class="shrink-0 text-xs bg-amber-900/40 text-amber-400 px-2 py-0.5 rounded-full">{$_('wizard.step5.localLimit')}</span>
        {/if}
      </div>

      <!-- Accordion config panel -->
      {#if cfg.enabled}
        <div class="border-t border-gray-700/60 px-4 py-4 space-y-4">

          {#if addon.key === 'traefik'}
            {@const traefikMode = cfg.traefikMode || 'bundled'}
            {@const traefikExternal = !isLocal && traefikMode === 'external'}

            {#if !isLocal}
              <div class="space-y-2">
                <p class="text-xs font-medium text-gray-400">{$_('wizard.step5.traefikModeLabel')}</p>
                <div class="grid gap-2 sm:grid-cols-2">
                  <label class="flex items-start gap-2.5 cursor-pointer rounded-lg border px-3 py-2.5 transition-colors
                    {traefikMode === 'bundled' ? 'border-indigo-600/60 bg-indigo-950/30' : 'border-gray-700 bg-gray-800/40'}">
                    <input
                      type="radio"
                      name="traefik-mode"
                      value="bundled"
                      checked={traefikMode === 'bundled'}
                      onchange={() => update('traefik', 'traefikMode', 'bundled')}
                      class="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span class="min-w-0">
                      <span class="block text-sm font-medium text-white">{$_('wizard.step5.traefikModeBundled')}</span>
                      <span class="block text-xs text-gray-500 mt-0.5">{$_('wizard.step5.traefikModeBundledHint')}</span>
                    </span>
                  </label>
                  <label class="flex items-start gap-2.5 cursor-pointer rounded-lg border px-3 py-2.5 transition-colors
                    {traefikExternal ? 'border-indigo-600/60 bg-indigo-950/30' : 'border-gray-700 bg-gray-800/40'}">
                    <input
                      type="radio"
                      name="traefik-mode"
                      value="external"
                      checked={traefikExternal}
                      onchange={() => update('traefik', 'traefikMode', 'external')}
                      class="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span class="min-w-0">
                      <span class="block text-sm font-medium text-white">{$_('wizard.step5.traefikModeExternal')}</span>
                      <span class="block text-xs text-gray-500 mt-0.5">{$_('wizard.step5.traefikModeExternalHint')}</span>
                    </span>
                  </label>
                </div>
              </div>
              {#if traefikExternal}
                <div class="flex items-start gap-2 bg-blue-900/20 border border-blue-700/40 rounded-lg px-3 py-3">
                  <span class="text-blue-400 shrink-0 mt-0.5" aria-hidden="true">ℹ</span>
                  <p class="text-xs text-blue-100/90 leading-relaxed">{$_('wizard.step5.traefikExternalNote')}</p>
                </div>
              {/if}
            {/if}

            <!-- Local Docker: ACME not available -->
            {#if isLocal}
              <div class="flex items-start gap-2 bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2.5">
                <span class="text-amber-400 shrink-0 mt-0.5">⚠</span>
              <p class="text-xs text-amber-300">{$_('wizard.step5.traefikLocalNote')}</p>
              </div>
            {:else}
              <div class="grid gap-4 sm:grid-cols-2">
                <div class="{traefikExternal ? 'sm:col-span-2' : ''}">
                  <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                    {$_('wizard.step5.domain')} <span class="text-red-400 ml-0.5">*</span>
                    <Tooltip title={$_('wizard.step5.tooltip.domain.title')} body={$_('wizard.step5.tooltip.domain.body')} defaultHint={$_('wizard.step5.tooltip.domain.defaultHint')} gotcha={$_('wizard.step5.tooltip.domain.gotcha')} />
                  </label>
                  <input type="text" value={cfg.domain} oninput={(e) => update('traefik', 'domain', e.target.value)}
                    placeholder="app.example.com"
                    class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                           placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                {#if !traefikExternal}
                <div>
                  <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                    {$_('wizard.step5.acmeEmail')} <span class="text-red-400 ml-0.5">*</span>
                    <Tooltip title={$_('wizard.step5.tooltip.acmeEmail.title')} body={$_('wizard.step5.tooltip.acmeEmail.body')} />
                  </label>
                  <input type="email" value={cfg.acmeEmail} oninput={(e) => update('traefik', 'acmeEmail', e.target.value)}
                    placeholder="ops@example.com"
                    class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                           placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                {/if}
                <div class="sm:col-span-2">
                  <label class="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cfg.includeWww !== false}
                      onchange={(e) => update('traefik', 'includeWww', e.target.checked)}
                      class="w-4 h-4 rounded bg-gray-700 border-gray-600 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span class="text-sm text-gray-300">{$_('wizard.step5.traefikIncludeWww')}</span>
                    <Tooltip
                      title={$_('wizard.step5.tooltip.traefikIncludeWww.title')}
                      body={$_('wizard.step5.tooltip.traefikIncludeWww.body')}
                      defaultHint={$_('wizard.step5.tooltip.traefikIncludeWww.defaultHint')}
                    />
                  </label>
                </div>
                {#if !traefikExternal}
                <div class="sm:col-span-2 flex items-start gap-2 bg-blue-900/20 border border-blue-700/40 rounded-lg px-3 py-3">
                  <span class="text-blue-400 shrink-0 mt-0.5" aria-hidden="true">ℹ</span>
                  <div class="min-w-0">
                    <p class="text-sm font-medium text-blue-200 mb-1">{$_('wizard.step5.dnsRegistrarTitle')}</p>
                    <div class="text-xs text-blue-100/90 leading-relaxed [&_code]:text-blue-200 [&_code]:bg-blue-950/50 [&_code]:px-1 [&_code]:rounded">
                      {@html $_('wizard.step5.dnsRegistrarBody')}
                    </div>
                  </div>
                </div>
                {/if}
              </div>
            {/if}
            <div class="grid gap-4 sm:grid-cols-2">
              <div>
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step5.dockerNetwork')}
                  {#if traefikExternal}<span class="text-red-400 ml-0.5">*</span>{/if}
                  <Tooltip
                    title={$_('wizard.step5.tooltip.traefikNetwork.title')}
                    body={traefikExternal ? $_('wizard.step5.tooltip.traefikNetworkExternal.body') : $_('wizard.step5.tooltip.traefikNetwork.body')}
                    defaultHint={$_('wizard.step5.tooltip.traefikNetwork.defaultHint')}
                  />
                </label>
                <input type="text" value={cfg.network} oninput={(e) => update('traefik', 'network', e.target.value)}
                  placeholder={traefikExternal ? 'traefik-public' : 'traefik-public'}
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                         text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step5.certResolver')}
                  <Tooltip title={$_('wizard.step5.tooltip.certResolver.title')} body={$_('wizard.step5.tooltip.certResolver.body')} defaultHint={$_('wizard.step5.tooltip.certResolver.defaultHint')} />
                </label>
                <input type="text" value={cfg.certResolver} oninput={(e) => update('traefik', 'certResolver', e.target.value)}
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                         text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>
            {#if !traefikExternal}
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={cfg.dashboard}
                onchange={(e) => update('traefik', 'dashboard', e.target.checked)}
                class="w-4 h-4 rounded bg-gray-700 border-gray-600 text-indigo-600 focus:ring-indigo-500" />
              <span class="text-sm text-gray-300">{$_('wizard.step5.traefikDashboard')}</span>
              <Tooltip title={$_('wizard.step5.tooltip.traefikDashboard.title')} body={$_('wizard.step5.tooltip.traefikDashboard.body')} gotcha={$_('wizard.step5.tooltip.traefikDashboard.gotcha')} />
            </label>
            {/if}

          {:else if addon.key === 'redis'}
            {@const redisMode = cfg.redisMode || 'managed'}
            <div class="flex items-start gap-2 bg-blue-900/20 border border-blue-700/40 rounded-lg px-3 py-3 mb-2">
              <span class="text-blue-400 shrink-0 mt-0.5" aria-hidden="true">ℹ</span>
              <p class="text-xs text-blue-100/90 leading-relaxed">
                {$_('wizard.step5.redisWapplerNote')}
                <a href="/help?doc=redis-in-production" class="text-blue-300 hover:underline whitespace-nowrap ml-1">{$_('wizard.step5.redisHelpLink')}</a>
              </p>
            </div>

            <div class="space-y-2 mb-4">
              <p class="text-xs font-medium text-gray-400">{$_('wizard.step5.redisModeLabel')}</p>
              <div class="grid gap-2 sm:grid-cols-2">
                {#each [
                  { value: 'managed', label: 'wizard.step5.redisModeManaged', hint: 'wizard.step5.redisModeManagedHint' },
                  { value: 'existing', label: 'wizard.step5.redisModeExisting', hint: 'wizard.step5.redisModeExistingHint' },
                  { value: 'external', label: 'wizard.step5.redisModeExternal', hint: 'wizard.step5.redisModeExternalHint' },
                ] as opt}
                  <label class="flex items-start gap-2.5 cursor-pointer rounded-lg border px-3 py-2.5 transition-colors
                    {redisMode === opt.value ? 'border-indigo-600/60 bg-indigo-950/30' : 'border-gray-700 bg-gray-800/40'}">
                    <input
                      type="radio"
                      name="redis-mode"
                      value={opt.value}
                      checked={redisMode === opt.value}
                      onchange={() => update('redis', 'redisMode', opt.value)}
                      class="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span class="min-w-0">
                      <span class="block text-sm font-medium text-white">{$_(opt.label)}</span>
                      <span class="block text-xs text-gray-500 mt-0.5">{$_(opt.hint)}</span>
                    </span>
                  </label>
                {/each}
              </div>
            </div>

            {#if redisMode === 'managed'}
              <div class="flex items-start gap-2 bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-3 mb-4">
                <span class="text-amber-400 shrink-0 mt-0.5">⚠</span>
                <div class="min-w-0">
                  <p class="text-xs text-amber-100/90 leading-relaxed mb-2">{$_('wizard.step5.redisManagedWarning')}</p>
                  <label class="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cfg.managedConfirm}
                      onchange={(e) => update('redis', 'managedConfirm', e.target.checked)}
                      class="mt-0.5 w-4 h-4 rounded bg-gray-700 border-gray-600 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span class="text-xs text-amber-100/90">{$_('wizard.step5.redisManagedAck')}</span>
                  </label>
                </div>
              </div>
            {/if}

            {#if redisMode === 'existing' && !isLocal}
              <div class="mb-4 space-y-3">
                <div class="flex items-start gap-2">
                  <button
                    type="button"
                    onclick={probeRedisOnServer}
                    disabled={redisProbing}
                    class="text-xs px-3 py-1.5 rounded-lg border border-gray-600 text-gray-200 hover:bg-gray-700/50 disabled:opacity-50 shrink-0"
                  >
                    {redisProbing ? $_('wizard.step5.redisScanning') : $_('wizard.step5.redisScanServer')}
                  </button>
                  {#if redisProbe && !redisProbe.found}
                    <span class="text-xs text-gray-400 pt-1">{$_('wizard.step5.redisScanNone')}</span>
                  {/if}
                  {#if redisProbeError}
                    <span class="text-xs text-red-400 pt-1">{redisProbeError}</span>
                  {/if}
                </div>

                {#if redisProbe?.found}
                  <div class="space-y-2">
                    <p class="text-xs font-medium text-gray-400">{$_('wizard.step5.redisScanFoundTitle')}</p>
                    {#each redisProbe.containers as c}
                      <div class="flex items-start justify-between gap-3 rounded-lg border border-gray-700/80 bg-gray-800/40 px-3 py-2.5">
                        <div class="min-w-0">
                          <p class="text-sm font-medium text-white truncate">{c.name}</p>
                          <p class="text-xs text-gray-500 truncate">{c.image} · {c.status}</p>
                          {#if c.networks}
                            <p class="text-xs text-gray-500 mt-0.5">
                              {$_('wizard.step5.redisScanNetworks', { values: { networks: c.networks } })}
                            </p>
                          {/if}
                        </div>
                        <button
                          type="button"
                          onclick={() => useExistingRedisContainer(c)}
                          class="shrink-0 text-xs px-2.5 py-1.5 rounded-md border border-indigo-600/50 bg-indigo-950/40 text-indigo-200 hover:bg-indigo-900/50 transition"
                        >
                          {$_('wizard.step5.redisScanUse')}
                        </button>
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}

            <div class="grid gap-4 sm:grid-cols-2">
              {#if redisMode === 'existing' || redisMode === 'external'}
                <div class="sm:col-span-2">
                  <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                    {$_('wizard.step5.redisHost')} <span class="text-red-400 ml-0.5">*</span>
                    <Tooltip title={$_('wizard.step5.tooltip.redisHost.title')} body={$_('wizard.step5.tooltip.redisHost.body')} defaultHint={$_('wizard.step5.tooltip.redisHost.defaultHint')} />
                  </label>
                  <input type="text" value={cfg.host} oninput={(e) => update('redis', 'host', e.target.value)}
                    placeholder={redisMode === 'existing' ? 'myproject-redis-1' : 'redis.example.com'}
                    class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                           placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              {/if}
              {#if redisMode === 'existing'}
                <div class="sm:col-span-2">
                  <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                    {$_('wizard.step5.redisDockerNetwork')}
                    <Tooltip title={$_('wizard.step5.tooltip.redisNetwork.title')} body={$_('wizard.step5.tooltip.redisNetwork.body')} defaultHint={$_('wizard.step5.tooltip.redisNetwork.defaultHint')} />
                  </label>
                  <input type="text" value={cfg.network} oninput={(e) => update('redis', 'network', e.target.value)}
                    placeholder="wappler-compose_default"
                    class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                           placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              {/if}
              <div class="sm:col-span-2">
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step5.password')}
                  {#if redisMode === 'managed'}<span class="text-red-400 ml-0.5">*</span>{/if}
                  <Tooltip title={$_('wizard.step5.tooltip.redisPassword.title')} body={$_('wizard.step5.tooltip.redisPassword.body')} gotcha={$_('wizard.step5.tooltip.redisPassword.gotcha')} />
                </label>
                <PasswordInput
                  value={cfg.password}
                  placeholder={redisMode === 'managed' ? 'Strong password required' : 'Leave blank if Redis has no password'}
                  oninput={(v) => update('redis', 'password', v)}
                />
              </div>
              {#if redisMode !== 'managed'}
              <div>
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step5.port')}
                  <Tooltip title={$_('wizard.step5.tooltip.redisPort.title')} body={$_('wizard.step5.tooltip.redisPort.body')} defaultHint={$_('wizard.step5.tooltip.redisPort.defaultHint')} />
                </label>
                <input type="number" value={cfg.port} oninput={(e) => update('redis', 'port', parseInt(e.target.value))}
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                         text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              {/if}
              <div>
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step5.dbIndex')}
                  <Tooltip title={$_('wizard.step5.tooltip.redisDbIndex.title')} body={$_('wizard.step5.tooltip.redisDbIndex.body')} defaultHint={$_('wizard.step5.tooltip.redisDbIndex.defaultHint')} />
                </label>
                <input type="number" value={cfg.db} min="0" max="15" oninput={(e) => update('redis', 'db', parseInt(e.target.value))}
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                         text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              {#if redisMode === 'managed'}
              <div>
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step5.maxMemory')}
                  <Tooltip title={$_('wizard.step5.tooltip.redisMaxmemory.title')} body={$_('wizard.step5.tooltip.redisMaxmemory.body')} defaultHint={$_('wizard.step5.tooltip.redisMaxmemory.defaultHint')} />
                </label>
                <input type="text" value={cfg.maxMemory} oninput={(e) => update('redis', 'maxMemory', e.target.value)}
                  placeholder="e.g. 256mb"
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                         placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step5.evictionPolicy')}
                  <Tooltip title={$_('wizard.step5.tooltip.redisEviction.title')} body={$_('wizard.step5.tooltip.redisEviction.body')} defaultHint={$_('wizard.step5.tooltip.redisEviction.defaultHint')} />
                </label>
                <input type="text" value={cfg.evictionPolicy} oninput={(e) => update('redis', 'evictionPolicy', e.target.value)}
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                         text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              {/if}
            </div>

          {:else if addon.key === 'minio'}
            <div class="grid gap-4 sm:grid-cols-2">
              <div>
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step5.rootUser')} <span class="text-red-400 ml-0.5">*</span>
                  <Tooltip title={$_('wizard.step5.tooltip.minioUser.title')} body={$_('wizard.step5.tooltip.minioUser.body')} />
                </label>
                <input type="text" value={cfg.rootUser} oninput={(e) => update('minio', 'rootUser', e.target.value)}
                  placeholder="admin"
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                         placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step5.rootPassword')} <span class="text-red-400 ml-0.5">*</span>
                  <Tooltip title={$_('wizard.step5.tooltip.minioPassword.title')} body={$_('wizard.step5.tooltip.minioPassword.body')} gotcha={$_('wizard.step5.tooltip.minioPassword.gotcha')} />
                </label>
                <PasswordInput
                  value={cfg.rootPassword}
                  placeholder="Minimum 8 characters"
                  oninput={(v) => update('minio', 'rootPassword', v)}
                />
              </div>
              <div>
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step5.defaultBucket')}
                  <Tooltip title={$_('wizard.step5.tooltip.minioBucket.title')} body={$_('wizard.step5.tooltip.minioBucket.body')} defaultHint={$_('wizard.step5.tooltip.minioBucket.defaultHint')} />
                </label>
                <input type="text" value={cfg.defaultBucket} oninput={(e) => update('minio', 'defaultBucket', e.target.value)}
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                         text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step5.apiPort')} <Tooltip title={$_('wizard.step5.tooltip.minioApiPort.title')} body={$_('wizard.step5.tooltip.minioApiPort.body')} defaultHint={$_('wizard.step5.tooltip.minioApiPort.defaultHint')} />
                </label>
                <input type="number" value={cfg.apiPort} oninput={(e) => update('minio', 'apiPort', parseInt(e.target.value))}
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                         text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step5.consolePort')} <Tooltip title={$_('wizard.step5.tooltip.minioConsolePort.title')} body={$_('wizard.step5.tooltip.minioConsolePort.body')} defaultHint={$_('wizard.step5.tooltip.minioConsolePort.defaultHint')} />
                </label>
                <input type="number" value={cfg.consolePort} oninput={(e) => update('minio', 'consolePort', parseInt(e.target.value))}
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                         text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>

          {:else if addon.key === 'portainer'}
            <div class="grid gap-4 sm:grid-cols-2">
              <div>
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step5.webUiPort')} <Tooltip title={$_('wizard.step5.tooltip.portainerUiPort.title')} body={$_('wizard.step5.tooltip.portainerUiPort.body')} defaultHint={$_('wizard.step5.tooltip.portainerUiPort.defaultHint')} />
                </label>
                <input type="number" value={cfg.port} oninput={(e) => update('portainer', 'port', parseInt(e.target.value))}
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                         text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step5.agentPort')} <Tooltip title={$_('wizard.step5.tooltip.portainerAgentPort.title')} body={$_('wizard.step5.tooltip.portainerAgentPort.body')} defaultHint={$_('wizard.step5.tooltip.portainerAgentPort.defaultHint')} />
                </label>
                <input type="number" value={cfg.agentPort} oninput={(e) => update('portainer', 'agentPort', parseInt(e.target.value))}
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                         text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>

          {:else if addon.key === 'kuma'}
            <div>
              <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                {$_('wizard.step5.port')} <Tooltip title={$_('wizard.step5.tooltip.uptimeKumaPort.title')} body={$_('wizard.step5.tooltip.uptimeKumaPort.body')} defaultHint={$_('wizard.step5.tooltip.uptimeKumaPort.defaultHint')} />
              </label>
              <input type="number" value={cfg.port} oninput={(e) => update('kuma', 'port', parseInt(e.target.value))}
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                       text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>

          {:else if addon.key === 'plausible'}
            <div class="grid gap-4 sm:grid-cols-2">
              <div class="sm:col-span-2">
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step5.domain')} <span class="text-red-400 ml-0.5">*</span>
                  <Tooltip title={$_('wizard.step5.tooltip.plausibleDomain.title')} body={$_('wizard.step5.tooltip.plausibleDomain.body')} defaultHint={$_('wizard.step5.tooltip.plausibleDomain.defaultHint')} />
                </label>
                <input type="text" value={cfg.domain} oninput={(e) => update('plausible', 'domain', e.target.value)}
                  placeholder="analytics.example.com"
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                         placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step5.adminEmail')} <span class="text-red-400 ml-0.5">*</span>
                </label>
                <input type="email" value={cfg.adminEmail} oninput={(e) => update('plausible', 'adminEmail', e.target.value)}
                  placeholder="admin@example.com"
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                         placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step5.adminPassword')} <span class="text-red-400 ml-0.5">*</span>
                </label>
                <PasswordInput
                  value={cfg.adminPassword}
                  placeholder="••••••••"
                  oninput={(v) => update('plausible', 'adminPassword', v)}
                />
              </div>
              <div>
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step5.port')} <Tooltip title={$_('wizard.step5.tooltip.plausiblePort.title')} body={$_('wizard.step5.tooltip.plausiblePort.body')} defaultHint={$_('wizard.step5.tooltip.plausiblePort.defaultHint')} />
                </label>
                <input type="number" value={cfg.port} oninput={(e) => update('plausible', 'port', parseInt(e.target.value))}
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                         text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step5.secretKeyBase')}
                  <Tooltip title={$_('wizard.step5.tooltip.plausibleSecretKey.title')} body={$_('wizard.step5.tooltip.plausibleSecretKey.body')} defaultHint={$_('wizard.step5.tooltip.plausibleSecretKey.defaultHint')} />
                </label>
                <PasswordInput
                  value={cfg.secretKeyBase}
                  placeholder="Auto-generated if blank"
                  oninput={(v) => update('plausible', 'secretKeyBase', v)}
                />
              </div>
            </div>

          {:else if addon.key === 'mailpit'}
            <div class="grid gap-4 sm:grid-cols-2">
              <div>
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step5.smtpPort')} <Tooltip title={$_('wizard.step5.tooltip.mailpitSmtpPort.title')} body={$_('wizard.step5.tooltip.mailpitSmtpPort.body')} defaultHint={$_('wizard.step5.tooltip.mailpitSmtpPort.defaultHint')} />
                </label>
                <input type="number" value={cfg.smtpPort} oninput={(e) => update('mailpit', 'smtpPort', parseInt(e.target.value))}
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                         text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step5.uiPort')} <Tooltip title={$_('wizard.step5.tooltip.mailpitUiPort.title')} body={$_('wizard.step5.tooltip.mailpitUiPort.body')} defaultHint={$_('wizard.step5.tooltip.mailpitUiPort.defaultHint')} />
                </label>
                <input type="number" value={cfg.uiPort} oninput={(e) => update('mailpit', 'uiPort', parseInt(e.target.value))}
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                         text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>

          {:else if addon.key === 'n8n'}
            <div class="grid gap-4 sm:grid-cols-2">
              <div>
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step5.adminEmail')} <span class="text-red-400 ml-0.5">*</span>
                </label>
                <input type="email" value={cfg.adminEmail} oninput={(e) => update('n8n', 'adminEmail', e.target.value)}
                  placeholder="admin@example.com"
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                         placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step5.adminPassword')} <span class="text-red-400 ml-0.5">*</span>
                </label>
                <PasswordInput
                  value={cfg.adminPassword}
                  placeholder="••••••••"
                  oninput={(v) => update('n8n', 'adminPassword', v)}
                />
              </div>
              <div>
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step5.port')} <Tooltip title={$_('wizard.step5.tooltip.n8nPort.title')} body={$_('wizard.step5.tooltip.n8nPort.body')} defaultHint={$_('wizard.step5.tooltip.n8nPort.defaultHint')} />
                </label>
                <input type="number" value={cfg.port} oninput={(e) => update('n8n', 'port', parseInt(e.target.value))}
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                         text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step5.encryptionKey')}
                  <Tooltip title={$_('wizard.step5.tooltip.n8nEncryptionKey.title')} body={$_('wizard.step5.tooltip.n8nEncryptionKey.body')} defaultHint={$_('wizard.step5.tooltip.n8nEncryptionKey.defaultHint')} />
                </label>
                <PasswordInput
                  value={cfg.encryptionKey}
                  placeholder="Auto-generated if blank"
                  oninput={(v) => update('n8n', 'encryptionKey', v)}
                />
              </div>
              <div class="sm:col-span-2">
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step5.webhookUrl')}
                  <Tooltip title={$_('wizard.step5.tooltip.n8nWebhookUrl.title')} body={$_('wizard.step5.tooltip.n8nWebhookUrl.body')} defaultHint={$_('wizard.step5.tooltip.n8nWebhookUrl.defaultHint')} />
                </label>
                <input type="text" value={cfg.webhookUrl} oninput={(e) => update('n8n', 'webhookUrl', e.target.value)}
                  placeholder="https://n8n.example.com (optional)"
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                         placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>

          {:else if addon.key === 'restic'}
            <div class="grid gap-4 sm:grid-cols-2">
              <div class="sm:col-span-2">
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step5.repoPath')} <span class="text-red-400 ml-0.5">*</span>
                  <Tooltip title={$_('wizard.step5.tooltip.resticRepo.title')} body={$_('wizard.step5.tooltip.resticRepo.body')} defaultHint={$_('wizard.step5.tooltip.resticRepo.defaultHint')} />
                </label>
                <input type="text" value={cfg.repoPath} oninput={(e) => update('restic', 'repoPath', e.target.value)}
                  placeholder="/backups or s3:https://…"
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                         placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div class="sm:col-span-2">
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step5.repoPassword')} <span class="text-red-400 ml-0.5">*</span>
                  <Tooltip title={$_('wizard.step5.tooltip.resticPassword.title')} body={$_('wizard.step5.tooltip.resticPassword.body')} gotcha={$_('wizard.step5.tooltip.resticPassword.gotcha')} />
                </label>
                <PasswordInput
                  value={cfg.repoPassword}
                  placeholder="Strong unique password"
                  oninput={(v) => update('restic', 'repoPassword', v)}
                />
              </div>
              <div>
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step5.schedule')}
                  <Tooltip title={$_('wizard.step5.tooltip.backupSchedule.title')} body={$_('wizard.step5.tooltip.backupSchedule.body')} defaultHint={$_('wizard.step5.tooltip.backupSchedule.defaultHint')} />
                </label>
                <input type="text" value={cfg.schedule} oninput={(e) => update('restic', 'schedule', e.target.value)}
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                         text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div class="space-y-2 pt-1">
                <p class="text-xs font-medium text-gray-400">{$_('wizard.step5.backupTargets')}</p>
                <label class="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={cfg.backupUploads}
                    onchange={(e) => update('restic', 'backupUploads', e.target.checked)}
                    class="w-4 h-4 rounded bg-gray-700 border-gray-600 text-indigo-600" />
                  <span class="text-sm text-gray-300">{$_('wizard.step5.backupUploads')}</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={cfg.backupDb}
                    onchange={(e) => update('restic', 'backupDb', e.target.checked)}
                    class="w-4 h-4 rounded bg-gray-700 border-gray-600 text-indigo-600" />
                  <span class="text-sm text-gray-300">{$_('wizard.step5.backupDb')}</span>
                </label>
              </div>
              <div>
                <label class="text-xs font-medium text-gray-400 mb-1.5 block">{$_('wizard.step5.keepDaily')}</label>
                <input type="number" value={cfg.retainDaily} min="1" oninput={(e) => update('restic', 'retainDaily', parseInt(e.target.value))}
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                         text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label class="text-xs font-medium text-gray-400 mb-1.5 block">{$_('wizard.step5.keepWeekly')}</label>
                <input type="number" value={cfg.retainWeekly} min="1" oninput={(e) => update('restic', 'retainWeekly', parseInt(e.target.value))}
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                         text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label class="text-xs font-medium text-gray-400 mb-1.5 block">{$_('wizard.step5.keepMonthly')}</label>
                <input type="number" value={cfg.retainMonthly} min="1" oninput={(e) => update('restic', 'retainMonthly', parseInt(e.target.value))}
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                         text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>

          {:else if addon.key === 'apprise'}
            <div>
              <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                {$_('wizard.step5.notifyUrl')} <span class="text-red-400 ml-0.5">*</span>
                <Tooltip
                  title={$_('wizard.step5.tooltip.appriseNotifyUrl.title')}
                  body={$_('wizard.step5.tooltip.appriseNotifyUrl.body')}
                  defaultHint={$_('wizard.step5.tooltip.appriseNotifyUrl.defaultHint')}
                />
              </label>
              <input type="text" value={cfg.notifyUrl} oninput={(e) => update('apprise', 'notifyUrl', e.target.value)}
                placeholder="discord://… or https://…"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                       placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div class="flex gap-6 pt-1">
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={cfg.onSuccess} onchange={(e) => update('apprise', 'onSuccess', e.target.checked)}
                  class="w-4 h-4 rounded bg-gray-700 border-gray-600 text-indigo-600" />
                <span class="text-sm text-gray-300">{$_('wizard.step5.onSuccess')}</span>
              </label>
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={cfg.onFailure} onchange={(e) => update('apprise', 'onFailure', e.target.checked)}
                  class="w-4 h-4 rounded bg-gray-700 border-gray-600 text-indigo-600" />
                <span class="text-sm text-gray-300">{$_('wizard.step5.onFailure')}</span>
              </label>
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={cfg.onRollback} onchange={(e) => update('apprise', 'onRollback', e.target.checked)}
                  class="w-4 h-4 rounded bg-gray-700 border-gray-600 text-indigo-600" />
                <span class="text-sm text-gray-300">{$_('wizard.step5.onRollback')}</span>
              </label>
            </div>
          {/if}

          <!-- Local limitation note (non-Traefik add-ons that have one) -->
          {#if isLocal && addon.localNote && addon.key !== 'traefik'}
            <div class="flex items-start gap-2 bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2.5">
              <span class="text-amber-400 shrink-0 mt-0.5">ℹ</span>
              <p class="text-xs text-amber-300">{addon.localNote}</p>
            </div>
          {/if}

        </div>
      {/if}
    </div>
  {/each}
</div>
