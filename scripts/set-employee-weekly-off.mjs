#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolveSpawnInvocation } from "./migrate-packages-d1-to-core.mjs";

const DEFAULT_DATABASE = "queens-salon-core";
const DEFAULT_CONFIG = "wrangler.core.jsonc";
const DEFAULT_PROJECT = "waves-hotel-dashboard";
const DEFAULT_SALON_ID = "main";

const WEEKDAYS = [
  { number: 0, key: "sun", full: "sunday", ar: "الأحد" },
  { number: 1, key: "mon", full: "monday", ar: "الاثنين" },
  { number: 2, key: "tue", full: "tuesday", ar: "الثلاثاء" },
  { number: 3, key: "wed", full: "wednesday", ar: "الأربعاء" },
  { number: 4, key: "thu", full: "thursday", ar: "الخميس" },
  { number: 5, key: "fri", full: "friday", ar: "الجمعة" },
  { number: 6, key: "sat", full: "saturday", ar: "السبت" },
];

function text(value) {
  return String(value ?? "").trim();
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function assertDate(value, field) {
  const clean = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) throw new Error(`${field} must be YYYY-MM-DD`);
  return clean;
}

function previousDate(dateKey) {
  const [year, month, day] = assertDate(dateKey, "date").split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1, 12)).toISOString().slice(0, 10);
}

function weekdayFrom(value) {
  const clean = text(value).toLowerCase();
  const normalizedArabic = clean.replace(/[إأآ]/g, "ا");
  const match = WEEKDAYS.find((day) =>
    [String(day.number), day.key, day.full, day.ar, day.ar.replace(/[إأآ]/g, "ا")]
      .map((item) => item.toLowerCase())
      .includes(normalizedArabic)
  );
  if (!match) throw new Error(`Unknown weekday: ${value}`);
  return match;
}

function parseArgs(argv) {
  const args = {
    apply: false,
    employeeId: "",
    weekday: "",
    effectiveFrom: "",
    salonId: DEFAULT_SALON_ID,
    database: DEFAULT_DATABASE,
    config: DEFAULT_CONFIG,
    project: DEFAULT_PROJECT,
    coreOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--apply") args.apply = true;
    else if (value === "--core-only") args.coreOnly = true;
    else if (value === "--employee-id") args.employeeId = text(argv[++index]);
    else if (value === "--weekday") args.weekday = text(argv[++index]);
    else if (value === "--effective-from") args.effectiveFrom = text(argv[++index]);
    else if (value === "--salon-id") args.salonId = text(argv[++index]) || DEFAULT_SALON_ID;
    else if (value === "--database") args.database = text(argv[++index]) || DEFAULT_DATABASE;
    else if (value === "--config") args.config = text(argv[++index]) || DEFAULT_CONFIG;
    else if (value === "--project") args.project = text(argv[++index]) || DEFAULT_PROJECT;
    else throw new Error(`Unknown argument: ${value}`);
  }

  if (!args.employeeId) throw new Error("--employee-id is required");
  if (!args.weekday) throw new Error("--weekday is required");
  args.effectiveFrom = assertDate(args.effectiveFrom, "--effective-from");
  return args;
}

function run(command, args, { capture = false } = {}) {
  const invocation = resolveSpawnInvocation(command, args);
  const result = spawnSync(invocation.executable, invocation.args, {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: invocation.shell,
  });
  if (result.error || result.status !== 0) {
    const diagnostics = [result.error?.message, text(result.stderr), text(result.stdout)].filter(Boolean).join(" | ");
    throw new Error(`${command} ${args.join(" ")} failed${diagnostics ? `: ${diagnostics}` : ""}`);
  }
  return result.stdout || "";
}

function parseWranglerJson(stdout, label) {
  const raw = text(stdout);
  const firstBracket = raw.indexOf("[");
  const firstBrace = raw.indexOf("{");
  const start = [firstBracket, firstBrace].filter((index) => index >= 0).sort((a, b) => a - b)[0];
  if (start === undefined) throw new Error(`${label}: Wrangler returned no JSON`);
  const parsed = JSON.parse(raw.slice(start));
  const blocks = Array.isArray(parsed) ? parsed : [parsed];
  const rows = [];
  for (const block of blocks) {
    if (Array.isArray(block?.results)) rows.push(...block.results);
    else if (Array.isArray(block?.result?.results)) rows.push(...block.result.results);
  }
  return rows;
}

function d1Json(args, sql) {
  return parseWranglerJson(
    run("npx", [
      "wrangler", "d1", "execute", args.database,
      "--remote", "--command", sql, "--json",
    ], { capture: true }),
    sql
  );
}

