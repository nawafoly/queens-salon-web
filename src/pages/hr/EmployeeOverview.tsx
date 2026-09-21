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
  type EmployeeLeaveRequest,
} from "../../services/employeeLeaveRequestsCore";
import {
  isEmployeeRequestNotificationId,
  markEmployeeNotificationRead,
  type EmployeeNotification,
} from "../../services/employeeNotificationsCore";
import { markEmployeeRequestNotificationRead } from "../../services/employeeRequests";
import {
  getTodayAttendanceDateKey,
  type StaffAttendanceWithId,
  type StaffAttendanceToday,
} from "../../services/firestoreAttendance";
import { AppSettingsService } from "../../services/AppSettingsService";
import { CoreHrService } from "../../services/CoreHrService";
import { type BookingDocWithId } from "../../services/firestoreBookings";
import { CoreBookingService } from "../../services/CoreBookingService";
import { coreBookingToLegacy } from "../../services/coreBookingMappers";
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
import { useEmployeePortalLanguage } from "../../features/employee-portal/EmployeePortalLanguage";

type Props = {
  session: HrSession;
  notifications: EmployeeNotification[];
  onRefresh?: () => void | Promise<void>;
  attendanceOnly?: boolean;
};

const overviewCopy = {
  ar: {
    evening: "مساء الخير", morning: "صباح الخير", afternoon: "نهارك سعيد",
    noDepartment: "بدون قسم", noTitle: "بدون مسمى وظيفي",
    owner: "مالك", admin: "مدير", hr: "موارد بشرية", reception: "استقبال", employee: "موظف",
    leaveUntil: "في إجازة حتى", onLeave: "في إجازة", checkingLeave: "جاري التحقق من الإجازات", leaveUnavailable: "حالة الإجازة غير متاحة", active: "نشط",
    runtimeUnavailable: "بعض البيانات التشغيلية غير متاحة الآن.", runtimeLegacy: "لم يتم استخدام أي جدول دوام أو حالة إجازة Legacy كبديل.", leaveLoadFailed: "تعذر تحميل الإجازات المعتمدة من النظام المركزي.", leaveBalanceLoadFailed: "تعذر تحميل رصيد الإجازة من النظام المركزي.", shiftLoadFailed: "تعذر تحميل شفت اليوم.",
    notificationSummary: "ملخص التنبيهات", unreadNotifications: "التنبيهات غير المقروءة", messages: "الرسائل", fileUpdates: "تحديثات الملفات", leavePayroll: "الإجازات والرواتب",
    attendance: "الحضور والانصراف", attendanceEntry: "تسجيل الدوام", gps: "GPS + تصوير حسب الفرع",
    checkIn: "الحضور", checkedIn: "تم الحضور", notCheckedIn: "لم يتم الحضور", checkOut: "الانصراف", checkedOut: "تم الانصراف", notCheckedOut: "لم يتم الانصراف",
    registering: "جاري التسجيل", updatingToday: "جاري تحديث حالة اليوم...", attendanceComplete: "تم تسجيل الحضور والانصراف", attendanceRecorded: "تم تسجيل الحضور", attendanceNotRecorded: "لم يتم تسجيل الحضور",
    punchOutHint: "اضغط البصمة لتسجيل الانصراف وإكمال دوام اليوم.", completedHint: "تم اكتمال دوام اليوم وحفظ الحضور والانصراف.", punchInHint: "اضغط البصمة لتسجيل الحضور، والضغطة التالية في نفس اليوم تسجل الانصراف تلقائيًا.",
    verificationData: "بيانات التحقق من الحضور", acceptableAccuracy: "دقة الموقع مقبولة", weakAccuracy: "دقة الموقع ضعيفة", distance: "المسافة", meter: "م",
    myTarget: "تارقتي", targetSubtitle: "تقدم المبيعات والبونص", viewDetails: "عرض التفاصيل", targetLoading: "جاري تحميل تارقتك...", noTargetPlan: "لا توجد خطة تارقت مخصصة لهذه الدورة حتى الآن.",
    collectedSales: "المبيعات المحصلة", target: "التارقت", currentBonus: "البونص الحالي", noTier: "لم تتحقق شريحة بعد", remaining: "متبقي", bonusGoal: "للحصول على بونص", topTier: "تم تحقيق أعلى شريحة في الخطة الحالية.", payrollClosed: "دورة الراتب مغلقة", currentPayroll: "دورة الراتب الحالية", lastUpdated: "آخر تحديث", neverUpdated: "لم يحدث بعد",
    quickActions: "اختصارات سريعة", quickActionsSubtitle: "وصول سريع لأكثر الإجراءات استخدامًا", fingerprintCorrection: "تصحيح البصمة", leaveRequest: "طلب إجازة", permissionRequest: "طلب استئذان",
    hrInfo: "معلومات الموارد البشرية", hrInfoSubtitle: "عناصر تنقل فقط، كل قسم يفتح في صفحة داخلية مستقلة",
    personal: "شخصي", personalDescription: "المعلومات الشخصية، الهوية، العنوان", employment: "البيانات الوظيفية", employmentDescription: "تاريخ الالتحاق، المسمى الوظيفي، نوع التوظيف", schedule: "جدول الدوام", scheduleDescription: "بداية ونهاية الدوام، أيام الراحة، ونطاق الحضور", salaryData: "بيانات الراتب", salaryDataDescription: "الراتب الأساسي، التأمينات، البدلات، والخصومات الثابتة", payrollDetails: "الراتب والتفاصيل المالية", payrollDetailsDescription: "سجل رواتب نهاية الشهر والراتب النهائي المقفل", contracts: "العقود", contractsDescription: "العقود الحالية والمنتهية", leaves: "الإجازات", leavesDescription: "الرصيد، الطلبات، والإجازات المعتمدة", documents: "مستندات", documentsDescription: "الإقامة، الجواز والمستندات الأخرى",
    upcomingBookings: "حجوزاتي القادمة", upcomingBookingsSubtitle: "الحجوزات المرتبطة بملفك كموظفة داخل نفس البروفايل.", booking: "حجز", client: "عميلة", bookingsLoading: "جاري تحميل الحجوزات...", noBookings: "لا توجد حجوزات قادمة مرتبطة بملفك.", confirmed: "مؤكد", completed: "مكتمل", cancelled: "ملغي", pendingConfirmation: "بانتظار التأكيد",
    latestRequests: "آخر الطلبات", latestRequestsSubtitle: "آخر التحديثات المسجلة في النظام الحالي", noRequests: "لا توجد طلبات مسجلة حتى الآن.",
    remainingBalance: "الرصيد المتبقي", remainingBalanceSubtitle: "يعرض الرصيد الحالي من بيانات الموظف الموجودة", leaveBalance: "رصيد الإجازات", coreBalance: "الرصيد التشغيلي المعتمد من Core", loading: "جاري...", day: "يوم",
    announcements: "الإعلانات", announcementsSubtitle: "لا توجد إعلانات مرتبطة حاليًا.", noAnnouncements: "لا توجد إعلانات حاليًا.",
    targetSessionExpired: "انتهت جلسة الدخول.", targetLinkRequired: "الحساب غير مربوط بملف موظفة.", targetForbidden: "لا توجد صلاحية لعرض التارقت.", targetLoadFailed: "تعذر تحميل التارقت.",
    shiftLoadingBlocked: "انتظري حتى يكتمل تحميل شفت اليوم.", noShiftBlocked: "لا يوجد شفت منشور لهذا اليوم.", approvedLeaveBlocked: "اليوم مسجل كإجازة معتمدة، لذلك لا يمكن تسجيل حضور جديد.", offDayBlocked: "اليوم مسجل كيوم راحة، لذلك لا يمكن تسجيل حضور جديد.", windowClosedBlocked: "انتهت مهلة تسجيل الحضور. تم إغلاق بصمة الحضور، ويرجى مراجعة الإدارة.", attendanceDisabled: "تسجيل الحضور متوقف من إعدادات الإدارة.", locating: "جاري الحصول على موقعك بدقة...", biometric: "افتح التحقق بالبصمة من جهازك...", sendingIn: "جاري إرسال الحضور إلى Cloudflare...", sendingOut: "جاري إرسال الانصراف إلى Cloudflare...", saveFailed: "تعذر حفظ عملية الحضور.",
    dutyCompleted: "تم اكتمال الدوام", incomplete: "غير مكتمل", incompleteHint: "لم تُسجّل بصمة الخروج. راجعي الإدارة لتصحيح السجل.", registerOut: "تسجيل انصراف", loadingShift: "جاري تحميل الشفت", approvedLeave: "إجازة معتمدة", offDay: "يوم راحة", noShift: "لا يوجد شفت اليوم", windowClosed: "انتهت مهلة الحضور", registerIn: "تسجيل حضور", savedToday: "تم حفظ الحضور والانصراف لهذا اليوم", readingShift: "جاري قراءة الشفت المنشور من النظام المركزي.", shiftFallback: "تعذر عرض بيانات الشفت في التقويم. عند تسجيل الحضور سيتم التحقق من الشفت مباشرة من Core داخل خادم الحضور.", leaveCovered: "هذا اليوم مغطى بإجازة معتمدة في نظام الموارد البشرية.", noDuty: "لا يوجد دوام مطلوب لهذا اليوم حسب الشفت المنشور.", noPublishedShift: "لا يوجد شفت منشور لهذا اليوم. راجعي الإدارة إذا كان يفترض وجود دوام.", autoAbsence: "تم إغلاق بصمة الحضور، وسيتم تسجيل الغياب تلقائيًا. راجعي الإدارة عند وجود عذر.", keepOpen: "لا تغلق الصفحة أثناء التحقق",
  },
  en: {
    evening: "Good evening", morning: "Good morning", afternoon: "Good afternoon",
    noDepartment: "No department", noTitle: "No job title",
    owner: "Owner", admin: "Manager", hr: "Human Resources", reception: "Reception", employee: "Employee",
    leaveUntil: "On leave until", onLeave: "On leave", checkingLeave: "Checking leave status", leaveUnavailable: "Leave status unavailable", active: "Active",
    runtimeUnavailable: "Some operational data is currently unavailable.", runtimeLegacy: "No legacy schedule or leave status was used as a fallback.", leaveLoadFailed: "Could not load approved leave.", leaveBalanceLoadFailed: "Could not load your leave balance.", shiftLoadFailed: "Could not load today's shift.",
    notificationSummary: "Notification summary", unreadNotifications: "Unread notifications", messages: "Messages", fileUpdates: "File updates", leavePayroll: "Leave and payroll",
    attendance: "Attendance", attendanceEntry: "Clock in and out", gps: "GPS + branch photo verification",
    checkIn: "Clock in", checkedIn: "Clocked in", notCheckedIn: "Not clocked in", checkOut: "Clock out", checkedOut: "Clocked out", notCheckedOut: "Not clocked out",
    registering: "Recording...", updatingToday: "Updating today’s status...", attendanceComplete: "Clock-in and clock-out recorded", attendanceRecorded: "Clock-in recorded", attendanceNotRecorded: "No clock-in recorded",
    punchOutHint: "Tap the fingerprint to clock out and complete today’s shift.", completedHint: "Today’s attendance has been completed and saved.", punchInHint: "Tap the fingerprint to clock in. The next tap today will clock you out automatically.",
    verificationData: "Attendance verification details", acceptableAccuracy: "Location accuracy accepted", weakAccuracy: "Low location accuracy", distance: "Distance", meter: "m",
    myTarget: "My Targets", targetSubtitle: "Sales and bonus progress", viewDetails: "View details", targetLoading: "Loading your targets...", noTargetPlan: "No target plan has been assigned for this period yet.",
    collectedSales: "Collected sales", target: "Target", currentBonus: "Current bonus", noTier: "No tier achieved yet", remaining: "Remaining", bonusGoal: "to earn a bonus of", topTier: "You reached the highest tier in the current plan.", payrollClosed: "Payroll period closed", currentPayroll: "Current payroll period", lastUpdated: "Last updated", neverUpdated: "Not updated yet",
    quickActions: "Quick actions", quickActionsSubtitle: "Fast access to frequently used actions", fingerprintCorrection: "Attendance correction", leaveRequest: "Request leave", permissionRequest: "Request permission",
    hrInfo: "HR information", hrInfoSubtitle: "Navigation links; each section opens on its own page",
    personal: "Personal", personalDescription: "Personal details, ID and address", employment: "Employment details", employmentDescription: "Start date, job title and employment type", schedule: "Work schedule", scheduleDescription: "Working hours, rest days and attendance zone", salaryData: "Salary information", salaryDataDescription: "Base salary, insurance, allowances and fixed deductions", payrollDetails: "Payroll and financial details", payrollDetailsDescription: "Month-end payroll history and finalized salary", contracts: "Contracts", contractsDescription: "Current and expired contracts", leaves: "Leave", leavesDescription: "Balance, requests and approved leave", documents: "Documents", documentsDescription: "Residence permit, passport and other documents",
    upcomingBookings: "Upcoming bookings", upcomingBookingsSubtitle: "Bookings linked to your employee profile.", booking: "Booking", client: "Client", bookingsLoading: "Loading bookings...", noBookings: "No upcoming bookings are linked to your profile.", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled", pendingConfirmation: "Pending confirmation",
    latestRequests: "Latest requests", latestRequestsSubtitle: "Latest updates recorded in the system", noRequests: "No requests have been recorded yet.",
    remainingBalance: "Remaining balance", remainingBalanceSubtitle: "Your current balance from the employee record", leaveBalance: "Leave balance", coreBalance: "Approved operational balance from Core", loading: "Loading...", day: "day",
    announcements: "Announcements", announcementsSubtitle: "No announcements are currently linked.", noAnnouncements: "No announcements right now.",
    targetSessionExpired: "Your session has expired.", targetLinkRequired: "This account is not linked to an employee profile.", targetForbidden: "You do not have permission to view targets.", targetLoadFailed: "Could not load targets.",
    shiftLoadingBlocked: "Wait until today’s shift finishes loading.", noShiftBlocked: "No shift is published for today.", approvedLeaveBlocked: "Today is approved leave, so a new clock-in cannot be recorded.", offDayBlocked: "Today is a rest day, so a new clock-in cannot be recorded.", windowClosedBlocked: "The clock-in window has closed. Please contact management.", attendanceDisabled: "Attendance is disabled in management settings.", locating: "Getting your precise location...", biometric: "Open biometric verification on your device...", sendingIn: "Sending clock-in to Cloudflare...", sendingOut: "Sending clock-out to Cloudflare...", saveFailed: "Could not save attendance.",
    dutyCompleted: "Shift completed", incomplete: "Incomplete", incompleteHint: "No clock-out was recorded. Contact management to correct the attendance record.", registerOut: "Clock out", loadingShift: "Loading shift", approvedLeave: "Approved leave", offDay: "Rest day", noShift: "No shift today", windowClosed: "Clock-in window closed", registerIn: "Clock in", savedToday: "Today’s clock-in and clock-out are saved", readingShift: "Reading the published shift from the central system.", shiftFallback: "Shift details are unavailable. On clock-in, Core will verify the shift through the attendance server.", leaveCovered: "This day is covered by approved leave in the HR system.", noDuty: "No work is required today according to the published shift.", noPublishedShift: "No shift is published today. Contact management if you should be working.", autoAbsence: "The clock-in window is closed and absence will be recorded automatically. Contact management if you have an excuse.", keepOpen: "Keep this page open during verification",
  },
} as const;

