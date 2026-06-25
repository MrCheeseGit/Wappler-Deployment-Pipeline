<script>
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { wizardStore } from '$lib/wizardStore.js';
  import { stepValid } from '$lib/stepValid.js';
  import { api } from '$lib/api.js';
  import Tooltip from '$lib/components/Tooltip.svelte';
  import SshKeyPathInput from '$lib/components/SshKeyPathInput.svelte';
  import RemoteDockerReadiness from '$lib/components/RemoteDockerReadiness.svelte';
  import DropletImportPicker from '$lib/components/DropletImportPicker.svelte';
  import ExistingHostOsPanel from '$lib/components/ExistingHostOsPanel.svelte';
  import RebuildDropletPanel from '$lib/components/RebuildDropletPanel.svelte';
  import { mergeProfileIntoWizard, applyMergedWizardConfig } from '$lib/profileWizardSync.js';
  import { fetchHostOs } from '$lib/hostOsApi.js';
  import { saveStep2Prefs } from '$lib/step2PrefsApi.js';
  import { _ } from 'svelte-i18n';

  // Read fresh on every mount — this also picks up values written by the Wappler import
  function readStore() {
    const s4 = get(wizardStore).step4;
    hostingTarget = s4.hostingTarget || '';
    sshHost       = s4.sshHost       || '';
    sshUser       = s4.sshUser       || 'root';
    sshKeyPath    = s4.sshKeyPath    || '~/.ssh/id_ed25519';
    remotePath    = s4.remotePath    || '';
    doMode        = s4.doMode        || 'existing';
    doApiKey      = s4.doApiKey      || '';
    doRegion      = s4.doRegion      || 'lon1';
    doSize        = s4.doSize        || 's-1vcpu-1gb';
    doSshKeyId    = s4.doSshKeyId    || '';
    doDropletId   = s4.doDropletId   || '';
  }

  const s4 = get(wizardStore).step4;
  let hostingTarget = s4.hostingTarget || '';
  let sshHost       = s4.sshHost       || '';
  let sshUser       = s4.sshUser       || 'root';
  let sshKeyPath    = s4.sshKeyPath    || '~/.ssh/id_ed25519';
  let remotePath    = s4.remotePath    || '';
  let doApiKey      = s4.doApiKey      || '';
  let doRegion      = s4.doRegion      || 'lon1';
  let doSize        = s4.doSize        || 's-1vcpu-1gb';
  let doSshKeyId    = s4.doSshKeyId    || '';
  let doDropletId   = s4.doDropletId   || '';
  let doMode        = s4.doMode        || 'existing'; // 'existing' | 'provision'
  let hostOsInfo    = null;
  let hostOsLoading = false;
  let hostOsError   = '';
  let dockerRefreshKey = 0;

  const s2Init = get(wizardStore).step2 || {};
  let provisionTargetOS = s2Init.targetOS || 'ubuntu-24.04';
  let rebuildTargetOS   = s2Init.rebuildTargetOS || s2Init.targetOS || 'ubuntu-24.04';
  let rebuildDismissed  = s2Init.rebuildDismissed === true;
  let showRebuildAdvanced = false;

  const PROVISION_OS_OPTIONS = [
    { value: 'ubuntu-24.04', label: 'Ubuntu Server 24.04 LTS', badge: 'Recommended' },
    { value: 'ubuntu-22.04', label: 'Ubuntu Server 22.04 LTS', badge: null },
    { value: 'debian-12',    label: 'Debian 12 (Bookworm)',    badge: null },
    { value: 'alpine',       label: 'Alpine Linux',            badge: 'Minimal' },
  ];

  const ARCH_OPTIONS = [
    { value: 'x86_64', label: 'x86_64 (Intel / AMD)',  desc: 'Standard cloud servers and desktops' },
    { value: 'arm64',  label: 'ARM64',                  desc: 'Raspberry Pi, Oracle ARM, AWS Graviton' },
  ];

  let architecture = s2Init.architecture || 'x86_64';

  function archFromImageSlug(slug) {
    if (!slug || slug === '—') return null;
    if (slug.includes('aarch64')) return 'arm64';
    if (slug.includes('x64')) return 'x86_64';
    return null;
  }

  function syncHostOsToStep2(droplet) {
    if (!droplet) return;
    const arch = droplet.hostArchWizard || archFromImageSlug(droplet.imageSlug);
    const patch = { ...get(wizardStore).step2 };
    if (droplet.hostOsWizard) {
      patch.targetOS = droplet.hostOsWizard;
      patch.rebuildTargetOS = droplet.hostOsWizard;
      rebuildTargetOS = droplet.hostOsWizard;
    }
    if (arch) {
      patch.architecture = arch;
      architecture = arch;
    }
    if (droplet.hostOsWizard || arch) wizardStore.setStep(2, patch);
  }

  async function persistStep2Prefs(patch) {
    const profile = get(wizardStore).activeProfile;
    if (!profile) return;
    try {
      await saveStep2Prefs(api, profile, patch);
    } catch { /* non-fatal */ }
  }

  function handleRebuildCancel() {
    rebuildDismissed = true;
    showRebuildAdvanced = false;
    if (hostOsInfo?.hostOsWizard) {
      rebuildTargetOS = hostOsInfo.hostOsWizard;
    }
    wizardStore.setStep(2, {
      ...get(wizardStore).step2,
      rebuildTargetOS,
      rebuildDismissed: true,
    });
    persistStep2Prefs({ rebuildDismissed: true, rebuildTargetOS });
  }

  function handleRebuildTargetChange(os) {
    rebuildTargetOS = os;
    const hostOs = hostOsInfo?.hostOsWizard;
    if (hostOs && os !== hostOs) {
      rebuildDismissed = false;
      showRebuildAdvanced = true;
    }
    wizardStore.setStep(2, {
      ...get(wizardStore).step2,
      rebuildTargetOS,
      rebuildDismissed,
    });
  }

  function applySavedProfile(prof) {
    if (!prof) return;
    if (prof.hostingTarget) hostingTarget = prof.hostingTarget;
    if (prof.sshHost)       sshHost       = prof.sshHost;
    if (prof.sshUser)       sshUser       = prof.sshUser;
    if (prof.sshKeyPath)    sshKeyPath    = prof.sshKeyPath;
    if (prof.remotePath)    remotePath    = prof.remotePath;
    if (prof.doMode)        doMode        = prof.doMode;
    if (prof.doApiKey && !doApiKey.trim()) doApiKey = prof.doApiKey;
    if (prof.doRegion)      doRegion      = prof.doRegion;
    if (prof.doSize)        doSize        = prof.doSize;
    if (prof.doSshKeyId)    doSshKeyId    = prof.doSshKeyId;
    if (prof.doDropletId)   doDropletId   = prof.doDropletId;
    if (prof.hostOsLabel || prof.wizardConfig?.step4?.hostOsLabel) {
      hostOsInfo = {
        imageLabel: prof.hostOsLabel || prof.wizardConfig?.step4?.hostOsLabel,
        imageSlug: prof.hostOsSlug || prof.wizardConfig?.step4?.hostOsSlug,
        hostOsWizard: prof.hostOsWizard ?? prof.wizardConfig?.step4?.hostOsWizard,
        hostArchWizard: prof.hostArchWizard || prof.wizardConfig?.step4?.hostArchWizard || null,
      };
    }
  }

  async function refreshHostOs() {
    if (!needsDo || doMode !== 'existing' || !hasDoAuth) return;
    if (!doDropletId && !sshHost.trim()) {
      hostOsInfo = null;
      hostOsError = '';
      return;
    }
    hostOsLoading = true;
    hostOsError = '';
    try {
      const res = await fetchHostOs(api, {
        profile: get(wizardStore).activeProfile,
        dropletId: doDropletId,
        sshHost,
        apiKey: doApiKey,
      });
      hostOsInfo = res?.droplet || null;
      if (hostOsInfo) {
        wizardStore.setStep(4, {
          hostOsLabel: hostOsInfo.imageLabel || '',
          hostOsSlug: hostOsInfo.imageSlug || '',
          hostOsWizard: hostOsInfo.hostOsWizard || '',
        });
        syncHostOsToStep2(hostOsInfo);
      }
    } catch (err) {
      hostOsInfo = null;
      hostOsError = err.message || '';
    } finally {
      hostOsLoading = false;
    }
  }

  onMount(async () => {
    readStore();
    const active = get(wizardStore).activeProfile;
    if (active) {
      try {
        const cfg = await api.get('/api/config');
        const prof = cfg.profiles?.[active];
        applySavedProfile(prof);
        const merged = mergeProfileIntoWizard(prof, active);
        if (merged) wizardStore.set(applyMergedWizardConfig(get(wizardStore), merged));
        readStore();
      } catch { /* ignore */ }
    }
    try {
      const d = await api.get('/api/config/digitalocean');
      hasGlobalDoKey = d.hasKey;
    } catch { /* ignore */ }

    if (hostingTarget === 'digitalocean' && doMode === 'provision' && (doApiKey.trim() || hasGlobalDoKey)) {
      await loadDoSshKeys();
    }
    if (needsDo && doMode === 'existing' && hasDoAuth && (doDropletId || sshHost.trim())) {
      await refreshHostOs();
    }
  });

  // SSH test-connection state
  let testState   = 'idle'; // 'idle' | 'testing' | 'ok' | 'fail'
  let testMessage = '';

  // DO API token test state
  let doTestState   = 'idle'; // 'idle' | 'testing' | 'ok' | 'fail'
  let doTestMessage = '';
  let doSshKeys      = []; // [{ id, name, fingerprint }] fetched from DO after token validation
  let hasGlobalDoKey = false;
  let doKeysLoading  = false;

  const ACTIVE_TARGETS = [
    { value: 'digitalocean', label: 'DigitalOcean Droplet', icon: '🌊', desc: 'Deploy to a DigitalOcean Droplet via SSH.' },
    { value: 'vps',          label: 'Self-hosted VPS',      icon: '🖥️', desc: 'Any server reachable via SSH — Hetzner, Linode, OVH, your own hardware.' },
    { value: 'local',        label: 'Local Docker',         icon: '🐳', desc: 'Deploy to the local Docker daemon. Ideal for dev and staging.' }
  ];

  const COMING_SOON = [
    { value: 'railway', label: 'Railway', icon: '🚂', desc: 'Deploy to Railway via the Railway API.' }
  ];

  const DO_REGIONS = [
    { value: 'lon1', label: 'London (lon1)' },
    { value: 'ams3', label: 'Amsterdam (ams3)' },
    { value: 'fra1', label: 'Frankfurt (fra1)' },
    { value: 'nyc3', label: 'New York (nyc3)' },
    { value: 'sfo3', label: 'San Francisco (sfo3)' },
    { value: 'sgp1', label: 'Singapore (sgp1)' },
    { value: 'syd1', label: 'Sydney (syd1)' }
  ];

  const DO_SIZES = [
    { value: 's-1vcpu-1gb',  label: '$6/mo — 1 vCPU / 1 GB RAM' },
    { value: 's-1vcpu-2gb',  label: '$12/mo — 1 vCPU / 2 GB RAM' },
    { value: 's-2vcpu-2gb',  label: '$18/mo — 2 vCPU / 2 GB RAM' },
    { value: 's-2vcpu-4gb',  label: '$24/mo — 2 vCPU / 4 GB RAM' },
    { value: 's-4vcpu-8gb',  label: '$48/mo — 4 vCPU / 8 GB RAM' }
  ];

  $: needsSsh = hostingTarget === 'digitalocean' || hostingTarget === 'vps';
  $: needsDo  = hostingTarget === 'digitalocean';
  // Duplicated remote profiles keep sshHost until cleared — drop it when switching to local.
  $: if (hostingTarget === 'local' && sshHost) sshHost = '';
  $: provisionMode = needsDo && doMode === 'provision';
  $: canTest  = needsSsh && !provisionMode && sshHost.trim() && sshUser.trim() && sshKeyPath.trim();
  $: canTestDo = doApiKey.trim().length > 0 || hasGlobalDoKey;
  $: hasDoAuth = canTestDo;

  $: sshValid = needsSsh
    ? (provisionMode
        ? hasDoAuth && String(doSshKeyId).trim().length > 0
        : sshHost.trim().length > 0 && sshUser.trim().length > 0 && sshKeyPath.trim().length > 0)
    : true;

  $: isValid = hostingTarget.length > 0 && sshValid;

  $: showExistingRebuild = needsDo && doMode === 'existing' && (doDropletId || sshHost?.trim());
  $: showArchPicker = (needsDo && doMode === 'provision') || hostingTarget === 'vps' || hostingTarget === 'local';

  $: {
    stepValid.set(isValid);
    wizardStore.setStep(4, {
      hostingTarget, sshHost, sshUser, sshKeyPath, remotePath, doMode, doApiKey, doRegion, doSize, doSshKeyId, doDropletId,
    });
    const step2Patch = { ...get(wizardStore).step2 };
    if (doMode === 'provision' && provisionTargetOS) step2Patch.targetOS = provisionTargetOS;
    if (showArchPicker) step2Patch.architecture = architecture;
    if ((doMode === 'provision' && provisionTargetOS) || showArchPicker) {
      wizardStore.setStep(2, step2Patch);
    }
  }

  async function testSshConnection() {
    testState   = 'testing';
    testMessage = '';
    try {
      const result = await api.post('/api/config/test-ssh', {
        sshHost: sshHost.trim(),
        sshUser: sshUser.trim(),
        sshKeyPath: sshKeyPath.trim(),
      });
      testState   = result.ok ? 'ok' : 'fail';
      testMessage = result.message;
    } catch (err) {
      testState   = 'fail';
      testMessage = err.message || 'Connection failed';
    }
  }

  async function loadDoSshKeys() {
    if (!canTestDo) return;
    doKeysLoading = true;
    doTestState   = 'testing';
    doTestMessage = '';
    doSshKeys     = [];
    try {
      const body = doApiKey.trim() ? { apiKey: doApiKey.trim() } : {};
      const result = await api.post('/api/config/test-do-api', body);
      doTestState   = result.ok ? 'ok' : 'fail';
      doTestMessage = result.message;
      if (result.ok && result.sshKeys?.length) {
        doSshKeys = result.sshKeys;
        const saved = String(doSshKeyId).trim();
        const stillValid = saved && doSshKeys.some((k) => k.id === saved);
        if (!stillValid && doSshKeys.length === 1) doSshKeyId = doSshKeys[0].id;
      }
    } catch (err) {
      doTestState   = 'fail';
      doTestMessage = err.message || 'Request failed';
    } finally {
      doKeysLoading = false;
    }
  }

  const testDoApiKey = loadDoSshKeys;

  function onDropletImported(d) {
    doMode = 'existing';
    sshHost = d.ipv4 || '';
    doDropletId = String(d.id);
    if (d.region && d.region !== '—') doRegion = d.region;
    if (d.sizeSlug && d.sizeSlug !== '—') doSize = d.sizeSlug;
    hostOsInfo = {
      name: d.name,
      ipv4: d.ipv4,
      imageLabel: d.imageLabel,
      imageSlug: d.imageSlug,
      hostOsWizard: d.hostOsWizard,
      hostArchWizard: d.hostArchWizard || null,
    };
    wizardStore.setStep(4, {
      hostOsLabel: d.imageLabel || '',
      hostOsSlug: d.imageSlug || '',
      hostOsWizard: d.hostOsWizard || '',
    });
    syncHostOsToStep2(hostOsInfo);
    testState = 'idle';
    dockerRefreshKey += 1;
  }

  $: activeProfile = get(wizardStore).activeProfile;
  $: sshProbe = needsSsh && !provisionMode && sshHost.trim() && sshKeyPath.trim()
    ? { sshHost, sshUser, sshKeyPath }
    : null;
  $: wizardProjectPath = $wizardStore.step1?.projectPath || '';
  $: if (doMode === 'provision') {
    hostOsInfo = null;
    hostOsError = '';
  }
