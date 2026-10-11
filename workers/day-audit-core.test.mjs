import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeDayAuditPaymentMethod } from './core/repositories/day-audit-closings.js';

test('day audit never guesses an unknown payment method as transfer', () => {
  assert.equal(normalizeDayAuditPaymentMethod('other', 'booking_edit_payment:other'), 'unclassified');
  assert.equal(normalizeDayAuditPaymentMethod('', ''), 'unclassified');
  assert.equal(normalizeDayAuditPaymentMethod('mystery', 'unknown payment'), 'unclassified');
  assert.equal(normalizeDayAuditPaymentMethod('transfer', ''), 'transfer');
  assert.equal(normalizeDayAuditPaymentMethod('bank_transfer', ''), 'transfer');
  assert.equal(normalizeDayAuditPaymentMethod('card', ''), 'card');
  assert.equal(normalizeDayAuditPaymentMethod('cash', ''), 'cash');
});

test('day audit Core owns immutable closing persistence and blocks unclassified rows', () => {
  const source = readFileSync('workers/core/repositories/day-audit-closings.js', 'utf8');
  assert.match(source, /day_audit_closings/);
  assert.match(source, /core_day_audit:unclassified_payments/);
  assert.match(source, /snapshot\.unclassifiedRows\.length > 0/);
  assert.match(source, /manualCashHalalas - snapshot\.cashHalalas/);
  assert.match(source, /day_audit_closed/);
  assert.doesNotMatch(source, /window\.localStorage|\.getItem\(|\.setItem\(/);
});

test('day audit migration enforces one immutable closing per salon and date', () => {
  const migration = readFileSync('migrations/core/0094_day_audit_closings.sql', 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS day_audit_closings/);
  assert.match(migration, /UNIQUE \(salon_id, audit_date\)/);
  assert.match(migration, /unclassified_halalas/);
  assert.match(migration, /manual_cash_halalas/);
  assert.match(migration, /closed_by_uid/);
  assert.match(migration, /origin TEXT NOT NULL DEFAULT 'core'/);
});

test('Core worker intercepts day audit API while preserving the canonical worker', () => {
  const worker = readFileSync('workers/core/worker.js', 'utf8');
  const http = readFileSync('workers/core/day-audit-http.js', 'utf8');
  assert.match(worker, /isDayAuditRequest\(request\)/);
  assert.match(worker, /coreWorker\.fetch\(request, env, executionCtx\)/);
  assert.match(worker, /coreWorker\.scheduled\(event, env, ctx\)/);
  assert.match(http, /requirePermission\(ctx, 'income\.view'\)/);
  assert.match(http, /requirePermission\(ctx, 'income\.manage'\)/);
  assert.match(http, /DAY_AUDIT_ROOT = '\/api\/core\/day-audit'/);
  assert.match(http, /\$\{DAY_AUDIT_ROOT\}\/closings/);
  assert.match(http, /\$\{DAY_AUDIT_ROOT\}\/close/);
  assert.match(http, /\$\{DAY_AUDIT_ROOT\}\/import-legacy/);
});
