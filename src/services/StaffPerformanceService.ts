import { CoreBookingService } from "./CoreBookingService";
import { CoreHrService } from "./CoreHrService";
import { CoreStaffService } from "./CoreStaffService";
import {
  fetchAttendanceRecordsFromWorker,
  type AttendanceWorkerRecord,
} from "./attendanceWorkerService";
import {
  calculateAttendanceDisciplineDay,
  riyadhDateKeyFromTimestamp,
  summarizeAttendanceDisciplineMonth,
} from "../helpers/hr/attendanceDiscipline";
import {
  resolveAttendanceShiftForDate,
} from "../helpers/hr/attendanceShiftResolver";
import {
  calculateStaffPerformance,
  type StaffPerformanceAttendanceSnapshot,
  type StaffPerformanceBookingInput,
  type StaffPerformanceEmployeeInput,
  type StaffPerformanceFilters,
  type StaffPerformanceResult,
} from "../helpers/hr/staffPerformance";
import type { CoreBooking, CoreBookingItem, CoreStaff } from "../types/coreApi";
import type { CoreResolvedShift } from "../types/hrCoreApi";

type StaffPerformanceEmployeeSource = StaffPerformanceEmployeeInput;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function monthBounds(year: number, month: number) {
  const safeYear = Number.isFinite(year) && year > 2000 ? Math.round(year) : new Date().getFullYear();
  const safeMonth = Number.isFinite(month) && month >= 1 && month <= 12 ? Math.round(month) : new Date().getMonth() + 1;
  const start = `${safeYear}-${String(safeMonth).padStart(2, "0")}-01`;
  const end = new Date(Date.UTC(safeYear, safeMonth, 0)).toISOString().slice(0, 10);
  return { fromDate: start, toDate: end };
}

function dateInRange(date: string, fromDate: string, toDate: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= fromDate && date <= toDate;
}

function staffToPerformanceEmployee(staff: CoreStaff): StaffPerformanceEmployeeSource {
  return {
    id: staff.id,
    name: staff.name || staff.id,
    active: staff.active,
    jobTitle: staff.employmentStatus || "",
    department: (staff.specialties || []).slice(0, 2).join("، "),
    linkedUid: staff.firebaseUid || "",
    employeeUid: staff.firebaseUid || "",
    specialties: staff.specialties || [],
  };
}

function itemToPerformanceItem(item: CoreBookingItem) {
  return {
    id: item.id,
    serviceId: item.serviceId,
    serviceName: item.serviceNameSnapshot,
    staffId: item.staffId || "",
    quantity: item.quantity || 1,
    unitPriceHalalas: item.unitPriceHalalas,
    totalHalalas: item.totalHalalas,
    discountHalalas: item.discountHalalas || 0,
    finalTotalHalalas: item.finalTotalHalalas ?? item.totalHalalas,
    bookingDate: item.bookingDate || null,
  };
}

function bookingToPerformanceInput(booking: CoreBooking): StaffPerformanceBookingInput {
  return {
    id: booking.id,
    publicId: booking.publicId || booking.id,
    status: booking.status,
    clientId: booking.clientId,
    clientName: booking.clientName || "",
    clientPhone: booking.clientPhone || "",
    staffId: booking.staffId || "",
    staffName: booking.staffName || "",
    bookingDate: booking.bookingDate,
    totalHalalas: booking.totalHalalas,
    items: (booking.items || []).map(itemToPerformanceItem),
  };
}

function employeeAliases(employee: StaffPerformanceEmployeeSource) {
  return new Set(
    [
      employee.id,
      employee.linkedUid,
      employee.employeeUid,
      employee.name,
    ].map(text).filter(Boolean)
  );
}

function recordMatchesEmployee(record: AttendanceWorkerRecord, employee: StaffPerformanceEmployeeSource) {
  const aliases = employeeAliases(employee);
  return aliases.has(text(record.employeeDocId)) || aliases.has(text(record.employeeUid));
}



