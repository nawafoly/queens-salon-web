// Compare two sanitized D1 Insights profiles without claiming full D1 usage.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ownFile = fileURLToPath(import.meta.url);
const metric = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;

export function sampledQueryRows(database) {
  const byFingerprint = new Map();
  for (const group of ['mostRowsRead', 'mostFrequent', 'slowestAverage']) {
    for (const row of database?.[group] || []) {
      if (!/^[0-9a-f]{16}$/.test(String(row?.id || ''))) continue;
      const candidate = {
        id: row.id,
        kind: String(row.kind || 'OTHER').slice(0, 12),
        tables: Array.isArray(row.tables)
          ? row.tables.filter(v => /^[a-z_][a-z0-9_]{0,63}$/.test(String(v))).slice(0, 8)
          : [],
        executions: metric(row.executions),
        rowsRead: metric(row.rowsRead),
        avgRowsRead: metric(row.avgRowsRead),
        avgDurationMs: metric(row.avgDurationMs),
      };
      const before = byFingerprint.get(row.id);
      if (!before || candidate.rowsRead > before.rowsRead) byFingerprint.set(row.id, candidate);
    }
  }
  return byFingerprint;
}

function difference(before, after) {
  return {
    baseline: before,
    followup: after,
    delta: after - before,
    percentChange: before > 0 ? Number(((after - before) * 100 / before).toFixed(1)) : null,
  };
}

export function compareProfiles(baseline, followup) {
  if (!baseline || !followup || baseline.period !== followup.period ||
      !['1d', '7d'].includes(baseline.period)) {
    throw new Error('INSIGHTS_COMPARISON_PERIOD_MISMATCH');
  }
  if (!baseline.databases || !followup.databases ||
      typeof baseline.databases !== 'object' ||
      typeof followup.databases !== 'object') {
    throw new Error('INSIGHTS_COMPARISON_INVALID_REPORT');
  }

  const databases = {};
  for (const [db, oldProfile] of Object.entries(baseline.databases)) {
    if (!['queens-salon-core', 'malikat-attendance'].includes(db)) continue;
    const newProfile = followup.databases[db];
    if (!newProfile) throw new Error('INSIGHTS_COMPARISON_DATABASE_MISSING');

    const oldRows = sampledQueryRows(oldProfile);
    const newRows = sampledQueryRows(newProfile);
    const shared = [], disappeared = [], newEntries = [];
    for (const [id, old] of oldRows) {
      const fresh = newRows.get(id);
      if (!fresh) {
        disappeared.push({ id, tables: old.tables, previouslyObservedRowsRead: old.rowsRead });
        continue;
      }
      shared.push({
        id, kind: old.kind, tables: old.tables,
        executions: difference(old.executions, fresh.executions),
        rowsRead: difference(old.rowsRead, fresh.rowsRead),
        avgRowsRead: difference(old.avgRowsRead, fresh.avgRowsRead),
        avgDurationMs: difference(old.avgDurationMs, fresh.avgDurationMs),
      });
    }
    for (const [id, current] of newRows) {
      if (!oldRows.has(id)) newEntries.push({
        id, tables: current.tables, observedRowsRead: current.rowsRead,
      });
    }
    databases[db] = {
      baselineObservedFingerprints: oldRows.size,
      followupObservedFingerprints: newRows.size,
      overlappingFingerprints: shared.length,
      compared: shared.sort((a, b) => b.rowsRead.baseline - a.rowsRead.baseline).slice(0, 30),
      absentFromFollowupTopN: disappeared.sort((a, b) => b.previouslyObservedRowsRead - a.previouslyObservedRowsRead),
      newInFollowupTopN: newEntries.sort((a, b) => b.observedRowsRead - a.observedRowsRead),
    };
  }
  if (!Object.keys(databases).length) throw new Error('INSIGHTS_COMPARISON_NO_SUPPORTED_DATABASE');
  return {
    period: baseline.period,
    caveat: 'Each profile contains only top-N sampled D1 Insights. Absent fingerprints are NOT zero reads; changes may reflect different traffic volume and query ranking. This is NOT a total daily D1 usage or proven cost-saving calculation. Compare equivalent traffic and use the Cloudflare dashboard for actual quota consumption.',
    databases,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === ownFile) {
  try {
    const [first, second] = process.argv.slice(2);
    if (!first || !second) throw new Error('USAGE: node scripts/compare-d1-read-cost.mjs BASELINE.json FOLLOWUP.json');
    const baseline = JSON.parse(readFileSync(first, 'utf8').replace(/^\uFEFF/, ''));
    const followup = JSON.parse(readFileSync(second, 'utf8').replace(/^\uFEFF/, ''));
    process.stdout.write(JSON.stringify(compareProfiles(baseline, followup), null, 2) + '\n');
  } catch (error) {
    // Neither paths nor contents should leak account data in errors.
    const reason = String(error?.message || 'UNKNOWN');
    console.error(reason.startsWith('INSIGHTS_') || reason.startsWith('USAGE:') ? reason : 'INSIGHTS_COMPARISON_FAILED');
    process.exitCode = 1;
  }
}
