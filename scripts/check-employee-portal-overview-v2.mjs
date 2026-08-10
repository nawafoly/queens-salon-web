import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const portalPath = resolve(root, "src/pages/EmployeePortal.tsx");
const overviewPath = resolve(root, "src/pages/hr/EmployeeOverview.tsx");
const cssPath = resolve(root, "src/styles/dashboard-v2/pages/employee-portal-overview.css");
const entryPath = resolve(root, "src/styles/dashboard-v2/dashboard-v2.css");
const errors = [];

for (const path of [portalPath, overviewPath, cssPath, entryPath]) {
  if (!existsSync(path)) errors.push(`Missing required file: ${path}`);
}

if (!errors.length) {
  const portal = readFileSync(portalPath, "utf8");
  const overview = readFileSync(overviewPath, "utf8");
  const css = readFileSync(cssPath, "utf8");
  const entry = readFileSync(entryPath, "utf8");

  if (!/employee-portal madan-employee-portal dashboard-v2/.test(portal)) {
    errors.push("EmployeePortal.tsx is not rooted in Dashboard V2 tokens.");
  }
  if (!/path="overview"/.test(portal) || !/path="attendance"/.test(portal)) {
    errors.push("Employee portal overview/attendance routes are missing.");
  }
  if (!/attendanceOnly/.test(portal)) {
    errors.push("Attendance route no longer uses the shared attendanceOnly workflow.");
  }

  if (!overview.includes('className="employee-overview-v2-page"')) {
    errors.push("Employee overview is missing the isolated V2 page root.");
  }
  if (!overview.includes('className="employee-overview-v2-page employee-attendance-month-page"')) {
    errors.push("Employee attendance-only view is missing the isolated V2 page root.");
  }
  if (/className="employee-panel employee-overview/.test(overview)) {
    errors.push("EmployeeOverview.tsx has regressed to the legacy overview root.");
  }

  const behaviorMarkers = [
    "getBrowserPosition",
    "requestAttendanceBiometric",
    "submitAttendanceToWorker",
    "getAttendanceForDateFromWorker",
    "listAttendanceByDateRangeFromWorker",
    "resolveAssignedAttendanceZoneId",
    "isCheckInWindowClosed",
    "CoreHrService.resolveEmployeeShift",
    "buildApprovedLeaveDateKeys",
    "listPermissionRequestsByEmployee",
    "CoreEmployeeTargetService.mine",
    "listEmployeeBookings",
    "markEmployeeNotificationRead",
  ];
  for (const marker of behaviorMarkers) {
    if (!overview.includes(marker)) errors.push(`Employee overview behavior marker missing: ${marker}`);
  }

  if (/#[0-9a-f]{3,8}\b/i.test(css)) {
    errors.push("employee-portal-overview.css contains a raw hex color.");
  }
  if (/!important\b/i.test(css)) {
    errors.push("employee-portal-overview.css contains !important.");
  }
  if (!css.includes(".dashboard-v2 .employee-overview-v2-page")) {
    errors.push("employee-portal-overview.css is not isolated under Dashboard V2.");
  }
  if (!css.includes("var(--dsv2-")) {
    errors.push("employee-portal-overview.css is not consuming Dashboard V2 tokens.");
  }
  if (!entry.includes('@import "./pages/employee-portal-overview.css";')) {
    errors.push("Dashboard V2 entry does not import employee-portal-overview.css.");
  }
}

if (errors.length) {
  console.error("Employee portal overview V2 contract failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Employee portal overview V2 contract passed.");
