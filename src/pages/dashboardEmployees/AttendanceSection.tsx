import { useEffect, useMemo, useRef, useState } from "react";
import RestReschedulingDatePicker from "../../components/dashboard-v2/DashboardDatePickerV2";
import RestReschedulingTimePicker from "../../components/dashboard-v2/DashboardTimePickerV2";

import type { StaffAttendanceWithId } from "../../services/attendanceTypes";
import { CoreHrService, type CoreWeeklyRestRescheduling } from "../../services/CoreHrService";
import { isCanonicalEmployeeIdentityId } from "../../helpers/employeeIdentityId";
import { clearAttendancePunchTimeFromWorker } from "../../services/attendancePunchAdminService";
import { attendanceReconciliationMessage } from "../../services/attendanceOperationClient";
import type { CoreResolvedShift } from "../../types/hrCoreApi";
import {
  computeAttendanceEarlyLeaveMinutes,
  computeResolvedAttendanceDay,
  recordsFromAttendanceRow,
  weeklyRestPresentationTone,
  resolveAttendanceShiftForDate,
} from "../../helpers/hr/attendanceShiftResolver";
import type { AttendanceSpecialDay } from "../../helpers/hr/attendanceCalendarData";
import {
  EmployeeAttendanceTabLiveV2,
  type EmployeeAttendanceRowLiveV2,
  type EmployeeAttendanceShiftInfoLiveV2,
} from "../../components/dashboard-v2/employee-workspace/live";
import { SCHEDULE_EXCEPTION_CHANGED_EVENT } from "./shiftExceptionRestore";
import { useEmployeeLanguage } from "./employeeLanguage";

const RESOLVED_SHIFT_CACHE: Record<string, CoreResolvedShift | null> = {};
const RESOLVED_SHIFT_PENDING: Record<string, Promise<CoreResolvedShift | null> | undefined> = {};
const LABEL_WEEKLY_OFF = "راحة أسبوعية";
const LABEL_TEMP_WEEKLY_OFF = "راحة أسبوعية مؤقتة";
const LABEL_EXCEPTION_OFF = "يوم راحة استثنائي";
const LABEL_WEEKLY_REST_WORK = "عمل استثنائي في يوم الراحة";
const TEMP_WEEKLY_OFF_MARKER = "[temp_weekly_off:";
const TEMP_WEEKLY_OFF_SYNC_EVENT = "queens:temporary-weekly-off-updated";

type TemporaryWeeklyOffSyncDetail = {
  employeeId?: string;
};

type AttendanceSectionProps = {
  isVisible: boolean;
  loading: boolean;
  error?: string;
  rows: StaffAttendanceWithId[];
  monthKey: string;
  selectedDate: string;
  employmentStartDate?: string;
  employmentEndDate?: string;
  employeeId?: string;
  employeeIds?: string[];
  canEdit?: boolean;
  canDelete?: boolean;
  canReview?: boolean;
  canCreateEmergencyLeave?: boolean;
  canCancelLeave?: boolean;
  canManageSchedule?: boolean;
  onMonthChange: (monthKey: string) => void;
  onSelectedDateChange: (dateKey: string) => void;
  onReload: () => void;
  onEditPunch: (dateKey: string) => void;
  onDeletePunch: (dateKey: string) => void;
  onPunchCleared?: (input: {
    date: string;
    type: "check_in" | "check_out";
    clearedRecords: number;
    employeeUid: string;
    employeeDocId: string;
    beforeTime: string;
  }) => void | Promise<void>;
  onCreateEmergencyLeave?: (dateKey: string) => void;
  onCancelLeave?: (dateKey: string) => void;
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function uniqueCleanTexts(values: unknown[]) {
  return Array.from(new Set(values.map(cleanText).filter(Boolean)));
}

const isCoreEmployeeIdentifier = isCanonicalEmployeeIdentityId;

function resolvedShiftRank(row?: CoreResolvedShift | null) {
  const source = cleanText(row?.source).toLowerCase();
  const exceptionType = cleanText(row?.exceptionType || row?.exception_type).toLowerCase();
  if (source === "weekly_rest_work_assignment") return 6;
  if (source === "exception" && exceptionType === "off") return 5;
  if (source === "exception") return 4;
  if (source === "assignment") return 3;
  if (source && source !== "none") return 2;
  return 0;
}

function pickBestResolvedShift(rows: Array<CoreResolvedShift | null | undefined>) {
  return rows
    .filter(Boolean)
    .sort((left, right) => resolvedShiftRank(right) - resolvedShiftRank(left))[0] || null;
}


const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const WEEKDAY_TO_OFF_KEY: Record<(typeof WEEKDAY_KEYS)[number], string> = {
  sun: "sunday",
  mon: "monday",
  tue: "tuesday",
  wed: "wednesday",
  thu: "thursday",
  fri: "friday",
  sat: "saturday",
};

function cleanTime(value: unknown) {
  const raw = cleanText(value);
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function weekdayKeyForDate(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return "sun";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return WEEKDAY_KEYS[date.getUTCDay()] || "sun";
}

function readPolicyMinutes(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return Math.round(number);
  }
  return undefined;
}

function isDateKey(value: unknown) {
  return /^\d{4}-\d{2}-\d{2}$/.test(cleanText(value));
}

function normalizeDateKey(value: unknown) {
  const raw = cleanText(value);
  if (isDateKey(raw)) return raw;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}
function normalizeMonthKey(value: unknown) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthDateKeys(monthKey: string) {
  const normalized = normalizeMonthKey(monthKey);
  if (!normalized) return [];
  const [year, month] = normalized.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: lastDay }, (_, index) => `${normalized}-${String(index + 1).padStart(2, "0")}`);
}
function isDateInsideRange(dateKey: string, fromValue: unknown, toValue: unknown) {
  const fromDate = normalizeDateKey(fromValue);
  const toDate = normalizeDateKey(toValue) || fromDate;
  if (!dateKey || !fromDate || !toDate) return false;
  return dateKey >= fromDate && dateKey <= toDate;
}

function parseSnapshot(value: unknown) {
  const raw = cleanText(value);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function isResolvedShiftOff(value?: Record<string, unknown> | CoreResolvedShift | null) {
  const row = value || {};
  return cleanText((row as Record<string, unknown>).exceptionType || (row as Record<string, unknown>).exception_type).toLowerCase() === "off";
}

function resolvedShiftSpecialDay(
  date: string,
  shift?: CoreResolvedShift | null
): AttendanceSpecialDay | null {
  const row = (shift || {}) as Record<string, unknown>;
  const source = cleanText(row.source).toLowerCase();
  const sourceId = cleanText(
    row.weeklyRestWorkAssignmentId ||
    row.weekly_rest_work_assignment_id ||
    row.assignmentId ||
    row.assignment_id ||
    row.sourceId ||
    row.source_id ||
    row.id
  );

  if (source === "weekly_rest_work_assignment") {
    return {
      date,
      kind: "weekly_rest_work",
      label: LABEL_WEEKLY_REST_WORK,
      source: "تكليف يوم الراحة",
      sourceId,
    };
  }

  if (!isResolvedShiftOff(shift)) return null;

  if (source === "weekly_schedule") {
    return {
      date,
      kind: "weekly_off",
      label: LABEL_WEEKLY_OFF,
      source: "جدول الدوام الأسبوعي",
      sourceId,
    };
  }

  if (
    source === "exception" &&
    cleanText(row.note)
      .toLowerCase()
      .startsWith(TEMP_WEEKLY_OFF_MARKER)
  ) {
    return {
      date,
      kind: "weekly_off",
      label: LABEL_TEMP_WEEKLY_OFF,
      source: "نقل مؤقت للراحة الأسبوعية",
      sourceId,
    };
  }

  return {
    date,
    kind: "exception_off",
    label: LABEL_EXCEPTION_OFF,
    source: "استثناء يومي معتمد",
    sourceId,
  };
}

function specialDayPriority(day?: AttendanceSpecialDay | null) {
  if (!day) return 0;
  if (day.kind === "leave" || day.kind === "rest") return 40;
  if (day.kind === "weekly_rest_work") return 38;
  if (day.kind === "weekly_off") return 35;
  if (day.kind === "exception_off") return 30;
  if (day.kind === "partial_leave") return 20;
  return 0;
}

function riyadhIsoFromDateAndTime(dateKey: string, value: string) {
  const time = cleanTime(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!time || !match) return "";
  const [hour, minute] = time.split(":").map(Number);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour - 3, minute, 0, 0)).toISOString();
}

function readCoreShiftWindow(row?: CoreResolvedShift | null) {
  const source = (row || {}) as Record<string, unknown>;
  const snapshot = parseSnapshot(source.snapshotJson || source.snapshot_json);
  const startTime =
    cleanTime(source.startTime) ||
    cleanTime(source.start_time) ||
    cleanTime(source.templateStartTime) ||
    cleanTime(source.template_start_time) ||
    cleanTime(snapshot.startTime) ||
    cleanTime(snapshot.start_time);
  const endTime =
    cleanTime(source.endTime) ||
    cleanTime(source.end_time) ||
    cleanTime(source.templateEndTime) ||
    cleanTime(source.template_end_time) ||
    cleanTime(snapshot.endTime) ||
    cleanTime(snapshot.end_time);
  return { startTime, endTime };
}