function d1Execute(args, sql) {
  return run("npx", [
    "wrangler", "d1", "execute", args.database,
    "--remote", "--command", sql,
  ]);
}

function activeScheduleForDate(rows, weekday, dateKey) {
  return rows
    .filter((row) => Number(row.weekday) === weekday)
    .filter((row) => !text(row.effective_from) || text(row.effective_from) <= dateKey)
    .filter((row) => !text(row.effective_to) || text(row.effective_to) >= dateKey)
    .sort((left, right) => text(right.effective_from || "0000-01-01").localeCompare(text(left.effective_from || "0000-01-01")))[0] || null;
}

function mostCommonWorkingTemplate(rows) {
  const counts = new Map();
  for (const row of rows) {
    if (Number(row.active) !== 1 || !text(row.shift_template_id)) continue;
    const id = text(row.shift_template_id);
    const current = counts.get(id) || { count: 0, row };
    current.count += 1;
    counts.set(id, current);
  }
  return [...counts.values()].sort((left, right) => right.count - left.count)[0]?.row || null;
}

function buildCorePlan({ args, weekday, employee, schedules }) {
  const effectiveFrom = args.effectiveFrom;
  const current = WEEKDAYS.map((day) => activeScheduleForDate(schedules, day.number, effectiveFrom));
  const defaultWorking = mostCommonWorkingTemplate(current.filter(Boolean));
  if (!defaultWorking) {
    throw new Error("No active shift template found to restore non-off workdays safely.");
  }

  const futureDates = schedules
    .map((row) => text(row.effective_from))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date > effectiveFrom)
    .sort();
  const nextFuture = futureDates[0] || "";
  const effectiveTo = nextFuture ? previousDate(nextFuture) : "";
  const beforeDate = previousDate(effectiveFrom);
  const now = new Date().toISOString();

  const nextRows = WEEKDAYS.map((day) => {
    const existing = current[day.number];
    if (day.number === weekday.number) {
      return {
        weekday: day.number,
        active: 0,
        shiftTemplateId: "",
        startTime: "",
        endTime: "",
        scheduleSource: "weekly_off",
      };
    }

    const source = existing && Number(existing.active) === 1 && text(existing.shift_template_id)
      ? existing
      : defaultWorking;

    return {
      weekday: day.number,
      active: 1,
      shiftTemplateId: text(source.shift_template_id),
      startTime: text(source.template_start_time || source.start_time),
      endTime: text(source.template_end_time || source.end_time),
      scheduleSource: "shift_template",
    };
  });

  const statements = [
    `-- Weekly-off migration for ${text(employee.name)} (${args.employeeId})`,
    `UPDATE hr_work_schedules
SET effective_to = ${sqlValue(beforeDate)}, updated_at = ${sqlValue(now)}
WHERE salon_id = ${sqlValue(args.salonId)}
  AND employee_id = ${sqlValue(args.employeeId)}
  AND (effective_from IS NULL OR effective_from < ${sqlValue(effectiveFrom)})
  AND (effective_to IS NULL OR effective_to >= ${sqlValue(effectiveFrom)});`,
    `DELETE FROM hr_work_schedules
WHERE salon_id = ${sqlValue(args.salonId)}
  AND employee_id = ${sqlValue(args.employeeId)}
  AND effective_from = ${sqlValue(effectiveFrom)};`,
  ];

  for (const row of nextRows) {
    const id = `weekly_${args.employeeId}_${effectiveFrom}_${row.weekday}`;
    statements.push(`INSERT INTO hr_work_schedules
  (id, salon_id, employee_id, weekday, shift_template_id, start_time, end_time, active, schedule_source, effective_from, effective_to, created_at, updated_at)
VALUES (
  ${sqlValue(id)}, ${sqlValue(args.salonId)}, ${sqlValue(args.employeeId)}, ${row.weekday},
  ${sqlValue(row.shiftTemplateId || null)}, ${sqlValue(row.startTime || null)}, ${sqlValue(row.endTime || null)},
  ${row.active}, ${sqlValue(row.scheduleSource)}, ${sqlValue(effectiveFrom)}, ${sqlValue(effectiveTo || null)},
  ${sqlValue(now)}, ${sqlValue(now)}
);`);
  }

  statements.push(`UPDATE employee_employment
SET weekly_off_days_json = ${sqlValue(JSON.stringify([weekday.full]))}, updated_at = ${sqlValue(now)}
WHERE salon_id = ${sqlValue(args.salonId)} AND employee_id = ${sqlValue(args.employeeId)};`);

  return { current, nextRows, nextFuture, sql: statements.join("\n\n") };
}

function decodeFirestoreValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue?.values || []).map(decodeFirestoreValue);
  if ("mapValue" in value) {
    return Object.fromEntries(Object.entries(value.mapValue?.fields || {}).map(([key, item]) => [key, decodeFirestoreValue(item)]));
  }
  return null;
}

function encodeFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeFirestoreValue) } };
  if (typeof value === "object") {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeFirestoreValue(item)])) } };
  }
  return { stringValue: String(value) };
}

function decodeDocument(document) {
  return Object.fromEntries(Object.entries(document?.fields || {}).map(([key, value]) => [key, decodeFirestoreValue(value)]));
}

function normalizeWorkingDay(value, fallback = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    enabled: source.enabled !== false,
    shiftTemplateId: text(source.shiftTemplateId || source.shift_template_id || fallback.shiftTemplateId),
    shiftName: text(source.shiftName || source.shift_name || fallback.shiftName),
    start: text(source.start || fallback.start),
    end: text(source.end || fallback.end),
  };
}

function buildFirestoreSchedule(profile, weekday, effectiveFrom, corePlan) {
  const currentHours = profile.customWorkingHours && typeof profile.customWorkingHours === "object"
    ? profile.customWorkingHours
    : {};

  const fallbackCore = corePlan.nextRows.find((row) => row.active === 1) || null;
  const existingWorkingDay = Object.values(currentHours).map((row) => normalizeWorkingDay(row)).find((row) => row.enabled && row.shiftTemplateId)
    || (fallbackCore ? {
      enabled: true,
      shiftTemplateId: fallbackCore.shiftTemplateId,
      shiftName: "",
      start: fallbackCore.startTime,
      end: fallbackCore.endTime,
    } : null);

  if (!existingWorkingDay) throw new Error("Firestore mirror has no safe working-day template fallback.");

  const nextHours = {};
  for (const day of WEEKDAYS) {
    const current = normalizeWorkingDay(currentHours[day.key], existingWorkingDay);
    if (day.key === weekday.key) {
      nextHours[day.key] = { ...current, enabled: false };
    } else {
      nextHours[day.key] = {
        ...(current.enabled && current.shiftTemplateId ? current : existingWorkingDay),
        enabled: true,
      };
    }
  }

  const rawVersions = Array.isArray(profile.workingScheduleVersions) ? profile.workingScheduleVersions : [];
  const versions = rawVersions
    .filter((row) => row && typeof row === "object")
    .map((row) => ({ ...row }))
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(text(row.effectiveFrom)))
    .sort((left, right) => text(left.effectiveFrom).localeCompare(text(right.effectiveFrom)));

  const beforeDate = previousDate(effectiveFrom);
  const previousSnapshot = {
    useCustomWorkingHours: profile.useCustomWorkingHours === true,
    customWorkingHours: currentHours,
  };

  let nextVersions = versions
    .filter((row) => text(row.effectiveFrom) < effectiveFrom)
    .map((row) => {
      const effectiveTo = text(row.effectiveTo);
      if (!effectiveTo || effectiveTo >= effectiveFrom) return { ...row, effectiveTo: beforeDate };
      return row;
    });

  if (!nextVersions.length) {
    nextVersions.push({
      id: `schedule-baseline-${argsafe(effectiveFrom)}`,
      effectiveFrom: "1900-01-01",
      effectiveTo: beforeDate,
      ...previousSnapshot,
      changeReason: "ترحيل الجدول السابق قبل تعديل الإجازة الأسبوعية",
      createdAt: new Date().toISOString(),
    });
  }

  const futureVersion = versions.find((row) => text(row.effectiveFrom) > effectiveFrom);
  nextVersions.push({
    id: `schedule-weekly-off-${argsafe(effectiveFrom)}-${weekday.key}`,
    effectiveFrom,
    ...(futureVersion ? { effectiveTo: previousDate(text(futureVersion.effectiveFrom)) } : {}),
    useCustomWorkingHours: true,
    customWorkingHours: nextHours,
    changeReason: `تعديل الإجازة الأسبوعية إلى ${weekday.ar}`,
    createdAt: new Date().toISOString(),
  });
  if (futureVersion) nextVersions.push(...versions.filter((row) => text(row.effectiveFrom) > effectiveFrom));

  return {
    useCustomWorkingHours: true,
    customWorkingHours: nextHours,
    exceptionalLeaveWeekdays: [weekday.key],
    workingScheduleVersions: nextVersions,
  };
}

function argsafe(value) {
  return text(value).replace(/[^a-zA-Z0-9_-]/g, "-");
}

function gcloudAccessToken() {
  return text(run("gcloud", ["auth", "print-access-token"], { capture: true }));
}

