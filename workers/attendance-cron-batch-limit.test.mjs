import { recordAutomaticAttendanceAbsence, clearAutomaticAttendanceAbsence } from "./core/repositories/attendance-policy.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(
  new URL("./core/repositories/shift-control.js", import.meta.url),
  "utf8"
);

const marker = "export async function markClosedCheckInWindowsAbsent(";
const start = source.indexOf(marker);

assert.ok(start >= 0, "Attendance cron function missing");

const functionSource = source.slice(start)
  .replace(/^export async function/, "async function");

function createHarness(employeeCount, failChunk = 0) {
  const employees = Array.from(
    { length: employeeCount },
    (_, index) => ({
      id: `employee-${index + 1}`,
      firebase_uid: `uid-${index + 1}`,
    })
  );

  const calls = {
    batches: [],
    inserts: 0,
    deletes: 0,
    attendanceReads: 0,
  };

  const coreDb = {
    prepare(sql) {
      return {
        bind() {
          return {
            async run() {
              if (sql.includes("INSERT OR IGNORE")) calls.inserts++;
              if (sql.includes("DELETE FROM employee_absences")) calls.deletes++;

              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };

  const attendanceDb = {
    prepare() {
      calls.attendanceReads++;

      return {
        bind() {
          return {
            async first() {
              return null;
            },
          };
        },
      };
    },
  };

  const context = {
    recordAutomaticAttendanceAbsence,
    clearAutomaticAttendanceAbsence,
    dbAll: async () => employees,
    dbFirst: async () => null,

    resolveEmployeeShiftsBatch: async (_db, _salonId, data) => {
      const batchNumber = calls.batches.length + 1;
      const employeeIds = data.employeeIds;

      calls.batches.push([...employeeIds]);

      assert.ok(
        employeeIds.length <= 100,
        "Batch exceeds 100 employees"
      );

      if (batchNumber === failChunk) {
        return { rows: [] };
      }

      return {
        rows: employeeIds.map(() => ({
          source: "weekly_schedule",
          active: 0,
          exception_type: "off",
        })),
      };
    },

    riyadhCronParts: () => ({
      dateKey: "2026-11-23",
      minutes: 780,
    }),

    riyadhUtcBounds: () => ({
      start: "2026-11-22T21:00:00.000Z",
      end: "2026-11-23T21:00:00.000Z",
    }),

    cleanText: (value) => String(value ?? "").trim(),
    activeFlag: (value) => Number(value) === 1 ? 1 : 0,

    timeMinutes: (value) => {
      const [hour, minute] = String(value).split(":").map(Number);
      return hour * 60 + minute;
    },
  };

  const fn = vm.runInNewContext(
    functionSource + "\nmarkClosedCheckInWindowsAbsent;",
    context
  );

  return {
    calls,
    run: () => fn(
      coreDb,
      attendanceDb,
      "main",
      "2026-11-23T10:00:00.000Z"
    ),
  };
}

test("101 employees are resolved in batches of 100 and 1", async () => {
  const harness = createHarness(101);
  const result = await harness.run();

  assert.equal(result.checked, 101);
  assert.deepEqual(
    harness.calls.batches.map((batch) => batch.length),
    [100, 1]
  );
  assert.equal(harness.calls.inserts, 0);
  assert.equal(harness.calls.deletes, 0);
});

test("200 employees are resolved in two batches of 100", async () => {
  const harness = createHarness(200);
  const result = await harness.run();

  assert.equal(result.checked, 200);
  assert.deepEqual(
    harness.calls.batches.map((batch) => batch.length),
    [100, 100]
  );
  assert.equal(harness.calls.inserts, 0);
  assert.equal(harness.calls.deletes, 0);
});

test("201 employees are resolved in three bounded batches", async () => {
  const harness = createHarness(201);
  const result = await harness.run();

  assert.equal(result.checked, 201);
  assert.deepEqual(
    harness.calls.batches.map((batch) => batch.length),
    [100, 100, 1]
  );
});

test("failure in second batch prevents all absence writes", async () => {
  const harness = createHarness(101, 2);

  await assert.rejects(
    harness.run(),
    /attendance_cron:incomplete_shift_batch/
  );

  assert.deepEqual(
    harness.calls.batches.map((batch) => batch.length),
    [100, 1]
  );

  assert.equal(harness.calls.inserts, 0);
  assert.equal(harness.calls.deletes, 0);
  assert.equal(harness.calls.attendanceReads, 0);
});