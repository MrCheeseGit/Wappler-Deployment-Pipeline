<!--
  SshKeyPathInput.svelte
  Text field + browse button for SSH private key paths (mounted HOME in WDP container).
-->
<script>
  import DirBrowser from '$lib/components/DirBrowser.svelte';
  import { api } from '$lib/api.js';
  import { _ } from 'svelte-i18n';

  export let value = '';
  export let placeholder = '~/.ssh/id_ed25519';
  export let required = false;
  export let disabled = false;
  export let inputClass = 'flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
  /** Called when the path changes (typing or browse). */
  export let onpathchange = () => {};

  let showBrowser = false;
  let keyStatus = ''; // '', 'ok', 'warn', 'checking'
  let keyMessage = '';
  let validateTimer;

  function notifyChange() {
    onpathchange();
    scheduleValidate();
  }

  function scheduleValidate() {
    clearTimeout(validateTimer);
    validateTimer = setTimeout(validateKey, 400);
  }

  async function validateKey() {
    const p = value.trim();
    if (!p) {
      keyStatus = '';
      keyMessage = '';
      return;
    }
    keyStatus = 'checking';
    try {
      const res = await api.get(
        `/api/fs/stat?path=${encodeURIComponent(p)}&kind=sshPrivateKey`,
      );
      keyStatus = res.ok ? 'ok' : 'warn';
      keyMessage = res.message || '';
    } catch (err) {
      keyStatus = 'warn';
      keyMessage = err.message || $_('sshKeyInput.validateFailed');
    }
  }

  function onSelect(filePath) {
    value = filePath;
    showBrowser = false;
    notifyChange();
  }
</script>

<div class="space-y-1 w-full">
  <div class="flex gap-2 w-full">
    <input
      type="text"
      bind:value
      {placeholder}
      {required}
      {disabled}
      class={inputClass}
      oninput={notifyChange}
      onblur={validateKey}
    />
    <button
      type="button"
      onclick={() => { showBrowser = true; }}
      {disabled}
      class="px-3 py-2 text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg shrink-0 disabled:opacity-50"
      title={$_('sshKeyInput.browseTitle')}
    >📁</button>
  </div>

  {#if keyStatus === 'checking'}
    <p class="text-xs text-gray-500">{$_('sshKeyInput.checking')}</p>
  {:else if keyStatus === 'ok'}
    <p class="text-xs text-green-400/90">{keyMessage || $_('sshKeyInput.readable')}</p>
  {:else if keyStatus === 'warn' && keyMessage}
    <p class="text-xs text-amber-400/90">{keyMessage}</p>
  {/if}
</div>

<DirBrowser
  open={showBrowser}
  mode="file"
  fileName=""
  heading={$_('sshKeyInput.browseHeading')}
  onselect={onSelect}
  onclose={() => { showBrowser = false; }}
/>
