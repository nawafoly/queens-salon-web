import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];

const AUDIT_EXTENSIONS = new Set([
  ...SOURCE_EXTENSIONS,
  ".sql",
]);

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "dist-staff",
  "coverage",
  ".wrangler",
  ".vite",
  "build",
]);

const SCAN_ROOTS = [
  "src",
  "workers",
  "scripts",
  "migrations",
];

const TOKENS = [
  ["customWorkingHours", /\bcustomWorkingHours\b/g],
  ["customWorkingHourOverrides", /\bcustomWorkingHourOverrides\b/g],
  ["workingScheduleVersions", /\bworkingScheduleVersions\b/g],
  ["exceptionalLeaveWeekdays", /\bexceptionalLeaveWeekdays\b/g],
  ["exceptionalLeaveDates", /\bexceptionalLeaveDates\b/g],
  ["staff_schedules", /\bstaff_schedules\b/g],
  ["leave_start_date", /\bleave_start_date\b/g],
  ["leave_end_date", /\bleave_end_date\b/g],
  ["resolveTodaySchedule", /\bresolveTodaySchedule\b/g],
  ["collectWorkingWindows", /\bcollectWorkingWindows\b/g],
];

function posix(value) {
  return value.split(path.sep).join("/");
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;

    const absolute = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(absolute, out);
      continue;
    }

    if (AUDIT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      out.push(posix(path.relative(root, absolute)));
    }
  }

  return out;
}

const allFiles = [
  ...new Set(
    SCAN_ROOTS.flatMap((scanRoot) =>
      walk(path.join(root, scanRoot))
    )
  ),
].sort();

const sourceFiles = new Set(
  allFiles.filter((file) =>
    SOURCE_EXTENSIONS.includes(path.extname(file).toLowerCase())
  )
);

const textCache = new Map();

function read(file) {
  if (!textCache.has(file)) {
    textCache.set(
      file,
      fs
        .readFileSync(path.join(root, file), "utf8")
        .replace(/\r\n/g, "\n")
    );
  }

  return textCache.get(file);
}

function resolveRelativeImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return "";

  const base = posix(
    path.normalize(
      path.join(path.dirname(fromFile), specifier)
    )
  );

  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...SOURCE_EXTENSIONS.map((ext) => `${base}/index${ext}`),
  ];

  return candidates.find((candidate) => sourceFiles.has(candidate)) || "";
}

function isTypeOnlyImport(prefix, clause) {
  if (String(prefix || "").trim()) return true;

  const trimmed = String(clause || "").trim();

  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return false;
  }

  const names = trimmed
    .slice(1, -1)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  return (
    names.length > 0 &&
    names.every((part) => part.startsWith("type "))
  );
}

function runtimeImports(file) {
  if (!sourceFiles.has(file)) return [];

  const text = read(file);
  const imports = [];

  const importRe =
    /\bimport\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']\s*;?/g;

  for (const match of text.matchAll(importRe)) {
    if (isTypeOnlyImport(match[1], match[2])) continue;

    const resolved = resolveRelativeImport(file, match[3]);

    if (resolved) imports.push(resolved);
  }

  const sideEffectRe =
    /\bimport\s+["']([^"']+)["']\s*;?/g;

  for (const match of text.matchAll(sideEffectRe)) {
    const resolved = resolveRelativeImport(file, match[1]);

    if (resolved) imports.push(resolved);
  }

  const dynamicRe =
    /\bimport\(\s*["']([^"']+)["']\s*\)/g;

  for (const match of text.matchAll(dynamicRe)) {
    const resolved = resolveRelativeImport(file, match[1]);

    if (resolved) imports.push(resolved);
  }

  return [...new Set(imports)];
}

const runtimeRoots = [
  "src/pages/Booking.tsx",
  "src/pages/BookingInternal.tsx",
  "src/features/internal-booking-v2/BookingInternalV2.tsx",
  "src/pages/Checkout.tsx",
  "src/pages/DashboardEmployees.tsx",
  "src/pages/dashboardEmployees/BookingSettingsSection.tsx",
  "src/pages/dashboardEmployees/AttendanceSection.tsx",
  "src/components/AttendanceMonthView.tsx",
  "src/pages/hr/EmployeeOverview.tsx",
  "src/pages/PartnerPortal.tsx",
  "src/services/CoreHrService.ts",
  "src/services/temporaryWeeklyOffService.ts",
  "src/services/StaffPerformanceService.ts",
  "src/services/employeeDirectory.ts",
  "src/services/employeeHub.ts",
  "src/services/firestoreStaffPublic.ts",
  "src/services/coreBookingMappers.ts",
  "src/helpers/hr/attendanceShiftResolver.ts",
  "src/helpers/hr/attendanceCalendarData.ts",
  "workers/core/index.js",
  "workers/hr-core-worker.js",
  "workers/partners-worker.js",
].filter((file) => sourceFiles.has(file));

