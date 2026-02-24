export type WeekdayKey = "sat" | "sun" | "mon" | "tue" | "wed" | "thu" | "fri";

export type StaffWorkingDay = {
  enabled?: boolean;
  start?: string;
  end?: string;
};

export type StaffWorkingHourOverride = {
  date: string;
  enabled?: boolean;
  start?: string;
  end?: string;
};

export type BookingHourOverride = {
  fromDate: string;
  toDate: string;
  mode: "hours" | "closed";
  start?: string;
  end?: string;
  includeWeekdays?: WeekdayKey[];
  blockedWeekdays?: WeekdayKey[];
};

export type StaffPayrollMethod = "hours_from_salary" | "invoice_percentage";
export type StaffOvertimeHoursBasis = "regular" | "season";

export type StaffPayrollSource = {
  id: string;
  name: string;
  active?: boolean;
  useCustomWorkingHours?: boolean;
  customWorkingHours?: Partial<Record<WeekdayKey, StaffWorkingDay>>;
  customWorkingHourOverrides?: StaffWorkingHourOverride[];
  monthlySalary?: number;
  overtimeMethod?: StaffPayrollMethod;
  overtimeDaysPerMonth?: number;
  overtimeBaseHoursPerDay?: number;
  overtimeSeasonBaseHoursPerDay?: number;
  autoSeasonOvertimeBasis?: boolean;
  overtimeHoursBasis?: StaffOvertimeHoursBasis;
  overtimePercent?: number;
  overtimeInvoicePercent?: number;
};

export type BookingPayrollSource = {
  date: string;
  status: string;
  amount: number;
  employeeId?: string | null;
  employeeUid?: string | null;
  employeeKey?: string | null;
  employeeName?: string | null;
};

export type AttendanceViolationType = "absent" | "late" | "leave";

export type AttendancePayrollSource = {
  date: string;
  type: AttendanceViolationType;
  minutes?: number;
  absentFullDay?: boolean;
};

export type PayrollSettingsSource = {
  booking?: {
    businessHours?: Partial<Record<WeekdayKey, StaffWorkingDay>>;
    bookingHourOverrides?: BookingHourOverride[];
  };
  catalogSeasonPricing?: {
    enabled?: boolean;
    startDate?: string;
    endDate?: string;
    from?: string;
    to?: string;
  };
};

export type NormalizedPayrollConfig = {
  monthlySalary: number;
  method: StaffPayrollMethod;
  daysPerMonth: number;
  baseHoursPerDay: number;
  seasonBaseHoursPerDay: number;
  autoSeasonOvertimeBasis: boolean;
  hoursBasis: StaffOvertimeHoursBasis;
  overtimePercent: number;
  invoicePercent: number;
};

export type ScheduledHoursSummary = {
  workedDays: number;
  seasonDays: number;
  scheduledHours: number;
  baselineHours: number;
  overtimeHours: number;
  basis: StaffOvertimeHoursBasis;
};

export type PayrollMonthSummary = {
  monthKey: string;
  salaryAmount: number;
  overtimeAmount: number;
  attendanceDeductionHours: number;
  attendanceDeductionAmount: number;
  finalPayable: number;
  totalAmount: number;
  method: StaffPayrollMethod;
  invoiceCount: number;
  invoiceRevenue: number;
  hourlyRate: number;
  overtimeRate: number;
  config: NormalizedPayrollConfig;
  schedule: ScheduledHoursSummary;
};

export type PayrollExpenseRow = {
  id: string;
  date: string;
  amount: number;
  category: string;
  title: string;
  note: string;
  paymentMethod: string;
  createdAt: number;
  staffId: string;
  staffName: string;
  kind: "salary" | "overtime";
  monthKey: string;
};

const DEFAULT_OPEN_TIME = "10:00";
const DEFAULT_CLOSE_TIME = "22:00";
const REVENUE_STATUSES = new Set(["confirmed", "completed"]);

