import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import EmployeeAvatar from "../../components/EmployeeAvatar";
import {
  faBell,
  faChartLine,
  faBriefcase,
  faCalendarCheck,
  faCalendarDays,
  faChevronLeft,
  faClock,
  faFileLines,
  faFingerprint,
  faIdBadge,
  faMoneyBillWave,
  faPaperPlane,
  faUser,
} from "@fortawesome/free-solid-svg-icons";

import {
  markEmployeeNotificationRead,
  type EmployeeLeaveRequest,
  type EmployeeNotification,
} from "../../services/employeeHub";
import {
  getTodayAttendanceDateKey,
  type StaffAttendanceWithId,
  type StaffAttendanceToday,
} from "../../services/firestoreAttendance";
import { AppSettingsService } from "../../services/AppSettingsService";
import { CoreHrService } from "../../services/CoreHrService";
import {
  listEmployeeBookings,
  type BookingDocWithId,
} from "../../services/firestoreBookings";
import {
  getBrowserPosition,
  resolveAssignedAttendanceZoneId,
  type AttendanceLocation,
  type WorkZoneMatch,
} from "../../services/attendanceSettingsService";
import {
  getAttendanceForDateFromWorker,
  getAttendanceWorkerMessage,
  listAttendanceByDateRangeFromWorker,
  submitAttendanceToWorker,
} from "../../services/attendanceWorkerService";
import { requestAttendanceBiometric } from "../../helpers/attendanceBiometric";
import {
  computeAttendanceDay,
  getAttendanceDayStatus,
  type AttendanceRecord,
  type ShiftSchedule,
} from "../../helpers/hr/attendanceCalculations";
import { getWeekdayKeyForDateKey } from "../../helpers/hr/workSchedule";
import { payrollMonthBounds } from "../../helpers/hr/payrollCalculations";
import { buildApprovedLeaveDateKeys } from "../../helpers/hr/attendanceCalendarData";
import { attendanceMonthDateKeys } from "../../helpers/hr/attendanceShiftResolver";
import { cleanText, formatShortDate, type HrSession } from "./shared";
import { formatNotificationTime, notificationTone, notificationTypeLabel, toMillis } from "./portalUtils";
import AttendanceMonthView from "../../components/AttendanceMonthView";
import {
  listPermissionRequestsByEmployee,
  type EmployeePermissionRequest,
} from "../../services/employeePermissionRequests";
import type { CoreResolvedShift } from "../../types/hrCoreApi";
import { CoreApiError } from "../../services/coreApiClient";
import {
  CoreEmployeeTargetService,
  type EmployeeTargetMine,
} from "../../services/CoreEmployeeTargetService";
import { usePermissions } from "../../security/PermissionContext";

type Props = {
  session: HrSession;
  notifications: EmployeeNotification[];
  onRefresh?: () => void | Promise<void>;
  attendanceOnly?: boolean;
};

function roleLabel(role: string) {
  const normalized = cleanText(role).toLowerCase();
  if (normalized === "owner") return "مالك";
  if (normalized === "admin") return "مدير";
  if (normalized === "hr") return "موارد بشرية";
  if (normalized === "reception") return "استقبال";
  if (normalized === "staff") return "موظف";
  return "موظف";
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 5) return "مساء الخير";
  if (hour < 12) return "صباح الخير";
  if (hour < 17) return "نهارك سعيد";
  return "مساء الخير";
}

function displayInitial(value: unknown) {
  return cleanText(value || "م").slice(0, 1).toUpperCase();
}

function formatAttendanceDateLabel(dateKey: string) {
  const parsed = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateKey;
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(parsed);
}

function getProfileSource(session: HrSession) {
  return session.staffDoc || session.employeeDoc || session.userDoc || {};
}

function resolveOverviewAvatarUrl(session: HrSession) {
  const records = [
    session.staffDoc,
    session.employeeDoc,
    session.userDoc,
  ].filter(Boolean) as Array<Record<string, any>>;

  for (const record of records) {
    const employeeProfile =
      record.employeeProfile && typeof record.employeeProfile === "object"
        ? record.employeeProfile
        : {};
    const personal =
      employeeProfile.personal && typeof employeeProfile.personal === "object"
        ? employeeProfile.personal
        : record.personal && typeof record.personal === "object"
          ? record.personal
          : {};

    const candidates = [
      record.avatarUrl,
      record.avatarURL,
      record.photoURL,
      record.photoUrl,
      record.imageUrl,
      record.imageURL,
      record.profileImageUrl,
      record.profileImage,
      record.picture,
      record.avatar,
      employeeProfile.avatarUrl,
      employeeProfile.avatarURL,
      employeeProfile.photoURL,
      employeeProfile.photoUrl,
      employeeProfile.imageUrl,
      employeeProfile.profileImageUrl,
      personal.avatarUrl,
      personal.photoURL,
      personal.photoUrl,
      personal.imageUrl,
      personal.profileImageUrl,
    ];

    const resolved = candidates.map(cleanText).find(Boolean);
    if (resolved) return resolved;
  }

  return cleanText(session.user?.photoURL);
}

function cleanTime(value: unknown) {
  const raw = cleanText(value);
  return /^\d{1,2}:\d{2}$/.test(raw) ? raw : "";
}

function readPolicyMinutes(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return Math.round(number);
  }
  return undefined;
}

function readPolicyFlag(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    return value === true || value === 1 || value === "1" || value === "true";
  }
  return false;
}

function isCheckInWindowClosed(dateKey: string, schedule: ShiftSchedule) {
  if (!readPolicyFlag(schedule.attendanceLockEnabled)) return false;
  if (dateKey !== getTodayAttendanceDateKey()) return false;
  const match = /^(\d{1,2}):(\d{2})$/.exec(cleanText(schedule.startTime));
  if (!match) return false;
  const startMinutes = Number(match[1]) * 60 + Number(match[2]);
  const lockAfterMinutes = Number(schedule.attendanceLockAfterMinutes || 0);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute > startMinutes + Math.max(0, lockAfterMinutes);
}

function resolvedShiftWindow(row?: CoreResolvedShift | null) {
  if (!row || cleanText((row as any).source) === "none") return null;
  const exceptionType = cleanText((row as any)?.exceptionType || (row as any)?.exception_type);
  if (exceptionType === "off") return null;
  const snapshotRaw = cleanText((row as any)?.snapshotJson || (row as any)?.snapshot_json);
  let snapshot: Record<string, unknown> = {};
  if (snapshotRaw) {
    try {
      const parsed = JSON.parse(snapshotRaw);
      snapshot = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
    } catch {
      snapshot = {};
    }
  }
  const startTime =
    cleanTime((row as any)?.templateStartTime) ||
    cleanTime((row as any)?.template_start_time) ||
    cleanTime((row as any)?.startTime) ||
    cleanTime((row as any)?.start_time) ||
    cleanTime(snapshot.startTime) ||
    cleanTime(snapshot.start_time);
  const endTime =
    cleanTime((row as any)?.templateEndTime) ||
    cleanTime((row as any)?.template_end_time) ||
    cleanTime((row as any)?.endTime) ||
    cleanTime((row as any)?.end_time) ||
    cleanTime(snapshot.endTime) ||
    cleanTime(snapshot.end_time);
  if (!startTime && !endTime) return null;
  return {
    startTime: startTime || "09:00",
    endTime: endTime || "17:00",
    lateGraceMinutes: readPolicyMinutes(
      (row as any)?.lateGraceMinutes,
      (row as any)?.late_grace_minutes,
      snapshot.lateGraceMinutes,
      snapshot.late_grace_minutes
    ),
    earlyLeaveGraceMinutes: 0,
    attendanceLockEnabled: readPolicyFlag(
      (row as any)?.attendanceLockEnabled,
      (row as any)?.attendance_lock_enabled,
      snapshot.attendanceLockEnabled,
      snapshot.attendance_lock_enabled
    ),
    attendanceLockAfterMinutes: readPolicyMinutes(
      (row as any)?.attendanceLockAfterMinutes,
      (row as any)?.attendance_lock_after_minutes,
      snapshot.attendanceLockAfterMinutes,
      snapshot.attendance_lock_after_minutes
    ),
  };
}

