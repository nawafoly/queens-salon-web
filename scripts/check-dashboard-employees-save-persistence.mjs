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

function normalizeCorePhone(value) {
  const raw = clean(value);
  if (!raw || /[A-Za-z]/.test(raw)) return "";
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00966")) digits = `966${digits.slice(5)}`;
  if (digits.startsWith("9660")) digits = `966${digits.slice(4)}`;
  if (/^05\d{8}$/.test(digits)) return digits;
  if (/^5\d{8}$/.test(digits)) return `0${digits}`;
  if (/^9665\d{8}$/.test(digits)) return `0${digits.slice(3)}`;
  return "";
}

function canonicalBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || value === 1 || value === "1" || value === "true";
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

  return (
    explicitCanonical ||
    (sourceDocId && !sourceDocIsLinkedUid ? sourceDocId : "") ||
    clean(row.id || sourceDocId)
  );
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
    const dedupeKey =
      keys.map((key) => aliases.get(key) || key).find((key) => deduped.has(key)) ||
      keys[0];
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

function overlayCoreEmployeeMaster(row, coreEmployee) {
  const core = coreEmployee || {};
  const employment = core.employment || {};
  const hasCore = (field) => Object.prototype.hasOwnProperty.call(core, field);
  const hasEmployment = (field) => Object.prototype.hasOwnProperty.call(employment, field);
  const includeInEmployeeManagement = hasCore("includeInEmployeeManagement")
    ? canonicalBoolean(core.includeInEmployeeManagement, true)
    : row.includeInEmployeeManagement !== false;

  const numberOrZero = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
  };

  return {
    ...row,
    name: hasCore("name") ? clean(core.name) : clean(row.name),
    email: hasCore("email") ? clean(core.email) : clean(row.email),
    phone:
      hasCore("phoneNormalized") || hasCore("phone")
        ? normalizeCorePhone(core.phoneNormalized ?? core.phone)
        : clean(row.phone),
    active: hasCore("status") ? clean(core.status).toLowerCase() === "active" : row.active,
    avatarUrl: hasCore("avatarUrl") ? clean(core.avatarUrl) : clean(row.avatarUrl),
    bio: hasCore("bio") ? clean(core.bio) : clean(row.bio),
    cvUrl: hasCore("cvUrl") ? clean(core.cvUrl) : clean(row.cvUrl),
    showOnAbout: hasCore("showOnAbout")
      ? canonicalBoolean(core.showOnAbout, false)
      : row.showOnAbout,
    includeInEmployeeManagement,
    rating: hasCore("rating") ? Math.min(5, numberOrZero(core.rating)) : numberOrZero(row.rating),
    reviewsCount: hasCore("reviewsCount")
      ? Math.floor(numberOrZero(core.reviewsCount))
      : Math.floor(numberOrZero(row.reviewsCount)),
    employmentEndDate:
      hasEmployment("end_date") || hasEmployment("endDate") || hasEmployment("employmentEndDate")
        ? clean(employment.end_date ?? employment.endDate ?? employment.employmentEndDate)
        : clean(row.employmentEndDate),
  };
}

function expect(condition, message) {
  if (!condition) errors.push(message);
}

