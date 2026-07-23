import { CoreBookingService } from "./CoreBookingService";
import { CoreStaffService } from "./CoreStaffService";
import {
  fetchAttendanceRecordsFromWorker,
  type AttendanceWorkerRecord,
} from "./attendanceWorkerService";
import {
  calculateAttendanceDisciplineDay,
  normalizeAttendanceTimeHHMM,
  riyadhDateKeyFromTimestamp,
  summarizeAttendanceDisciplineMonth,
} from "../helpers/hr/attendanceDiscipline";
import {
  calculateStaffPerformance,
  type StaffPerformanceAttendanceSnapshot,
  type StaffPerformanceBookingInput,
  type StaffPerformanceEmployeeInput,
  type StaffPerformanceFilters,
  type StaffPerformanceResult,
} from "../helpers/hr/staffPerformance";
import type { CoreBooking, CoreBookingItem, CoreStaff } from "../types/coreApi";
import type { StaffPublicWithId } from "./firestoreStaffPublic";

const DEFAULT_SHIFT_START = "10:00";
const DEFAULT_SHIFT_END = "22:00";
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

type StaffPerformanceEmployeeSource = StaffPerformanceEmployeeInput & {
  customWorkingHours?: StaffPublicWithId["customWorkingHours"];
  useCustomWorkingHours?: boolean;
};

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

function weekdayKey(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return "sun";
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return WEEKDAY_KEYS[value.getUTCDay()] || "sun";
}

function staffToPerformanceEmployee(staff: CoreStaff): StaffPerformanceEmployeeSource {
  const schedules: StaffPerformanceEmployeeSource["customWorkingHours"] = {};
  for (const schedule of staff.schedules || []) {
    const key = WEEKDAY_KEYS[Number(schedule.weekday || 0)] || "sun";
    schedules[key] = {
      enabled: schedule.active,
      start: schedule.startTime || DEFAULT_SHIFT_START,
      end: schedule.endTime || DEFAULT_SHIFT_END,
    };
  }

  return {
    id: staff.id,
    name: staff.name || staff.id,
    active: staff.active,
    jobTitle: staff.employmentStatus || "",
    department: (staff.specialties || []).slice(0, 2).join("، "),
    linkedUid: staff.firebaseUid || "",
    employeeUid: staff.firebaseUid || "",
    specialties: staff.specialties || [],
    customWorkingHours: schedules,
    useCustomWorkingHours: Boolean(Object.keys(schedules).length),
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

function resolveSchedule(employee: StaffPerformanceEmployeeSource, date: string) {
  const key = weekdayKey(date);
  const day = employee.useCustomWorkingHours ? employee.customWorkingHours?.[key] : undefined;
  if (day?.enabled === false) {
    return { enabled: false, start: DEFAULT_SHIFT_START, end: DEFAULT_SHIFT_END };
  }
  return {
    enabled: true,
    start: normalizeAttendanceTimeHHMM(day?.start) || DEFAULT_SHIFT_START,
    end: normalizeAttendanceTimeHHMM(day?.end) || DEFAULT_SHIFT_END,
  };
}

function summarizeAttendanceForEmployee(
  employee: StaffPerformanceEmployeeSource,
  records: AttendanceWorkerRecord[]
): StaffPerformanceAttendanceSnapshot {
  const recordsByDate = new Map<string, AttendanceWorkerRecord[]>();

  for (const record of records) {
    if (record.result !== "allowed" || !recordMatchesEmployee(record, employee)) continue;
    const riyadhDate = riyadhDateKeyFromTimestamp(record.serverTime);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(riyadhDate)) continue;
    if (!recordsByDate.has(riyadhDate)) recordsByDate.set(riyadhDate, []);
    recordsByDate.get(riyadhDate)!.push(record);
  }

  const days = Array.from(recordsByDate.entries()).map(([date, dayRecords]) => {
    const sorted = [...dayRecords].sort((left, right) => Date.parse(left.serverTime) - Date.parse(right.serverTime));
    const firstCheckIn = sorted.find((record) => record.type === "check_in");
    const lastCheckOut = [...sorted].reverse().find((record) => record.type === "check_out");
    const schedule = resolveSchedule(employee, date);
    return calculateAttendanceDisciplineDay({
      date,
      scheduledStart: schedule.start,
      scheduledEnd: schedule.end,
      isScheduledWorkDay: schedule.enabled,
      checkInAt: firstCheckIn?.serverTime,
      checkOutAt: lastCheckOut?.serverTime,
    });
  });

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

  return Object.fromEntries(
    employees.map((employee) => [employee.id, summarizeAttendanceForEmployee(employee, records)])
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
      console.warn("[staff-performance] attendance read failed", error);
      warnings.push("تعذر تحميل بيانات الحضور، لذلك يظهر الالتزام كغير متوفر.");
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