</script>

<h2 class="text-xl font-semibold text-white mb-1">{$_('wizard.step4.title')}</h2>
<p class="text-gray-400 text-sm mb-8">
  {$_('wizard.step4.subtitle')}
</p>

<div class="space-y-8">

  <!-- Target selection -->
  <div>
    <label class="text-sm font-medium text-gray-300 mb-3 block">{$_('wizard.step4.hostingProvider')}</label>
    <div class="grid gap-2 sm:grid-cols-2">
      {#each ACTIVE_TARGETS as t}
        <button
          type="button"
          onclick={() => { hostingTarget = t.value; testState = 'idle'; }}
          class="flex items-start gap-3 p-4 rounded-lg border text-left transition
            {hostingTarget === t.value
              ? 'border-indigo-500 bg-indigo-950/30'
              : 'border-gray-700 bg-gray-800/40 hover:border-gray-600'}"
        >
          <span class="text-xl leading-none mt-0.5 shrink-0">{t.icon}</span>
          <div>
            <p class="text-sm font-medium text-white">{t.label}</p>
            <p class="text-xs text-gray-400 mt-0.5">{$_('wizard.step4.targetDesc.' + t.value)}</p>
          </div>
        </button>
      {/each}
    </div>

    <!-- Coming soon targets -->
    <div class="mt-4">
      <p class="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">{$_('wizard.step4.comingSoonLabel')}</p>
      <div class="grid gap-2 sm:grid-cols-2">
        {#each COMING_SOON as t}
          <div class="flex items-start gap-3 p-4 rounded-lg border border-gray-700/50 bg-gray-800/20 text-left cursor-not-allowed opacity-50">
            <span class="text-xl leading-none mt-0.5 shrink-0">{t.icon}</span>
            <div>
              <p class="text-sm font-medium text-white flex items-center gap-2">
                {t.label}
                <span class="text-[10px] font-semibold uppercase tracking-wide text-amber-400/80 bg-amber-400/10 border border-amber-400/20 rounded px-1.5 py-0.5 leading-none">{$_('wizard.step4.comingSoonBadge')}</span>
              </p>
              <p class="text-xs text-gray-500 mt-0.5">{$_('wizard.step4.targetDesc.' + t.value)}</p>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </div>

  <!-- DigitalOcean: existing vs provision toggle -->
  {#if needsDo}
    <div>
      <label class="text-sm font-medium text-gray-300 mb-3 block">{$_('wizard.step4.dropletSetup')}</label>
      <div class="flex gap-2">
        <button
          type="button"
          onclick={() => { doMode = 'existing'; }}
          class="flex-1 flex items-start gap-3 p-3.5 rounded-lg border text-left transition
            {doMode === 'existing'
              ? 'border-indigo-500 bg-indigo-950/30'
              : 'border-gray-700 bg-gray-800/40 hover:border-gray-600'}"
        >
          <div class="w-4 h-4 rounded-full border-2 mt-0.5 shrink-0 flex items-center justify-center
            {doMode === 'existing' ? 'border-indigo-400' : 'border-gray-600'}">
            {#if doMode === 'existing'}<div class="w-2 h-2 rounded-full bg-indigo-400"></div>{/if}
          </div>
          <div>
            <p class="text-sm font-medium text-white">{$_('wizard.step4.existingDroplet')}</p>
            <p class="text-xs text-gray-400 mt-0.5">{$_('wizard.step4.existingDropletDesc')}</p>
          </div>
        </button>
        <button
          type="button"
          onclick={() => {
            doMode = 'provision';
            if (hasGlobalDoKey || doApiKey.trim()) loadDoSshKeys();
          }}
          class="flex-1 flex items-start gap-3 p-3.5 rounded-lg border text-left transition
            {doMode === 'provision'
              ? 'border-indigo-500 bg-indigo-950/30'
              : 'border-gray-700 bg-gray-800/40 hover:border-gray-600'}"
        >
          <div class="w-4 h-4 rounded-full border-2 mt-0.5 shrink-0 flex items-center justify-center
            {doMode === 'provision' ? 'border-indigo-400' : 'border-gray-600'}">
            {#if doMode === 'provision'}<div class="w-2 h-2 rounded-full bg-indigo-400"></div>{/if}
          </div>
          <div>
            <p class="text-sm font-medium text-white">{$_('wizard.step4.provisionDroplet')}</p>
            <p class="text-xs text-gray-400 mt-0.5">{$_('wizard.step4.provisionDropletDesc')}</p>
          </div>
        </button>
      </div>
    </div>
  {/if}

  {#if needsDo && doMode === 'existing' && hasDoAuth}
    <DropletImportPicker
      context="wizard"
      profileName={activeProfile}
      projectPath={wizardProjectPath}
      apiKey={doApiKey}
      hasDoAuth={hasDoAuth}
      onApplied={onDropletImported}
    />
  {/if}

  {#if needsDo && doMode === 'existing'}
    <ExistingHostOsPanel
      hostOs={hostOsInfo}
      loading={hostOsLoading}
      loadError={hostOsError}
    />
    {#if showExistingRebuild && !hostOsLoading && !hostOsError && hostOsInfo}
      {#if rebuildDismissed && !showRebuildAdvanced}
        <button
          type="button"
          onclick={() => { showRebuildAdvanced = true; rebuildDismissed = false; }}
          class="text-sm text-left text-gray-400 hover:text-indigo-300 transition underline-offset-2 hover:underline"
        >
          {$_('wizard.step4.rebuild.showAdvanced')}
        </button>
      {:else}
        <RebuildDropletPanel
          context="step4"
          hostOs={hostOsInfo}
          rebuildTargetOs={rebuildTargetOS}
          {architecture}
          on:targetChange={(e) => handleRebuildTargetChange(e.detail)}
          on:cancel={handleRebuildCancel}
        />
      {/if}
    {/if}
  {/if}

  <!-- SSH details (DigitalOcean existing + VPS only — hidden in provision mode) -->
  {#if hostingTarget === 'vps' || hostingTarget === 'local'}
    <div>
      <label class="flex items-center text-sm font-medium text-gray-300 mb-3">
        {$_('wizard.step4.architecture')}
        <Tooltip
          title={$_('wizard.step2.tooltip.cpuArch.title')}
          body={$_('wizard.step2.tooltip.cpuArch.body')}
          defaultHint={$_('wizard.step2.tooltip.cpuArch.defaultHint')}
          gotcha={$_('wizard.step2.tooltip.cpuArch.gotcha')}
        />
      </label>
      <div class="grid gap-2 sm:grid-cols-2">
        {#each ARCH_OPTIONS as arch}
          <button
            type="button"
            onclick={() => { architecture = arch.value; }}
            class="flex items-start gap-3 p-3.5 rounded-lg border text-left transition
              {architecture === arch.value
                ? 'border-indigo-500 bg-indigo-950/30'
                : 'border-gray-700 bg-gray-800/40 hover:border-gray-600'}"
          >
            <div class="w-4 h-4 rounded-full border-2 mt-0.5 flex items-center justify-center shrink-0
              {architecture === arch.value ? 'border-indigo-400' : 'border-gray-600'}">
              {#if architecture === arch.value}
                <div class="w-2 h-2 rounded-full bg-indigo-400"></div>
              {/if}
            </div>
            <div class="min-w-0">
              <p class="text-sm font-medium text-white">{arch.label}</p>
              <p class="text-xs text-gray-400 mt-0.5">{arch.desc}</p>
            </div>
          </button>
        {/each}
      </div>
    </div>
  {/if}

  {#if needsSsh && !provisionMode}
    <div>
      <h3 class="flex items-center text-sm font-medium text-gray-300 mb-4">
        {$_('wizard.step4.sshDetails')}
        <Tooltip
          title={$_('wizard.step4.tooltip.sshDetails.title')}
          body={$_('wizard.step4.tooltip.sshDetails.body')}
          gotcha={$_('wizard.step4.tooltip.sshDetails.gotcha')}
        />
      </h3>
      <div class="space-y-4">
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
              {$_('wizard.step4.sshHostLabel')} <span class="text-red-400 ml-0.5">*</span>
              <Tooltip title={$_('wizard.step4.tooltip.sshHost.title')} body={$_('wizard.step4.tooltip.sshHost.body')} defaultHint={$_('wizard.step4.tooltip.sshHost.defaultHint')} />
            </label>
            <input type="text" bind:value={sshHost} placeholder="123.456.789.0" required
              oninput={() => testState = 'idle'}
              onblur={() => needsDo && doMode === 'existing' && hasDoAuth && refreshHostOs()}
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                     placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
              {$_('wizard.step4.sshUserLabel')} <span class="text-red-400 ml-0.5">*</span>
              <Tooltip title={$_('wizard.step4.tooltip.sshUser.title')} body={$_('wizard.step4.tooltip.sshUser.body')} defaultHint={$_('wizard.step4.tooltip.sshUser.defaultHint')} />
            </label>
            <input type="text" bind:value={sshUser} placeholder="root" required
              oninput={() => testState = 'idle'}
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                     placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
        </div>
        <div>
          <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
            {$_('wizard.step4.sshKeyLabel')} <span class="text-red-400 ml-0.5">*</span>
            <Tooltip
              title={$_('wizard.step4.tooltip.sshKey.title')}
              body={$_('wizard.step4.tooltip.sshKey.body')}
              defaultHint={$_('wizard.step4.tooltip.sshKey.defaultHint')}
              gotcha={$_('wizard.step4.tooltip.sshKey.gotcha')}
            />
          </label>
          <SshKeyPathInput
            bind:value={sshKeyPath}
            required
            onpathchange={() => { testState = 'idle'; }}
          />
        </div>

        <div>
          <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
            {$_('wizard.step4.remotePathLabel')}
            <Tooltip
              title={$_('wizard.step4.tooltip.remotePath.title')}
              body={$_('wizard.step4.tooltip.remotePath.body')}
              defaultHint={$_('wizard.step4.tooltip.remotePath.defaultHint')}
            />
          </label>
          <input type="text" bind:value={remotePath} placeholder={$_('wizard.step4.remotePathPlaceholder')}
            class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                   placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>

        <!-- Test connection -->
        <div class="flex items-center gap-3 pt-1">
          <button
            type="button"
            onclick={testSshConnection}
            disabled={!canTest || testState === 'testing'}
            class="px-4 py-2 text-sm rounded-lg font-medium transition
                   {testState === 'ok'
                     ? 'bg-green-700/60 border border-green-600/40 text-green-200'
                     : testState === 'fail'
                     ? 'bg-red-800/60 border border-red-600/40 text-red-200'
                     : !canTest || testState === 'testing'
                     ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                     : 'bg-gray-700 hover:bg-gray-600 text-gray-200 border border-gray-600'}"
          >
            {#if testState === 'testing'}
              <span class="flex items-center gap-2">
                <svg class="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                {$_('wizard.step4.testConnTesting')}
              </span>
            {:else if testState === 'ok'}
              {$_('wizard.step4.testConnOk')}
            {:else if testState === 'fail'}
              {$_('wizard.step4.testConnFail')}
            {:else}
              {$_('wizard.step4.testConn')}
            {/if}
          </button>
          {#if testMessage}
            <p class="text-xs {testState === 'ok' ? 'text-green-400' : 'text-red-400'} flex-1">
              {testMessage}
            </p>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  {#if needsSsh && !provisionMode && sshProbe}
    <RemoteDockerReadiness
      profileName={activeProfile}
      {sshProbe}
      refreshKey={dockerRefreshKey}
      variant="banner"
      dismissible={true}
    />
  {/if}

  <!-- DigitalOcean provision settings (only shown when provisioning a new droplet) -->
  {#if needsDo && doMode === 'provision'}
    <div class="rounded-xl border border-indigo-700/30 bg-indigo-950/10 px-5 py-4 space-y-4">
      <h3 class="flex items-center gap-2 text-sm font-medium text-indigo-300">
        {$_('wizard.step4.newDropletSettings')}
        <Tooltip
          title={$_('wizard.step4.tooltip.newDroplet.title')}
          body={$_('wizard.step4.tooltip.newDroplet.body')}
        />
      </h3>
      <p class="text-xs text-indigo-300/60 leading-relaxed">
        {$_('wizard.step4.newDropletDesc')}
      </p>
      <div>
        <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
          {$_('wizard.step4.doApiToken')} <span class="text-red-400 ml-0.5">*</span>
          <Tooltip
            title={$_('wizard.step4.tooltip.doApiToken.title')}
            body={$_('wizard.step4.tooltip.doApiToken.body')}
            gotcha={$_('wizard.step4.tooltip.doApiToken.gotcha')}
          />
        </label>
        {#if hasGlobalDoKey && !doApiKey.trim()}
          <p class="text-xs text-green-400 mb-2">{$_('wizard.step4.usingGlobalDoKey')}</p>
        {/if}
        <input type="password" bind:value={doApiKey} placeholder="dop_v1_…" autocomplete="off"
          oninput={() => doTestState = 'idle'}
          class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                 placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <p class="text-[11px] text-gray-600 mt-1">{$_('wizard.step4.doApiTokenOptional')}</p>
        <!-- DO API token test -->
        <div class="flex items-center gap-3 mt-2">
          <button
            type="button"
            onclick={testDoApiKey}
            disabled={!canTestDo || doTestState === 'testing'}
            class="px-4 py-2 text-sm rounded-lg font-medium transition
                   {doTestState === 'ok'
                     ? 'bg-green-700/60 border border-green-600/40 text-green-200'
                     : doTestState === 'fail'
                     ? 'bg-red-800/60 border border-red-600/40 text-red-200'
                     : !canTestDo || doTestState === 'testing'
                     ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                     : 'bg-gray-700 hover:bg-gray-600 text-gray-200 border border-gray-600'}"
          >
            {#if doTestState === 'testing'}
              <span class="flex items-center gap-2">
                <svg class="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                {$_('wizard.step4.validateApiTesting')}
              </span>
            {:else if doTestState === 'ok'}
              {$_('wizard.step4.validateApiOk')}
            {:else if doTestState === 'fail'}
              {$_('wizard.step4.validateApiFail')}
            {:else if hasGlobalDoKey && !doApiKey.trim()}
              {$_('wizard.step4.loadSshKeys')}
            {:else}
              {$_('wizard.step4.validateApi')}
            {/if}
          </button>
          {#if doTestMessage}
            <p class="text-xs {doTestState === 'ok' ? 'text-green-400' : 'text-red-400'} flex-1">
              {doTestMessage}
            </p>
          {/if}
        </div>
      </div>
      <div>
        <label class="flex items-center text-sm font-medium text-gray-300 mb-3">
          {$_('wizard.step4.provisionHostOs')}
          <Tooltip
            title={$_('wizard.step2.tooltip.targetOs.title')}
            body={$_('wizard.step2.tooltip.targetOs.body')}
            defaultHint={$_('wizard.step2.tooltip.targetOs.defaultHint')}
            gotcha={$_('wizard.step2.tooltip.targetOs.gotchaProvision')}
          />
        </label>
        <div class="grid gap-2 sm:grid-cols-2">
          {#each PROVISION_OS_OPTIONS as os}
            <button
              type="button"
              onclick={() => { provisionTargetOS = os.value; }}
              class="flex items-start gap-3 p-3.5 rounded-lg border text-left transition
                {provisionTargetOS === os.value
                  ? 'border-indigo-500 bg-indigo-950/30'
                  : 'border-gray-700 bg-gray-800/40 hover:border-gray-600'}"
            >
              <div class="w-4 h-4 rounded-full border-2 mt-0.5 flex items-center justify-center shrink-0
                {provisionTargetOS === os.value ? 'border-indigo-400' : 'border-gray-600'}">
                {#if provisionTargetOS === os.value}
                  <div class="w-2 h-2 rounded-full bg-indigo-400"></div>
                {/if}
              </div>
              <div class="min-w-0">
                <p class="text-sm font-medium text-white">{os.label}</p>
                {#if os.badge}
                  <span class="mt-1 inline-block text-[10px] font-medium bg-indigo-600/30 text-indigo-300
                               border border-indigo-600/40 rounded px-1.5 py-0.5">{os.badge}</span>
                {/if}
              </div>
            </button>
          {/each}
        </div>
      </div>
      <div>
        <label class="flex items-center text-sm font-medium text-gray-300 mb-3">
          {$_('wizard.step4.architecture')}
          <Tooltip
            title={$_('wizard.step2.tooltip.cpuArch.title')}
            body={$_('wizard.step2.tooltip.cpuArch.body')}
            defaultHint={$_('wizard.step2.tooltip.cpuArch.defaultHint')}
            gotcha={$_('wizard.step2.tooltip.cpuArch.gotcha')}
          />
        </label>
        <div class="grid gap-2 sm:grid-cols-2">
          {#each ARCH_OPTIONS as arch}
            <button
              type="button"
              onclick={() => { architecture = arch.value; }}
              class="flex items-start gap-3 p-3.5 rounded-lg border text-left transition
                {architecture === arch.value
                  ? 'border-indigo-500 bg-indigo-950/30'
                  : 'border-gray-700 bg-gray-800/40 hover:border-gray-600'}"
            >
              <div class="w-4 h-4 rounded-full border-2 mt-0.5 flex items-center justify-center shrink-0
                {architecture === arch.value ? 'border-indigo-400' : 'border-gray-600'}">
                {#if architecture === arch.value}
                  <div class="w-2 h-2 rounded-full bg-indigo-400"></div>
                {/if}
              </div>
              <div class="min-w-0">
                <p class="text-sm font-medium text-white">{arch.label}</p>
                <p class="text-xs text-gray-400 mt-0.5">{arch.desc}</p>
              </div>
            </button>
          {/each}
        </div>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
            {$_('wizard.step4.regionLabel')}
            <Tooltip title={$_('wizard.step4.tooltip.doRegion.title')} body={$_('wizard.step4.tooltip.doRegion.body')} defaultHint={$_('wizard.step4.tooltip.doRegion.defaultHint')} />
          </label>
          <select bind:value={doRegion}
            class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                   text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            {#each DO_REGIONS as r}
              <option value={r.value}>{r.label}</option>
            {/each}
          </select>
        </div>
        <div>
          <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
            {$_('wizard.step4.dropletSizeLabel')}
            <Tooltip title={$_('wizard.step4.tooltip.doSize.title')} body={$_('wizard.step4.tooltip.doSize.body')} defaultHint={$_('wizard.step4.tooltip.doSize.defaultHint')} gotcha={$_('wizard.step4.tooltip.doSize.gotcha')} />
          </label>
          <select bind:value={doSize}
            class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                   text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            {#each DO_SIZES as s}
              <option value={s.value}>{s.label}</option>
            {/each}
          </select>
        </div>
      </div>
      <div>
        <label class="flex items-center text-xs font-medium text-gray-400 mb-1.5">
          {$_('wizard.step4.sshKeySelectLabel')}
          <Tooltip title={$_('wizard.step4.tooltip.doSshKey.title')} body={$_('wizard.step4.tooltip.doSshKey.body')} defaultHint={$_('wizard.step4.tooltip.doSshKey.defaultHint')} />
        </label>
        {#if doKeysLoading}
          <p class="text-xs text-gray-400 flex items-center gap-2">
            <svg class="animate-spin w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            {$_('wizard.step4.sshKeysLoading')}
          </p>
        {:else if doSshKeys.length > 0}
          <select bind:value={doSshKeyId}
            class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                   text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">{$_('wizard.step4.selectKey')}</option>
            {#each doSshKeys as k}
              <option value={k.id}>{k.name} &nbsp;({k.fingerprint})</option>
            {/each}
          </select>
        {:else if hasGlobalDoKey && !doApiKey.trim()}
          <p class="text-xs text-gray-500 mb-2">{$_('wizard.step4.sshKeysLoadHint')}</p>
          <button
            type="button"
            onclick={loadDoSshKeys}
            disabled={doKeysLoading || doTestState === 'testing'}
            class="px-3 py-2 text-xs rounded-lg font-medium bg-gray-700 hover:bg-gray-600 text-gray-200 border border-gray-600 disabled:opacity-50"
          >
            {$_('wizard.step4.loadSshKeys')}
          </button>
        {:else}
          <input type="text" bind:value={doSshKeyId} placeholder={$_('wizard.step4.sshKeyValidatePlaceholder')}
            class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white
                   placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          {#if doTestState === 'ok'}
            <p class="text-xs text-amber-400 mt-1">{$_('wizard.step4.noSshKeys')}</p>
          {/if}
        {/if}
      </div>
    </div>
  {/if}

  {#if hostingTarget === 'railway'}
    <div class="bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-4">
      <p class="text-sm text-gray-300">
        {$_('wizard.step4.railwayNote')}
      </p>
    </div>
  {/if}

  {#if hostingTarget === 'local'}
    <div class="bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-4">
      <!-- svelte-ignore html_unsafe -->
      <p class="text-sm text-gray-300">{@html $_('wizard.step4.localDockerNote')}</p>
    </div>
  {/if}

</div>