const reachable = new Set();
const queue = [...runtimeRoots];

while (queue.length) {
  const file = queue.shift();

  if (!file || reachable.has(file)) continue;

  reachable.add(file);

  for (const dependency of runtimeImports(file)) {
    if (!reachable.has(dependency)) {
      queue.push(dependency);
    }
  }
}

const incoming = new Map();

for (const file of sourceFiles) {
  for (const dependency of runtimeImports(file)) {
    incoming.set(
      dependency,
      (incoming.get(dependency) || 0) + 1
    );
  }
}

function lineForIndex(text, index) {
  return text.slice(0, index).split("\n").length;
}

function isCommentOnlyMatch(text, index) {
  const lineStart =
    text.lastIndexOf("\n", Math.max(0, index - 1)) + 1;

  const prefix =
    text.slice(lineStart, index);

  if (prefix.includes("//")) return true;

  const blockOpen =
    text.lastIndexOf("/*", index);

  const blockClose =
    text.lastIndexOf("*/", index);

  return blockOpen > blockClose;
}

function isHistoryTestOrMigration(file) {
  return (
    file.startsWith("migrations/") ||
    file.startsWith("scripts/migrate-") ||
    file.startsWith("scripts/check-") ||
    file.startsWith("scripts/audit-") ||
    /(?:\.test\.|\.spec\.|__tests__|\/tests?\/)/.test(file)
  );
}

function isAllowedCompatibility(file) {
  return file.startsWith("src/types/");
}

const category1 = [];
const category2 = [];
const category3 = [];
const category4 = [];

function add(target, file, line, label, reason) {
  target.push({
    file,
    line,
    label,
    reason,
  });
}

for (const file of allFiles) {
  const text = read(file);

  for (const [label, sourcePattern] of TOKENS) {
    const pattern = new RegExp(
      sourcePattern.source,
      sourcePattern.flags
    );

    for (const match of text.matchAll(pattern)) {
      const index = match.index || 0;

      if (
        sourceFiles.has(file) &&
        isCommentOnlyMatch(text, index)
      ) {
        continue;
      }

      const line = lineForIndex(text, index);

      if (isHistoryTestOrMigration(file)) {
        add(
          category3,
          file,
          line,
          label,
          "test / migration / architecture guard / audit"
        );
        continue;
      }

      if (isAllowedCompatibility(file, label)) {
        add(
          category2,
          file,
          line,
          label,
          "DTO/storage compatibility only; not a scheduling decision"
        );
        continue;
      }

      if (reachable.has(file)) {
        add(
          category1,
          file,
          line,
          label,
          "reachable scheduling runtime still contains a Legacy scheduling symbol"
        );
        continue;
      }

      if (
        sourceFiles.has(file) &&
        (incoming.get(file) || 0) === 0 &&
        !file.startsWith("src/types/")
      ) {
        add(
          category1,
          file,
          line,
          label,
          "unreferenced active source retains dead scheduling Legacy and should not remain"
        );
        continue;
      }

      add(
        category2,
        file,
        line,
        label,
        "presentation/DTO compatibility outside operational scheduling runtime"
      );
    }
  }
}

