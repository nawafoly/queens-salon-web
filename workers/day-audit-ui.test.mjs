import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync('src/pages/DashboardDayAudit.tsx', 'utf8');
const service = readFileSync('src/services/CoreDayAuditService.ts', 'utf8');

test('day audit UI reads and closes through Core while legacy storage is read-only compatibility', () => {
  assert.match(page, /CoreDayAuditService\.get\(requestedDate\)/);
  assert.match(page, /CoreDayAuditService\.close\(closingDate, parsedManual\)/);
  assert.match(page, /CoreDayAuditService\.listClosings\(50, 0\)/);
  assert.doesNotMatch(page, /dashboard_day_audit_lock_v1/);
  assert.doesNotMatch(page, /localStorage/);
  assert.match(service, /\/api\/core\/day-audit/);
  assert.match(service, /\/api\/core\/day-audit\/closings/);
  assert.match(service, /\/api\/core\/day-audit\/close/);
  assert.match(service, /window\.localStorage\.getItem\(LEGACY_LOCK_KEY\)/);
  assert.doesNotMatch(service, /localStorage\.setItem|localStorage\.removeItem/);
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

test('date loads ignore stale responses', () => {
  assert.match(page, /const selectedDateRef = useRef\(todayKey\)/);
  assert.match(page, /const requestedDate = todayKey/);
  assert.match(page, /selectedDateRef\.current !== requestedDate/);
  assert.match(page, /selectedDateRef\.current = bounded/);
});

test('successful Core close is reflected before best-effort refresh', () => {
  const closeCall = page.indexOf('created = await CoreDayAuditService.close(closingDate, parsedManual)');
  const localClosing = page.indexOf('closing: created');
  const refreshCall = page.indexOf('const refreshed = await CoreDayAuditService.get(closingDate)');
  assert.ok(closeCall >= 0, 'missing Core close call');
  assert.ok(localClosing > closeCall, 'closing must be committed to local UI after Core success');
  assert.ok(refreshCall > localClosing, 'follow-up GET must happen only after local close state is committed');
  assert.match(page, /Core day audit post-close refresh failed/);
});

test('day audit UI renders previous Core and legacy closings with view and print actions', () => {
  assert.match(page, /الإغلاقات السابقة/);
  assert.match(page, /history\.map\(\(row\)/);
  assert.match(page, /setTodayKey\(row\.auditDate\)/);
  assert.match(page, /printHistoricalClosing\(row\)/);
  assert.match(page, /legacy_local_readonly/);
});
