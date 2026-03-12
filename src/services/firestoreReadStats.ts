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
  topEntries,
};

declare global {
  interface Window {
    __fsReads?: typeof FirestoreReadStats;
  }
}

if (isDev && typeof window !== "undefined") {
  window.__fsReads = FirestoreReadStats;
}
