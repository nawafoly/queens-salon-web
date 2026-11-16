import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync("src/pages/dashboardEmployees/EmployeeListPanel.tsx", "utf8");
const page = readFileSync("src/pages/DashboardEmployees.tsx", "utf8");
const translations = readFileSync("src/pages/dashboardEmployees/employeeLanguage.tsx", "utf8");

test("employee directory badge distinguishes visibility and ended employment", () => {
  assert.match(panel, /"تم إنهاء عقدها"/);
  assert.match(panel, /"مخفي من الدليل"/);
  assert.match(panel, /"ظاهر في الدليل"/);
  assert.match(panel, /staff\.includeInEmployeeManagement === false/);
  assert.match(panel, /terminated \|\| completedEndDate/);
  assert.doesNotMatch(panel, /if \(staff\.active\) return \{ label: "نشطة"/);
});

test("ending a contract is never inferred from inactive flag alone", () => {
  assert.match(panel, /\["terminated", "resigned", "ended"\]/);
  assert.match(panel, /!!endDate && endDate <= todayIso\(\) && !staff\.active/);
  assert.match(page, /employmentStatus: cleanText\(employment\.status \?\? employment\.employment_status\)/);
  assert.match(page, /employmentStatus: cleanText\(staff\.employmentStatus\)/);
  assert.match(page, /employmentStatus: cleanText\(primary\.employmentStatus \|\| fallback\.employmentStatus\)/);
});

test("new badges include English translations", () => {
  for (const label of ["ظاهر في الدليل", "مخفي من الدليل", "تم إنهاء عقدها"]) {
    assert.ok(translations.includes('"'+label+'":'), label);
  }
});
