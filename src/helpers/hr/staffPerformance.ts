import type { AttendanceDisciplineMonthSummary } from "./attendanceDiscipline";

export type StaffPerformanceFilters = {
  fromDate: string;
  toDate: string;
  employeeId?: string;
  bookingStatus?: "completed" | "all";
};

export type StaffPerformanceEmployeeInput = {
  id: string;
  name: string;
  active?: boolean;
  jobTitle?: string;
  department?: string;
  linkedUid?: string;
  employeeUid?: string;
  specialties?: string[];
};

export type StaffPerformanceBookingItemInput = {
  id?: string;
  serviceId?: string | null;
  serviceName?: string | null;
  staffId?: string | null;
  quantity?: number | null;
  unitPriceHalalas?: number | null;
  totalHalalas?: number | null;
  discountHalalas?: number | null;
  finalTotalHalalas?: number | null;
  bookingDate?: string | null;
};

export type StaffPerformanceBookingInput = {
  id: string;
  publicId?: string | null;
  status: string;
  clientId?: string | null;
  clientName?: string | null;
  clientPhone?: string | null;
  staffId?: string | null;
  staffName?: string | null;
  bookingDate?: string | null;
  date?: string | null;
  totalHalalas?: number | null;
  total?: number | null;
  finalPrice?: number | null;
  rating?: number | null;
  reviewRating?: number | null;
  customerRating?: number | null;
  items?: StaffPerformanceBookingItemInput[];
};

export type StaffPerformanceAttendanceSnapshot = AttendanceDisciplineMonthSummary & {
  available: boolean;
  commitmentPercent: number | null;
  note?: string;
};

export type StaffPerformanceServiceMetric = {
  serviceId: string;
  serviceName: string;
  count: number;
  revenueHalalas: number;
};

export type StaffPerformanceBookingMetric = {
  id: string;
  publicId: string;
  date: string;
  clientName: string;
  services: string[];
  serviceCount: number;
  revenueHalalas: number;
};

export type StaffPerformanceRow = {
  employeeId: string;
  employeeName: string;
  active: boolean;
  jobTitle: string;
  department: string;
  specialties: string[];
  completedBookings: number;
  uniqueClients: number;
  servicesPerformed: number;
  attributedRevenueHalalas: number;
  averageServiceValueHalalas: number | null;
  averageBookingValueHalalas: number | null;
  cancellations: number;
  noShows: number;
  averageRating: number | null;
  ratingCount: number;
  attendance: StaffPerformanceAttendanceSnapshot;
  performanceScore: number;
  scoreNotes: string[];
  dataWarnings: string[];
  topServices: StaffPerformanceServiceMetric[];
  bookingDetails: StaffPerformanceBookingMetric[];
};

export type StaffPerformanceSummary = {
  totalCompletedBookings: number;
  totalAttributedRevenueHalalas: number;
  activeEmployees: number;
  averagePerformanceScore: number;
  unassignedCompletedBookings: number;
  ratingAvailable: boolean;
  attendanceAvailable: boolean;
};

export type StaffPerformanceResult = {
  filters: StaffPerformanceFilters;
  rows: StaffPerformanceRow[];
  summary: StaffPerformanceSummary;
  warnings: string[];
};

export type StaffPerformanceCalculationInput = {
  filters: StaffPerformanceFilters;
  employees: StaffPerformanceEmployeeInput[];
  bookings: StaffPerformanceBookingInput[];
  attendanceByEmployeeId?: Record<string, Partial<StaffPerformanceAttendanceSnapshot>>;
  warnings?: string[];
};

