import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('offboarding successful employee removal marks the detail route as intentionally closing first', async () => {
  const source = await readFile(new URL('../src/pages/DashboardEmployees.tsx', import.meta.url), 'utf8');
  const submitStart = source.indexOf('const submitOffboarding = async () => {');
  const submitEnd = source.indexOf('\n  useEffect(', submitStart);
  assert.ok(submitStart > -1 && submitEnd > submitStart);
  const submit = source.slice(submitStart, submitEnd);
  const expectedOrder = [
    'await archiveEmployee({',
    'closingEmployeeDetailRef.current = true;',
    'navigate("/dashboard/employees", { replace: true });',
    'setList((rows) => rows.filter((row) => row.id !== target.id));',
    'setSaveMessage("تم إنهاء خدمة الموظفة بنجاح مع الاحتفاظ بسجلاتها التاريخية.");',
  ];
  let lastPosition = -1;
  for (const token of expectedOrder) {
    const position = submit.indexOf(token);
    assert.ok(position > lastPosition, `Offboarding order must preserve: ${token}`);
    lastPosition = position;
  }
  assert.match(submit, /routeEmployeeId && employeeMatchesRouteId\(target, routeEmployeeId\)/);
});

test('unrelated missing employee deep links still use the original error path', async () => {
  const source = await readFile(new URL('../src/pages/DashboardEmployees.tsx', import.meta.url), 'utf8');
  assert.match(source, /if \(closingEmployeeDetailRef\.current \|\| !routeEmployeeId \|\| !list\.length\) return;/);
  assert.match(source, /تعذر العثور على ملف الموظفة المطلوب\. تم الرجوع إلى قائمة الموظفين\./);
});
