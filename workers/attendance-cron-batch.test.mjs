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

function createHarness({ employees, shifts, hasPunch = false }) {
  const calls = {
    batch: 0,
    attendance: 0,
    inserts: 0,
    deletes: 0,
  };

  const coreDb = {
    prepare(sql) {
      return {
        bind() {
          return {
            async run() {
              if (sql.includes("INSERT OR IGNORE")) {
                calls.inserts++;
              }
              if (sql.includes("DELETE FROM employee_absences")) {
                calls.deletes++;
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };

  const attendanceDb = {
    prepare() {
      calls.attendance++;
      return {
        bind() {
          return {
            async first() {
              return hasPunch ? { id: "punch-1" } : null;
            },
          };
        },
      };
    },
  };

  const context = {
    dbAll: async () => employees,
    dbFirst: async () => null,
    resolveEmployeeShiftsBatch: async () => {
      calls.batch++;
      return { rows: shifts };
    },
    riyadhCronParts: () => ({
      dateKey: "2026-11-23",
      minutes: 13 * 60,
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

const lockedShift = {
  source: "weekly_schedule",
  active: 1,
  template_start_time: "09:00",
  attendance_lock_enabled: 1,
  attendance_lock_after_minutes: 30,
};

test("cron resolves all employee shifts in one batch", async () => {
  const harness = createHarness({
    employees: [
      { id: "employee-a", firebase_uid: "uid-a" },
      { id: "employee-b", firebase_uid: "uid-b" },
    ],
    shifts: [
      lockedShift,
      { source: "exception", exception_type: "off", active: 0 },
    ],
  });

  const result = await harness.run();

  assert.equal(result.checked, 2);
  assert.equal(result.created, 1);
  assert.equal(harness.calls.batch, 1);
  assert.equal(harness.calls.attendance, 1);
  assert.equal(harness.calls.inserts, 1);
});

test("recorded check-in clears automatic absence", async () => {
  const harness = createHarness({
    employees: [{ id: "employee-a", firebase_uid: "uid-a" }],
    shifts: [lockedShift],
    hasPunch: true,
  });

  const result = await harness.run();

  assert.equal(result.created, 0);
  assert.equal(result.cleared, 1);
  assert.equal(harness.calls.deletes, 1);
  assert.equal(harness.calls.inserts, 0);
});

test("incomplete batch fails without creating absences", async () => {
  const harness = createHarness({
    employees: [
      { id: "employee-a" },
      { id: "employee-b" },
    ],
    shifts: [lockedShift],
  });

  await assert.rejects(
    harness.run(),
    /attendance_cron:incomplete_shift_batch/
  );

  assert.equal(harness.calls.inserts, 0);
  assert.equal(harness.calls.deletes, 0);
});

test("no active employees causes no shift queries or writes", async () => {
  const harness = createHarness({
    employees: [],
    shifts: [],
  });

  const result = await harness.run();

  assert.equal(result.checked, 0);
  assert.equal(harness.calls.batch, 0);
  assert.equal(harness.calls.inserts, 0);
});