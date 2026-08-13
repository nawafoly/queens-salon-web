import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const portalPath = resolve(root, "src/pages/EmployeePortal.tsx");
const overviewPath = resolve(root, "src/pages/hr/EmployeeOverview.tsx");
const attendanceMonthViewPath = resolve(root, "src/components/AttendanceMonthView.tsx");
const attendanceMonthViewCssPath = resolve(root, "src/styles/AttendanceMonthView.css");
const cssPath = resolve(root, "src/styles/dashboard-v2/pages/employee-portal-overview.css");
const attendanceCssPath = resolve(root, "src/styles/dashboard-v2/components/employee-attendance-card.css");
const microFixPath = resolve(root, "src/styles/dashboard-v2/pages/employee-portal-overview-micro-fixes.css");
const entryPath = resolve(root, "src/styles/dashboard-v2/dashboard-v2.css");
const mobilePath = resolve(root, "src/styles/EmployeePortalMobileNav.css");
const madanThemePath = resolve(root, "src/styles/MadanAdminTheme.css");
const dashboardSkinPath = resolve(root, "src/styles/DashboardSkin.css");
const errors = [];

for (const path of [
  portalPath,
  overviewPath,
  attendanceMonthViewPath,
  attendanceMonthViewCssPath,
  cssPath,
  attendanceCssPath,
  entryPath,
  mobilePath,
  madanThemePath,
  dashboardSkinPath,
]) {
  if (!existsSync(path)) errors.push(`Missing required file: ${path}`);
}

if (existsSync(microFixPath)) {
  errors.push("Employee overview must not use a parallel micro-fix stylesheet; fold final rules into employee-portal-overview.css.");
}

