import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const section = fs.readFileSync(new URL('../src/pages/dashboardEmployees/ShiftControlSection.tsx', import.meta.url), 'utf8');
const dashboard = fs.readFileSync(new URL('../src/pages/DashboardEmployees.tsx', import.meta.url), 'utf8');
const shared = fs.readFileSync(new URL('../src/pages/dashboardEmployees/shared.ts', import.meta.url), 'utf8');
const service = fs.readFileSync(new URL('../src/services/CoreHrService.ts', import.meta.url), 'utf8');
const repository = fs.readFileSync(new URL('../workers/core/repositories/shift-control.js', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../workers/core/index.js', import.meta.url), 'utf8');

test('employee dashboard exposes a dedicated shift-control tab', () => {
  assert.match(shared, /\| "shifts"/);
  assert.match(dashboard, /ShiftControlSection/);
  assert.match(dashboard, /label: "الشفتات"/);
});

test('shift-control UI supports templates, assignments, exceptions, and resolution', () => {
  for (const phrase of ['إنشاء قالب شفت', 'تعيين شفت للموظفة', 'استثناء يومي أو مؤقت', 'الشفت الفعلي في تاريخ محدد']) {
    assert.ok(section.includes(phrase), `missing phrase ${phrase}`);
  }
  for (const method of ['saveShiftTemplate', 'createShiftAssignment', 'createScheduleException', 'resolveEmployeeShift']) {
    assert.ok(section.includes(`CoreHrService.${method}`), `missing method ${method}`);
  }
});

test('shift-control API supports lifecycle updates from the UI', () => {
  for (const method of ['updateShiftAssignment', 'cancelShiftAssignment', 'updateScheduleException']) {
    assert.ok(service.includes(method), `service missing ${method}`);
  }
  assert.match(repository, /replaceOverlaps/);
  assert.match(repository, /cancelShiftAssignment/);
  assert.match(worker, /method === "PATCH" && route\.id\) return updateShiftAssignment/);
  assert.match(worker, /method === "DELETE" && route\.id\) return cancelShiftAssignment/);
});
