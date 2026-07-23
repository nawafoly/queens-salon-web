const RIYADH_TIME_ZONE = "Asia/Riyadh";
const MINUTES_PER_DAY = 24 * 60;
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

export type AttendanceDayStatus =
  | "complete"
  | "complete_with_compensated_late"
  | "missing_hours"
  | "complete_with_extra_hours"
  | "compensated_late_with_extra_hours"
  | "incomplete"
  | "absent"
  | "off_day"
  | "off_day_work"
  | "leave";

export type AttendanceDisciplineDayInput = {
  date: string;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  isScheduledWorkDay?: boolean;
  isApprovedLeave?: boolean;
  isAbsent?: boolean;
};

export type AttendanceDisciplineDaySummary = {
  date: string;
  scheduledHours: number;
  actualWorkedHours: number;
  lateHours: number;
  earlyLeaveHours: number;
  compensatedLateHours: number;
  missingHours: number;
  extraHours: number;
  afterScheduleHours: number;
  netHourDifference: number;
  status: AttendanceDayStatus;
  statusLabel: string;
};

export type AttendanceDisciplineMonthSummary = {
  totalScheduledHours: number;
  totalActualWorkedHours: number;
  totalLateHours: number;
  totalEarlyLeaveHours: number;
  totalCompensatedLateHours: number;
  totalMissingHours: number;
  totalExtraHours: number;
  attendanceDays: number;
  absentDays: number;
  incompleteDays: number;
};

const RIYADH_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: RIYADH_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function roundHours(minutes: number) {
  return Math.round((minutes / 60) * 100) / 100;
}

function normalizeDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) return "";
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function dateSerial(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return Date.UTC(year, month - 1, day) / MILLIS_PER_DAY;
}

export function normalizeAttendanceTimeHHMM(value?: string | null) {
  const text = String(value || "").trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function timeToMinutes(value?: string | null) {
  const normalized = normalizeAttendanceTimeHHMM(value);
  if (!normalized) return null;
  const [hour, minute] = normalized.split(":").map(Number);
  return hour * 60 + minute;
}

function riyadhParts(value?: string | null) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return null;
  const parts = RIYADH_DATE_TIME_FORMATTER.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  const dateKey = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  if (!normalizeDateKey(dateKey) || !Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }
  return { dateKey, minutes: hour * 60 + minute };
}

export function riyadhDateKeyFromTimestamp(value?: string | null) {
  return riyadhParts(value)?.dateKey || "";
}

function timestampMinutesFromDayStart(value: string | null | undefined, dateKey: string) {
  const baseSerial = dateSerial(dateKey);
  const parts = riyadhParts(value);
  const currentSerial = parts ? dateSerial(parts.dateKey) : null;
  if (baseSerial == null || currentSerial == null || !parts) return null;
  return Math.round(currentSerial - baseSerial) * MINUTES_PER_DAY + parts.minutes;
}

function makeDaySummary(
  input: AttendanceDisciplineDayInput,
  values: Omit<AttendanceDisciplineDaySummary, "date">
): AttendanceDisciplineDaySummary {
  return {
    date: normalizeDateKey(input.date),
    ...values,
  };
}

function statusForCompleteDay(params: {
  lateMinutes: number;
  compensatedLateMinutes: number;
  missingMinutes: number;
  extraMinutes: number;
}) {
  if (params.missingMinutes > 0) {
    return {
      status: "missing_hours" as const,
      statusLabel: "ناقص ساعات",
    };
  }

  const hasFullyCompensatedLate =
    params.lateMinutes > 0 && params.compensatedLateMinutes >= params.lateMinutes;

  if (hasFullyCompensatedLate && params.extraMinutes > 0) {
    return {
      status: "compensated_late_with_extra_hours" as const,
      statusLabel: "تأخير معوّض + زيادة ساعات",
    };
  }

  if (hasFullyCompensatedLate) {
    return {
      status: "complete_with_compensated_late" as const,
      statusLabel: "مكتمل مع تأخير معوّض",
    };
  }

  if (params.extraMinutes > 0) {
    return {
      status: "complete_with_extra_hours" as const,
      statusLabel: "مكتمل مع زيادة ساعات",
    };
  }

  return {
    status: "complete" as const,
    statusLabel: "مكتمل",
  };
}

