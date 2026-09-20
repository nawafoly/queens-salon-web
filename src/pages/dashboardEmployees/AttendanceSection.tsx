import { useEffect, useMemo, useState } from "react";

import type { StaffAttendanceWithId } from "../../services/firestoreAttendance";
import { CoreHrService } from "../../services/CoreHrService";
import { clearAttendancePunchTimeFromWorker } from "../../services/attendancePunchAdminService";
import type { CoreResolvedShift } from "../../types/hrCoreApi";
import {
  computeAttendanceEarlyLeaveMinutes,
  computeResolvedAttendanceDay,
  recordsFromAttendanceRow,
  resolveAttendanceShiftForDate,
} from "../../helpers/hr/attendanceShiftResolver";
import type { AttendanceSpecialDay } from "../../helpers/hr/attendanceCalendarData";
import {
  EmployeeAttendanceTabLiveV2,
  type EmployeeAttendanceRowLiveV2,
  type EmployeeAttendanceShiftInfoLiveV2,
} from "../../components/dashboard-v2/employee-workspace/live";
import { SCHEDULE_EXCEPTION_CHANGED_EVENT } from "./shiftExceptionRestore";

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

function isCoreEmployeeIdentifier(value: unknown) {
  const id = cleanText(value);
  return Boolean(
    id &&
      !id.startsWith("app_user_") &&
      /^[A-Za-z0-9_-]+$/.test(id)
  );
}

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
  onMonthChange,
  onSelectedDateChange,
  onReload,
  onEditPunch,
  onDeletePunch,
  onPunchCleared,
  onCreateEmergencyLeave,
  onCancelLeave,
}: AttendanceSectionProps) {
  const [coreResolvedShiftsByDate, setCoreResolvedShiftsByDate] = useState<Record<string, CoreResolvedShift | null>>({});
  const [corePermissionSpecialDays, setCorePermissionSpecialDays] = useState<AttendanceSpecialDay[]>([]);
  const [corePermissionLoading, setCorePermissionLoading] = useState(false);
  const [corePermissionError, setCorePermissionError] = useState("");
  const [coreAbsenceDateKeys, setCoreAbsenceDateKeys] = useState<string[]>([]);
  const [coreAbsenceLoading, setCoreAbsenceLoading] = useState(false);
  const [coreAbsenceError, setCoreAbsenceError] = useState("");
  const [coreShiftLoading, setCoreShiftLoading] = useState(false);
  const [coreShiftError, setCoreShiftError] = useState("");
  const [clearingPunchType, setClearingPunchType] = useState<"check_in" | "check_out" | "">("");
  const [punchClearMessage, setPunchClearMessage] = useState("");
  const [punchClearError, setPunchClearError] = useState("");
  const [coreScheduleRefreshVersion, setCoreScheduleRefreshVersion] = useState(0);
  const employeeIdsKey = uniqueCleanTexts([employeeId, ...employeeIds]).join("|");

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
          "تعذر تحميل شفتات الحضور من Core. تم إيقاف تعديلات الحضور حتى ينجح التحقق."
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

        groups
          .flat()
          .forEach((absence) => {
            const absenceType =
              cleanText(
                absence.absenceType
              ).toLowerCase();

            if (
              absenceType !==
              "full_day"
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
          });

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

        return toLiveAttendanceRow(
          row,
          date
            ? coreResolvedShiftsByDate[date] || null
            : null,
          coreAbsenceDateKeySet
        );
      }),
    [
      coreAbsenceDateKeySet,
      coreResolvedShiftsByDate,
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
    coreShiftLoading ||
    corePermissionLoading ||
    coreAbsenceLoading ||
    Boolean(coreShiftError) ||
    Boolean(corePermissionError) ||
    Boolean(coreAbsenceError);
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
          "جاري التحقق من بيانات Core. لا يمكن تعديل البصمة الآن."
      );
      return;
    }
    const date = cleanText(selectedDate);
    const currentTime = type === "check_in" ? selectedCheckInTime : selectedCheckOutTime;
    if (!canDelete) {
      setPunchClearError("ليست لديك صلاحية لمسح وقت البصمة.");
      return;
    }
    if (!date || !selectedRawRow || !currentTime) {
      setPunchClearError(type === "check_in" ? "لا يوجد وقت حضور لمسحه في هذا اليوم." : "لا يوجد وقت انصراف لمسحه في هذا اليوم.");
      return;
    }

    const label = type === "check_in" ? "الحضور" : "الانصراف";
    if (!window.confirm(`سيتم مسح وقت ${label} فقط ليوم ${date} مع إبقاء البصمة الأخرى كما هي. هل تريد المتابعة؟`)) {
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
        note: `مسح وقت ${label} فقط من إدارة الموظفات`,
      });
      if (Number(result.clearedRecords || 0) <= 0) {
        throw new Error(`لم يتم العثور على سجل ${label} قابل للمسح.`);
      }
      setPunchClearMessage(`تم مسح وقت ${label} فقط، وبقيت بقية سجلات اليوم كما هي.`);
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
      setPunchClearError(cleanText((clearError as Error)?.message) || `تعذر مسح وقت ${label}.`);
    } finally {
      setClearingPunchType("");
    }
  };

  if (!isVisible) return null;

  return (
    <>
      <EmployeeAttendanceTabLiveV2
        readOnly={loading || attendanceCoreBlocked || Boolean(clearingPunchType)}
        loading={
          loading ||
          coreShiftLoading ||
          corePermissionLoading ||
          coreAbsenceLoading
        }
        error={
          error ||
          coreShiftError ||
          corePermissionError ||
          coreAbsenceError
        }
        rows={liveRows}
        monthKey={monthKey}
        selectedDate={selectedDate}
        employmentStartDate={employmentStartDate}
        employmentEndDate={employmentEndDate}
        approvedLeaveDateKeys={approvedLeaveDateKeys}
        absenceDateKeys={coreAbsenceDateKeys}
        scheduledWorkDateKeys={scheduledWorkDateKeys}
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

      {selectedRawRow && (selectedCheckInTime || selectedCheckOutTime) ? (
        <section className="dsv2-card dsv2-card--padded" aria-label="إدارة أوقات بصمة اليوم المحدد">
          <div className="dsv2-stack dsv2-stack--sm">
            <div>
              <h3 className="dsv2-section-title">إدارة أوقات البصمة</h3>
              <p className="dsv2-section-caption">
                يمكنك مسح وقت الحضور أو الانصراف بشكل مستقل في أي حالة، بدون حذف الوقت الآخر أو بقية سجلات اليوم.
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
                  {clearingPunchType === "check_in" ? "جاري مسح الحضور..." : "مسح وقت الحضور"}
                </button>
              ) : null}
              {selectedCheckOutTime && canDelete ? (
                <button
                  type="button"
                  className="dsv2-btn dsv2-btn--danger dsv2-btn--sm"
                  disabled={attendanceCoreBlocked || Boolean(clearingPunchType)}
                  onClick={() => void clearSelectedPunchTime("check_out")}
                >
                  {clearingPunchType === "check_out" ? "جاري مسح الانصراف..." : "مسح وقت الانصراف"}
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
