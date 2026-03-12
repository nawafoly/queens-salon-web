// Centralized Firestore read stats (DEV helper).
// هدفها: كشف الـhotspots (أي docs تتكرر قراءتها) + من أي مكان في الكود.

type SourceCounts = Record<string, number>;

export type FirestoreReadOp =
  | "getDoc"
  | "getDocs"
  | "tx.get"
  | "onSnapshot"
  | "unknown";

export type FirestoreReadStatsEntry = {
  total: number;
  bySource: SourceCounts;
  lastAt: number;
  opCounts: Partial<Record<FirestoreReadOp, number>>;
};

const isDev = typeof import.meta !== "undefined" && (import.meta as any).env?.DEV;
let enabledCache: boolean | null = null;

// Enabled by default in DEV, and can be silenced via `VITE_FS_READ_LOG=0`.
function isEnabled() {
  if (!isDev) return false;
  if (enabledCache !== null) return enabledCache;
  const v = String(((import.meta as any).env?.VITE_FS_READ_LOG ?? "") as any).trim();
  if (!v) {
    enabledCache = true;
    return true;
  }
  enabledCache = v !== "0" && v.toLowerCase() !== "false";
  return enabledCache;
}

const stats = new Map<string, FirestoreReadStatsEntry>();

function bump(path: string, source: string, op: FirestoreReadOp, n = 1) {
  if (!isEnabled()) return;
  const key = String(path || "").trim();
  if (!key) return;
  const src = String(source || "unknown").trim() || "unknown";

  const existing = stats.get(key);
  if (!existing) {
    stats.set(key, {
      total: n,
      bySource: { [src]: n },
      lastAt: Date.now(),
      opCounts: { [op]: n },
    });
    return;
  }

  existing.total += n;
  existing.lastAt = Date.now();
  existing.bySource[src] = (existing.bySource[src] || 0) + n;
  existing.opCounts[op] = (existing.opCounts[op] || 0) + n;
}

function topEntries(limit = 30) {
  return Array.from(stats.entries())
    .sort((a, b) => (b[1]?.total || 0) - (a[1]?.total || 0))
    .slice(0, Math.max(1, limit));
}

function aggregateBySource(filterPrefix = "") {
  const prefix = String(filterPrefix || "").trim();
  const bySource = new Map<string, number>();
  for (const [path, entry] of stats.entries()) {
    if (prefix && !path.startsWith(prefix)) continue;
    const srcs = entry?.bySource || {};
    for (const [src, n] of Object.entries(srcs)) {
      const key = String(src || "unknown").trim() || "unknown";
      bySource.set(key, (bySource.get(key) || 0) + (Number(n || 0) || 0));
    }
  }
  return bySource;
}

function aggregateByOp(filterPrefix = "") {
  const prefix = String(filterPrefix || "").trim();
  const byOp = new Map<FirestoreReadOp, number>();
  for (const [path, entry] of stats.entries()) {
    if (prefix && !path.startsWith(prefix)) continue;
    const ops = entry?.opCounts || {};
    (Object.entries(ops) as Array<[FirestoreReadOp, number]>).forEach(([op, n]) => {
      byOp.set(op, (byOp.get(op) || 0) + (Number(n || 0) || 0));
    });
  }
  return byOp;
}

function topSources(limit = 30, filterPrefix = "") {
  const rows = Array.from(aggregateBySource(filterPrefix).entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, limit))
    .map(([source, total]) => ({ source, total }));
  return rows;
}

function dumpSources(limit = 30, filterPrefix = "") {
  if (!isEnabled()) return [];
  const rows = topSources(limit, filterPrefix);
  // eslint-disable-next-line no-console
  console.table(rows);
  return rows;
}

function dumpOps(filterPrefix = "") {
  if (!isEnabled()) return [];
  const rows = Array.from(aggregateByOp(filterPrefix).entries())
    .sort((a, b) => b[1] - a[1])
    .map(([op, total]) => ({ op, total }));
  // eslint-disable-next-line no-console
  console.table(rows);
  return rows;
}

const DEFAULT_PREFIXES = [
  // Core booking model
  "salons/main/booking_slots/",
  "salons/main/availability_days/",
  "salons/main/bookings/",
  "salons/main/booking_tracks/",
  "salons/main/counters/",
  // Finance
  "salons/main/income/",
  "salons/main/expenses/",
  // Staff/users
  "salons/main/staff_public/",
  "salons/main/users/",
  "users/",
];

function dumpPrefixSummary(prefixes = DEFAULT_PREFIXES) {
  if (!isEnabled()) return [];

  const wanted = (prefixes || []).map((p) => String(p || "").trim()).filter(Boolean);
  const totalsByPrefix: Array<{ prefix: string; total: number; lastAt: number }> = wanted.map(
    (prefix) => ({ prefix, total: 0, lastAt: 0 })
  );

  let grandTotal = 0;
  for (const [path, entry] of stats.entries()) {
    grandTotal += Number(entry?.total || 0) || 0;
    for (const row of totalsByPrefix) {
      if (!path.startsWith(row.prefix)) continue;
      row.total += Number(entry?.total || 0) || 0;
      row.lastAt = Math.max(row.lastAt, Number(entry?.lastAt || 0) || 0);
      break;
    }
  }

  const covered = totalsByPrefix.reduce((s, r) => s + (Number(r.total || 0) || 0), 0);
  const other = Math.max(0, grandTotal - covered);

  const rows = [
    ...totalsByPrefix.filter((r) => r.total > 0).sort((a, b) => b.total - a.total),
    ...(other > 0 ? [{ prefix: "(other)", total: other, lastAt: Date.now() }] : []),
    { prefix: "(grand_total)", total: grandTotal, lastAt: Date.now() },
  ];

  // eslint-disable-next-line no-console
  console.table(rows);
  return rows;
}

function reset() {
  stats.clear();
}

function dump(limit = 30, filterPrefix = "") {
  if (!isEnabled()) return [];
  const prefix = String(filterPrefix || "").trim();
  const rows = Array.from(stats.entries())
    .filter(([path]) => (!prefix ? true : path.startsWith(prefix)))
    .sort((a, b) => (b[1]?.total || 0) - (a[1]?.total || 0))
    .slice(0, Math.max(1, limit))
    .map(([path, entry]) => {
      const sources = Object.entries(entry.bySource || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      return {
        path,
        total: entry.total,
        lastAt: entry.lastAt,
        ops: entry.opCounts,
        topSources: sources,
      };
    });

  // eslint-disable-next-line no-console
  console.table(rows);
  return rows;
}

export const FirestoreReadStats = {
  enabled: isEnabled,
  bump,
  reset,
  dump,
  dumpSources,
  dumpOps,
  dumpPrefixSummary,
  topEntries,
  topSources,
};

declare global {
  interface Window {
    __fsReads?: typeof FirestoreReadStats;
  }
}

if (isDev && typeof window !== "undefined") {
  window.__fsReads = FirestoreReadStats;
}