function scheduleForResolvedEmployeeDate(
  dateKey: string,
  resolvedShift?: CoreResolvedShift | null
): ShiftSchedule {
  const coreWindow = resolvedShiftWindow(resolvedShift);
  if (coreWindow) {
    return {
      startTime: coreWindow.startTime,
      endTime: coreWindow.endTime,
      lateGraceMinutes: coreWindow.lateGraceMinutes,
      earlyLeaveGraceMinutes: 0,
      attendanceLockEnabled: coreWindow.attendanceLockEnabled,
      attendanceLockAfterMinutes: coreWindow.attendanceLockAfterMinutes,
      weeklyOffDays: [],
    };
  }

  const source = cleanText((resolvedShift as any)?.source);
  const exceptionType = cleanText(
    (resolvedShift as any)?.exceptionType || (resolvedShift as any)?.exception_type
  );
  const noScheduledWork = Boolean(resolvedShift) && (source === "none" || exceptionType === "off");
  const weekday = noScheduledWork ? getWeekdayKeyForDateKey(dateKey) : null;

  return {
    startTime: null,
    endTime: null,
    lateGraceMinutes: 0,
    earlyLeaveGraceMinutes: 0,
    attendanceLockEnabled: false,
    attendanceLockAfterMinutes: 0,
    weeklyOffDays: weekday ? [weekday] : [],
  };
}

function isApprovedFullDayLeaveForDate(
  row: EmployeeLeaveRequest & { durationKind?: string },
  dateKey: string
) {
  if (cleanText(row.status).toLowerCase() !== "approved") return false;
  const durationKind = cleanText(row.durationKind).toLowerCase();
  if (durationKind === "partial" || durationKind === "half_day" || durationKind === "halfday") return false;
  const fromDate = cleanText(row.fromDate);
  const toDate = cleanText(row.toDate || row.fromDate);
  return Boolean(fromDate && fromDate <= dateKey && toDate && toDate >= dateKey);
}

function formatAttendanceTime(value: unknown) {
  const raw = cleanText(value);
  if (!raw) return "--:--";
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return raw;
  return new Intl.DateTimeFormat("ar-SA", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(parsed));
}

function formatTargetMoney(halalas: number | undefined | null) {
  return new Intl.NumberFormat("ar-SA", {
    style: "currency",
    currency: "SAR",
    maximumFractionDigits: 0,
  }).format(Number(halalas || 0) / 100);
}

function formatTargetPercent(value: number | undefined | null) {
  return `${(Number(value || 0) * 100).toLocaleString("ar-SA", {
    maximumFractionDigits: 1,
  })}%`;
}

function formatTargetUpdatedAt(value: string | undefined | null) {
  if (!value) return "لم يحدث بعد";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(parsed));
}

function employeeTargetErrorMessage(error: unknown) {
  if (error instanceof CoreApiError) {
    if (error.status === 401) return "انتهت جلسة الدخول.";
    if (error.code.includes("employee_link_required")) return "الحساب غير مربوط بملف موظفة.";
    if (error.status === 403) return "لا توجد صلاحية لعرض التارقت.";
  }
  return "تعذر تحميل التارقت.";
}

function getAttendanceStatusLabel(status: StaffAttendanceToday["status"]) {
  if (status === "checked_out") return "انصرف";
  if (status === "checked_in") return "حاضر";
  return "لم يسجل حضور";
}

function getBookingStatusLabel(status: string | undefined) {
  const normalized = cleanText(status || "pending").toLowerCase();
  if (normalized === "confirmed") return "مؤكد";
  if (normalized === "completed") return "مكتمل";
  if (normalized === "cancelled") return "ملغي";
  return "بانتظار التأكيد";
}