export function calculateAttendanceDisciplineDay(
  input: AttendanceDisciplineDayInput
): AttendanceDisciplineDaySummary {
  const date = normalizeDateKey(input.date);
  const isScheduledWorkDay = input.isScheduledWorkDay !== false;
  const scheduledStartMinutes = timeToMinutes(input.scheduledStart);
  const scheduledEndBaseMinutes = timeToMinutes(input.scheduledEnd);
  const hasSchedule =
    isScheduledWorkDay &&
    scheduledStartMinutes != null &&
    scheduledEndBaseMinutes != null;

  let scheduledEndMinutes = scheduledEndBaseMinutes;
  if (
    hasSchedule &&
    scheduledEndMinutes != null &&
    scheduledStartMinutes != null &&
    scheduledEndMinutes <= scheduledStartMinutes
  ) {
    scheduledEndMinutes += MINUTES_PER_DAY;
  }

  const scheduledMinutes =
    hasSchedule && scheduledStartMinutes != null && scheduledEndMinutes != null
      ? Math.max(0, scheduledEndMinutes - scheduledStartMinutes)
      : 0;

  const checkInMinutes = timestampMinutesFromDayStart(input.checkInAt, date);
  let checkOutMinutes = timestampMinutesFromDayStart(input.checkOutAt, date);
  if (checkInMinutes != null && checkOutMinutes != null && checkOutMinutes < checkInMinutes) {
    checkOutMinutes += MINUTES_PER_DAY;
  }

  const hasCheckIn = checkInMinutes != null;
  const hasCheckOut = checkOutMinutes != null;
  const hasCompletePunches = hasCheckIn && hasCheckOut;

  if (input.isApprovedLeave) {
    return makeDaySummary(input, {
      scheduledHours: roundHours(scheduledMinutes),
      actualWorkedHours: 0,
      lateHours: 0,
      earlyLeaveHours: 0,
      compensatedLateHours: 0,
      missingHours: 0,
      extraHours: 0,
      afterScheduleHours: 0,
      netHourDifference: 0,
      status: "leave",
      statusLabel: "إجازة معتمدة",
    });
  }

  if (!isScheduledWorkDay && !hasCompletePunches) {
    return makeDaySummary(input, {
      scheduledHours: 0,
      actualWorkedHours: 0,
      lateHours: 0,
      earlyLeaveHours: 0,
      compensatedLateHours: 0,
      missingHours: 0,
      extraHours: 0,
      afterScheduleHours: 0,
      netHourDifference: 0,
      status: "off_day",
      statusLabel: "خارج الدوام",
    });
  }

  if ((input.isAbsent || (!hasCheckIn && !hasCheckOut)) && scheduledMinutes > 0) {
    return makeDaySummary(input, {
      scheduledHours: roundHours(scheduledMinutes),
      actualWorkedHours: 0,
      lateHours: 0,
      earlyLeaveHours: 0,
      compensatedLateHours: 0,
      missingHours: roundHours(scheduledMinutes),
      extraHours: 0,
      afterScheduleHours: 0,
      netHourDifference: -roundHours(scheduledMinutes),
      status: "absent",
      statusLabel: "غياب",
    });
  }

  if (!hasCompletePunches) {
    return makeDaySummary(input, {
      scheduledHours: roundHours(scheduledMinutes),
      actualWorkedHours: 0,
      lateHours: 0,
      earlyLeaveHours: 0,
      compensatedLateHours: 0,
      missingHours: 0,
      extraHours: 0,
      afterScheduleHours: 0,
      netHourDifference: 0,
      status: "incomplete",
      statusLabel: "بصمة ناقصة",
    });
  }

  const actualCheckInMinutes = checkInMinutes;
  const actualCheckOutMinutes = checkOutMinutes;
  if (actualCheckInMinutes == null || actualCheckOutMinutes == null) {
    return makeDaySummary(input, {
      scheduledHours: roundHours(scheduledMinutes),
      actualWorkedHours: 0,
      lateHours: 0,
      earlyLeaveHours: 0,
      compensatedLateHours: 0,
      missingHours: 0,
      extraHours: 0,
      afterScheduleHours: 0,
      netHourDifference: 0,
      status: "incomplete",
      statusLabel: "بصمة ناقصة",
    });
  }

  const actualMinutes = Math.max(0, actualCheckOutMinutes - actualCheckInMinutes);

  if (!isScheduledWorkDay || scheduledMinutes <= 0) {
    return makeDaySummary(input, {
      scheduledHours: 0,
      actualWorkedHours: roundHours(actualMinutes),
      lateHours: 0,
      earlyLeaveHours: 0,
      compensatedLateHours: 0,
      missingHours: 0,
      extraHours: roundHours(actualMinutes),
      afterScheduleHours: roundHours(actualMinutes),
      netHourDifference: roundHours(actualMinutes),
      status: "off_day_work",
      statusLabel: "عمل في يوم غير مجدول",
    });
  }

  const lateMinutes = Math.max(0, actualCheckInMinutes - scheduledStartMinutes!);
  const earlyLeaveMinutes = Math.max(0, scheduledEndMinutes! - actualCheckOutMinutes);
  const afterScheduleMinutes = Math.max(0, actualCheckOutMinutes - scheduledEndMinutes!);
  const compensatedLateMinutes = Math.min(lateMinutes, afterScheduleMinutes);
  const missingMinutes = Math.max(0, scheduledMinutes - actualMinutes);
  const extraMinutes = Math.max(0, actualMinutes - scheduledMinutes);
  const status = statusForCompleteDay({
    lateMinutes,
    compensatedLateMinutes,
    missingMinutes,
    extraMinutes,
  });

  return makeDaySummary(input, {
    scheduledHours: roundHours(scheduledMinutes),
    actualWorkedHours: roundHours(actualMinutes),
    lateHours: roundHours(lateMinutes),
    earlyLeaveHours: roundHours(earlyLeaveMinutes),
    compensatedLateHours: roundHours(compensatedLateMinutes),
    missingHours: roundHours(missingMinutes),
    extraHours: roundHours(extraMinutes),
    afterScheduleHours: roundHours(afterScheduleMinutes),
    netHourDifference: roundHours(actualMinutes - scheduledMinutes),
    status: status.status,
    statusLabel: status.statusLabel,
  });
}

