import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/pages/DashboardExpenses.tsx", "utf8");

test("payroll subload failure does not discard the last valid payroll snapshot", () => {
  const catchStart = source.indexOf("} catch (payrollErr) {");
  const nextStep = source.indexOf(
    "const n = await countMonthlyExpensesMissingNotesCore()",
    catchStart
  );

  assert.ok(catchStart >= 0);
  assert.ok(nextStep > catchStart);

  const payrollCatch = source.slice(catchStart, nextStep);

  assert.doesNotMatch(
    payrollCatch,
    /setAutoPayrollItems\(\s*\[\]\s*\)/
  );

  assert.match(
    payrollCatch,
    /setPayrollLoadWarning/
  );
});

test("successful payroll load clears the payroll warning", () => {
  const successAnchor = source.indexOf(
    "setAutoPayrollItems(",
    source.indexOf("const payrollItems:")
  );

  assert.ok(successAnchor >= 0);

  const successBlock = source.slice(successAnchor, successAnchor + 350);

  assert.match(
    successBlock,
    /setPayrollLoadWarning\(""\)/
  );
});

test("expenses page has a dedicated visible warning for incomplete payroll data", () => {
  assert.match(
    source,
    /const \[payrollLoadWarning,\s*setPayrollLoadWarning\] = useState<string>\(""\)/
  );

  assert.match(
    source,
    /payrollLoadWarning \?/
  );

  assert.match(
    source,
    /بيانات الرواتب/
  );
});

test("exports are blocked while payroll data is known to be incomplete", () => {
  assert.match(
    source,
    /if \(payrollLoadWarning\) return setModalMsg/
  );
});