function runCoreEmployeeMasterRegressions() {
  const uid = "SForOsVcv9QZLRc1GO3OK9KxMtV2";

  // Scenario A: stale mirrors must not override Core Employee Master.
  const staleCanonical = normalizeStaffPublicRow("1001", {
    name: "Old Name",
    email: "old@example.test",
    phone: "0500000000",
    active: false,
    avatarUrl: "old-avatar",
    bio: "old-bio",
    cvUrl: "old-cv",
    linkedUid: uid,
    includeInEmployeeManagement: true,
    showOnAbout: false,
    rating: 4.8,
    reviewsCount: 44,
    showOnBooking: true,
    specialties: ["hair"],
    updatedAtMs: 100,
  });
  const staleUser = {
    id: "1001",
    source: "users",
    sourceDocId: uid,
    linkedUid: uid,
    employeeId: "1001",
    name: "Old Name",
    includeInEmployeeManagement: true,
    updatedAtMs: 999,
  };
  const staleAccount = {
    id: "1001",
    source: "core_accounts",
    sourceDocId: "account-1",
    linkedUid: uid,
    employeeId: "1001",
    name: "Old Name",
    includeInEmployeeManagement: true,
    updatedAtMs: 1000,
  };
  const mergedA = mergeScenario([staleAccount, staleUser, staleCanonical]);
  expect(mergedA.length === 1, "Scenario A must converge stale mirrors into one employee row.");
  const resultA = overlayCoreEmployeeMaster(mergedA[0] || {}, {
    id: "1001",
    firebaseUid: uid,
    name: "New Name",
    email: "new@example.test",
    phoneNormalized: "0551234567",
    status: "active",
    avatarUrl: "core-avatar",
    bio: "core-bio",
    cvUrl: "core-cv",
    showOnAbout: true,
    includeInEmployeeManagement: false,
    rating: 4.5,
    reviewsCount: 12,
    employment: { end_date: null },
  });
  expect(resultA.name === "New Name", 'Scenario A reload:name must equal Core "New Name".');
  expect(resultA.email === "new@example.test", "Scenario A Core email must win stale mirrors.");
  expect(resultA.phone === "0551234567", "Scenario A Core phoneNormalized must project to reload phone.");
  expect(resultA.active === true, "Scenario A Core status=active must project to active=true.");
  expect(resultA.avatarUrl === "core-avatar", "Scenario A Core avatarUrl must win stale mirrors.");
  expect(resultA.bio === "core-bio", "Scenario A Core bio must win stale mirrors.");
  expect(resultA.cvUrl === "core-cv", "Scenario A Core cvUrl must win stale mirrors.");
  expect(resultA.showOnAbout === true, "Scenario A Core showOnAbout must win stale mirrors.");
  expect(
    resultA.includeInEmployeeManagement === false,
    "Scenario A reload:includeInEmployeeManagement must preserve Core false."
  );
  expect(resultA.rating === 4.5, "Scenario A Core rating must win stale mirrors.");
  expect(resultA.reviewsCount === 12, "Scenario A Core reviewsCount must win stale mirrors.");
  expect(resultA.showOnBooking === true, "Scenario A must preserve UI-only showOnBooking.");
  expect(
    JSON.stringify(resultA.specialties) === JSON.stringify(["hair"]),
    "Scenario A must preserve booking-only specialties."
  );

  // Scenario B: explicit false/zero are canonical values, not fallbacks.
  const resultB = overlayCoreEmployeeMaster(
    {
      ...staleCanonical,
      showOnAbout: true,
      includeInEmployeeManagement: true,
      rating: 5,
      reviewsCount: 99,
    },
    {
      id: "1001",
      name: "Zero False",
      status: "active",
      showOnAbout: false,
      includeInEmployeeManagement: false,
      rating: 0,
      reviewsCount: 0,
      employment: {},
    }
  );
  expect(resultB.showOnAbout === false, "Scenario B must preserve Core showOnAbout=false.");
  expect(
    resultB.includeInEmployeeManagement === false,
    "Scenario B must preserve Core includeInEmployeeManagement=false."
  );
  expect(resultB.rating === 0, "Scenario B must preserve Core rating=0.");
  expect(resultB.reviewsCount === 0, "Scenario B must preserve Core reviewsCount=0.");

  // Scenario C: Core employment.end_date is the canonical employmentEndDate.
  const resultC = overlayCoreEmployeeMaster(staleCanonical, {
    id: "1001",
    name: "End Date",
    status: "inactive",
    employment: { end_date: "2026-09-30" },
  });
  expect(
    resultC.employmentEndDate === "2026-09-30",
    "Scenario C employmentEndDate must equal Core employment.end_date."
  );

  // Scenario D: a newer UID-shaped staff_public mirror still cannot beat Core Employee Master.
  const uidMirror = normalizeStaffPublicRow(uid, {
    name: "Newest Legacy Mirror",
    linkedUid: uid,
    employeeDocId: "1001",
    employeeId: "1001",
    includeInEmployeeManagement: true,
    showOnAbout: true,
    rating: 5,
    reviewsCount: 999,
    updatedAtMs: 999999,
  });
  const mergedD = mergeScenario([staleCanonical, uidMirror]);
  expect(mergedD.length === 1, "Scenario D canonical + UID mirror must dedupe to one row.");
  expect(
    (mergedD[0] || {}).id === "1001",
    "Scenario D must retain canonical Firestore employee id before Core overlay."
  );
  const resultD = overlayCoreEmployeeMaster(mergedD[0] || {}, {
    id: "1001",
    firebaseUid: uid,
    name: "Core Still Wins",
    status: "active",
    showOnAbout: false,
    includeInEmployeeManagement: false,
    rating: 0,
    reviewsCount: 0,
    employment: { end_date: "2026-10-15" },
  });
  expect(resultD.name === "Core Still Wins", "Scenario D Core name must beat newer UID mirror.");
  expect(
    resultD.includeInEmployeeManagement === false,
    "Scenario D Core visibility must beat newer UID mirror."
  );
  expect(resultD.rating === 0 && resultD.reviewsCount === 0, "Scenario D Core zero values must win.");
}

runCoreEmployeeMasterRegressions();

