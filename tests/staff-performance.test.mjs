import test from "node:test";
import assert from "node:assert/strict";
import { calculateStaffPerformance } from "../src/helpers/hr/staffPerformance.ts";

const filters = {
  fromDate: "2026-07-01",
  toDate: "2026-07-31",
  bookingStatus: "completed",
};

const employees = [
  { id: "emp-a", name: "A", active: true },
  { id: "emp-b", name: "B", active: true },
];

function build(overrides = {}) {
  return calculateStaffPerformance({
    filters,
    employees,
    bookings: [],
    attendanceByEmployeeId: {},
    ...overrides,
  });
}

test("employee without bookings keeps real zero productivity", () => {
  const result = build();
  const row = result.rows.find((item) => item.employeeId === "emp-a");

  assert.equal(row.completedBookings, 0);
  assert.equal(row.servicesPerformed, 0);
  assert.equal(row.attributedRevenueHalalas, 0);
  assert.equal(row.averageRating, null);
  assert.ok(row.performanceScore >= 0 && row.performanceScore <= 100);
});

test("completed bookings count clients services and attributed revenue", () => {
  const result = build({
    bookings: [
      {
        id: "booking-1",
        status: "completed",
        clientId: "client-1",
        clientName: "Client",
        bookingDate: "2026-07-05",
        items: [
          {
            id: "item-1",
            serviceId: "hair",
            serviceName: "Hair",
            staffId: "emp-a",
            quantity: 2,
            finalTotalHalalas: 30000,
            bookingDate: "2026-07-05",
          },
        ],
        rating: 5,
      },
    ],
  });
  const row = result.rows.find((item) => item.employeeId === "emp-a");

  assert.equal(row.completedBookings, 1);
  assert.equal(row.uniqueClients, 1);
  assert.equal(row.servicesPerformed, 2);
  assert.equal(row.attributedRevenueHalalas, 30000);
  assert.equal(row.averageServiceValueHalalas, 15000);
  assert.equal(row.averageRating, 5);
});

test("cancelled and no-show bookings do not enter completed productivity", () => {
  const result = build({
    bookings: [
      {
        id: "cancelled-1",
        status: "cancelled",
        staffId: "emp-a",
        bookingDate: "2026-07-06",
      },
      {
        id: "noshow-1",
        status: "no_show",
        staffId: "emp-a",
        bookingDate: "2026-07-07",
      },
    ],
  });
  const row = result.rows.find((item) => item.employeeId === "emp-a");

  assert.equal(row.completedBookings, 0);
  assert.equal(row.servicesPerformed, 0);
  assert.equal(row.cancellations, 1);
  assert.equal(row.noShows, 1);
});

test("missing rating and missing attendance do not break scoring", () => {
  const result = build({
    bookings: [
      {
        id: "booking-2",
        status: "completed",
        clientId: "client-2",
        bookingDate: "2026-07-08",
        staffId: "emp-a",
        totalHalalas: 12000,
      },
    ],
  });
  const row = result.rows.find((item) => item.employeeId === "emp-a");

  assert.equal(row.averageRating, null);
  assert.equal(row.attendance.available, false);
  assert.ok(row.dataWarnings.some((warning) => warning.includes("التقييمات")));
  assert.ok(row.performanceScore >= 0 && row.performanceScore <= 100);
});

test("attendance summary contributes commitment without salary effects", () => {
  const result = build({
    attendanceByEmployeeId: {
      "emp-a": {
        totalScheduledHours: 10,
        totalActualWorkedHours: 9,
        totalLateHours: 1,
        totalCompensatedLateHours: 0,
        totalMissingHours: 1,
        totalExtraHours: 0,
        attendanceDays: 1,
        absentDays: 0,
        incompleteDays: 0,
        available: true,
      },
    },
  });
  const row = result.rows.find((item) => item.employeeId === "emp-a");

  assert.equal(row.attendance.commitmentPercent, 90);
  assert.equal("netSalary" in row, false);
  assert.ok(row.performanceScore >= 0 && row.performanceScore <= 100);
});