if (!errors.length) {
  const portal = readFileSync(portalPath, "utf8");
  const overview = readFileSync(overviewPath, "utf8");
  const attendanceMonthView = readFileSync(attendanceMonthViewPath, "utf8");
  const attendanceMonthViewCss = readFileSync(attendanceMonthViewCssPath, "utf8");
  const css = readFileSync(cssPath, "utf8");
  const attendanceCss = readFileSync(attendanceCssPath, "utf8");
  const entry = readFileSync(entryPath, "utf8");
  const mobile = readFileSync(mobilePath, "utf8");
  const madanTheme = readFileSync(madanThemePath, "utf8");
  const dashboardSkin = readFileSync(dashboardSkinPath, "utf8");

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
  if (!overview.includes('className="attendance-month--employee-portal-v2"')) {
    errors.push("Employee attendance month view is not using the scoped Employee Portal V2 modifier.");
  }
  if (/className="employee-panel employee-overview/.test(overview)) {
    errors.push("EmployeeOverview.tsx has regressed to the legacy overview root.");
  }

  const kpiIndex = overview.indexOf('className="employee-overview-kpis"');
  const attendanceCardIndex = overview.indexOf("employee-attendance-card employee-attendance-card--");
  const targetCardIndex = overview.indexOf("employee-target-home-card employee-target-home-card--");
  if (!(kpiIndex >= 0 && attendanceCardIndex > kpiIndex && targetCardIndex > attendanceCardIndex)) {
    errors.push("Employee overview DOM order must be KPI summary, attendance card, then target card.");
  }

  const behaviorMarkers = [
    "usePermissions",
    "canViewAttendance",
    "canViewOwnTarget",
    "getBrowserPosition",
    "requestAttendanceBiometric",
    "submitAttendanceToWorker",
    "getAttendanceForDateFromWorker",
    "listAttendanceByDateRangeFromWorker",
    "resolveAssignedAttendanceZoneId",
    "isCheckInWindowClosed",
    "CoreHrService.resolveEmployeeShift",
    "CoreHrService.listLeaves",
    "profile: {}",
    "buildApprovedLeaveDateKeys",
    "listPermissionRequestsByEmployee",
    "CoreEmployeeTargetService.mine",
    "listEmployeeBookings",
    "markEmployeeNotificationRead",
  ];
  for (const marker of behaviorMarkers) {
    if (!overview.includes(marker)) errors.push(`Employee overview behavior marker missing: ${marker}`);
  }

  const forbiddenRuntimeMarkers = [
    "workingScheduleVersions",
    "customWorkingHourOverrides",
    "exceptionalLeaveWeekdays",
    "profile.onLeave",
    "profile.leaveStartDate",
    "profile.leaveFromDate",
    "scheduleForEmployeeDate",
    "getAttendanceDayStatusLabel",
  ];
  for (const marker of forbiddenRuntimeMarkers) {
    if (overview.includes(marker)) {
      errors.push(`Employee overview still contains legacy runtime marker: ${marker}`);
    }
  }

  if (!overview.includes('hasPermission("attendance.own.view")')) {
    errors.push("Employee overview attendance runtime is not permission-gated.");
  }
  if (!overview.includes('hasPermission("targets.view_own")')) {
    errors.push("Employee overview target runtime is not permission-gated.");
  }
  if (!overview.includes('hasPermission("messages.view")')) {
    errors.push("Employee overview messages KPI is not permission-gated.");
  }
  if (!overview.includes("لم يتم استخدام أي جدول دوام أو حالة إجازة Legacy كبديل")) {
    errors.push("Employee overview is missing its explicit partial-runtime failure state.");
  }

  const attendanceMarkupMarkers = [
    'className="employee-attendance-side employee-attendance-side--in"',
    'className="employee-punch-control"',
    'employee-attendance-status--${attendanceStatus}',
    'className="employee-attendance-hint"',
  ];
  for (const marker of attendanceMarkupMarkers) {
    if (!overview.includes(marker)) errors.push(`Employee attendance compact markup missing: ${marker}`);
  }

  if (attendanceMonthView.includes("<select")) {
    errors.push("AttendanceMonthView.tsx must not use native select controls for the employee month picker.");
  }
  if (attendanceMonthView.includes('type="month"') || attendanceMonthView.includes("showPicker")) {
    errors.push("AttendanceMonthView.tsx must not use browser-native month picker controls.");
  }
  if (attendanceMonthView.includes("attendance-month__native-month-input") || attendanceMonthViewCss.includes("attendance-month__native-month-input")) {
    errors.push("AttendanceMonthView still contains the retired hidden native month input.");
  }
  if (!attendanceMonthView.includes("attendance-month__year-switcher") || !attendanceMonthView.includes("attendance-month__year-button")) {
    errors.push("AttendanceMonthView is missing the V2-style year switcher controls.");
  }
  if (!attendanceMonthView.includes('const WEEK_LABELS = ["سبت"')) {
    errors.push("AttendanceMonthView must render the employee calendar with a Saturday-first week to avoid an isolated first day row.");
  }
  if (!attendanceMonthView.includes("displayStatusLabel") || !attendanceMonthView.includes("displayStatusTone")) {
    errors.push("AttendanceMonthView is missing employee-facing attendance status display mapping.");
  }

  const forbiddenMobileMarkers = [
    "EMPLOYEE OVERVIEW APP UI START",
    "EMPLOYEE ATTENDANCE DUPLICATION CLEANUP START",
    "EMPLOYEE ATTENDANCE RECORDS TWO COLUMN FIX",
    "EMPLOYEE OVERVIEW KPI",
    "EMPLOYEE INTRO NAME FORCE WHITE",
    "employee-panel.employee-overview",
  ];
  for (const marker of forbiddenMobileMarkers) {
    if (mobile.includes(marker)) {
      errors.push(`EmployeePortalMobileNav.css still contains legacy employee overview/attendance marker: ${marker}`);
    }
  }

  const forbiddenMobileAttendanceMarkers = [
    "EMPLOYEE ATTENDANCE MONTH APP UI",
    "EMPLOYEE ATTENDANCE DETAIL COMPACT",
    "EMPLOYEE ATTENDANCE DESKTOP WIDTH + LEGEND",
    "EMPLOYEE ATTENDANCE COMMAND CENTER MOBILE",
    "employee portal shells",
  ];
  for (const marker of forbiddenMobileAttendanceMarkers) {
    if (mobile.includes(marker)) {
      errors.push(`EmployeePortalMobileNav.css still contains legacy employee attendance marker: ${marker}`);
    }
  }
  if (/\.employee-portal\.madan-employee-portal[\s\S]{0,160}\.employee-attendance-month-page/.test(mobile)) {
    errors.push("EmployeePortalMobileNav.css still targets the employee attendance month page directly.");
  }
  if (/\.employee-portal\.madan-employee-portal[\s\S]{0,160}\.attendance-month__/.test(mobile)) {
    errors.push("EmployeePortalMobileNav.css still targets employee attendance month internals directly.");
  }

  const referenceAttendanceCssMarkers = [
    "grid-template-columns: minmax(0, 1fr) 108px minmax(0, 1fr);",
    "min-height: 170px;",
    "width: 98px;",
    "height: 98px;",
    "min-height: 92px;",
  ];
  for (const marker of referenceAttendanceCssMarkers) {
    if (!attendanceCss.includes(marker)) errors.push(`Employee attendance reference layout marker missing: ${marker}`);
  }

  if (/#[0-9a-f]{3,8}\b/i.test(css)) {
    errors.push("employee-portal-overview.css contains a raw hex color.");
  }
  if (/!important\b/i.test(css)) {
    errors.push("employee-portal-overview.css contains !important.");
  }
  if (/(^|[{\s;])order\s*:/im.test(css)) {
    errors.push("employee-portal-overview.css must not reorder overview sections with CSS order.");
  }
  if (/#[0-9a-f]{3,8}\b/i.test(attendanceCss)) {
    errors.push("employee-attendance-card.css contains a raw hex color.");
  }
  if (/!important\b/i.test(attendanceCss)) {
    errors.push("employee-attendance-card.css contains !important.");
  }
  if (!css.includes(".dashboard-v2 .employee-overview-v2-page")) {
    errors.push("employee-portal-overview.css is not isolated under Dashboard V2.");
  }
  if (!attendanceCss.includes(".dashboard-v2.employee-portal .employee-overview-v2-page")) {
    errors.push("employee-attendance-card.css is not isolated under Employee Portal Dashboard V2.");
  }
  if (!css.includes("var(--dsv2-") || !attendanceCss.includes("var(--dsv2-")) {
    errors.push("Employee overview styles are not consuming Dashboard V2 tokens.");
  }
  if (!entry.includes('@import "./pages/employee-portal-overview.css";')) {
    errors.push("Dashboard V2 entry does not import employee-portal-overview.css.");
  }
  if (!entry.includes('@import "./components/employee-attendance-card.css";')) {
    errors.push("Dashboard V2 entry does not import employee-attendance-card.css.");
  }
  if (entry.includes('\@import "./pages/employee-portal-overview-micro-fixes.css";'.slice(1))) {
    errors.push("Dashboard V2 entry still imports the retired employee overview micro-fix stylesheet.");
  }

  const attendanceCssMarkers = [
    ".employee-attendance-card",
    ".employee-attendance-console",
    ".employee-attendance-side",
    ".employee-punch-control",
    ".employee-punch-button",
    ".employee-attendance-status",
    ".employee-attendance-hint",
  ];
  for (const marker of attendanceCssMarkers) {
    if (!attendanceCss.includes(marker)) errors.push(`Canonical employee attendance stylesheet is missing rule: ${marker}`);
  }

  const attendanceMonthV2Markers = [
    ".attendance-month--employee-portal-v2",
    ".attendance-month__command-center",
    ".attendance-month__month-menu",
    ".attendance-month__year-switcher",
    ".attendance-month__grid",
    "--employee-attendance-day-bg",
    ".attendance-month__day.is-selected strong",
    ".attendance-month__state-card",
    ".attendance-month__worked-metrics",
    "grid-template-columns: repeat(auto-fit, minmax(94px, 1fr));",
  ];
  for (const marker of attendanceMonthV2Markers) {
    if (!css.includes(marker)) errors.push(`Canonical employee attendance month stylesheet is missing rule: ${marker}`);
  }

  const forbiddenMadanOverviewSelectors = [
    ".employee-portal.madan-employee-portal .employee-app-intro",
    ".employee-portal.madan-employee-portal .employee-status-pill",
    ".employee-portal.madan-employee-portal .employee-overview-block",
    ".employee-portal.madan-employee-portal .employee-shortcut-card",
    ".employee-portal.madan-employee-portal .employee-hr-info-row",
    ".employee-portal.madan-employee-portal .employee-request-row",
    ".employee-portal.madan-employee-portal .employee-balance-card",
    ".employee-portal.madan-employee-portal .employee-attendance-records",
  ];
  for (const selector of forbiddenMadanOverviewSelectors) {
    if (madanTheme.includes(selector)) {
      errors.push(`MadanAdminTheme.css still targets employee overview V2 directly: ${selector}`);
    }
  }
  const forbiddenMadanAttendanceSelectors = [
    ".employee-portal.madan-employee-portal .employee-attendance-month-page",
    ".employee-portal.madan-employee-portal .attendance-month__summary",
    ".employee-portal.madan-employee-portal .attendance-month__calendar-shell",
    ".employee-portal.madan-employee-portal .attendance-month__detail",
    ".employee-portal.madan-employee-portal .attendance-month__empty",
  ];
  for (const selector of forbiddenMadanAttendanceSelectors) {
    if (madanTheme.includes(selector)) {
      errors.push(`MadanAdminTheme.css still targets employee attendance month V2 directly: ${selector}`);
    }
  }

  const employeePortalWhereBlocks = [...dashboardSkin.matchAll(/\.employee-portal\s*:where\(([\s\S]*?)\)\s*\{/g)]
    .map((match) => match[1]);
  const forbiddenDashboardSkinWhereSelectors = [
    ".employee-app-intro",
    ".employee-section-title",
    ".employee-block-head",
    ".employee-attendance-side",
    ".employee-attendance-status",
    ".employee-attendance-records",
    ".employee-attendance-note",
    ".employee-empty-box",
    ".employee-request-row",
    ".employee-balance-card",
  ];
  for (const selector of forbiddenDashboardSkinWhereSelectors) {
    if (employeePortalWhereBlocks.some((block) => block.includes(selector))) {
      errors.push(`DashboardSkin.css still force-colors employee overview V2 via .employee-portal :where(): ${selector}`);
    }
  }
  const forbiddenDashboardSkinAttendanceSelectors = [
    ".employee-attendance-month-page",
    ".employee-attendance-month-message",
    ".employee-portal .attendance-month__summary",
    ".employee-portal .attendance-month__calendar-shell",
    ".employee-portal .attendance-month__detail",
    ".employee-portal .attendance-month__empty",
    ".employee-portal .attendance-month__metrics",
    ".employee-portal .attendance-month__wide-metrics",
    ".employee-portal .attendance-month__weekdays",
    ".employee-portal .attendance-month__grid",
    ".employee-portal .attendance-month__primary",
  ];
  for (const selector of forbiddenDashboardSkinAttendanceSelectors) {
    if (dashboardSkin.includes(selector)) {
      errors.push(`DashboardSkin.css still targets employee attendance month V2 directly: ${selector}`);
    }
  }
}

if (errors.length) {
  console.error("Employee portal overview V2 contract failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Employee portal overview V2 contract passed.");