function round2(v: number) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function normalizeIsoDate(v: any): string {
  const s = String(v || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function normalizeTimeHHMM(v: any): string {
  const s = String(v || "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "";
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return "";
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return "";
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function toMinutes(hhmm: string): number {
  const s = normalizeTimeHHMM(hhmm);
  if (!s) return 0;
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

function hoursBetween(start: string, end: string): number {
  const s = toMinutes(start);
  let e = toMinutes(end);
  if (e <= s) e += 24 * 60;
  return Math.max(0, (e - s) / 60);
}

function normalizeWeekdayKey(v: any): WeekdayKey | "" {
  const s = String(v || "").trim().toLowerCase() as WeekdayKey;
  return (["sat", "sun", "mon", "tue", "wed", "thu", "fri"] as WeekdayKey[]).includes(s) ? s : "";
}

function weekdayFromIso(dateIso: string): WeekdayKey | "" {
  const s = normalizeIsoDate(dateIso);
  if (!s) return "";
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  const map: WeekdayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return map[d.getDay()] || "";
}

function normalizeNameKey(v: any): string {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي");
}

function normalizeWorkingHours(
  src: any
): Record<WeekdayKey, StaffWorkingDay> {
  const fallback: StaffWorkingDay = {
    enabled: true,
    start: DEFAULT_OPEN_TIME,
    end: DEFAULT_CLOSE_TIME,
  };
  const out: Record<WeekdayKey, StaffWorkingDay> = {
    sat: { ...fallback },
    sun: { ...fallback },
    mon: { ...fallback },
    tue: { ...fallback },
    wed: { ...fallback },
    thu: { ...fallback },
    fri: { ...fallback },
  };
  const obj = src && typeof src === "object" ? src : {};
  (["sat", "sun", "mon", "tue", "wed", "thu", "fri"] as WeekdayKey[]).forEach((d) => {
    const row = (obj as any)?.[d];
    if (!row || typeof row !== "object") return;
    out[d] = {
      enabled: row.enabled !== false,
      start: normalizeTimeHHMM(row.start) || fallback.start,
      end: normalizeTimeHHMM(row.end) || fallback.end,
    };
  });
  return out;
}

function normalizeWorkingHourOverrides(src: any): StaffWorkingHourOverride[] {
  const rows = Array.isArray(src) ? src : [];
  return rows
    .map((x: any) => {
      const date = normalizeIsoDate(x?.date);
      if (!date) return null;
      return {
        date,
        enabled: x?.enabled !== false,
        start: normalizeTimeHHMM(x?.start) || DEFAULT_OPEN_TIME,
        end: normalizeTimeHHMM(x?.end) || DEFAULT_CLOSE_TIME,
      } as StaffWorkingHourOverride;
    })
    .filter(Boolean) as StaffWorkingHourOverride[];
}

function normalizeBookingHourOverrides(src: any): BookingHourOverride[] {
  const rows = Array.isArray(src) ? src : [];
  return rows
    .map((x: any) => {
      const fromDateRaw = normalizeIsoDate(x?.fromDate);
      const toDateRaw = normalizeIsoDate(x?.toDate);
      if (!fromDateRaw || !toDateRaw) return null;
      const fromDate = fromDateRaw <= toDateRaw ? fromDateRaw : toDateRaw;
      const toDate = fromDateRaw <= toDateRaw ? toDateRaw : fromDateRaw;
      return {
        fromDate,
        toDate,
        mode: String(x?.mode || "").trim() === "closed" ? "closed" : "hours",
        start: normalizeTimeHHMM(x?.start) || undefined,
        end: normalizeTimeHHMM(x?.end) || undefined,
        includeWeekdays: Array.isArray(x?.includeWeekdays)
          ? x.includeWeekdays.map((d: any) => normalizeWeekdayKey(d)).filter(Boolean)
          : [],
        blockedWeekdays: Array.isArray(x?.blockedWeekdays)
          ? x.blockedWeekdays.map((d: any) => normalizeWeekdayKey(d)).filter(Boolean)
          : [],
      } as BookingHourOverride;
    })
    .filter(Boolean) as BookingHourOverride[];
}

function monthStartDate(monthKey: string): Date | null {
  const s = String(monthKey || "").trim();
  if (!/^\d{4}-\d{2}$/.test(s)) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
  return new Date(y, m - 1, 1);
}

export function monthKeyFromDate(dateIso: string): string {
  const s = normalizeIsoDate(dateIso);
  return s ? s.slice(0, 7) : "";
}

export function monthRangeKeys(fromIso: string, toIso: string): string[] {
  const from = normalizeIsoDate(fromIso);
  const to = normalizeIsoDate(toIso);
  if (!from && !to) return [];
  const startKey = monthKeyFromDate(from || to);
  const endKey = monthKeyFromDate(to || from);
  const start = monthStartDate(startKey);
  const end = monthStartDate(endKey);
  if (!start || !end) return [];
  const a = start <= end ? start : end;
  const b = start <= end ? end : start;
  const out: string[] = [];
  const cur = new Date(a);
  let guard = 0;
  while (cur <= b && guard < 120) {
    out.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`);
    cur.setMonth(cur.getMonth() + 1);
    guard += 1;
  }
  return out;
}

function lastDayOfMonthIso(monthKey: string): string {
  const start = monthStartDate(monthKey);
  if (!start) return "";
  const y = start.getFullYear();
  const m = start.getMonth();
  const end = new Date(y, m + 1, 0);
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(
    end.getDate()
  ).padStart(2, "0")}`;
}

function isSeasonDate(appSettings: PayrollSettingsSource | any, dateIso: string): boolean {
  const s = (appSettings as any)?.catalogSeasonPricing || {};
  const enabled = !!s.enabled;
  const start = normalizeIsoDate(s.startDate || s.from);
  const end = normalizeIsoDate(s.endDate || s.to);
  if (!enabled || !start || !end) return false;
  return dateIso >= start && dateIso <= end;
}

function resolveSalonDayHours(dateIso: string, appSettings: PayrollSettingsSource | any): number {
  const day = weekdayFromIso(dateIso);
  if (!day) return 0;
  const booking = (appSettings as any)?.booking || {};
  const businessHoursRaw = (booking as any)?.businessHours || {};
  const row = (businessHoursRaw as any)?.[day] || {
    enabled: true,
    start: DEFAULT_OPEN_TIME,
    end: DEFAULT_CLOSE_TIME,
  };
  let enabled = row.enabled !== false;
  let start = normalizeTimeHHMM(row.start) || DEFAULT_OPEN_TIME;
  let end = normalizeTimeHHMM(row.end) || DEFAULT_CLOSE_TIME;

  const overrides = normalizeBookingHourOverrides((booking as any)?.bookingHourOverrides);
  for (let i = overrides.length - 1; i >= 0; i--) {
    const ov = overrides[i];
    if (dateIso < ov.fromDate || dateIso > ov.toDate) continue;
    const includeDays = Array.isArray(ov.includeWeekdays) ? ov.includeWeekdays : [];
    if (includeDays.length > 0 && !includeDays.includes(day)) continue;
    const blockedDays = Array.isArray(ov.blockedWeekdays) ? ov.blockedWeekdays : [];
    if (ov.mode === "closed" || blockedDays.includes(day)) {
      enabled = false;
      break;
    }
    enabled = true;
    start = normalizeTimeHHMM(ov.start) || start;
    end = normalizeTimeHHMM(ov.end) || end;
    break;
  }

  if (!enabled) return 0;
  return hoursBetween(start, end);
}

function resolveStaffDayHours(
  dateIso: string,
  staff: StaffPayrollSource,
  appSettings: PayrollSettingsSource | any
): number {
  const day = weekdayFromIso(dateIso);
  if (!day) return 0;

  if (staff.useCustomWorkingHours) {
    const week = normalizeWorkingHours(staff.customWorkingHours);
    const base = week[day] || {
      enabled: true,
      start: DEFAULT_OPEN_TIME,
      end: DEFAULT_CLOSE_TIME,
    };
    let enabled = base.enabled !== false;
    let start = normalizeTimeHHMM(base.start) || DEFAULT_OPEN_TIME;
    let end = normalizeTimeHHMM(base.end) || DEFAULT_CLOSE_TIME;

    const ovs = normalizeWorkingHourOverrides(staff.customWorkingHourOverrides);
    const ov = ovs.find((x) => x.date === dateIso);
    if (ov) {
      if (ov.enabled === false) enabled = false;
      else {
        enabled = true;
        start = normalizeTimeHHMM(ov.start) || start;
        end = normalizeTimeHHMM(ov.end) || end;
      }
    }

    if (!enabled) return 0;
    return hoursBetween(start, end);
  }

  return resolveSalonDayHours(dateIso, appSettings);
}

function safeNumber(v: any, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizePayrollConfig(raw: any): NormalizedPayrollConfig {
  const method: StaffPayrollMethod =
    String(raw?.overtimeMethod || "").trim() === "invoice_percentage"
      ? "invoice_percentage"
      : "hours_from_salary";
  const hoursBasis: StaffOvertimeHoursBasis =
    String(raw?.overtimeHoursBasis || "").trim() === "season" ? "season" : "regular";

  return {
    monthlySalary: Math.max(0, safeNumber(raw?.monthlySalary, 0)),
    method,
    daysPerMonth: Math.max(1, safeNumber(raw?.overtimeDaysPerMonth, 30)),
    baseHoursPerDay: Math.max(1, safeNumber(raw?.overtimeBaseHoursPerDay, 8)),
    seasonBaseHoursPerDay: Math.max(1, safeNumber(raw?.overtimeSeasonBaseHoursPerDay, 6)),
    autoSeasonOvertimeBasis: raw?.autoSeasonOvertimeBasis === true,
    hoursBasis,
    overtimePercent: Math.max(0, safeNumber(raw?.overtimePercent, 0)),
    invoicePercent: Math.max(0, safeNumber(raw?.overtimeInvoicePercent, 0)),
  };
}

export function computeScheduledHoursSummaryForMonth(args: {
  staff: StaffPayrollSource;
  monthKey: string;
  appSettings: PayrollSettingsSource | any;
  config: NormalizedPayrollConfig;
}): ScheduledHoursSummary {
  const start = monthStartDate(args.monthKey);
  if (!start) {
    return {
      workedDays: 0,
      seasonDays: 0,
      scheduledHours: 0,
      baselineHours: 0,
      overtimeHours: 0,
      basis: args.config.hoursBasis,
    };
  }

  const y = start.getFullYear();
  const m = start.getMonth();
  const endDay = new Date(y, m + 1, 0).getDate();
  let workedDays = 0;
  let seasonDays = 0;
  let scheduledHours = 0;
  const selectedBase =
    args.config.hoursBasis === "season" ? args.config.seasonBaseHoursPerDay : args.config.baseHoursPerDay;

  for (let day = 1; day <= endDay; day++) {
    const dateIso = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dayHours = resolveStaffDayHours(dateIso, args.staff, args.appSettings);
    if (dayHours <= 0) continue;
    const seasonDay = isSeasonDate(args.appSettings, dateIso);
    const baseForDay = args.config.autoSeasonOvertimeBasis
      ? seasonDay
        ? args.config.seasonBaseHoursPerDay
        : args.config.baseHoursPerDay
      : selectedBase;
    workedDays += 1;
    scheduledHours += dayHours;
    if (seasonDay) seasonDays += 1;
  }

  // Accounting baseline is monthly (daysPerMonth), not only worked/open days.
  const baselineHours = args.config.daysPerMonth * selectedBase;
  const overtimeHours = Math.max(0, scheduledHours - baselineHours);

  return {
    workedDays,
    seasonDays,
    scheduledHours: round2(scheduledHours),
    baselineHours: round2(baselineHours),
    overtimeHours: round2(overtimeHours),
    basis: args.config.hoursBasis,
  };
}

function matchBookingToStaffId(
  booking: BookingPayrollSource,
  staffById: Set<string>,
  staffByKey: Map<string, string>,
  staffByName: Map<string, string>
): string | "" {
  const ekey = String(booking.employeeKey || "").trim();
  if (ekey && staffByKey.has(ekey)) return staffByKey.get(ekey) || "";

  const euid = String(booking.employeeUid || "").trim();
  if (euid && staffByKey.has(euid)) return staffByKey.get(euid) || "";

  const eid = String(booking.employeeId || "").trim();
  if (eid && staffById.has(eid)) return eid;

  const ename = normalizeNameKey(booking.employeeName || "");
  if (ename && staffByName.has(ename)) return staffByName.get(ename) || "";

  return "";
}

function buildStaffMonthRevenueMap(
  staffList: StaffPayrollSource[],
  bookings: BookingPayrollSource[],
  monthKeys: string[]
) {
  const monthSet = new Set(monthKeys);
  const staffById = new Set(staffList.map((s) => String(s.id || "").trim()).filter(Boolean));
  const staffByKey = new Map<string, string>();
  const staffByName = new Map<string, string>();

  staffList.forEach((s) => {
    const sid = String(s.id || "").trim();
    if (!sid) return;
    staffByKey.set(sid, sid);
    staffByKey.set(
      String(s.name || "")
        .trim()
        .replace(/\s+/g, "_"),
      sid
    );
    const n = normalizeNameKey(s.name);
    if (n) staffByName.set(n, sid);
  });

  const out = new Map<string, { invoiceCount: number; invoiceRevenue: number }>();

  bookings.forEach((b) => {
    const mk = monthKeyFromDate(String(b.date || ""));
    if (!mk || !monthSet.has(mk)) return;
    const status = String(b.status || "").trim().toLowerCase();
    if (!REVENUE_STATUSES.has(status)) return;
    const staffId = matchBookingToStaffId(b, staffById, staffByKey, staffByName);
    if (!staffId) return;
    const key = `${staffId}|${mk}`;
    const prev = out.get(key) || { invoiceCount: 0, invoiceRevenue: 0 };
    prev.invoiceCount += 1;
    prev.invoiceRevenue += Math.max(0, Number(b.amount || 0));
    out.set(key, prev);
  });

  return out;
}

export function computeStaffPayrollForMonth(args: {
  staff: StaffPayrollSource;
  monthKey: string;
  appSettings: PayrollSettingsSource | any;
  invoiceCount?: number;
  invoiceRevenue?: number;
  attendanceRows?: AttendancePayrollSource[];
}): PayrollMonthSummary {
  const cfg = normalizePayrollConfig(args.staff);
  const invoiceCount = Math.max(0, Number(args.invoiceCount || 0));
  const invoiceRevenue = Math.max(0, Number(args.invoiceRevenue || 0));
  const schedule = computeScheduledHoursSummaryForMonth({
    staff: args.staff,
    monthKey: args.monthKey,
    appSettings: args.appSettings,
    config: cfg,
  });

  let overtimeAmount = 0;
  let hourlyRate = 0;
  let overtimeRate = 0;
  const rateBaseHours =
    cfg.hoursBasis === "season" ? cfg.seasonBaseHoursPerDay : cfg.baseHoursPerDay;
  const deductionHourlyRate = cfg.monthlySalary / cfg.daysPerMonth / rateBaseHours;

  if (cfg.method === "invoice_percentage") {
    overtimeAmount = invoiceRevenue * (cfg.invoicePercent / 100);
  } else {
    hourlyRate = deductionHourlyRate;
    overtimeRate = hourlyRate * (1 + cfg.overtimePercent / 100);
    overtimeAmount = schedule.overtimeHours * overtimeRate;
  }

  let attendanceDeductionHours = 0;
  const attendanceRows = Array.isArray(args.attendanceRows) ? args.attendanceRows : [];
  if (attendanceRows.length > 0) {
    const byDate = new Map<string, AttendancePayrollSource>();
    attendanceRows.forEach((row) => {
      const d = normalizeIsoDate(row?.date);
      if (!d || monthKeyFromDate(d) !== args.monthKey) return;
      byDate.set(d, row);
    });

    const start = monthStartDate(args.monthKey);
    if (start) {
      const y = start.getFullYear();
      const m = start.getMonth();
      const endDay = new Date(y, m + 1, 0).getDate();
      for (let day = 1; day <= endDay; day++) {
        const dateIso = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const entry = byDate.get(dateIso);
        if (!entry) continue;
        const dayHours = resolveStaffDayHours(dateIso, args.staff, args.appSettings);
        if (dayHours <= 0) continue;
        if (entry.type === "absent" && entry.absentFullDay === true) {
          attendanceDeductionHours += dayHours;
          continue;
        }
        if (entry.type === "late" || entry.type === "leave") {
          const mins = Math.max(0, Number(entry.minutes || 0));
          const deduction = Math.min(dayHours, mins / 60);
          attendanceDeductionHours += deduction;
        }
      }
    }
  }

  const attendanceDeductionAmount = attendanceDeductionHours * deductionHourlyRate;
  const salaryAmount = cfg.monthlySalary;
  const totalAmount = salaryAmount + overtimeAmount;
  const finalPayable = salaryAmount - attendanceDeductionAmount + overtimeAmount;

  return {
    monthKey: args.monthKey,
    salaryAmount: round2(salaryAmount),
    overtimeAmount: round2(overtimeAmount),
    attendanceDeductionHours: round2(attendanceDeductionHours),
    attendanceDeductionAmount: round2(attendanceDeductionAmount),
    finalPayable: round2(finalPayable),
    totalAmount: round2(totalAmount),
    method: cfg.method,
    invoiceCount,
    invoiceRevenue: round2(invoiceRevenue),
    hourlyRate: round2(hourlyRate),
    overtimeRate: round2(overtimeRate),
    config: cfg,
    schedule,
  };
}

export function buildPayrollExpenseRowsForMonths(args: {
  staffList: StaffPayrollSource[];
  bookings: BookingPayrollSource[];
  appSettings: PayrollSettingsSource | any;
  monthKeys: string[];
}): PayrollExpenseRow[] {
  const months = Array.from(
    new Set(
      (Array.isArray(args.monthKeys) ? args.monthKeys : [])
        .map((x) => String(x || "").trim())
        .filter((x) => /^\d{4}-\d{2}$/.test(x))
    )
  ).sort((a, b) => a.localeCompare(b));
  if (!months.length) return [];

  const revenueMap = buildStaffMonthRevenueMap(args.staffList, args.bookings, months);
  const out: PayrollExpenseRow[] = [];

  args.staffList.forEach((staff) => {
    const sid = String(staff.id || "").trim();
    const sname = String(staff.name || "").trim() || sid || "موظفة";
    if (!sid) return;
    months.forEach((monthKey) => {
      const rev = revenueMap.get(`${sid}|${monthKey}`) || {
        invoiceCount: 0,
        invoiceRevenue: 0,
      };
      const summary = computeStaffPayrollForMonth({
        staff,
        monthKey,
        appSettings: args.appSettings,
        invoiceCount: rev.invoiceCount,
        invoiceRevenue: rev.invoiceRevenue,
      });
      const date = lastDayOfMonthIso(monthKey);
      const createdAt = Date.parse(`${date}T12:00:00`) || Date.now();

      if (summary.salaryAmount > 0) {
        out.push({
          id: `auto_payroll_salary_${sid}_${monthKey}`,
          date,
          amount: summary.salaryAmount,
          category: "رواتب الموظفات",
          title: `راتب ${sname} (${monthKey})`,
          note: "احتساب تلقائي من إعدادات الموظفة.",
          paymentMethod: "transfer",
          createdAt,
          staffId: sid,
          staffName: sname,
          kind: "salary",
          monthKey,
        });
      }

      if (summary.overtimeAmount > 0) {
        const basisLabel = summary.config.hoursBasis === "season" ? "موسم" : "عادي";
        const methodNote =
          summary.method === "invoice_percentage"
            ? `طريقة: نسبة من الفواتير | النسبة: ${summary.config.invoicePercent}% | فواتير الشهر: ${round2(
                summary.invoiceRevenue
              )}`
            : `طريقة: من الراتب | أساس الساعات: ${
                summary.config.autoSeasonOvertimeBasis ? "تلقائي حسب الموسم" : basisLabel
              } | ساعات الأوفرتايم: ${
                summary.schedule.overtimeHours
              } | النسبة: ${summary.config.overtimePercent}%`;
        out.push({
          id: `auto_payroll_overtime_${sid}_${monthKey}`,
          date,
          amount: summary.overtimeAmount,
          category: "أوفر تايم الموظفات",
          title: `أوفر تايم ${sname} (${monthKey})`,
          note: methodNote,
          paymentMethod: "transfer",
          createdAt,
          staffId: sid,
          staffName: sname,
          kind: "overtime",
          monthKey,
        });
      }
    });
  });

  return out.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return a.title.localeCompare(b.title, "ar");
  });
}

