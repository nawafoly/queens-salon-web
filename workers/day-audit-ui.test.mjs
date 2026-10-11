import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync('src/pages/DashboardDayAudit.tsx', 'utf8');
const service = readFileSync('src/services/CoreDayAuditService.ts', 'utf8');

test('day audit UI reads and closes through Core instead of localStorage', () => {
  assert.match(page, /CoreDayAuditService\.get\(todayKey\)/);
  assert.match(page, /CoreDayAuditService\.close\(todayKey, parsedManual\)/);
  assert.match(page, /CoreDayAuditService\.listClosings\(50, 0\)/);
  assert.doesNotMatch(page, /dashboard_day_audit_lock_v1/);
  assert.doesNotMatch(page, /localStorage/);
  assert.match(service, /\/api\/core\/day-audit/);
  assert.match(service, /\/api\/core\/day-audit\/closings/);
  assert.match(service, /\/api\/core\/day-audit\/close/);
});

test('day audit UI exposes unclassified payments and prevents closing them', () => {
  assert.match(page, /snapshot\.unclassifiedRows\.length > 0/);
  assert.match(page, /لا يمكن إقفال اليوم مع وجود مبالغ غير مصنفة/);
  assert.match(page, /مبالغ غير مصنفة/);
  assert.match(page, /unclassifiedNoticeRef\.current\?\.focus\(\)/);
  assert.match(page, /row\.method \|\| t\("غير معروف"\)/);
});

test('manual cash validation is accessible and focuses the invalid field', () => {
  assert.match(page, /aria-invalid=\{manualCashError \? true : undefined\}/);
  assert.match(page, /aria-describedby=\{manualCashError \? "day-audit-manual-cash-error" : undefined\}/);
  assert.match(page, /manualCashRef\.current\?\.focus\(\)/);
  assert.match(page, /id="day-audit-manual-cash-error"/);
  assert.match(page, /borderColor: "#b42318"/);
});

test('day audit UI renders previous Core closings with view and print actions', () => {
  assert.match(page, /الإغلاقات السابقة/);
  assert.match(page, /history\.map\(\(row\)/);
  assert.match(page, /setTodayKey\(row\.auditDate\)/);
  assert.match(page, /printHistoricalClosing\(row\)/);
  assert.match(page, /القيم محفوظة في Core وغير قابلة للتعديل/);
});
