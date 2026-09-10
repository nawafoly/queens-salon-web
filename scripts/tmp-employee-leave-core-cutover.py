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
anchor = 'const checks = ['
if anchor not in check_text:
    raise SystemExit('checker anchor missing')
insert = '''const employeeLeavePage = fs.readFileSync(path.join(ROOT, "src/pages/hr/EmployeeLeave.tsx"), "utf8");\nif (!employeeLeavePage.includes("createManagedLeaveRequest")) {\n  console.error("[leave-core-cutover] EmployeeLeave must create leave requests through Core managed requests.");\n  process.exit(1);\n}\nif (/\\bcreateLeaveRequest\\s*\\(/.test(employeeLeavePage)) {\n  console.error("[leave-core-cutover] EmployeeLeave must not call the legacy Firestore createLeaveRequest path.");\n  process.exit(1);\n}\n\n'''
if 'EmployeeLeave must create leave requests through Core managed requests.' not in check_text:
    check_text = check_text.replace(anchor, insert + anchor, 1)
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
