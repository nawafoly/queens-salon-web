import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const finance = readFileSync('workers/core/repositories/finance.js', 'utf8');
const refunds = readFileSync('workers/core/repositories/refunds.js', 'utf8');
const dispatcher = readFileSync('workers/core/index.js', 'utf8');
const financeService = readFileSync('src/services/CoreFinanceService.ts', 'utf8');
const incomeService = readFileSync('src/services/CoreIncomeService.ts', 'utf8');
const dayAudit = readFileSync('src/pages/DashboardDayAudit.tsx', 'utf8');
const migration = readFileSync('migrations/core/0058_finance_read_scope_indexes.sql', 'utf8');

test('day audit uses date-scoped Core finance reads', () => {
  assert.match(dispatcher, /listIncome\(db, ctx\.salonId, query\)/);
  assert.match(finance, /occurred_at = \? OR \(occurred_at >= \? AND occurred_at < \?\)/);
  assert.match(finance, /b\.booking_date = \?/);
  assert.match(finance, /i\.id = b\.id/);
  assert.match(finance, /i\.booking_id IS NULL OR TRIM\(i\.booking_id\) = ''/);
  assert.match(finance, /'booking', 'invoice', 'حجز', 'فاتورة'/);
  assert.match(refunds, /refunded_at = \? OR \(refunded_at >= \? AND refunded_at < \?\)/);
  assert.match(financeService, /listIncome\(query: \{ date\?: string \} = \{\}\)/);
  assert.match(incomeService, /listIncomeForDateCore/);
  assert.match(dayAudit, /listIncomeForDateCore\(dateKey\)/);
  assert.doesNotMatch(dayAudit, /listAllIncomeCore/);
});

test('finance scope has supporting D1 indexes', () => {
  assert.match(migration, /income_entries\(salon_id, booking_id, occurred_at\)/);
  assert.match(migration, /refunds\(salon_id, refunded_at\)/);
});