export function summarizeAttendanceDisciplineMonth(
  days: AttendanceDisciplineDaySummary[]
): AttendanceDisciplineMonthSummary {
  const summary: AttendanceDisciplineMonthSummary = {
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
  };

  for (const day of days) {
    summary.totalScheduledHours += day.scheduledHours;
    summary.totalActualWorkedHours += day.actualWorkedHours;
    summary.totalLateHours += day.lateHours;
    summary.totalEarlyLeaveHours += day.earlyLeaveHours;
    summary.totalCompensatedLateHours += day.compensatedLateHours;
    summary.totalMissingHours += day.missingHours;
    summary.totalExtraHours += day.extraHours;

    if (day.status === "absent") summary.absentDays += 1;
    if (day.status === "incomplete") summary.incompleteDays += 1;
    if (day.actualWorkedHours > 0 && day.status !== "incomplete") {
      summary.attendanceDays += 1;
    }
  }

  return {
    totalScheduledHours: Math.round(summary.totalScheduledHours * 100) / 100,
    totalActualWorkedHours: Math.round(summary.totalActualWorkedHours * 100) / 100,
    totalLateHours: Math.round(summary.totalLateHours * 100) / 100,
    totalEarlyLeaveHours: Math.round(summary.totalEarlyLeaveHours * 100) / 100,
    totalCompensatedLateHours:
      Math.round(summary.totalCompensatedLateHours * 100) / 100,
    totalMissingHours: Math.round(summary.totalMissingHours * 100) / 100,
    totalExtraHours: Math.round(summary.totalExtraHours * 100) / 100,
    attendanceDays: summary.attendanceDays,
    absentDays: summary.absentDays,
    incompleteDays: summary.incompleteDays,
  };
}

function formatNumber(value: number) {
  const rounded = Math.round(Math.abs(value) * 100) / 100;
  if (rounded === 0) return "0";
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function formatAttendanceHours(value: number) {
  if (Math.abs(value) < 0.005) return "0";
  return `${formatNumber(value)} ساعة`;
}

export function formatSignedAttendanceHours(value: number) {
  if (Math.abs(value) < 0.005) return "0";
  const sign = value > 0 ? "+" : "-";
  return `${sign}${formatNumber(value)} ساعة`;
}
