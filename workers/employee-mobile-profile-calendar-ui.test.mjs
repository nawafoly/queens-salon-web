import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const profile = readFileSync(new URL("../src/pages/dashboardEmployees/EmployeeProfilePageLayout.tsx", import.meta.url), "utf8");
const calendar = readFileSync(new URL("../src/components/dashboard-v2/employee-workspace/live/EmployeeWorkspaceOperationalTabsLiveV2.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles/dashboard-v2/pages/employee-mobile-attendance.css", import.meta.url), "utf8");
const imports = readFileSync(new URL("../src/styles/dashboard-v2/dashboard-v2.css", import.meta.url), "utf8");

test("mobile employee sections render permitted icon tabs, without a select/dropdown", () => {
  assert.match(profile, /<nav className="dsv2-ew-mobile-icon-tabs" role="tablist"/);
  assert.match(profile, /tabs\.map\(\(tab\) =>/);
  assert.match(profile, /aria-selected=\{isActive\}/);
  assert.match(profile, /aria-label=\{tab\.label\}/);
  assert.match(profile, /<FontAwesomeIcon icon=\{tab\.icon \|\| faFolderOpen\}/);
  assert.match(profile, /onClick=\{\(\) => props\.onDetailTabChange\?\.\(tab\.key\)\}/);
  assert.doesNotMatch(profile, /<DashboardSelectV2/);
  assert.match(styles, /\.dsv2-ew-mobile-icon-tabs[\s\S]*?display:\s*none/);
  assert.match(styles, /@media \(max-width: 767px\)/);
  assert.match(styles, /grid-auto-flow:\s*column/);
  assert.match(styles, /overflow-x:\s*auto/);
  assert.match(styles, /scroll-snap-type:\s*x proximity/);
  assert.match(styles, /\.dsv2-ew-mobile-icon-tab\[data-active="true"\]/);
});

test("mobile calendar is a compact seven-day grid with one clear status indicator per date", () => {
  assert.match(calendar, /function attendanceCalendarCompactStatus\(day: AttendanceCalendarDayLiveV2\)/);
  assert.match(calendar, /const status = attendanceCalendarDisplayStatus\(day\)/);
  assert.match(calendar, /className="dsv2-ew-calendar__full-status"/);
  assert.match(calendar, /className="dsv2-ew-calendar__mobile-summary"/);
  assert.match(calendar, /className="dsv2-ew-calendar__mobile-dot"/);
  assert.match(calendar, /data-leave-type=\{attendanceCalendarLeaveType\(day\)\}/);
  assert.match(calendar, /aria-label=\{tr\(/);
  assert.match(styles, /grid-template-columns:\s*repeat\(7, minmax\(0, 1fr\)\)/);
  assert.match(styles, /height:\s*65px/);
  assert.match(styles, /\.dsv2-ew-calendar__day > small\s*\{\s*display:\s*none !important;/);
  assert.match(styles, /text-overflow:\s*ellipsis/);
  assert.match(styles, /\.dsv2-ew-calendar__day\[data-selected="true"\]/);
  assert.match(styles, /\.dsv2-ew-calendar__day\[data-employment-state="pre_employment"\]/);
});

test("single tap selects a date and exposes the full existing canonical day card", () => {
  assert.match(calendar, /const selectCalendarDay = \(nextDate: string\) => \{/);
  assert.match(calendar, /handleSelectedDateChange\(nextDate\)/);
  assert.match(calendar, /requestAnimationFrame\(\(\) => \{/);
  assert.match(calendar, /\.dsv2-ew-attendance-detail-card"\)\?\.scrollIntoView/);
  assert.match(calendar, /onClick=\{\(\) => day\.interactive && selectCalendarDay\(day\.date\)\}/);
  assert.match(calendar, /onDoubleClick=\{\(\) => day\.interactive && openDayDetails\(day\.date\)\}/);
  assert.match(calendar, /title="تفاصيل اليوم المحدد"/);
  assert.match(calendar, /selectedRow\?\.checkInAtClient/);
  assert.match(calendar, /selectedRow\?\.checkOutAtClient/);
  assert.match(calendar, /onEditPunch\(activeSelectedDate\)/);
  assert.match(calendar, /onDeletePunch\(selectedRow\.date\)/);
  assert.match(styles, /scroll-margin-top:\s*calc\(116px \+ env\(safe-area-inset-top, 0px\)\)/);
});

test("mobile CSS is imported after desktop calendar rules, without modifying payroll or Core", () => {
  const base = imports.indexOf('@import "./pages/employee-workspace.css";');
  const aligned = imports.indexOf('@import "./pages/employee-attendance-calendar-alignment.css";');
  const mobile = imports.indexOf('@import "./pages/employee-mobile-attendance.css";');
  assert.ok(base >= 0 && aligned > base && mobile > aligned);
  assert.ok(styles.trimStart().startsWith("/*"));
  assert.match(styles, /@media \(max-width: 767px\)/);
  assert.doesNotMatch(styles, /@media \(min-width/);
});
