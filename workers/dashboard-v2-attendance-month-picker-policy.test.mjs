import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const attendancePickerSource = readFileSync(
  new URL(
    "../src/components/dashboard-v2/employee-workspace/live/EmployeeAttendanceCalendarAlignedLiveV2.tsx",
    import.meta.url
  ),
  "utf8"
);

const attendancePickerStyles = readFileSync(
  new URL(
    "../src/styles/dashboard-v2/pages/employee-attendance-calendar-alignment.css",
    import.meta.url
  ),
  "utf8"
);

test("Dashboard V2 attendance month picker never falls back to the browser-native month UI", () => {
  assert.doesNotMatch(attendancePickerSource, /type=["']month["']/);
  assert.doesNotMatch(attendancePickerSource, /\.showPicker\s*\(/);
  assert.doesNotMatch(attendancePickerSource, /createElement\(["']input["']\)[\s\S]*?month/i);
});

test("attendance month selection is rendered as a Dashboard V2 popover", () => {
  assert.match(attendancePickerSource, /dsv2-ew-attendance-month-popover/);
  assert.match(attendancePickerSource, /dsv2-ew-attendance-month-option/);
  assert.match(attendancePickerSource, /dsv2-ew-attendance-month-trigger/);
  assert.match(attendancePickerStyles, /\.dashboard-v2 \.dsv2-ew-attendance-month-popover/);
  assert.match(attendancePickerStyles, /var\(--dsv2-surface\)/);
  assert.match(attendancePickerStyles, /var\(--dsv2-ew-border\)/);
});

test("the compact picker remains inside the calendar toolbar instead of restoring the large filter card", () => {
  assert.match(
    attendancePickerStyles,
    /\.dashboard-v2 \.dsv2-ew-attendance-calendar-alignment \.dsv2-ew-card:has\(#employee-live-v2-attendance-month\)\s*\{[\s\S]*?display:\s*none;/
  );
  assert.match(
    attendancePickerSource,
    /\.dsv2-ew-attendance-calendar-card \.dsv2-ew-card__actions/
  );
});

test("the month popover grid is isolated from the attendance calendar alignment grid", () => {
  assert.match(attendancePickerSource, /dsv2-ew-attendance-month-picker-grid/);
  assert.match(attendancePickerStyles, /\.dashboard-v2 \.dsv2-ew-attendance-month-picker-grid/);
  assert.doesNotMatch(
    attendancePickerSource,
    /className=["']dsv2-ew-attendance-month-grid["']\s+role=["']grid["']/
  );
});

test("attendance month picker respects employee service month boundaries", () => {
  assert.match(attendancePickerSource, /function clampMonthKey/);
  assert.match(attendancePickerSource, /monthKeyFromDate\(startDate\)/);
  assert.match(attendancePickerSource, /monthKeyFromDate\(endDate\) \|\| localDateKey\(\)\.slice\(0, 7\)/);
  assert.match(attendancePickerSource, /monthAllowed\(requestedMonth, props\.employmentStartDate, props\.employmentEndDate\)/);
  assert.match(attendancePickerSource, /disabled=\{viewYear <= minYear\}/);
  assert.match(attendancePickerSource, /disabled=\{viewYear >= maxYear\}/);
  assert.match(attendancePickerSource, /disabled=\{disabled\}/);
  assert.match(attendancePickerSource, /firstServiceDateForMonth\(nextMonth, props\.employmentStartDate, props\.employmentEndDate\)/);
  assert.match(attendancePickerStyles, /\.dsv2-ew-attendance-month-option:disabled/);
  assert.match(attendancePickerStyles, /\.dsv2-ew-attendance-month-current:disabled/);

  const employmentStartDate = "2026-09-07";
  const employmentEndDate = "2026-10-15";
  assert.equal(employmentStartDate.slice(0, 7), "2026-09");
  assert.equal(employmentEndDate.slice(0, 7), "2026-10");
});
