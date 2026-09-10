from pathlib import Path

page = Path('src/pages/hr/EmployeeLeave.tsx')
text = page.read_text(encoding='utf-8')
replacements = [
    ('  createLeaveRequest,\n', '  createManagedLeaveRequest,\n'),
    ('      await createLeaveRequest({\n', '      await createManagedLeaveRequest({\n'),
    ('        days,\n        createdByUid: session.uid,\n        createdByName: employeeLabel,\n', '        days,\n'),
]
for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'EmployeeLeave anchor mismatch for {old!r}: {count}')
    text = text.replace(old, new, 1)
page.write_text(text, encoding='utf-8')

checker = Path('scripts/check-employee-leave-core-cutover.mjs')
check_text = checker.read_text(encoding='utf-8')
anchor = 'const checks = [\n'
entry = '''  {\n    file: "src/pages/hr/EmployeeLeave.tsx",\n    required: [/createManagedLeaveRequest/],\n    forbidden: [/\\bcreateLeaveRequest\\s*\\(/],\n  },\n'''
if anchor not in check_text:
    raise SystemExit('checker anchor missing')
if 'file: "src/pages/hr/EmployeeLeave.tsx"' not in check_text:
    check_text = check_text.replace(anchor, anchor + entry, 1)
checker.write_text(check_text, encoding='utf-8')

Path('workers/employee-leave-page-core-cutover.test.mjs').write_text("""import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync('src/pages/hr/EmployeeLeave.tsx', 'utf8');

test('employee leave page creates requests through Core managed workflow', () => {
  assert.match(page, /createManagedLeaveRequest/);
  assert.doesNotMatch(page, /\\bcreateLeaveRequest\\s*\\(/);
});
""", encoding='utf-8')
