import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const dashboardEmployeesPath = resolve(root, "src/pages/DashboardEmployees.tsx");
const errors = [];

if (!existsSync(dashboardEmployeesPath)) {
  errors.push(`Missing required file: ${dashboardEmployeesPath}`);
}

function requireIncludes(source, needle, message) {
  if (!source.includes(needle)) errors.push(message);
}

function requireRegex(source, regex, message) {
  if (!regex.test(source)) errors.push(message);
}

function requireAbsent(source, needle, message) {
  if (source.includes(needle)) errors.push(message);
}

function requireOrder(source, labels) {
  let previousIndex = -1;
  let previousLabel = "";
  labels.forEach(({ label, needle }) => {
    const index = source.indexOf(needle);
    if (index < 0) {
      errors.push(`Missing ordered marker: ${label}`);
      return;
    }
    if (previousIndex >= 0 && index <= previousIndex) {
      errors.push(`${label} must appear after ${previousLabel}.`);
    }
    previousIndex = index;
    previousLabel = label;
  });
}

function clean(value) {
  return String(value ?? "").trim();
}

function uniqueCleanTexts(values) {
  return Array.from(new Set(values.map(clean).filter(Boolean)));
}

const sourcePriority = {
  core_accounts: 1,
  users: 2,
  employees: 3,
  staff_public: 4,
};

function linkedUidValues(row) {
  return uniqueCleanTexts([
    row.linkedUid,
    row.employeeUid,
    row.authUid,
    row.uid,
    row.userId,
    row.linkedUserId,
  ]);
}

function explicitDocIds(row) {
  return uniqueCleanTexts([
    row.staffPublicDocId,
    row.employeeDocId,
    row.linkedEmployeeDocId,
    row.employeeId,
  ]);
}

function canonicalDocIdOf(row, rawDocId = "") {
  const sourceDocId = clean(rawDocId || row.sourceDocId || row.id);
  const linkedUidSet = new Set(linkedUidValues(row));
  const explicit = explicitDocIds(row);
  const explicitCanonical =
    explicit.find((value) => !linkedUidSet.has(value)) ||
    explicit[0] ||
    "";
  const sourceDocIsLinkedUid = !!sourceDocId && linkedUidSet.has(sourceDocId);

  if (row.source === "staff_public" || clean(row.staffPublicDocId)) {
    return sourceDocId && !sourceDocIsLinkedUid
      ? sourceDocId
      : explicitCanonical || sourceDocId || clean(row.id);
  }

  return explicitCanonical || (sourceDocId && !sourceDocIsLinkedUid ? sourceDocId : "") || clean(row.id || sourceDocId);
}

function normalizeStaffPublicRow(rawDocId, data) {
  const rowBase = {
    ...data,
    id: rawDocId,
    source: "staff_public",
    sourceDocId: rawDocId,
    staffPublicDocId: rawDocId,
  };
  const canonicalId = canonicalDocIdOf(rowBase, rawDocId);
  return {
    ...data,
    id: canonicalId,
    source: "staff_public",
    sourceDocId: rawDocId,
    staffPublicDocId: canonicalId,
    employeeId: canonicalId,
    employeeDocId: canonicalId,
    linkedEmployeeDocId: canonicalId,
    legacyEmployeeIds: uniqueCleanTexts([
      rawDocId,
      data.staffPublicDocId,
      data.employeeId,
      data.employeeDocId,
      data.linkedEmployeeDocId,
    ]).filter((value) => value !== canonicalId),
  };
}

