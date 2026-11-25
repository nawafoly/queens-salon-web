import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(
  new URL(`../${path}`, import.meta.url),
  'utf8'
);

test('legacy Core attendance write routes fail closed', () => {
  const source = read('workers/core/index.js');

  const start = source.indexOf('case "attendance:check-in":');
  const end = source.indexOf('case "leaves":', start);

  assert.ok(start >= 0);
  assert.ok(end > start);

  const block = source.slice(start, end);

  assert.match(block, /case "attendance:check-out":/);
  assert.match(block, /throw new AppError\(\s*410,/);
  assert.match(block, /legacy_write_endpoint_retired/);

  assert.doesNotMatch(block, /recordAttendance\(/);
  assert.doesNotMatch(block, /createWeeklyRestWorkAssignment\(/);
  assert.doesNotMatch(block, /reconcileAssignedWeeklyRestWork\(/);
});

test('frontend has no retired Core attendance write endpoints', () => {
  const service = read('src/services/CoreHrService.ts');

  assert.doesNotMatch(
    service,
    /\/api\/core\/hr\/attendance\/(?:check-in|check-out)/
  );

  assert.doesNotMatch(service, /async checkIn\(/);
  assert.doesNotMatch(service, /async checkOut\(/);
});

test('modern attendance and historical read paths remain available', () => {
  const service = read('src/services/attendanceWorkerService.ts');
  const core = read('workers/core/index.js');
  const historical = read('src/services/CoreHrService.ts');

  assert.match(service, /"\/attendance\/record"/);
  assert.match(service, /"\/attendance\/admin-adjustment"/);
  assert.match(service, /"\/attendance\/records"/);

  assert.match(
    core,
    /listAttendance\(db,\s*ctx\.salonId,\s*query/
  );

  assert.match(historical, /async listAttendance\(/);
});

test('weekly rest assignments retain explicit administrative API ownership', () => {
  const core = read('workers/core/index.js');

  assert.match(core, /createWeeklyRestWorkAssignment\(/);
  assert.match(core, /employees\.schedule\.manage/);

  const start = core.indexOf('case "attendance:check-in":');
  const end = core.indexOf('case "leaves":', start);

  assert.doesNotMatch(
    core.slice(start, end),
    /createWeeklyRestWorkAssignment\(/
  );
});
