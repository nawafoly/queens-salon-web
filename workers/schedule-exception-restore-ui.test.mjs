import assert from "node:assert/strict";
import test from "node:test";

import {
  buildScheduleExceptionRestorePayload,
  filterScheduleExceptionsForView,
  getScheduleExceptionAction,
  getScheduleExceptionRestoreConfirmationMessage,
} from "../src/pages/dashboardEmployees/shiftExceptionRestore.ts";

test("schedule exception restore UI actions distinguish cancelled history from active rows", () => {
  assert.deepEqual(
    getScheduleExceptionAction({ id: "active", status: "approved" }),
    { kind: "cancel", label: "إلغاء" }
  );
  assert.deepEqual(
    getScheduleExceptionAction({ id: "cancelled", status: "cancelled" }),
    { kind: "restore", label: "استعادة" }
  );
});

test("schedule exception restore payload copies operational custom semantics", () => {
  const payload = buildScheduleExceptionRestorePayload({
    id: "cancelled-0823",
    employeeId: "emp-aida",
    exceptionType: "custom",
    dateFrom: "2026-08-23",
    dateTo: "2026-08-23",
    startTime: "15:00",
    endTime: "23:00",
    shiftTemplateId: null,
    enabled: false,
    note: "custom shift",
    status: "cancelled",
  });

  assert.equal(payload.employeeId, "emp-aida");
  assert.equal(payload.exceptionType, "custom");
  assert.equal(payload.dateFrom, "2026-08-23");
  assert.equal(payload.dateTo, "2026-08-23");
  assert.equal(payload.startTime, "15:00");
  assert.equal(payload.endTime, "23:00");
  assert.equal(payload.shiftTemplateId, null);
  assert.equal(payload.enabled, true);
  assert.equal(payload.note, "custom shift");
  assert.equal(payload.status, "approved");
});

test("schedule exception restore payload preserves false null and optional off fields", () => {
  const payload = buildScheduleExceptionRestorePayload({
    id: "cancelled-off",
    employee_id: "emp-aida",
    exception_type: "off",
    date_from: "2026-08-02",
    date_to: "2026-08-02",
    shift_template_id: null,
    start_time: null,
    end_time: null,
    enabled: false,
    status: "cancelled",
  });

  assert.equal(payload.employeeId, "emp-aida");
  assert.equal(payload.exceptionType, "off");
  assert.equal(payload.enabled, false);
  assert.equal(payload.shiftTemplateId, null);
  assert.equal(payload.startTime, null);
  assert.equal(payload.endTime, null);
  assert.equal(payload.note, null);
});

test("historical restore uses the historical confirmation path", () => {
  assert.equal(
    getScheduleExceptionRestoreConfirmationMessage(
      { dateTo: "2026-08-16", status: "cancelled" },
      "2026-08-22"
    ),
    "هذا الاستثناء يخص تاريخًا سابقًا، وقد يؤثر على سجل الحضور أو احتساب الرواتب. هل تريد استعادته؟"
  );
  assert.equal(
    getScheduleExceptionRestoreConfirmationMessage(
      { dateTo: "2026-08-23", status: "cancelled" },
      "2026-08-22"
    ),
    "هل تريد استعادة هذا الاستثناء؟"
  );
});

test("default current exception view hides cancelled history while all preserves audit rows", () => {
  const rows = [
    { id: "cancelled-off-2026-08-02", status: "cancelled", exceptionType: "off", dateFrom: "2026-08-02", dateTo: "2026-08-02" },
    { id: "active-off-2026-08-02", status: "approved", exceptionType: "off", dateFrom: "2026-08-02", dateTo: "2026-08-02" },
  ];

  assert.deepEqual(
    filterScheduleExceptionsForView(rows, "current").map((row) => row.id),
    ["active-off-2026-08-02"]
  );
  assert.deepEqual(
    filterScheduleExceptionsForView(rows, "cancelled").map((row) => row.id),
    ["cancelled-off-2026-08-02"]
  );
  assert.deepEqual(
    filterScheduleExceptionsForView(rows, "all").map((row) => row.id),
    ["cancelled-off-2026-08-02", "active-off-2026-08-02"]
  );
});
