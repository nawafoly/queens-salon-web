import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { resolveAttendanceCheckoutWindow } from "./attendance-worker.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");

test("day shift checkout stays open for three hours after the real shift end", () => {
  const window = resolveAttendanceCheckoutWindow({
    workDate: "2026-09-21",
    shift: {
      template_start_time: "15:00",
      template_end_time: "23:00",
      crosses_midnight: 0,
    },
  });

  assert.deepEqual(window, {
    workDate: "2026-09-21",
    shiftEndAt: "2026-09-21T20:00:00.000Z",
    checkoutDeadlineAt: "2026-09-21T23:00:00.000Z",
    graceMinutes: 180,
    crossesMidnight: false,
  });
});

test("shift that crosses midnight starts its three-hour checkout grace after next-day end", () => {
  const window = resolveAttendanceCheckoutWindow({
    workDate: "2026-09-21",
    shift: {
      template_start_time: "18:00",
      template_end_time: "01:00",
      crosses_midnight: 1,
    },
  });

  assert.equal(window?.workDate, "2026-09-21");
  assert.equal(window?.shiftEndAt, "2026-09-21T22:00:00.000Z");
  assert.equal(window?.checkoutDeadlineAt, "2026-09-22T01:00:00.000Z");
  assert.equal(window?.crossesMidnight, true);
});

test("attendance worker keeps checkout ownership on work_date instead of calendar midnight", () => {
  const worker = read("workers/attendance-worker.js");

  assert.match(worker, /ATTENDANCE_CHECKOUT_GRACE_MINUTES = 180/);
  assert.match(worker, /type === "check_out"[\s\S]{0,500}effectiveState\?\.work_date/);
  assert.match(worker, /work_date = \?, shift_end_at = \?, checkout_deadline_at = \?/);
  assert.match(worker, /COALESCE\(work_date, date\(server_time, '\+3 hours'\)\)/);
  assert.doesNotMatch(
    worker,
    /type === "check_out"[\s\S]{0,250}last_server_time >= \?[\s\S]{0,120}last_server_time < \?/
  );
});

test("employee attendance UI follows an active prior work day after midnight and exposes expiry as incomplete", () => {
  const service = read("src/services/attendanceWorkerService.ts");
  const overview = read("src/pages/hr/EmployeeOverview.tsx");
  const discipline = read("src/helpers/hr/attendanceDiscipline.ts");

  assert.match(service, /result\.state\?\.status === "checked_in"/);
  assert.match(service, /cleanText\(result\.state\.workDate\)/);
  assert.match(service, /result\.state\?\.expiredIncomplete === true/);
  assert.match(service, /status: "incomplete" as const/);

  assert.match(overview, /incomplete: "غير مكتمل"/);
  assert.match(overview, /لم تُسجّل بصمة الخروج/);
  assert.match(discipline, /status: "incomplete"/);
  assert.match(discipline, /statusLabel: "غير مكتمل"/);

  // Missing checkout is not converted into guessed shortage/early-leave minutes.
  const incompleteBlocks = [
    ...discipline.matchAll(
      /status: "incomplete",[\s\S]{0,180}statusLabel: "غير مكتمل"/g
    ),
  ];
  assert.ok(incompleteBlocks.length >= 2);
  assert.match(
    discipline,
    /!hasCompletePunches[\s\S]{0,1700}earlyLeaveHours: 0[\s\S]{0,400}missingHours: 0[\s\S]{0,400}status: "incomplete"/
  );
});

test("attendance migration adds work-date and checkout-window state without inventing checkout rows", () => {
  const migrationsDir = path.join(here, "attendance-migrations");
  const database = new DatabaseSync(":memory:");

  for (const migration of [
    "0001_create_attendance.sql",
    "0002_create_attendance_monthly_summaries.sql",
    "0003_add_work_zone_office_ip.sql",
    "0004_create_permission_cache.sql",
    "0005_create_attendance_device_security.sql",
    "0006_shift_work_date_and_checkout_window.sql",
  ]) {
    database.exec(fs.readFileSync(path.join(migrationsDir, migration), "utf8"));
  }

  const recordColumns = database
    .prepare("PRAGMA table_info(attendance_records)")
    .all()
    .map((row) => String(row.name));
  const stateColumns = database
    .prepare("PRAGMA table_info(attendance_state)")
    .all()
    .map((row) => String(row.name));

  assert.ok(recordColumns.includes("work_date"));
  assert.ok(stateColumns.includes("work_date"));
  assert.ok(stateColumns.includes("shift_end_at"));
  assert.ok(stateColumns.includes("checkout_deadline_at"));
  assert.ok(stateColumns.includes("expired_incomplete"));

  const migration = read(
    "workers/attendance-migrations/0006_shift_work_date_and_checkout_window.sql"
  );
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+attendance_records/i);
});
