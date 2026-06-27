<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { _, locale } from 'svelte-i18n';

  /** Profile name for per-profile heatmap; omit for fleet-wide (all profiles). */
  export let profile = '';
  /** Smaller cells and tighter layout for embedded use. */
  export let compact = false;
  /** Fleet dashboard: cells are visual only (avoids hundreds of buttons intercepting clicks). */
  export let interactive = true;

  let activity = null;
  let loading = true;
  let error = '';

  const DAY_LABEL_ROWS = [1, 3, 5];
  const LABEL_COL_PX = 32;

  /** Must match cellClasses() — used in legend swatches. */
  const LEVEL_SWATCH = [
    '',
    'bg-indigo-950 border border-indigo-800/80',
    'bg-indigo-800/90 border border-indigo-700/80',
    'bg-indigo-600 border border-indigo-500/80',
    'bg-indigo-400 border border-indigo-300/90',
  ];

  $: CELL_PX = compact ? 10 : 12;
  $: GAP_PX = compact ? 2 : 3;

  onMount(load);

  export async function refresh() {
    await load();
  }

  async function load() {
    loading = true;
    error = '';
    try {
      const url = profile
        ? `/api/deploy/${encodeURIComponent(profile)}/activity`
        : '/api/deploy/activity';
      const res = await api.get(url);
      activity = res.activity;
    } catch (err) {
      activity = null;
      error = err.message || 'Failed to load activity';
    } finally {
      loading = false;
    }
  }

  /** Tooltip / aria date string in the active WDP locale. */
  function fmtDate(dateStr, loc) {
    if (!dateStr) return '';
    const tag = loc || 'en';
    return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString(tag, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  function monthMarkers(weeks, _loc) {
    if (!weeks?.length) return [];
    const out = [];
    let lastMonth = -1;
    for (let i = 0; i < weeks.length; i += 1) {
      const d = new Date(`${weeks[i].days[0].date}T12:00:00Z`);
      const m = d.getUTCMonth();
      if (m !== lastMonth) {
        out.push({
          col: i,
          label: $_(`deployActivity.months.${m}`),
        });
        lastMonth = m;
      }
    }
    return out;
  }

  function cellClasses(day) {
    const base = 'block w-full aspect-square max-h-full rounded-sm';
    if (!day?.total) {
      return `${base} bg-gray-800/90 border border-gray-700/60`;
    }
    const level = day.level ?? 0;
    let cls = `${base} ${LEVEL_SWATCH[level] || LEVEL_SWATCH[4]}`;
    if (day.hasFailed) cls += ' ring-1 ring-red-500/70';
    return cls;
  }

  function tooltipText(day, loc) {
    const date = fmtDate(day.date, loc);
    if (!day.total) {
      return $_('deployActivity.tooltipNone', { values: { date } });
    }
    return $_('deployActivity.tooltipDay', {
      values: {
        date,
        total: day.total,
        success: day.success,
        failed: day.failed,
      },
    });
  }

  $: weeks = activity?.weeks || [];
  $: activeLocale = $locale || 'en';
  $: markers = monthMarkers(weeks, activeLocale);
  $: markerByCol = Object.fromEntries(markers.map((m) => [m.col, m.label]));
  $: colTemplate = `${LABEL_COL_PX}px repeat(${weeks.length || 1}, minmax(${CELL_PX}px, 1fr))`;
  $: titleKey = profile
    ? $_('deployActivity.titleProfile', { values: { profile } })
    : $_('deployActivity.title');
  $: legendHintKey = profile ? 'deployActivity.legendHintProfile' : 'deployActivity.legendHint';
</script>

<section
  class="rounded-xl border border-gray-700/80 bg-gray-800/25 overflow-hidden {compact ? 'p-3' : 'p-5'}"
  aria-label={titleKey}
>
  <div class="flex flex-wrap items-baseline justify-between gap-2 {compact ? 'mb-2' : 'mb-4'}">
    <h3 class="{compact ? 'text-xs' : 'text-sm'} font-semibold text-gray-200">{titleKey}</h3>
    {#if activity && !loading}
      <p class="text-xs text-gray-500">
        {$_('deployActivity.deploysInRange', {
          values: { count: activity.totalContributions },
        })}
      </p>
    {/if}
  </div>

  {#if loading}
    <div class="flex items-center gap-2 text-sm text-gray-500 py-4">
      <div class="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
      {$_('deployActivity.loading')}
    </div>
  {:else if error}
    <p class="text-sm text-amber-400">{error}</p>
  {:else if weeks.length === 0}
    <p class="text-sm text-gray-500">{$_('deployActivity.empty')}</p>
  {:else}
    <div class="w-full min-w-0 pb-1">
      <!-- Full-width grid: week columns grow equally; month row shares same template -->
      <div
        class="grid w-full"
        style="grid-template-columns: {colTemplate}; gap: {GAP_PX}px;"
      >
        <div class="h-3.5 min-w-0" aria-hidden="true"></div>
        {#each weeks as week, wi (week.weekStart)}
          <div class="h-3.5 relative min-w-0 overflow-visible">
            {#if markerByCol[wi]}
              <span class="absolute left-0 top-0 text-[10px] leading-none text-gray-500 whitespace-nowrap pointer-events-none">
                {markerByCol[wi]}
              </span>
            {/if}
          </div>
        {/each}

        {#each [0, 1, 2, 3, 4, 5, 6] as row}
          <div class="flex items-center justify-end pr-0.5 min-w-0 text-[10px] text-gray-500 leading-none">
            {#if DAY_LABEL_ROWS.includes(row)}
              <span>
                {row === 1 ? $_('deployActivity.mon') : row === 3 ? $_('deployActivity.wed') : $_('deployActivity.fri')}
              </span>
            {/if}
          </div>
          {#each weeks as week, wi (`${row}-${week.weekStart}`)}
            {@const day = week.days[row]}
            {@const cellClass = cellClasses(day)}
            {#if interactive}
              <button
                type="button"
                class="{cellClass} min-w-0 transition hover:ring-1 hover:ring-indigo-300/50 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                title={tooltipText(day, activeLocale)}
                aria-label={tooltipText(day, activeLocale)}
              ></button>
            {:else}
              <div
                class="{cellClass} min-w-0 pointer-events-none"
                title={tooltipText(day, activeLocale)}
                aria-hidden="true"
              ></div>
            {/if}
          {/each}
        {/each}
      </div>
    </div>

    <!-- Legend -->
    <div class="flex flex-wrap items-center justify-between gap-3 mt-3 pt-3 border-t border-gray-700/50">
      <p class="text-[10px] text-gray-500 max-w-md">
        {$_(legendHintKey)}
      </p>
      <div class="flex items-center gap-1.5 text-[10px] text-gray-500 shrink-0">
        <span>{$_('deployActivity.less')}</span>
        <span class="w-3 h-3 rounded-sm bg-gray-800 border border-gray-700/60"></span>
        {#each [1, 2, 3, 4] as lv}
          <span class="w-3 h-3 rounded-sm {LEVEL_SWATCH[lv]}"></span>
        {/each}
        <span>{$_('deployActivity.more')}</span>
        <span class="ml-2 inline-flex items-center gap-1">
          <span class="w-3 h-3 rounded-sm bg-indigo-600 ring-1 ring-red-500/70"></span>
          <span>{$_('deployActivity.failedHint')}</span>
        </span>
      </div>
    </div>
  {/if}
</section>
