<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import DropletImportPicker from '$lib/components/DropletImportPicker.svelte';
  import DropletSnapshotsPanel from '$lib/components/DropletSnapshotsPanel.svelte';
  import RemoteDockerReadiness from '$lib/components/RemoteDockerReadiness.svelte';
  import { _ } from 'svelte-i18n';

  export let profile = '';
  /** From profile config — used to nudge Step 1 when missing after Droplet import */
  export let projectPath = '';

  let subTab = 'overview';

  // Overview
  let droplet = null;
  let dropletLoading = false;
  let dropletError = '';
  let findBusy = false;
  let hasDoApiKey = false;
  let usesGlobalDoApiKey = false;
  let tokenInput = '';
  let tokenSaving = false;
  let tokenMessage = '';
  let tokenError = false;
  let showTokenForm = false;
  let dockerRefreshKey = 0;

  // DNS
  let dnsDomain = '';
  let dnsRecords = [];
  let dnsAnalysis = null;
  let dropletIp = '';
  let dnsLoading = false;
  let dnsError = '';
  let fixBusy = false;
  let showRecordForm = false;
  let editingRecord = null;
  let recordForm = { type: 'A', name: '@', data: '', ttl: 3600, priority: 10 };
  let recordSaving = false;

  // Files
  let filePath = '';
  let fileRoot = '';
  let fileEntries = [];
  let filesLoading = false;
  let filesError = '';
  let showHidden = false;
  let viewContent = '';
  let viewPath = '';
  let viewOpen = false;
  let renamePath = '';
  let renameValue = '';
  let uploadInput;

  $: breadcrumbs = filePath ? filePath.split('/').filter(Boolean) : [];

  $: needsToken = !hasDoApiKey || showTokenForm;

  onMount(async () => {
    await loadCredentials();
    if (subTab === 'overview' && hasDoApiKey) loadDroplet();
    else if (!hasDoApiKey) showTokenForm = true;
  });

  async function loadCredentials() {
    try {
      const res = await api.get(`/api/server/${encodeURIComponent(profile)}/credentials`);
      hasDoApiKey = !!res.hasDoApiKey;
      usesGlobalDoApiKey = !!res.usesGlobalDoApiKey;
    } catch {
      hasDoApiKey = false;
    }
  }

  async function saveDoToken() {
    tokenSaving = true;
    tokenMessage = '';
    tokenError = false;
    try {
      const res = await api.post(`/api/server/${encodeURIComponent(profile)}/do-token`, {
        apiKey: tokenInput.trim(),
      });
      tokenMessage = res.message;
      hasDoApiKey = true;
      showTokenForm = false;
      tokenInput = '';
      await loadDroplet();
    } catch (err) {
      tokenMessage = err.message;
      tokenError = true;
    } finally {
      tokenSaving = false;
    }
  }

  function selectSubTab(id) {
    subTab = id;
    if (id === 'overview' && !droplet && !dropletLoading) loadDroplet();
    if (id === 'dns' && !dnsRecords.length && !dnsLoading) loadDns();
    if (id === 'files' && !fileEntries.length && !filesLoading) loadFiles();
  }

  async function loadDroplet() {
    dropletLoading = true;
    dropletError = '';
    try {
      const res = await api.get(`/api/server/${encodeURIComponent(profile)}/droplet`);
      droplet = res.droplet;
    } catch (err) {
      droplet = null;
      dropletError = err.message;
    } finally {
      dropletLoading = false;
    }
  }

  async function findDroplet() {
    findBusy = true;
    dropletError = '';
    try {
      const res = await api.post(`/api/server/${encodeURIComponent(profile)}/droplet/find`, {});
      droplet = res.droplet;
    } catch (err) {
      dropletError = err.message;
    } finally {
      findBusy = false;
    }
  }

  function onDropletImported(d) {
    droplet = d;
    dropletError = '';
    dockerRefreshKey += 1;
    loadDroplet();
  }

  async function loadDns() {
    dnsLoading = true;
    dnsError = '';
    try {
      const res = await api.get(`/api/server/${encodeURIComponent(profile)}/dns`);
      dnsDomain = res.domain;
      dnsRecords = res.records || [];
      dnsAnalysis = res.analysis;
      dropletIp = res.dropletIp || '';
    } catch (err) {
      dnsError = err.message;
    } finally {
      dnsLoading = false;
    }
  }

  async function fixARecord() {
    fixBusy = true;
    try {
      const res = await api.post(`/api/server/${encodeURIComponent(profile)}/dns/fix-a`, {});
      dnsRecords = res.records || [];
      dnsAnalysis = res.analysis;
    } catch (err) {
      alert(err.message);
    } finally {
      fixBusy = false;
    }
  }

  function openNewRecord() {
    editingRecord = null;
    recordForm = { type: 'A', name: '@', data: dropletIp || '', ttl: 3600, priority: 10 };
    showRecordForm = true;
  }

  function openEditRecord(r) {
    editingRecord = r;
    recordForm = {
      type: r.type,
      name: r.name,
      data: r.data,
      ttl: r.ttl || 3600,
      priority: r.priority ?? 10,
    };
    showRecordForm = true;
  }

  async function saveRecord() {
    recordSaving = true;
    try {
      const body = { type: recordForm.type, name: recordForm.name, data: recordForm.data, ttl: Number(recordForm.ttl) || 3600 };
      if (recordForm.type === 'MX') body.priority = Number(recordForm.priority) || 10;
      if (editingRecord) {
        await api.put(`/api/server/${encodeURIComponent(profile)}/dns/records/${editingRecord.id}`, body);
      } else {
        await api.post(`/api/server/${encodeURIComponent(profile)}/dns/records`, body);
      }
      showRecordForm = false;
      await loadDns();
    } catch (err) {
      alert(err.message);
    } finally {
      recordSaving = false;
    }
  }

  async function deleteRecord(r) {
    if (!confirm($_('profile.server.dnsDeleteConfirm', { values: { name: r.name, type: r.type } }))) return;
    try {
      await api.delete(`/api/server/${encodeURIComponent(profile)}/dns/records/${r.id}`);
      await loadDns();
    } catch (err) {
      alert(err.message);
    }
  }

  async function loadFiles() {
    filesLoading = true;
    filesError = '';
    try {
      const q = new URLSearchParams({ path: filePath, hidden: showHidden ? '1' : '0' });
      const res = await api.get(`/api/server/${encodeURIComponent(profile)}/files?${q}`);
      fileRoot = res.root;
      fileEntries = res.entries || [];
    } catch (err) {
      filesError = err.message;
    } finally {
      filesLoading = false;
    }
  }

  function navigateTo(path) {
    filePath = path;
    viewOpen = false;
    loadFiles();
  }

  function enterDir(name) {
    navigateTo(filePath ? `${filePath}/${name}` : name);
  }

  function crumbJump(index) {
    const parts = breadcrumbs.slice(0, index + 1);
    navigateTo(parts.join('/'));
  }

  async function downloadFile(relPath) {
    const q = new URLSearchParams({ path: relPath });
    window.location.href = `/api/server/${encodeURIComponent(profile)}/files/download?${q}`;
  }

  async function viewFile(relPath) {
    try {
      const q = new URLSearchParams({ path: relPath });
      const res = await api.get(`/api/server/${encodeURIComponent(profile)}/files/view?${q}`);
      viewPath = relPath;
      viewContent = res.content;
      viewOpen = true;
    } catch (err) {
      alert(err.message);
    }
  }

  async function deleteFile(relPath, isDir) {
    const msg = isDir
      ? $_('profile.server.filesDeleteDirConfirm')
      : $_('profile.server.filesDeleteFileConfirm', { values: { name: relPath.split('/').pop() } });
    if (!confirm(msg)) return;
    try {
      const q = new URLSearchParams({ path: relPath });
      await api.delete(`/api/server/${encodeURIComponent(profile)}/files?${q}`);
      if (viewPath === relPath) viewOpen = false;
      await loadFiles();
    } catch (err) {
      alert(err.message);
    }
  }

  function startRename(relPath) {
    renamePath = relPath;
    renameValue = relPath.split('/').pop() || '';
  }

  async function commitRename() {
    if (!renamePath || !renameValue.trim()) return;
    try {
      await api.post(`/api/server/${encodeURIComponent(profile)}/files/rename`, {
        path: renamePath,
        newName: renameValue.trim(),
      });
      renamePath = '';
      await loadFiles();
    } catch (err) {
      alert(err.message);
    }
  }

  async function onUploadSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('path', filePath);
    try {
      const res = await fetch(`/api/server/${encodeURIComponent(profile)}/files/upload`, {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || 'Upload failed');
      }
      await loadFiles();
    } catch (err) {
      alert(err.message);
    }
    e.target.value = '';
  }

  function statusColour(status) {
    if (status === 'active') return 'text-green-400';
    if (status === 'off') return 'text-gray-400';
    return 'text-amber-400';
  }

  function fmtBytes(n) {
    if (n == null || n === 0) return '0 B';
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1048576).toFixed(1)} MB`;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString();
  }
</script>

<div class="space-y-4">
  <!-- Sub-tabs -->
  <div class="flex gap-2 border-b border-gray-800 pb-2">
    {#each [
      { id: 'overview', label: $_('profile.server.subOverview') },
      { id: 'snapshots', label: $_('profile.server.subSnapshots') },
      { id: 'dns', label: $_('profile.server.subDns') },
      { id: 'files', label: $_('profile.server.subFiles') },
    ] as t}
      <button
        type="button"
        onclick={() => selectSubTab(t.id)}
        class="px-3 py-1.5 text-sm rounded-md transition
               {subTab === t.id ? 'bg-indigo-600/30 text-indigo-200' : 'text-gray-400 hover:text-gray-200'}"
      >{t.label}</button>
    {/each}
  </div>

  <!-- Overview -->
  {#if subTab === 'overview'}
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-semibold text-gray-300">{$_('profile.server.overviewTitle')}</h2>
      <div class="flex gap-2">
        {#if hasDoApiKey}
          <button
            type="button"
            onclick={() => { showTokenForm = !showTokenForm; }}
            class="text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-400 hover:bg-gray-800"
          >{$_('profile.server.updateToken')}</button>
          <button
            type="button"
            onclick={loadDroplet}
            disabled={dropletLoading}
            class="text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-300 hover:bg-gray-800 disabled:opacity-50"
          >{$_('profile.server.refresh')}</button>
          <button
            type="button"
            onclick={findDroplet}
            disabled={findBusy}
            class="text-xs px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50"
          >{findBusy ? $_('common.loading') : $_('profile.server.findDroplet')}</button>
        {/if}
      </div>
    </div>

    {#if usesGlobalDoApiKey && !showTokenForm}
      <p class="text-xs text-green-400/90">{$_('profile.server.usingGlobalToken')}</p>
    {/if}

    {#if hasDoApiKey}
      <DropletImportPicker
        context="server"
        profileName={profile}
        {projectPath}
        hasDoAuth={hasDoApiKey}
        onApplied={onDropletImported}
      />
    {/if}

    <RemoteDockerReadiness profileName={profile} refreshKey={dockerRefreshKey} />

    {#if needsToken}
      <div class="rounded-lg border border-indigo-700/40 bg-indigo-950/20 p-4 space-y-3">
        <p class="text-sm text-indigo-200">{$_('profile.server.tokenRequired')}</p>
        <p class="text-xs text-gray-500">{$_('profile.server.tokenHint')}</p>
        <input
          type="password"
          bind:value={tokenInput}
          placeholder="dop_v1_…"
          autocomplete="off"
          class="w-full max-w-md bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
        />
        <div class="flex items-center gap-3">
          <button
            type="button"
            onclick={saveDoToken}
            disabled={tokenSaving || !tokenInput.trim()}
            class="text-xs px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50"
          >{tokenSaving ? $_('common.loading') : $_('profile.server.saveToken')}</button>
        </div>
        {#if tokenMessage}
          <p class="text-xs {tokenError ? 'text-red-400' : 'text-green-400'}">{tokenMessage}</p>
        {/if}
      </div>
    {/if}

    {#if dropletLoading}
      <p class="text-sm text-gray-500">{$_('common.loading')}</p>
    {:else if dropletError && !droplet}
      <p class="text-sm text-amber-400">{dropletError}</p>
      <p class="text-xs text-gray-500 mt-2">{$_('profile.server.findDropletHint')}</p>
    {:else if droplet}
      <div class="grid sm:grid-cols-2 gap-3 text-sm">
        <div class="rounded-lg border border-gray-800 bg-gray-900/50 p-4 space-y-2">
          <div class="flex justify-between"><span class="text-gray-500">{$_('profile.server.status')}</span>
            <span class="{statusColour(droplet.status)} font-medium">{droplet.status}</span></div>
          <div class="flex justify-between"><span class="text-gray-500">{$_('profile.server.name')}</span><span class="text-gray-200">{droplet.name}</span></div>
          <div class="flex justify-between"><span class="text-gray-500">{$_('profile.server.dropletId')}</span><span class="text-gray-200 font-mono text-xs">{droplet.id}</span></div>
          <div class="flex justify-between"><span class="text-gray-500">{$_('profile.server.ipv4')}</span><span class="text-gray-200 font-mono">{droplet.ipv4 || '—'}</span></div>
          <div class="flex justify-between"><span class="text-gray-500">{$_('profile.server.ipv6')}</span><span class="text-gray-200 font-mono text-xs">{droplet.ipv6 || '—'}</span></div>
        </div>
        <div class="rounded-lg border border-gray-800 bg-gray-900/50 p-4 space-y-2">
          <div class="flex justify-between"><span class="text-gray-500">{$_('profile.server.region')}</span><span class="text-gray-200">{droplet.region}</span></div>
          <div class="flex justify-between"><span class="text-gray-500">{$_('profile.server.size')}</span><span class="text-gray-200">{droplet.sizeSlug}</span></div>
          <div class="flex justify-between"><span class="text-gray-500">{$_('profile.server.specs')}</span>
            <span class="text-gray-200">{droplet.vcpus} vCPU · {droplet.memoryMb} MB · {droplet.diskGb} GB</span></div>
          <div class="flex justify-between"><span class="text-gray-500">{$_('profile.server.uptime')}</span><span class="text-gray-200 text-xs">{droplet.uptimeLabel}</span></div>
          <div class="flex justify-between"><span class="text-gray-500">{$_('profile.server.created')}</span><span class="text-gray-200 text-xs">{fmtDate(droplet.createdAt)}</span></div>
        </div>
      </div>
      {#if droplet.tags?.length}
        <p class="text-xs text-gray-500">{$_('profile.server.tags')}: <span class="text-gray-300">{droplet.tags.join(', ')}</span></p>
      {/if}
    {:else}
      <p class="text-sm text-gray-500">{$_('profile.server.noDroplet')}</p>
    {/if}
  {/if}

  <!-- Snapshots -->
  {#if subTab === 'snapshots'}
    <DropletSnapshotsPanel
      {profile}
      hasDoApiKey={hasDoApiKey}
      dropletName={droplet?.name || ''}
    />
  {/if}

  <!-- DNS -->
  {#if subTab === 'dns'}
    <div class="flex items-center justify-between flex-wrap gap-2">
      <h2 class="text-sm font-semibold text-gray-300">
        {$_('profile.server.dnsTitle')}
        {#if dnsDomain}<span class="text-gray-500 font-normal"> — {dnsDomain}</span>{/if}
      </h2>
      <div class="flex gap-2">
        <button type="button" onclick={loadDns} disabled={dnsLoading}
          class="text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-300 hover:bg-gray-800">{$_('profile.server.refresh')}</button>
        <button type="button" onclick={openNewRecord}
          class="text-xs px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-500">{$_('profile.server.dnsAdd')}</button>
      </div>
    </div>

    {#if dnsAnalysis?.needsFix}
      <div class="rounded-lg border border-amber-700/50 bg-amber-950/30 p-4 text-sm">
        <p class="text-amber-200">{$_('profile.server.dnsFixBanner')}</p>
        <p class="text-xs text-gray-400 mt-1">{$_('profile.server.dnsFixDetail', { values: { ip: dropletIp || '?' } })}</p>
        <button type="button" onclick={fixARecord} disabled={fixBusy}
          class="mt-3 text-xs px-3 py-1.5 rounded bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-50">
          {fixBusy ? $_('common.loading') : $_('profile.server.dnsFixAction')}
        </button>
      </div>
    {/if}

    {#if dnsLoading}
      <p class="text-sm text-gray-500">{$_('common.loading')}</p>
    {:else if dnsError}
      <p class="text-sm text-red-400">{dnsError}</p>
    {:else}
      <div class="overflow-x-auto rounded-lg border border-gray-800">
        <table class="w-full text-xs text-left">
          <thead class="bg-gray-900 text-gray-500">
            <tr>
              <th class="px-3 py-2">{$_('profile.server.dnsType')}</th>
              <th class="px-3 py-2">{$_('profile.server.dnsName')}</th>
              <th class="px-3 py-2">{$_('profile.server.dnsData')}</th>
              <th class="px-3 py-2">TTL</th>
              <th class="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {#each dnsRecords as r}
              <tr class="border-t border-gray-800 hover:bg-gray-900/50">
                <td class="px-3 py-2 text-gray-300">{r.type}</td>
                <td class="px-3 py-2 text-gray-200">{r.name}</td>
                <td class="px-3 py-2 text-gray-400 font-mono break-all max-w-xs">{r.data}</td>
                <td class="px-3 py-2 text-gray-500">{r.ttl}</td>
                <td class="px-3 py-2 text-right whitespace-nowrap">
                  <button type="button" onclick={() => openEditRecord(r)} class="text-indigo-400 hover:text-indigo-300 mr-2">{$_('common.edit')}</button>
                  <button type="button" onclick={() => deleteRecord(r)} class="text-red-500 hover:text-red-400">{$_('common.delete')}</button>
                </td>
              </tr>
            {:else}
              <tr><td colspan="5" class="px-3 py-4 text-gray-500 text-center">{$_('profile.server.dnsEmpty')}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

    {#if showRecordForm}
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog">
        <div class="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md space-y-3">
          <h3 class="text-white font-medium">{editingRecord ? $_('profile.server.dnsEdit') : $_('profile.server.dnsAdd')}</h3>
          <label class="block text-xs text-gray-500">
            {$_('profile.server.dnsType')}
            <select bind:value={recordForm.type} class="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white">
              <option>A</option><option>AAAA</option><option>CNAME</option><option>MX</option><option>TXT</option><option>CAA</option>
            </select>
          </label>
          <label class="block text-xs text-gray-500">
            {$_('profile.server.dnsName')}
            <input bind:value={recordForm.name} class="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white" />
          </label>
          <label class="block text-xs text-gray-500">
            {$_('profile.server.dnsData')}
            <input bind:value={recordForm.data} class="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white" />
          </label>
          {#if recordForm.type === 'MX'}
            <label class="block text-xs text-gray-500">
              {$_('profile.server.dnsPriority')}
              <input type="number" bind:value={recordForm.priority} class="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white" />
            </label>
          {/if}
          <label class="block text-xs text-gray-500">
            TTL
            <input type="number" bind:value={recordForm.ttl} class="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white" />
          </label>
          <div class="flex justify-end gap-2 pt-2">
            <button type="button" onclick={() => showRecordForm = false} class="text-sm text-gray-400">{$_('common.cancel')}</button>
            <button type="button" onclick={saveRecord} disabled={recordSaving}
              class="text-sm px-4 py-1.5 rounded bg-indigo-600 text-white disabled:opacity-50">
              {recordSaving ? $_('common.loading') : $_('common.save')}
            </button>
          </div>
        </div>
      </div>
    {/if}
  {/if}

  <!-- Files -->
  {#if subTab === 'files'}
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="text-xs text-gray-500">
        {$_('profile.server.filesRoot')}: <span class="font-mono text-gray-300">{fileRoot || '…'}</span>
      </div>
      <div class="flex items-center gap-3">
        <label class="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
          <input type="checkbox" bind:checked={showHidden} onchange={loadFiles} class="rounded" />
          {$_('profile.server.showHidden')}
        </label>
        <button type="button" onclick={loadFiles} class="text-xs text-gray-400 hover:text-white">{$_('profile.server.refresh')}</button>
        <button type="button" onclick={() => uploadInput?.click()}
          class="text-xs px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-500">{$_('profile.server.upload')}</button>
        <input type="file" class="hidden" bind:this={uploadInput} onchange={onUploadSelected} />
      </div>
    </div>

  <nav class="flex flex-wrap items-center gap-1 text-xs text-gray-500">
    <button type="button" onclick={() => navigateTo('')} class="hover:text-indigo-300">/</button>
    {#each breadcrumbs as part, i}
      <span>/</span>
      <button type="button" onclick={() => crumbJump(i)} class="hover:text-indigo-300">{part}</button>
    {/each}
  </nav>

    {#if filesLoading}
      <p class="text-sm text-gray-500">{$_('common.loading')}</p>
    {:else if filesError}
      <p class="text-sm text-red-400">{filesError}</p>
    {:else}
      <div class="rounded-lg border border-gray-800 overflow-hidden">
        <table class="w-full text-xs">
          <thead class="bg-gray-900 text-gray-500">
            <tr>
              <th class="px-3 py-2 text-left">{$_('profile.server.filesName')}</th>
              <th class="px-3 py-2 text-right">{$_('profile.server.filesSize')}</th>
              <th class="px-3 py-2 text-right">{$_('profile.server.filesMode')}</th>
              <th class="px-3 py-2 text-right">{$_('profile.server.filesModified')}</th>
              <th class="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {#if filePath}
              <tr class="border-t border-gray-800 hover:bg-gray-900/50 cursor-pointer" onclick={() => {
                const parts = filePath.split('/');
                parts.pop();
                navigateTo(parts.join('/'));
              }}>
                <td class="px-3 py-2 text-indigo-400" colspan="5">..</td>
              </tr>
            {/if}
            {#each fileEntries as e}
              <tr class="border-t border-gray-800 hover:bg-gray-900/50">
                <td class="px-3 py-2">
                  {#if renamePath === e.path}
                    <input bind:value={renameValue} class="bg-gray-800 border border-gray-600 rounded px-1 py-0.5 text-white w-full"
                      onkeydown={(ev) => ev.key === 'Enter' && commitRename()} />
                  {:else if e.isDirectory}
                    <button type="button" onclick={() => enterDir(e.name)} class="text-indigo-300 hover:underline">📁 {e.name}</button>
                  {:else}
                    <span class="text-gray-200">📄 {e.name}</span>
                  {/if}
                </td>
                <td class="px-3 py-2 text-right text-gray-500">{e.isDirectory ? '—' : fmtBytes(e.size)}</td>
                <td class="px-3 py-2 text-right text-gray-600 font-mono">{e.mode}</td>
                <td class="px-3 py-2 text-right text-gray-500">{fmtDate(e.mtime)}</td>
                <td class="px-3 py-2 text-right whitespace-nowrap">
                  {#if renamePath === e.path}
                    <button type="button" onclick={commitRename} class="text-green-400 mr-1">{$_('common.save')}</button>
                    <button type="button" onclick={() => renamePath = ''} class="text-gray-500">{$_('common.cancel')}</button>
                  {:else}
                    {#if !e.isDirectory}
                      <button type="button" onclick={() => viewFile(e.path)} class="text-gray-400 hover:text-white mr-1">{$_('profile.server.view')}</button>
                      <button type="button" onclick={() => downloadFile(e.path)} class="text-gray-400 hover:text-white mr-1">↓</button>
                    {/if}
                    <button type="button" onclick={() => startRename(e.path)} class="text-gray-400 hover:text-white mr-1">{$_('profile.server.rename')}</button>
                    <button type="button" onclick={() => deleteFile(e.path, e.isDirectory)} class="text-red-500 hover:text-red-400">{$_('common.delete')}</button>
                  {/if}
                </td>
              </tr>
            {:else}
              <tr><td colspan="5" class="px-3 py-6 text-center text-gray-500">{$_('profile.server.filesEmpty')}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

    {#if viewOpen}
      <div class="mt-4 rounded-lg border border-gray-800 bg-gray-950">
        <div class="flex items-center justify-between px-3 py-2 border-b border-gray-800">
          <span class="text-xs font-mono text-gray-400">{viewPath}</span>
          <button type="button" onclick={() => viewOpen = false} class="text-xs text-gray-500 hover:text-white">{$_('common.close')}</button>
        </div>
        <pre class="p-3 text-xs text-gray-300 overflow-auto max-h-96 whitespace-pre-wrap">{viewContent}</pre>
      </div>
    {/if}
  {/if}
</div>