const EMPTY_ATTENDANCE: StaffPerformanceAttendanceSnapshot = {
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

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalizedStatus(value: unknown) {
  return text(value).toLowerCase().replace(/[\s_-]+/g, "_");
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function halalas(value: unknown) {
  return Math.max(0, Math.round(numberValue(value, 0)));
}

function sarToHalalas(value: unknown) {
  return Math.max(0, Math.round(numberValue(value, 0) * 100));
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function dateInRange(value: unknown, fromDate: string, toDate: string) {
  const date = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return (!fromDate || date >= fromDate) && (!toDate || date <= toDate);
}

function bookingDate(booking: StaffPerformanceBookingInput) {
  return text(booking.bookingDate || booking.date);
}

function isCompletedStatus(status: unknown) {
  return normalizedStatus(status) === "completed";
}

function isCancelledStatus(status: unknown) {
  return ["cancelled", "canceled", "rejected"].includes(normalizedStatus(status));
}

function isNoShowStatus(status: unknown) {
  return ["no_show", "noshow"].includes(normalizedStatus(status));
}

function clientKey(booking: StaffPerformanceBookingInput) {
  return (
    text(booking.clientId) ||
    [booking.clientName, booking.clientPhone].map(text).filter(Boolean).join("|") ||
    `booking:${booking.id}`
  );
}

function itemRevenueHalalas(
  item: StaffPerformanceBookingItemInput,
  booking: StaffPerformanceBookingInput,
  fallbackItemCount: number
) {
  const explicitFinal = item.finalTotalHalalas ?? item.totalHalalas;
  if (explicitFinal != null) return halalas(explicitFinal);

  const unit = item.unitPriceHalalas != null ? halalas(item.unitPriceHalalas) : 0;
  if (unit > 0) return unit * Math.max(1, Math.round(numberValue(item.quantity, 1)));

  if (fallbackItemCount <= 1) {
    if (booking.totalHalalas != null) return halalas(booking.totalHalalas);
    return sarToHalalas(booking.finalPrice ?? booking.total);
  }

  const bookingTotal = booking.totalHalalas != null
    ? halalas(booking.totalHalalas)
    : sarToHalalas(booking.finalPrice ?? booking.total);
  return Math.round(bookingTotal / fallbackItemCount);
}

function bookingItemsInRange(booking: StaffPerformanceBookingInput, filters: StaffPerformanceFilters) {
  const items = Array.isArray(booking.items) ? booking.items : [];
  if (!items.length) return [];

  return items.filter((item) => {
    const date = text(item.bookingDate) || bookingDate(booking);
    return dateInRange(date, filters.fromDate, filters.toDate);
  });
}

function ratingValue(booking: StaffPerformanceBookingInput) {
  const value = numberValue(
    booking.rating ?? booking.reviewRating ?? booking.customerRating,
    Number.NaN
  );
  return Number.isFinite(value) && value > 0 ? clamp(value, 0, 5) : null;
}

function aliasesForEmployee(employee: StaffPerformanceEmployeeInput) {
  return new Set(
    [
      employee.id,
      employee.linkedUid,
      employee.employeeUid,
      employee.name,
    ].map(text).filter(Boolean)
  );
}

function resolveAttendance(
  employeeId: string,
  attendanceByEmployeeId: Record<string, Partial<StaffPerformanceAttendanceSnapshot>>
): StaffPerformanceAttendanceSnapshot {
  const raw = attendanceByEmployeeId[employeeId];
  if (!raw) return { ...EMPTY_ATTENDANCE };

  const scheduled = numberValue(raw.totalScheduledHours, 0);
  const missing = numberValue(raw.totalMissingHours, 0);
  const commitmentPercent =
    raw.commitmentPercent != null
      ? clamp(numberValue(raw.commitmentPercent, 0))
      : scheduled > 0
        ? clamp(((scheduled - missing) / scheduled) * 100)
        : null;

  return {
    ...EMPTY_ATTENDANCE,
    ...raw,
    totalScheduledHours: round2(scheduled),
    totalActualWorkedHours: round2(numberValue(raw.totalActualWorkedHours, 0)),
    totalLateHours: round2(numberValue(raw.totalLateHours, 0)),
    totalCompensatedLateHours: round2(numberValue(raw.totalCompensatedLateHours, 0)),
    totalMissingHours: round2(missing),
    totalExtraHours: round2(numberValue(raw.totalExtraHours, 0)),
    attendanceDays: Math.max(0, Math.round(numberValue(raw.attendanceDays, 0))),
    absentDays: Math.max(0, Math.round(numberValue(raw.absentDays, 0))),
    incompleteDays: Math.max(0, Math.round(numberValue(raw.incompleteDays, 0))),
    available: raw.available !== false && (scheduled > 0 || Number(raw.attendanceDays || 0) > 0),
    commitmentPercent,
  };
}

function scoreFromComponents(components: Array<{ value: number | null; weight: number }>) {
  const usable = components.filter((part) => part.value != null && Number.isFinite(part.value));
  const totalWeight = usable.reduce((sum, part) => sum + part.weight, 0);
  if (totalWeight <= 0) return 0;
  return Math.round(
    usable.reduce((sum, part) => sum + clamp(part.value || 0) * part.weight, 0) / totalWeight
  );
}

export function calculateStaffPerformance(
  input: StaffPerformanceCalculationInput
): StaffPerformanceResult {
  const employeesById = new Map<string, StaffPerformanceEmployeeInput>();
  const aliasToEmployeeId = new Map<string, string>();

  for (const employee of input.employees || []) {
    const id = text(employee.id);
    if (!id) continue;
    const normalized = {
      ...employee,
      id,
      name: text(employee.name) || id,
      active: employee.active !== false,
    };
    employeesById.set(id, normalized);
    aliasesForEmployee(normalized).forEach((alias) => aliasToEmployeeId.set(alias, id));
  }

  const ensureEmployee = (id: string, name = "") => {
    const cleanId = text(id);
    if (!cleanId) return null;
    if (!employeesById.has(cleanId)) {
      employeesById.set(cleanId, {
        id: cleanId,
        name: text(name) || cleanId,
        active: true,
      });
      aliasToEmployeeId.set(cleanId, cleanId);
    }
    return cleanId;
  };

  const stateByEmployee = new Map<string, {
    bookingIds: Set<string>;
    clientKeys: Set<string>;
    serviceCount: number;
    revenueHalalas: number;
    cancellations: Set<string>;
    noShows: Set<string>;
    ratings: number[];
    topServices: Map<string, StaffPerformanceServiceMetric>;
    bookingDetails: Map<string, StaffPerformanceBookingMetric>;
    warnings: Set<string>;
  }>();

  const stateFor = (employeeId: string) => {
    if (!stateByEmployee.has(employeeId)) {
      stateByEmployee.set(employeeId, {
        bookingIds: new Set(),
        clientKeys: new Set(),
        serviceCount: 0,
        revenueHalalas: 0,
        cancellations: new Set(),
        noShows: new Set(),
        ratings: [],
        topServices: new Map(),
        bookingDetails: new Map(),
        warnings: new Set(),
      });
    }
    return stateByEmployee.get(employeeId)!;
  };

  let unassignedCompletedBookings = 0;

  for (const booking of input.bookings || []) {
    const status = normalizedStatus(booking.status);
    const baseDate = bookingDate(booking);
    const fallbackStaffId = text(booking.staffId);
    const fallbackEmployeeId = aliasToEmployeeId.get(fallbackStaffId) || fallbackStaffId;
    const fallbackStaffName = text(booking.staffName);

    if ((isCancelledStatus(status) || isNoShowStatus(status)) && dateInRange(baseDate, input.filters.fromDate, input.filters.toDate)) {
      const employeeId = ensureEmployee(fallbackEmployeeId, fallbackStaffName);
      if (employeeId) {
        const state = stateFor(employeeId);
        if (isCancelledStatus(status)) state.cancellations.add(booking.id);
        if (isNoShowStatus(status)) state.noShows.add(booking.id);
      }
      continue;
    }

    if (!isCompletedStatus(status)) continue;

    const sourceItems = bookingItemsInRange(booking, input.filters);
    const items = sourceItems.length
      ? sourceItems
      : dateInRange(baseDate, input.filters.fromDate, input.filters.toDate)
        ? [{
            id: `${booking.id}:booking`,
            serviceName: "الخدمة",
            staffId: fallbackStaffId,
            quantity: 1,
          }]
        : [];

    if (!items.length) continue;

    const bookingRating = ratingValue(booking);
    const attributedEmployees = new Set<string>();
    let assignedInBooking = false;

    for (const item of items) {
      const rawStaffId = text(item.staffId) || fallbackStaffId;
      const employeeId = aliasToEmployeeId.get(rawStaffId) || rawStaffId;
      if (!employeeId) continue;

      const canonicalEmployeeId = ensureEmployee(employeeId, fallbackStaffName);
      if (!canonicalEmployeeId) continue;

      assignedInBooking = true;
      attributedEmployees.add(canonicalEmployeeId);

      const state = stateFor(canonicalEmployeeId);
      const quantity = Math.max(1, Math.round(numberValue(item.quantity, 1)));
      const revenue = itemRevenueHalalas(item, booking, items.length);
      const serviceId = text(item.serviceId || item.serviceName || "unknown");
      const serviceName = text(item.serviceName || item.serviceId || "خدمة غير محددة");
      const serviceMetric = state.topServices.get(serviceId) || {
        serviceId,
        serviceName,
        count: 0,
        revenueHalalas: 0,
      };

      serviceMetric.count += quantity;
      serviceMetric.revenueHalalas += revenue;
      state.topServices.set(serviceId, serviceMetric);

      state.serviceCount += quantity;
      state.revenueHalalas += revenue;
      state.bookingIds.add(booking.id);
      state.clientKeys.add(clientKey(booking));

      const detail = state.bookingDetails.get(booking.id) || {
        id: booking.id,
        publicId: text(booking.publicId) || booking.id,
        date: text(item.bookingDate) || baseDate,
        clientName: text(booking.clientName) || "عميلة غير محددة",
        services: [],
        serviceCount: 0,
        revenueHalalas: 0,
      };
      detail.services.push(serviceName);
      detail.serviceCount += quantity;
      detail.revenueHalalas += revenue;
      state.bookingDetails.set(booking.id, detail);
    }

    if (!assignedInBooking) {
      unassignedCompletedBookings += 1;
    }

    if (bookingRating != null) {
      attributedEmployees.forEach((employeeId) => stateFor(employeeId).ratings.push(bookingRating));
    }
  }

  const employeeIds = Array.from(employeesById.keys()).sort((left, right) =>
    text(employeesById.get(left)?.name).localeCompare(text(employeesById.get(right)?.name), "ar")
  );

  const maxCompleted = Math.max(
    0,
    ...employeeIds.map((id) => stateFor(id).bookingIds.size)
  );
  const maxRevenue = Math.max(
    0,
    ...employeeIds.map((id) => stateFor(id).revenueHalalas)
  );
  const hasRatings = employeeIds.some((id) => stateFor(id).ratings.length > 0);
  const attendanceByEmployeeId = input.attendanceByEmployeeId || {};

  const rows = employeeIds.map<StaffPerformanceRow>((employeeId) => {
    const employee = employeesById.get(employeeId)!;
    const state = stateFor(employeeId);
    const completedBookings = state.bookingIds.size;
    const servicesPerformed = state.serviceCount;
    const revenue = state.revenueHalalas;
    const attendance = resolveAttendance(employeeId, attendanceByEmployeeId);
    const averageRating = state.ratings.length
      ? round2(state.ratings.reduce((sum, value) => sum + value, 0) / state.ratings.length)
      : null;
    const scoreNotes: string[] = [];
    if (!hasRatings) scoreNotes.push("لا توجد تقييمات مرتبطة بالحجوزات في الفترة");
    if (!attendance.available) scoreNotes.push(attendance.note || "لا توجد بيانات حضور كافية");

    const performanceScore = scoreFromComponents([
      { value: attendance.commitmentPercent, weight: 30 },
      { value: maxCompleted > 0 ? (completedBookings / maxCompleted) * 100 : 0, weight: hasRatings ? 30 : 40 },
      { value: maxRevenue > 0 ? (revenue / maxRevenue) * 100 : 0, weight: hasRatings ? 20 : 30 },
      { value: averageRating == null ? null : (averageRating / 5) * 100, weight: hasRatings ? 20 : 0 },
    ]);

    const dataWarnings = Array.from(state.warnings);
    if (!completedBookings) dataWarnings.push("لا توجد حجوزات مكتملة لهذه الفترة");
    if (!attendance.available) dataWarnings.push(attendance.note || "لا توجد بيانات حضور كافية لحساب الالتزام");
    if (averageRating == null) dataWarnings.push("التقييمات غير متوفرة");

    return {
      employeeId,
      employeeName: text(employee.name) || employeeId,
      active: employee.active !== false,
      jobTitle: text(employee.jobTitle),
      department: text(employee.department),
      specialties: Array.isArray(employee.specialties) ? employee.specialties.map(text).filter(Boolean) : [],
      completedBookings,
      uniqueClients: state.clientKeys.size,
      servicesPerformed,
      attributedRevenueHalalas: revenue,
      averageServiceValueHalalas: servicesPerformed ? Math.round(revenue / servicesPerformed) : null,
      averageBookingValueHalalas: completedBookings ? Math.round(revenue / completedBookings) : null,
      cancellations: state.cancellations.size,
      noShows: state.noShows.size,
      averageRating,
      ratingCount: state.ratings.length,
      attendance,
      performanceScore: clamp(performanceScore),
      scoreNotes,
      dataWarnings,
      topServices: Array.from(state.topServices.values()).sort((left, right) => right.count - left.count),
      bookingDetails: Array.from(state.bookingDetails.values()).sort((left, right) => right.date.localeCompare(left.date)),
    };
  });

  const visibleRows = input.filters.employeeId
    ? rows.filter((row) => row.employeeId === input.filters.employeeId)
    : rows;
  const averagePerformanceScore = visibleRows.length
    ? Math.round(visibleRows.reduce((sum, row) => sum + row.performanceScore, 0) / visibleRows.length)
    : 0;

  return {
    filters: input.filters,
    rows: visibleRows,
    summary: {
      totalCompletedBookings: visibleRows.reduce((sum, row) => sum + row.completedBookings, 0),
      totalAttributedRevenueHalalas: visibleRows.reduce((sum, row) => sum + row.attributedRevenueHalalas, 0),
      activeEmployees: visibleRows.filter((row) => row.active).length,
      averagePerformanceScore,
      unassignedCompletedBookings,
      ratingAvailable: visibleRows.some((row) => row.ratingCount > 0),
      attendanceAvailable: visibleRows.some((row) => row.attendance.available),
    },
    warnings: [
      ...(input.warnings || []),
      ...(unassignedCompletedBookings > 0 ? ["بعض الحجوزات المكتملة غير منسوبة لموظفة"] : []),
    ],
  };
}

