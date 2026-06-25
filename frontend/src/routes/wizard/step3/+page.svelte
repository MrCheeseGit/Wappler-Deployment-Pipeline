<script>
  import { get } from 'svelte/store';
  import { wizardStore } from '$lib/wizardStore.js';
  import { stepValid } from '$lib/stepValid.js';
  import Tooltip from '$lib/components/Tooltip.svelte';
  import { _ } from 'svelte-i18n';

  const s3 = get(wizardStore).step3;

  function migrateStep3(raw) {
    return {
      skipDb: raw.skipDb ?? false,
      dbType: raw.dbType || 'postgres',
      dbLocation: raw.dbLocation || 'managed',
      dbHost: raw.dbHost || raw.host || 'db',
      dbPort: raw.dbPort ?? raw.port ?? 5432,
      dbName: raw.dbName || raw.name || '',
      dbUser: raw.dbUser || raw.user || '',
      dbPassword: raw.dbPassword ?? raw.password ?? '',
      managedDbAck: raw.managedDbAck ?? false,
      sslMode: raw.sslMode || 'disable',
      sslCaPath: raw.sslCaPath || '',
      sslCertPath: raw.sslCertPath || '',
      sslKeyPath: raw.sslKeyPath || '',
    };
  }

  let {
    skipDb,
    dbType,
    dbLocation,
    dbHost,
    dbPort,
    dbName,
    dbUser,
    dbPassword,
    managedDbAck,
    sslMode,
    sslCaPath,
    sslCertPath,
    sslKeyPath,
  } = migrateStep3(s3);

  const DB_TYPES = [
    { value: 'postgres', label: 'PostgreSQL',      badge: 'Recommended' },
    { value: 'mysql',    label: 'MySQL / MariaDB',  badge: null },
    { value: 'sqlite',   label: 'SQLite',           badge: 'Dev only' }
  ];

  const LOCATIONS = [
    { value: 'managed' },
    { value: 'external' },
    { value: 'selfhosted' },
  ];

  const SSL_MODES = [
    { value: 'disable' },
    { value: 'require' },
    { value: 'verify-ca' },
    { value: 'verify-full' },
  ];

  function pickIntent(intent) {
    if (intent === 'skip') {
      skipDb = true;
      return;
    }
    skipDb = false;
    if (intent === 'managed') {
      dbLocation = 'managed';
      managedDbAck = false;
    } else if (intent === 'existing') {
      dbLocation = 'external';
      managedDbAck = false;
    }
  }

  $: needsConnectionDetails = dbLocation !== 'managed';
  $: needsSsl = needsConnectionDetails && dbType !== 'sqlite' && !skipDb;
  $: isSqlite = dbType === 'sqlite';
  $: sslEnabled = sslMode !== 'disable';
  $: isManaged = !skipDb && !isSqlite && dbLocation === 'managed';

  $: isValid = skipDb
    ? true
    : isSqlite
      ? true
      : isManaged
        ? dbName.trim().length > 0 && dbUser.trim().length > 0 && dbPassword.length > 0 && managedDbAck
        : dbHost.trim().length > 0 && dbName.trim().length > 0 && dbUser.trim().length > 0 && dbPassword.length > 0;

  $: {
    stepValid.set(isValid);
    wizardStore.setStep(3, {
      skipDb, dbType, dbLocation, dbHost, dbPort, dbName, dbUser, dbPassword,
      managedDbAck, sslMode, sslCaPath, sslCertPath, sslKeyPath,
    });
  }

  function handleDbTypeChange(value) {
    dbType = value;
    if (value === 'mysql' && dbPort === 5432) dbPort = 3306;
    if (value === 'postgres' && dbPort === 3306) dbPort = 5432;
  }

  function handleLocationChange(value) {
    dbLocation = value;
    if (value === 'managed') {
      managedDbAck = false;
    }
  }
</script>

<h2 class="text-xl font-semibold text-white mb-1">{$_('wizard.step3.title')}</h2>
<p class="text-gray-400 text-sm mb-4">
  {$_('wizard.step3.subtitle')}
</p>