function summarizeAttendanceForEmployee(
  employee: StaffPerformanceEmployeeSource,
  records: AttendanceWorkerRecord[],
  resolvedShiftsByDate: Map<string, CoreResolvedShift>
): StaffPerformanceAttendanceSnapshot {
  const recordsByDate = new Map<string, AttendanceWorkerRecord[]>();

  for (const record of records) {
    if (record.result !== "allowed" || !recordMatchesEmployee(record, employee)) continue;
    const riyadhDate = riyadhDateKeyFromTimestamp(record.serverTime);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(riyadhDate)) continue;
    if (!recordsByDate.has(riyadhDate)) recordsByDate.set(riyadhDate, []);
    recordsByDate.get(riyadhDate)!.push(record);
  }

  let coreScheduleUnavailable = false;

  const days = Array.from(recordsByDate.entries()).flatMap(([date, dayRecords]) => {
    const sorted = [...dayRecords].sort((left, right) => Date.parse(left.serverTime) - Date.parse(right.serverTime));
    const firstCheckIn = sorted.find((record) => record.type === "check_in");
    const lastCheckOut = [...sorted].reverse().find((record) => record.type === "check_out");

    const shiftResolution =
      resolveAttendanceShiftForDate({
        dateKey: date,
        coreResolvedShift:
          resolvedShiftsByDate.get(date) ||
          null,
      });

    if (shiftResolution.source === "core_unavailable") {
      coreScheduleUnavailable = true;
      return [];
    }

    return [
      calculateAttendanceDisciplineDay({
        date,
        scheduledStart:
          shiftResolution.startTime,
        scheduledEnd:
          shiftResolution.endTime,
        lateGraceMinutes:
          shiftResolution.lateGraceMinutes,
        isScheduledWorkDay:
          !shiftResolution.isOff,
        checkInAt:
          firstCheckIn?.serverTime,
        checkOutAt:
          lastCheckOut?.serverTime,
      }),
    ];
  });

  if (coreScheduleUnavailable) {
    return {
      totalScheduledHours: 0,
      totalActualWorkedHours: 0,
      totalLateHours: 0,
      totalEarlyLeaveHours: 0,
      totalCompensatedLateHours: 0,
      totalMissingHours: 0,
      totalExtraHours: 0,
      attendanceDays: 0,
      absentDays: 0,
      incompleteDays: 0,
      available: false,
      commitmentPercent: null,
      note: "تعذر تحميل الدوام المعتمد من Malikat Core لبعض أيام الحضور",
    };
  }

  if (!days.length) {
    return {
      totalScheduledHours: 0,
      totalActualWorkedHours: 0,
      totalLateHours: 0,
      totalEarlyLeaveHours: 0,
      totalCompensatedLateHours: 0,
      totalMissingHours: 0,
      totalExtraHours: 0,
      attendanceDays: 0,
      absentDays: 0,
      incompleteDays: 0,
      available: false,
      commitmentPercent: null,
      note: "لا توجد بيانات حضور كافية لحساب الالتزام",
    };
  }

  const summary = summarizeAttendanceDisciplineMonth(days);
  const commitmentPercent =
    summary.totalScheduledHours > 0
      ? Math.max(0, Math.min(100, ((summary.totalScheduledHours - summary.totalMissingHours) / summary.totalScheduledHours) * 100))
      : null;

  return {
    ...summary,
    available: summary.totalScheduledHours > 0,
    commitmentPercent,
    note: summary.totalScheduledHours > 0 ? "" : "لا توجد بيانات جدول دوام كافية لحساب الالتزام",
  };
}

async function loadAttendanceByEmployee(
  employees: StaffPerformanceEmployeeSource[],
  fromDate: string,
  toDate: string
) {
  const records: AttendanceWorkerRecord[] = [];
  const seenCursors = new Set<string>();
  let cursor = "";

  do {
    const page = await fetchAttendanceRecordsFromWorker({
      employeeUid: "",
      employeeDocId: "",
      fromDate,
      toDate,
      result: "allowed",
      limit: 200,
      cursor,
    });
    records.push(...page.records);

    const nextCursor = text(page.nextCursor);
    if (!nextCursor || seenCursors.has(nextCursor)) break;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor);

  const resolvedShiftBatch =
    await CoreHrService.resolveEmployeeShiftsRange({
      employeeIds:
        employees.map(
          (employee) =>
            employee.id
        ),
      dateFrom: fromDate,
      dateTo: toDate,
    });

  const resolvedShiftsByEmployee =
    new Map<
      string,
      Map<string, CoreResolvedShift>
    >();

  for (const row of resolvedShiftBatch.rows) {
    const employeeId =
      text(
        row.employeeId ||
        row.employee_id
      );

    const date =
      text(
        row.date
      );

    if (!employeeId || !date) {
      continue;
    }

    if (
      !resolvedShiftsByEmployee.has(
        employeeId
      )
    ) {
      resolvedShiftsByEmployee.set(
        employeeId,
        new Map()
      );
    }

    resolvedShiftsByEmployee
      .get(employeeId)!
      .set(
        date,
        row
      );
  }

  return Object.fromEntries(
    employees.map(
      (employee) => [
        employee.id,
        summarizeAttendanceForEmployee(
          employee,
          records,
          resolvedShiftsByEmployee.get(
            employee.id
          ) ||
            new Map<
              string,
              CoreResolvedShift
            >()
        ),
      ]
    )
  );
}

export const StaffPerformanceService = {
  monthBounds,

  async load(input: {
    year: number;
    month: number;
    fromDate?: string;
    toDate?: string;
    employeeId?: string;
    bookingStatus?: "completed" | "all";
  }): Promise<StaffPerformanceResult> {
    const fallbackBounds = monthBounds(input.year, input.month);
    const fromDate = text(input.fromDate) || fallbackBounds.fromDate;
    const toDate = text(input.toDate) || fallbackBounds.toDate;
    const filters: StaffPerformanceFilters = {
      fromDate,
      toDate,
      employeeId: text(input.employeeId),
      bookingStatus: input.bookingStatus || "completed",
    };

    const [staff, bookings] = await Promise.all([
      CoreStaffService.list({ activeOnly: false }),
      CoreBookingService.list({}),
    ]);
    const employees = staff.map(staffToPerformanceEmployee);
    const periodBookings = bookings
      .map(bookingToPerformanceInput)
      .filter((booking) => {
        const bookingDate = text(booking.bookingDate || booking.date);
        if (dateInRange(bookingDate, fromDate, toDate)) return true;
        return (booking.items || []).some((item) => dateInRange(text(item.bookingDate), fromDate, toDate));
      });
    const warnings: string[] = [];

    let attendanceByEmployeeId: Record<string, Partial<StaffPerformanceAttendanceSnapshot>> = {};
    try {
      attendanceByEmployeeId = await loadAttendanceByEmployee(employees, fromDate, toDate);
    } catch (error) {
      console.warn("[staff-performance] attendance/Core scheduling read failed", error);
      warnings.push("تعذر تحميل بيانات الحضور أو الدوام المعتمد من Malikat Core، لذلك يظهر الالتزام كغير متوفر.");
    }

    return calculateStaffPerformance({
      filters,
      employees,
      bookings: periodBookings,
      attendanceByEmployeeId,
      warnings,
    });
  },
};

