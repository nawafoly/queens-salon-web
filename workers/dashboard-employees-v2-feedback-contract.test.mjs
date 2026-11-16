import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  new URL("../src/pages/DashboardEmployees.tsx", import.meta.url),
  "utf8",
);
const employeeStatsSource = fs.readFileSync(
  new URL("../src/pages/dashboardEmployees/EmployeeStatsSection.tsx", import.meta.url),
  "utf8",
);

const operationalTabsSource = fs.readFileSync(
  new URL("../src/components/dashboard-v2/employee-workspace/live/EmployeeWorkspaceOperationalTabsLiveV2.tsx", import.meta.url),
  "utf8",
);

test("dashboard employees uses canonical V2 feedback primitives", () => {
  assert.match(source, /DashboardToastProviderV2/);
  assert.match(source, /position="top-center"/);
  assert.match(source, /useDashboardToastV2/);
  assert.match(source, /<DashboardConfirmV2[\s>]/);
  assert.match(source, /requestConfirmation/);

  assert.doesNotMatch(source, /\bconfirm\s*\(/);
  assert.doesNotMatch(source, /employees-v2-alert/);
  assert.doesNotMatch(source, /payrollSettingsMessage/);
  assert.doesNotMatch(employeeStatsSource, /settingsMessage/);
  assert.doesNotMatch(operationalTabsSource, /settingsMessage/);
  assert.doesNotMatch(operationalTabsSource, /title="حالة الحفظ"/);
});

test("salary settings button reports saving, success, validation errors and Core failures inline", () => {
  assert.match(source, /setPayrollSettingsSaving\(true\)/);
  assert.match(source, /setPayrollSettingsSaving\(false\)/);
  assert.match(source, /setPayrollSaveNotice\(\{ tone: "success"/);
  assert.match(source, /setPayrollSaveNotice\(\{ tone: "danger", text: message \}\)/);
  assert.match(source, /rejectSave\("حدد تصنيف التأمينات الاجتماعية/);
  assert.match(source, /toFirestoreErrorMessage\(error, "تعذر حفظ إعدادات الراتب\."\)/);
  assert.match(employeeStatsSource, /saveNotice=\{payroll\.saveNotice\}/);
  assert.match(operationalTabsSource, /role=\{saveNotice\.tone === "danger" \? "alert" : "status"\}/);
  assert.match(operationalTabsSource, /aria-live=/);
  assert.match(operationalTabsSource, /جاري حفظ إعدادات الراتب والتأمينات/);
});

test("canonical Core staff record is not labeled incomplete solely by its source", () => {
  const directory = fs.readFileSync(
    new URL("../src/pages/dashboardEmployees/EmployeeListPanel.tsx", import.meta.url),
    "utf8"
  );
  assert.match(directory, /staff\.profileIncomplete === true/);
  assert.doesNotMatch(directory, /staff\.source !== "staff_public"/);
});


test("payroll save feedback is reset per employee and stale asynchronous results are ignored", () => {
  assert.match(source, /const payrollSaveContextVersionRef = useRef\(0\)/);
  assert.match(source, /const resetForm = \(\) => \{\s*payrollSaveContextVersionRef\.current \+= 1;\s*setPayrollSaveNotice\(null\)/);
  assert.match(source, /const openEdit = \(x: StaffPublicUi, updateRoute = true\) => \{\s*payrollSaveContextVersionRef\.current \+= 1;\s*setPayrollSaveNotice\(null\)/);
  assert.match(source, /\[selectedEmployeeId\]\);\s*const savePayrollSettings = async/);
  assert.match(source, /const saveContextVersion = payrollSaveContextVersionRef\.current/);
  assert.match(source, /const isCurrentSaveContext = \(\) => payrollSaveContextVersionRef\.current === saveContextVersion/);
  assert.match(source, /const rejectSave = \(message: string\) => \{\s*if \(!isCurrentSaveContext\(\)\) return;/);
  assert.match(source, /if \(isCurrentSaveContext\(\)\) \{\s*setPayrollSaveNotice\(\{ tone: "success"/);
});

test("canonical Core HR records do not inherit account-only incomplete status", () => {
  assert.match(source, /profileIncomplete:\s*source === "core_accounts"/);
  assert.match(source, /profileIncomplete:\s*!\[primary\.source, fallback\.source\]\.some\(\(source\) => source === "core_hr" \|\| source === "core_staff"\)/);
});

test("unlinked Core account users are not treated as employee directory records", () => {
  assert.match(source, /const linkedEmployeeId = cleanText\(\s*account\.employeeLink\?\.employeeId\s*\);\s*\/\/ Account membership alone does not make someone an employee\./);
  assert.match(source, /if \(!linkedEmployeeId\) return;/);
});

test("payroll save does not infer or overwrite Core employment lifecycle", () => {
  const begin = source.indexOf("  const savePayrollSettings = async () => {");
  const end = source.indexOf("\n\n  useEffect(() => {", begin);
  assert.ok(begin >= 0 && end > begin);
  const payrollSave = source.slice(begin, end);
  assert.match(payrollSave, /await CoreHrService\.getEmployee\(targetEmployeeId\)/);
  assert.doesNotMatch(payrollSave, /getEmployee\(targetEmployeeId\)\.catch\(\(\) => null\)/);
  assert.doesNotMatch(payrollSave, /employmentStatus:\s*active \?/);
  assert.doesNotMatch(payrollSave, /status:\s*active \?/);
  assert.match(payrollSave, /await CoreHrService\.saveEmployee\(/);
});