<!-- Decision tree -->
<div class="mb-6 rounded-xl border border-gray-700/60 bg-gray-800/30 px-4 py-4">
  <p class="text-sm font-medium text-white mb-3">{$_('wizard.step3.intentTitle')}</p>
  <div class="grid gap-2 sm:grid-cols-3 items-start">
    <button
      type="button"
      onclick={() => pickIntent('managed')}
      class="text-left rounded-lg border px-3 py-3 transition self-start w-full
        {!skipDb && dbLocation === 'managed' && !isSqlite
          ? 'border-indigo-600/60 bg-indigo-950/30'
          : 'border-gray-700 bg-gray-800/40 hover:border-gray-600'}"
    >
      <p class="text-sm font-medium text-white">{$_('wizard.step3.intentManaged')}</p>
      <p class="text-xs text-gray-400 mt-1">{$_('wizard.step3.intentManagedDesc')}</p>
    </button>
    <button
      type="button"
      onclick={() => pickIntent('existing')}
      class="text-left rounded-lg border px-3 py-3 transition self-start w-full
        {!skipDb && dbLocation !== 'managed' && !isSqlite
          ? 'border-indigo-600/60 bg-indigo-950/30'
          : 'border-gray-700 bg-gray-800/40 hover:border-gray-600'}"
    >
      <p class="text-sm font-medium text-white">{$_('wizard.step3.intentExisting')}</p>
      <p class="text-xs text-gray-400 mt-1">{$_('wizard.step3.intentExistingDesc')}</p>
    </button>
    <button
      type="button"
      onclick={() => pickIntent('skip')}
      class="text-left rounded-lg border px-3 py-3 transition self-start w-full
        {skipDb
          ? 'border-indigo-600/60 bg-indigo-950/30'
          : 'border-gray-700 bg-gray-800/40 hover:border-gray-600'}"
    >
      <p class="text-sm font-medium text-white">{$_('wizard.step3.intentSkip')}</p>
      <p class="text-xs text-gray-400 mt-1">{$_('wizard.step3.intentSkipDesc')}</p>
    </button>
  </div>
</div>

