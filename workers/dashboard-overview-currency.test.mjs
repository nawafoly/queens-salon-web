import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/pages/dashboardOverview/DashboardOverviewV2.tsx", "utf8");

test("overview interpolates the currency code in every money summary", () => {
  assert.match(source, /const currency = language === "en" \? "SAR" : "ر\.س"/);
  assert.doesNotMatch(source, /\}\s+\{currency\}`/);
  for (const field of [
    "stats.todayRevenue",
    "financial.income",
    "financial.expenses",
    "financial.profit",
    "financeToday.income",
    "financeToday.expenses",
    "financeToday.net",
  ]) {
    assert.ok(source.includes(`${field}.toLocaleString(numberLocale)} \${currency}`), field);
  }
});