if (!errors.length) {
  const source = readFileSync(dashboardEmployeesPath, "utf8").replace(/\r\n/g, "\n");

  requireIncludes(
    source,
    "getDocFromServer",
    "DashboardEmployees must retain server reads for compatibility mirror verification."
  );
  requireIncludes(
    source,
    "getDocsFromServer",
    "DashboardEmployees must use getDocsFromServer for strict post-save reloads."
  );
  requireIncludes(
    source,
    "const readDocs = loadOptions.fromServer ? getDocsFromServer : getDocs;",
    "load() must support server-read mode without forcing all normal reads to server."
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
    "function overlayCoreEmployeeMasterFields",
    "load() must have a dedicated canonical Core Employee Master overlay."
  );
  for (const field of [
    "name:",
    "email:",
    "phone:",
    "active:",
    "avatarUrl:",
    "bio:",
    "cvUrl:",
    "showOnAbout:",
    "includeInEmployeeManagement,",
    "rating:",
    "reviewsCount:",
    "employmentEndDate:",
  ]) {
    requireIncludes(
      source.slice(
        source.indexOf("function overlayCoreEmployeeMasterFields"),
        source.indexOf("type EmployeeLoadOptions = {")
      ),
      field,
      `Core Employee Master overlay is missing canonical field marker: ${field}`
    );
  }
  requireRegex(
    source,
    /const coreCanonicalRow = coreEmployee\s*\? overlayCoreEmployeeMasterFields\(row, coreEmployee\)\s*:\s*row;/s,
    "Core Employee Master must overlay the already-merged UI row when a matching Core employee exists."
  );
  requireRegex(
    source,
    /return\s*\{\s*\.\.\.coreCanonicalRow,[\s\S]*monthlySalary:[\s\S]*employment\.base_salary_halalas[\s\S]*payrollMonthlyHours:[\s\S]*employment\.expected_work_hours/s,
    "Payroll fields must be overlaid from matched Core D1 employment after Employee Master convergence."
  );
  requireAbsent(
    source,
    'monthlySalary: pickEditableNumber("monthlySalary")',
    "Do not restore Firestore monthlySalary authority inside mergeEmployeeRows()."
  );
  requireAbsent(
    source,
    'payrollMonthlyHours: pickEditableNumber("payrollMonthlyHours")',
    "Do not restore Firestore payrollMonthlyHours authority inside mergeEmployeeRows()."
  );

  requireIncludes(
    source,
    "staff.reviewsCount ?? staff.reviewCount",
    "Save verification must preserve an explicit Core-compatible reviewsCount=0."
  );
  requireIncludes(
    source,
    "combined?.reviewsCount ?? combined?.reviewCount",
    "Reload mirror normalization must not replace explicit reviewsCount=0 with a stale reviewCount fallback."
  );

  requireIncludes(
    source,
    "buildExpectedCoreEmployeeMasterVerificationSnapshot",
    "Expected Stage 4A.1 canonical Core verification snapshot is missing."
  );
  requireIncludes(
    source,
    "buildCoreEmployeeMasterVerificationSnapshot",
    "Persisted canonical Core verification snapshot is missing."
  );
  requireRegex(
    source,
    /CoreHrService\s*\.getEmployee\s*\(\s*targetEmployeeId\s*\)/s,
    "Post-save verification must read the canonical employee through CoreHrService.getEmployee(targetEmployeeId)."
  );
  requireIncludes(
    source,
    'verifyEmployeeSaveSnapshot(\n        "core_employee_master"',
    "Canonical post-save success must verify Stage 4A.1 fields from Core."
  );
  requireAbsent(
    source,
    'verifyEmployeeSaveSnapshot(\n        "staff_public"',
    "staff_public must not define canonical post-save success."
  );
  requireIncludes(
    source,
    "staff_public compatibility mirror differs from canonical save.",
    "staff_public verification, if retained, must be compatibility-only."
  );

  requireIncludes(
    source,
    "function findSavedEmployeeReloadRow",
    "Post-save reload must use a deterministic canonical row picker."
  );
  requireIncludes(
    source,
    "employeeMatchesRouteId(row, target)",
    "Post-save reload lookup must handle canonical employee ids that differ from Firebase UID."
  );
  requireIncludes(
    source,
    "function employeeCanonicalDocScore",
    "Employee dedupe must retain the canonical Firestore identity tie-breaker before Core overlay."
  );
  requireIncludes(
    source,
    "if (docMatchesLinkedUid) score -= 30;",
    "UID-shaped legacy staff_public docs must remain penalized for identity selection."
  );
  requireRegex(
    source,
    /const existingCanonicalScore = employeeCanonicalDocScore\(existing\);[\s\S]*const existingUpdatedAt = employeeRowUpdatedAtMs\(existing\);/,
    "Canonical staff_public identity tie-breaker must run before updatedAt."
  );

  requireOrder(source, [
    {
      label: "canonical Core employee read",
      needle: "const refreshedCoreEmployee =",
    },
    {
      label: "canonical Core Employee Master verification",
      needle: 'verifyEmployeeSaveSnapshot(\n        "core_employee_master"',
    },
    {
      label: "server reload",
      needle: "const reloadedRows = await load(saveVerificationServiceOptions,",
    },
    {
      label: "reloaded value verification",
      needle: 'verifyEmployeeSaveSnapshot(\n        "reload"',
    },
    {
      label: "success message",
      needle: 'employeeSaveDebug(\n        "completed"',
    },
  ]);
}

if (errors.length) {
  console.error("Dashboard employee save persistence contract failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Dashboard employee save persistence contract passed.");
