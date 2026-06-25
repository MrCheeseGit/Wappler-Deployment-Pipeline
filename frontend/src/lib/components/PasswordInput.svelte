<script>
  import { _ } from 'svelte-i18n';

  export let value = '';
  export let placeholder = '';
  /** @type {(value: string) => void} */
  export let oninput = () => {};

  let visible = false;

  const fieldClass =
    'w-full bg-gray-800 border border-gray-700 rounded-lg pl-3 pr-10 py-2.5 text-white ' +
    'placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
</script>

<div class="relative">
  <input
    type={visible ? 'text' : 'password'}
    {value}
    {placeholder}
    autocomplete="off"
    class={fieldClass}
    oninput={(e) => oninput(e.currentTarget.value)}
  />
  <button
    type="button"
    onclick={() => { visible = !visible; }}
    class="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-gray-500
           hover:text-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
    aria-label={visible ? $_('wizard.step5.hidePassword') : $_('wizard.step5.showPassword')}
    aria-pressed={visible}
  >
    {#if visible}
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858 3.03a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
      </svg>
    {:else}
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
    {/if}
  </button>
</div>
