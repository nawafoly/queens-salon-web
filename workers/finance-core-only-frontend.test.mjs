import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("finance runtime is Core-only", () => {
  const income = read("src/services/CoreIncomeService.ts");
  const expenses = read("src/services/CoreExpenseService.ts");
  for (const source of [income, expenses]) {
    assert.match(source, /CoreFinanceService/);
    assert.doesNotMatch(source, /firebase\/firestore/);
    assert.doesNotMatch(source, /getDataSourceFlags/);
    assert.doesNotMatch(source, /\b(getDocs|getDoc|setDoc|deleteDoc|collection|FirestoreReadStats)\b/);
  }
  assert.match(income, /CoreRefundService/);
});

test("finance settings are Core D1 only", () => {
  const source = read("src/services/FinanceSettingsService.ts");
  assert.match(source, /CoreSettingsService/);
  assert.match(source, /CoreSettingsService\.get/);
  assert.match(source, /CoreSettingsService\.save/);
  assert.doesNotMatch(source, /firebase\/firestore/);
  assert.doesNotMatch(source, /services\/firebase/);
  assert.doesNotMatch(source, /\b(getDoc|setDoc|onSnapshot|serverTimestamp)\b/);
});

test("legacy finance services stay deleted", () => {
  for (const path of [
    "src/services/firestoreIncome.ts",
    "src/services/firestoreExpenses.ts",
    "src/services/ExpenseService.ts",
  ]) {
    assert.equal(existsSync(path), false, `${path} must not exist`);
  }
});

test("dashboard finance consumers use Core-only services", () => {
  const source = [
    "src/pages/Dashboard.tsx",
    "src/pages/DashboardIncome.tsx",
    "src/pages/DashboardExpenses.tsx",
    "src/pages/DashboardLogs.tsx",
    "src/pages/DashboardReports.tsx",
  ].map(read).join("\n");
  assert.doesNotMatch(source, /services\/firestore(?:Income|Expenses)/);
  assert.doesNotMatch(source, /\b(listAllIncomeFS|upsertIncomeFS|removeIncomeFS|listAllExpensesFS|upsertExpenseFS|removeExpenseFS|countMonthlyExpensesMissingNotesFS)\b/);
  assert.match(source, /CoreIncomeService/);
  assert.match(source, /CoreExpenseService/);
});