async function fetchFirestoreDocument({ project, salonId, collection, employeeId, token }) {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}/databases/(default)/documents/salons/${encodeURIComponent(salonId)}/${collection}/${encodeURIComponent(employeeId)}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Firestore GET ${collection}/${employeeId} failed: ${response.status} ${await response.text()}`);
  return { url, document: await response.json() };
}

async function patchFirestoreSchedule(target, patch, token) {
  const fieldPaths = Object.keys(patch);
  const url = new URL(target.url);
  fieldPaths.forEach((field) => url.searchParams.append("updateMask.fieldPaths", field));
  const fields = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, encodeFirestoreValue(value)]));
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) throw new Error(`Firestore PATCH failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const weekday = weekdayFrom(args.weekday);

  const employeeRows = d1Json(args, `SELECT id, name, firebase_uid, status FROM employee_profiles WHERE salon_id=${sqlValue(args.salonId)} AND id=${sqlValue(args.employeeId)} LIMIT 1`);
  const employee = employeeRows[0];
  if (!employee) throw new Error(`Employee ${args.employeeId} was not found in Core D1.`);

  const schedules = d1Json(args, `SELECT s.*, t.name AS shift_name, t.start_time AS template_start_time, t.end_time AS template_end_time
FROM hr_work_schedules s
LEFT JOIN hr_shift_templates t ON t.id=s.shift_template_id AND t.salon_id=s.salon_id
WHERE s.salon_id=${sqlValue(args.salonId)} AND s.employee_id=${sqlValue(args.employeeId)}
ORDER BY s.weekday, COALESCE(s.effective_from,'0000-01-01') DESC`);

  const corePlan = buildCorePlan({ args, weekday, employee, schedules });

  console.log(`\nEmployee: ${employee.name} (${args.employeeId})`);
  console.log(`Weekly off: ${weekday.ar} (${weekday.full})`);
  console.log(`Effective from: ${args.effectiveFrom}`);
  console.log(`Future schedule preserved from: ${corePlan.nextFuture || "none"}`);
  console.table(corePlan.nextRows.map((row) => ({
    weekday: WEEKDAYS.find((day) => day.number === row.weekday)?.ar,
    active: row.active,
    shiftTemplateId: row.shiftTemplateId || "OFF",
    time: row.active ? `${row.startTime}-${row.endTime}` : "OFF",
  })));

  let firestoreTargets = [];
  let firestorePatch = null;
  if (!args.coreOnly) {
    const token = gcloudAccessToken();
    for (const collection of ["staff_public", "employees"]) {
      const target = await fetchFirestoreDocument({
        project: args.project,
        salonId: args.salonId,
        collection,
        employeeId: args.employeeId,
        token,
      });
      if (target) firestoreTargets.push({ ...target, collection, token });
    }

    if (!firestoreTargets.length) {
      throw new Error(`No Firestore staff_public/employees mirror found for ${args.employeeId}. Use --core-only only if this is intentional.`);
    }

    const primaryProfile = decodeDocument(firestoreTargets[0].document);
    firestorePatch = buildFirestoreSchedule(primaryProfile, weekday, args.effectiveFrom, corePlan);
    console.log(`Firestore mirrors: ${firestoreTargets.map((item) => item.collection).join(", ")}`);
  }

  if (!args.apply) {
    console.log("\nDRY RUN ONLY — no data was changed.");
    console.log("Re-run with --apply after reviewing the employee, weekday and effective date.");
    return;
  }

  d1Execute(args, corePlan.sql);

  if (!args.coreOnly && firestorePatch) {
    for (const target of firestoreTargets) {
      await patchFirestoreSchedule(target, firestorePatch, target.token);
    }
  }

  const verifyRows = d1Json(args, `SELECT weekday, active, shift_template_id, start_time, end_time, effective_from, effective_to, schedule_source
FROM hr_work_schedules
WHERE salon_id=${sqlValue(args.salonId)} AND employee_id=${sqlValue(args.employeeId)} AND effective_from=${sqlValue(args.effectiveFrom)}
ORDER BY weekday`);
  const offRows = verifyRows.filter((row) => Number(row.active) === 0);
  if (verifyRows.length !== 7 || offRows.length !== 1 || Number(offRows[0].weekday) !== weekday.number) {
    throw new Error(`Verification failed: expected exactly 7 rows and only ${weekday.ar} as weekly off.`);
  }

  console.log(`\nDONE — ${employee.name}: weekly off is ${weekday.ar} from ${args.effectiveFrom}.`);
}

main().catch((error) => {
  console.error(`\nweekly-off migration failed: ${error?.message || error}`);
  process.exitCode = 1;
});