const explicitRuntimeRules = [
  {
    file: "src/helpers/hr/attendanceShiftResolver.ts",
    label: "attendance legacy schedule input",
    pattern:
      /AttendanceScheduleInput|\bweeklyOffDay\s*\??\s*:|customWorkingHours|customWorkingHourOverrides|workingScheduleVersions|exceptionalLeaveWeekdays|exceptionalLeaveDates/,
    reason:
      "Attendance scheduling must consume CoreResolvedShift and fail closed.",
  },
  {
    file: "src/helpers/hr/attendanceCalendarData.ts",
    label: "attendance profile leave fallback",
    pattern:
      /profile\.exceptionalLeaveDates|profile\.onLeave|profile_exceptional_leave_date|source:\s*["']profile_leave["']/,
    reason:
      "Attendance special days must come from canonical approved leave records.",
  },
  {
    file: "workers/core/repositories/staff.js",
    label: "parallel staff scheduling resolver",
    pattern:
      /staffIsAvailableForDate|Array\.isArray\(row\?\.schedules\)/,
    reason:
      "Core staff repository must not own a second booking schedule resolver.",
  },
];

for (const rule of explicitRuntimeRules) {
  if (!fs.existsSync(path.join(root, rule.file))) continue;

  const text = read(rule.file);
  const match = rule.pattern.exec(text);

  if (match) {
    add(
      category1,
      rule.file,
      lineForIndex(text, match.index || 0),
      rule.label,
      rule.reason
    );
  }
}

const dashboardFile =
  "src/pages/DashboardEmployees.tsx";

if (fs.existsSync(path.join(root, dashboardFile))) {
  const text = read(dashboardFile);

  const start =
    text.indexOf("const staffScheduleSummary = useMemo");

  const end =
    text.indexOf(
      "\n  const editingStaff = useMemo",
      start
    );

  if (start >= 0 && end > start) {
    const summary = text.slice(start, end);

    const legacy =
      /exceptionalLeaveDates|\(staff as any\)\.onLeave|\(staff as any\)\.leaveUntil|\(staff as any\)\.employmentEndDate|workingScheduleVersions|\(staff as any\)\.customWorkingHours|\(staff as any\)\.customWorkingHourOverrides/;

    const match = legacy.exec(summary);

    if (match) {
      add(
        category1,
        dashboardFile,
        lineForIndex(text, start + (match.index || 0)),
        "Dashboard schedule-summary fallback",
        "Dashboard scheduling presentation still reads non-Core operational state."
      );
    }
  }
}

if (
  fs.existsSync(
    path.join(root, "scripts/set-employee-weekly-off.mjs")
  )
) {
  add(
    category4,
    "scripts/set-employee-weekly-off.mjs",
    1,
    "dual-write weekly-off CLI",
    "parallel scheduling writer outside Malikat Core"
  );
}

const scriptsDir =
  path.join(root, "scripts");

if (fs.existsSync(scriptsDir)) {
  for (
    const entry of fs.readdirSync(
      scriptsDir,
      { withFileTypes: true }
    )
  ) {
    if (
      !entry.isFile() ||
      !/\.(?:js|mjs|cjs)$/.test(entry.name) ||
      /^(?:migrate|audit|check)-/.test(entry.name)
    ) {
      continue;
    }

    const file = `scripts/${entry.name}`;
    const source = read(file);

    const firestoreMutation =
      /firestore\.googleapis\.com|firebase\/firestore|print-access-token/.test(source);

    const schedulingMirror =
      /customWorkingHours|customWorkingHourOverrides|workingScheduleVersions|exceptionalLeaveWeekdays|exceptionalLeaveDates/.test(source);

    if (firestoreMutation && schedulingMirror) {
      add(
        category4,
        file,
        1,
        "Firestore scheduling writer",
        "operational CLI combines Firestore mutation with scheduling mirrors"
      );
    }
  }
}

function printCategory(number, rows, title) {
  console.log(
    `\n=== CATEGORY ${number}: ${title} (${rows.length}) ===`
  );

  if (!rows.length) {
    console.log("NONE");
    return;
  }

  const grouped = new Map();

  for (const row of rows) {
    const current = grouped.get(row.file) || [];
    current.push(row);
    grouped.set(row.file, current);
  }

  for (const [file, fileRows] of grouped) {
    console.log(`\n## ${file}`);
    console.log(`reason: ${fileRows[0].reason}`);
    console.log(`references: ${fileRows.length}`);
    console.log(
      `symbols: ${
        [...new Set(fileRows.map((row) => row.label))].join(", ")
      }`
    );
  }
}

console.log("=== RESIDUAL SCHEDULING LEGACY AUDIT ===");
console.log(`files scanned: ${allFiles.length}`);
console.log(`scheduling runtime reachable: ${reachable.size}`);

printCategory(
  1,
  category1,
  "Runtime decision / dead operational Legacy"
);

printCategory(
  4,
  category4,
  "Parallel Firestore scheduling writer"
);

printCategory(
  2,
  category2,
  "Presentation / DTO compatibility"
);

printCategory(
  3,
  category3,
  "Tests / migrations / guards / history"
);

const highRisk =
  category1.length +
  category4.length;

console.log("\n=== SUMMARY ===");
console.log(`CATEGORY_1_TOTAL: ${category1.length}`);
console.log(`CATEGORY_2_TOTAL: ${category2.length}`);
console.log(`CATEGORY_3_TOTAL: ${category3.length}`);
console.log(`CATEGORY_4_TOTAL: ${category4.length}`);
console.log(`HIGH_RISK_TOTAL: ${highRisk}`);

if (
  process.argv.includes("--fail-on-high-risk") &&
  highRisk > 0
) {
  process.exitCode = 1;
}