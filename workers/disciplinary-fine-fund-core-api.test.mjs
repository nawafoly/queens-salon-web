import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const core = readFileSync(new URL('./core/index.js', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/services/CoreDisciplinaryFineFundService.ts', import.meta.url), 'utf8');
const types = readFileSync(new URL('../src/types/disciplinaryFineFundCoreApi.ts', import.meta.url), 'utf8');

test('restricted disciplinary fine fund is reachable only through canonical Core routes', () => {
  for (const token of [
    'getDisciplinaryFineFundBalance',
    'listDisciplinaryFineFundLedger',
    'createDisciplinaryFineFundDisbursement',
    '/api/core/hr/disciplinary-fine-fund/balance',
    '/api/core/hr/disciplinary-fine-fund/ledger',
    '/api/core/hr/disciplinary-fine-fund/disbursements',
  ]) assert.ok(core.includes(token), 'missing fine-fund Core contract: ' + token);
  assert.ok(core.includes('requireRole(ctx.role, ADMIN_ROLES)'), 'fine-fund disbursement must remain admin restricted');
});

test('frontend has typed canonical fine-fund access', () => {
  for (const token of [
    'getBalance',
    'listLedger',
    'createDisbursement',
    '/api/core/hr/disciplinary-fine-fund/balance',
    '/api/core/hr/disciplinary-fine-fund/ledger',
    '/api/core/hr/disciplinary-fine-fund/disbursements',
  ]) assert.ok(service.includes(token), 'missing fine-fund frontend contract: ' + token);
  for (const token of [
    'CoreDisciplinaryFineFundBalance',
    'CoreDisciplinaryFineFundLedgerEntry',
    'CoreDisciplinaryFineFundDisbursementInput',
    'CoreDisciplinaryFineFundDisbursementResult',
  ]) assert.ok(types.includes(token), 'missing fine-fund frontend type: ' + token);
});