export default function EmployeeOverviewPage({ session, notifications, onRefresh, attendanceOnly = false }: Props) {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const profile = getProfileSource(session);
  const displayName = cleanText(profile.displayName || profile.name || session.displayName || session.email || "Employee");
  const department = cleanText(profile.department || "");
  const title = cleanText(profile.title || "");
  const avatarUrl = resolveOverviewAvatarUrl(session);
  const [attendance, setAttendance] = useState<StaffAttendanceToday | null>(null);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceBusy, setAttendanceBusy] = useState(false);
  const [attendanceMessage, setAttendanceMessage] = useState("");
  const [attendanceSettings, setAttendanceSettings] = useState(() => AppSettingsService.getCached().attendance);
  const [lastLocation, setLastLocation] = useState<AttendanceLocation | null>(null);
  const [lastWorkZone, setLastWorkZone] = useState<WorkZoneMatch | null>(null);
  const [attendanceMonthRows, setAttendanceMonthRows] = useState<StaffAttendanceWithId[]>([]);
  const [attendanceMonthLoading, setAttendanceMonthLoading] = useState(false);
  const [attendanceMonth, setAttendanceMonth] = useState(() => getTodayAttendanceDateKey().slice(0, 7));
  const [attendanceSelectedDate, setAttendanceSelectedDate] = useState(() => getTodayAttendanceDateKey());
  const [attendancePermissionEntries, setAttendancePermissionEntries] = useState<EmployeePermissionRequest[]>([]);
  const [attendanceAbsenceDateKeys, setAttendanceAbsenceDateKeys] = useState<string[]>([]);
  const [attendanceAbsenceLoading, setAttendanceAbsenceLoading] = useState(false);
  const [attendanceAbsenceError, setAttendanceAbsenceError] = useState("");
  const [attendanceAbsenceReloadKey, setAttendanceAbsenceReloadKey] = useState(0);
  const [todayResolvedShift, setTodayResolvedShift] = useState<CoreResolvedShift | null>(null);
  const [todayResolvedShiftLoading, setTodayResolvedShiftLoading] = useState(false);
  const [todayResolvedShiftError, setTodayResolvedShiftError] = useState("");
  const [attendanceMonthResolvedShifts, setAttendanceMonthResolvedShifts] = useState<Record<string, CoreResolvedShift | null>>({});
  const [attendanceMonthResolvedShiftsLoading, setAttendanceMonthResolvedShiftsLoading] = useState(false);
  const [attendanceMonthResolvedShiftsError, setAttendanceMonthResolvedShiftsError] = useState("");
  const [attendanceMonthResolvedShiftsReloadKey, setAttendanceMonthResolvedShiftsReloadKey] = useState(0);
  const [employeeBookings, setEmployeeBookings] = useState<BookingDocWithId[]>([]);
  const [employeeBookingsLoading, setEmployeeBookingsLoading] = useState(false);
  const [employeeLeaveRequests, setEmployeeLeaveRequests] = useState<EmployeeLeaveRequest[]>([]);
  const [employeeLeaveLoading, setEmployeeLeaveLoading] = useState(false);
  const [employeeLeaveError, setEmployeeLeaveError] = useState("");
  const [employeeLeaveBalance, setEmployeeLeaveBalance] = useState<number | null>(null);
  const [employeeLeaveBalanceLoading, setEmployeeLeaveBalanceLoading] = useState(false);
  const [employeeLeaveBalanceError, setEmployeeLeaveBalanceError] = useState("");
  const [employeeTarget, setEmployeeTarget] = useState<EmployeeTargetMine | null>(null);
  const [employeeTargetLoading, setEmployeeTargetLoading] = useState(false);
  const [employeeTargetError, setEmployeeTargetError] = useState("");
  const attendanceEmployeeId = cleanText(session.employeeId || session.uid);
  const assignedAttendanceZoneId = resolveAssignedAttendanceZoneId(profile);
  const attendanceDate = getTodayAttendanceDateKey();
  const canViewAttendance = hasPermission("attendance.own.view");
  const canViewOwnTarget = hasPermission("targets.view_own");
  const canViewMessages = hasPermission("messages.view");
  const currentTargetPeriod = useMemo(() => {
    const today = new Date();
    return payrollMonthBounds(today.getFullYear(), today.getMonth() + 1);
  }, []);

  const unread = notifications.filter((note) => !note.isRead);
  const summary = {
    all: unread.length,
    message: unread.filter((note) => note.type === "message" || note.route === "/employee/messages").length,
    file: unread.filter((note) => note.type === "file" || note.route === "/employee/files").length,
    leave: unread.filter((note) => note.type === "leave" || note.route === "/employee/leave").length,
    payroll: unread.filter((note) => note.type === "payroll" || note.route === "/employee/payroll").length,
  };

  const latestNotes = [...notifications]
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
    .slice(0, 6);

  const upcomingBookings = useMemo(() => {
    const today = getTodayAttendanceDateKey();
    return [...employeeBookings]
      .filter((booking) => cleanText(booking.date) >= today && booking.status !== "cancelled")
      .sort((a, b) => {
        const ad = cleanText(a.date);
        const bd = cleanText(b.date);
        if (ad !== bd) return ad.localeCompare(bd);
        return cleanText(a.time || a.startTime).localeCompare(cleanText(b.time || b.startTime));
      })
      .slice(0, 5);
  }, [employeeBookings]);

  const attendanceAbsenceDateKeySet =
    useMemo(
      () =>
        new Set(
          attendanceAbsenceDateKeys
        ),
      [attendanceAbsenceDateKeys]
    );

  const approvedLeaveDateKeys = useMemo(
    () =>
      buildApprovedLeaveDateKeys({
        profile: {},
        leaveRequests: employeeLeaveRequests,
        extraIds: [session.uid, session.employeeId],
        todayDateKey: attendanceDate,
      }),
    [attendanceDate, employeeLeaveRequests, session.employeeId, session.uid]
  );

  const currentApprovedLeave = useMemo(
    () =>
      employeeLeaveRequests.find((row) =>
        isApprovedFullDayLeaveForDate(
          row as EmployeeLeaveRequest & { durationKind?: string },
          attendanceDate
        )
      ) || null,
    [attendanceDate, employeeLeaveRequests]
  );
  const onLeave = Boolean(currentApprovedLeave);
  const leaveUntil = cleanText(currentApprovedLeave?.toDate || currentApprovedLeave?.fromDate);

  const todayAttendanceSchedule = useMemo(
    () => scheduleForResolvedEmployeeDate(attendanceDate, todayResolvedShift),
    [attendanceDate, todayResolvedShift]
  );
  const hasResolvedWorkShift = Boolean(resolvedShiftWindow(todayResolvedShift));

  const attendanceComputation = useMemo(() => {
    const records: AttendanceRecord[] = [];
    if (attendance?.checkInAtClient) {
      records.push({ id: `${attendance.id}-in`, type: "check_in", serverTime: attendance.checkInAtClient });
    }
    if (attendance?.checkOutAtClient) {
      records.push({ id: `${attendance.id}-out`, type: "check_out", serverTime: attendance.checkOutAtClient });
    }
    return computeAttendanceDay(attendanceDate, records, todayAttendanceSchedule);
  }, [attendance, attendanceDate, todayAttendanceSchedule]);

  const attendanceDayStatus = getAttendanceDayStatus({
    date: attendanceDate,
    hasAttendance: Boolean(attendance?.checkInAtClient || attendance?.checkOutAtClient),
    checkOut: attendanceComputation.checkOut,
    computation: attendanceComputation,
    todayDateKey: attendanceDate,
    weeklyOffDays: todayAttendanceSchedule.weeklyOffDays,
    approvedLeaveDateKeys,
    absenceDateKeys:
      attendanceAbsenceDateKeySet,
  });

  const loadAttendance = async () => {
    if (!canViewAttendance || !attendanceEmployeeId || !session.uid) {
      setAttendance(null);
      return;
    }

    setAttendanceLoading(true);
    setAttendanceMessage("");

    try {
      const row = await getAttendanceForDateFromWorker({
        employeeUid: session.uid,
        employeeId: attendanceEmployeeId,
        date: attendanceDate,
      });

      setAttendance(row);
    } catch (error) {
      setAttendanceMessage(
        cleanText(
          (error as any)?.message ||
            "تعذر تحميل حالة الحضور من Cloudflare."
        )
      );
    } finally {
      setAttendanceLoading(false);
    }
  };

  const loadAttendanceMonth = useCallback(async () => {
    if (!canViewAttendance || !attendanceEmployeeId || !session.uid) {
      setAttendanceMonthRows([]);
      return;
    }

    const monthKey = /^\d{4}-\d{2}$/.test(attendanceMonth)
      ? attendanceMonth
      : getTodayAttendanceDateKey().slice(0, 7);

    const fromDate = `${monthKey}-01`;
    const toDate = new Date(
      Date.UTC(
        Number(monthKey.slice(0, 4)),
        Number(monthKey.slice(5, 7)),
        0
      )
    )
      .toISOString()
      .slice(0, 10);

    setAttendanceMonthLoading(true);

    try {
      const rows = await listAttendanceByDateRangeFromWorker({
        employeeUid: session.uid,
        employeeId: attendanceEmployeeId,
        fromDate,
        toDate,
      });

      setAttendanceMonthRows(rows);
    } catch (error) {
      setAttendanceMonthRows([]);
      setAttendanceMessage(
        cleanText(
          (error as any)?.message ||
            "تعذر تحميل سجل الحضور الشهري من Cloudflare."
        )
      );
    } finally {
      setAttendanceMonthLoading(false);
    }
  }, [attendanceEmployeeId, attendanceMonth, canViewAttendance, session.uid]);

  useEffect(() => {
    void loadAttendance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewAttendance, attendanceEmployeeId, attendanceDate]);

  useEffect(() => {
    if (
      !canViewAttendance ||
      !attendanceEmployeeId
    ) {
      setAttendanceAbsenceDateKeys([]);
      setAttendanceAbsenceLoading(false);
      setAttendanceAbsenceError("");
      return;
    }

    let alive = true;

    async function loadCanonicalAbsences() {
      setAttendanceAbsenceLoading(true);
      setAttendanceAbsenceError("");

      try {
        const rows =
          await CoreHrService.listAbsences({
            employeeId:
              attendanceEmployeeId,
          });

        if (!alive) return;

        const dates =
          Array.from(
            new Set(
              rows
                .filter(
                  (row) =>
                    cleanText(
                      row.absenceType
                    ).toLowerCase() ===
                    "full_day"
                )
                .map((row) =>
                  cleanText(
                    row.dateKey
                  )
                )
                .filter((date) =>
                  /^\d{4}-\d{2}-\d{2}$/.test(
                    date
                  )
                )
            )
          ).sort((a, b) =>
            a.localeCompare(b)
          );

        setAttendanceAbsenceDateKeys(
          dates
        );
      } catch (error) {
        if (!alive) return;

        console.warn(
          "employee attendance Core absences load failed",
          error
        );

        setAttendanceAbsenceDateKeys([]);

        setAttendanceAbsenceError(
          "\u062a\u0639\u0630\u0631 \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u063a\u064a\u0627\u0628 \u0627\u0644\u0645\u0639\u062a\u0645\u062f \u0645\u0646 Core."
        );
      } finally {
        if (alive) {
          setAttendanceAbsenceLoading(
            false
          );
        }
      }
    }

    void loadCanonicalAbsences();

    return () => {
      alive = false;
    };
  }, [
    attendanceAbsenceReloadKey,
    attendanceEmployeeId,
    canViewAttendance,
  ]);

  useEffect(() => {
    if (!canViewAttendance || !attendanceEmployeeId) {
      setTodayResolvedShift(null);
      setTodayResolvedShiftLoading(false);
      setTodayResolvedShiftError("");
      return;
    }

    let alive = true;

    async function loadTodayResolvedShift() {
      setTodayResolvedShiftLoading(true);
      setTodayResolvedShiftError("");
      try {
        const row = await CoreHrService.resolveEmployeeShift(attendanceEmployeeId, attendanceDate);
        if (alive) setTodayResolvedShift(row);
      } catch (error) {
        if (alive) {
          setTodayResolvedShift(null);
          setTodayResolvedShiftError(
            cleanText((error as any)?.message || "تعذر تحميل جدول الدوام المعتمد من النظام المركزي.")
          );
        }
      } finally {
        if (alive) setTodayResolvedShiftLoading(false);
      }
    }

    void loadTodayResolvedShift();

    return () => {
      alive = false;
    };
  }, [attendanceEmployeeId, attendanceDate, canViewAttendance]);

  useEffect(() => {
    if (!attendanceOnly || !canViewAttendance || !attendanceEmployeeId) {
      setAttendanceMonthResolvedShifts({});
      setAttendanceMonthResolvedShiftsLoading(false);
      setAttendanceMonthResolvedShiftsError("");
      return;
    }

    const monthKey = /^\d{4}-\d{2}$/.test(attendanceMonth)
      ? attendanceMonth
      : getTodayAttendanceDateKey().slice(0, 7);
    const dateKeys = attendanceMonthDateKeys(monthKey);
    if (!dateKeys.length) {
      setAttendanceMonthResolvedShifts({});
      return;
    }

    let alive = true;

    async function loadMonthResolvedShifts() {
      setAttendanceMonthResolvedShiftsLoading(true);
      setAttendanceMonthResolvedShiftsError("");
      let hadError = false;
      const pairs = await Promise.all(
        dateKeys.map(async (date) => {
          try {
            const row = await CoreHrService.resolveEmployeeShift(attendanceEmployeeId, date);
            return [date, row] as const;
          } catch (error) {
            hadError = true;
            console.warn("employee attendance month shift resolve failed", { employeeId: attendanceEmployeeId, date, error });
            return [date, null] as const;
          }
        })
      );
      if (!alive) return;
      setAttendanceMonthResolvedShifts(Object.fromEntries(pairs));
      setAttendanceMonthResolvedShiftsError(hadError ? "تعذر تحميل بعض شفتات الشهر من Core." : "");
      setAttendanceMonthResolvedShiftsLoading(false);
    }

    void loadMonthResolvedShifts();

    return () => {
      alive = false;
    };
  }, [attendanceEmployeeId, attendanceMonth, attendanceMonthResolvedShiftsReloadKey, attendanceOnly, canViewAttendance]);

  useEffect(() => {
    if (!attendanceEmployeeId) {
      setEmployeeBookings([]);
      return;
    }

    let alive = true;

    async function loadEmployeeBookings() {
      setEmployeeBookingsLoading(true);
      try {
        const rows = await listEmployeeBookings(attendanceEmployeeId, displayName);
        if (alive) setEmployeeBookings(rows);
      } catch {
        if (alive) setEmployeeBookings([]);
      } finally {
        if (alive) setEmployeeBookingsLoading(false);
      }
    }

    void loadEmployeeBookings();

    return () => {
      alive = false;
    };
  }, [attendanceEmployeeId, displayName]);

  useEffect(() => {
    if (!session.uid) {
      setEmployeeLeaveBalance(null);
      setEmployeeLeaveBalanceError("");
      setEmployeeLeaveBalanceLoading(false);
      return;
    }

    let alive = true;

    async function loadCanonicalLeaveBalance() {
      setEmployeeLeaveBalanceLoading(true);
      setEmployeeLeaveBalanceError("");

      try {
        const state =
          await CoreHrService.getMyLeaveBalance();

        const value = Number(
          state.leaveBalance
        );

        if (alive) {
          setEmployeeLeaveBalance(
            Number.isFinite(value)
              ? value
              : null
          );
        }
      } catch (error) {
        if (alive) {
          setEmployeeLeaveBalance(null);
          setEmployeeLeaveBalanceError(
            cleanText(
              (error as any)?.message ||
                "تعذر تحميل رصيد الإجازة من النظام المركزي."
            )
          );
        }
      } finally {
        if (alive) {
          setEmployeeLeaveBalanceLoading(false);
        }
      }
    }

    void loadCanonicalLeaveBalance();

    return () => {
      alive = false;
    };
  }, [session.uid]);

  useEffect(() => {
    if (!session.uid || !attendanceEmployeeId) {
      setEmployeeLeaveRequests([]);
      setEmployeeLeaveLoading(false);
      setEmployeeLeaveError("");
      return;
    }

    let alive = true;

    async function loadEmployeeLeaveRequests() {
      setEmployeeLeaveLoading(true);
      setEmployeeLeaveError("");
      try {
        const rows = await CoreHrService.listMyLeaves();
        if (alive) setEmployeeLeaveRequests(rows.map((row) => ({
          id: row.id,
          employeeUid: String(row.employeeUid || session.uid),
          employeeId: row.employeeId,
          type: row.leaveType as EmployeeLeaveRequest["type"],
          fromDate: row.startDate,
          toDate: row.endDate,
          days: row.daysCount,
          note: row.employeeNote || undefined,
          status: row.status as EmployeeLeaveRequest["status"],
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          durationKind: row.durationKind,
        } as EmployeeLeaveRequest & { durationKind?: string })));
      } catch (error) {
        if (alive) {
          setEmployeeLeaveRequests([]);
          setEmployeeLeaveError(
            cleanText((error as any)?.message || "تعذر تحميل الإجازات المعتمدة من النظام المركزي.")
          );
        }
      } finally {
        if (alive) setEmployeeLeaveLoading(false);
      }
    }

    void loadEmployeeLeaveRequests();

    return () => {
      alive = false;
    };
  }, [attendanceEmployeeId, session.uid]);

  useEffect(() => {
    if (!canViewOwnTarget) {
      setEmployeeTarget(null);
      setEmployeeTargetLoading(false);
      setEmployeeTargetError("");
      return;
    }

    let alive = true;

    async function loadEmployeeTarget() {
      setEmployeeTargetLoading(true);
      setEmployeeTargetError("");
      try {
        const row = await CoreEmployeeTargetService.mine({ payrollMonth: currentTargetPeriod.payrollMonth });
        if (alive) setEmployeeTarget(row);
      } catch (error) {
        if (alive) {
          setEmployeeTarget(null);
          setEmployeeTargetError(employeeTargetErrorMessage(error));
        }
      } finally {
        if (alive) setEmployeeTargetLoading(false);
      }
    }

    void loadEmployeeTarget();

    return () => {
      alive = false;
    };
  }, [canViewOwnTarget, currentTargetPeriod.payrollMonth]);

  const loadAttendancePermissions = useCallback(async () => {
    if (!session.uid) {
      setAttendancePermissionEntries([]);
      return;
    }

    try {
      const rows = await listPermissionRequestsByEmployee(session.uid, 250);
      setAttendancePermissionEntries(rows);
    } catch (error) {
      console.warn("employee attendance permissions load failed", {
        employeeUid: session.uid,
        error,
      });
      setAttendancePermissionEntries([]);
    }
  }, [session.uid]);

  useEffect(() => {
    if (!attendanceOnly) return;
    void Promise.all([
      loadAttendanceMonth(),
      loadAttendancePermissions(),
    ]);
  }, [attendanceOnly, loadAttendanceMonth, loadAttendancePermissions]);

  useEffect(() => {
    if (!canViewAttendance) return;

    AppSettingsService.fetchRemote()
      .then((remote) => setAttendanceSettings(remote.attendance))
      .catch(() => {});

    return AppSettingsService.subscribe((remote) => {
      setAttendanceSettings(remote.attendance);
    });
  }, [canViewAttendance]);

  const quickActions = [
    ...(canViewAttendance
      ? [{ label: "تصحيح البصمة", href: "/employee/attendance", icon: faFingerprint }]
      : []),
    { label: "طلب إجازة", href: "/employee/leave", icon: faCalendarDays },
    { label: "طلب استئذان", href: "/employee/permission", icon: faPaperPlane },
  ];

  const hrInfoItems = [
    { label: "شخصي", description: "المعلومات الشخصية، الهوية، العنوان", href: "/employee/profile", icon: faUser },
    { label: "البيانات الوظيفية", description: "تاريخ الالتحاق، المسمى الوظيفي، نوع التوظيف", href: "/employee/profile", icon: faBriefcase },
    ...(canViewAttendance
      ? [{ label: "جدول الدوام", description: "بداية ونهاية الدوام، أيام الراحة، ونطاق الحضور", href: "/employee/attendance", icon: faClock }]
      : []),
    { label: "بيانات الراتب", description: "الراتب الأساسي، التأمينات، البدلات، والخصومات الثابتة", href: "/employee/payroll", icon: faMoneyBillWave },
    { label: "الراتب والتفاصيل المالية", description: "سجل رواتب نهاية الشهر والراتب النهائي المقفل", href: "/employee/payroll", icon: faMoneyBillWave },
    { label: "العقود", description: "العقود الحالية والمنتهية", href: "/employee/files", icon: faFileLines },
    { label: "الإجازات", description: "الرصيد، الطلبات، والإجازات المعتمدة", href: "/employee/leave", icon: faCalendarCheck },
    { label: "مستندات", description: "الإقامة، الجواز والمستندات الأخرى", href: "/employee/files", icon: faIdBadge },
  ];

  const openNotification = async (note: EmployeeNotification) => {
    if (!session.uid) return;
    if (!note.isRead) {
      await markEmployeeNotificationRead({ notificationId: note.id, readerUid: session.uid }).catch(() => {});
      await Promise.resolve(onRefresh?.());
    }
    if (note.route) {
      navigate(note.route);
    }
  };

  const handleAttendancePunch = async (
    type: "check_in" | "check_out"
  ) => {
    if (!canViewAttendance || !attendanceEmployeeId || !session.uid || attendanceBusy) {
      return;
    }
    if (type === "check_in" && (todayResolvedShiftLoading || todayResolvedShiftError || !hasResolvedWorkShift)) {
      setAttendanceMessage(
        todayResolvedShiftError ||
          (todayResolvedShiftLoading
            ? "جاري تحميل جدول الدوام المعتمد."
            : "لا يوجد شفت عمل معتمد لهذا اليوم.")
      );
      return;
    }
    if (type === "check_in" && (attendanceDayStatus === "leave" || attendanceDayStatus === "off_day")) {
      setAttendanceMessage(
        attendanceDayStatus === "leave"
          ? "اليوم مسجل كإجازة معتمدة، لذلك لا يمكن تسجيل حضور جديد."
          : "اليوم مسجل كيوم راحة، لذلك لا يمكن تسجيل حضور جديد."
      );
      return;
    }
    if (type === "check_in" && isCheckInWindowClosed(attendanceDate, todayAttendanceSchedule)) {
      setAttendanceMessage("انتهت مهلة تسجيل الحضور. تم إغلاق بصمة الحضور، ويرجى مراجعة الإدارة.");
      return;
    }

    setAttendanceBusy(true);
    setAttendanceMessage("");
    setLastLocation(null);
    setLastWorkZone(null);

    try {
      const effectiveAttendanceSettings =
        attendanceSettings ||
        AppSettingsService.getDefaults().attendance!;

      if (effectiveAttendanceSettings.enabled === false) {
        throw new Error(
          "تسجيل الحضور متوقف من إعدادات الإدارة."
        );
      }

      setAttendanceMessage(
        "جاري الحصول على موقعك بدقة..."
      );

      const location: AttendanceLocation =
        await getBrowserPosition({
          enableHighAccuracy: true,
          maximumAge: 8000,
          timeout: 12000,
          targetAccuracyMeters: 50,
          acceptableAccuracyMeters: 150,
          acceptableReadingDelayMs: 400,
          acceptFirstUsableReading: true,
          freshCacheMaxAgeMs: 8000,
        });

      setLastLocation(location);

      if (effectiveAttendanceSettings.requireBiometric) {
        setAttendanceMessage(
          "افتح التحقق بالبصمة من جهازك..."
        );

        await requestAttendanceBiometric({
          employeeId: attendanceEmployeeId,
          displayName,
          action: type,
        });
      }

      setAttendanceMessage(
        type === "check_in"
          ? "جاري إرسال الحضور إلى Cloudflare..."
          : "جاري إرسال الانصراف إلى Cloudflare..."
      );

      const response = await submitAttendanceToWorker({
        employeeUid: session.uid,
        employeeId: attendanceEmployeeId,
        attendanceZoneId: assignedAttendanceZoneId,
        type,
        location,
      });

      if (response.result !== "allowed") {
        throw new Error(
          getAttendanceWorkerMessage(response)
        );
      }

      await loadAttendance();

      if (attendanceOnly) {
        await loadAttendanceMonth();
      }

      setAttendanceMessage(
        getAttendanceWorkerMessage(response)
      );
    } catch (error) {
      const attendanceError = error as any;

      if (attendanceError?.location) {
        setLastLocation(attendanceError.location);
      }

      if (attendanceError?.workZoneMatch) {
        setLastWorkZone(
          attendanceError.workZoneMatch
        );
      }

      setAttendanceMessage(
        cleanText(
          attendanceError?.message ||
            "تعذر حفظ عملية الحضور."
        )
      );
    } finally {
      setAttendanceBusy(false);
    }
  };

  const statusLabel = onLeave
    ? leaveUntil
      ? `في إجازة حتى ${formatShortDate(leaveUntil)}`
      : "في إجازة"
    : employeeLeaveLoading
      ? "جاري التحقق من الإجازات"
      : employeeLeaveError
        ? "حالة الإجازة غير متاحة"
        : "نشط";
  const attendanceStatus = attendance?.status || "not_started";
  const checkInWindowClosed = isCheckInWindowClosed(attendanceDate, todayAttendanceSchedule);
  const canCheckIn =
    canViewAttendance &&
    !attendanceBusy &&
    !attendanceLoading &&
    !todayResolvedShiftLoading &&
    !todayResolvedShiftError &&
    hasResolvedWorkShift &&
    attendanceDayStatus !== "leave" &&
    attendanceDayStatus !== "off_day" &&
    attendanceStatus === "not_started" &&
    !checkInWindowClosed;
  const canCheckOut =
    canViewAttendance &&
    !attendanceBusy &&
    !attendanceLoading &&
    attendanceStatus === "checked_in";
  const punchAction = canCheckOut ? "check_out" : "check_in";
  const punchDisabled = !canCheckIn && !canCheckOut;
  const punchLabel = attendanceStatus === "checked_out"
    ? "تم اكتمال الدوام"
    : canCheckOut
      ? "تسجيل انصراف"
      : todayResolvedShiftLoading
        ? "جاري تحميل الشفت"
        : todayResolvedShiftError
          ? "تعذر تحميل الشفت"
          : attendanceDayStatus === "leave"
            ? "إجازة معتمدة"
            : attendanceDayStatus === "off_day"
              ? "يوم راحة"
              : !hasResolvedWorkShift
                ? "لا يوجد شفت اليوم"
                : checkInWindowClosed
                  ? "انتهت مهلة الحضور"
                  : "تسجيل حضور";
  const punchTone = attendanceStatus === "checked_out" ? "done" : canCheckOut ? "out" : "in";
  const checkInTime = formatAttendanceTime(attendance?.checkInAtClient);
  const checkOutTime = formatAttendanceTime(attendance?.checkOutAtClient);
  const latestVerification =
    attendance?.checkOutVerification ||
    attendance?.checkInVerification ||
    null;
  const visibleLocation = lastLocation || latestVerification?.location;
  const visibleZoneName = lastWorkZone?.zone.name || latestVerification?.workZoneName || "";
  const visibleDistance =
    lastWorkZone?.distanceMeters ??
    latestVerification?.distanceMeters ??
    null;
  const visibleAccuracy =
    visibleLocation?.accuracy ??
    null;
  const visibleAccuracyLabel =
    visibleAccuracy === null
      ? ""
      : visibleAccuracy <= 150
        ? `دقة الموقع مقبولة: ${visibleAccuracy} م`
        : `دقة الموقع ضعيفة: ${visibleAccuracy} م`;
  const hasAttendanceVerificationMeta =
    Boolean(visibleZoneName) ||
    Boolean(visibleAccuracyLabel) ||
    visibleDistance !== null;
  const shouldShowAttendanceNote =
    Boolean(attendanceMessage) ||
    hasAttendanceVerificationMeta;
  const leaveBalanceValue =
    employeeLeaveBalanceLoading
      ? "جاري..."
      : employeeLeaveBalance === null
        ? "—"
        : `${employeeLeaveBalance} يوم`;
  const attendanceDateLabel = formatAttendanceDateLabel(attendanceDate);
  const punchHint = attendanceStatus === "checked_out"
    ? "تم حفظ الحضور والانصراف لهذا اليوم"
    : todayResolvedShiftLoading
      ? "جاري قراءة الشفت المنشور من النظام المركزي."
      : todayResolvedShiftError
        ? "تعذر التحقق من الشفت، لذلك تم تعطيل تسجيل حضور جديد بدل استخدام جدول قديم."
        : attendanceDayStatus === "leave"
          ? "هذا اليوم مغطى بإجازة معتمدة في نظام الموارد البشرية."
          : attendanceDayStatus === "off_day"
            ? "لا يوجد دوام مطلوب لهذا اليوم حسب الشفت المنشور."
            : !hasResolvedWorkShift
              ? "لا يوجد شفت منشور لهذا اليوم. راجعي الإدارة إذا كان يفترض وجود دوام."
              : checkInWindowClosed && attendanceStatus === "not_started"
                ? "تم إغلاق بصمة الحضور، وسيتم تسجيل الغياب تلقائيًا. راجعي الإدارة عند وجود عذر."
                : attendanceBusy
                  ? "لا تغلق الصفحة أثناء التحقق"
                  : "";
  const targetSummary = employeeTarget?.summary;
  const targetAmount = Number(targetSummary?.currentTargetAmount || employeeTarget?.targetCalculation?.targetAmount || 0);
  const targetSales = Number(targetSummary?.netTargetAmount || 0);
  const targetProgress = Number(targetSummary?.progressRatio || 0);
  const targetRemaining = Number(targetSummary?.remainingToNextTier || employeeTarget?.targetCalculation?.remainingToNextTier || 0);
  const targetNextTier = targetSummary?.nextTier || employeeTarget?.targetCalculation?.nextTier || null;
  const targetAchievedTier = targetSummary?.achievedTier || employeeTarget?.targetCalculation?.achievedTier || null;
  const targetHasPlan = Boolean(targetSummary?.hasTargetPlan ?? targetSummary?.plan);
  const targetClosed = Boolean(employeeTarget?.isPayrollClosed || employeeTarget?.period?.isClosed);
  const targetCardStatus = employeeTargetLoading
    ? "loading"
    : employeeTargetError
      ? "error"
      : !targetHasPlan
        ? "empty"
        : targetClosed
          ? "closed"
          : "ready";

  if (attendanceOnly) {
    return (
      <div className="employee-overview-v2-page employee-attendance-month-page">
        <AttendanceMonthView
          className="attendance-month--employee-portal-v2"
          rows={attendanceMonthRows}
          loading={
            attendanceMonthLoading ||
            attendanceLoading ||
            attendanceMonthResolvedShiftsLoading ||
            attendanceAbsenceLoading
          }
          monthKey={attendanceMonth}
          selectedDate={attendanceSelectedDate}
          title="سجل حضور الموظفة"
          subtitle="اختر الشهر لعرض تقويم الحضور اليومي، ثم اختر اليوم لمراجعة السجل."
          viewerMode="employee"
          coreResolvedShifts={attendanceMonthResolvedShifts}
          coreResolvedShiftsLoading={attendanceMonthResolvedShiftsLoading}
          coreResolvedShiftsError={
            attendanceMonthResolvedShiftsError ||
            attendanceAbsenceError
          }
          approvedLeaveDateKeys={approvedLeaveDateKeys}
          absenceDateKeys={attendanceAbsenceDateKeys}
          permissionEntries={attendancePermissionEntries}
          onMonthChange={(monthKey) => {
            setAttendanceMonth(monthKey);
            setAttendanceSelectedDate((current) =>
              String(current || "").startsWith(monthKey) ? current : `${monthKey}-01`
            );
          }}
          onSelectedDateChange={setAttendanceSelectedDate}
          onGenerateSummary={() => {
            setAttendanceMonthResolvedShiftsReloadKey((value) => value + 1);
            setAttendanceAbsenceReloadKey((value) => value + 1);
            void Promise.all([
              loadAttendanceMonth(),
              loadAttendancePermissions(),
            ]);
          }}
        />

        {attendanceMessage ? (
          <div className="employee-attendance-month-message">{attendanceMessage}</div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="employee-overview-v2-page">
      <section className="employee-app-intro">
        <div className="employee-app-intro__identity">
          <EmployeeAvatar
            className="employee-app-intro__avatar"
            src={avatarUrl}
            name={displayName || displayInitial(displayName)}
            alt=""
            loading="eager"
          />
          <div>
            <p>{getGreeting()}</p>
            <h1>{displayName}</h1>
            <span>{department || "بدون قسم"} · {title || "بدون مسمى وظيفي"}</span>
          </div>
        </div>
        <div className="employee-app-intro__meta">
          <span className={`employee-status-pill ${onLeave ? "is-leave" : employeeLeaveError ? "is-inactive" : "is-active"}`}>{statusLabel}</span>
          <span>{roleLabel(session.role)}</span>
          <span>{attendanceDateLabel}</span>
        </div>
      </section>

      {employeeLeaveError || (canViewAttendance && todayResolvedShiftError) ? (
        <div className="employee-overview-runtime-alert" role="status" aria-live="polite">
          <strong>بعض البيانات التشغيلية غير متاحة الآن.</strong>
          <span>{employeeLeaveError || todayResolvedShiftError}</span>
          <small>لم يتم استخدام أي جدول دوام أو حالة إجازة Legacy كبديل.</small>
        </div>
      ) : null}

      <section className="employee-overview-kpis" aria-label="ملخص التنبيهات">
        <Link to="/employee/notifications" className="employee-overview-kpi">
          <FontAwesomeIcon icon={faBell} />
          <span>التنبيهات غير المقروءة</span>
          <strong>{summary.all}</strong>
        </Link>
        {canViewMessages ? (
          <Link to="/employee/messages" className="employee-overview-kpi">
            <FontAwesomeIcon icon={faPaperPlane} />
            <span>الرسائل</span>
            <strong>{summary.message}</strong>
          </Link>
        ) : null}
        <Link to="/employee/files" className="employee-overview-kpi">
          <FontAwesomeIcon icon={faFileLines} />
          <span>تحديثات الملفات</span>
          <strong>{summary.file}</strong>
        </Link>
        <Link to="/employee/leave" className="employee-overview-kpi">
          <FontAwesomeIcon icon={faCalendarCheck} />
          <span>الإجازات والرواتب</span>
          <strong>{summary.leave + summary.payroll}</strong>
        </Link>
      </section>

      {canViewAttendance ? (
      <section className={`employee-attendance-card employee-attendance-card--${attendanceStatus}`} data-status={attendanceStatus}>
        <div className="employee-section-title">
          <div>
            <small><FontAwesomeIcon icon={faClock} /> الحضور والانصراف</small>
            <h2>تسجيل الدوام</h2>
          </div>
          <span className="employee-gps-chip"><i aria-hidden="true" /> GPS + تصوير حسب الفرع</span>
        </div>

        <div className="employee-attendance-console">
          <div className="employee-attendance-side employee-attendance-side--in">
            <span>الحضور</span>
            <strong>{checkInTime}</strong>
            <em className={attendance?.checkInAtClient ? "is-done" : ""}>
              {attendance?.checkInAtClient ? "تم الحضور" : "لم يتم الحضور"}
            </em>
          </div>

          <div className="employee-punch-control">
            <button
              type="button"
              className={`employee-punch-button employee-punch-button--${punchTone}`}
              onClick={() => void handleAttendancePunch(punchAction)}
              disabled={punchDisabled}
              aria-label={attendanceBusy ? "جاري التسجيل" : punchLabel}
              aria-describedby="employee-punch-hint"
            >
              <span><FontAwesomeIcon icon={faFingerprint} /></span>
            </button>
            <strong>{attendanceBusy ? "جاري التسجيل..." : punchLabel}</strong>
          </div>

          <div className="employee-attendance-side employee-attendance-side--out">
            <span>الانصراف</span>
            <strong>{checkOutTime}</strong>
            <em className={attendance?.checkOutAtClient ? "is-done" : ""}>
              {attendance?.checkOutAtClient ? "تم الانصراف" : "لم يتم الانصراف"}
            </em>
          </div>
        </div>

        <div className={`employee-attendance-status employee-attendance-status--${attendanceStatus}`} role="status" aria-live="polite">
          <span>
            {attendanceMessage || (
              attendanceLoading
                ? "جاري تحديث حالة اليوم..."
                : attendanceStatus === "checked_out"
                  ? "تم تسجيل الحضور والانصراف"
                  : attendanceStatus === "checked_in"
                    ? "تم تسجيل الحضور"
                    : "لم يتم تسجيل الحضور"
            )}
          </span>
        </div>

        <div className="employee-attendance-hint" id="employee-punch-hint">
          {punchHint || (
            attendanceStatus === "checked_in"
              ? "اضغط البصمة لتسجيل الانصراف وإكمال دوام اليوم."
              : attendanceStatus === "checked_out"
                ? "تم اكتمال دوام اليوم وحفظ الحضور والانصراف."
                : "اضغط البصمة لتسجيل الحضور، والضغطة التالية في نفس اليوم تسجل الانصراف تلقائيًا."
          )}
        </div>

        {shouldShowAttendanceNote && hasAttendanceVerificationMeta ? (
          <div className="employee-attendance-note is-meta-only" aria-label="بيانات التحقق من الحضور">
            <div>
              {visibleZoneName ? <small>{visibleZoneName}</small> : null}
              {visibleAccuracyLabel ? <small>{visibleAccuracyLabel}</small> : null}
              {visibleDistance !== null ? <small>المسافة: {visibleDistance} م</small> : null}
            </div>
          </div>
        ) : null}
      </section>
      ) : null}

      {canViewOwnTarget ? (
      <section className={`employee-target-home-card employee-target-home-card--${targetCardStatus}`} aria-label="تارقتي">
        <div className="employee-target-home-card__head">
          <span><FontAwesomeIcon icon={faChartLine} /></span>
          <div>
            <small>تارقتي</small>
            <h2>تقدم المبيعات والبونص</h2>
          </div>
          <Link to="/employee/targets">عرض التفاصيل</Link>
        </div>

        {employeeTargetLoading ? (
          <p className="employee-target-home-card__message">جاري تحميل تارقتك...</p>
        ) : employeeTargetError ? (
          <p className="employee-target-home-card__message">{employeeTargetError}</p>
        ) : !targetHasPlan ? (
          <p className="employee-target-home-card__message">لا توجد خطة تارقت مخصصة لهذه الدورة حتى الآن.</p>
        ) : (
          <>
            <div className="employee-target-home-card__numbers">
              <div>
                <span>المبيعات المحصلة</span>
                <strong>{formatTargetMoney(targetSales)}</strong>
              </div>
              <div>
                <span>التارقت</span>
                <strong>{formatTargetMoney(targetAmount)}</strong>
              </div>
              <div>
                <span>البونص الحالي</span>
                <strong>{formatTargetMoney(targetSummary?.earnedBonusAmount)}</strong>
              </div>
            </div>

            <div className="employee-target-home-progress">
              <span style={{ width: `${Math.min(100, targetProgress * 100)}%` }} />
            </div>

            <div className="employee-target-home-card__foot">
              <strong>{formatTargetPercent(targetProgress)}</strong>
              <span>{targetAchievedTier?.tierName || "لم تتحقق شريحة بعد"}</span>
              <small>
                {targetNextTier
                  ? `متبقي ${formatTargetMoney(targetRemaining)} للحصول على بونص ${formatTargetMoney(targetNextTier.bonusAmount)}`
                  : "تم تحقيق أعلى شريحة في الخطة الحالية."}
              </small>
            </div>

            <div className="employee-target-home-card__updated">
              <span>{targetClosed ? "دورة الراتب مغلقة" : "دورة الراتب الحالية"}</span>
              <span>آخر تحديث: {formatTargetUpdatedAt(employeeTarget?.lastUpdatedAt || targetSummary?.lastUpdatedAt)}</span>
            </div>
          </>
        )}
      </section>
      ) : null}

      <section className="employee-overview-block">
        <div className="employee-block-head">
          <h2>اختصارات سريعة</h2>
          <p>وصول سريع لأكثر الإجراءات استخدامًا</p>
        </div>
        <div className="employee-shortcuts-grid">
          {quickActions.map((action) => (
            <Link key={action.href} to={action.href} className="employee-shortcut-card">
              <FontAwesomeIcon icon={action.icon} />
              <span>{action.label}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="employee-overview-block">
        <div className="employee-block-head">
          <h2>معلومات الموارد البشرية</h2>
          <p>عناصر تنقل فقط، كل قسم يفتح في صفحة داخلية مستقلة</p>
        </div>
        <div className="employee-hr-info-list">
          {hrInfoItems.map((item) => (
            <Link key={item.label} to={item.href} className="employee-hr-info-row">
              <FontAwesomeIcon icon={faChevronLeft} className="employee-hr-info-arrow" />
              <div className="employee-hr-info-copy">
                <strong>{item.label}</strong>
                <span>{item.description}</span>
              </div>
              <span className="employee-hr-info-icon">
                <FontAwesomeIcon icon={item.icon} />
              </span>
            </Link>
          ))}
        </div>
      </section>
      <section className="employee-overview-block">
        <div className="employee-block-head">
          <h2>حجوزاتي القادمة</h2>
          <p>الحجوزات المرتبطة بملفك كموظفة داخل نفس البروفايل.</p>
        </div>
        <div className="employee-request-list">
          {upcomingBookings.map((booking) => (
            <div key={booking.id} className="employee-request-row">
              <span className={`employee-notification-tone employee-notification-tone--${booking.status === "confirmed" ? "success" : "info"}`}>
                {getBookingStatusLabel(booking.status)}
              </span>
              <div>
                <strong>{cleanText(booking.serviceName || booking.serviceSnapshot?.serviceNameAtBooking || "حجز")}</strong>
                <small>
                  {cleanText(booking.date) || "-"} | {cleanText(booking.time || booking.startTime) || "-"} | {cleanText(booking.clientName) || "عميلة"}
                </small>
              </div>
            </div>
          ))}
          {employeeBookingsLoading ? <div className="employee-empty-box">جاري تحميل الحجوزات...</div> : null}
          {!employeeBookingsLoading && !upcomingBookings.length ? (
            <div className="employee-empty-box">لا توجد حجوزات قادمة مرتبطة بملفك.</div>
          ) : null}
        </div>
      </section>

      <section className="employee-overview-block">
        <div className="employee-block-head">
          <h2>آخر الطلبات</h2>
          <p>آخر التحديثات المسجلة في النظام الحالي</p>
        </div>
        <div className="employee-request-list">
          {latestNotes.slice(0, 4).map((note) => (
            <button
              key={note.id}
              type="button"
              className="employee-request-row"
              onClick={() => void openNotification(note)}
            >
              <span className={`employee-notification-tone employee-notification-tone--${notificationTone(note.type)}`}>
                {notificationTypeLabel(note.type)}
              </span>
              <div>
                <strong>{note.title}</strong>
                <small>{formatNotificationTime(note.createdAt)}</small>
              </div>
            </button>
          ))}
          {!latestNotes.length ? <div className="employee-empty-box">لا توجد طلبات مسجلة حتى الآن.</div> : null}
        </div>
      </section>

      <section className="employee-overview-bottom-grid">
        <div className="employee-overview-block">
          <div className="employee-block-head">
            <h2>الرصيد المتبقي</h2>
            <p>يعرض الرصيد الحالي من بيانات الموظف الموجودة</p>
          </div>
          <div className="employee-balance-card">
            <div>
              <span>رصيد الإجازات</span>
              <small>
                {employeeLeaveBalanceError ||
                  "الرصيد التشغيلي المعتمد من Core"}
              </small>
            </div>
            <strong>{leaveBalanceValue}</strong>
          </div>
        </div>

        <div className="employee-overview-block">
          <div className="employee-block-head">
            <h2>الإعلانات</h2>
            <p>لا توجد إعلانات مرتبطة حاليًا.</p>
          </div>
          <div className="employee-empty-box">
            <FontAwesomeIcon icon={faBell} />
            <span>لا توجد إعلانات حاليًا.</span>
          </div>
        </div>
      </section>
    </div>
  );
}
