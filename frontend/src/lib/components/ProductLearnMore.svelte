<script>
  import { _ } from 'svelte-i18n';

  /** Official product or project URL. Omit to render nothing. */
  export let href = '';
</script>

{#if href}
  <a
    {href}
    target="_blank"
    rel="noopener noreferrer"
    class="inline-flex items-center gap-0.5 text-xs text-indigo-400 hover:text-indigo-300
           underline-offset-2 hover:underline whitespace-nowrap shrink-0"
  >
    {$_('common.learnMore')}
    <span aria-hidden="true">↗</span>
  </a>
{/if}
