import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const helperSource = readFileSync("src/pages/dashboardEmployees/employeeDirectoryStatus.ts", "utf8");
const transpiled = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const { employeeWorkState, employeeDirectoryVisibility, employeeLoginState } =
  await import("data:text/javascript;base64," + Buffer.from(transpiled).toString("base64"));

const panel = readFileSync("src/pages/dashboardEmployees/EmployeeListPanel.tsx", "utf8");
const page = readFileSync("src/pages/DashboardEmployees.tsx", "utf8");
const translations = readFileSync("src/pages/dashboardEmployees/employeeLanguage.tsx", "utf8");

const today = "2026-11-16";
const staff = (changes = {}) => ({
  active: true, employmentStatus: "active", employmentEndDate: "",
  onLeave: false, includeInEmployeeManagement: true, accountStatus: "active", ...changes
});

test("employment state is separate from visibility and login", () => {
  assert.equal(employeeWorkState(staff(), today), "working");
  assert.equal(employeeWorkState(staff({ includeInEmployeeManagement: false }), today), "working");
  assert.equal(employeeWorkState(staff({ accountStatus: "disabled" }), today), "working");
  assert.equal(employeeDirectoryVisibility(staff({ includeInEmployeeManagement: false })), "hidden");
  assert.equal(employeeLoginState(staff({ accountStatus: "disabled" })), "disabled");
  assert.equal(employeeLoginState(staff({ accountStatus: "" })), "unlinked");
});

test("ended employment requires explicit status or inactive completed end date", () => {
  assert.equal(employeeWorkState(staff({ active: false, employmentStatus: "inactive" }), today), "inactive");
  assert.equal(employeeWorkState(staff({ active: false, employmentStatus: "inactive", employmentEndDate: today }), today), "ended");
  assert.equal(employeeWorkState(staff({ active: false, employmentStatus: "inactive", employmentEndDate: "2026-11-17" }), today), "inactive");
  assert.equal(employeeWorkState(staff({ active: false, employmentStatus: "terminated" }), today), "ended");
  assert.equal(employeeWorkState(staff({ active: true, employmentStatus: "active", employmentEndDate: "2026-11-01" }), today), "working");
});

test("active approved leave is not confused with inactive status", () => {
  assert.equal(employeeWorkState(staff({ onLeave: true, leaveStartDate: "2026-11-15", leaveUntil: "2026-11-17" }), today), "leave");
  assert.equal(employeeWorkState(staff({ onLeave: true, leaveStartDate: "2026-11-17", leaveUntil: "2026-11-20" }), today), "working");
  assert.equal(employeeWorkState(staff({ active: false, onLeave: true, leaveUntil: "2026-11-17" }), today), "inactive");
});

test("independent filters and badges use shared state and canonical account linkage", () => {
  assert.match(panel, /employeeWorkState\(staff, todayIso\(\)\)/);
  assert.match(panel, /employeeDirectoryVisibility\(staff\)/);
  assert.match(panel, /employeeLoginState\(staff\)/);
  assert.match(page, /employeeWorkState\(staff, todayIso\(\)\) === employmentFilter/);
  assert.match(page, /accountStatus: cleanText\(account\.status\)/);
  assert.match(page, /employmentStatus: cleanText\(employment\.status \?\? employment\.employment_status\)/);
});

test("employee directory labels have translations", () => {
  for (const label of ["ظاهر في الدليل", "مخفي من الدليل", "تم إنهاء عقدها",
    "الحالة الوظيفية", "على رأس العمل", "متوقفة عن العمل", "حساب الدخول", "مفعل", "معطل"]) {
    assert.ok(translations.includes('"'+label+'":'), label);
  }
});