function canonicalScore(row) {
  const canonicalId = canonicalDocIdOf(row);
  const sourceDocId = clean(row.sourceDocId || row.id);
  const linkedUidSet = new Set(linkedUidValues(row));
  const employeeIdSet = new Set(explicitDocIds(row));
  const sourceDocIsLinkedUid = !!sourceDocId && linkedUidSet.has(sourceDocId);
  const canonicalIsLinkedUid = !!canonicalId && linkedUidSet.has(canonicalId);
  let score = 0;
  if (canonicalId) score += 4;
  if (clean(row.staffPublicDocId)) score += 4;
  if (sourceDocId && canonicalId && sourceDocId === canonicalId) score += 40;
  if (canonicalId && clean(row.id) === canonicalId) score += 12;
  if (canonicalId && employeeIdSet.has(canonicalId)) score += canonicalIsLinkedUid ? 2 : 10;
  if (sourceDocIsLinkedUid) score -= 30;
  if (canonicalIsLinkedUid) score -= 10;
  return score;
}

function rowUpdatedAt(row) {
  return Number(row.updatedAtMs || 0);
}

function pickRows(existing, incoming) {
  const existingPriority = sourcePriority[existing.source] || 0;
  const incomingPriority = sourcePriority[incoming.source] || 0;
  if (incomingPriority !== existingPriority) {
    return incomingPriority > existingPriority
      ? { primary: incoming, fallback: existing }
      : { primary: existing, fallback: incoming };
  }

  const existingCanonicalScore = canonicalScore(existing);
  const incomingCanonicalScore = canonicalScore(incoming);
  if (incomingCanonicalScore !== existingCanonicalScore) {
    return incomingCanonicalScore > existingCanonicalScore
      ? { primary: incoming, fallback: existing }
      : { primary: existing, fallback: incoming };
  }

  return rowUpdatedAt(incoming) > rowUpdatedAt(existing)
    ? { primary: incoming, fallback: existing }
    : { primary: existing, fallback: incoming };
}

function mergeRows(primary, fallback) {
  const canonicalId = canonicalDocIdOf(primary) || canonicalDocIdOf(fallback);
  return {
    ...fallback,
    ...primary,
    id: canonicalId,
    staffPublicDocId: canonicalId,
    employeeId: canonicalId,
    employeeDocId: canonicalId,
    linkedEmployeeDocId: canonicalId,
    legacyEmployeeIds: uniqueCleanTexts([
      ...(fallback.legacyEmployeeIds || []),
      ...(primary.legacyEmployeeIds || []),
      fallback.sourceDocId,
      primary.sourceDocId,
    ]).filter((value) => value !== canonicalId),
    includeInEmployeeManagement:
      primary.includeInEmployeeManagement !== undefined
        ? primary.includeInEmployeeManagement
        : fallback.includeInEmployeeManagement,
    payrollMonthlyHours:
      primary.payrollMonthlyHours !== undefined
        ? primary.payrollMonthlyHours
        : fallback.payrollMonthlyHours,
  };
}

function identityKeys(row) {
  return uniqueCleanTexts([
    row.id,
    row.sourceDocId,
    row.staffPublicDocId,
    row.employeeId,
    row.employeeDocId,
    row.linkedEmployeeDocId,
    ...(row.legacyEmployeeIds || []),
    ...linkedUidValues(row),
  ]);
}

function mergeScenario(rows) {
  const deduped = new Map();
  const aliases = new Map();
  for (const row of rows) {
    const keys = identityKeys(row).map((key) => `identity:${key}`);
    const dedupeKey = keys.map((key) => aliases.get(key) || key).find((key) => deduped.has(key)) || keys[0];
    const existing = deduped.get(dedupeKey);
    if (!existing) {
      deduped.set(dedupeKey, row);
      keys.forEach((key) => aliases.set(key, dedupeKey));
      continue;
    }
    const { primary, fallback } = pickRows(existing, row);
    const merged = mergeRows(primary, fallback);
    deduped.set(dedupeKey, merged);
    [...identityKeys(existing), ...identityKeys(row), ...identityKeys(merged)]
      .map((key) => `identity:${key}`)
      .forEach((key) => aliases.set(key, dedupeKey));
  }
  return Array.from(deduped.values());
}

