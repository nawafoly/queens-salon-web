import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getSaLeaveTypePolicy } from '../src/helpers/hr/saLeaveEntitlements.js';

const modal = await readFile(new URL('../src/components/LeaveRequestModal.tsx', import.meta.url), 'utf8');
const page = await readFile(new URL('../src/pages/DashboardEmployees.tsx', import.meta.url), 'utf8');

test('sick leave is tracked independently from annual leave balance in Core and UI', () => {
  const policy = getSaLeaveTypePolicy('sick');
  assert.equal(policy.deductAnnualBalance, false);
  assert.equal(policy.entitlementBucket, 'sick_year');
  assert.match(modal, /sick: \{ deductFromBalance: false, affectsPayroll: false \}/);
});

test('overlap validation receives partial intervals and does not collapse adjacent permissions into entire days', () => {
  assert.match(modal, /hasOverlappingLeave\(fromDate, toDate, durationKind, partialStartTime, partialEndTime\)/);
  assert.match(page, /if \(durationKind !== "partial" \|\| !existingPartial\) return true;/);
  assert.match(page, /return partialStartTime < existingEnd && existingStart < partialEndTime;/);
  assert.match(page, /if \(!existingStart \|\| !existingEnd\) return true;/);
});

test('admin direct permission stays nonfinancial and Core-owned', () => {
  assert.match(page, /source: "admin_direct",\s*financialEffect: "none"/);
  assert.match(page, /await createPermissionRequest\(/);
});
