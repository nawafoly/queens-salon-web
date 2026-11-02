// Read-only Cloudflare D1 Insights. Never executes SQL or prints SQL text/IDs.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const databases = ['queens-salon-core', 'malikat-attendance'];
const sorts = [['reads', 'sum'], ['count', 'sum'], ['time', 'avg']];
const safeNumber = (x) => Number.isFinite(Number(x)) && Number(x) >= 0 ? Number(x) : 0;

export function parseInsights(text) {
  const str = String(text).trim();
  let rows;
  try { rows = JSON.parse(str); } catch {
    const begin = str.indexOf('['), end = str.lastIndexOf(']');
    if (begin < 0 || end <= begin) throw new Error('INSIGHTS_JSON_MISSING');
    rows = JSON.parse(str.slice(begin, end + 1));
  }
  if (!Array.isArray(rows)) throw new Error('INSIGHTS_EXPECTED_ARRAY');
  return rows;
}

export function summarize(rows) {
  const dedup = new Map();
  for (const row of rows) {
    const query = String(row?.query || '');
    if (!query.trim()) continue;
    const id = createHash('sha256').update(query.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);
    const sqlWithoutLiterals = query.replace(/'(?:''|[^'])*'/g, "''");
    const tables = [...sqlWithoutLiterals.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+[\x60"]?([A-Za-z_]\w{0,63})[\x60"]?/gi)]
      .map((m) => m[1].toLowerCase()).slice(0, 8);
    const item = {
      id,
      kind: /^\s*(SELECT|WITH|UPDATE|INSERT|DELETE|REPLACE)\b/i.exec(query)?.[1]?.toUpperCase() || 'OTHER',
      tables: [...new Set(tables)].sort(),
      executions: safeNumber(row.numberOfTimesRun),
      rowsRead: safeNumber(row.totalRowsRead),
      avgRowsRead: safeNumber(row.avgRowsRead),
      avgDurationMs: safeNumber(row.avgDurationMs),
    };
    // Insights sort categories can contain the same query: never double-count it.
    if (!dedup.has(id) || dedup.get(id).rowsRead < item.rowsRead) dedup.set(id, item);
  }
  const values = [...dedup.values()];
  const top = (metric) => values.toSorted((a, b) => b[metric] - a[metric]).slice(0, 10);
  return {
    note: 'Top-N sampled insights only, not total database consumption. No SQL text or parameters included.',
    queriesObserved: values.length,
    mostRowsRead: top('rowsRead'),
    mostFrequent: top('executions'),
    slowestAverage: top('avgDurationMs'),
  };
}

function live(database, sort, period) {
  const cli = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
  if (!existsSync(cli)) throw new Error('WRANGLER_NOT_INSTALLED_RUN_NPM_CI');
  const command = [cli, 'd1', 'insights', database, \`--time-period=\${period}\`,
    \`--sort-by=\${sort[0]}\`, \`--sort-type=\${sort[1]}\`, '--limit=100', '--json'];
  const response = spawnSync(process.execPath, command,
    { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  if (response.error || response.status !== 0) {
    // Do not echo Wrangler stderr: it may contain account details.
    throw new Error(\`INSIGHTS_FAILED:\${database}:\${sort[0]}:exit=\${response.status ?? 'error'}\`);
  }
  return parseInsights(response.stdout);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const period = args.includes('--7d') ? '7d' : '1d';
    const fileIdx = args.indexOf('--file');
    const report = { period, source: fileIdx >= 0 ? 'offline-fixture' : 'read-only-cloudflare-analytics', databases: {} };
    if (fileIdx >= 0) {
      if (!args[fileIdx + 1]) throw new Error('MISSING_FILE_ARGUMENT');
      report.databases.fixture = summarize(parseInsights(readFileSync(args[fileIdx + 1], 'utf8')));
    } else {
      for (const db of databases) report.databases[db] = summarize(sorts.flatMap((sort) => live(db, sort, period)));
    }
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } catch (error) {
    console.error(String(error?.message || 'INSIGHTS_FAILED'));
    process.exitCode = 1;
  }
}