function runCanonicalEmployeeRegression() {
  const uid = "SForOsVcv9QZLRc1GO3OK9KxMtV2";
  const canonical = normalizeStaffPublicRow("1001", {
    name: "Nawaf",
    linkedUid: uid,
    includeInEmployeeManagement: true,
    payrollMonthlyHours: 180,
    updatedAtMs: 100,
  });
  const mirror = normalizeStaffPublicRow(uid, {
    name: "Nawaf old",
    linkedUid: uid,
    employeeDocId: "1001",
    employeeId: "1001",
    includeInEmployeeManagement: false,
    payrollMonthlyHours: 0,
    updatedAtMs: 999999,
  });

  for (const inputRows of [[canonical, mirror], [mirror, canonical]]) {
    const mergedRows = mergeScenario(inputRows);
    if (mergedRows.length !== 1) {
      errors.push("Regression scenario must merge canonical staff_public and UID mirror into one employee.");
      continue;
    }
    const row = mergedRows[0];
    if (row.id !== "1001" || row.staffPublicDocId !== "1001" || row.employeeDocId !== "1001") {
      errors.push("Regression scenario must preserve canonical employee id 1001 after merge/reload.");
    }
    if (row.includeInEmployeeManagement !== true) {
      errors.push("Regression scenario must preserve saved includeInEmployeeManagement from canonical row.");
    }
    if (row.payrollMonthlyHours !== 180) {
      errors.push("Regression scenario must preserve saved payrollMonthlyHours from canonical row.");
    }
  }
}

runCanonicalEmployeeRegression();

