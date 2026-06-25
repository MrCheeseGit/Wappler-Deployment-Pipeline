<script>
  export let title;
  export let body;
  export let defaultHint = null;
  export let gotcha = null;

  let open = false;
  let container;

  function toggle(e) {
    e.stopPropagation();
    open = !open;
  }

  function handleWindowClick(e) {
    if (container && !container.contains(e.target)) open = false;
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') open = false;
  }
</script>

<svelte:window onclick={handleWindowClick} onkeydown={handleKeydown} />

<span bind:this={container} class="relative inline-flex items-center align-middle">
  <button
    type="button"
    onclick={toggle}
    class="ml-1.5 w-4 h-4 rounded-full bg-gray-700 hover:bg-gray-600 text-gray-300
           text-[10px] font-bold inline-flex items-center justify-center transition shrink-0
           focus:outline-none focus:ring-1 focus:ring-indigo-500"
    aria-label="Help: {title}"
  >?</button>

  {#if open}
    <div
      class="absolute left-6 top-0 z-50 w-72 bg-gray-800 border border-gray-700
             rounded-xl shadow-2xl p-4 text-sm"
      role="tooltip"
    >
      <p class="font-semibold text-white mb-1.5">{title}</p>
      <p class="text-gray-300 leading-relaxed">{body}</p>

      {#if defaultHint}
        <p class="mt-2 text-xs text-gray-400">
          <span class="text-gray-500">Default: </span>{defaultHint}
        </p>
      {/if}

      {#if gotcha}
        <div class="mt-2.5 text-xs text-amber-200 bg-amber-950/40 border border-amber-800/40
                    rounded-lg px-3 py-2 leading-relaxed">
          ⚠ {gotcha}
        </div>
      {/if}
    </div>
  {/if}
</span>