type OverviewCopy = { [K in keyof typeof overviewCopy.ar]: string };

function roleLabel(role: string, copy: OverviewCopy) {
  const normalized = cleanText(role).toLowerCase();
  if (normalized === "owner") return copy.owner;
  if (normalized === "admin") return copy.admin;
  if (normalized === "hr") return copy.hr;
  if (normalized === "reception") return copy.reception;
  return copy.employee;
}

function getGreeting(copy: OverviewCopy) {
  const hour = new Date().getHours();
  if (hour < 5) return copy.evening;
  if (hour < 12) return copy.morning;
  if (hour < 17) return copy.afternoon;
  return copy.evening;
}

function displayInitial(value: unknown) {
  return cleanText(value || "م").slice(0, 1).toUpperCase();
}

function formatAttendanceDateLabel(dateKey: string, language: "ar" | "en") {
  const parsed = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateKey;
  return new Intl.DateTimeFormat(language === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-SA", {
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

function formatAttendanceTime(value: unknown, language: "ar" | "en") {
  const raw = cleanText(value);
  if (!raw) return "--:--";
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return raw;
  return new Intl.DateTimeFormat(language === "ar" ? "ar-SA-u-nu-latn" : "en-SA", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(parsed));
}

function formatTargetMoney(halalas: number | undefined | null, language: "ar" | "en") {
  return new Intl.NumberFormat(language === "ar" ? "ar-SA-u-nu-latn" : "en-SA", {
    style: "currency",
    currency: "SAR",
    maximumFractionDigits: 0,
  }).format(Number(halalas || 0) / 100);
}

function formatTargetPercent(value: number | undefined | null, language: "ar" | "en") {
  return `${(Number(value || 0) * 100).toLocaleString(language === "ar" ? "ar-SA-u-nu-latn" : "en-SA", {
    maximumFractionDigits: 1,
  })}%`;
}

function formatTargetUpdatedAt(value: string | undefined | null, language: "ar" | "en", copy: OverviewCopy) {
  if (!value) return copy.neverUpdated;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat(language === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-SA", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(parsed));
}

function employeeTargetErrorMessage(error: unknown, copy: OverviewCopy) {
  if (error instanceof CoreApiError) {
    if (error.status === 401) return copy.targetSessionExpired;
    if (error.code.includes("employee_link_required")) return copy.targetLinkRequired;
    if (error.status === 403) return copy.targetForbidden;
  }
  return copy.targetLoadFailed;
}

function getBookingStatusLabel(status: string | undefined, copy: OverviewCopy) {
  const normalized = cleanText(status || "pending").toLowerCase();
  if (normalized === "confirmed") return copy.confirmed;
  if (normalized === "completed") return copy.completed;
  if (normalized === "cancelled") return copy.cancelled;
  return copy.pendingConfirmation;
}

export default function EmployeeOverviewPage({ session, notifications, onRefresh, attendanceOnly = false }: Props) {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const { language } = useEmployeePortalLanguage();
  const copy = overviewCopy[language];
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
        language === "ar"
          ? cleanText((error as any)?.message || "تعذر تحميل حالة الحضور من Cloudflare.")
          : "Could not load today’s attendance status."
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
          language === "ar"
            ? (error as any)?.message || "تعذر تحميل سجل الحضور الشهري من Cloudflare."
            : "Could not load the monthly attendance record."
        )
      );
    } finally {
      setAttendanceMonthLoading(false);
    }
  }, [attendanceEmployeeId, attendanceMonth, canViewAttendance, language, session.uid]);

  useEffect(() => {
    void loadAttendance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewAttendance, attendanceEmployeeId, attendanceDate, language]);

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
          await CoreHrService.listMyAbsences();

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

        setAttendanceAbsenceError(language === "ar"
          ? "تعذر تحميل الغياب المعتمد من Core."
          : "Could not load approved absences from Core.");
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
    language,
  ]);

  useEffect(() => {
    if (!canViewAttendance) {
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
        const batch = await CoreHrService.resolveMyShiftsRange({
          dateFrom: attendanceDate,
          dateTo: attendanceDate,
        });
        const row = batch.rows.find((item) => cleanText(item.date) === attendanceDate) || null;
        if (alive) setTodayResolvedShift(row);
      } catch (error) {
        if (alive) {
          setTodayResolvedShift(null);
          setTodayResolvedShiftError(
            language === "ar"
              ? cleanText((error as any)?.message || "تعذر تحميل جدول الدوام المعتمد من النظام المركزي.")
              : "Could not load the approved schedule from the central system."
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
  }, [attendanceDate, canViewAttendance, language]);

  useEffect(() => {
    if (!attendanceOnly || !canViewAttendance) {
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
      try {
        const batch = await CoreHrService.resolveMyShiftsRange({
          dateFrom: dateKeys[0],
          dateTo: dateKeys[dateKeys.length - 1],
        });
        if (!alive) return;

        const byDate = new Map<string, CoreResolvedShift>();
        for (const row of batch.rows) {
          const date = cleanText(row.date);
          if (date && !byDate.has(date)) byDate.set(date, row);
        }

        setAttendanceMonthResolvedShifts(
          Object.fromEntries(dateKeys.map((date) => [date, byDate.get(date) || null]))
        );
      } catch (error) {
        if (!alive) return;
        console.warn("employee attendance month self shift resolve failed", {
          month: monthKey,
          error,
        });
        setAttendanceMonthResolvedShifts({});
        setAttendanceMonthResolvedShiftsError(language === "ar"
          ? "تعذر تحميل شفتات الشهر من Core."
          : "Could not load this month’s shifts from Core.");
      } finally {
        if (alive) setAttendanceMonthResolvedShiftsLoading(false);
      }
    }

    void loadMonthResolvedShifts();

    return () => {
      alive = false;
    };
  }, [attendanceMonth, attendanceMonthResolvedShiftsReloadKey, attendanceOnly, canViewAttendance, language]);

  useEffect(() => {
    if (!session.uid) {
      setEmployeeBookings([]);
      return;
    }

    let alive = true;

    async function loadEmployeeBookings() {
      setEmployeeBookingsLoading(true);
      try {
        const rows = (await CoreBookingService.mine()).map(coreBookingToLegacy);
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
  }, [session.uid]);

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
          setEmployeeTargetError(employeeTargetErrorMessage(error, copy));
        }
      } finally {
        if (alive) setEmployeeTargetLoading(false);
      }
    }

    void loadEmployeeTarget();

    return () => {
      alive = false;
    };
  }, [canViewOwnTarget, copy, currentTargetPeriod.payrollMonth]);

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
      ? [{ label: copy.fingerprintCorrection, href: "/employee/attendance", icon: faFingerprint }]
      : []),
    { label: copy.leaveRequest, href: "/employee/leave", icon: faCalendarDays },
    { label: copy.permissionRequest, href: "/employee/permission", icon: faPaperPlane },
  ];

  const hrInfoItems = [
    { label: copy.personal, description: copy.personalDescription, href: "/employee/profile", icon: faUser },
    { label: copy.employment, description: copy.employmentDescription, href: "/employee/profile", icon: faBriefcase },
    ...(canViewAttendance
      ? [{ label: copy.schedule, description: copy.scheduleDescription, href: "/employee/attendance", icon: faClock }]
      : []),
    { label: copy.salaryData, description: copy.salaryDataDescription, href: "/employee/payroll", icon: faMoneyBillWave },
    { label: copy.payrollDetails, description: copy.payrollDetailsDescription, href: "/employee/payroll", icon: faMoneyBillWave },
    { label: copy.contracts, description: copy.contractsDescription, href: "/employee/files", icon: faFileLines },
    { label: copy.leaves, description: copy.leavesDescription, href: "/employee/leave", icon: faCalendarCheck },
    { label: copy.documents, description: copy.documentsDescription, href: "/employee/files", icon: faIdBadge },
  ];

  const openNotification = async (note: EmployeeNotification) => {
    if (!session.uid) return;
    if (!note.isRead) {
      if (isEmployeeRequestNotificationId(note.id)) {
        await markEmployeeRequestNotificationRead(note.id).catch(() => {});
      } else {
        await markEmployeeNotificationRead({ notificationId: note.id, readerUid: session.uid }).catch(() => {});
      }
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
    if (type === "check_in" && todayResolvedShiftLoading) {
      setAttendanceMessage(copy.shiftLoadingBlocked);
      return;
    }

    if (
      type === "check_in" &&
      !todayResolvedShiftError &&
      !hasResolvedWorkShift
    ) {
      setAttendanceMessage(copy.noShiftBlocked);
      return;
    }
    if (type === "check_in" && (attendanceDayStatus === "leave" || attendanceDayStatus === "off_day")) {
      setAttendanceMessage(
        attendanceDayStatus === "leave" ? copy.approvedLeaveBlocked : copy.offDayBlocked
      );
      return;
    }
    if (type === "check_in" && isCheckInWindowClosed(attendanceDate, todayAttendanceSchedule)) {
      setAttendanceMessage(copy.windowClosedBlocked);
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
        throw new Error(copy.attendanceDisabled);
      }

      setAttendanceMessage(copy.locating);

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
        setAttendanceMessage(copy.biometric);

        await requestAttendanceBiometric({
          employeeId: attendanceEmployeeId,
          displayName,
          action: type,
        });
      }

      setAttendanceMessage(
        type === "check_in" ? copy.sendingIn : copy.sendingOut
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

      setAttendanceMessage(language === "en" ? (type === "check_in" ? copy.attendanceRecorded : copy.attendanceComplete) : getAttendanceWorkerMessage(response));
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

      setAttendanceMessage(language === "en" ? copy.saveFailed : cleanText(attendanceError?.message || copy.saveFailed));
    } finally {
      setAttendanceBusy(false);
    }
  };

  const statusLabel = onLeave
    ? leaveUntil
      ? `${copy.leaveUntil} ${formatShortDate(leaveUntil)}`
      : copy.onLeave
    : employeeLeaveLoading
      ? copy.checkingLeave
      : employeeLeaveError
        ? copy.leaveUnavailable
        : copy.active;
  const attendanceStatus = attendance?.status || "not_started";
  const checkInWindowClosed = isCheckInWindowClosed(attendanceDate, todayAttendanceSchedule);
  const canAttemptCheckInWithServerValidation =
    Boolean(todayResolvedShiftError) ||
    hasResolvedWorkShift;

  const canCheckIn =
    canViewAttendance &&
    !attendanceBusy &&
    !attendanceLoading &&
    !todayResolvedShiftLoading &&
    canAttemptCheckInWithServerValidation &&
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
  const punchLabel = attendanceStatus === "incomplete"
    ? copy.incomplete
    : attendanceStatus === "checked_out"
      ? copy.dutyCompleted
      : canCheckOut
      ? copy.registerOut
      : todayResolvedShiftLoading
        ? copy.loadingShift
        : attendanceDayStatus === "leave"
            ? copy.approvedLeave
            : attendanceDayStatus === "off_day"
              ? copy.offDay
              : !hasResolvedWorkShift
                ? copy.noShift
                : checkInWindowClosed
                  ? copy.windowClosed
                  : copy.registerIn;
  const punchTone =
    attendanceStatus === "checked_out" || attendanceStatus === "incomplete"
      ? "done"
      : canCheckOut
        ? "out"
        : "in";
  const checkInTime = formatAttendanceTime(attendance?.checkInAtClient, language);
  const checkOutTime = formatAttendanceTime(attendance?.checkOutAtClient, language);
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
        ? `${copy.acceptableAccuracy}: ${visibleAccuracy} ${copy.meter}`
        : `${copy.weakAccuracy}: ${visibleAccuracy} ${copy.meter}`;
  const hasAttendanceVerificationMeta =
    Boolean(visibleZoneName) ||
    Boolean(visibleAccuracyLabel) ||
    visibleDistance !== null;
  const shouldShowAttendanceNote =
    Boolean(attendanceMessage) ||
    hasAttendanceVerificationMeta;
  const leaveBalanceValue =
    employeeLeaveBalanceLoading
      ? copy.loading
      : employeeLeaveBalance === null
        ? "—"
        : `${employeeLeaveBalance} ${copy.day}`;
  const attendanceDateLabel = formatAttendanceDateLabel(attendanceDate, language);
  const punchHint = attendanceStatus === "incomplete"
    ? copy.incompleteHint
    : attendanceStatus === "checked_out"
      ? copy.savedToday
      : todayResolvedShiftLoading
      ? copy.readingShift
      : todayResolvedShiftError
        ? copy.shiftFallback
        : attendanceDayStatus === "leave"
          ? copy.leaveCovered
          : attendanceDayStatus === "off_day"
            ? copy.noDuty
            : !hasResolvedWorkShift
              ? copy.noPublishedShift
              : checkInWindowClosed && attendanceStatus === "not_started"
                ? copy.autoAbsence
                : attendanceBusy
                  ? copy.keepOpen
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
          title={language === "ar" ? "سجل حضور الموظفة" : "Employee attendance record"}
          subtitle={language === "ar" ? "اختر الشهر لعرض تقويم الحضور اليومي، ثم اختر اليوم لمراجعة السجل." : "Choose a month to view daily attendance, then select a day to review its record."}
          emptySummaryText={language === "ar" ? "اختر يومًا من التقويم لعرض تفاصيل الحضور." : "Choose a day from the calendar to view attendance details."}
          viewerMode="employee"
          language={language}
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
            <p>{getGreeting(copy)}</p>
            <h1>{displayName}</h1>
            <span>{department || copy.noDepartment} · {title || copy.noTitle}</span>
          </div>
        </div>
        <div className="employee-app-intro__meta">
          <span className={`employee-status-pill ${onLeave ? "is-leave" : employeeLeaveError ? "is-inactive" : "is-active"}`}>{statusLabel}</span>
          <span>{roleLabel(session.role, copy)}</span>
          <span>{attendanceDateLabel}</span>
        </div>
      </section>

      {employeeLeaveError || (canViewAttendance && todayResolvedShiftError) ? (
        <div className="employee-overview-runtime-alert" role="status" aria-live="polite">
          <strong>{copy.runtimeUnavailable}</strong>
          <span>{language === "en" ? (employeeLeaveError ? copy.leaveLoadFailed : copy.shiftLoadFailed) : employeeLeaveError || todayResolvedShiftError}</span>
          <small>{copy.runtimeLegacy}</small>
        </div>
      ) : null}

      <section className="employee-overview-kpis" aria-label={copy.notificationSummary}>
        <Link to="/employee/notifications" className="employee-overview-kpi">
          <FontAwesomeIcon icon={faBell} />
          <span>{copy.unreadNotifications}</span>
          <strong>{summary.all}</strong>
        </Link>
        {canViewMessages ? (
          <Link to="/employee/messages" className="employee-overview-kpi">
            <FontAwesomeIcon icon={faPaperPlane} />
            <span>{copy.messages}</span>
            <strong>{summary.message}</strong>
          </Link>
        ) : null}
        <Link to="/employee/files" className="employee-overview-kpi">
          <FontAwesomeIcon icon={faFileLines} />
          <span>{copy.fileUpdates}</span>
          <strong>{summary.file}</strong>
        </Link>
        <Link to="/employee/leave" className="employee-overview-kpi">
          <FontAwesomeIcon icon={faCalendarCheck} />
          <span>{copy.leavePayroll}</span>
          <strong>{summary.leave + summary.payroll}</strong>
        </Link>
      </section>

      {canViewAttendance ? (
      <section className={`employee-attendance-card employee-attendance-card--${attendanceStatus}`} data-status={attendanceStatus}>
        <div className="employee-section-title">
          <div>
            <small><FontAwesomeIcon icon={faClock} /> {copy.attendance}</small>
            <h2>{copy.attendanceEntry}</h2>
          </div>
          <span className="employee-gps-chip"><i aria-hidden="true" /> {copy.gps}</span>
        </div>

        <div className="employee-attendance-console">
          <div className="employee-attendance-side employee-attendance-side--in">
            <span>{copy.checkIn}</span>
            <strong>{checkInTime}</strong>
            <em className={attendance?.checkInAtClient ? "is-done" : ""}>
              {attendance?.checkInAtClient ? copy.checkedIn : copy.notCheckedIn}
            </em>
          </div>

          <div className="employee-punch-control">
            <button
              type="button"
              className={`employee-punch-button employee-punch-button--${punchTone}`}
              onClick={() => void handleAttendancePunch(punchAction)}
              disabled={punchDisabled}
              aria-label={attendanceBusy ? copy.registering : punchLabel}
              aria-describedby="employee-punch-hint"
            >
              <span><FontAwesomeIcon icon={faFingerprint} /></span>
            </button>
            <strong>{attendanceBusy ? `${copy.registering}...` : punchLabel}</strong>
          </div>

          <div className="employee-attendance-side employee-attendance-side--out">
            <span>{copy.checkOut}</span>
            <strong>{checkOutTime}</strong>
            <em className={attendance?.checkOutAtClient ? "is-done" : ""}>
              {attendance?.checkOutAtClient ? copy.checkedOut : copy.notCheckedOut}
            </em>
          </div>
        </div>

        <div className={`employee-attendance-status employee-attendance-status--${attendanceStatus}`} role="status" aria-live="polite">
          <span>
            {attendanceMessage || (
              attendanceLoading
                ? copy.updatingToday
                : attendanceStatus === "checked_out"
                  ? copy.attendanceComplete
                  : attendanceStatus === "checked_in"
                    ? copy.attendanceRecorded
                    : copy.attendanceNotRecorded
            )}
          </span>
        </div>

        <div className="employee-attendance-hint" id="employee-punch-hint">
          {punchHint || (
            attendanceStatus === "checked_in"
              ? copy.punchOutHint
              : attendanceStatus === "checked_out"
                ? copy.completedHint
                : copy.punchInHint
          )}
        </div>

        {shouldShowAttendanceNote && hasAttendanceVerificationMeta ? (
          <div className="employee-attendance-note is-meta-only" aria-label={copy.verificationData}>
            <div>
              {visibleZoneName ? <small>{visibleZoneName}</small> : null}
              {visibleAccuracyLabel ? <small>{visibleAccuracyLabel}</small> : null}
              {visibleDistance !== null ? <small>{copy.distance}: {visibleDistance} {copy.meter}</small> : null}
            </div>
          </div>
        ) : null}
      </section>
      ) : null}

      {canViewOwnTarget ? (
      <section className={`employee-target-home-card employee-target-home-card--${targetCardStatus}`} aria-label={copy.myTarget}>
        <div className="employee-target-home-card__head">
          <span><FontAwesomeIcon icon={faChartLine} /></span>
          <div>
            <small>{copy.myTarget}</small>
            <h2>{copy.targetSubtitle}</h2>
          </div>
          <Link to="/employee/targets">{copy.viewDetails}</Link>
        </div>

        {employeeTargetLoading ? (
          <p className="employee-target-home-card__message">{copy.targetLoading}</p>
        ) : employeeTargetError ? (
          <p className="employee-target-home-card__message">{employeeTargetError}</p>
        ) : !targetHasPlan ? (
          <p className="employee-target-home-card__message">{copy.noTargetPlan}</p>
        ) : (
          <>
            <div className="employee-target-home-card__numbers">
              <div>
                <span>{copy.collectedSales}</span>
                <strong>{formatTargetMoney(targetSales, language)}</strong>
              </div>
              <div>
                <span>{copy.target}</span>
                <strong>{formatTargetMoney(targetAmount, language)}</strong>
              </div>
              <div>
                <span>{copy.currentBonus}</span>
                <strong>{formatTargetMoney(targetSummary?.earnedBonusAmount, language)}</strong>
              </div>
            </div>

            <div className="employee-target-home-progress">
              <span style={{ width: `${Math.min(100, targetProgress * 100)}%` }} />
            </div>

            <div className="employee-target-home-card__foot">
              <strong>{formatTargetPercent(targetProgress, language)}</strong>
              <span>{targetAchievedTier?.tierName || copy.noTier}</span>
              <small>
                {targetNextTier
                  ? `${copy.remaining} ${formatTargetMoney(targetRemaining, language)} ${copy.bonusGoal} ${formatTargetMoney(targetNextTier.bonusAmount, language)}`
                  : copy.topTier}
              </small>
            </div>

            <div className="employee-target-home-card__updated">
              <span>{targetClosed ? copy.payrollClosed : copy.currentPayroll}</span>
              <span>{copy.lastUpdated}: {formatTargetUpdatedAt(employeeTarget?.lastUpdatedAt || targetSummary?.lastUpdatedAt, language, copy)}</span>
            </div>
          </>
        )}
      </section>
      ) : null}

      <section className="employee-overview-block">
        <div className="employee-block-head">
          <h2>{copy.quickActions}</h2>
          <p>{copy.quickActionsSubtitle}</p>
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
          <h2>{copy.hrInfo}</h2>
          <p>{copy.hrInfoSubtitle}</p>
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
          <h2>{copy.upcomingBookings}</h2>
          <p>{copy.upcomingBookingsSubtitle}</p>
        </div>
        <div className="employee-request-list">
          {upcomingBookings.map((booking) => (
            <div key={booking.id} className="employee-request-row">
              <span className={`employee-notification-tone employee-notification-tone--${booking.status === "confirmed" ? "success" : "info"}`}>
                {getBookingStatusLabel(booking.status, copy)}
              </span>
              <div>
                <strong>{cleanText(booking.serviceName || booking.serviceSnapshot?.serviceNameAtBooking || copy.booking)}</strong>
                <small>
                  {cleanText(booking.date) || "-"} | {cleanText(booking.time || booking.startTime) || "-"} | {cleanText(booking.clientName) || copy.client}
                </small>
              </div>
            </div>
          ))}
          {employeeBookingsLoading ? <div className="employee-empty-box">{copy.bookingsLoading}</div> : null}
          {!employeeBookingsLoading && !upcomingBookings.length ? (
            <div className="employee-empty-box">{copy.noBookings}</div>
          ) : null}
        </div>
      </section>

      <section className="employee-overview-block">
        <div className="employee-block-head">
          <h2>{copy.latestRequests}</h2>
          <p>{copy.latestRequestsSubtitle}</p>
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
                {notificationTypeLabel(note.type, language)}
              </span>
              <div>
                <strong>{note.title}</strong>
                <small>{formatNotificationTime(note.createdAt, language)}</small>
              </div>
            </button>
          ))}
          {!latestNotes.length ? <div className="employee-empty-box">{copy.noRequests}</div> : null}
        </div>
      </section>

      <section className="employee-overview-bottom-grid">
        <div className="employee-overview-block">
          <div className="employee-block-head">
            <h2>{copy.remainingBalance}</h2>
            <p>{copy.remainingBalanceSubtitle}</p>
          </div>
          <div className="employee-balance-card">
            <div>
              <span>{copy.leaveBalance}</span>
              <small>
                {employeeLeaveBalanceError ? (language === "en" ? copy.leaveBalanceLoadFailed : employeeLeaveBalanceError) : copy.coreBalance}
              </small>
            </div>
            <strong>{leaveBalanceValue}</strong>
          </div>
        </div>

        <div className="employee-overview-block">
          <div className="employee-block-head">
            <h2>{copy.announcements}</h2>
            <p>{copy.announcementsSubtitle}</p>
          </div>
          <div className="employee-empty-box">
            <FontAwesomeIcon icon={faBell} />
            <span>{copy.noAnnouncements}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