if (!errors.length) {
  const source = readFileSync(dashboardEmployeesPath, "utf8").replace(/\r\n/g, "\n");

  requireIncludes(
    source,
    "getDocFromServer",
    "DashboardEmployees must import and use getDocFromServer for post-save verification."
  );
  requireIncludes(
    source,
    "getDocsFromServer",
    "DashboardEmployees must import and use getDocsFromServer for post-save reloads."
  );
  requireIncludes(
    source,
    "getDocFromServer(staffPublicDoc(targetEmployeeId))",
    "Post-save canonical staff_public verification must read from the server."
  );
  requireIncludes(
    source,
    "const readDocs = loadOptions.fromServer ? getDocsFromServer : getDocs;",
    "load() must support a server-read mode without forcing all normal reads to server."
  );
  requireIncludes(
    source,
    "readDocs(staffPublicCol())",
    "staff_public reload must go through the server-aware read helper."
  );
  requireRegex(
    source,
    /load\(saveVerificationServiceOptions,\s*\{\s*fromServer:\s*true,\s*strict:\s*true,\s*\}\)/s,
    "Post-save employee reload must request fromServer + strict mode."
  );

  requireIncludes(
    source,
    "buildEmployeeSaveVerificationSnapshot",
    "Save verification snapshot normalizer is missing."
  );
  requireIncludes(
    source,
    "verifyEmployeeSaveSnapshot(",
    "Post-save verification must compare persisted values, not only document existence."
  );
  requireIncludes(
    source,
    'verifyEmployeeSaveSnapshot(\n        "staff_public"',
    "Canonical staff_public data must be compared after server read."
  );
  requireIncludes(
    source,
    'verifyEmployeeSaveSnapshot(\n        "reload"',
    "Reloaded employee data must be compared before success."
  );
  requireIncludes(
    source,
    "if (!reloadedEmployee)",
    "Post-save reload must fail when the employee is missing."
  );
  requireRegex(
    source,
    /if \(!reloadedEmployee\)\s*\{\s*throw new Error/s,
    "Missing reloadedEmployee must throw instead of silently succeeding."
  );
  requireIncludes(
    source,
    "function findSavedEmployeeReloadRow",
    "Post-save reload must use a canonical row picker instead of first matching row."
  );
  requireIncludes(
    source,
    "employeeMatchesRouteId(row, target)",
    "Post-save reload lookup must handle canonical staff_public ids that differ from Firebase uid."
  );
  requireIncludes(
    source,
    'row.source === "staff_public"',
    "Post-save reload picker must prefer canonical staff_public rows over lower-priority duplicates."
  );

  requireAbsent(
    source,
    "getDoc(staffPublicDoc(targetEmployeeId))",
    "Post-save verification must not use cached getDoc()."
  );
  requireAbsent(
    source,
    "const reloadedRows = await load();",
    "Post-save reload must not use the cache/default load()."
  );
  requireAbsent(
    source,
    "incomingPriority >= existingPriority",
    "Same-priority dedupe must not let Firestore order decide the winner."
  );

  requireIncludes(
    source,
    "function pickEmployeeMergeRows",
    "Employee dedupe must use an explicit merge winner helper."
  );
  requireIncludes(
    source,
    "function employeeRowUpdatedAtMs",
    "Employee dedupe must compare updatedAt for same-priority rows."
  );
  requireIncludes(
    source,
    "toComparableTimestamp((row as any)?.updatedAt)",
    "Employee dedupe updatedAt comparison must use toComparableTimestamp()."
  );
  requireRegex(
    source,
    /incomingPriority !== existingPriority[\s\S]*employeeRowUpdatedAtMs\(existing\)[\s\S]*employeeRowUpdatedAtMs\(incoming\)/,
    "Same-priority employee dedupe must fall through to updatedAt comparison."
  );
  requireIncludes(
    source,
    "function employeeCanonicalDocScore",
    "Employee dedupe must have a deterministic canonical document tie-breaker."
  );
  requireIncludes(
    source,
    "const docMatchesLinkedUid = !!sourceDocId && linkedUidValues.has(sourceDocId);",
    "Canonical staff_public rows must not lose to uid-shaped legacy staff_public docs on final ties."
  );
  requireIncludes(
    source,
    "if (docMatchesLinkedUid) score -= 30;",
    "Uid-shaped legacy staff_public docs must be penalized on final ties."
  );
  requireIncludes(
    source,
    "const canonicalEmployeeId = employeeCanonicalDocIdOf(",
    "Employee load must resolve a canonical employeeDocId before building the row."
  );
  requireIncludes(
    source,
    'staffPublicDocId: source === "staff_public" ? employeeId : cleanText(combined?.staffPublicDocId)',
    "staff_public rows must expose the canonical employeeDocId as staffPublicDocId, not a UID mirror doc id."
  );
  requireIncludes(
    source,
    "monthlySalary: pickEditableNumber(\"monthlySalary\")",
    "Employee merge must explicitly preserve canonical payroll compatibility fields."
  );
  requireIncludes(
    source,
    "payrollMonthlyHours: pickEditableNumber(\"payrollMonthlyHours\")",
    "Employee merge must explicitly preserve canonical payrollMonthlyHours."
  );
  requireRegex(
    source,
    /const existingCanonicalScore = employeeCanonicalDocScore\(existing\);[\s\S]*const existingUpdatedAt = employeeRowUpdatedAtMs\(existing\);/,
    "Canonical staff_public tie-breaker must run before updatedAt so uid-shaped legacy docs cannot override canonical records."
  );

  requireOrder(source, [
    {
      label: "server staff_public read",
      needle: "getDocFromServer(staffPublicDoc(targetEmployeeId))",
    },
    {
      label: "staff_public value verification",
      needle: 'verifyEmployeeSaveSnapshot(\n        "staff_public"',
    },
    {
      label: "server reload",
      needle: "const reloadedRows = await load(saveVerificationServiceOptions,",
    },
    {
      label: "missing reload guard",
      needle: "if (!reloadedEmployee)",
    },
    {
      label: "reloaded value verification",
      needle: 'verifyEmployeeSaveSnapshot(\n        "reload"',
    },
    {
      label: "success message",
      needle: "setSaveMessage(\n        coreSyncWarning",
    },
  ]);
}

if (errors.length) {
  console.error("Dashboard employee save persistence contract failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Dashboard employee save persistence contract passed.");
