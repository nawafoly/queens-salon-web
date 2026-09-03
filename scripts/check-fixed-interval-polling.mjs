import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SOURCE_ROOT = path.join(ROOT, "src");

const BASELINE = [
  {
    path: "src/components/Hero.tsx",
    marker: "setInterval(() => setNow(new Date()), 60000)",
    kind: "local-only",
    note: "UI clock only; no network or database read.",
  },
  {
    path: "src/pages/DashboardPending.tsx",
    marker: "setInterval(() => void refresh(), 5000)",
    kind: "data-polling-debt",
    note: "Account activation status polling.",
  },
  {
    path: "src/pages/Profile.tsx",
    marker: "setInterval(() => void loadPortal(true), 30_000)",
    kind: "data-polling-debt",
    note: "Client portal polling.",
  },
  {
    path: "src/pages/Dashboard.tsx",
    marker: "setInterval(load, 60_000)",
    kind: "data-polling-debt",
    note: "Missing expense-note count polling.",
  },
  {
    path: "src/pages/Dashboard.tsx",
    marker: "setInterval(tick, 5 * 60_000)",
    kind: "data-polling-debt",
    note: "Booking auto-close scan.",
  },
  {
    path: "src/pages/DashboardQueueTv.tsx",
    marker: "setNowMs(now.getTime())",
    kind: "local-only",
    note: "Queue clock/countdown only; no network or database read.",
  },
  {
    path: "src/pages/DashboardQueueTv.tsx",
    marker: "setInterval(() => void loadBookings(), QUEUE_REFRESH_MS)",
    kind: "data-polling-debt",
    note: "Queue booking refresh polling.",
  },
  {
    path: "src/pages/DashboardDayAudit.tsx",
    marker: "setTodayLimitKey(todayISO())",
    kind: "local-only",
    note: "Local day-boundary clock only; no network or database read.",
  },
  {
    path: "src/pages/DashboardDayAudit.tsx",
    marker: "setInterval(() => void loadCoreAuditData(), 30_000)",
    kind: "data-polling-debt",
    note: "Day audit Core refresh polling.",
  },
  {
    path: "src/pages/DashboardEmployees.tsx",
    marker: "setInterval(() => setNowTick(Date.now()), 60_000)",
    kind: "local-only",
    note: "UI time tick only; no network or database read.",
  },
  {
    path: "src/pages/hr/AdminPermissionRequests.tsx",
    marker: "setInterval(() => void load(), 15_000)",
    kind: "data-polling-debt",
    note: "Permission requests and employee directory polling.",
  },
  {
    path: "src/services/AppSettingsService.ts",
    marker: "setInterval(run, 60_000)",
    kind: "data-polling-debt",
    note: "Core settings polling.",
  },
  {
    path: "src/services/firestoreBookings.ts",
    marker: "setInterval(loadCore, 8_000)",
    kind: "data-polling-debt",
    note: "Core booking watcher polling.",
  },
  {
    path: "src/services/firestoreBookings.ts",
    marker: "setInterval(load, 12_000)",
    kind: "data-polling-debt",
    note: "Employee booking watcher polling.",
  },
];

function normalize(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function walk(directory) {
  const out = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(fullPath));
      continue;
    }
    if (!/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) continue;
    out.push(fullPath);
  }
  return out;
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

if (!fs.existsSync(SOURCE_ROOT)) {
  console.error("[fixed-polling] src directory was not found.");
  process.exit(1);
}

const baselineByPath = new Map();
for (const item of BASELINE) {
  const list = baselineByPath.get(item.path) || [];
  list.push({ ...item, matched: false });
  baselineByPath.set(item.path, list);
}

const occurrences = [];
const violations = [];
const intervalPattern = /\b(?:(?:window|globalThis)\.)?setInterval\s*\(/g;

for (const filePath of walk(SOURCE_ROOT)) {
  const relativePath = path.relative(ROOT, filePath).replaceAll(path.sep, "/");
  const source = fs.readFileSync(filePath, "utf8");
  let match;

  while ((match = intervalPattern.exec(source))) {
    const start = Math.max(0, match.index - 260);
    const end = Math.min(source.length, match.index + 420);
    const context = normalize(source.slice(start, end));
    const candidates = baselineByPath.get(relativePath) || [];
    const baseline = candidates.find(
      (item) => !item.matched && context.includes(normalize(item.marker)),
    );

    const occurrence = {
      path: relativePath,
      line: lineOf(source, match.index),
      baseline,
    };
    occurrences.push(occurrence);

    if (baseline) {
      baseline.matched = true;
    } else {
      violations.push(occurrence);
    }
  }
}

const tracked = occurrences.filter((item) => item.baseline);
const dataDebt = tracked.filter((item) => item.baseline.kind === "data-polling-debt");
const localOnly = tracked.filter((item) => item.baseline.kind === "local-only");
const removedBaseline = [];

for (const items of baselineByPath.values()) {
  for (const item of items) {
    if (!item.matched) removedBaseline.push(item);
  }
}

console.log(
  `[fixed-polling] tracked=${tracked.length} data-polling-debt=${dataDebt.length} local-only=${localOnly.length} new=${violations.length}`,
);

for (const item of dataDebt) {
  console.log(
    `[fixed-polling][debt] ${item.path}:${item.line} - ${item.baseline.note}`,
  );
}

for (const item of removedBaseline) {
  console.log(
    `[fixed-polling][improved] baseline entry no longer present: ${item.path} :: ${item.marker}`,
  );
}

if (violations.length) {
  console.error("\n[fixed-polling] BLOCKED: new untracked setInterval usage detected.");
  for (const item of violations) {
    console.error(`  - ${item.path}:${item.line}`);
  }
  console.error(
    "Use event/focus/mutation-driven refresh, cache/invalidation, or explicitly document a reviewed exception in scripts/check-fixed-interval-polling.mjs.",
  );
  process.exit(1);
}

console.log("[fixed-polling] PASS: no new fixed-interval polling was introduced.");
