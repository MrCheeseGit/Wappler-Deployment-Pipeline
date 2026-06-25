'use strict';

const WEEKS_DEFAULT = 52;

/** UTC calendar date YYYY-MM-DD from ISO timestamp. */
function dateKey(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function emptyDay(date) {
  return { date, total: 0, success: 0, failed: 0, level: 0, hasFailed: false };
}

/**
 * Map deploy count to heat level 1–4 relative to the busiest day in the visible range.
 * (Fixed thresholds 1/2/3/4+ made 5 and 22 deploys look identical.)
 */
function levelFromTotal(total, maxTotal) {
  if (!total || total <= 0) return 0;
  if (!maxTotal || maxTotal <= 0) return 1;
  if (maxTotal === 1) return 4;
  const ratio = total / maxTotal;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

function ensureRollup(history) {
  if (!history.rollup) history.rollup = { byProfile: {} };
  if (!history.rollup.byProfile) history.rollup.byProfile = {};
  return history.rollup;
}

/** Merge deploy history entries into rollup (idempotent backfill). */
function backfillRollupFromEntries(history) {
  const rollup = ensureRollup(history);
  for (const e of history.entries || []) {
    if (!e.profile || !e.startedAt) continue;
    const key = dateKey(e.startedAt);
    if (!key) continue;
    const prof = rollup.byProfile[e.profile] || (rollup.byProfile[e.profile] = {});
    const day = prof[key] || { total: 0, success: 0, failed: 0 };
    // Avoid double-counting when re-backfilling: only add if we're rebuilding
    // Caller clears first when needed.
    day.total += 1;
    if (e.outcome === 'success') day.success += 1;
    else if (e.outcome === 'failed') day.failed += 1;
    prof[key] = day;
  }
  return rollup;
}

/**
 * Rebuild rollup from entries (used once when rollup was empty).
 */
function rebuildRollupIfEmpty(history) {
  const rollup = ensureRollup(history);
  const hasAny = Object.keys(rollup.byProfile).some(
    p => Object.keys(rollup.byProfile[p] || {}).length > 0
  );
  if (hasAny) return rollup;
  rollup.byProfile = {};
  backfillRollupFromEntries(history);
  return rollup;
}

/**
 * Increment rollup when a deploy history entry is appended.
 */
function applyEntryToRollup(history, entry) {
  const rollup = ensureRollup(history);
  const key = dateKey(entry.startedAt);
  if (!key || !entry.profile) return;
  const prof = rollup.byProfile[entry.profile] || (rollup.byProfile[entry.profile] = {});
  const day = prof[key] || { total: 0, success: 0, failed: 0 };
  day.total += 1;
  if (entry.outcome === 'success') day.success += 1;
  else if (entry.outcome === 'failed') day.failed += 1;
  prof[key] = day;
}

/** Sunday (UTC) at start of the week containing `d`. */
function startOfWeekSundayUtc(d) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - x.getUTCDay());
  return x;
}

function addUtcDays(d, n) {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function mergeDayMaps(maps) {
  const out = {};
  for (const m of maps) {
    for (const [date, counts] of Object.entries(m || {})) {
      const cur = out[date] || { total: 0, success: 0, failed: 0 };
      cur.total += counts.total || 0;
      cur.success += counts.success || 0;
      cur.failed += counts.failed || 0;
      out[date] = cur;
    }
  }
  return out;
}

/**
 * Build GitHub-style week grid from a date → counts map.
 * @param {Record<string, {total,success,failed}>} dayMap
 * @param {number} weeks
 */
function buildActivityGrid(dayMap, weeks = WEEKS_DEFAULT) {
  const today = new Date();
  const currentWeekStart = startOfWeekSundayUtc(today);
  const gridStart = addUtcDays(currentWeekStart, -(weeks - 1) * 7);

  let maxTotal = 0;
  for (let w = 0; w < weeks; w += 1) {
    const weekStart = addUtcDays(gridStart, w * 7);
    for (let dow = 0; dow < 7; dow += 1) {
      const d = addUtcDays(weekStart, dow);
      const date = d.toISOString().slice(0, 10);
      const t = dayMap[date]?.total || 0;
      if (t > maxTotal) maxTotal = t;
    }
  }

  const weekCols = [];
  let totalContributions = 0;

  for (let w = 0; w < weeks; w += 1) {
    const weekStart = addUtcDays(gridStart, w * 7);
    const days = [];
    for (let dow = 0; dow < 7; dow += 1) {
      const d = addUtcDays(weekStart, dow);
      const date = d.toISOString().slice(0, 10);
      const raw = dayMap[date];
      const total = raw?.total || 0;
      const success = raw?.success || 0;
      const failed = raw?.failed || 0;
      const level = levelFromTotal(total, maxTotal);
      if (total > 0) totalContributions += total;
      days.push({
        date,
        total,
        success,
        failed,
        level,
        hasFailed: failed > 0,
      });
    }
    weekCols.push({
      weekStart: weekStart.toISOString().slice(0, 10),
      days,
    });
  }

  const rangeStart = gridStart.toISOString().slice(0, 10);
  const rangeEnd = today.toISOString().slice(0, 10);

  return {
    weeks: weekCols,
    totalContributions,
    maxDayTotal: maxTotal,
    rangeStart,
    rangeEnd,
    weeksCount: weeks,
  };
}

/**
 * @param {object} history - full deploy-history.json payload
 * @param {string|null} profileName - null = fleet (all profiles)
 */
function buildActivityFromHistory(history, profileName = null) {
  rebuildRollupIfEmpty(history);
  const rollup = history.rollup.byProfile;

  let dayMap = {};
  if (profileName) {
    dayMap = rollup[profileName] || {};
  } else {
    dayMap = mergeDayMaps(Object.values(rollup));
  }

  return buildActivityGrid(dayMap, WEEKS_DEFAULT);
}

module.exports = {
  dateKey,
  ensureRollup,
  backfillRollupFromEntries,
  rebuildRollupIfEmpty,
  applyEntryToRollup,
  buildActivityFromHistory,
  buildActivityGrid,
  levelFromTotal,
  WEEKS_DEFAULT,
};
