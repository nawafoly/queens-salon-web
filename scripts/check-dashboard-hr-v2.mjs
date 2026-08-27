import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const pagePath = path.join(root, "src/pages/AdminHrDashboard.tsx");
const stylePath = path.join(root, "src/styles/dashboard-v2/pages/hr-overview-final.css");
const entryPath = path.join(root, "src/styles/dashboard-v2/dashboard-v2.css");

const page = fs.readFileSync(pagePath, "utf8");
const style = fs.readFileSync(stylePath, "utf8");
const entry = fs.readFileSync(entryPath, "utf8");

const failures = [];
const requireText = (content, needle, message) => {
  if (!content.includes(needle)) failures.push(message);
};
const rejectText = (content, needle, message) => {
  if (content.includes(needle)) failures.push(message);
};

const overviewStart = page.indexOf("function HrOverview(");
const overviewEnd = page.indexOf("type AdminHrDashboardProps", overviewStart);
if (overviewStart < 0 || overviewEnd < 0) {
  failures.push("Could not isolate HrOverview in AdminHrDashboard.tsx.");
}
const overview = overviewStart >= 0 && overviewEnd > overviewStart
  ? page.slice(overviewStart, overviewEnd)
  : "";

requireText(overview, 'className="dsv2-page hr-overview-v2"', "HR overview must use the canonical dsv2-page root.");
requireText(overview, "DashboardSelectV2", "HR overview employee/type selects must use DashboardSelectV2.");
requireText(overview, "DashboardDatePickerV2", "HR overview absence date must use DashboardDatePickerV2.");
requireText(overview, "DashboardFieldV2", "HR overview forms must use DashboardFieldV2.");
requireText(overview, "DashboardEmptyStateV2", "HR overview empty states must use DashboardEmptyStateV2.");
requireText(overview, "<HrMetricCard", "HR overview KPIs must use the shared HrMetricCard component.");
requireText(page, 'className="dsv2-metric-card hr-overview-v2__metric"', "HrMetricCard must render the canonical Dashboard V2 metric-card primitive.");
requireText(overview, "dsv2-btn", "HR overview actions must use Dashboard V2 buttons.");
rejectText(overview, "<select", "Native select remains inside HrOverview.");
rejectText(overview, 'type="date"', "Native date input remains inside HrOverview.");
rejectText(overview, "madan-hr-overview-v3", "Legacy HR overview root class remains inside HrOverview.");

for (const businessGuard of [
  "createEmployeeAbsenceRecord",
  "listAttendanceForEmployeesDateFromWorker",
  "getAttendanceDayStatus",
  "generatePayrollEntriesForMonths",
  "payrollMonthBounds",
]) {
  requireText(page, businessGuard, `Business-logic guard missing: ${businessGuard}`);
}

requireText(style, ".hr-overview-v2", "Canonical HR overview stylesheet is missing the V2 scope.");
rejectText(style, "madan-hr-overview-v3", "Canonical HR stylesheet still targets the legacy overview root.");
if (/!important\b/.test(style)) failures.push("hr-overview-final.css contains !important.");
if (/#[0-9a-fA-F]{3,8}\b/.test(style)) failures.push("hr-overview-final.css contains a raw hex color.");

requireText(entry, '@import "./pages/hr-overview-final.css";', "dashboard-v2.css must import hr-overview-final.css.");
rejectText(entry, '@import "./pages/hr-overview.css";', "dashboard-v2.css still imports the legacy HR overview stylesheet.");

if (failures.length) {
  console.error("Dashboard HR V2 migration guard failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Dashboard HR V2 migration guard passed.");
