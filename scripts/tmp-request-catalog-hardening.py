from pathlib import Path

p = Path('src/pages/hr/EmployeeRequests.tsx')
t = p.read_text(encoding='utf-8')
old = 'const REQUEST_TYPES = Object.keys(EMPLOYEE_REQUEST_TYPE_LABELS) as EmployeeRequestType[];'
new = '''const REQUEST_TYPES = (Object.keys(EMPLOYEE_REQUEST_TYPE_LABELS) as EmployeeRequestType[])
  .filter((type) => type !== "exceptional_financial_payment");'''
if t.count(old) != 1:
    raise SystemExit(f'catalog anchor mismatch: {t.count(old)}')
t = t.replace(old, new, 1)
p.write_text(t, encoding='utf-8')

Path('workers/request-catalog-hardening.test.mjs').write_text("""import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync('src/pages/hr/EmployeeRequests.tsx', 'utf8');
const core = readFileSync('workers/core/repositories/employee-requests.js', 'utf8');

test('employee request catalog hides leave cash substitution that Core rejects', () => {
  assert.match(ui, /filter\(\(type\) => type !== \"exceptional_financial_payment\"\)/);
  assert.match(core, /annual_leave_cash_substitution_during_service_not_allowed/);
});
""", encoding='utf-8')
