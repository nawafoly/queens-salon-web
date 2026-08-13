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
    "employeeMatchesRouteId(row, targetEmployeeId)",
    "Post-save reload lookup must handle canonical staff_public ids that differ from Firebase uid."
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
    "const docMatchesLinkedUid = !!docId && linkedUidValues.has(docId);",
    "Canonical staff_public rows must not lose to uid-shaped legacy staff_public docs on final ties."
  );
  requireIncludes(
    source,
    "if (docMatchesLinkedUid) score -= 6;",
    "Uid-shaped legacy staff_public docs must be penalized on final ties."
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