{#if skipDb}
  <div class="flex items-start gap-2 bg-gray-800/50 border border-gray-700/60 rounded-lg px-4 py-3">
    <span class="text-gray-400 shrink-0 mt-0.5" aria-hidden="true">ℹ</span>
    <p class="text-xs text-gray-300 leading-relaxed">{$_('wizard.step3.skipActiveNote')}</p>
  </div>
{:else}
<div class="space-y-8">

  <!-- DB Type -->
  <div>
    <label class="flex items-center text-sm font-medium text-gray-300 mb-3">
      {$_('wizard.step3.dbType')}
      <Tooltip
        title={$_('wizard.step3.tooltip.dbType.title')}
        body={$_('wizard.step3.tooltip.dbType.body')}
        defaultHint={$_('wizard.step3.tooltip.dbType.defaultHint')}
        gotcha={$_('wizard.step3.tooltip.dbType.gotcha')}
      />
    </label>
    <div class="grid gap-2 sm:grid-cols-3">
      {#each DB_TYPES as db}
        <button
          type="button"
          onclick={() => handleDbTypeChange(db.value)}
          class="flex items-start gap-3 p-3.5 rounded-lg border text-left transition
            {dbType === db.value
              ? 'border-indigo-500 bg-indigo-950/30'
              : 'border-gray-700 bg-gray-800/40 hover:border-gray-600'}"
        >
          <div class="w-4 h-4 rounded-full border-2 mt-0.5 flex items-center justify-center shrink-0
            {dbType === db.value ? 'border-indigo-400' : 'border-gray-600'}">
            {#if dbType === db.value}
              <div class="w-2 h-2 rounded-full bg-indigo-400"></div>
            {/if}
          </div>
          <div>
            <p class="text-sm font-medium text-white">{db.label}</p>
            {#if db.badge}
              <span class="mt-1 inline-block text-[10px] font-medium rounded px-1.5 py-0.5
                {db.badge === 'Dev only'
                  ? 'bg-amber-900/40 text-amber-300 border border-amber-800/40'
                  : 'bg-indigo-600/30 text-indigo-300 border border-indigo-600/40'}">
                {db.badge === 'Recommended' ? $_('wizard.step3.badgeRecommended') : $_('wizard.step3.badgeDevOnly')}
              </span>
            {/if}
          </div>
        </button>
      {/each}
    </div>
  </div>

  {#if !isSqlite}

    <!-- DB Location -->
    <div>
      <label class="flex items-center text-sm font-medium text-gray-300 mb-3">
        {$_('wizard.step3.dbLocation')}
        <Tooltip
          title={$_('wizard.step3.tooltip.dbLocation.title')}
          body={$_('wizard.step3.tooltip.dbLocation.body')}
          defaultHint={$_('wizard.step3.tooltip.dbLocation.defaultHint')}
        />
      </label>
      <div class="space-y-2">
        {#each LOCATIONS as loc}
          <button
            type="button"
            onclick={() => handleLocationChange(loc.value)}
            class="w-full flex items-start gap-3 p-3.5 rounded-lg border text-left transition
              {dbLocation === loc.value
                ? 'border-indigo-500 bg-indigo-950/30'
                : 'border-gray-700 bg-gray-800/40 hover:border-gray-600'}"
          >
            <div class="w-4 h-4 rounded-full border-2 mt-0.5 flex items-center justify-center shrink-0
              {dbLocation === loc.value ? 'border-indigo-400' : 'border-gray-600'}">
              {#if dbLocation === loc.value}
                <div class="w-2 h-2 rounded-full bg-indigo-400"></div>
              {/if}
            </div>
            <div>
              <p class="text-sm font-medium text-white">{$_('wizard.step3.loc.' + loc.value)}</p>
              <p class="text-xs text-gray-400 mt-0.5">{$_('wizard.step3.locDesc.' + loc.value)}</p>
            </div>
          </button>
        {/each}
      </div>
    </div>

    {#if isManaged}
      <div class="flex items-start gap-2 bg-amber-900/20 border border-amber-700/40 rounded-lg px-4 py-3">
        <span class="text-amber-400 shrink-0 mt-0.5">⚠</span>
        <div class="min-w-0">
          <p class="text-sm font-medium text-amber-200 mb-1">{$_('wizard.step3.managedWarningTitle')}</p>
          <p class="text-xs text-amber-100/90 leading-relaxed mb-3">{$_('wizard.step3.managedWarningBody')}</p>
          <label class="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              bind:checked={managedDbAck}
              class="mt-0.5 w-4 h-4 rounded bg-gray-700 border-gray-600 text-indigo-600 focus:ring-indigo-500"
            />
            <span class="text-xs text-amber-100/90">{$_('wizard.step3.managedAck')}</span>
          </label>
        </div>
      </div>
    {:else if needsConnectionDetails}
      <div class="flex items-start gap-2 bg-blue-900/20 border border-blue-700/40 rounded-lg px-4 py-3">
        <span class="text-blue-400 shrink-0 mt-0.5" aria-hidden="true">ℹ</span>
        <p class="text-xs text-blue-100/90 leading-relaxed">{$_('wizard.step3.externalSafeNote')}</p>
      </div>
    {/if}

    <!-- Connection details -->
    <div>
      <h3 class="text-sm font-medium text-gray-300 mb-4">
        {$_('wizard.step3.connDetails')}
        {#if dbLocation === 'managed'}
          <span class="ml-2 text-xs text-gray-500 font-normal">
            ({$_('wizard.step3.connDetailsNote')})
          </span>
        {/if}
      </h3>
      <div class="space-y-4">

        {#if needsConnectionDetails}
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="sm:col-span-1">
              <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                {$_('wizard.step3.host')} <span class="text-red-400 ml-0.5">*</span>
                <Tooltip title={$_('wizard.step3.tooltip.dbHost.title')} body={$_('wizard.step3.tooltip.dbHost.body')} defaultHint={$_('wizard.step3.tooltip.dbHost.defaultHint')} />
              </label>
              <input type="text" bind:value={dbHost} placeholder="db.example.com"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                       placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                {$_('wizard.step3.port')}
                <Tooltip title={$_('wizard.step3.tooltip.dbPort.title')} body={$_('wizard.step3.tooltip.dbPort.body')} defaultHint={$_('wizard.step3.tooltip.dbPort.defaultHint')} />
              </label>
              <input type="number" bind:value={dbPort} min="1" max="65535"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                       text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
        {/if}

        <div>
          <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
            {$_('wizard.step3.name')} <span class="text-red-400 ml-0.5">*</span>
            <Tooltip title={$_('wizard.step3.tooltip.dbName.title')} body={$_('wizard.step3.tooltip.dbName.body')} defaultHint={$_('wizard.step3.tooltip.dbName.defaultHint')} />
          </label>
          <input type="text" bind:value={dbName} placeholder="myapp_production" required
            class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                   placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
              {$_('wizard.step3.user')} <span class="text-red-400 ml-0.5">*</span>
              <Tooltip title={$_('wizard.step3.tooltip.dbUser.title')} body={$_('wizard.step3.tooltip.dbUser.body')} defaultHint={$_('wizard.step3.tooltip.dbUser.defaultHint')} />
            </label>
            <input type="text" bind:value={dbUser} placeholder="myapp" required
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                     placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
              {$_('wizard.step3.password')} <span class="text-red-400 ml-0.5">*</span>
              <Tooltip title={$_('wizard.step3.tooltip.dbPassword.title')} body={$_('wizard.step3.tooltip.dbPassword.body')} gotcha={$_('wizard.step3.tooltip.dbPassword.gotcha')} />
            </label>
            <input type="password" bind:value={dbPassword} placeholder="••••••••••" required
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                     placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
        </div>

      </div>
    </div>

    <!-- SSL / TLS (external or self-hosted only) -->
    {#if needsSsl}
      <div>
        <h3 class="flex items-center text-sm font-medium text-gray-300 mb-4">
          {$_('wizard.step3.sslTls')}
          <Tooltip
            title={$_('wizard.step3.tooltip.sslTls.title')}
            body={$_('wizard.step3.tooltip.sslTls.body')}
            gotcha={$_('wizard.step3.tooltip.sslTls.gotcha')}
          />
        </h3>

        <div class="mb-4">
          <label class="text-xs font-medium text-gray-400 mb-2 block">{$_('wizard.step3.sslMode')}</label>
          <div class="grid gap-2 sm:grid-cols-2">
            {#each SSL_MODES as mode}
              <button
                type="button"
                onclick={() => { sslMode = mode.value; }}
                class="flex items-start gap-2.5 p-3 rounded-lg border text-left transition
                  {sslMode === mode.value
                    ? 'border-indigo-500 bg-indigo-950/30'
                    : 'border-gray-700 bg-gray-800/40 hover:border-gray-600'}"
              >
                <div class="w-3.5 h-3.5 rounded-full border-2 mt-0.5 flex items-center justify-center shrink-0
                  {sslMode === mode.value ? 'border-indigo-400' : 'border-gray-600'}">
                  {#if sslMode === mode.value}
                    <div class="w-1.5 h-1.5 rounded-full bg-indigo-400"></div>
                  {/if}
                </div>
                <div>
                  <p class="text-xs font-medium text-white">{$_('wizard.step3.sslModeLabel.' + mode.value)}</p>
                  <p class="text-[11px] text-gray-500 mt-0.5 leading-snug">{$_('wizard.step3.sslModeDesc.' + mode.value)}</p>
                </div>
              </button>
            {/each}
          </div>
        </div>

        {#if sslEnabled}
          <div class="space-y-3">
            <div>
              <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                {$_('wizard.step3.sslCaPath')}
                <Tooltip
                  title={$_('wizard.step3.tooltip.sslCaPath.title')}
                  body={$_('wizard.step3.tooltip.sslCaPath.body')}
                  defaultHint={$_('wizard.step3.tooltip.sslCaPath.defaultHint')}
                  gotcha={$_('wizard.step3.tooltip.sslCaPath.gotcha')}
                />
              </label>
              <input type="text" bind:value={sslCaPath} placeholder="/run/secrets/db-ca.crt"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                       placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step3.sslCertPath')}
                  <Tooltip title={$_('wizard.step3.tooltip.sslCertPath.title')} body={$_('wizard.step3.tooltip.sslCertPath.body')} defaultHint={$_('wizard.step3.tooltip.sslCertPath.defaultHint')} />
                </label>
                <input type="text" bind:value={sslCertPath} placeholder="Optional"
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                         placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
                  {$_('wizard.step3.sslKeyPath')}
                  <Tooltip title={$_('wizard.step3.tooltip.sslKeyPath.title')} body={$_('wizard.step3.tooltip.sslKeyPath.body')} defaultHint={$_('wizard.step3.tooltip.sslKeyPath.defaultHint')} />
                </label>
                <input type="text" bind:value={sslKeyPath} placeholder="Optional"
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                         placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>
          </div>
        {/if}
      </div>
    {/if}

  {:else}
    <div class="bg-amber-950/30 border border-amber-800/40 rounded-lg px-4 py-4">
      <p class="text-amber-200 text-sm">{@html '<strong>Note:</strong> ' + $_('wizard.step3.sqliteNote')}</p>
    </div>
  {/if}

</div>
{/if}