function windowLabel(startTime?: string, endTime?: string) {
  if (!startTime && !endTime) return "مغلق اليوم";
  return `${startTime || "--:--"} - ${endTime || "--:--"}`;
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function timeToMinutes(value: string) {
  const time = cleanTime(value);
  if (!time) return null;
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function activeStatusForWindow(dateKey: string, startTime?: string, endTime?: string) {
  if (!startTime && !endTime) return "مغلق اليوم";
  const today = localDateKey();
  if (dateKey !== today) return "مجدول";
  const start = timeToMinutes(startTime || "");
  const end = timeToMinutes(endTime || "");
  if (start === null || end === null) return "مجدول";
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  const inside = end <= start ? current >= start || current <= end : current >= start && current <= end;
  return inside ? "تعمل الآن" : "خارج الدوام";
}

function coreShiftInfo(dateKey: string, resolvedShift?: CoreResolvedShift | null): EmployeeAttendanceShiftInfoLiveV2 | null {
  if (!resolvedShift) return null;
  const source = cleanText(resolvedShift.source).toLowerCase();
  if (!source || source === "none") return null;
  const exceptionType = cleanText(resolvedShift.exceptionType || resolvedShift.exception_type).toLowerCase();
  const { startTime, endTime } = readCoreShiftWindow(resolvedShift);
  const shiftName = cleanText(resolvedShift.shiftName || resolvedShift.shift_name);
  if (source === "weekly_rest_work_assignment") {
    return {
      sourceLabel: "تكليف يوم الراحة",
      sourceDetail: LABEL_WEEKLY_REST_WORK,
      timeLabel: windowLabel(startTime, endTime),
      statusLabel: activeStatusForWindow(dateKey, startTime, endTime),
      tone: "gold",
    };
  }
  if (source === "exception") {
    if (exceptionType === "off") {
      return {
        sourceLabel: "استثناء يومي",
        sourceDetail: shiftName || "راحة / إغلاق لهذا اليوم",
        timeLabel: "مغلق اليوم",
        statusLabel: "مغلق اليوم",
        tone: "gold",
      };
    }
    return {
      sourceLabel: "استثناء يومي",
      sourceDetail: shiftName || (exceptionType === "custom" ? "وقت مخصص" : "شفت بديل"),
      timeLabel: windowLabel(startTime, endTime),
      statusLabel: activeStatusForWindow(dateKey, startTime, endTime),
      tone: "gold",
    };
  }
  if (source === "weekly_schedule") {
    if (exceptionType === "off" || Number((resolvedShift as any).active) !== 1) {
      return {
        sourceLabel: "جدول الدوام الأسبوعي",
        sourceDetail: "راحة أسبوعية",
        timeLabel: "مغلق اليوم",
        statusLabel: "راحة أسبوعية",
        tone: "gold",
      };
    }
    return {
      sourceLabel: "جدول الدوام الأسبوعي",
      sourceDetail: shiftName || "شفت اليوم من جدول الموظفة",
      timeLabel: windowLabel(startTime, endTime),
      statusLabel: activeStatusForWindow(dateKey, startTime, endTime),
      tone: "success",
    };
  }
  if (source === "assignment") {
    return {
      sourceLabel: "شفت افتراضي قديم",
      sourceDetail: shiftName || "تعيين احتياطي للموظفات القديمة",
      timeLabel: windowLabel(startTime, endTime),
      statusLabel: activeStatusForWindow(dateKey, startTime, endTime),
      tone: "neutral",
    };
  }
  return null;
}

function resolveSelectedShiftInfo(input: {
  dateKey: string;
  approvedLeaveDateKeys: string[];
  specialDay?: AttendanceSpecialDay | null;
  coreResolvedShift?: CoreResolvedShift | null;
  coreLoading: boolean;
  coreError: string;
}): EmployeeAttendanceShiftInfoLiveV2 {
  const {
    dateKey,
    approvedLeaveDateKeys,
    specialDay,
    coreResolvedShift,
    coreLoading,
    coreError,
  } = input;

  if (
    specialDay &&
    specialDay.kind !== "partial_leave" &&
    specialDay.kind !== "weekly_rest_work"
  ) {
    return {
      sourceLabel:
        specialDay.label,
      sourceDetail:
        specialDay.source,
      timeLabel:
        "\u0645\u063a\u0644\u0642 \u0627\u0644\u064a\u0648\u0645",
      statusLabel:
        specialDay.label,
      tone: "gold",
    };
  }

  if (
    approvedLeaveDateKeys.includes(
      dateKey
    )
  ) {
    return {
      sourceLabel:
        "\u0625\u062c\u0627\u0632\u0629 \u0645\u0639\u062a\u0645\u062f\u0629",
      sourceDetail:
        "\u0627\u0644\u0625\u062c\u0627\u0632\u0629 \u0627\u0644\u0645\u0639\u062a\u0645\u062f\u0629 \u0645\u0646 Core",
      timeLabel:
        "\u0645\u063a\u0644\u0642 \u0627\u0644\u064a\u0648\u0645",
      statusLabel:
        "\u0641\u064a \u0625\u062c\u0627\u0632\u0629",
      tone: "gold",
    };
  }

  if (coreLoading) {
    return {
      sourceLabel:
        "Malikat Core",
      sourceDetail:
        "\u062c\u0627\u0631\u064a \u0641\u062d\u0635 \u0627\u0644\u0634\u0641\u062a \u0627\u0644\u0645\u0639\u062a\u0645\u062f\u2026",
      timeLabel: "--",
      statusLabel:
        "\u062c\u0627\u0631\u064a \u0627\u0644\u062a\u062d\u0642\u0642",
      tone: "gold",
    };
  }

  if (coreError) {
    return {
      sourceLabel:
        "Malikat Core",
      sourceDetail:
        coreError,
      timeLabel:
        "\u063a\u064a\u0631 \u0645\u062a\u0627\u062d",
      statusLabel:
        "\u0627\u0644\u062f\u0648\u0627\u0645 \u0627\u0644\u0645\u0639\u062a\u0645\u062f \u063a\u064a\u0631 \u0645\u062a\u0627\u062d",
      tone: "gold",
    };
  }

  const resolved =
    resolveAttendanceShiftForDate({
      dateKey,
      coreResolvedShift,
    });

  if (
    resolved.source ===
    "core_unavailable"
  ) {
    return {
      sourceLabel:
        resolved.sourceLabel,
      sourceDetail:
        resolved.sourceDetail,
      timeLabel:
        "\u063a\u064a\u0631 \u0645\u062a\u0627\u062d",
      statusLabel:
        "\u0627\u0644\u062f\u0648\u0627\u0645 \u0627\u0644\u0645\u0639\u062a\u0645\u062f \u063a\u064a\u0631 \u0645\u062a\u0627\u062d",
      tone: "gold",
    };
  }

  if (resolved.isOff) {
    return {
      sourceLabel:
        resolved.sourceLabel,
      sourceDetail:
        resolved.shiftName ||
        resolved.sourceDetail,
      timeLabel:
        "\u0645\u063a\u0644\u0642 \u0627\u0644\u064a\u0648\u0645",
      statusLabel:
        resolved.shiftName ||
        "\u064a\u0648\u0645 \u0631\u0627\u062d\u0629",
      tone: "gold",
    };
  }

  return {
    sourceLabel:
      resolved.sourceLabel,
    sourceDetail:
      resolved.shiftName ||
      resolved.sourceDetail,
    timeLabel:
      windowLabel(
        resolved.startTime,
        resolved.endTime
      ),
    statusLabel:
      activeStatusForWindow(
        dateKey,
        resolved.startTime,
        resolved.endTime
      ),
    tone: "success",
  };
}

function toLiveAttendanceRow(
  row: StaffAttendanceWithId,
  coreResolvedShift?: CoreResolvedShift | null,
  absenceDateKeys?: Set<string>
): EmployeeAttendanceRowLiveV2 {
  const record =
    row as StaffAttendanceWithId &
      Record<string, unknown>;

  const checkInVerification =
    (
      record.checkInVerification ||
      {}
    ) as Record<string, unknown>;

  const checkOutVerification =
    (
      record.checkOutVerification ||
      {}
    ) as Record<string, unknown>;

  const records =
    Array.isArray(record.records)
      ? record.records as
          Record<string, unknown>[]
      : [];

  const date =
    cleanText(
      record.date ||
      record.dateKey ||
      record.dayKey
    );

  const dayRecords =
    recordsFromAttendanceRow(
      record
    );

  const resolvedDay =
    date
      ? computeResolvedAttendanceDay({
          dateKey: date,
          row: record,
          records: dayRecords,
          coreResolvedShift,
          absenceDateKeys,
        })
      : null;

  const resolvedSchedule =
    resolvedDay?.schedule ||
    null;

  const sourceInfo =
    resolvedDay
      ? {
          sourceLabel:
            resolvedDay
              .shiftResolution
              .sourceLabel,

          statusLabel:
            resolvedDay
              .shiftResolution
              .source ===
            "core_unavailable"
              ? "\u0627\u0644\u062f\u0648\u0627\u0645 \u0627\u0644\u0645\u0639\u062a\u0645\u062f \u063a\u064a\u0631 \u0645\u062a\u0627\u062d"
              : resolvedDay
                  .shiftResolution
                  .isOff
                ? "\u064a\u0648\u0645 \u0631\u0627\u062d\u0629"
                : "\u0646\u0634\u0637",
        }
      : null;

  return {
    date,

    weeklyRestTone: resolvedDay
      ? weeklyRestPresentationTone(
          resolvedDay.status,
          coreResolvedShift,
          dayRecords
        )
      : null,

    status:
      resolvedDay?.status ||
      cleanText(
        record.status ||
        record.attendanceStatus ||
        record.state
      ),

    checkInAtClient:
      cleanText(
        record.checkInAtClient ||
        record.checkInAt ||
        record.checkInTime
      ),

    checkOutAtClient:
      cleanText(
        record.checkOutAtClient ||
        record.checkOutAt ||
        record.checkOutTime
      ),

    lateMinutes:
      resolvedDay
        ? Math.max(
            0,
            Math.round(
              resolvedDay
                .computation
                .lateHours *
                60
            )
          )
        : Number(
            record.lateMinutes ||
            0
          ),

    pendingCompensationMinutes:
      resolvedDay
        ? Math.max(
            0,
            Math.round(
              resolvedDay
                .computation
                .pendingCompensationMinutes
            )
          )
        : 0,

    earlyLeaveMinutes:
      resolvedDay && date
        ? computeAttendanceEarlyLeaveMinutes({
            dateKey: date,
            records:
              dayRecords,
            schedule:
              resolvedDay.schedule,
          })
        : Number(
            record.earlyLeaveMinutes ||
            0
          ),

    missingMinutes:
      resolvedDay
        ? Math.max(
            0,
            Math.round(
              resolvedDay
                .computation
                .missingHours *
                60
            )
          )
        : Number(
            record.missingMinutes ||
            0
          ),

    shiftName:
      cleanText(
        resolvedDay
          ?.shiftResolution
          .shiftName
      ),

    shiftSourceLabel:
      sourceInfo?.sourceLabel,

    shiftStatusLabel:
      sourceInfo?.statusLabel,

    scheduledStartTime:
      cleanText(
        resolvedSchedule
          ?.startTime
      ),

    scheduledEndTime:
      cleanText(
        resolvedSchedule
          ?.endTime
      ),

    lateGraceMinutes:
      Number(
        resolvedSchedule
          ?.lateGraceMinutes ||
        0
      ),

    earlyLeaveGraceMinutes:
      0,

    notes:
      cleanText(
        record.notes ||
        record.note
      ),

    type:
      resolvedDay?.status === "leave"
        ? "leave"
        : resolvedDay?.status === "absent"
          ? "absent"
          : ["leave", "absent"].includes(
                cleanText(
                  record.type
                ).toLowerCase()
              )
            ? ""
            : cleanText(
                record.type
              ),

    absentFullDay:
      resolvedDay?.status ===
      "absent",

    recordCount:
      dayRecords.length ||
      records.length,

    workZoneName:
      cleanText(
        checkInVerification
          .workZoneName ||
        checkOutVerification
          .workZoneName ||
        records.find(
          (item) =>
            cleanText(
              item.zoneName
            )
        )?.zoneName
      ),
  };
}


function restReschedulingReviewState(
  operation: CoreWeeklyRestRescheduling
): "unknown" | "no_event" | "pending_review" | "owed" | "scheduled" | "fulfilled" {
  if (
    operation.status !== "cancelled" ||
    operation.restReviewChecked !== 1
  ) return "unknown";

  if (!operation.restReviewEventId) {
    return "no_event";
  }

  if (
    typeof operation.restReviewWorkedMinutes !== "number" ||
    !Number.isFinite(operation.restReviewWorkedMinutes) ||
    operation.restReviewWorkedMinutes < 0
  ) return "unknown";

  switch (operation.restReviewStatus) {
    case "pending_review":
      return "pending_review";
    case "owed":
      return "owed";
    case "scheduled":
      return "scheduled";
    case "fulfilled":
      return "fulfilled";
    default:
      return "unknown";
  }
}

function restReschedulingFinanceState(
  operation: CoreWeeklyRestRescheduling
): "completed" | "pending" | "review" {
  const expected = operation.status === "cancelled"
    ? 4
    : 2;

  const count = operation.financeOperationCount;
  const completed = operation.financeCompletedCount;
  const review = operation.financeReviewCount;

  if (
    typeof count !== "number" ||
    typeof completed !== "number" ||
    typeof review !== "number" ||
    !Number.isInteger(count) ||
    !Number.isInteger(completed) ||
    !Number.isInteger(review) ||
    count !== expected ||
    completed < 0 ||
    completed > count ||
    review < 0 ||
    review > count ||
    completed + review > count ||
    review > 0
  ) {
    return "review";
  }

  return completed === expected
    ? "completed"
    : "pending";
}

export default function AttendanceSection({
  isVisible,
  loading,
  error = "",
  rows,
  monthKey,
  selectedDate,
  employmentStartDate = "",
  employmentEndDate = "",
  employeeId = "",
  employeeIds = [],
  canEdit = false,
  canDelete = false,
  canCreateEmergencyLeave = false,
  canCancelLeave = false,
  canManageSchedule = false,
  onMonthChange,
  onSelectedDateChange,
  onReload,
  onEditPunch,
  onDeletePunch,
  onPunchCleared,
  onCreateEmergencyLeave,
  onCancelLeave,
}: AttendanceSectionProps) {
  const { t, tr, language } = useEmployeeLanguage();
  const [coreResolvedShiftsByDate, setCoreResolvedShiftsByDate] = useState<Record<string, CoreResolvedShift | null>>({});
  const [corePermissionSpecialDays, setCorePermissionSpecialDays] = useState<AttendanceSpecialDay[]>([]);
  const [corePermissionLoading, setCorePermissionLoading] = useState(false);
  const [corePermissionError, setCorePermissionError] = useState("");
  const [rawCoreAbsenceDateKeys, setCoreAbsenceDateKeys] =
    useState<string[]>([]);

  const [manualCoreAbsenceDateKeys, setManualCoreAbsenceDateKeys] =
    useState<string[]>([]);
  const [coreAbsenceLoading, setCoreAbsenceLoading] = useState(false);
  const [coreAbsenceError, setCoreAbsenceError] = useState("");
  const [coreShiftLoading, setCoreShiftLoading] = useState(false);
  const [coreShiftError, setCoreShiftError] = useState("");
  const [clearingPunchType, setClearingPunchType] = useState<"check_in" | "check_out" | "">("");
  const [punchClearMessage, setPunchClearMessage] = useState("");
  const [punchClearError, setPunchClearError] = useState("");
  const [coreScheduleRefreshVersion, setCoreScheduleRefreshVersion] = useState(0);
  const employeeIdsKey = uniqueCleanTexts([employeeId, ...employeeIds]).join("|");

  const [restReschedulingSnapshot, setRestReschedulingSnapshot] =
    useState<{
      key: string;
      rows: CoreWeeklyRestRescheduling[];
      employeeId: string;
    } | null>(null);

  const [restReschedulingError, setRestReschedulingError] =
    useState<{ key: string; message: string } | null>(null);

  const [restReschedulingRevision, setRestReschedulingRevision] =
    useState(0);

  const restReschedulingKey = JSON.stringify([
    employeeId,
    employeeIdsKey,
    monthKey,
    coreScheduleRefreshVersion,
    restReschedulingRevision,
    canManageSchedule,
    isVisible,
  ]);

  const restReschedulingReady =
    canManageSchedule &&
    restReschedulingSnapshot?.key === restReschedulingKey;

  const restReschedulingRows = restReschedulingReady
    ? restReschedulingSnapshot.rows
    : [];

  const currentRestReschedulingError =
    restReschedulingError?.key === restReschedulingKey
      ? restReschedulingError.message
      : "";

  useEffect(() => {
    let cancelled = false;

    setRestReschedulingSnapshot(null);
    setRestReschedulingError(null);

    if (!isVisible || !canManageSchedule) {
      return;
    }

    const load = async () => {
      const dates = monthDateKeys(monthKey);

      if (!dates.length) {
        throw new Error("Invalid attendance month");
      }

      const identities = uniqueCleanTexts(
        employeeIdsKey.split("|")
      ).filter(isCoreEmployeeIdentifier);

      if (!identities.length) {
        throw new Error("Canonical employee identity unavailable");
      }

      // Employee identity comes from the canonical employee
      // record, never from whichever response arrives first.

      const resolved = await Promise.allSettled(
        identities.map(async id => {
          const employee = await CoreHrService.getEmployee(id);

          const canonicalId = cleanText(employee.id);
          const linkedId = cleanText(employee.employeeId);

          if (
            !canonicalId ||
            (linkedId && linkedId !== canonicalId)
          ) {
            throw new Error("Canonical employee identity mismatch");
          }

          return canonicalId;
        })
      );

      const canonicalIds = uniqueCleanTexts(
        resolved.flatMap(result =>
          result.status === "fulfilled"
            ? [result.value]
            : []
        )
      );

      if (canonicalIds.length !== 1) {
        throw new Error("Canonical employee identity is ambiguous");
      }

      const canonicalId = canonicalIds[0];

      const operations =
        await CoreHrService.listWeeklyRestRescheduling(
          canonicalId,
          {
            from: dates[0],
            to: dates[dates.length - 1],
          }
        );

      if (
        operations.some(
          operation =>
            operation.employeeId !== canonicalId
        )
      ) {
        throw new Error("Rest rescheduling employee scope mismatch");
      }

      if (!cancelled) {
        setRestReschedulingSnapshot({
          key: restReschedulingKey,
          rows: operations,
          employeeId: canonicalId,
        });
      }
    };

    void load().catch(error => {
      if (!cancelled) {
        setRestReschedulingError({
          key: restReschedulingKey,
          message: String(error?.message || error),
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    restReschedulingKey,
    employeeIdsKey,
    monthKey,
    isVisible,
    canManageSchedule,
  ]);

  const selectedRestReschedulingRows =
    restReschedulingRows.filter(operation =>
      operation.originalRestDate === selectedDate ||
      operation.replacementRestDate === selectedDate
    );



  const restActionScope = JSON.stringify([
    employeeId,
    employeeIdsKey,
    selectedDate,
    monthKey,
    canManageSchedule,
    isVisible,
  ]);

  const restActionScopeRef = useRef(restActionScope);
  restActionScopeRef.current = restActionScope;

  const restActionInFlight = useRef(false);

  const restActionOperationRef = useRef<{
    fingerprint: string;
    id: string;
  } | null>(null);

  const [restActionSaving, setRestActionSaving] = useState(false);

  const [restActionMessage, setRestActionMessage] =
    useState<{
      scope: string;
      ar: string;
      en: string;
      error: boolean;
    } | null>(null);

  const activeRestReschedulingRows =
    selectedRestReschedulingRows.filter(
      operation => operation.status === "active"
    );

  const [restActionDraft, setRestActionDraft] =
    useState<{
      scope: string;
      mode: "create" | "cancel";
      operationId: string;
      replacementDate: string;
      startTime: string;
      endTime: string;
      reason: string;
    } | null>(null);

  const currentRestActionDraft =
    restActionDraft?.scope === restActionScope
      ? restActionDraft
      : null;

  const currentRestActionMessage =
    restActionMessage?.scope === restActionScope
      ? restActionMessage
      : null;

  function openRestAction(
    mode: "create" | "cancel",
    operationId = ""
  ) {
    if (
      !isVisible ||
      !canManageSchedule ||
      !restReschedulingReady ||
      attendanceCoreBlocked ||
      restActionInFlight.current
    ) {
      return;
    }

    if (mode === "create" && !restActionCanCreate) {
      return;
    }

    if (
      mode === "cancel" &&
      !activeRestReschedulingRows.some(operation =>
        operation.id === operationId &&
        restReschedulingFinanceState(operation) === "completed"
      )
    ) {
      return;
    }

    setRestActionMessage(null);

    setRestActionDraft({
      scope: restActionScope,
      mode,
      operationId,
      replacementDate: "",
      startTime: "",
      endTime: "",
      reason: "",
    });
  }

  async function submitRestAction() {
    const draft = currentRestActionDraft;

    const canonicalId =
      restReschedulingReady
        ? restReschedulingSnapshot.employeeId
        : "";

    if (
      !draft ||
      !canonicalId ||
      !canManageSchedule ||
      !isVisible ||
      attendanceCoreBlocked ||
      restActionInFlight.current
    ) {
      return;
    }

    const reason = draft.reason.trim();

    if (!reason || reason.length > 1500) {
      return;
    }

    if (draft.mode === "create") {
      if (
        !restActionCanCreate ||
        !/^\d{4}-\d{2}-\d{2}$/.test(draft.replacementDate) ||
        draft.replacementDate === selectedDate ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.startTime) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.endTime) ||
        draft.startTime >= draft.endTime ||
        activeRestReschedulingRows.length !== 0
      ) {
        return;
      }
    } else {
      const operation = activeRestReschedulingRows.find(
        row =>
          row.id === draft.operationId &&
          row.employeeId === canonicalId
      );

      if (
        !operation ||
        restReschedulingFinanceState(operation) !== "completed"
      ) {
        return;
      }
    }

    const submittedScope = restActionScope;

    restActionInFlight.current = true;
    setRestActionSaving(true);
    setRestActionMessage(null);

    let saved = false;

    try {
      let result;

      if (draft.mode === "create") {
        const input = {
          employeeId: canonicalId,
          originalRestDate: selectedDate,
          replacementRestDate: draft.replacementDate,
          startTime: draft.startTime,
          endTime: draft.endTime,
          reason,
        };

        const fingerprint = JSON.stringify(input);

        if (
          restActionOperationRef.current?.fingerprint !== fingerprint
        ) {
          restActionOperationRef.current = {
            fingerprint,
            id: crypto.randomUUID(),
          };
        }

        result = await CoreHrService.createWeeklyRestRescheduling({
          ...input,
          id: restActionOperationRef.current.id,
        });

        if (result.operation.status !== "active") {
          throw new Error("Unexpected rescheduling state");
        }

      } else {

        result = await CoreHrService.cancelWeeklyRestRescheduling(
          draft.operationId,
          canonicalId,
          reason
        );

        if (result.operation.status !== "cancelled") {
          throw new Error("Unexpected restoration state");
        }
      }

      saved = true;

      if (draft.mode === "create") {
        restActionOperationRef.current = null;
      }

      const complete =
        result.operationStateFresh &&
        result.reconciliation.financeCompleted;

      if (restActionScopeRef.current === submittedScope) {

        setRestActionDraft(null);

        setRestActionMessage({
          scope: submittedScope,
          ar: complete
            ? "تم حفظ العملية واكتمال التسوية المالية."
            : "تم حفظ العملية، والتسوية المالية لم تكتمل بعد.",
          en: complete
            ? "Saved. Financial reconciliation completed."
            : "Saved. Financial reconciliation is not yet complete.",
          error: false,
        });

        setRestReschedulingRevision(value => value + 1);
        setCoreScheduleRefreshVersion(value => value + 1);

        try {
          onReload();
        } catch {
          setRestActionMessage({
            scope: submittedScope,
            ar: "تم الحفظ، لكن تعذر تحديث بيانات الحضور.",
            en: "Saved, but attendance refresh failed.",
            error: false,
          });
        }
      }

      window.dispatchEvent(
        new Event("queens:staff-updated")
      );

    } catch (error) {

      if (restActionScopeRef.current === submittedScope) {
        setRestActionMessage({
          scope: submittedScope,
          ar: saved
            ? "تم الحفظ، لكن تعذر تحديث بعض البيانات."
            : "تعذر تأكيد العملية. تحقق من السجل قبل إعادة المحاولة.",
          en: saved
            ? "Saved, but some data could not be refreshed."
            : "Unable to confirm the operation. Check history before retrying.",
          error: !saved,
        });

        setRestReschedulingRevision(value => value + 1);
      }

      console.error("weekly-rest-rescheduling-action", error);

    } finally {
      restActionInFlight.current = false;
      setRestActionSaving(false);
    }
  }

  const [attendancePolicyLoading, setAttendancePolicyLoading] =
    useState(true);

  const [attendancePolicyError, setAttendancePolicyError] =
    useState("");

  const [attendancePolicyRevision, setAttendancePolicyRevision] =
    useState(0);

  const [attendancePolicyResult, setAttendancePolicyResult] =
    useState<{
      key: string;
      days: string[];
    } | null>(null);

  const attendancePolicyKey =
    `${employeeIdsKey}|${monthKey}|${attendancePolicyRevision}`;

  const exemptDateKeys =
    attendancePolicyResult?.key === attendancePolicyKey
      ? attendancePolicyResult.days
      : [];

  const attendancePolicyReady =
    attendancePolicyResult?.key === attendancePolicyKey;

  const coreAbsenceDateKeys = useMemo(() => {
    if (!attendancePolicyReady) return manualCoreAbsenceDateKeys;

    const exempt = new Set(exemptDateKeys);
    const manual = new Set(manualCoreAbsenceDateKeys);

    return rawCoreAbsenceDateKeys.filter(
      date => !exempt.has(date) || manual.has(date)
    );
  }, [
    attendancePolicyReady,
    exemptDateKeys,
    rawCoreAbsenceDateKeys,
    manualCoreAbsenceDateKeys,
  ]);

  useEffect(() => {
    const listener = (event: Event) => {
      const changedId = cleanText(
        (event as CustomEvent<{ employeeId?: string }>).detail?.employeeId
      );

      if (!employeeIdsKey.split("|").includes(changedId)) return;

      setAttendancePolicyRevision(value => value + 1);
    };

    window.addEventListener(
      "malikat:attendance-policy-changed",
      listener
    );

    return () => {
      window.removeEventListener(
        "malikat:attendance-policy-changed",
        listener
      );
    };
  }, [employeeIdsKey]);

  useEffect(() => {
    if (!isVisible) return;

    let cancelled = false;

    setAttendancePolicyLoading(true);
    setAttendancePolicyError("");
    setAttendancePolicyResult(null);

    const dates = monthDateKeys(monthKey);

    const load = async () => {
      if (!dates.length) {
        throw new Error("Invalid attendance month");
      }

      const identities = uniqueCleanTexts(employeeIdsKey.split("|"))
        .filter(isCoreEmployeeIdentifier);

      if (!identities.length) {
        throw new Error("Canonical employee identity unavailable");
      }

      const results = await Promise.allSettled(
        identities.map(id =>
          CoreHrService.getAttendancePolicy(id, {
            dateFrom: dates[0],
            dateTo: dates[dates.length - 1],
          })
        )
      );

      const successful = results.flatMap(result =>
        result.status === "fulfilled" ? [result.value] : []
      );

      if (successful.length !== 1) {
        throw new Error(
          "Canonical attendance policy could not be uniquely resolved"
        );
      }

      const snapshot = successful[0].snapshot;

      if (!snapshot || !Array.isArray(snapshot.days)) {
        throw new Error("Attendance policy snapshot unavailable");
      }

      const expectedDates = new Set(dates);
      const receivedDates = new Set<string>();

      for (const day of snapshot.days) {
        if (
          !expectedDates.has(day.date) ||
          receivedDates.has(day.date) ||
          !["required", "exempt"].includes(day.mode)
        ) {
          throw new Error("Invalid attendance policy day");
        }

        receivedDates.add(day.date);
      }

      if (receivedDates.size !== dates.length) {
        throw new Error("Incomplete attendance policy snapshot");
      }

      if (!cancelled) {
        setAttendancePolicyResult({
          key: attendancePolicyKey,
          days: snapshot.days
            .filter(day => day.mode === "exempt")
            .map(day => day.date),
        });
      }
    };

    void load()
      .catch(err => {
        if (!cancelled) {
          setAttendancePolicyError(
            String(err?.message || err)
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAttendancePolicyLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    attendancePolicyKey,
    employeeIdsKey,
    isVisible,
    monthKey,
  ]);

  useEffect(() => {
    const identityIds = new Set(employeeIdsKey.split("|").filter(Boolean));
    const handleTemporaryWeeklyOffUpdated = (event: Event) => {
      const detail = (event as CustomEvent<TemporaryWeeklyOffSyncDetail>).detail || {};
      const targetEmployeeId = cleanText(detail.employeeId);
      if (!targetEmployeeId || !identityIds.has(targetEmployeeId)) return;

      /*
       * Refresh trigger only.
       * The event must never become an operational
       * off/work-day source.
       */
      Object.keys(
        RESOLVED_SHIFT_CACHE
      ).forEach((key) => {
        delete RESOLVED_SHIFT_CACHE[key];
      });

      Object.keys(
        RESOLVED_SHIFT_PENDING
      ).forEach((key) => {
        delete RESOLVED_SHIFT_PENDING[key];
      });

      setCoreResolvedShiftsByDate({});
      setCoreShiftError("");
      setCoreScheduleRefreshVersion((version) => version + 1);
      onReload();
    };

    window.addEventListener(TEMP_WEEKLY_OFF_SYNC_EVENT, handleTemporaryWeeklyOffUpdated as EventListener);
    window.addEventListener(SCHEDULE_EXCEPTION_CHANGED_EVENT, handleTemporaryWeeklyOffUpdated as EventListener);
    return () => {
      window.removeEventListener(TEMP_WEEKLY_OFF_SYNC_EVENT, handleTemporaryWeeklyOffUpdated as EventListener);
      window.removeEventListener(SCHEDULE_EXCEPTION_CHANGED_EVENT, handleTemporaryWeeklyOffUpdated as EventListener);
    };
  }, [employeeIdsKey, onReload]);

  useEffect(() => {
    const identityIds =
      employeeIdsKey
        .split("|")
        .filter(isCoreEmployeeIdentifier);

    const dateKeys =
      monthDateKeys(monthKey);

    if (
      !isVisible ||
      !identityIds.length ||
      !dateKeys.length
    ) {
      setCoreResolvedShiftsByDate({});
      setCoreShiftLoading(false);
      setCoreShiftError("");
      return;
    }

    let cancelled = false;

    setCoreShiftLoading(true);
    setCoreShiftError("");

    CoreHrService.resolveEmployeeShiftsRange({
      employeeIds: identityIds,
      dateFrom: dateKeys[0],
      dateTo: dateKeys[dateKeys.length - 1],
    })
      .then((batch) => {
        if (cancelled) return;

        const byDate = new Map<string, CoreResolvedShift[]>();
        for (const row of batch.rows) {
          const date = cleanText(row.date);
          if (!date) continue;
          const group = byDate.get(date) || [];
          group.push(row);
          byDate.set(date, group);
        }

        const pairs = dateKeys.map((date) => {
          const resolved = byDate.get(date) || [];
          if (!resolved.length) {
            throw new Error(`core_shift_resolution_failed:${date}`);
          }
          return [date, pickBestResolvedShift(resolved)] as const;
        });

        setCoreResolvedShiftsByDate(Object.fromEntries(pairs));
      })
      .catch((loadError) => {
        if (cancelled) return;

        console.warn(
          "attendance resolved shifts load failed",
          loadError
        );

        setCoreResolvedShiftsByDate({});

        setCoreShiftError(
          t("تعذر تحميل شفتات الحضور من Core. تم إيقاف تعديلات الحضور حتى ينجح التحقق.")
        );
      })
      .finally(() => {
        if (!cancelled) {
          setCoreShiftLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    coreScheduleRefreshVersion,
    employeeIdsKey,
    isVisible,
    monthKey,
  ]);
  useEffect(() => {
    const identityIds =
      employeeIdsKey
        .split("|")
        .filter(Boolean);

    if (
      !isVisible ||
      !identityIds.length ||
      !/^\d{4}-\d{2}$/.test(monthKey)
    ) {
      setCoreAbsenceDateKeys([]);
        setManualCoreAbsenceDateKeys([]);
      setCoreAbsenceError("");
      setCoreAbsenceLoading(false);
      return;
    }

    let cancelled = false;

    setCoreAbsenceLoading(true);
    setCoreAbsenceError("");

    Promise.all(
      identityIds.map((id) =>
        CoreHrService.listAbsences({
          employeeId: id,
        })
      )
    )
      .then((groups) => {
        if (cancelled) return;

        const dates =
          new Set<string>();

        const manualDates =
          new Set<string>();

        groups
          .flat()
          .forEach((absence) => {
            const absenceType =
              cleanText(
                absence.absenceType
              ).toLowerCase();

            const automatic =
              absenceType === "automatic_check_in_lock";

            if (
              absenceType !== "full_day" &&
              absenceType !== "admin" &&
              !automatic
            ) {
              return;
            }

            const date =
              normalizeDateKey(
                absence.dateKey
              );

            if (
              !date ||
              !date.startsWith(
                monthKey + "-"
              )
            ) {
              return;
            }

            dates.add(date);

            if (!automatic) {
              manualDates.add(date);
            }
          });

        setManualCoreAbsenceDateKeys(
          Array.from(manualDates).sort()
        );

        setCoreAbsenceDateKeys(
          Array.from(dates)
            .sort((a, b) =>
              a.localeCompare(b)
            )
        );
      })
      .catch((loadError) => {
        if (cancelled) return;

        console.warn(
          "attendance Core absences load failed",
          loadError
        );

        setCoreAbsenceDateKeys([]);
        setManualCoreAbsenceDateKeys([]);

        setCoreAbsenceError(
          "\u062a\u0639\u0630\u0631 \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u063a\u064a\u0627\u0628 \u0627\u0644\u0645\u0639\u062a\u0645\u062f \u0645\u0646 Core. \u062a\u0645 \u0625\u064a\u0642\u0627\u0641 \u062a\u0639\u062f\u064a\u0644\u0627\u062a \u0627\u0644\u062d\u0636\u0648\u0631 \u062d\u062a\u0649 \u064a\u0646\u062c\u062d \u0627\u0644\u062a\u062d\u0642\u0642."
        );
      })
      .finally(() => {
        if (!cancelled) {
          setCoreAbsenceLoading(
            false
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    employeeIdsKey,
    isVisible,
    monthKey,
  ]);

  useEffect(() => {
    const identityIds =
      employeeIdsKey
        .split("|")
        .filter(Boolean);

    if (
      !isVisible ||
      !identityIds.length ||
      !/^\d{4}-\d{2}$/.test(monthKey)
    ) {
      setCorePermissionSpecialDays([]);
      setCorePermissionError("");
      setCorePermissionLoading(false);
      return;
    }

    let cancelled = false;

    setCorePermissionLoading(true);
    setCorePermissionError("");

    const visibleMonthDates =
      monthDateKeys(monthKey);

    Promise.all(
      identityIds.map((id) =>
        CoreHrService.listLeaves({
          employeeId: id,
          status: "approved",
        })
      )
    )
      .then((groups) => {
        if (cancelled) return;

        const days =
          new Map<string, AttendanceSpecialDay>();

        groups
          .flat()
          .forEach((leave) => {
            if (
              cleanText(
                leave.status
              ).toLowerCase() !== "approved"
            ) {
              return;
            }

            const durationKind =
              cleanText(
                leave.durationKind
              ).toLowerCase();

            const leaveType =
              cleanText(
                leave.leaveType
              ).toLowerCase();

            const sourceId =
              cleanText(
                leave.id
              );

            if (
              durationKind === "partial"
            ) {
              const date =
                normalizeDateKey(
                  leave.startDate
                );

              const startTime =
                cleanTime(
                  leave.partialStartTime
                );

              const endTime =
                cleanTime(
                  leave.partialEndTime
                );

              if (
                !date ||
                !date.startsWith(
                  monthKey + "-"
                ) ||
                !startTime ||
                !endTime
              ) {
                return;
              }

              days.set(
                [
                  "partial",
                  date,
                  startTime,
                  endTime,
                  sourceId,
                ].join("|"),
                {
                  date,
                  kind:
                    "partial_leave",
                  label:
                    "\u0627\u0633\u062a\u0626\u0630\u0627\u0646",
                  source:
                    "core_employee_leave",
                  sourceId,
                  type:
                    leaveType,
                  partialStartTime:
                    startTime,
                  partialEndTime:
                    endTime,
                }
              );

              return;
            }

            const startDate =
              normalizeDateKey(
                leave.startDate
              );

            const endDate =
              normalizeDateKey(
                (leave as any).endDate ||
                (leave as any).toDate ||
                startDate
              ) ||
              startDate;

            if (!startDate) return;

            const kind =
              leaveType === "rest"
                ? "rest" as const
                : "leave" as const;

            const label =
              kind === "rest"
                ? "\u0631\u0627\u062d\u0629"
                : "\u0625\u062c\u0627\u0632\u0629";

            visibleMonthDates
              .filter((date) =>
                isDateInsideRange(
                  date,
                  startDate,
                  endDate
                )
              )
              .forEach((date) => {
                days.set(
                  [
                    kind,
                    date,
                    sourceId,
                  ].join("|"),
                  {
                    date,
                    kind,
                    label,
                    source:
                      "core_employee_leave",
                    sourceId,
                    type:
                      leaveType,
                  }
                );
              });
          });

        setCorePermissionSpecialDays(
          Array.from(
            days.values()
          ).sort((a, b) =>
            a.date.localeCompare(
              b.date
            )
          )
        );
      })
      .catch((loadError) => {
        if (cancelled) return;

        console.warn(
          "attendance Core leaves load failed",
          loadError
        );

        setCorePermissionSpecialDays([]);

        setCorePermissionError(
          "\u062a\u0639\u0630\u0631 \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0625\u062c\u0627\u0632\u0627\u062a \u0648\u0627\u0644\u0627\u0633\u062a\u0626\u0630\u0627\u0646\u0627\u062a \u0627\u0644\u0645\u0639\u062a\u0645\u062f\u0629 \u0645\u0646 Core. \u062a\u0645 \u0625\u064a\u0642\u0627\u0641 \u062a\u0639\u062f\u064a\u0644\u0627\u062a \u0627\u0644\u062d\u0636\u0648\u0631 \u062d\u062a\u0649 \u064a\u0646\u062c\u062d \u0627\u0644\u062a\u062d\u0642\u0642."
        );
      })
      .finally(() => {
        if (!cancelled) {
          setCorePermissionLoading(
            false
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    employeeIdsKey,
    isVisible,
    monthKey,
  ]);

  useEffect(() => {
    setPunchClearMessage("");
    setPunchClearError("");
  }, [selectedDate]);

  const coreAbsenceDateKeySet =
    useMemo(
      () =>
        new Set(
          coreAbsenceDateKeys
        ),
      [coreAbsenceDateKeys]
    );

  const liveRows = useMemo(
    () =>
      rows.map((row) => {
        const record =
          row as StaffAttendanceWithId &
            Record<string, unknown>;

        const date = cleanText(
          record.date ||
            record.dateKey ||
            record.dayKey
        );

        const resolvedRow = toLiveAttendanceRow(
          row,
          date
            ? coreResolvedShiftsByDate[date] || null
            : null,
          coreAbsenceDateKeySet
        );

        const isExempt =
          attendancePolicyReady &&
          exemptDateKeys.includes(date);

        if (
          !isExempt ||
          coreAbsenceDateKeySet.has(date) ||
          cleanText(resolvedRow.type).toLowerCase() === "leave"
        ) {
          return resolvedRow;
        }

        const hasCheckIn =
          Boolean(cleanText(resolvedRow.checkInAtClient));

        const hasCheckOut =
          Boolean(cleanText(resolvedRow.checkOutAtClient));

        return {
          ...resolvedRow,
          lateMinutes: 0,
          earlyLeaveMinutes: 0,
          missingMinutes: 0,
          absentFullDay: false,
          type:
            cleanText(resolvedRow.type).toLowerCase() === "absent"
              ? ""
              : resolvedRow.type,
          status:
            hasCheckIn && hasCheckOut
              ? "checked_out"
              : "معفى من البصمة",
        };
      }),
    [
      coreAbsenceDateKeySet,
      coreResolvedShiftsByDate,
      attendancePolicyReady,
      exemptDateKeys,
      rows,
    ]
  );

  const resolvedCoreSpecialDays = useMemo<AttendanceSpecialDay[]>(() => {
    return Object.entries(coreResolvedShiftsByDate).flatMap(([date, shift]) => {
      if (!date) return [];
      const specialDay = resolvedShiftSpecialDay(date, shift);
      return specialDay ? [specialDay] : [];
    });
  }, [coreResolvedShiftsByDate]);

  const scheduledWorkDateKeys =
    useMemo(
      () =>
        Object.entries(
          coreResolvedShiftsByDate
        )
          .flatMap(
            ([date, shift]) => {
              if (
                !date ||
                !shift
              ) {
                return [];
              }

              const resolved =
                resolveAttendanceShiftForDate({
                  dateKey: date,
                  coreResolvedShift: shift,
                });

              if (
                resolved.source !==
                  "core_resolved_shift" ||
                resolved.isOff
              ) {
                return [];
              }

              return [date];
            }
          )
          .sort((a, b) =>
            a.localeCompare(b)
          ),
      [coreResolvedShiftsByDate]
    );

  const approvedLeaveDateKeys =
    useMemo(
      () =>
        corePermissionSpecialDays
          .filter(
            (day) =>
              day.kind === "leave" ||
              day.kind === "rest"
          )
          .map((day) => day.date),
      [corePermissionSpecialDays]
    );

  const mergedSpecialDays =
    useMemo(() => {
      const byDate =
        new Map<
          string,
          AttendanceSpecialDay
        >();

      [
        ...corePermissionSpecialDays,
        ...resolvedCoreSpecialDays,
      ].forEach((day) => {
        const date =
          cleanText(day.date);

        if (!date) return;

        const current =
          byDate.get(date);

        if (
          !current ||
          specialDayPriority(day) >=
            specialDayPriority(current)
        ) {
          byDate.set(
            date,
            day
          );
        }
      });

      return Array.from(
        byDate.values()
      ).sort((left, right) =>
        left.date.localeCompare(
          right.date
        )
      );
    }, [
      corePermissionSpecialDays,
      resolvedCoreSpecialDays,
    ]);

  const selectedSpecialDay = useMemo(
    () => mergedSpecialDays.find((day) => day.date === cleanText(selectedDate)) || null,
    [mergedSpecialDays, selectedDate]
  );
  const selectedRawRow = useMemo(() => {
    const dateKey = cleanText(selectedDate);
    return rows.find((row) => {
      const record = row as StaffAttendanceWithId & Record<string, unknown>;
      return cleanText(record.date || record.dateKey || record.dayKey) === dateKey;
    }) || null;
  }, [rows, selectedDate]);
  const effectiveShiftInfo = useMemo(
    () => resolveSelectedShiftInfo({
      dateKey: cleanText(selectedDate),
      approvedLeaveDateKeys,
      specialDay: selectedSpecialDay,
      coreResolvedShift:
        cleanText(selectedDate)
          ? coreResolvedShiftsByDate[
              cleanText(selectedDate)
            ] || null
          : null,
      coreLoading: coreShiftLoading,
      coreError:
        coreShiftError ||
        corePermissionError,
    }),
    [
      approvedLeaveDateKeys,
      corePermissionError,
      coreResolvedShiftsByDate,
      coreShiftError,
      coreShiftLoading,
      selectedDate,
      selectedSpecialDay,
    ]
  );

  const attendanceCoreBlocked =
    attendancePolicyLoading ||
    !attendancePolicyReady ||
    Boolean(attendancePolicyError) ||
    coreShiftLoading ||
    corePermissionLoading ||
    coreAbsenceLoading ||
    Boolean(coreShiftError) ||
    Boolean(corePermissionError) ||
    Boolean(coreAbsenceError);

  const restActionSelectedShift =
    coreResolvedShiftsByDate[cleanText(selectedDate)] || null;

  const restActionSelectedSource =
    cleanText(restActionSelectedShift?.source).toLowerCase();

  const restActionSelectedSpecialDay =
    resolvedShiftSpecialDay(
      cleanText(selectedDate),
      restActionSelectedShift
    );

  const restActionOperational =
    restActionSelectedShift !== null &&
    (restActionSelectedShift as Record<string, unknown>)
      .operational !== false;

  const restActionHasPendingRestoration =
    selectedRestReschedulingRows.some(operation =>
      operation.status === "cancelled" &&
      restReschedulingFinanceState(operation) !== "completed"
    );

  const restActionHasProtectedLeave =
    approvedLeaveDateKeys.includes(cleanText(selectedDate)) ||
    selectedSpecialDay?.kind === "leave" ||
    selectedSpecialDay?.kind === "rest";

  const restActionIsTemporaryWeeklyRest =
    restActionOperational &&
    restActionSelectedSource === "exception" &&
    restActionSelectedSpecialDay?.kind === "weekly_off";

  const restActionSelectedShiftRecord =
    (restActionSelectedShift || {}) as Record<string, unknown>;

  const restActionTemporaryFrom = cleanText(
    restActionSelectedShiftRecord.dateFrom ??
    restActionSelectedShiftRecord.date_from
  );

  const restActionTemporaryTo = cleanText(
    restActionSelectedShiftRecord.dateTo ??
    restActionSelectedShiftRecord.date_to
  );

  const restActionSupportedTemporaryRest =
    restActionIsTemporaryWeeklyRest &&
    restActionTemporaryFrom === cleanText(selectedDate) &&
    restActionTemporaryTo === cleanText(selectedDate);

  const restActionCanCreate =
    isVisible &&
    canManageSchedule &&
    restReschedulingReady &&
    !attendanceCoreBlocked &&
    restActionOperational &&
    (
      restActionSelectedSource === "weekly_schedule" ||
      restActionSupportedTemporaryRest
    ) &&
    restActionSelectedSpecialDay?.kind === "weekly_off" &&
    !restActionHasProtectedLeave &&
    !restActionHasPendingRestoration &&
    activeRestReschedulingRows.length === 0;

  const selectedRawRecord = (selectedRawRow || {}) as StaffAttendanceWithId & Record<string, unknown>;
  const selectedCheckInTime = cleanText(
    selectedRawRecord.checkInAtClient || selectedRawRecord.checkInAt || selectedRawRecord.checkInTime
  );
  const selectedCheckOutTime = cleanText(
    selectedRawRecord.checkOutAtClient || selectedRawRecord.checkOutAt || selectedRawRecord.checkOutTime
  );

  const clearSelectedPunchTime = async (type: "check_in" | "check_out") => {
    if (attendanceCoreBlocked) {
      setPunchClearError(
        coreShiftError ||
          corePermissionError ||
          t("جاري التحقق من بيانات Core. لا يمكن تعديل البصمة الآن.")
      );
      return;
    }
    const date = cleanText(selectedDate);
    const currentTime = type === "check_in" ? selectedCheckInTime : selectedCheckOutTime;
    if (!canDelete) {
      setPunchClearError(t("ليست لديك صلاحية لمسح وقت البصمة."));
      return;
    }
    if (!date || !selectedRawRow || !currentTime) {
      setPunchClearError(type === "check_in" ? t("لا يوجد وقت حضور لمسحه في هذا اليوم.") : t("لا يوجد وقت انصراف لمسحه في هذا اليوم."));
      return;
    }

    const label = type === "check_in" ? t("الحضور") : t("الانصراف");
    if (!window.confirm(tr(`سيتم مسح وقت ${label} فقط ليوم ${date} مع إبقاء البصمة الأخرى كما هي. هل تريد المتابعة؟`, `Only the ${label} time for ${date} will be cleared. The other attendance time and records will remain unchanged. Continue?`))) {
      return;
    }

    const rawRecords = Array.isArray(selectedRawRecord.records)
      ? (selectedRawRecord.records as Record<string, unknown>[])
      : [];
    const matchingRecords = rawRecords.filter((record) => cleanText(record.type).toLowerCase() === type);
    const recordIds = matchingRecords.map((record) => cleanText(record.id)).filter(Boolean);
    const serverTimes = matchingRecords.map((record) => cleanText(record.serverTime)).filter(Boolean);
    if (!recordIds.length && !serverTimes.length) serverTimes.push(currentTime);

    const employeeUid = cleanText(employeeId) || uniqueCleanTexts(employeeIds)[0] || "";
    const identityCandidates = uniqueCleanTexts([
      selectedRawRecord.employeeId,
      selectedRawRecord.employeeDocId,
      ...employeeIds,
      employeeUid,
    ]);
    const employeeDocId =
      cleanText(selectedRawRecord.employeeId || selectedRawRecord.employeeDocId) ||
      identityCandidates.find((value) => value !== employeeUid) ||
      employeeUid;

    setClearingPunchType(type);
    setPunchClearMessage("");
    setPunchClearError("");
    try {
      const result = await clearAttendancePunchTimeFromWorker({
        employeeUid,
        employeeId: employeeDocId,
        date,
        recordIds,
        serverTimes,
        note: tr(`مسح وقت ${label} فقط من إدارة الموظفات`, `Clear ${label} time only from Staff Management`),
      });
      const reconciliationMessage = attendanceReconciliationMessage(result,language === "en");
      if (Number(result.clearedRecords || 0) <= 0) {
        throw new Error(tr(`لم يتم العثور على سجل ${label} قابل للمسح.`, `No clearable ${label} record was found.`));
      }
      if (reconciliationMessage) setPunchClearError(reconciliationMessage);
      setPunchClearMessage(tr(`تم مسح وقت ${label} فقط، وبقيت بقية سجلات اليوم كما هي.`, `The ${label} time was cleared; the rest of the day records were preserved.`));
      try {
        await onPunchCleared?.({
          date,
          type,
          clearedRecords: Number(result.clearedRecords || 0),
          employeeUid,
          employeeDocId,
          beforeTime: currentTime,
        });
      } catch (auditError) {
        console.warn("attendance selective-clear audit failed", auditError);
      }
      onReload();
    } catch (clearError) {
      setPunchClearError(cleanText((clearError as Error)?.message) || tr(`تعذر مسح وقت ${label}.`, `Could not clear the ${label} time.`));
    } finally {
      setClearingPunchType("");
    }
  };

  if (!isVisible) return null;

  return (
    <>
      {attendancePolicyError && (
        <div role="alert" className="dsv2-badge dsv2-badge--danger">
          {tr(
            "تعذر التحقق من سياسة الحضور المعتمدة.",
            "The approved attendance policy could not be verified."
          )}
          {" — "}
          {attendancePolicyError}
        </div>
      )}

      {attendancePolicyReady && exemptDateKeys.includes(selectedDate) && (
        <div
          role="status"
          style={{
            background: "#ede9fe",
            color: "#5b21b6",
            border: "1px solid #c4b5fd",
            borderRadius: 8,
            padding: 12,
          }}
        >
          {tr(
            "سياسة اليوم: معفى من البصمة",
            "Daily policy: Attendance exempt"
          )}
        </div>
      )}

      <EmployeeAttendanceTabLiveV2
        readOnly={loading || attendanceCoreBlocked || Boolean(clearingPunchType)}
        loading={
          loading ||
          coreShiftLoading ||
          corePermissionLoading ||
          coreAbsenceLoading ||
          attendancePolicyLoading ||
          !attendancePolicyReady
        }
        error={
          error ||
          coreShiftError ||
          corePermissionError ||
          coreAbsenceError ||
          attendancePolicyError
        }
        rows={liveRows}
        monthKey={monthKey}
        selectedDate={selectedDate}
        employmentStartDate={employmentStartDate}
        employmentEndDate={employmentEndDate}
        approvedLeaveDateKeys={approvedLeaveDateKeys}
        absenceDateKeys={coreAbsenceDateKeys}
        scheduledWorkDateKeys={
          attendancePolicyReady
            ? scheduledWorkDateKeys.filter(
                date => !exemptDateKeys.includes(date)
              )
            : []
        }
        exemptDateKeys={
          attendancePolicyReady ? exemptDateKeys : []
        }
        specialDays={mergedSpecialDays}
        effectiveShiftInfo={effectiveShiftInfo}
        canEdit={canEdit}
        canDelete={canDelete}
        canCreateEmergencyLeave={canCreateEmergencyLeave}
        canCancelLeave={canCancelLeave}
        onMonthChange={onMonthChange}
        onSelectedDateChange={onSelectedDateChange}
        onReload={onReload}
        onEditPunch={onEditPunch}
        onDeletePunch={onDeletePunch}
        onCreateEmergencyLeave={onCreateEmergencyLeave}
        onCancelLeave={onCancelLeave}
      />


      {canManageSchedule && (
        <section
          className="dsv2-card dsv2-card--padded"
          aria-label={tr(
            "تحويلات الراحة الأسبوعية",
            "Weekly rest rescheduling"
          )}
        >
          <div className="dsv2-stack dsv2-stack--sm">
            <div>
              <h3 className="dsv2-section-title">
                {tr(
                  "تحويل الراحة الأسبوعية",
                  "Weekly rest rescheduling"
                )}
              </h3>

              <p className="dsv2-section-caption">
                {tr(
                  "سجل تحويلات اليوم المحدد وحالة التسوية المالية من Core.",
                  "Selected day rescheduling history and financial status from Core."
                )}
              </p>
            </div>

            <button
              type="button"
              className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm"
              onClick={() =>
                setRestReschedulingRevision(value => value + 1)
              }
            >
              {tr("تحديث حالة التسوية", "Refresh reconciliation")}
            </button>


            {restActionCanCreate && (
                <button
                  type="button"
                  className="dsv2-btn dsv2-btn--secondary"
                  disabled={restActionSaving}
                  onClick={() => openRestAction("create")}
                >
                  {tr(
                    "تحويل الراحة إلى يوم عمل",
                    "Convert weekly rest to work"
                  )}
                </button>
              )}


            {restReschedulingReady &&
              !attendanceCoreBlocked &&
              restActionIsTemporaryWeeklyRest &&
              !restActionSupportedTemporaryRest &&
              activeRestReschedulingRows.length === 0 && (
                <p className="dsv2-section-caption" role="status">
                  {tr(
                    "يتطلب نقل الراحة المؤقتة الممتدة لعدة أيام مراجعة الاستثناء الأصلي.",
                    "Rescheduling a multi-day temporary rest requires review of the original exception."
                  )}
                </p>
              )}

            {restReschedulingReady &&
              restActionHasPendingRestoration && (
                <p className="dsv2-section-caption" role="status">
                  {tr(
                    "لا يمكن بدء تحويل جديد حتى تكتمل تسوية الاستعادة السابقة.",
                    "A new rescheduling cannot start until previous restoration finance is completed."
                  )}
                </p>
              )}

            {currentRestActionMessage && (
              <p
                role={currentRestActionMessage.error ? "alert" : "status"}
                className="dsv2-section-caption"
              >
                {tr(
                  currentRestActionMessage.ar,
                  currentRestActionMessage.en
                )}
              </p>
            )}

            {currentRestActionDraft && (
              <div className="dsv2-card dsv2-card--padded">
                <div className="dsv2-stack dsv2-stack--sm">
                  <h3 className="dsv2-section-title">
                    {currentRestActionDraft.mode === "create"
                      ? tr(
                          "نقل الراحة الأسبوعية",
                          "Reschedule weekly rest"
                        )
                      : tr(
                          "تأكيد استعادة الراحة",
                          "Confirm weekly rest restoration"
                        )}
                  </h3>

                  <div>
                    {tr("اليوم المحدد", "Selected date")}
                    {": "}
                    <bdi>{selectedDate}</bdi>
                  </div>

                  {currentRestActionDraft.mode === "create" && (
                    <>
                      <label>
                        {tr("تاريخ الراحة البديلة", "Replacement rest date")}
                        <RestReschedulingDatePicker
                          value={currentRestActionDraft.replacementDate}
                          placeholder={tr("اختر تاريخ الراحة", "Select rest date")}
                          language={tr("ar", "en") === "ar" ? "ar" : "en"}
                          disabled={restActionSaving}
                          required
                          onChange={value =>
                            setRestActionDraft({
                              ...currentRestActionDraft,
                              replacementDate: value,
                            })
                          }
                        />
                      </label>

                      <label>
                        {tr("بداية العمل", "Work start")}
                        <RestReschedulingTimePicker
                          clock="24h"
                          required
                          disabled={restActionSaving}
                          value={currentRestActionDraft.startTime}
                          onChange={value =>
                            setRestActionDraft({
                              ...currentRestActionDraft,
                              startTime: value,
                            })
                          }
                        />
                      </label>

                      <label>
                        {tr("نهاية العمل", "Work end")}
                        <RestReschedulingTimePicker
                          clock="24h"
                          required
                          disabled={restActionSaving}
                          value={currentRestActionDraft.endTime}
                          onChange={value =>
                            setRestActionDraft({
                              ...currentRestActionDraft,
                              endTime: value,
                            })
                          }
                        />
                      </label>

                      <p className="dsv2-section-caption">
                        {tr(
                          "هذه العملية تنقل الراحة إلى يوم بديل ولا تضيف رصيدًا تعويضيًا مكررًا.",
                          "This operation moves weekly rest to a replacement date without duplicating compensatory credit."
                        )}
                      </p>
                    </>
                  )}

                  {currentRestActionDraft.mode === "cancel" && (
                    <p className="dsv2-section-caption">
                      {tr(
                        "ستتم استعادة الجدول دون حذف بصمات الحضور والانصراف.",
                        "The schedule will be restored without deleting attendance punches."
                      )}
                    </p>
                  )}

                  <label>
                    {tr("سبب العملية", "Operation reason")}
                    <textarea
                      className="dsv2-input"
                      maxLength={1500}
                      disabled={restActionSaving}
                      value={currentRestActionDraft.reason}
                      onChange={event =>
                        setRestActionDraft({
                          ...currentRestActionDraft,
                          reason: event.target.value,
                        })
                      }
                    />
                  </label>

                  <div className="dsv2-cluster">
                    <button
                      type="button"
                      className="dsv2-btn dsv2-btn--primary"
                      disabled={
                        restActionSaving ||
                        attendanceCoreBlocked ||
                        !restReschedulingReady ||
                        !currentRestActionDraft.reason.trim() ||
                        (
                          currentRestActionDraft.mode === "create" &&
                          (
                            !restActionCanCreate ||
                            !/^\d{4}-\d{2}-\d{2}$/.test(
                              currentRestActionDraft.replacementDate
                            ) ||
                            currentRestActionDraft.replacementDate === selectedDate ||
                            !/^([01]\d|2[0-3]):[0-5]\d$/.test(
                              currentRestActionDraft.startTime
                            ) ||
                            !/^([01]\d|2[0-3]):[0-5]\d$/.test(
                              currentRestActionDraft.endTime
                            ) ||
                            currentRestActionDraft.startTime >=
                              currentRestActionDraft.endTime
                          )
                        )
                      }
                      onClick={() => void submitRestAction()}
                    >
                      {restActionSaving
                        ? tr("جاري الحفظ...", "Saving...")
                        : tr("تأكيد العملية", "Confirm operation")}
                    </button>

                    <button
                      type="button"
                      className="dsv2-btn dsv2-btn--secondary"
                      disabled={restActionSaving}
                      onClick={() => setRestActionDraft(null)}
                    >
                      {tr("إغلاق", "Close")}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {currentRestReschedulingError ? (
              <div
                role="alert"
                className="dsv2-badge dsv2-badge--danger"
              >
                {tr(
                  "تعذر التحقق من تحويلات الراحة المعتمدة.",
                  "Unable to verify approved rest rescheduling."
                )}
              </div>
            ) : !restReschedulingReady ? (
              <p role="status">
                {tr("جاري التحقق من Core...", "Checking Core...")}
              </p>
            ) : selectedRestReschedulingRows.length === 0 ? (
              <p className="dsv2-section-caption">
                {tr(
                  "لا توجد عمليات تحويل مرتبطة باليوم المحدد.",
                  "No rescheduling operations for the selected day."
                )}
              </p>
            ) : (
              selectedRestReschedulingRows.map(operation => {
                const finance =
                  restReschedulingFinanceState(operation);

                const restReview =
                  restReschedulingReviewState(operation);

                return (
                  <div
                    className="dsv2-card dsv2-card--padded"
                    key={operation.id}
                  >
                    <div className="dsv2-stack dsv2-stack--sm">
                      <div className="dsv2-cluster">
                        <span className="dsv2-badge">
                          {operation.status === "active"
                            ? tr("تحويل فعال", "Active rescheduling")
                            : tr("تمت الاستعادة", "Restored")}
                        </span>

                        <span
                          className={
                            finance === "completed"
                              ? "dsv2-badge dsv2-badge--success"
                              : finance === "review"
                                ? "dsv2-badge dsv2-badge--danger"
                                : "dsv2-badge dsv2-badge--gold"
                          }
                        >
                          {finance === "completed"
                            ? tr(
                                "التسوية المالية مكتملة",
                                "Financial reconciliation completed"
                              )
                            : finance === "review"
                              ? tr(
                                  "التسوية تحتاج مراجعة",
                                  "Financial review required"
                                )
                              : tr(
                                  "التسوية المالية معلقة",
                                  "Financial reconciliation pending"
                                )}
                        </span>
                      </div>

                      {operation.status === "cancelled" ? (
                        <div
                          className="dsv2-stack dsv2-stack--sm"
                          data-rest-review-state={restReview}
                        >
                          <strong>
                            {tr(
                              "حالة التعويض الحالية للراحة الأصلية",
                              "Current entitlement for the original rest date"
                            )}
                          </strong>

                          <div className="dsv2-cluster">
                            <span
                              className={
                                restReview === "fulfilled"
                                  ? "dsv2-badge dsv2-badge--success"
                                  : restReview === "pending_review"
                                    ? "dsv2-badge dsv2-badge--gold"
                                    : restReview === "owed" ||
                                      restReview === "scheduled"
                                      ? "dsv2-badge dsv2-badge--gold"
                                      : "dsv2-badge"
                              }
                            >
                              {restReview === "pending_review"
                                ? tr(
                                    "التعويض يحتاج مراجعة",
                                    "Entitlement review required"
                                  )
                                : restReview === "owed"
                                  ? tr(
                                      "التعويض مستحق",
                                      "Compensation owed"
                                    )
                                  : restReview === "scheduled"
                                    ? tr(
                                        "الراحة التعويضية مجدولة",
                                        "Substitute rest scheduled"
                                      )
                                    : restReview === "fulfilled"
                                      ? tr(
                                          "التعويض مستوفى",
                                          "Entitlement fulfilled"
                                        )
                                      : restReview === "no_event"
                                        ? finance === "completed"
                                          ? tr(
                                              "لا يوجد سجل تعويض حالي",
                                              "No current entitlement record"
                                            )
                                          : tr(
                                              "بانتظار التحقق من التعويض",
                                              "Awaiting entitlement verification"
                                            )
                                        : tr(
                                            "حالة التعويض غير متاحة",
                                            "Entitlement state unavailable"
                                          )}
                            </span>
                          </div>

                          {operation.restReviewEventId &&
                          typeof operation.restReviewWorkedMinutes === "number" ? (
                            <small>
                              {tr(
                                "دقائق العمل المسجلة في سجل الراحة",
                                "Worked minutes recorded in the rest event"
                              )}
                              {": "}
                              <bdi>{operation.restReviewWorkedMinutes}</bdi>
                            </small>
                          ) : null}

                          {operation.restReviewEventId &&
                          typeof operation.restReviewSubstituteMinutes === "number" ? (
                            <small>
                              {tr(
                                "دقائق الراحة التعويضية المسجلة",
                                "Recorded substitute rest minutes"
                              )}
                              {": "}
                              <bdi>{operation.restReviewSubstituteMinutes}</bdi>
                            </small>
                          ) : null}
                        </div>
                      ) : null}

                      <div>
                        {tr("الراحة الأصلية", "Original rest")}
                        {": "}
                        <bdi>{operation.originalRestDate}</bdi>
                      </div>

                      <div>
                        {tr("الراحة البديلة", "Replacement rest")}
                        {": "}
                        <bdi>{operation.replacementRestDate}</bdi>
                      </div>

                      <div>
                        {tr("ساعات العمل", "Working hours")}
                        {": "}
                        <bdi>
                          {operation.workStartTime}
                          {" - "}
                          {operation.workEndTime}
                        </bdi>
                      </div>

                      <div>
                        {tr("السبب", "Reason")}
                        {": "}
                        {operation.reason}
                      </div>


                      {operation.status === "active" && (
                        <button
                          type="button"
                          className="dsv2-btn dsv2-btn--secondary"
                          disabled={
                            restActionSaving ||
                            attendanceCoreBlocked ||
                            finance !== "completed"
                          }
                          onClick={() =>
                            openRestAction("cancel", operation.id)
                          }
                        >
                          {tr(
                            "استعادة يوم الراحة الأسبوعية",
                            "Restore weekly rest"
                          )}
                        </button>
                      )}

                      {operation.status === "cancelled" && (
                        <div>
                          {tr(
                            "سبب الاستعادة",
                            "Restoration reason"
                          )}
                          {": "}
                          {operation.cancellationReason || "—"}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      )}

      {selectedRawRow && (selectedCheckInTime || selectedCheckOutTime) ? (
        <section className="dsv2-card dsv2-card--padded" aria-label={t("إدارة أوقات بصمة اليوم المحدد")}>
          <div className="dsv2-stack dsv2-stack--sm">
            <div>
              <h3 className="dsv2-section-title">{tr("إدارة أوقات البصمة", "Manage attendance times")}</h3>
              <p className="dsv2-section-caption">
                {tr("يمكنك مسح وقت الحضور أو الانصراف بشكل مستقل في أي حالة، بدون حذف الوقت الآخر أو بقية سجلات اليوم.", "You can clear check-in or check-out independently without deleting the other time or the rest of the day's records.")}
              </p>
            </div>

            <div className="dsv2-cluster">
              {selectedCheckInTime && canDelete ? (
                <button
                  type="button"
                  className="dsv2-btn dsv2-btn--danger dsv2-btn--sm"
                  disabled={attendanceCoreBlocked || Boolean(clearingPunchType)}
                  onClick={() => void clearSelectedPunchTime("check_in")}
                >
                  {clearingPunchType === "check_in" ? t("جاري مسح الحضور...") : t("مسح وقت الحضور")}
                </button>
              ) : null}
              {selectedCheckOutTime && canDelete ? (
                <button
                  type="button"
                  className="dsv2-btn dsv2-btn--danger dsv2-btn--sm"
                  disabled={attendanceCoreBlocked || Boolean(clearingPunchType)}
                  onClick={() => void clearSelectedPunchTime("check_out")}
                >
                  {clearingPunchType === "check_out" ? t("جاري مسح الانصراف...") : t("مسح وقت الانصراف")}
                </button>
              ) : null}
            </div>

            {punchClearMessage ? (
              <div className="dsv2-badge dsv2-badge--success" role="status">{punchClearMessage}</div>
            ) : null}
            {punchClearError ? (
              <div className="dsv2-badge dsv2-badge--danger" role="alert">{punchClearError}</div>
            ) : null}
          </div>
        </section>
      ) : null}
    </>
  );
}
