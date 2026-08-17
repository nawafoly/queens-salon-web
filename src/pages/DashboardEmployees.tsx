// src/pages/DashboardEmployees.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  collection,
  getDocs,
  getDocFromServer,
  getDocsFromServer,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
  query,
  orderBy,
  writeBatch,
} from "firebase/firestore";
import {
  adjustAttendanceDayFromWorker,
  clearAttendanceDayFromWorker,
} from "../services/attendanceWorkerService";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalendarCheck,
  faClock,
  faEnvelope,
  faFileLines,
  faInbox,
  faMoneyBillWave,
  faPlus,
  faRotateRight,
  faScrewdriverWrench,
  faUserTie,
} from "@fortawesome/free-solid-svg-icons";

import { db } from "../services/firebase";
import {
  normalizeLeaveEntryType,
} from "../helpers/hr/leaveBalanceEntry";
import { writeAuditLog } from "../services/logService";
import {
  getEmployeeLeavePolicy,
} from "../helpers/hr/employeeLeave";
import { AppSettingsService } from "../services/AppSettingsService";
import { CoreHrService } from "../services/CoreHrService";
import {
  TEMP_WEEKLY_OFF_SYNC_EVENT,
} from "../services/temporaryWeeklyOffService";
import type {
  CoreHrSchedule,
  CoreResolvedShift,
  CoreScheduleException,
} from "../types/hrCoreApi";
import { createPermissionRequest, reviewPermissionRequest } from "../services/employeePermissionRequests";
import { CoreStaffService } from "../services/CoreStaffService";
import { listWorkZones, type WorkZone } from "../services/attendanceSettingsService";
import {
  getTodayAttendanceDateKey,
  type StaffAttendanceWithId,
} from "../services/firestoreAttendance";
import {
  listAttendanceByDateRangeForEmployeeFromWorker,
} from "../services/attendanceWorkerService";
import {
  createLeaveRequest,
  createEmployeeNotification,
  listEmployeeLeaveRequests,
  type EmployeeLeaveRequest,
} from "../services/employeeHub";
import { decideCanonicalEmployeeLeaveRequest } from "../services/canonicalEmployeeLeaveRequests";
import { isRemovedFromStaffRecord } from "../services/staffAccountLinkService";
import { archiveEmployee } from "../services/employeeLifecycleService";
import { CoreAccountService } from "../services/CoreAccountService";
import AttendanceSection from "./dashboardEmployees/AttendanceSection";
import BasicInfoSection from "./dashboardEmployees/BasicInfoSection";
import BookingSettingsSection from "./dashboardEmployees/BookingSettingsSection";
import EmployeeDetailShell from "./dashboardEmployees/EmployeeDetailShell";
import EmployeeEditorModal from "./dashboardEmployees/EmployeeEditorModal";
import EmployeeProfilePageLayout from "./dashboardEmployees/EmployeeProfilePageLayout";
import EmployeeListPanel from "./dashboardEmployees/EmployeeListPanel";
import EmployeeFilesSection from "./dashboardEmployees/EmployeeFilesSection";
import EmployeeMessagesSection from "./dashboardEmployees/EmployeeMessagesSection";
import EmployeeRequestsSection from "./dashboardEmployees/EmployeeRequestsSection";
import EmployeeStatsSection from "./dashboardEmployees/EmployeeStatsSection";
import ProfileSection from "./dashboardEmployees/ProfileSection";
import ScheduleSummarySection from "./dashboardEmployees/ScheduleSummarySection";
import ServicesSection from "./dashboardEmployees/ServicesSection";
import ShiftControlSection from "./dashboardEmployees/ShiftControlSection";
import { usePermissions } from "../security/PermissionContext";
import {
  DashboardConfirmV2,
  DashboardFieldV2,
  DashboardModalV2,
} from "../components/dashboard-v2";
import LeaveRequestModal from "../components/LeaveRequestModal";

// ✅ Bookings stats (Owner only)
import {
  listBookings,
  type BookingDocWithId,
  type BookingStatus,
} from "../services/firestoreBookings";
import {
  buildApprovedLeaveDateKeys,
  leaveRequestMatchesProfile,
} from "../helpers/hr/attendanceCalendarData";

import {
  normalizePayrollConfig,
  type StaffPayrollMethod,
  type StaffOvertimeHoursBasis,
} from "../helpers/hr/payrollProfileConfig";
import {
  PAYROLL_CLOSE_DAY,
  payrollCycleKeyFromDate,
} from "../helpers/hr/payrollCycle";
import {
  generatePayrollEntriesForMonths,
} from "../services/CorePayrollService";

import {
  DEFAULT_CLOSE_TIME,
  DEFAULT_OPEN_TIME,
  REVENUE_STATUSES,
  SALON_ID,
  STAFF_IMAGE_OPTIONS,
  WEEKDAY_OPTIONS,
  addDaysIso,
  bookingAmountOf,
  buildHijriMonthDays,
  buildWorkingHourOverrideGroups,
  canonicalizeSpecialties,
  countIsoDateRangeDays,
  createDefaultWorkingHours,
  currentMonthKey,
  durationHours,
  findHijriMonthStartIso,
  fmtIsoDate,
  fmtIsoDateHijri,
  fmtMoneySar,
  formatHijriInputFromIso,
  formatArabicInteger,
  formatDailyHourBucketsLabel,
  formatIsoDateRange,
  formatIsoDateRangeByCalendar,
  formatIsoDateRangeDual,
  formatWindow,
  getAuthUser,
  hijriPartsFromIso,
  hijriWeekdayColumnFromIso,
  intersectTimeWindows,
  isAdministrativeStaffRecord,
  isTimeInsideWindow,
  isoFromHijriDateParts,
  minutesToHHMM,
  monthKey,
  normalizeArabicName,
  normalizeExceptionalLeaveDates,
  normalizeExceptionalLeaveWeekdays,
  normalizeLeaveUntil,
  normalizeSpecialties,
  normalizeTimeHHMM,
  normalizeWeekdayKey,
  normalizeWorkingHourOverrides,
  normalizeWorkingHours,
  parseHijriDateInput,
  parsePositiveInt,
  pickAvatarUrl,
  readBookingHourOverrides,
  resolveAvatarFromAssets,
  safeKey,
  safeNonNegativeNumber,
  servicesCol,
  shiftHijriMonthStartIso,
  staffPublicCol,
  staffPublicDoc,
  toArabicSectionLabel,
  toComparableTimestamp,
  toFirestoreErrorMessage,
  toHijriMonthYearLabel,
  todayIso,
  toMinutes,
  usersCol,
  weekdayFromIso,
  type AuthUser,
  type BookingHourOverride,
  type BookingHourOverrideMode,
  type DateCalendar,
  type EmployeeModalTab,
  type EmployeeMode,
  type EmployeeSplitTab,
  type HijriDateParts,
  type LeaveEntry,
  type ServiceOption,
  type StaffBookingStats,
  type StaffPublicDoc,
  type StaffPublicUi,
  type StaffWorkingDay,
  type StaffWorkingHourOverride,
  type StaffWorkingHourOverrideGroup,
  type SummarySourceGroup,
  type WeekdayKey,
  type WorkingHourOverrideApplyMethod,
  type WorkingHourOverrideMode,
  type WorkingHourOverrideQuickMode,
} from "./dashboardEmployees/shared";

function cleanText(value: unknown) {
  return String(value || "").trim();
}

const CORE_WEEKDAY_NUMBER: Record<WeekdayKey, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

function emptyCoreScheduleEditorRows():
  Record<WeekdayKey, StaffWorkingDay> {
  return WEEKDAY_OPTIONS.reduce(
    (rows, day) => {
      rows[day.key] = {
        enabled: false,
        shiftTemplateId: "",
        shiftName: "",
        start: "",
        end: "",
      };

      return rows;
    },
    {} as Record<
      WeekdayKey,
      StaffWorkingDay
    >
  );
}

function coreScheduleIsActive(
  value: unknown
) {
  if (
    value === true ||
    value === 1
  ) {
    return true;
  }

  const text =
    String(value ?? "")
      .trim()
      .toLowerCase();

  return (
    text === "true" ||
    text === "1"
  );
}

function coreScheduleDate(
  value: unknown
) {
  const text =
    cleanText(value);

  return /^\d{4}-\d{2}-\d{2}$/.test(
    text
  )
    ? text
    : "";
}

function resolveCoreScheduleEditorRows(
  schedules: readonly CoreHrSchedule[],
  targetDateValue: string
): Record<WeekdayKey, StaffWorkingDay> {
  const targetDate =
    coreScheduleDate(
      targetDateValue
    ) ||
    todayIso();

  const rows =
    emptyCoreScheduleEditorRows();

  for (
    const day of WEEKDAY_OPTIONS
  ) {
    const weekday =
      CORE_WEEKDAY_NUMBER[
        day.key
      ];

    const schedule =
      schedules
        .filter((row) => {
          if (
            Number(row.weekday) !==
            weekday
          ) {
            return false;
          }

          const from =
            coreScheduleDate(
              row.effectiveFrom
            );

          const to =
            coreScheduleDate(
              row.effectiveTo
            );

          if (
            from &&
            targetDate < from
          ) {
            return false;
          }

          if (
            to &&
            targetDate > to
          ) {
            return false;
          }

          return true;
        })
        .sort((left, right) =>
          coreScheduleDate(
            right.effectiveFrom
          ).localeCompare(
            coreScheduleDate(
              left.effectiveFrom
            )
          )
        )[0] ||
      null;

    if (
      !schedule ||
      !coreScheduleIsActive(
        schedule.active
      )
    ) {
      rows[day.key] = {
        enabled: false,
        shiftTemplateId: "",
        shiftName: "",
        start: "",
        end: "",
      };

      continue;
    }

    rows[day.key] = {
      enabled: true,

      shiftTemplateId:
        cleanText(
          schedule.shiftTemplateId
        ),

      shiftName:
        cleanText(
          schedule.shiftName
        ),

      start:
        normalizeTimeHHMM(
          schedule.templateStartTime ||
          schedule.startTime
        ),

      end:
        normalizeTimeHHMM(
          schedule.templateEndTime ||
          schedule.endTime
        ),
    };
  }

  return rows;
}

function coreScheduleEditorRowsEqual(
  left:
    | Record<
        WeekdayKey,
        StaffWorkingDay
      >
    | null
    | undefined,

  right:
    | Record<
        WeekdayKey,
        StaffWorkingDay
      >
    | null
    | undefined
) {
  const normalize = (
    rows:
      | Record<
          WeekdayKey,
          StaffWorkingDay
        >
      | null
      | undefined
  ) =>
    WEEKDAY_OPTIONS.map(
      (day) => {
        const row =
          rows?.[day.key];

        const enabled =
          row?.enabled !== false;

        return {
          weekday: day.key,
          enabled,

          shiftTemplateId:
            enabled
              ? cleanText(
                  row?.shiftTemplateId
                )
              : "",
        };
      }
    );

  return (
    JSON.stringify(
      normalize(left)
    ) ===
    JSON.stringify(
      normalize(right)
    )
  );
}

function countCoreScheduleVersions(
  schedules:
    readonly CoreHrSchedule[]
) {
  return new Set(
    schedules.map(
      (row) =>
        coreScheduleDate(
          row.effectiveFrom
        ) ||
        "baseline"
    )
  ).size;
}

type ManagedLeaveType = "annual" | "sick" | "emergency" | "unpaid" | "rest" | "other";

const MANAGED_LEAVE_TYPES = new Set<ManagedLeaveType>([
  "annual",
  "sick",
  "emergency",
  "unpaid",
  "rest",
  "other",
]);

function normalizeManagedLeaveType(value: unknown): ManagedLeaveType {
  const type = cleanText(value).toLowerCase() as ManagedLeaveType;
  return MANAGED_LEAVE_TYPES.has(type) ? type : "annual";
}

function inclusiveLeaveDays(fromDate: string, toDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) return 0;
  const from = new Date(`${fromDate}T12:00:00.000Z`).getTime();
  const to = new Date(`${toDate}T12:00:00.000Z`).getTime();
  const days = Math.floor((to - from) / 86400000) + 1;
  return Number.isFinite(days) && days > 0 ? days : 0;
}

function managedLeavePolicy(type: ManagedLeaveType) {
  return {
    deductFromBalance: type === "annual" || type === "sick" || type === "emergency",
    affectsPayroll: type === "unpaid",
  };
}

function positiveNumberOrZero(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : 0;
}

function positiveInputString(value: unknown) {
  const number = positiveNumberOrZero(value);
  return number > 0 ? String(number) : "";
}

function booleanSetting(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function payrollDeductionMethodSetting(value: unknown): "hourly" | "daily" {
  return cleanText(value).toLowerCase() === "daily" ? "daily" : "hourly";
}

function roundPayrollNumber(value: number) {
  return Math.round(value * 100) / 100;
}

function riyalsInputToHalalas(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) : 0;
}

function toDateTimeLocalValue(value: unknown) {
  const raw = cleanText(value);
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function dateTimeLocalToIso(value: string) {
  const clean = cleanText(value);
  if (!clean) return "";
  const date = new Date(clean);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function uniqueCleanTexts(values: unknown[]) {
  return Array.from(
    new Set(values.map(cleanText).filter(Boolean))
  );
}

function isFullAttendanceIdentifier(value: unknown) {
  return /^[A-Za-z0-9_-]{20,}$/.test(cleanText(value));
}

function attendanceDebug(...args: unknown[]) {
  if (!(import.meta as any).env?.DEV) return;
  console.info("[attendance-debug]", ...args);
}

function employeeSaveDebug(step: string, details?: Record<string, unknown>) {
  if (!(import.meta as any).env?.DEV) return;
  if (details) {
    console.info(`[employee-save] ${step}`, details);
    return;
  }
  console.info(`[employee-save] ${step}`);
}

function resolveEmployeeAttendanceIdentity(
  profile: Partial<StaffPublicUi> | Record<string, any> | null | undefined,
  selectedEmployeeId = ""
) {
  const source = profile || {};
  const uidCandidates = uniqueCleanTexts([
    (source as any).employeeUid,
    (source as any).linkedUid,
    (source as any).authUid,
    (source as any).uid,
    (source as any).userId,
    (source as any).linkedUserId,
    (source as any).employeeDocId,
    (source as any).linkedEmployeeDocId,
    (source as any).employeeId,
    (source as any).id,
    selectedEmployeeId,
    (source as any).employeeKey,
  ]);
  const docCandidates = uniqueCleanTexts([
    (source as any).employeeDocId,
    (source as any).linkedEmployeeDocId,
    (source as any).employeeId,
    (source as any).id,
    selectedEmployeeId,
    (source as any).employeeUid,
    (source as any).linkedUid,
    (source as any).authUid,
    (source as any).uid,
    (source as any).linkedUserId,
  ]);
  const fullUid = uidCandidates.find(isFullAttendanceIdentifier) || "";
  const fullDocId = docCandidates.find(isFullAttendanceIdentifier) || "";
  const employeeUid =
    fullUid || fullDocId || uidCandidates[0] || docCandidates[0] || "";
  const employeeDocId =
    fullDocId || fullUid || docCandidates[0] || employeeUid;

  return {
    employeeUid,
    employeeDocId,
    allIds: uniqueCleanTexts([
      ...uidCandidates,
      ...docCandidates,
      employeeUid,
      employeeDocId,
    ]),
  };
}

const EMPLOYEE_BOOKING_STATS_CACHE_TTL_MS = 5 * 60 * 1000;
let employeeBookingStatsCache:
  | {
      staffSignature: string;
      stats: Record<string, StaffBookingStats>;
      savedAt: number;
    }
  | null = null;

function resolveStaffNotificationTarget(staff?: StaffPublicUi | null) {
  const targetUid = cleanText((staff as any)?.linkedUid || (staff as any)?.uid || (staff as any)?.linkedUserId || "");
  return {
    targetUid,
    targetEmployeeId: targetUid || cleanText(staff?.id || ""),
  };
}

type EmployeeIdentity = {
  id: string;
  linkedUid: string;
  employeeId: string;
  email: string;
  name: string;
};

function employeeLinkedUidValues(staff: Partial<StaffPublicUi> | Record<string, unknown>) {
  return uniqueCleanTexts([
    (staff as any)?.linkedUid,
    (staff as any)?.employeeUid,
    (staff as any)?.authUid,
    (staff as any)?.uid,
    (staff as any)?.userId,
    (staff as any)?.linkedUserId,
  ]);
}

function employeeExplicitDocIdValues(staff: Partial<StaffPublicUi> | Record<string, unknown>) {
  return uniqueCleanTexts([
    (staff as any)?.staffPublicDocId,
    (staff as any)?.employeeDocId,
    (staff as any)?.linkedEmployeeDocId,
    (staff as any)?.employeeId,
  ]);
}

function employeeSourceDocIdOf(staff: Partial<StaffPublicUi>, rawDocId = "") {
  return cleanText(rawDocId || (staff as any)?.sourceDocId || staff?.id);
}

function employeeCanonicalDocIdOf(staff: Partial<StaffPublicUi> | Record<string, unknown>, rawDocId = "") {
  const sourceDocId = cleanText(rawDocId || (staff as any)?.sourceDocId || (staff as any)?.id);
  const linkedUidSet = new Set(employeeLinkedUidValues(staff));
  const explicitDocIds = employeeExplicitDocIdValues(staff);
  const explicitCanonicalDocId =
    explicitDocIds.find((value) => !linkedUidSet.has(value)) ||
    explicitDocIds[0] ||
    "";
  const source = cleanText((staff as any)?.source);
  const sourceDocIsLinkedUid = !!sourceDocId && linkedUidSet.has(sourceDocId);

  if (source === "staff_public" || cleanText((staff as any)?.staffPublicDocId)) {
    return sourceDocId && !sourceDocIsLinkedUid
      ? sourceDocId
      : explicitCanonicalDocId || sourceDocId || cleanText((staff as any)?.id);
  }

  return (
    explicitCanonicalDocId ||
    (sourceDocId && !sourceDocIsLinkedUid ? sourceDocId : "") ||
    cleanText((staff as any)?.id || sourceDocId)
  );
}

function employeeIdentityOf(staff?: Partial<StaffPublicUi> | null): EmployeeIdentity {
  const canonicalDocId = employeeCanonicalDocIdOf(staff || {});
  return {
    id: canonicalDocId,
    linkedUid: employeeLinkedUidValues(staff || {})[0] || "",
    employeeId: canonicalDocId,
    email: cleanText((staff as any)?.email).toLowerCase(),
    name: cleanText(
      (staff as any)?.name ||
        (staff as any)?.displayName ||
        (staff as any)?.fullName
    ).toLowerCase(),
  };
}

function employeeIdentityValues(staff: Partial<StaffPublicUi>, rawDocId = "") {
  return uniqueCleanTexts([
    staff.id,
    rawDocId,
    (staff as any)?.sourceDocId,
    (staff as any)?.staffPublicDocId,
    (staff as any)?.employeeDocId,
    (staff as any)?.linkedEmployeeDocId,
    (staff as any)?.employeeId,
    ...((Array.isArray((staff as any)?.legacyEmployeeIds)
      ? (staff as any).legacyEmployeeIds
      : []) as unknown[]),
    (staff as any)?.linkedUid,
    (staff as any)?.employeeUid,
    (staff as any)?.authUid,
    (staff as any)?.uid,
    (staff as any)?.userId,
    (staff as any)?.linkedUserId,
  ]);
}

function employeeMatchesIdentity(staff: Partial<StaffPublicUi>, identity: EmployeeIdentity | null) {
  if (!identity) return false;

  const current = employeeIdentityOf(staff);
  const currentValues = new Set(employeeIdentityValues(staff).map((value) => value.toLowerCase()));

  const hasStableIdentity =
    !!identity.id ||
    !!identity.linkedUid ||
    !!identity.employeeId;

  if (hasStableIdentity) {
    return (
      (!!identity.id && current.id === identity.id) ||
      (!!identity.id && currentValues.has(identity.id.toLowerCase())) ||
      (!!identity.linkedUid && current.linkedUid === identity.linkedUid) ||
      (!!identity.linkedUid && currentValues.has(identity.linkedUid.toLowerCase())) ||
      (!!identity.employeeId && current.employeeId === identity.employeeId) ||
      (!!identity.employeeId && currentValues.has(identity.employeeId.toLowerCase()))
    );
  }

  return (
    (!!identity.email && current.email === identity.email) ||
    (!!identity.name && current.name === identity.name)
  );
}

function employeeMatchesRouteId(staff: Partial<StaffPublicUi>, routeId: string) {
  const needle = cleanText(routeId).toLowerCase();
  if (!needle) return false;
  const current = employeeIdentityOf(staff);
  return [
    current.id,
    current.linkedUid,
    current.employeeId,
    ...employeeIdentityValues(staff),
    current.email,
    current.name,
  ]
    .filter(Boolean)
    .some((value) => value.toLowerCase() === needle);
}

function employeeIdentityKeys(staff: Partial<StaffPublicUi>, rawDocId = "") {
  const identity = employeeIdentityOf(staff);

  const stableKeys = [
    identity.id ? `id:${identity.id}` : "",
    identity.linkedUid ? `uid:${identity.linkedUid}` : "",
    identity.employeeId ? `employee:${identity.employeeId}` : "",
    rawDocId ? `doc:${cleanText(rawDocId)}` : "",
    ...employeeIdentityValues(staff, rawDocId).map((value) => `identity:${value}`),
  ].filter(Boolean);

  if (stableKeys.length > 0) {
    return Array.from(new Set(stableKeys));
  }

  return Array.from(
    new Set(
      [
        identity.email ? `email:${identity.email}` : "",
        identity.name ? `name:${identity.name}` : "",
      ].filter(Boolean)
    )
  );
}

function mergeEmployeeRows(primary: StaffPublicUi, fallback: StaffPublicUi): StaffPublicUi {
  const primaryIsStaffPublic = primary.source === "staff_public";
  const hasPrimaryField = (field: keyof StaffPublicDoc) =>
    Object.prototype.hasOwnProperty.call(primary as any, field) &&
    (primary as any)?.[field] !== undefined &&
    (primary as any)?.[field] !== null;
  const pickEditableText = (field: keyof StaffPublicDoc) => {
    const value = primaryIsStaffPublic && hasPrimaryField(field)
      ? (primary as any)?.[field]
      : (primary as any)?.[field] ?? (fallback as any)?.[field];
    return cleanText(value);
  };
  const pickEditableBoolean = (field: keyof StaffPublicDoc, defaultValue: boolean) => {
    const value = primaryIsStaffPublic && hasPrimaryField(field)
      ? (primary as any)?.[field]
      : (primary as any)?.[field] ?? (fallback as any)?.[field];
    if (value === undefined || value === null || value === "") return defaultValue;
    return !(value === false || value === 0 || value === "false" || value === "0");
  };
  const pickEditableNumber = (field: keyof StaffPublicDoc) => {
    const value = primaryIsStaffPublic && hasPrimaryField(field)
      ? (primary as any)?.[field]
      : (primary as any)?.[field] ?? (fallback as any)?.[field];
    return safeNonNegativeNumber(value, 0);
  };
  const pickEditableArray = <T,>(
    field: keyof StaffPublicDoc,
    normalize: (value: unknown) => T[]
  ): T[] => {
    if (primaryIsStaffPublic && !hasPrimaryField(field)) {
      return normalize((fallback as any)?.[field]);
    }
    const primaryValue = normalize((primary as any)?.[field]);
    if (primaryIsStaffPublic) return primaryValue;
    return primaryValue.length > 0 ? primaryValue : normalize((fallback as any)?.[field]);
  };
  const linkedUid = cleanText(
    (primary as any)?.linkedUid ||
      (primary as any)?.employeeUid ||
      (primary as any)?.authUid ||
      (primary as any)?.uid ||
      (primary as any)?.userId ||
      (primary as any)?.linkedUserId ||
      (fallback as any)?.linkedUid ||
      (fallback as any)?.employeeUid ||
      (fallback as any)?.authUid ||
      (fallback as any)?.uid ||
      (fallback as any)?.userId ||
      (fallback as any)?.linkedUserId
  );
  const primaryCanonicalDocId = employeeCanonicalDocIdOf(primary);
  const fallbackCanonicalDocId = employeeCanonicalDocIdOf(fallback);
  const staffPublicDocId = cleanText(
    primaryCanonicalDocId ||
      fallbackCanonicalDocId ||
      (primary as any)?.staffPublicDocId ||
      (fallback as any)?.staffPublicDocId
  );
  const sourceDocId = cleanText((primary as any)?.sourceDocId || (fallback as any)?.sourceDocId);
  const canonicalEmployeeId = cleanText(staffPublicDocId || primary.id || fallback.id);

  return {
    ...fallback,
    ...primary,
    id: canonicalEmployeeId,
    sourceDocId,
    staffPublicDocId,
    legacyEmployeeIds: uniqueCleanTexts([
      ...(((fallback as any)?.legacyEmployeeIds || []) as unknown[]),
      ...(((primary as any)?.legacyEmployeeIds || []) as unknown[]),
      (fallback as any)?.employeeDocId,
      (fallback as any)?.linkedEmployeeDocId,
      (fallback as any)?.employeeId,
      (primary as any)?.employeeDocId,
      (primary as any)?.linkedEmployeeDocId,
      (primary as any)?.employeeId,
    ]).filter((value) => value !== canonicalEmployeeId),
    uid: cleanText(
      (primary as any)?.uid ||
        (primary as any)?.authUid ||
        (primary as any)?.employeeUid ||
        linkedUid ||
        (fallback as any)?.uid
    ),
    linkedUid,
    linkedUserId: cleanText(
      (primary as any)?.linkedUserId ||
        linkedUid ||
        (fallback as any)?.linkedUserId
    ),
    authUid: cleanText(
      (primary as any)?.authUid ||
        (fallback as any)?.authUid
    ),
    userId: cleanText(
      (primary as any)?.userId ||
        (fallback as any)?.userId
    ),
    employeeUid: cleanText(
      (primary as any)?.employeeUid ||
        linkedUid ||
        (fallback as any)?.employeeUid
    ),
    employeeDocId: cleanText(
      canonicalEmployeeId
    ),
    linkedEmployeeDocId: cleanText(
      canonicalEmployeeId ||
        (primary as any)?.linkedEmployeeDocId ||
        (fallback as any)?.linkedEmployeeDocId
    ),
    employeeId: cleanText(
      canonicalEmployeeId
    ),
    name: pickEditableText("name") || cleanText(fallback.name),
    email: cleanText(primary.email || fallback.email),
    phone: cleanText(primary.phone || fallback.phone),
    department: cleanText(primary.department || fallback.department),
    title: cleanText(primary.title || fallback.title),
    employmentSource: cleanText(primary.employmentSource || fallback.employmentSource || "salon"),
    partnerId: cleanText(primary.partnerId || fallback.partnerId),
    partnerMemberId: cleanText(primary.partnerMemberId || fallback.partnerMemberId),
    partnerName: cleanText(primary.partnerName || fallback.partnerName),
    contractId: cleanText(primary.contractId || fallback.contractId),
    resourceIds:
      Array.isArray(primary.resourceIds) && primary.resourceIds.length
        ? primary.resourceIds
        : fallback.resourceIds,
    active: pickEditableBoolean("active", true),
    showOnAbout: pickEditableBoolean("showOnAbout", false),
    showOnBooking: pickEditableBoolean("showOnBooking", false),
    includeInEmployeeManagement: pickEditableBoolean("includeInEmployeeManagement", true),
    bio: pickEditableText("bio"),
    avatarUrl: pickEditableText("avatarUrl"),
    cvUrl: pickEditableText("cvUrl"),
    rating: pickEditableNumber("rating"),
    reviewsCount: Math.floor(pickEditableNumber("reviewsCount")),
    specialties: pickEditableArray("specialties", normalizeSpecialties),
    employmentEndDate: pickEditableText("employmentEndDate"),

    allowedAttendanceZoneId: pickEditableText("allowedAttendanceZoneId"),
    attendanceZoneId: pickEditableText("attendanceZoneId"),
    attendanceScopeId: pickEditableText("attendanceScopeId"),
    assignedAttendanceZoneId: pickEditableText("assignedAttendanceZoneId"),
    allowedZoneIds: pickEditableArray("allowedZoneIds", (value) =>
      Array.isArray(value) ? value.map(cleanText).filter(Boolean) : []
    ),
    monthlySalary: pickEditableNumber("monthlySalary"),
    payrollMonthlyHours: pickEditableNumber("payrollMonthlyHours"),
    payrollOvertimeEnabled: pickEditableBoolean("payrollOvertimeEnabled", false),
    payrollOvertimeMultiplier: pickEditableNumber("payrollOvertimeMultiplier") || 1.5,
    payrollDeductionMethod: pickEditableText("payrollDeductionMethod"),
    overtimeMethod: pickEditableText("overtimeMethod") as StaffPayrollMethod,
    overtimeDaysPerMonth: pickEditableNumber("overtimeDaysPerMonth"),
    overtimeBaseHoursPerDay: pickEditableNumber("overtimeBaseHoursPerDay"),
    overtimeSeasonBaseHoursPerDay: pickEditableNumber("overtimeSeasonBaseHoursPerDay"),
    overtimeHoursBasis: pickEditableText("overtimeHoursBasis") as StaffOvertimeHoursBasis,
    overtimePercent: pickEditableNumber("overtimePercent"),
    overtimeInvoicePercent: pickEditableNumber("overtimeInvoicePercent"),
    profileIncomplete:
      primary.source !== "staff_public" && fallback.source !== "staff_public",
  };
}

type EmployeeLoadOptions = {
  fromServer?: boolean;
  strict?: boolean;
};

const EMPLOYEE_SOURCE_PRIORITY: Record<string, number> = {
  core_accounts: 1,
  users: 2,
  employees: 3,
  staff_public: 4,
};

function employeeSourcePriority(source: unknown) {
  return EMPLOYEE_SOURCE_PRIORITY[cleanText(source) || "users"] || 0;
}

function employeeRowUpdatedAtMs(row: Partial<StaffPublicUi>) {
  return toComparableTimestamp((row as any)?.updatedAt);
}

function employeeCanonicalDocScore(row: Partial<StaffPublicUi>) {
  const canonicalDocId = employeeCanonicalDocIdOf(row);
  const sourceDocId = employeeSourceDocIdOf(row);
  const employeeIds = new Set(employeeExplicitDocIdValues(row));
  const linkedUidValues = new Set(employeeLinkedUidValues(row));

  const docMatchesLinkedUid = !!sourceDocId && linkedUidValues.has(sourceDocId);
  const canonicalMatchesLinkedUid = !!canonicalDocId && linkedUidValues.has(canonicalDocId);
  let score = 0;
  if (canonicalDocId) score += 4;
  if (cleanText((row as any)?.staffPublicDocId)) score += 4;
  if (sourceDocId && canonicalDocId && sourceDocId === canonicalDocId) score += 40;
  if (canonicalDocId && cleanText(row.id) === canonicalDocId) score += 12;
  if (canonicalDocId && employeeIds.has(canonicalDocId)) score += canonicalMatchesLinkedUid ? 2 : 10;
  if (docMatchesLinkedUid) score -= 30;
  if (canonicalMatchesLinkedUid) score -= 10;
  return score;
}

function pickEmployeeMergeRows(existing: StaffPublicUi, incoming: StaffPublicUi) {
  const existingPriority = employeeSourcePriority(existing.source);
  const incomingPriority = employeeSourcePriority(incoming.source);
  if (incomingPriority !== existingPriority) {
    return incomingPriority > existingPriority
      ? { primary: incoming, fallback: existing }
      : { primary: existing, fallback: incoming };
  }

  const existingCanonicalScore = employeeCanonicalDocScore(existing);
  const incomingCanonicalScore = employeeCanonicalDocScore(incoming);
  if (incomingCanonicalScore !== existingCanonicalScore) {
    return incomingCanonicalScore > existingCanonicalScore
      ? { primary: incoming, fallback: existing }
      : { primary: existing, fallback: incoming };
  }

  const existingUpdatedAt = employeeRowUpdatedAtMs(existing);
  const incomingUpdatedAt = employeeRowUpdatedAtMs(incoming);
  if (incomingUpdatedAt !== existingUpdatedAt) {
    return incomingUpdatedAt > existingUpdatedAt
      ? { primary: incoming, fallback: existing }
      : { primary: existing, fallback: incoming };
  }

  return { primary: existing, fallback: incoming };
}

function savedEmployeeReloadScore(row: StaffPublicUi, targetEmployeeId: string) {
  const target = cleanText(targetEmployeeId);
  let score = employeeSourcePriority(row.source);
  const sourceDocId = employeeSourceDocIdOf(row);
  const canonicalDocId = employeeCanonicalDocIdOf(row);
  if (target && sourceDocId === target && row.source === "staff_public") score += 1000;
  if (target && canonicalDocId === target) score += 600;
  if (target && cleanText((row as any).staffPublicDocId) === target) score += 400;
  if (target && cleanText(row.id) === target) score += 250;
  if (target && cleanText((row as any).employeeDocId) === target) score += 150;
  if (target && cleanText((row as any).employeeId) === target) score += 100;
  if (row.source === "staff_public") score += 50;
  score += employeeCanonicalDocScore(row);
  score += Math.min(employeeRowUpdatedAtMs(row) / 10000000000000, 1);
  return score;
}

function findSavedEmployeeReloadRow(
  rows: StaffPublicUi[],
  targetEmployeeId: string,
  identity: EmployeeIdentity | null
) {
  const target = cleanText(targetEmployeeId);
  const matches = rows.filter(
    (row) =>
      (!!target && (row.id === target || employeeMatchesRouteId(row, target))) ||
      employeeMatchesIdentity(row, identity)
  );
  return (
    matches.sort(
      (left, right) =>
        savedEmployeeReloadScore(right, target) -
        savedEmployeeReloadScore(left, target)
    )[0] || null
  );
}

function employeeVerificationAttendanceZoneId(staffLike: any): string {
  const employment = staffLike?.employeeProfile?.employment || staffLike?.employment || {};
  const allowedZoneIds = Array.isArray(employment?.allowedZoneIds)
    ? employment.allowedZoneIds
    : Array.isArray(staffLike?.allowedZoneIds)
      ? staffLike.allowedZoneIds
      : [];
  return cleanText(
    staffLike?.allowedAttendanceZoneId ||
      staffLike?.attendanceZoneId ||
      staffLike?.assignedAttendanceZoneId ||
      staffLike?.attendanceScopeId ||
      employment?.allowedAttendanceZoneId ||
      employment?.attendanceZoneId ||
      employment?.assignedAttendanceZoneId ||
      employment?.attendanceScopeId ||
      allowedZoneIds[0]
  );
}

function employeeVerificationAllowedZoneIds(staffLike: any) {
  const employment = staffLike?.employeeProfile?.employment || staffLike?.employment || {};
  const values = [
    ...(Array.isArray(staffLike?.allowedZoneIds) ? staffLike.allowedZoneIds : []),
    ...(Array.isArray(employment?.allowedZoneIds) ? employment.allowedZoneIds : []),
    employeeVerificationAttendanceZoneId(staffLike),
  ];
  return uniqueCleanTexts(values).sort((a, b) => a.localeCompare(b));
}

function employeeVerificationSpecialties(value: unknown, options: ServiceOption[]) {
  return canonicalizeSpecialties(value, options).slice().sort((a, b) => a.localeCompare(b));
}

function sortedWeekdayKeys(value: unknown) {
  return normalizeExceptionalLeaveWeekdays(value).slice().sort((a, b) => a.localeCompare(b));
}


function coreScheduleExceptionIsApproved(
  row: CoreScheduleException
) {
  return (
    cleanText(row?.status)
      .toLowerCase() ===
    "approved"
  );
}

function projectCoreScheduleExceptionsToOverrides(
  rows: CoreScheduleException[]
): StaffWorkingHourOverride[] {
  const projected =
    new Map<
      string,
      StaffWorkingHourOverride
    >();

  const operationalRows =
    (Array.isArray(rows)
      ? rows
      : []
    )
      .filter(
        (row) => {
          const type =
            cleanText(
              row?.exceptionType
            ).toLowerCase();

          return (
            coreScheduleExceptionIsApproved(
              row
            ) &&
            (
              type === "custom" ||
              type === "off"
            )
          );
        }
      )
      .slice()
      .sort(
        (left, right) =>
          cleanText(
            left.createdAt
          ).localeCompare(
            cleanText(
              right.createdAt
            )
          )
      );

  for (
    const row of operationalRows
  ) {
    const type =
      cleanText(
        row.exceptionType
      ).toLowerCase();

    const from =
      coreScheduleDate(
        row.dateFrom
      );

    const to =
      coreScheduleDate(
        row.dateTo
      ) ||
      from;

    if (
      !from ||
      !to ||
      to < from
    ) {
      continue;
    }

    const enabled =
      type !== "off" &&
      (
        row.enabled === true ||
        row.enabled === 1
      );

    const start =
      normalizeTimeHHMM(
        row.startTime
      ) ||
      "10:00";

    const end =
      normalizeTimeHHMM(
        row.endTime
      ) ||
      "22:00";

    const note =
      cleanText(
        row.note
      );

    let cursor =
      from;

    let guard =
      0;

    while (
      cursor &&
      cursor <= to
    ) {
      projected.set(
        cursor,
        {
          date:
            cursor,

          enabled,

          start,

          end,

          ...(note
            ? {
                note,
              }
            : {}),
        }
      );

      cursor =
        addDaysIso(
          cursor,
          1
        );

      guard += 1;

      if (
        guard > 730
      ) {
        break;
      }
    }
  }

  return normalizeWorkingHourOverrides(
    Array.from(
      projected.values()
    )
  );
}


function workingHourOverridesEqual(
  left: StaffWorkingHourOverride[],
  right: StaffWorkingHourOverride[]
) {
  return (
    JSON.stringify(
      normalizeWorkingHourOverrides(left)
    ) ===
    JSON.stringify(
      normalizeWorkingHourOverrides(right)
    )
  );
}

type EmployeeSaveVerificationSnapshot = Record<string, unknown>;

function buildEmployeeSaveVerificationSnapshot(
  staffLike: Partial<StaffPublicDoc> | Partial<StaffPublicUi>,
  serviceOptions: ServiceOption[]
): EmployeeSaveVerificationSnapshot {
  const staff = staffLike as any;
  return {
    name: cleanText(staff.name),
    active: staff.active === true,
    showOnAbout: staff.showOnAbout === true,
    showOnBooking: staff.showOnBooking === true,
    includeInEmployeeManagement: staff.includeInEmployeeManagement === true,
    avatarUrl: resolveAvatarFromAssets(pickAvatarUrl(staff)),
    bio: cleanText(staff.bio),
    cvUrl: cleanText(staff.cvUrl),
    rating: Math.min(5, safeNonNegativeNumber(staff.rating, 0)),
    reviewsCount: Math.floor(safeNonNegativeNumber(staff.reviewsCount || staff.reviewCount, 0)),
    specialties: employeeVerificationSpecialties(staff.specialties, serviceOptions),
    employmentEndDate: normalizeLeaveUntil(staff.employmentEndDate),
    onLeave: staff.onLeave === true,
    leaveStartDate: normalizeLeaveUntil(staff.leaveStartDate),
    leaveUntil: normalizeLeaveUntil(staff.leaveUntil),
    leaveType: normalizeManagedLeaveType(staff.leaveType),
    leaveNote: cleanText(staff.leaveNote),
    exceptionalLeaveDates: normalizeExceptionalLeaveDates(staff.exceptionalLeaveDates),
    attendanceZoneId: employeeVerificationAttendanceZoneId(staff),
    allowedZoneIds: employeeVerificationAllowedZoneIds(staff),
    monthlySalary: safeNonNegativeNumber(staff.monthlySalary, 0),
    payrollMonthlyHours: safeNonNegativeNumber(staff.payrollMonthlyHours, 0),
    payrollOvertimeEnabled: staff.payrollOvertimeEnabled === true,
    payrollOvertimeMultiplier: safeNonNegativeNumber(staff.payrollOvertimeMultiplier, 0),
    payrollDeductionMethod: cleanText(staff.payrollDeductionMethod),
    overtimeMethod: cleanText(staff.overtimeMethod),
    overtimeDaysPerMonth: safeNonNegativeNumber(staff.overtimeDaysPerMonth, 0),
    overtimeBaseHoursPerDay: safeNonNegativeNumber(staff.overtimeBaseHoursPerDay, 0),
    overtimeSeasonBaseHoursPerDay: safeNonNegativeNumber(staff.overtimeSeasonBaseHoursPerDay, 0),
    overtimeHoursBasis: cleanText(staff.overtimeHoursBasis),
    overtimePercent: safeNonNegativeNumber(staff.overtimePercent, 0),
    overtimeInvoicePercent: safeNonNegativeNumber(staff.overtimeInvoicePercent, 0),
  };
}

function stableEmployeeSaveValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableEmployeeSaveValue);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort((a, b) => a.localeCompare(b))
      .reduce<Record<string, unknown>>((out, key) => {
        const normalized = stableEmployeeSaveValue((value as Record<string, unknown>)[key]);
        if (normalized !== undefined) out[key] = normalized;
        return out;
      }, {});
  }
  return value;
}

function stableEmployeeSaveJson(value: unknown) {
  return JSON.stringify(stableEmployeeSaveValue(value));
}

function employeeSaveSnapshotMismatches(
  expected: EmployeeSaveVerificationSnapshot,
  actual: EmployeeSaveVerificationSnapshot
) {
  return Object.keys(expected).filter(
    (key) => stableEmployeeSaveJson(expected[key]) !== stableEmployeeSaveJson(actual[key])
  );
}

function verifyEmployeeSaveSnapshot(
  stage: string,
  expected: EmployeeSaveVerificationSnapshot,
  actual: EmployeeSaveVerificationSnapshot
) {
  const mismatches = employeeSaveSnapshotMismatches(expected, actual);
  if (mismatches.length) {
    throw new Error(`تعذر تأكيد حفظ بيانات الموظفة (${stage}): ${mismatches.join(", ")}`);
  }
}

export default function DashboardEmployees() {
  const location = useLocation();
  const navigate = useNavigate();
  const employeeRouteMatch = /^\/dashboard\/employees\/([^/]+)(?:\/([^/]+))?\/?$/.exec(location.pathname);
  const routeEmployeeId = employeeRouteMatch ? decodeURIComponent(employeeRouteMatch[1]) : "";
  const routeSection = (employeeRouteMatch?.[2] || "basic") as EmployeeSplitTab;
  const isEmployeeProfileRoute = Boolean(routeEmployeeId);
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => getAuthUser());
  const { hasPermission, hasAnyPermission } = usePermissions();

  const canAccessEmployeesDashboard = hasPermission("employees.view");
  const canCreateEmployees = hasPermission("employees.create");
  const canUpdateEmployees = hasAnyPermission(["employees.update", "employees.manage"]);
  const canManage = canUpdateEmployees;
  const canDeleteEmployees = hasPermission("employees.delete");
  const canManageSchedule = hasPermission("employees.schedule.manage");

  const canViewAttendance = hasPermission("attendance.view");
  const canCreateAttendance = hasPermission("attendance.records.create");
  const canUpdateAttendance = hasPermission("attendance.records.update");
  const canDeleteAttendance = hasPermission("attendance.records.delete");
  const canManageAttendanceSettings = hasPermission("attendance.settings.manage");
  const canManageAttendanceZones = canManageSchedule || canManageAttendanceSettings;
  const canManageLeaveBalance = hasPermission("attendance.leaves.manage");

  const canViewPayroll = hasPermission("payroll.view");
  const canManagePayroll = hasPermission("payroll.manage");
  const canViewEmployeeMessages = hasAnyPermission(["messages.view", "messages.manage"]);
  const canViewEmployeeFiles = hasPermission("employees.files.view");
  const canFixBookings = hasPermission("bookings.update");

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [list, setList] = useState<StaffPublicUi[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [repairConfirmOpen, setRepairConfirmOpen] = useState(false);
  const [repairMessage, setRepairMessage] = useState("");
  const busy = loading || saving;

  const [statsLoading, setStatsLoading] = useState(false);
  const modalHourOverrideHijriPickerRef = useRef<HTMLDivElement>(null);
  const [bookingStats, setBookingStats] =
    useState<Record<string, StaffBookingStats>>({});
  const [leaveAdjustDays, setLeaveAdjustDays] = useState("1");
  const [leaveAdjustDate, setLeaveAdjustDate] = useState<string>(todayIso());
  const [leaveAdjustNote, setLeaveAdjustNote] = useState("");
  const [leaveEntitlementDate, setLeaveEntitlementDate] = useState("");

  const [qText, setQText] = useState("");
  const [onlyActive, setOnlyActive] =
    useState<"all" | "active" | "inactive">("all");

  const [directoryVisibility, setDirectoryVisibility] =
    useState<"visible" | "hidden" | "all">("visible");

  const [specialtyFilter, setSpecialtyFilter] = useState<string>("all");

  const [isOpen, setIsOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [modalTab, setModalTab] = useState<EmployeeModalTab>("basic");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const selectedEmployeeIdentityRef = useRef<EmployeeIdentity | null>(null);
  const closingEmployeeDetailRef = useRef(false);
  const [activeTab, setActiveTab] = useState<EmployeeSplitTab>("basic");
  const [mode, setMode] = useState<EmployeeMode>("view");
  const [activeStatsSubTab, setActiveStatsSubTab] = useState<"payroll" | "stats">("payroll");

  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [cvUrl, setCvUrl] = useState("");
  const [rating, setRating] = useState("");
  const [reviewsCount, setReviewsCount] = useState("");

  const [active, setActive] = useState(true);

  // ✅ جديد
  const [showOnAbout, setShowOnAbout] = useState(true);
  const [showOnBooking, setShowOnBooking] = useState(true);
  const [includeInEmployeeManagement, setIncludeInEmployeeManagement] = useState(true);
  const [modalOnLeave, setModalOnLeave] = useState(false);
  const [modalLeaveFrom, setModalLeaveFrom] = useState("");
  const [modalLeaveUntil, setModalLeaveUntil] = useState("");
  const [modalLeaveType, setModalLeaveType] = useState<ManagedLeaveType>("annual");
  const [modalLeaveNote, setModalLeaveNote] = useState("");
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const [leaveModalDate, setLeaveModalDate] = useState("");
  const [leaveModalDefaultType, setLeaveModalDefaultType] = useState("emergency");
  const [leaveModalEmployeeName, setLeaveModalEmployeeName] = useState("");
  const [employmentEndDate, setEmploymentEndDate] = useState("");
  const [attendanceZones, setAttendanceZones] = useState<WorkZone[]>([]);
  const [attendanceZonesLoading, setAttendanceZonesLoading] = useState(false);
  const [selectedAttendanceZoneId, setSelectedAttendanceZoneId] = useState("");
  const [employeeAttendanceRows, setEmployeeAttendanceRows] = useState<StaffAttendanceWithId[]>([]);
  const [employeeAttendanceLoading, setEmployeeAttendanceLoading] = useState(false);
  const [employeeAttendanceError, setEmployeeAttendanceError] = useState("");
  const [employeeAttendanceMonth, setEmployeeAttendanceMonth] = useState(() => getTodayAttendanceDateKey().slice(0, 7));
  const [employeeAttendanceSelectedDate, setEmployeeAttendanceSelectedDate] = useState(() => getTodayAttendanceDateKey());
  const attendanceLoadRequestRef = useRef(0);
  const attendanceInFlightKeyRef = useRef("");
  const attendanceLoadedKeyRef = useRef("");
  const staffListRef = useRef<StaffPublicUi[]>([]);
  const [selectedEmployeeLeaveRequests, setSelectedEmployeeLeaveRequests] = useState<EmployeeLeaveRequest[]>([]);
  const [attendanceEditOpen, setAttendanceEditOpen] = useState(false);
  const [attendanceEditDate, setAttendanceEditDate] = useState("");
  const [attendanceEditCheckIn, setAttendanceEditCheckIn] = useState("");
  const [attendanceEditCheckOut, setAttendanceEditCheckOut] = useState("");
  const [attendanceEditNote, setAttendanceEditNote] = useState("");
  const [modalExceptionalLeaveWeekdays, setModalExceptionalLeaveWeekdays] = useState<WeekdayKey[]>([]);
  const [modalUseCustomWorkingHours, setModalUseCustomWorkingHours] = useState(false);
  const [modalCustomWorkingHours, setModalCustomWorkingHours] =
    useState<Record<WeekdayKey, StaffWorkingDay>>(createDefaultWorkingHours());
  const [modalCustomHourOverrides, setModalCustomHourOverrides] = useState<StaffWorkingHourOverride[]>([]);
  const [modalScheduleEffectiveFrom, setModalScheduleEffectiveFrom] = useState(() => todayIso());
  const [modalScheduleChangeReason, setModalScheduleChangeReason] = useState("");

  const [coreScheduleRows, setCoreScheduleRows] =
    useState<CoreHrSchedule[]>([]);

  const [
    coreScheduleExceptionRows,
    setCoreScheduleExceptionRows,
  ] = useState<CoreScheduleException[]>([]);

  const [
    coreScheduleLoadedEmployeeId,
    setCoreScheduleLoadedEmployeeId,
  ] = useState("");

  const [
    coreScheduleLoading,
    setCoreScheduleLoading,
  ] = useState(false);

  const [
    coreScheduleError,
    setCoreScheduleError,
  ] = useState("");

  const [
    coreScheduleVersionCount,
    setCoreScheduleVersionCount,
  ] = useState(0);
  const [
    coreResolvedTodayByEmployeeId,
    setCoreResolvedTodayByEmployeeId,
  ] = useState<Record<string, CoreResolvedShift | null>>({});

  const [
    coreResolvedTodayLoading,
    setCoreResolvedTodayLoading,
  ] = useState(false);

  const [
    coreResolvedTodayError,
    setCoreResolvedTodayError,
  ] = useState("");

  const [
    coreResolvedTodayRefreshVersion,
    setCoreResolvedTodayRefreshVersion,
  ] = useState(0);

  const [
    coreResolvedFutureRows,
    setCoreResolvedFutureRows,
  ] = useState<CoreResolvedShift[]>([]);

  const [
    coreResolvedFutureEmployeeId,
    setCoreResolvedFutureEmployeeId,
  ] = useState("");

  const [
    coreResolvedFutureLoading,
    setCoreResolvedFutureLoading,
  ] = useState(false);

  const [
    coreResolvedFutureError,
    setCoreResolvedFutureError,
  ] = useState("");
  const [modalHourOverrideFromDate, setModalHourOverrideFromDate] = useState("");
  const [modalHourOverrideToDate, setModalHourOverrideToDate] = useState("");
  const [modalHourOverrideCalendar, setModalHourOverrideCalendar] = useState<DateCalendar>("gregory");
  const [modalHourOverrideFromDateHijri, setModalHourOverrideFromDateHijri] = useState("");
  const [modalHourOverrideToDateHijri, setModalHourOverrideToDateHijri] = useState("");
  const [modalHourOverrideHijriPickerOpen, setModalHourOverrideHijriPickerOpen] = useState(false);
  const [modalHourOverrideHijriPickerTarget, setModalHourOverrideHijriPickerTarget] =
    useState<"from" | "to">("from");
  const [modalHourOverrideHijriViewMonthISO, setModalHourOverrideHijriViewMonthISO] = useState<string>(
    () => findHijriMonthStartIso(todayIso())
  );
  const [modalHourOverrideStart, setModalHourOverrideStart] = useState("10:00");
  const [modalHourOverrideEnd, setModalHourOverrideEnd] = useState("22:00");
  const [modalHourOverrideEnabled, setModalHourOverrideEnabled] = useState(true);
  const [modalHourOverrideMode, setModalHourOverrideMode] = useState<WorkingHourOverrideMode>("single");
  const [modalHourOverrideQuickMode, setModalHourOverrideQuickMode] =
    useState<WorkingHourOverrideQuickMode>("manual");
  const [modalHourOverrideApplyMethod, setModalHourOverrideApplyMethod] =
    useState<WorkingHourOverrideApplyMethod>("replace");
  const [modalHourOverrideNote, setModalHourOverrideNote] = useState("");
  const [modalHourOverrideApplyWeekdays, setModalHourOverrideApplyWeekdays] = useState<WeekdayKey[]>([]);
  const [modalHourOverrideOverwriteExisting, setModalHourOverrideOverwriteExisting] = useState(true);
  const [modalHourOverrideUpdateExistingOnly, setModalHourOverrideUpdateExistingOnly] = useState(false);
  const [modalHourOverrideEditingDate, setModalHourOverrideEditingDate] = useState("");
  const [modalHourOverrideEditingGroupId, setModalHourOverrideEditingGroupId] = useState("");
  const [monthlySalary, setMonthlySalary] = useState("");
  const [payrollMonthlyHours, setPayrollMonthlyHours] = useState("");
  const [payrollOvertimeEnabled, setPayrollOvertimeEnabled] = useState(false);
  const [payrollOvertimeMultiplier, setPayrollOvertimeMultiplier] = useState("1.5");
  const [payrollDeductionMethod, setPayrollDeductionMethod] = useState<"hourly" | "daily">("hourly");
  const [payrollSettingsSaving, setPayrollSettingsSaving] = useState(false);
  const [payrollSettingsMessage, setPayrollSettingsMessage] = useState("");
  const [overtimeMethod, setOvertimeMethod] = useState<StaffPayrollMethod>("hours_from_salary");
  const [overtimeDaysPerMonth, setOvertimeDaysPerMonth] = useState("");
  const [overtimeBaseHoursPerDay, setOvertimeBaseHoursPerDay] = useState("");
  const [overtimeSeasonBaseHoursPerDay, setOvertimeSeasonBaseHoursPerDay] = useState("6");
  const [overtimeHoursBasis, setOvertimeHoursBasis] = useState<StaffOvertimeHoursBasis>("regular");
  const [overtimePercent, setOvertimePercent] = useState("25");
  const [overtimeInvoicePercent, setOvertimeInvoicePercent] = useState("0");

  const [specialties, setSpecialties] = useState<string[]>([]);
  const [serviceOptions, setServiceOptions] = useState<ServiceOption[]>([]);
  const serviceOptionsRef = useRef<ServiceOption[]>([]);
  const leaveAdjustmentOperationRef = useRef<{
    signature: string;
    operationId: string;
  } | null>(null);

  const [srvQ, setSrvQ] = useState("");
  const [srvSection, setSrvSection] = useState<string>("all");
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const [appSettings, setAppSettings] = useState<any>(() => AppSettingsService.getCached?.() || {});
  const modalHourOverrideHijriMonthTitle = useMemo(
    () => toHijriMonthYearLabel(modalHourOverrideHijriViewMonthISO),
    [modalHourOverrideHijriViewMonthISO]
  );
  const modalHourOverrideHijriMonthDays = useMemo(
    () => buildHijriMonthDays(modalHourOverrideHijriViewMonthISO),
    [modalHourOverrideHijriViewMonthISO]
  );
  const modalHourOverrideHijriWeekOffset = useMemo(() => {
    if (!modalHourOverrideHijriMonthDays.length) return 0;
    return hijriWeekdayColumnFromIso(modalHourOverrideHijriMonthDays[0].iso);
  }, [modalHourOverrideHijriMonthDays]);

  useEffect(() => {
    serviceOptionsRef.current = serviceOptions;
  }, [serviceOptions]);

  useEffect(() => {
    const syncAuthUser = () => setAuthUser(getAuthUser());
    syncAuthUser();
    window.addEventListener("storage", syncAuthUser);
    window.addEventListener("focus", syncAuthUser);
    return () => {
      window.removeEventListener("storage", syncAuthUser);
      window.removeEventListener("focus", syncAuthUser);
    };
  }, []);

  const ensureCanManage = useCallback(() => {
    const allowed = editId ? canUpdateEmployees : canCreateEmployees;
    if (allowed) return true;
    setErrorMsg(
      editId
        ? "ليست لديك صلاحية لتعديل بيانات الموظفات."
        : "ليست لديك صلاحية لإضافة موظفات."
    );
    return false;
  }, [canCreateEmployees, canUpdateEmployees, editId]);
  const ensureCanDelete = useCallback(() => {
    if (canDeleteEmployees) return true;
    setErrorMsg("ليست لديك صلاحية لحذف الموظفات.");
    return false;
  }, [canDeleteEmployees]);
  const ensureCanManageLeaveBalance = useCallback(() => {
    if (canManageLeaveBalance) return true;
    setErrorMsg("ليست لديك صلاحية لإدارة رصيد الإجازات.");
    return false;
  }, [canManageLeaveBalance]);


  const resolveAttendanceZoneId = useCallback((staffLike: any): string => {
    const employment = staffLike?.employeeProfile?.employment || staffLike?.employment || {};
    const allowedZoneIds = Array.isArray(employment?.allowedZoneIds)
      ? employment.allowedZoneIds
      : Array.isArray(staffLike?.allowedZoneIds)
        ? staffLike.allowedZoneIds
        : [];
    return String(
      staffLike?.allowedAttendanceZoneId ||
      staffLike?.attendanceZoneId ||
      staffLike?.assignedAttendanceZoneId ||
      staffLike?.attendanceScopeId ||
      employment?.allowedAttendanceZoneId ||
      employment?.attendanceZoneId ||
      employment?.assignedAttendanceZoneId ||
      employment?.attendanceScopeId ||
      allowedZoneIds[0] ||
      ""
    ).trim();
  }, []);

  const loadAttendanceZones = useCallback(async () => {
    if (!canManageAttendanceZones) {
      setAttendanceZones([]);
      setAttendanceZonesLoading(false);
      return;
    }

    setAttendanceZonesLoading(true);
    try {
      setAttendanceZones(await listWorkZones());
    } catch (error) {
      setAttendanceZones([]);
      setErrorMsg(toFirestoreErrorMessage(error, "تعذر تحميل نطاقات الحضور."));
    } finally {
      setAttendanceZonesLoading(false);
    }
  }, [canManageAttendanceZones]);

  useEffect(() => {
    staffListRef.current = list;
  }, [list]);

  const loadSelectedEmployeeAttendance = useCallback(async (options: { force?: boolean } = {}) => {
    if (!canViewAttendance) {
      setEmployeeAttendanceRows([]);
      setSelectedEmployeeLeaveRequests([]);
      setEmployeeAttendanceError("");
      setEmployeeAttendanceLoading(false);
      attendanceInFlightKeyRef.current = "";
      attendanceLoadedKeyRef.current = "";
      return;
    }

    const employeeId = String(selectedEmployeeId || "").trim();
    if (!employeeId) {
      setEmployeeAttendanceRows([]);
      setSelectedEmployeeLeaveRequests([]);
      setEmployeeAttendanceError("");
      setEmployeeAttendanceLoading(false);
      return;
    }

    const monthKey = /^\d{4}-\d{2}$/.test(employeeAttendanceMonth)
      ? employeeAttendanceMonth
      : getTodayAttendanceDateKey().slice(0, 7);
    const monthStart = `${monthKey}-01`;
    const monthEnd = new Date(
      Date.UTC(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)), 0)
    )
      .toISOString()
      .slice(0, 10);

    const selectedIdentity = selectedEmployeeIdentityRef.current;
    const currentList = staffListRef.current;
    const employeeProfile =
      currentList.find((item) => item.id === employeeId) ||
      currentList.find((item) => employeeMatchesIdentity(item, selectedIdentity)) ||
      { id: employeeId };

    const attendanceIdentity = resolveEmployeeAttendanceIdentity(
      employeeProfile,
      employeeId
    );
    const attendanceKey = [
      employeeId,
      attendanceIdentity.employeeUid,
      attendanceIdentity.employeeDocId,
      monthKey,
    ].join("|");

    if (!options.force) {
      if (attendanceInFlightKeyRef.current === attendanceKey) return;
      if (attendanceLoadedKeyRef.current === attendanceKey) return;
    }

    const requestId = ++attendanceLoadRequestRef.current;
    attendanceInFlightKeyRef.current = attendanceKey;
    setEmployeeAttendanceLoading(true);
    setEmployeeAttendanceError("");
    try {
      attendanceDebug(
        `employeeUid=${attendanceIdentity.employeeUid}`,
        `employeeDocId=${attendanceIdentity.employeeDocId}`,
        `month=${monthKey}`,
        { selectedEmployeeId: employeeId, ids: attendanceIdentity.allIds }
      );

      const [rows, leaveRows] = await Promise.all([
        listAttendanceByDateRangeForEmployeeFromWorker({
          employeeUid: attendanceIdentity.employeeUid,
          employeeId,
          employeeDocId: attendanceIdentity.employeeDocId,
          employeeIds: attendanceIdentity.allIds,
          fromDate: monthStart,
          toDate: monthEnd,
        }),
        listEmployeeLeaveRequests(500),
      ]);
      if (requestId !== attendanceLoadRequestRef.current) return;
      const shiftRows = await Promise.all(
        rows.map(async (row) => {
          const date = cleanText((row as any).date || (row as any).dateKey || (row as any).dayKey);
          if (!date) return row;
          try {
            const resolvedShift = await CoreHrService.resolveEmployeeShift(employeeId, date);
            return {
              ...row,
              resolvedShift,
              shiftName: cleanText(resolvedShift.shiftName || resolvedShift.shift_name),
              shiftStartTime: cleanText(resolvedShift.templateStartTime || resolvedShift.template_start_time || resolvedShift.startTime || resolvedShift.start_time),
              shiftEndTime: cleanText(resolvedShift.templateEndTime || resolvedShift.template_end_time || resolvedShift.endTime || resolvedShift.end_time),
              lateGraceMinutes: Number(resolvedShift.lateGraceMinutes ?? resolvedShift.late_grace_minutes ?? (row as any).lateGraceMinutes ?? 0),
              earlyLeaveGraceMinutes: 0,
            } as StaffAttendanceWithId;
          } catch (shiftError) {
            console.warn("employee attendance shift resolve failed", { employeeId, date, shiftError });
            return row;
          }
        })
      );
      setEmployeeAttendanceRows(shiftRows.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))));
      setSelectedEmployeeLeaveRequests(
        leaveRows.filter((request) =>
          leaveRequestMatchesProfile(
            request,
            employeeProfile,
            attendanceIdentity.allIds
          )
        )
      );
      attendanceLoadedKeyRef.current = attendanceKey;
    } catch (error) {
      if (requestId !== attendanceLoadRequestRef.current) return;
      setEmployeeAttendanceRows([]);
      setSelectedEmployeeLeaveRequests([]);
      const status = Number((error as { status?: number })?.status || 0);
      if (status === 403) {
        const payload = (error as { payload?: { message?: unknown; detail?: unknown } })?.payload || {};
        const developerCode = cleanText(payload.message || payload.detail || (error as Error)?.message || "forbidden");
        const message = `تعذر تحميل سجل الحضور بسبب صلاحيات الوصول. كود المطور: 403${developerCode ? ` / ${developerCode}` : ""}`;
        setEmployeeAttendanceError(message);
        setErrorMsg(message);
      } else {
        const message = toFirestoreErrorMessage(error, "تعذر تحميل سجل حضور الموظفة.");
        setEmployeeAttendanceError(message);
        setErrorMsg(message);
      }
    } finally {
      if (requestId === attendanceLoadRequestRef.current) {
        setEmployeeAttendanceLoading(false);
        if (attendanceInFlightKeyRef.current === attendanceKey) {
          attendanceInFlightKeyRef.current = "";
        }
      }
    }
  }, [canViewAttendance, employeeAttendanceMonth, list, selectedEmployeeId]);

  useEffect(() => {
    if (!selectedEmployeeId) return;
    attendanceLoadRequestRef.current += 1;
    attendanceInFlightKeyRef.current = "";
    attendanceLoadedKeyRef.current = "";
    setEmployeeAttendanceRows([]);
    setSelectedEmployeeLeaveRequests([]);
    setEmployeeAttendanceError("");
    setEmployeeAttendanceLoading(false);
    const todayKey = getTodayAttendanceDateKey();
    setEmployeeAttendanceMonth(todayKey.slice(0, 7));
    setEmployeeAttendanceSelectedDate(todayKey);
  }, [selectedEmployeeId]);

  useEffect(() => {
    void loadAttendanceZones();
  }, [loadAttendanceZones]);

  useEffect(() => {
    if (activeTab !== "attendance") return;
    void loadSelectedEmployeeAttendance();
  }, [activeTab, loadSelectedEmployeeAttendance]);

  const openAttendancePunchEditor = useCallback((dateKey: string) => {
    const cleanDate = normalizeLeaveUntil(dateKey);
    if (!cleanDate) return;
    const row = employeeAttendanceRows.find((item) => item.date === cleanDate) || null;
    const allowed = row ? canUpdateAttendance : canCreateAttendance;
    if (!allowed) {
      setErrorMsg(
        row
          ? "ليست لديك صلاحية لتعديل بصمة الموظفة."
          : "ليست لديك صلاحية لإضافة بصمة إدارية."
      );
      return;
    }
    setAttendanceEditDate(cleanDate);
    setAttendanceEditCheckIn(toDateTimeLocalValue(row?.checkInAtClient) || `${cleanDate}T09:00`);
    setAttendanceEditCheckOut(toDateTimeLocalValue(row?.checkOutAtClient));
    setAttendanceEditNote(cleanText(row?.notes));
    setAttendanceEditOpen(true);
    setErrorMsg("");
  }, [canCreateAttendance, canUpdateAttendance, employeeAttendanceRows]);

  const closeAttendancePunchEditor = useCallback(() => {
    setAttendanceEditOpen(false);
    setAttendanceEditDate("");
    setAttendanceEditCheckIn("");
    setAttendanceEditCheckOut("");
    setAttendanceEditNote("");
  }, []);

  const saveAttendancePunchEditor = useCallback(async () => {
    if (!selectedEmployeeId) {
      setErrorMsg("لم يتم تحديد الموظفة.");
      return;
    }
    const date = normalizeLeaveUntil(attendanceEditDate);
    const existingRow = employeeAttendanceRows.find((item) => item.date === date) || null;
    const allowed = existingRow ? canUpdateAttendance : canCreateAttendance;
    if (!allowed) {
      setErrorMsg(
        existingRow
          ? "ليست لديك صلاحية لتعديل بصمة الموظفة."
          : "ليست لديك صلاحية لإضافة بصمة إدارية."
      );
      return;
    }
    const checkInIso = dateTimeLocalToIso(attendanceEditCheckIn);
    const checkOutIso = dateTimeLocalToIso(attendanceEditCheckOut);
    if (!date || !checkInIso) {
      setErrorMsg("اختر اليوم ووقت الحضور قبل حفظ تعديل البصمة.");
      return;
    }
    if (checkOutIso && Date.parse(checkOutIso) <= Date.parse(checkInIso)) {
      setErrorMsg("وقت الانصراف يجب أن يكون بعد وقت الحضور.");
      return;
    }

    setSaving(true);
    setErrorMsg("");
    try {
      const employeeProfile =
        list.find((item) => item.id === selectedEmployeeId) ||
        list.find((item) =>
          employeeMatchesIdentity(
            item,
            selectedEmployeeIdentityRef.current
          )
        ) ||
        { id: selectedEmployeeId };

      const attendanceIdentity = resolveEmployeeAttendanceIdentity(employeeProfile, selectedEmployeeId);

      await adjustAttendanceDayFromWorker({
        employeeUid: attendanceIdentity.employeeUid,
        employeeId: attendanceIdentity.employeeDocId,
        date,
        checkInTime:
          attendanceEditCheckIn.slice(11, 16),
        checkOutTime: attendanceEditCheckOut
          ? attendanceEditCheckOut.slice(11, 16)
          : undefined,
        note: attendanceEditNote,
      });
      void writeAuditLog({
        action: "attendance_updated",
        entityType: "attendance",
        entityId: `${selectedEmployeeId}/${date}`,
        source: "dashboard",
        description: "تعديل بصمة حضور الموظفة من الإدارة",
        after: { date, checkInAtClient: checkInIso, checkOutAtClient: checkOutIso || "" },
        meta: {
          staffId: selectedEmployeeId,
          employeeUid: attendanceIdentity.employeeUid,
          employeeDocId: attendanceIdentity.employeeDocId,
        },
      });
      closeAttendancePunchEditor();
      await loadSelectedEmployeeAttendance({ force: true });
    } catch (error) {
      setErrorMsg(toFirestoreErrorMessage(error, "تعذر حفظ تعديل البصمة."));
    } finally {
      setSaving(false);
    }
  }, [
    attendanceEditCheckIn,
    attendanceEditCheckOut,
    attendanceEditDate,
    attendanceEditNote,
    authUser?.displayName,
    authUser?.email,
    authUser?.uid,
    canCreateAttendance,
    canUpdateAttendance,
    closeAttendancePunchEditor,
    employeeAttendanceRows,
    loadSelectedEmployeeAttendance,
    list,
    selectedEmployeeId,
  ]);

  const deleteAttendancePunch = useCallback(async (dateKey: string) => {
    if (!canDeleteAttendance || !selectedEmployeeId) {
      setErrorMsg("ليست لديك صلاحية لمسح بصمة الموظفة.");
      return;
    }
    const date = normalizeLeaveUntil(dateKey);
    if (!date) return;
    const ok = confirm(`سيتم مسح سجل البصمة ليوم ${date}. هل تريد المتابعة؟`);
    if (!ok) return;

    setSaving(true);
    setErrorMsg("");
    try {
      const employeeProfile =
        list.find((item) => item.id === selectedEmployeeId) ||
        list.find((item) =>
          employeeMatchesIdentity(
            item,
            selectedEmployeeIdentityRef.current
          )
        ) ||
        { id: selectedEmployeeId };

      const attendanceIdentity = resolveEmployeeAttendanceIdentity(employeeProfile, selectedEmployeeId);

      const clearResult = await clearAttendanceDayFromWorker({
        employeeUid: attendanceIdentity.employeeUid,
        employeeId: attendanceIdentity.employeeDocId,
        date,
        note: "مسح بصمة اليوم من إدارة الموظفات",
      });

      const clearedRecords = Number(clearResult?.clearedRecords || 0);
      if (clearedRecords <= 0) {
        throw new Error(
          "لم يتم العثور على بصمات لهذا اليوم، لذلك لم يتم حذف أي سجل."
        );
      }

      await writeAuditLog({
        action: "attendance_deleted",
        entityType: "attendance",
        entityId: `${selectedEmployeeId}/${date}`,
        source: "dashboard",
        description: "مسح بصمة حضور الموظفة من الإدارة",
        before: { date, clearedRecords },
        meta: {
          staffId: selectedEmployeeId,
          employeeUid: attendanceIdentity.employeeUid,
          employeeDocId: attendanceIdentity.employeeDocId,
          clearedRecords,
        },
      });
      await loadSelectedEmployeeAttendance({ force: true });
    } catch (error) {
      setErrorMsg(toFirestoreErrorMessage(error, "تعذر مسح البصمة."));
    } finally {
      setSaving(false);
    }
  }, [
    canDeleteAttendance,
    list,
    loadSelectedEmployeeAttendance,
    selectedEmployeeId,
  ]);

  const createEmergencyLeaveForAttendanceDay = useCallback(async (dateKey: string) => {
    if (!selectedEmployeeId) {
      setErrorMsg("لم يتم تحديد الموظفة.");
      return;
    }
    if (!authUser?.uid) {
      setErrorMsg("تعذر تحديد المستخدم المنفذ للعملية.");
      return;
    }
    if (!ensureCanManageLeaveBalance()) return;

    const date = normalizeLeaveUntil(dateKey);
    if (!date) {
      setErrorMsg("اختر يومًا صحيحًا لتسجيل الإجازة.");
      return;
    }

    const employeeProfile =
      list.find((item) => item.id === selectedEmployeeId) ||
      list.find((item) =>
        employeeMatchesIdentity(
          item,
          selectedEmployeeIdentityRef.current
        )
      ) ||
      { id: selectedEmployeeId };

    const attendanceIdentity = resolveEmployeeAttendanceIdentity(
      employeeProfile,
      selectedEmployeeId
    );
    const employeeUid = attendanceIdentity.employeeUid;
    const employeeId = attendanceIdentity.employeeDocId || selectedEmployeeId;
    if (!employeeUid || !employeeId) {
      setErrorMsg("تعذر تحديد حساب الموظفة لتسجيل الإجازة.");
      return;
    }

    const approvedLeaveDateKeys = buildApprovedLeaveDateKeys({
      profile: employeeProfile,
      leaveRequests: selectedEmployeeLeaveRequests,
      extraIds: attendanceIdentity.allIds,
      todayDateKey: todayIso(),
    });
    if (approvedLeaveDateKeys.includes(date)) {
      setErrorMsg("هذا اليوم مسجل كإجازة معتمدة بالفعل.");
      return;
    }

    const hasAttendanceRecord = employeeAttendanceRows.some(
      (row) =>
        row.date === date &&
        Boolean(row.checkInAtClient || row.checkOutAtClient)
    );
    if (hasAttendanceRecord) {
      setErrorMsg("لا يمكن تحويل يوم عليه بصمة إلى إجازة مفاجئة من هذا الإجراء.");
      return;
    }

    const employeeName = cleanText(
      (employeeProfile as any)?.name ||
        (employeeProfile as any)?.displayName ||
        selectedEmployeeId
    );
    setLeaveModalEmployeeName(employeeName);
    setLeaveModalDate(date);
    setLeaveModalDefaultType("emergency");
    setLeaveModalOpen(true);
  }, [
    authUser?.displayName,
    authUser?.email,
    authUser?.uid,
    employeeAttendanceRows,
    ensureCanManageLeaveBalance,
    list,
    loadSelectedEmployeeAttendance,
    selectedEmployeeId,
    selectedEmployeeLeaveRequests,
  ]);

  const cancelLeaveForAttendanceDay = useCallback(async (dateKey: string) => {
    if (!selectedEmployeeId) {
      setErrorMsg("لم يتم تحديد الموظفة.");
      return;
    }
    if (!authUser?.uid) {
      setErrorMsg("تعذر تحديد المستخدم المنفذ للعملية.");
      return;
    }
    if (!ensureCanManageLeaveBalance()) return;

    const date = normalizeLeaveUntil(dateKey);
    if (!date) {
      setErrorMsg("اختر يومًا صحيحًا لإلغاء الإجازة.");
      return;
    }

    const leaveRequest = selectedEmployeeLeaveRequests.find((request) => {
      if (cleanText(request.status).toLowerCase() !== "approved") return false;
      const fromDate = normalizeLeaveUntil(request.fromDate);
      const toDate = normalizeLeaveUntil(request.toDate) || fromDate;
      return !!fromDate && date >= fromDate && date <= toDate;
    });

    if (!leaveRequest) {
      const coreLeaves =
        await CoreHrService.listLeaves({
          employeeId: selectedEmployeeId,
        }).catch((error) => {
          setErrorMsg(
            toFirestoreErrorMessage(
              error,
              "تعذر التحقق من الإجازات والاستئذانات المعتمدة من Core. لم يتم تنفيذ العملية."
            )
          );
          return null;
        });

      if (!coreLeaves) return;
      const permissionLeave = coreLeaves.find((leave) => {
        if (cleanText(leave.status).toLowerCase() !== "approved") return false;
        if (cleanText(leave.durationKind).toLowerCase() !== "partial") return false;
        if (cleanText(leave.leaveType).toLowerCase() !== "permission") return false;
        const leaveFrom = normalizeLeaveUntil(leave.startDate);
        const leaveTo = normalizeLeaveUntil(leave.endDate) || leaveFrom;
        return !!leaveFrom && date >= leaveFrom && date <= leaveTo;
      });
      const permissionId = cleanText(permissionLeave?.requestId);
      if (!permissionLeave || !permissionId) {
        setErrorMsg("لم يتم العثور على إجازة أو استئذان معتمد لهذا اليوم.");
        return;
      }

      const ok = confirm("سيتم إلغاء الاستئذان المعتمد ليوم " + date + ". هل تريد المتابعة؟");
      if (!ok) return;

      setSaving(true);
      setErrorMsg("");
      try {
        await reviewPermissionRequest({
          requestId: permissionId,
          status: "cancelled",
          reviewerUid: authUser.uid,
          reviewerName: authUser.displayName || authUser.email,
        });
        void writeAuditLog({
          action: "permission_cancelled",
          entityType: "employee_permission_request",
          entityId: permissionId,
          source: "dashboard",
          description: "إلغاء استئذان معتمد من سجل الحضور",
          before: { date, status: "approved", coreLeaveId: permissionLeave.id },
          after: { date, status: "cancelled" },
          meta: { staffId: selectedEmployeeId },
        });
        await Promise.all([load(), loadSelectedEmployeeAttendance({ force: true })]);
      } catch (error) {
        setErrorMsg(toFirestoreErrorMessage(error, "تعذر إلغاء الاستئذان."));
      } finally {
        setSaving(false);
      }
      return;
    }

    const ok = confirm(`سيتم إلغاء الإجازة المعتمدة ليوم ${date}. هل تريد المتابعة؟`);
    if (!ok) return;

    setSaving(true);
    setErrorMsg("");
    try {
      await decideCanonicalEmployeeLeaveRequest(
        leaveRequest,
        "cancelled",
        {
          reviewerUid: authUser.uid,
          reviewerName:
            authUser.displayName ||
            authUser.email,
          hrNote:
            "تم إلغاء الإجازة من سجل الحضور",
        }
      );
      const employee =
        list.find((item) => item.id === selectedEmployeeId) ||
        list.find((item) => employeeMatchesIdentity(item, selectedEmployeeIdentityRef.current)) ||
        { id: selectedEmployeeId, name: selectedEmployeeId };
      const requestFrom = normalizeLeaveUntil(leaveRequest.fromDate);
      const requestTo = normalizeLeaveUntil(leaveRequest.toDate) || requestFrom;
      const currentFrom = normalizeLeaveUntil(
        (employee as any).leaveStartDate ||
          (employee as any).leaveFrom ||
          (employee as any).leaveFromDate
      );
      const currentTo = normalizeLeaveUntil((employee as any).leaveUntil) || currentFrom;
      const isCurrentProfileLeave =
        cleanText((employee as any).leaveRequestId) === cleanText(leaveRequest.id) ||
        (!!(employee as any).onLeave &&
          !!requestFrom &&
          requestFrom <= (currentTo || requestTo) &&
          requestTo >= (currentFrom || requestFrom));

      if (isCurrentProfileLeave) {
        await CoreHrService.saveEmployee({
          id: selectedEmployeeId,
          leaveStartDate: null,
          leaveEndDate: null,
          leaveNote: null,
        });
        const profilePatch = {
          onLeave: false,
          leaveStartDate: "",
          leaveUntil: "",
          leaveType: "",
          leaveNote: "",
          leaveRequestId: "",
          coreLeaveId: "",
          employeeProfile: {
            onLeave: false,
            leaveStartDate: "",
            leaveUntil: "",
            leaveType: "",
            leaveNote: "",
            leaveRequestId: "",
            coreLeaveId: "",
          },
          updatedAt: serverTimestamp(),
        };
        await Promise.all([
          setDoc(staffPublicDoc(selectedEmployeeId), profilePatch, { merge: true }),
          setDoc(doc(db, "salons", SALON_ID, "employees", selectedEmployeeId), profilePatch, { merge: true }),
        ]);
        setList((current) =>
          current.map((item) =>
            item.id === selectedEmployeeId || employeeMatchesIdentity(item, employeeIdentityOf(employee))
              ? {
                  ...item,
                  onLeave: false,
                  leaveStartDate: "",
                  leaveUntil: "",
                  leaveType: "",
                  leaveNote: "",
                  leaveRequestId: "",
                  coreLeaveId: "",
                }
              : item
          )
        );
        setModalOnLeave(false);
        setModalLeaveFrom("");
        setModalLeaveUntil("");
        setModalLeaveType("annual");
        setModalLeaveNote("");
      }
      setSelectedEmployeeLeaveRequests((current) =>
        current.map((request) =>
          cleanText(request.id) === cleanText(leaveRequest.id)
            ? { ...request, status: "cancelled" }
            : request
        )
      );

      void writeAuditLog({
        action: "leave_cancelled",
        entityType: "employee_leave",
        entityId: leaveRequest.id,
        source: "dashboard",
        description: "إلغاء إجازة معتمدة من سجل الحضور",
        before: {
          date,
          status: "approved",
          leaveType: leaveRequest.type,
        },
        after: {
          date,
          status: "cancelled",
        },
        meta: {
          staffId: selectedEmployeeId,
        },
      });

      await Promise.all([load(), loadSelectedEmployeeAttendance({ force: true })]);
    } catch (error) {
      setErrorMsg(toFirestoreErrorMessage(error, "تعذر إلغاء الإجازة."));
    } finally {
      setSaving(false);
    }
  }, [
    authUser?.displayName,
    authUser?.email,
    authUser?.uid,
    ensureCanManageLeaveBalance,
    list,
    loadSelectedEmployeeAttendance,
    selectedEmployeeId,
    selectedEmployeeLeaveRequests,
  ]);

  const handleLeaveModalSubmit = useCallback(async (payload: { type: string; fromDate: string; toDate: string; days: number; durationKind: "full_day" | "partial"; partialStartTime: string; partialEndTime: string; deductFromBalance: boolean; affectsPayroll: boolean; note: string; }) => {
    if (!selectedEmployeeId) {
      setErrorMsg("لم يتم تحديد الموظفة.");
      return;
    }
    if (!authUser?.uid) {
      setErrorMsg("تعذر تحديد المستخدم المنفذ للعملية.");
      return;
    }
    if (!ensureCanManageLeaveBalance()) return;

    const employeeProfile =
      list.find((item) => item.id === selectedEmployeeId) ||
      list.find((item) => employeeMatchesIdentity(item, selectedEmployeeIdentityRef.current)) ||
      { id: selectedEmployeeId, name: leaveModalEmployeeName };
    const attendanceIdentity = resolveEmployeeAttendanceIdentity(employeeProfile, selectedEmployeeId);
    const employeeUidLocal = attendanceIdentity.employeeUid;
    const employeeIdLocal = selectedEmployeeId;
    const leaveType = normalizeManagedLeaveType(payload.type);
    const durationKind = payload.durationKind === "partial" ? "partial" : "full_day";
    const isPartialLeave = durationKind === "partial";
    const partialStartTime = isPartialLeave ? cleanText(payload.partialStartTime) : "";
    const partialEndTime = isPartialLeave ? cleanText(payload.partialEndTime) : "";
    const basePolicy = managedLeavePolicy(leaveType);
    const policy = isPartialLeave
      ? { deductFromBalance: false, affectsPayroll: false }
      : basePolicy;
    const fromDate = normalizeLeaveUntil(payload.fromDate);
    const toDate = normalizeLeaveUntil(payload.toDate);
    const days = inclusiveLeaveDays(fromDate, toDate);
    const employeeName = cleanText(
      leaveModalEmployeeName ||
        (employeeProfile as any)?.name ||
        (employeeProfile as any)?.displayName ||
        employeeIdLocal
    );

    if (!fromDate || !toDate || days <= 0 || fromDate > toDate) {
      throw new Error("مدى الإجازة غير صحيح.");
    }
    if (isPartialLeave) {
      if (fromDate !== toDate) throw new Error("الاستئذان يجب أن يكون في يوم واحد.");
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(partialStartTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(partialEndTime)) {
        throw new Error("وقت الاستئذان غير صحيح.");
      }
      if (partialStartTime >= partialEndTime) throw new Error("وقت نهاية الاستئذان يجب أن يكون بعد البداية.");

      setSaving(true);
      setErrorMsg("");
      try {
        const permission = await createPermissionRequest({
          employeeUid: employeeUidLocal,
          employeeId: selectedEmployeeId,
          employeeName,
          date: fromDate,
          startTime: partialStartTime,
          expectedReturnTime: partialEndTime,
          reason: cleanText(payload.note) || "استئذان إداري",
          note: cleanText(payload.note) || undefined,
          source: "admin_direct",
          financialEffect: "none",
          createdByUid: authUser.uid,
          createdByName: authUser.displayName || authUser.email,
        });

        await Promise.all([load(), loadSelectedEmployeeAttendance({ force: true })]);
        window.dispatchEvent(new Event("queens:staff-updated"));
        void writeAuditLog({
          action: "permission_approved",
          entityType: "employee_permission_request",
          entityId: permission.id,
          source: "dashboard",
          description: "تسجيل استئذان معتمد وربطه بالحضور والحجز",
          after: {
            employeeUid: employeeUidLocal,
            employeeId: selectedEmployeeId,
            date: fromDate,
            startTime: partialStartTime,
            endTime: partialEndTime,
            financialEffect: "none",
          },
          meta: {
            staffId: selectedEmployeeId,
            staffName: employeeName,
          },
        });
        return;
      } catch (error) {
        setErrorMsg(toFirestoreErrorMessage(error, "تعذر تسجيل الاستئذان وربطه بالحضور والحجز."));
        throw error;
      } finally {
        setSaving(false);
      }
    }

    setSaving(true);
    setErrorMsg("");
    let requestId = "";
    let coreLeaveId = "";
    let createdRequestId = "";
    let requestForCanonical: EmployeeLeaveRequest | null = null;
    try {
      const existingRequests = selectedEmployeeLeaveRequests.length
        ? selectedEmployeeLeaveRequests
        : (await listEmployeeLeaveRequests(500)).filter((request) =>
            leaveRequestMatchesProfile(request, employeeProfile, attendanceIdentity.allIds)
          );
      const matchingRequest = existingRequests.find((request) =>
        cleanText(request.status).toLowerCase() === "approved" &&
        normalizeLeaveUntil(request.fromDate) === fromDate &&
        normalizeLeaveUntil(request.toDate) === toDate &&
        normalizeManagedLeaveType(request.type) === leaveType &&
        (((request as any).durationKind === "partial" || (request as any).duration_kind === "partial") ? "partial" : "full_day") === durationKind &&
        (!isPartialLeave || (cleanText((request as any).partialStartTime || (request as any).partial_start_time) === partialStartTime &&
          cleanText((request as any).partialEndTime || (request as any).partial_end_time) === partialEndTime))
      );

      if (matchingRequest) {
        requestId = matchingRequest.id;
        requestForCanonical = matchingRequest;
      } else {
        const requestRef = await createLeaveRequest({
          employeeUid: employeeUidLocal,
          employeeId: employeeIdLocal,
          employeeName,
          type: leaveType,
          fromDate,
          toDate,
          days,
          durationKind,
          partialStartTime,
          partialEndTime,
          note: payload.note || (isPartialLeave ? "تسجيل استئذان معتمد من إدارة الموظفات" : "تسجيل إجازة معتمدة من إدارة الموظفات"),
          createdByUid: authUser.uid,
          createdByName: authUser.displayName || authUser.email,
        });
        requestId = requestRef.id;
        createdRequestId = requestRef.id;
        await updateDoc(requestRef, {
          source: "employee_profile_leave",
          deductFromBalance: policy.deductFromBalance,
          affectsPayroll: policy.affectsPayroll,
          approvalMode: "admin_direct",
          updatedAt: serverTimestamp(),
        } as any);
        requestForCanonical = {
          id: requestId,
          employeeUid: employeeUidLocal,
          employeeId: employeeIdLocal,
          employeeName,
          type: leaveType,
          fromDate,
          toDate,
          days,
          durationKind,
          partialStartTime:
            isPartialLeave
              ? partialStartTime
              : undefined,
          partialEndTime:
            isPartialLeave
              ? partialEndTime
              : undefined,
          note:
            payload.note ||
            (isPartialLeave
              ? "تسجيل استئذان معتمد من إدارة الموظفات"
              : "تسجيل إجازة معتمدة من إدارة الموظفات"),
          status: "pending",
          createdByUid: authUser.uid,
          createdByName:
            authUser.displayName ||
            authUser.email,
        };
      }

      if (!requestForCanonical) {
        throw new Error(
          "employee_leave_request_not_resolved"
        );
      }

      // Attendance identity may be Firebase UID.
      // Core HR operations must use the canonical employee_profiles.id.
      requestForCanonical = {
        ...requestForCanonical,
        employeeUid:
          employeeUidLocal ||
          requestForCanonical.employeeUid,
        employeeId: employeeIdLocal,
      };

      await decideCanonicalEmployeeLeaveRequest(
        requestForCanonical,
        "approved",
        {
          reviewerUid: authUser.uid,
          reviewerName:
            authUser.displayName ||
            authUser.email,
          hrNote:
            policy.affectsPayroll
              ? "إجازة بدون راتب — تخصم حسب معدل اليوم"
              : "إجازة مدفوعة معتمدة",
        }
      );

      // Fail closed: after canonical approval the linked Core
      // operational record MUST exist and be approved.
      const existingCoreLeaves =
        await CoreHrService.listLeaves({
          employeeId: selectedEmployeeId,
        });

      const matchingCoreLeave =
        existingCoreLeaves.find(
          (leave) =>
            cleanText(leave.requestId) ===
              requestId &&
            cleanText(
              leave.status
            ).toLowerCase() === "approved"
        );

      if (!matchingCoreLeave) {
        throw new Error(
          "employee_leave_core_approval_missing"
        );
      }

      coreLeaveId =
        matchingCoreLeave.id;
      // A partial leave is operationally authoritative in employee_leaves only.
      // Never mirror it to profile/staff full-day leave fields, otherwise the
      // employee disappears for the entire day instead of only the blocked range.
      if (!isPartialLeave) {
        const profilePatch = {
          onLeave: true,
          leaveStartDate: fromDate,
          leaveUntil: toDate,
          leaveType,
          leaveNote: cleanText(payload.note),
          leaveRequestId: requestId,
          coreLeaveId,
          updatedAt: serverTimestamp(),
        };
        await Promise.all([
          setDoc(staffPublicDoc(selectedEmployeeId), profilePatch, { merge: true }),
          setDoc(doc(db, "salons", SALON_ID, "employees", selectedEmployeeId), profilePatch, { merge: true }),
        ]);
      }
      if (requestId && coreLeaveId) {
        await updateDoc(doc(db, "salons", SALON_ID, "employee_leave_requests", requestId), {
          coreLeaveId,
          updatedAt: serverTimestamp(),
        } as any).catch(() => {});
      }

      if (!isPartialLeave) {
        setModalOnLeave(true);
        setModalLeaveFrom(fromDate);
        setModalLeaveUntil(toDate);
        setModalLeaveType(leaveType);
        setModalLeaveNote(cleanText(payload.note));
      }
      await Promise.all([load(), loadSelectedEmployeeAttendance({ force: true })]);
      window.dispatchEvent(new Event("queens:staff-updated"));

      void writeAuditLog({
        action: "leave_approved",
        entityType: "employee_leave",
        entityId: requestId || coreLeaveId,
        source: "dashboard",
        description: "تسجيل إجازة معتمدة وربطها بالحضور والراتب",
        after: {
          employeeUid: employeeUidLocal,
          employeeId: selectedEmployeeId,
          leaveType,
          fromDate,
          toDate,
          days,
          durationKind,
          partialStartTime: isPartialLeave ? partialStartTime : null,
          partialEndTime: isPartialLeave ? partialEndTime : null,
          affectsPayroll: policy.affectsPayroll,
          deductFromBalance: policy.deductFromBalance,
          requestId,
          coreLeaveId,
        },
        meta: {
          staffId: selectedEmployeeId,
          staffName: employeeName,
        },
      });
    } catch (error) {
      if (
        createdRequestId &&
        requestForCanonical
      ) {
        try {
          await decideCanonicalEmployeeLeaveRequest(
            requestForCanonical,
            "cancelled",
            {
              reviewerUid: authUser.uid,
              reviewerName:
                authUser.displayName ||
                authUser.email,
              hrNote:
                "تم التراجع تلقائيًا بسبب تعذر إكمال تسجيل الإجازة",
            }
          );
        } catch (rollbackError) {
          console.warn(
            "canonical leave rollback failed",
            rollbackError
          );
        }
      }
      setErrorMsg(toFirestoreErrorMessage(error, "تعذر تسجيل الإجازة وربطها بالحضور والراتب."));
      throw error;
    } finally {
      setSaving(false);
    }
  }, [
    authUser?.displayName,
    authUser?.email,
    authUser?.uid,
    ensureCanManageLeaveBalance,
    leaveModalEmployeeName,
    list,
    loadSelectedEmployeeAttendance,
    selectedEmployeeId,
    selectedEmployeeLeaveRequests,
  ]);

  const openApprovedLeaveFromEmployeeProfile = useCallback(() => {
    if (!selectedEmployeeId) {
      setErrorMsg("لم يتم تحديد الموظفة.");
      return;
    }
    const employee =
      list.find((item) => item.id === selectedEmployeeId) ||
      { id: selectedEmployeeId, name };
    setLeaveModalEmployeeName(cleanText((employee as any)?.name || selectedEmployeeId));
    setLeaveModalDate(todayIso());
    setLeaveModalDefaultType("annual");
    setLeaveModalOpen(true);
  }, [list, name, selectedEmployeeId]);

  const endCurrentApprovedLeave = useCallback(async () => {
    if (!selectedEmployeeId || !authUser?.uid) {
      setErrorMsg("تعذر تحديد الموظفة أو المستخدم المنفذ.");
      return;
    }
    if (!ensureCanManageLeaveBalance()) return;
    const employee =
      list.find((item) => item.id === selectedEmployeeId) ||
      { id: selectedEmployeeId, name };
    if (!employee) {
      setErrorMsg("تعذر العثور على ملف الموظفة.");
      return;
    }
    const ok = confirm("سيتم إنهاء الإجازة الحالية وإلغاء أثرها المستقبلي. هل تريد المتابعة؟");
    if (!ok) return;

    setSaving(true);
    setErrorMsg("");
    try {
      const attendanceIdentity = resolveEmployeeAttendanceIdentity(employee, selectedEmployeeId);
      const currentFrom = normalizeLeaveUntil(
        (employee as any).leaveStartDate ||
          (employee as any).leaveFrom ||
          (employee as any).leaveFromDate
      );
      const currentTo = normalizeLeaveUntil((employee as any).leaveUntil) || currentFrom;
      const targetFrom = currentFrom || todayIso();
      const targetTo = currentTo || targetFrom;

      const allLeaveRequests = await listEmployeeLeaveRequests(500);
      const matchingApprovedRequests = allLeaveRequests.filter((request) => {
        if (cleanText(request.status).toLowerCase() !== "approved") return false;
        if (!leaveRequestMatchesProfile(request, employee, attendanceIdentity.allIds)) return false;
        const requestFrom = normalizeLeaveUntil(request.fromDate);
        const requestTo = normalizeLeaveUntil(request.toDate) || requestFrom;
        if (!requestFrom) return false;
        return requestFrom <= targetTo && requestTo >= targetFrom;
      });

      // Read canonical Core state BEFORE mutating either side.
      const coreLeavesBeforeCancel =
        await CoreHrService.listLeaves({
          employeeId: selectedEmployeeId,
        });

      const matchingCoreLeavesBeforeCancel =
        coreLeavesBeforeCancel.filter(
          (leave) => {
            const status =
              cleanText(
                leave.status
              ).toLowerCase();

            if (
              status !== "approved" &&
              status !== "pending"
            ) {
              return false;
            }

            const leaveFrom =
              normalizeLeaveUntil(
                leave.startDate
              );

            const leaveTo =
              normalizeLeaveUntil(
                leave.endDate
              ) || leaveFrom;

            if (!leaveFrom) return false;

            return (
              leaveFrom <= targetTo &&
              leaveTo >= targetFrom
            );
          }
        );

      // Every approved Firestore request must have a
      // canonical Core operational record.
      for (
        const request of
        matchingApprovedRequests
      ) {
        const linkedCore =
          matchingCoreLeavesBeforeCancel.find(
            (leave) =>
              cleanText(
                leave.requestId
              ) ===
              cleanText(request.id)
          );

        if (!linkedCore) {
          throw new Error(
            "employee_leave_core_record_missing"
          );
        }
      }

      // A request-linked Core leave must also have its
      // request mirror. Otherwise stop instead of creating
      // another split-brain state.
      for (
        const coreLeave of
        matchingCoreLeavesBeforeCancel
      ) {
        const requestId =
          cleanText(
            coreLeave.requestId
          );

        if (
          requestId &&
          !matchingApprovedRequests.some(
            (request) =>
              cleanText(request.id) ===
              requestId
          )
        ) {
          throw new Error(
            "employee_leave_request_mirror_mismatch"
          );
        }
      }

      await Promise.all([
        ...matchingApprovedRequests.map(
          (request) =>
            decideCanonicalEmployeeLeaveRequest(
              request,
              "cancelled",
              {
                reviewerUid: authUser.uid,
                reviewerName:
                  authUser.displayName ||
                  authUser.email,
                hrNote:
                  "تم إنهاء الإجازة من إدارة الموظفات",
              }
            )
        ),

        // Legacy Core-only operational leaves have no
        // request mirror to synchronize.
        ...matchingCoreLeavesBeforeCancel
          .filter(
            (leave) =>
              !cleanText(
                leave.requestId
              )
          )
          .map(
            (leave) =>
              CoreHrService.decideLeave(
                leave.id,
                "rejected",
                "تم إنهاء الإجازة من إدارة الموظفات"
              )
          ),
      ]);
      // Core availability keeps its own leave window on the staff row.
      // Clear it explicitly after rejecting the leave so booking/schedule availability returns immediately.
      await CoreHrService.saveEmployee({
        id: selectedEmployeeId,
        leaveStartDate: null,
        leaveEndDate: null,
        leaveNote: null,
      });

      const profilePatch = {
        onLeave: false,
        leaveStartDate: "",
        leaveUntil: "",
        leaveType: "",
        leaveNote: "",
        leaveRequestId: "",
        coreLeaveId: "",
        employeeProfile: {
          onLeave: false,
          leaveStartDate: "",
          leaveUntil: "",
          leaveType: "",
          leaveNote: "",
          leaveRequestId: "",
          coreLeaveId: "",
        },
        updatedAt: serverTimestamp(),
      };
      await Promise.all([
        setDoc(staffPublicDoc(selectedEmployeeId), profilePatch, { merge: true }),
        setDoc(doc(db, "salons", SALON_ID, "employees", selectedEmployeeId), profilePatch, { merge: true }),
      ]);

      setList((current) =>
        current.map((item) =>
          item.id === selectedEmployeeId || employeeMatchesIdentity(item, employeeIdentityOf(employee))
            ? {
                ...item,
                onLeave: false,
                leaveStartDate: "",
                leaveUntil: "",
                leaveType: "",
                leaveNote: "",
                leaveRequestId: "",
                coreLeaveId: "",
              }
            : item
        )
      );
      setSelectedEmployeeLeaveRequests((current) =>
        current.map((request) =>
          matchingApprovedRequests.some(
            (cancelledRequest) =>
              cleanText(cancelledRequest.id) ===
              cleanText(request.id)
          )
            ? { ...request, status: "cancelled" }
            : request
        )
      );
      setModalOnLeave(false);
      setModalLeaveFrom("");
      setModalLeaveUntil("");
      setModalLeaveType("annual");
      setModalLeaveNote("");
      await Promise.all([load(), loadSelectedEmployeeAttendance({ force: true })]);
      window.dispatchEvent(new Event("queens:staff-updated"));
    } catch (error) {
      setErrorMsg(toFirestoreErrorMessage(error, "تعذر إنهاء الإجازة الحالية."));
    } finally {
      setSaving(false);
    }
  }, [
    authUser?.displayName,
    authUser?.email,
    authUser?.uid,
    ensureCanManageLeaveBalance,
    list,
    loadSelectedEmployeeAttendance,
    name,
    selectedEmployeeId,
    selectedEmployeeLeaveRequests,
  ]);

  const resetForm = () => {
    setEditId(null);
    setModalTab("basic");
    setName("");
    setBio("");
    setAvatarUrl("");
    setCvUrl("");
    setRating("");
    setReviewsCount("");
    setActive(true);

    // ✅ جديد
    setShowOnAbout(true);
    setShowOnBooking(true);
    setIncludeInEmployeeManagement(true);
    setModalOnLeave(false);
    setModalLeaveFrom("");
    setModalLeaveUntil("");
    setModalLeaveType("annual");
    setModalLeaveNote("");
    setEmploymentEndDate("");
    setSelectedAttendanceZoneId("");
    setModalExceptionalLeaveWeekdays([]);
    setModalUseCustomWorkingHours(false);
    setModalCustomWorkingHours(createDefaultWorkingHours());
    setModalCustomHourOverrides([]);
    setModalScheduleEffectiveFrom(todayIso());
    setModalScheduleChangeReason("");

    setCoreScheduleRows([]);
    setCoreScheduleExceptionRows([]);
    setCoreScheduleLoadedEmployeeId("");
    setCoreScheduleLoading(false);
    setCoreScheduleError("");
    setCoreScheduleVersionCount(0);

    setModalHourOverrideFromDate("");
    setModalHourOverrideToDate("");
    setModalHourOverrideCalendar("gregory");
    setModalHourOverrideFromDateHijri("");
    setModalHourOverrideToDateHijri("");
    setModalHourOverrideHijriPickerOpen(false);
    setModalHourOverrideHijriPickerTarget("from");
    setModalHourOverrideHijriViewMonthISO(findHijriMonthStartIso(todayIso()));
    setModalHourOverrideStart("10:00");
    setModalHourOverrideEnd("22:00");
    setModalHourOverrideEnabled(true);
    setModalHourOverrideMode("single");
    setModalHourOverrideQuickMode("manual");
    setModalHourOverrideApplyMethod("replace");
    setModalHourOverrideNote("");
    setModalHourOverrideApplyWeekdays([]);
    setModalHourOverrideOverwriteExisting(true);
    setModalHourOverrideUpdateExistingOnly(false);
    setModalHourOverrideEditingDate("");
    setModalHourOverrideEditingGroupId("");
    setMonthlySalary("");
    setPayrollMonthlyHours("");
    setPayrollOvertimeEnabled(false);
    setPayrollOvertimeMultiplier("1.5");
    setPayrollDeductionMethod("hourly");
    setPayrollSettingsMessage("");
    setOvertimeMethod("hours_from_salary");
    setOvertimeDaysPerMonth("");
    setOvertimeBaseHoursPerDay("");
    setOvertimeSeasonBaseHoursPerDay("6");
    setOvertimeHoursBasis("regular");
    setOvertimePercent("25");
    setOvertimeInvoicePercent("0");

    setSpecialties([]);
    setSrvQ("");
    setSrvSection("all");
    setLeaveAdjustDays("1");
    setLeaveAdjustDate(todayIso());
    setLeaveAdjustNote("");
    setLeaveEntitlementDate("");
  };

  const openEdit = (x: StaffPublicUi, updateRoute = true) => {
    closingEmployeeDetailRef.current = false;
    selectedEmployeeIdentityRef.current = employeeIdentityOf(x);
    setSelectedEmployeeId(x.id);
    setActiveTab("basic");
    setActiveStatsSubTab("payroll");
    setMode("edit");
    setEditId(x.id);
    setModalTab("basic");
    setName(x.name ?? "");
    setBio(x.bio ?? "");
    setAvatarUrl(resolveAvatarFromAssets(pickAvatarUrl(x as any)));
    setCvUrl((x as any).cvUrl ?? "");
    setRating(String((x as any).rating ?? ""));
    setReviewsCount(String((x as any).reviewsCount ?? (x as any).reviewCount ?? ""));
    setActive(!!x.active);
    setShowOnBooking((x as any).showOnBooking !== false);
    setIncludeInEmployeeManagement(
      (x as any).includeInEmployeeManagement !== false
    );
    const initialLeaveUntil = normalizeLeaveUntil((x as any).leaveUntil);
    const initialLeaveFrom =
      normalizeLeaveUntil((x as any).leaveStartDate || (x as any).leaveFrom || (x as any).leaveFromDate) ||
      (initialLeaveUntil ? todayIso() : "");
    const initialLeaveExpired = !!initialLeaveUntil && initialLeaveUntil < todayIso();
    setModalOnLeave(!!(x as any).onLeave && !initialLeaveExpired);
    setModalLeaveFrom(initialLeaveFrom);
    setModalLeaveUntil(initialLeaveUntil);
    setModalLeaveType(normalizeManagedLeaveType((x as any).leaveType));
    setModalLeaveNote(String((x as any).leaveNote || ""));
    setEmploymentEndDate(normalizeLeaveUntil((x as any).employmentEndDate));
    setSelectedAttendanceZoneId(resolveAttendanceZoneId(x));
    const switchingScheduleEmployee =
      cleanText(editId) !==
      cleanText(x.id);

    if (switchingScheduleEmployee) {
      setCoreScheduleRows([]);
      setCoreScheduleLoadedEmployeeId("");
      setCoreScheduleError("");
      setCoreScheduleVersionCount(0);
      setCoreScheduleLoading(true);

      setModalExceptionalLeaveWeekdays([]);
      setModalUseCustomWorkingHours(true);

      setModalCustomWorkingHours(
        emptyCoreScheduleEditorRows()
      );
    }

    setModalCustomHourOverrides(
      []
    );

    setModalScheduleEffectiveFrom(todayIso());
    setModalScheduleChangeReason("");
    setModalHourOverrideFromDate("");
    setModalHourOverrideToDate("");
    setModalHourOverrideCalendar("gregory");
    setModalHourOverrideFromDateHijri("");
    setModalHourOverrideToDateHijri("");
    setModalHourOverrideHijriPickerOpen(false);
    setModalHourOverrideHijriPickerTarget("from");
    setModalHourOverrideHijriViewMonthISO(findHijriMonthStartIso(todayIso()));
    setModalHourOverrideStart("10:00");
    setModalHourOverrideEnd("22:00");
    setModalHourOverrideEnabled(true);
    setModalHourOverrideMode("single");
    setModalHourOverrideQuickMode("manual");
    setModalHourOverrideApplyMethod("replace");
    setModalHourOverrideNote("");
    setModalHourOverrideApplyWeekdays([]);
    setModalHourOverrideOverwriteExisting(true);
    setModalHourOverrideUpdateExistingOnly(false);
    setModalHourOverrideEditingDate("");
    setModalHourOverrideEditingGroupId("");
    const payrollCfg = normalizePayrollConfig(x as any);
    setMonthlySalary(positiveInputString((x as any).monthlySalary ?? payrollCfg.monthlySalary));
    setPayrollMonthlyHours(
      positiveInputString(
        (x as any).payrollMonthlyHours ??
          (x as any).expectedWorkHours ??
          (x as any).expected_work_hours
      )
    );
    setPayrollOvertimeEnabled(
      booleanSetting(
        (x as any).payrollOvertimeEnabled ??
          (x as any).payroll_overtime_enabled ??
          (x as any).overtimeEnabled ??
          false
      )
    );
    setPayrollOvertimeMultiplier(
      positiveInputString((x as any).payrollOvertimeMultiplier ?? (x as any).overtimeMultiplier) || "1.5"
    );
    setPayrollDeductionMethod(
      payrollDeductionMethodSetting((x as any).payrollDeductionMethod ?? (x as any).payroll_deduction_method)
    );
    setPayrollSettingsMessage("");
    setOvertimeMethod(payrollCfg.method);
    setOvertimeDaysPerMonth(
      positiveInputString(
        (x as any).payrollWorkDays ??
          (x as any).expectedWorkDays ??
          (x as any).expected_work_days ??
          (x as any).overtimeDaysPerMonth
      )
    );
    setOvertimeBaseHoursPerDay(
      positiveInputString(
        (x as any).payrollDailyHours ??
          (x as any).dailyScheduledHours ??
          (x as any).daily_scheduled_hours ??
          (x as any).overtimeBaseHoursPerDay
      )
    );
    setOvertimeSeasonBaseHoursPerDay(String(payrollCfg.seasonBaseHoursPerDay || 6));
    setOvertimeHoursBasis(payrollCfg.hoursBasis || "regular");
    setOvertimePercent(String(payrollCfg.overtimePercent || 0));
    setOvertimeInvoicePercent(String(payrollCfg.invoicePercent || 0));

    // ✅ جديد
    setShowOnAbout((x as any).showOnAbout !== false);

    setSpecialties(canonicalizeSpecialties(x.specialties, serviceOptions));
    setSrvQ("");
    setSrvSection("all");
    setLeaveAdjustDays("1");
    setLeaveAdjustDate(todayIso());
    setLeaveAdjustNote("");
    setLeaveEntitlementDate(String((x as any).leaveEntitlementDate || ""));
    setIsOpen(true);
    if (updateRoute) navigate(`/dashboard/employees/${encodeURIComponent(x.id)}/basic`);
  };

  useEffect(() => {
    const employeeId =
      cleanText(editId);

    if (!employeeId) {
      return;
    }

    let cancelled = false;

    setCoreScheduleLoading(true);
    setCoreScheduleError("");

    void Promise.all([
      CoreHrService
        .getEmployee(
          employeeId
        ),

      CoreHrService
        .listScheduleExceptions({
          employeeId,
        }),
    ])
      .then(([
        employee,
        exceptionRows,
      ]) => {
        if (cancelled) {
          return;
        }

        const schedules =
          Array.isArray(
            employee.schedules
          )
            ? employee.schedules
            : [];

        const scheduleExceptions =
          Array.isArray(
            exceptionRows
          )
            ? exceptionRows
            : [];

        const projectedOverrides =
          projectCoreScheduleExceptionsToOverrides(
            scheduleExceptions
          );

        const workingRows =
          resolveCoreScheduleEditorRows(
            schedules,
            todayIso()
          );

        const weeklyOffDays =
          WEEKDAY_OPTIONS
            .filter(
              (day) =>
                workingRows[
                  day.key
                ]?.enabled ===
                false
            )
            .map(
              (day) =>
                day.key
            );

        setCoreScheduleRows(
          schedules
        );

        setCoreScheduleExceptionRows(
          scheduleExceptions
        );

        setCoreScheduleLoadedEmployeeId(
          employeeId
        );

        setCoreScheduleVersionCount(
          countCoreScheduleVersions(
            schedules
          )
        );

        // The canonical editor now represents
        // explicit Core HR schedules.
        setModalUseCustomWorkingHours(
          true
        );

        setModalCustomWorkingHours(
          workingRows
        );

        setModalExceptionalLeaveWeekdays(
          weeklyOffDays
        );

        setModalCustomHourOverrides(
          projectedOverrides
        );

        setCoreScheduleError("");
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        const message =
          "\u062a\u0639\u0630\u0631 \u062a\u062d\u0645\u064a\u0644 \u062c\u062f\u0648\u0644 \u0627\u0644\u062f\u0648\u0627\u0645 \u0645\u0646 Malikat Core: " +
          cleanText(
            (error as any)?.message ||
            error
          );

        // Fail closed. Never hydrate from
        // staff_public schedule fields.
        setCoreScheduleRows([]);
        setCoreScheduleExceptionRows([]);
        setCoreScheduleLoadedEmployeeId("");
        setCoreScheduleVersionCount(0);

        setModalCustomWorkingHours(
          emptyCoreScheduleEditorRows()
        );

        setModalExceptionalLeaveWeekdays(
          []
        );

        setModalCustomHourOverrides(
          []
        );

        setCoreScheduleError(
          message
        );

        setErrorMsg(
          message
        );
      })
      .finally(() => {
        if (!cancelled) {
          setCoreScheduleLoading(
            false
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [editId]);

  useEffect(() => {
    if (closingEmployeeDetailRef.current || !routeEmployeeId || !list.length) return;
    const matched = list.find((item) => employeeMatchesRouteId(item, routeEmployeeId));
    if (!matched) {
      if (!loading) {
        setErrorMsg("تعذر العثور على ملف الموظفة المطلوب. تم الرجوع إلى قائمة الموظفين.");
        navigate("/dashboard/employees", { replace: true });
      }
      return;
    }
    if (editId !== matched.id) openEdit(matched, false);
    const resolvedRouteSection: EmployeeSplitTab = routeSection === "shifts" ? "booking" : routeSection;
    if (routeSection === "shifts") {
      navigate(`/dashboard/employees/${encodeURIComponent(matched.id)}/booking`, { replace: true });
    }
    setActiveTab(resolvedRouteSection);
    if (["basic", "profile", "services", "booking"].includes(resolvedRouteSection)) {
      setModalTab(resolvedRouteSection as EmployeeModalTab);
    }
  }, [editId, list, loading, navigate, routeEmployeeId, routeSection]);

  useEffect(() => {
    if (!selectedEmployeeId || !canManageLeaveBalance) return;

    let cancelled = false;

    CoreHrService.getLeaveBalance(selectedEmployeeId)
      .then((state) => {
        if (cancelled) return;

        const balance = Number(state.leaveBalance || 0);
        const entitlementDate = cleanText(
          state.leaveEntitlementDate
        );

        setList((current) =>
          current.map((employee) =>
            employee.id === selectedEmployeeId
              ? ({
                  ...employee,
                  leaveBalanceDays:
                    Number.isFinite(balance) && balance >= 0
                      ? balance
                      : 0,
                  leaveEntitlementDate: entitlementDate,
                  leaveEntries: state.entries as LeaveEntry[],
                } as StaffPublicUi)
              : employee
          )
        );

        setLeaveEntitlementDate(entitlementDate);
      })
      .catch((error) => {
        if (cancelled) return;

        console.warn(
          "Failed to load canonical Core leave balance:",
          error
        );

        if (activeTab === "leave") {
          setErrorMsg(
            toFirestoreErrorMessage(
              error,
              "تعذر تحميل رصيد الإجازات من Core."
            )
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    canManageLeaveBalance,
    selectedEmployeeId,
  ]);

  useEffect(() => {
    if (!selectedEmployeeId || activeTab !== "payroll" || !canViewPayroll) return;
    let cancelled = false;
    CoreHrService.getEmployee(selectedEmployeeId)
      .then((coreEmployee) => {
        if (cancelled) return;
        const employment = (coreEmployee.employment || {}) as Record<string, unknown>;
        const baseSalaryHalalas = positiveNumberOrZero(
          employment.base_salary_halalas ?? employment.baseSalaryHalalas
        );
        if (baseSalaryHalalas > 0) {
          setMonthlySalary(String(roundPayrollNumber(baseSalaryHalalas / 100)));
        }
        setOvertimeDaysPerMonth(
          positiveInputString(employment.expected_work_days ?? employment.expectedWorkDays)
        );
        setPayrollMonthlyHours(
          positiveInputString(employment.expected_work_hours ?? employment.expectedWorkHours)
        );
        setOvertimeBaseHoursPerDay(
          positiveInputString(
            employment.daily_scheduled_hours ??
              employment.dailyScheduledHours ??
              employment.expected_daily_hours ??
              employment.expectedDailyHours
          )
        );
        setPayrollOvertimeEnabled(
          booleanSetting(
            employment.overtime_enabled ??
              employment.overtimeEnabled ??
              employment.payroll_overtime_enabled ??
              employment.payrollOvertimeEnabled
          )
        );
        setPayrollOvertimeMultiplier(
          positiveInputString(employment.overtime_multiplier ?? employment.overtimeMultiplier) || "1.5"
        );
        setPayrollDeductionMethod(
          payrollDeductionMethodSetting(employment.payroll_deduction_method ?? employment.payrollDeductionMethod)
        );
      })
      .catch((error) => {
        console.warn("Failed to load Core payroll settings for employee:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, canViewPayroll, selectedEmployeeId]);

  const closeModal = () => {
    setIsOpen(false);
    resetForm();
  };

  const closeEmployeeDetail = () => {
    closingEmployeeDetailRef.current = true;
    selectedEmployeeIdentityRef.current = null;
    setSelectedEmployeeId(null);
    setEditId(null);
    setIsOpen(false);
    setMode("edit");
    resetForm();
    navigate("/dashboard/employees", { replace: true });
  };

  useEffect(() => {
    if (!routeEmployeeId) closingEmployeeDetailRef.current = false;
  }, [routeEmployeeId]);

  const loadServiceOptions = useCallback(async (): Promise<ServiceOption[]> => {
    try {
      const qSrv = query(servicesCol(), orderBy("name", "asc"));
      const snap = await getDocs(qSrv);

      const opts: ServiceOption[] = snap.docs
        .map((d) => {
          const x = d.data() as any;
          return {
            id: d.id,
            label: String(x?.name || d.id),
            sectionId: String(x?.sectionId || ""),
            categoryId: String(x?.categoryId || ""),
            durationMin: safeNonNegativeNumber(x?.durationMin || x?.duration || x?.minutes, 0),
            price: safeNonNegativeNumber(x?.price || x?.servicePrice || x?.amount, 0),
            active: x?.active !== false,
          };
        })
        .filter((s) => s.label.trim())
        .filter((s) => s.active !== false);

      setServiceOptions(opts);
      return opts;
    } catch (e) {
      setServiceOptions([]);
      setErrorMsg(toFirestoreErrorMessage(e, "تعذر تحميل الخدمات."));
      return [];
    }
  }, []);

  const load = useCallback(
    async (optionsOverride?: ServiceOption[], loadOptions: EmployeeLoadOptions = {}) => {
      setLoading(true);
      setErrorMsg("");
      try {
        const linkedUserRoleByUid = new Map<string, string>();
        const readDocs = loadOptions.fromServer ? getDocsFromServer : getDocs;
        const [userSnap, staffSnap, employeeSnap, coreAccounts, coreEmployees] = await Promise.all([
          readDocs(usersCol()).catch(() => null),
          readDocs(staffPublicCol()),
          readDocs(collection(db, "salons", SALON_ID, "employees")).catch(() => null),
          CoreAccountService.list(false, "internal").catch(() => []),
          CoreHrService.listEmployees(),
        ]);

        const userByUid = new Map<string, any>();
        userSnap?.docs.forEach((userDoc) => {
          const userData = userDoc.data() as any;
          const uid = cleanText(userData?.uid || userDoc.id);
          const role = cleanText(userData?.role).toLowerCase();
          if (uid) {
            userByUid.set(uid, { ...userData, uid });
            if (role) linkedUserRoleByUid.set(uid, role);
          }
        });

        const serviceLookup = optionsOverride ?? serviceOptionsRef.current;
        const deduped = new Map<string, StaffPublicUi>();
        const keyAliases = new Map<string, string>();

        const upsertEmployeeRecord = (
          rawDocId: string,
          rawData: any,
          source: "staff_public" | "employees" | "users" | "core_accounts"
        ) => {
          const data = rawData || {};
          if (isRemovedFromStaffRecord(data)) return;

          const linkedUid = cleanText(
            data?.linkedUid ||
              data?.employeeUid ||
              data?.authUid ||
              data?.uid ||
              data?.userId ||
              data?.linkedUserId
          );
          const linkedUser = linkedUid ? userByUid.get(linkedUid) || {} : {};
          const combined = { ...linkedUser, ...data };

          const administrative =
            isAdministrativeStaffRecord(
              rawDocId,
              combined,
              linkedUserRoleByUid
            );

          const role = cleanText(combined?.role).toLowerCase();
          if (["client", "pending", "guest"].includes(role)) return;

          const canonicalEmployeeId = employeeCanonicalDocIdOf(
            {
              ...combined,
              source,
              sourceDocId: rawDocId,
              id: rawDocId,
              staffPublicDocId: source === "staff_public" ? rawDocId : combined?.staffPublicDocId,
            },
            rawDocId
          );
          const employeeId = cleanText(canonicalEmployeeId);
          const legacyEmployeeIds = uniqueCleanTexts([
            combined?.staffPublicDocId,
            combined?.employeeDocId,
            combined?.linkedEmployeeDocId,
            combined?.employeeId,
            rawDocId,
          ]).filter((value) => value !== employeeId);

          // حساب الدخول لا يتحول تلقائيًا إلى موظفة. تفضيل users هو مصدر الحقيقة،
          // ثم نرجع لعلامة السجل، وبعدها فقط نحافظ على الموظفات التشغيليات القديمة.
          const userVisibility =
            typeof linkedUser?.includeInEmployeeManagement === "boolean"
              ? linkedUser.includeInEmployeeManagement
              : undefined;
          const recordVisibility =
            typeof data?.includeInEmployeeManagement === "boolean"
              ? data.includeInEmployeeManagement
              : undefined;
          const legacyOperationalDefault =
            role === "staff" ||
            (!administrative && source === "staff_public") ||
            (!administrative &&
              source === "employees" &&
              combined?.employeeProfileEnabled !== false);
          const includeInEmployeeManagement =
            recordVisibility ?? userVisibility ?? legacyOperationalDefault;

          if (!employeeId) return;

          const payrollCfg = normalizePayrollConfig(combined);
          const specialties = canonicalizeSpecialties(combined?.specialties, serviceLookup);
          const row: StaffPublicUi = {
            id: employeeId,
            sourceDocId: rawDocId,
            staffPublicDocId: source === "staff_public" ? employeeId : cleanText(combined?.staffPublicDocId),
            legacyEmployeeIds,
            uid: cleanText(
              combined?.uid ||
                combined?.authUid ||
                combined?.employeeUid ||
                linkedUid
            ),
            linkedUid,
            linkedUserId: cleanText(
              combined?.linkedUserId ||
                combined?.userId ||
                linkedUid
            ),
            authUid: cleanText(combined?.authUid),
            userId: cleanText(combined?.userId),
            employeeUid: cleanText(
              combined?.employeeUid ||
                combined?.linkedUid ||
                combined?.authUid ||
                combined?.uid ||
                linkedUid
            ),
            employeeDocId: cleanText(
              employeeId
            ),
            linkedEmployeeDocId: cleanText(employeeId || combined?.linkedEmployeeDocId),
            employeeId,
            email: cleanText(combined?.email || combined?.userEmail),
            phone: cleanText(combined?.phone),
            role,
            department: cleanText(
              combined?.department ||
                combined?.employeeProfile?.employment?.department ||
                combined?.employment?.department
            ),
            title: cleanText(
              combined?.title ||
                combined?.jobTitle ||
                combined?.employeeProfile?.employment?.title ||
                combined?.employment?.title
            ),
            employmentSource: cleanText(combined?.employmentSource || "salon"),
            partnerId: cleanText(combined?.partnerId),
            partnerMemberId: cleanText(combined?.partnerMemberId),
            partnerName: cleanText(combined?.partnerName),
            contractId: cleanText(combined?.contractId),
            resourceIds: Array.isArray(combined?.resourceIds)
              ? combined.resourceIds.map(cleanText).filter(Boolean)
              : [],
            employeeProfileEnabled: includeInEmployeeManagement,
            includeInEmployeeManagement,
            source,
            profileIncomplete: source !== "staff_public",
            employeeKind: administrative
              ? "administrative"
              : "service",
            name: cleanText(combined?.name || combined?.displayName || combined?.fullName || combined?.email),
            active: combined?.active !== false && combined?.isActive !== false,
            showOnAbout: source === "staff_public" ? combined?.showOnAbout !== false : false,
            showOnBooking:
              !administrative &&
              source === "staff_public" &&
              specialties.length > 0
                ? combined?.showOnBooking !== false
                : false,
            employmentEndDate: normalizeLeaveUntil(combined?.employmentEndDate),
            onLeave: !!combined?.onLeave,
            leaveStartDate: normalizeLeaveUntil(
              combined?.leaveStartDate || combined?.leaveFrom || combined?.leaveFromDate
            ),
            leaveUntil: normalizeLeaveUntil(combined?.leaveUntil),
            leaveType: normalizeManagedLeaveType(combined?.leaveType),
            leaveNote: cleanText(combined?.leaveNote),
            leaveRequestId: cleanText(combined?.leaveRequestId),
            coreLeaveId: cleanText(combined?.coreLeaveId),
            exceptionalLeaveDates: normalizeExceptionalLeaveDates(combined?.exceptionalLeaveDates),

            allowedAttendanceZoneId: resolveAttendanceZoneId(combined),
            attendanceZoneId: cleanText(combined?.attendanceZoneId),
            assignedAttendanceZoneId: cleanText(combined?.assignedAttendanceZoneId),
            attendanceScopeId: cleanText(combined?.attendanceScopeId),
            allowedZoneIds: Array.isArray(combined?.allowedZoneIds)
              ? combined.allowedZoneIds.map(cleanText).filter(Boolean)
              : [],
            monthlySalary: payrollCfg.monthlySalary,
            payrollMonthlyHours: positiveNumberOrZero(combined?.payrollMonthlyHours ?? combined?.expectedWorkHours ?? combined?.expected_work_hours),
            payrollOvertimeEnabled: booleanSetting(combined?.payrollOvertimeEnabled ?? combined?.payroll_overtime_enabled ?? combined?.overtimeEnabled),
            payrollOvertimeMultiplier: positiveNumberOrZero(combined?.payrollOvertimeMultiplier ?? combined?.overtimeMultiplier) || 1.5,
            payrollDeductionMethod: payrollDeductionMethodSetting(combined?.payrollDeductionMethod ?? combined?.payroll_deduction_method),
            overtimeMethod: payrollCfg.method,
            overtimeDaysPerMonth: payrollCfg.daysPerMonth,
            overtimeBaseHoursPerDay: payrollCfg.baseHoursPerDay,
            overtimeSeasonBaseHoursPerDay: payrollCfg.seasonBaseHoursPerDay,
            overtimeHoursBasis: payrollCfg.hoursBasis,
            overtimePercent: payrollCfg.overtimePercent,
            overtimeInvoicePercent: payrollCfg.invoicePercent,
            specialties,
            bio: cleanText(combined?.bio),
            avatarUrl: resolveAvatarFromAssets(pickAvatarUrl(combined)),
            cvUrl: cleanText(combined?.cvUrl),
            rating: safeNonNegativeNumber(combined?.rating, 0),
            reviewsCount: Math.floor(
              safeNonNegativeNumber(combined?.reviewsCount || combined?.reviewCount, 0)
            ),
            // Canonical leave balance is overlaid from Core D1 below.
            leaveBalanceDays: 0,
            leaveEntitlementDate: "",
            leaveEntries: [],
            createdAt: combined?.createdAt,
            updatedAt: combined?.updatedAt,
          };

          const rowKeys = employeeIdentityKeys(row, rawDocId);
          const dedupeKey =
            rowKeys.map((key) => keyAliases.get(key) || key).find((key) => deduped.has(key)) ||
            rowKeys[0] ||
            `doc:${rawDocId}`;
          const existing = deduped.get(dedupeKey);
          if (!existing) {
            deduped.set(dedupeKey, row);
            rowKeys.forEach((key) => keyAliases.set(key, dedupeKey));
            return;
          }

          const { primary, fallback } = pickEmployeeMergeRows(existing, row);
          const merged = mergeEmployeeRows(primary, fallback);
          deduped.set(dedupeKey, merged);
          [...employeeIdentityKeys(existing), ...rowKeys].forEach((key) => keyAliases.set(key, dedupeKey));
        };

        coreAccounts.forEach((account) => {
          const role = cleanText(
            account.role || account.primaryRole
          ).toLowerCase();

          if (["client", "pending", "guest"].includes(role)) return;

          const firebaseUid = cleanText(
            account.firebaseUid || account.uid
          );

          const linkedEmployeeId = cleanText(
            account.employeeLink?.employeeId
          );

          const recordId =
            linkedEmployeeId ||
            firebaseUid ||
            cleanText(account.id);

          if (!recordId) return;

          upsertEmployeeRecord(
            recordId,
            {
              uid: firebaseUid,
              authUid: firebaseUid,
              employeeUid: firebaseUid,
              linkedUid: firebaseUid,
              linkedUserId: cleanText(account.id),
              userId: cleanText(account.id),

              employeeId: linkedEmployeeId,
              employeeDocId: linkedEmployeeId,
              linkedEmployeeDocId: linkedEmployeeId,

              name: cleanText(
                account.displayName || account.email
              ),
              displayName: cleanText(account.displayName),
              email: cleanText(account.email),
              phone: cleanText(account.phone),

              role,
              active: account.status === "active",
              isActive: account.status === "active",

              includeInEmployeeManagement: true,
              employeeProfileEnabled: true,
            },
            "core_accounts"
          );
        });
        staffSnap.docs.forEach((staffDoc) =>
          upsertEmployeeRecord(staffDoc.id, staffDoc.data(), "staff_public")
        );
        employeeSnap?.docs.forEach((employeeDoc) =>
          upsertEmployeeRecord(employeeDoc.id, employeeDoc.data(), "employees")
        );
        userSnap?.docs.forEach((userDoc) =>
          upsertEmployeeRecord(userDoc.id, userDoc.data(), "users")
        );

        const coreEmployeeByIdentity = new Map<
          string,
          (typeof coreEmployees)[number]
        >();

        coreEmployees.forEach((coreEmployee) => {
          uniqueCleanTexts([
            coreEmployee.id,
            coreEmployee.firebaseUid,
          ]).forEach((key) => {
            coreEmployeeByIdentity.set(key, coreEmployee);
          });
        });

        const rows = Array.from(deduped.values())
          .map((row) => {
            const identityKeys = uniqueCleanTexts([
              row.id,
              row.employeeId,
              row.employeeDocId,
              row.linkedEmployeeDocId,
              row.uid,
              row.linkedUid,
              row.authUid,
              row.employeeUid,
            ]);

            let coreEmployee:
              | (typeof coreEmployees)[number]
              | undefined;

            for (const key of identityKeys) {
              const candidate =
                coreEmployeeByIdentity.get(key);
              if (!candidate) continue;
              coreEmployee = candidate;
              break;
            }

            const employment = (
              coreEmployee?.employment || {}
            ) as Record<string, unknown>;

            const rawLeaveBalance = Number(
              employment.leave_balance ??
                employment.leaveBalance ??
                0
            );

            const canonicalLeaveBalance =
              Number.isFinite(rawLeaveBalance) &&
              rawLeaveBalance >= 0
                ? rawLeaveBalance
                : 0;

            return {
              ...row,

              // Core D1 is the only leave-balance runtime source.
              leaveBalanceDays: canonicalLeaveBalance,
              leaveEntitlementDate: cleanText(
                employment.leave_entitlement_date ??
                  employment.leaveEntitlementDate
              ),
              leaveEntries: [],
            } as StaffPublicUi;
          })
          .sort((a, b) =>
            cleanText(a.name).localeCompare(
              cleanText(b.name),
              "ar"
            )
          );

        const selectedIdentity = selectedEmployeeIdentityRef.current;
        if (selectedIdentity) {
          const matched = findSavedEmployeeReloadRow(
            rows,
            selectedIdentity.employeeId || selectedIdentity.id,
            selectedIdentity
          );

          if (matched) {
            // A list reload must not erase the canonical leave ledger.
            // When an employee is open, refresh the complete leave-balance
            // state from Core D1 before publishing the reloaded rows.
            if (canManageLeaveBalance) {
              const leaveState =
                await CoreHrService.getLeaveBalance(matched.id);

              const leaveBalance = Number(
                leaveState.leaveBalance ?? 0
              );

              matched.leaveBalanceDays =
                Number.isFinite(leaveBalance) &&
                leaveBalance >= 0
                  ? leaveBalance
                  : 0;

              matched.leaveEntitlementDate =
                cleanText(
                  leaveState.leaveEntitlementDate
                );

              matched.leaveEntries =
                leaveState.entries as LeaveEntry[];
            }

            setSelectedEmployeeId(matched.id);
            setEditId((current) =>
              current ? matched.id : current
            );
            selectedEmployeeIdentityRef.current =
              employeeIdentityOf(matched);
          }
        }

        setList(rows);
        return rows;
      } catch (e) {
        setErrorMsg(toFirestoreErrorMessage(e, "تعذر تحميل الموظفات."));
        if (loadOptions.strict) throw e;
        // لا نمسح القائمة الحالية عند فشل التحديث حتى لا تُغلق الموظفة المحددة.
        return [];
      } finally {
        setLoading(false);
      }
    },
    [canManageLeaveBalance, resolveAttendanceZoneId]
  );

  // ✅ Original logic for fixing bookings
  const fixBookingsEmployeeUid = async () => {
    if (!canFixBookings) {
      setErrorMsg("ليست لديك صلاحية لإصلاح الحجوزات.");
      return;
    }
    setRepairConfirmOpen(false);
    setSaving(true);
    setErrorMsg("");
    setRepairMessage("");
    try {
      const staffSnap = await getDocs(staffPublicCol());
      const uidByEmployeeId = new Map<string, string>();
      staffSnap.docs.forEach((d) => {
        const data: any = d.data();
        const linkedUid = String(data?.linkedUid || "").trim();
        if (linkedUid) uidByEmployeeId.set(d.id, linkedUid);
      });
      const bookingsRef = collection(db, "salons", SALON_ID, "bookings");
      const bSnap = await getDocs(bookingsRef);
      let batch = writeBatch(db);
      let batchCount = 0;
      for (const d of bSnap.docs) {
        const b: any = d.data();
        const employeeUid = String(b?.employeeUid || "").trim();
        const employeeId = String(b?.employeeId || "").trim();
        if (employeeUid || !employeeId) continue;
        const linkedUid = uidByEmployeeId.get(employeeId) || "";
        if (!linkedUid) continue;
        batch.update(doc(db, "salons", SALON_ID, "bookings", d.id), {
          employeeUid: linkedUid,
          employeeKey: linkedUid,
          updatedAt: serverTimestamp(),
        });
        batchCount++;
        if (batchCount >= 450) {
          await batch.commit();
          batch = writeBatch(db);
          batchCount = 0;
        }
      }
      await batch.commit();
      setRepairMessage("تم إصلاح ربط الحجوزات القديمة بنجاح.");
    } catch (e) {
      setErrorMsg(toFirestoreErrorMessage(e, "تعذر إكمال إصلاح الحجوزات."));
    } finally {
      setSaving(false);
    }
  };

  const reloadData = useCallback(async (forceStatsRefresh = false) => {
    if (forceStatsRefresh) employeeBookingStatsCache = null;
    const opts = await loadServiceOptions();
    await load(opts);
  }, [load, loadServiceOptions]);

  useEffect(() => {
    let alive = true;
    const bootstrap = async () => {
      if (!alive) return;
      await reloadData();
    };
    void bootstrap();
    return () => {
      alive = false;
    };
  }, [reloadData]);

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const unsub = AppSettingsService.subscribe((remote: any) => {
      setAppSettings(remote || {});
    });
    return () => {
      try {
        unsub?.();
      } catch {
        // noop
      }
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let timer = 0;
    const canLoadStats = authUser?.role === "owner" || authUser?.role === "admin";
    const staffSignature = list
      .map((staff) => String(staff.id || "").trim())
      .filter(Boolean)
      .sort()
      .join("|");

    if (!canLoadStats || !list.length || selectedEmployeeId || isOpen) {
      setStatsLoading(false);
      return () => {
        alive = false;
      };
    }

    const cached = employeeBookingStatsCache;
    if (
      cached &&
      cached.staffSignature === staffSignature &&
      Date.now() - cached.savedAt < EMPLOYEE_BOOKING_STATS_CACHE_TTL_MS
    ) {
      setBookingStats(cached.stats);
      setStatsLoading(false);
      return () => {
        alive = false;
      };
    }

    const compute = async () => {
      setStatsLoading(true);
      try {
        const thisMonth = currentMonthKey();
        const initStats = (): StaffBookingStats => ({
          total: 0,
          byStatus: { pending: 0, confirmed: 0, completed: 0, cancelled: 0 },
          month: {
            key: thisMonth,
            salonTotal: 0,
            staffTotal: 0,
            sharePct: 0,
            invoiceCount: 0,
            invoiceRevenue: 0,
          },
        });
        const staffById = new Set(list.map((s) => s.id));
        const staffByKey = new Map<string, string>();
        const staffByName = new Map<string, string>();
        let salonMonthTotal = 0;

        for (const s of list) {
          const sid = String(s.id || "").trim();
          if (sid) staffByKey.set(sid, sid);
          const nKey = normalizeArabicName(s.name);
          if (nKey) staffByName.set(nKey, sid);
          const nk2 = safeKey(String(s.name || "").trim());
          if (nk2) staffByKey.set(nk2, sid);
        }

        const [statsYear, statsMonth] = thisMonth.split("-").map(Number);
        const monthEndDay = new Date(statsYear, statsMonth, 0).getDate();
        const rows: BookingDocWithId[] = await listBookings({
          dateFrom: `${thisMonth}-01`,
          dateTo: `${thisMonth}-${String(monthEndDay).padStart(2, "0")}`,
        });
        const m: Record<string, StaffBookingStats> = {};

        for (const b of rows) {
          const bMonth = monthKey(String((b as any).date || ""));
          const st = (String((b as any).status || "pending").toLowerCase() ||
            "pending") as BookingStatus;
          const bookingAmount = bookingAmountOf(b);
          const isRevenueStatus = REVENUE_STATUSES.has(st);
          if (bMonth === thisMonth && st !== "cancelled") salonMonthTotal += 1;

          const eid = String((b as any).employeeId || "").trim();
          const euid = String((b as any).employeeUid || "").trim();
          const ekey = String((b as any).employeeKey || "").trim();
          const ename = String((b as any).employeeName || "").trim();

          let staffId: string | null = null;
          if (ekey && staffByKey.has(ekey)) staffId = staffByKey.get(ekey) || null;
          if (!staffId && euid && staffByKey.has(euid))
            staffId = staffByKey.get(euid) || null;
          if (!staffId && eid && staffById.has(eid)) staffId = eid;
          if (!staffId && ename) {
            const k = normalizeArabicName(ename);
            staffId = staffByName.get(k) || null;
          }
          if (!staffId) continue;

          if (!m[staffId]) m[staffId] = initStats();
          m[staffId].total += 1;
          m[staffId].byStatus[st] = (m[staffId].byStatus[st] || 0) + 1;
          if (bMonth === thisMonth && st !== "cancelled") {
            m[staffId].month.staffTotal += 1;
          }
          if (bMonth === thisMonth && isRevenueStatus) {
            m[staffId].month.invoiceCount += 1;
            m[staffId].month.invoiceRevenue += bookingAmount;
          }
        }

        Object.keys(m).forEach((sid) => {
          m[sid].month.salonTotal = salonMonthTotal;
          m[sid].month.sharePct =
            salonMonthTotal > 0 ? Math.round((m[sid].month.staffTotal / salonMonthTotal) * 100) : 0;
        });

        list.forEach((s) => {
          if (!m[s.id]) {
            m[s.id] = initStats();
            m[s.id].month.salonTotal = salonMonthTotal;
          }
        });

        Object.keys(m).forEach((sid) => {
          if (!m[sid].month.sharePct && m[sid].month.salonTotal > 0 && m[sid].month.staffTotal > 0) {
            m[sid].month.sharePct = Math.round(
              (m[sid].month.staffTotal / m[sid].month.salonTotal) * 100
            );
          }
        });

        employeeBookingStatsCache = {
          staffSignature,
          stats: m,
          savedAt: Date.now(),
        };
        if (alive) setBookingStats(m);
      } catch (e) {
        console.warn("booking stats error:", e);
        if (alive) setBookingStats({});
      } finally {
        if (alive) setStatsLoading(false);
      }
    };

    let idleId: number | null = null;
    const run = () => {
      if (alive) void compute();
    };

    if (typeof (window as any).requestIdleCallback === "function") {
      idleId = (window as any).requestIdleCallback(run, { timeout: 1200 });
    } else {
      timer = window.setTimeout(run, 650);
    }

    return () => {
      alive = false;
      if (idleId !== null && typeof (window as any).cancelIdleCallback === "function") {
        (window as any).cancelIdleCallback(idleId);
      }
      window.clearTimeout(timer);
    };
  }, [authUser?.role, isOpen, list, selectedEmployeeId]);

  useEffect(() => {
    if (!selectedEmployeeId) return;
    const selectedIdentity = selectedEmployeeIdentityRef.current;
    const matched = list.find((x) => x.id === selectedEmployeeId || employeeMatchesIdentity(x, selectedIdentity));
    if (matched) {
      if (matched.id !== selectedEmployeeId) {
        setSelectedEmployeeId(matched.id);
        setEditId((current) => (current ? matched.id : current));
        selectedEmployeeIdentityRef.current = employeeIdentityOf(matched);
      }
      return;
    }
    if (loading || saving) return;
    setSelectedEmployeeId(null);
    setEditId(null);
    setIsOpen(false);
    setMode("edit");
  }, [list, loading, saving, selectedEmployeeId]);

  useEffect(() => {
    setModalHourOverrideFromDateHijri(formatHijriInputFromIso(modalHourOverrideFromDate));
  }, [modalHourOverrideFromDate]);

  useEffect(() => {
    setModalHourOverrideToDateHijri(formatHijriInputFromIso(modalHourOverrideToDate));
  }, [modalHourOverrideToDate]);

  useEffect(() => {
    if (!modalHourOverrideHijriPickerOpen) return;
    const onDocClick = (ev: MouseEvent) => {
      const root = modalHourOverrideHijriPickerRef.current;
      if (!root) return;
      const target = ev.target as Node | null;
      if (target && root.contains(target)) return;
      setModalHourOverrideHijriPickerOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [modalHourOverrideHijriPickerOpen]);

  const sectionOptions = useMemo(() => {
    const m = new Map<string, { id: string; label: string }>();
    for (const s of serviceOptions) {
      const sid = String(s.sectionId || "").trim();
      if (!sid) continue;
      if (!m.has(sid)) m.set(sid, { id: sid, label: toArabicSectionLabel(sid, sid) });
    }
    return Array.from(m.values()).sort((a, b) =>
      a.label.localeCompare(b.label, "ar")
    );
  }, [serviceOptions]);

  const filteredServicesForPicks = useMemo(() => {
    let rows = [...serviceOptions];
    if (srvSection !== "all") {
      rows = rows.filter((s) => String(s.sectionId || "").trim() === srvSection);
    }
    const q = srvQ.trim().toLowerCase();
    if (q) {
      rows = rows.filter((s) => {
        const sectionLabel = toArabicSectionLabel(String(s.sectionId || ""), String(s.sectionId || ""));
        return (
          String(s.label || "").toLowerCase().includes(q) ||
          String(s.id || "").toLowerCase().includes(q) ||
          String(sectionLabel || "").toLowerCase().includes(q) ||
          String(s.categoryId || "").toLowerCase().includes(q)
        );
      });
    }
    rows.sort((a, b) => String(a.label).localeCompare(String(b.label), "ar"));
    return rows;
  }, [serviceOptions, srvSection, srvQ]);

  const toggleSpecialty = (serviceId: string) => {
    setSpecialties((prev) =>
      prev.includes(serviceId) ? prev.filter((x) => x !== serviceId) : [...prev, serviceId]
    );
  };

  const savePayrollSettings = async () => {
    if (!canManagePayroll) {
      setErrorMsg("ليست لديك صلاحية لإدارة الرواتب.");
      return;
    }
    const targetEmployeeId = cleanText(selectedEmployeeId || editId || routeEmployeeId);
    const currentEmployee = editingStaff || selectedEmployee;
    if (!targetEmployeeId || !currentEmployee) {
      setErrorMsg("لم يتم تحديد الموظفة.");
      return;
    }
    const cleanName = cleanText(name || currentEmployee.name || targetEmployeeId);
    if (!cleanName) {
      setErrorMsg("اكتب اسم الموظفة قبل حفظ إعدادات الراتب.");
      return;
    }

    setPayrollSettingsSaving(true);
    setErrorMsg("");
    setPayrollSettingsMessage("");
    try {
      const existingCoreEmployee = await CoreHrService.getEmployee(targetEmployeeId).catch(() => null);
      const existingEmployment = (existingCoreEmployee?.employment || {}) as Record<string, unknown>;
      const baseSalaryHalalas = riyalsInputToHalalas(monthlySalary);
      const workDays = payrollSettingsPreview.workDays > 0 ? payrollSettingsPreview.workDays : null;
      const dailyHours = payrollSettingsPreview.dailyHours > 0 ? payrollSettingsPreview.dailyHours : null;
      const monthlyHours = payrollSettingsPreview.monthlyHours > 0 ? payrollSettingsPreview.monthlyHours : null;
      const overtimeMultiplier = payrollOvertimeEnabled
        ? positiveNumberOrZero(payrollOvertimeMultiplier) || 1.5
        : 1.5;
      const employment = {
        ...existingEmployment,
        title: cleanText((currentEmployee as any).title || (currentEmployee as any).jobTitle || existingEmployment.title),
        jobTitle: cleanText((currentEmployee as any).jobTitle || (currentEmployee as any).title || existingEmployment.job_title || existingEmployment.jobTitle),
        department: cleanText((currentEmployee as any).department || existingEmployment.department),
        employmentStatus: active ? "active" : "inactive",
        baseSalaryHalalas,
        expectedWorkDays: workDays,
        expectedWorkHours: monthlyHours,
        dailyScheduledHours: dailyHours,
        overtimeEnabled: payrollOvertimeEnabled,
        overtimeMultiplier,
        payrollDeductionMethod,
      };
      await CoreHrService.saveEmployee({
        id: targetEmployeeId,
        name: cleanName,
        firebaseUid: cleanText((currentEmployee as any).linkedUid || (currentEmployee as any).uid || (currentEmployee as any).employeeUid),
        email: cleanText((currentEmployee as any).email),
        phone: cleanText((currentEmployee as any).phone),
        status: active ? "active" : "inactive",
        employment,
      });

      const compatibilityPatch = {
        monthlySalary: payrollSettingsPreview.baseSalaryRiyals,
        payrollMonthlyHours: monthlyHours || 0,
        payrollOvertimeEnabled,
        payrollOvertimeMultiplier: overtimeMultiplier,
        payrollDeductionMethod,
        overtimeDaysPerMonth: workDays || 0,
        overtimeBaseHoursPerDay: dailyHours || 0,
        updatedAt: serverTimestamp(),
      };
      await setDoc(staffPublicDoc(targetEmployeeId), compatibilityPatch, { merge: true }).catch((error) => {
        console.warn("Saving payroll compatibility fields to staff_public failed:", error);
      });

      setList((current) =>
        current.map((employee) =>
          employee.id === targetEmployeeId
            ? {
                ...employee,
                ...compatibilityPatch,
                updatedAt: employee.updatedAt,
              }
            : employee
        )
      );
      setPayrollSettingsMessage("تم حفظ إعدادات الراتب والدوام في مصدر مسيرات الرواتب.");
    } catch (error) {
      setErrorMsg(toFirestoreErrorMessage(error, "تعذر حفظ إعدادات الراتب."));
    } finally {
      setPayrollSettingsSaving(false);
    }
  };


  useEffect(() => {
    const employeeId =
      cleanText(
        editId
      );

    if (!employeeId) {
      return;
    }

    const refreshCoreExceptionsAfterTemporaryWeeklyOff =
      (
        event: Event
      ) => {
        const detail =
          (
            event as CustomEvent<{
              employeeId?: string;
            }>
          ).detail;

        if (
          cleanText(
            detail?.employeeId
          ) !==
          employeeId
        ) {
          return;
        }

        void CoreHrService
          .listScheduleExceptions({
            employeeId,
          })
          .then(
            (rows) => {
              const canonicalRows =
                Array.isArray(
                  rows
                )
                  ? rows
                  : [];

              setCoreScheduleExceptionRows(
                canonicalRows
              );

              setModalCustomHourOverrides(
                projectCoreScheduleExceptionsToOverrides(
                  canonicalRows
                )
              );

              setCoreScheduleError(
                ""
              );
            }
          )
          .catch(
            (error) => {
              const message =
                "Failed to reload canonical schedule exceptions after temporary weekly-off update: " +
                cleanText(
                  (error as any)?.message ||
                  error
                );

              setCoreScheduleError(
                message
              );

              setErrorMsg(
                message
              );
            }
          );
      };

    window.addEventListener(
      TEMP_WEEKLY_OFF_SYNC_EVENT,
      refreshCoreExceptionsAfterTemporaryWeeklyOff
    );

    return () => {
      window.removeEventListener(
        TEMP_WEEKLY_OFF_SYNC_EVENT,
        refreshCoreExceptionsAfterTemporaryWeeklyOff
      );
    };
  }, [editId]);

  const save = async () => {
    if (!ensureCanManage()) return;
    const cleanName = name.trim();
    const specialtiesFixed = canonicalizeSpecialties(specialties, serviceOptions);
    const effectiveShowOnBooking = specialtiesFixed.length > 0 ? !!showOnBooking : false;
    if (!cleanName) {
      setErrorMsg("اكتب اسم الموظفة");
      return;
    }
    // Allow saving basic data even when no services are assigned.
    // In that case, force-hide from booking until services are added.
    if (specialtiesFixed.length === 0 && showOnBooking) {
      setShowOnBooking(false);
    }
    // ✅ منع "النسيان": موظفة نشطة لكن مخفية من الحجز
    if (active && specialtiesFixed.length > 0 && !effectiveShowOnBooking) {
      const ok = confirm(
        "⚠️ تنبيه: الموظفة لديها خدمات لكنها مخفية من الحجز.\nهل تريد الحفظ بهذا الشكل؟"
      );
      if (!ok) return;
    }

    // احفظ فقط الاستثناءات التي تم إضافتها فعلياً في القائمة.
    // لا نطبق المسودة تلقائياً عند الحفظ حتى لا تعيد القيم القديمة.
    let normalizedCustomHourOverrides = normalizeWorkingHourOverrides(modalCustomHourOverrides);
    const hasPendingOverrideDraft =
      !!normalizeLeaveUntil(modalHourOverrideEditingDate) ||
      (!!normalizeLeaveUntil(modalHourOverrideFromDate) && modalHourOverridePreview.affectedDays > 0);
    if (modalUseCustomWorkingHours && hasPendingOverrideDraft) {
      const draftResult = buildModalWorkingHourOverrides(normalizedCustomHourOverrides);
      if (draftResult.error) {
        setErrorMsg(draftResult.error);
        return;
      }
      if (draftResult.appliedCount > 0) {
        normalizedCustomHourOverrides = draftResult.next;
        setModalCustomHourOverrides(draftResult.next);
      }
    }

    const previousEditSnapshot = editId
      ? {
          active: !!editingStaff?.active,
          onLeave: !!(editingStaff as any)?.onLeave,
          leaveStartDate: normalizeLeaveUntil(
            (editingStaff as any)?.leaveStartDate ||
              (editingStaff as any)?.leaveFrom ||
              (editingStaff as any)?.leaveFromDate
          ),
          leaveUntil: normalizeLeaveUntil((editingStaff as any)?.leaveUntil),
          leaveType: normalizeManagedLeaveType((editingStaff as any)?.leaveType),
          leaveNote: String((editingStaff as any)?.leaveNote || "").trim(),
          leaveRequestId: cleanText((editingStaff as any)?.leaveRequestId),
          coreLeaveId: cleanText((editingStaff as any)?.coreLeaveId),
          employmentEndDate: normalizeLeaveUntil((editingStaff as any)?.employmentEndDate),
        }
      : null;

    const normalizedCustomWorkingHours = normalizeWorkingHours(modalCustomWorkingHours);
    const shouldValidateSchedule = !editId || activeTab === "booking";
    const missingShiftDays = WEEKDAY_OPTIONS.filter((day) => {
      const scheduleDay = normalizedCustomWorkingHours[day.key];
      return scheduleDay?.enabled !== false && !cleanText(scheduleDay?.shiftTemplateId);
    });
    if (shouldValidateSchedule && missingShiftDays.length) {
      setErrorMsg(`اختاري شفتًا لأيام العمل التالية: ${missingShiftDays.map((day) => day.label).join("، ")}`);
      return;
    }
    const scheduleEffectiveFrom =
      coreScheduleDate(
        modalScheduleEffectiveFrom
      );

    if (
      shouldValidateSchedule &&
      editId &&
      coreScheduleLoading
    ) {
      setErrorMsg(
        "\u064a\u062a\u0645 \u062a\u062d\u0645\u064a\u0644 \u062c\u062f\u0648\u0644 \u0627\u0644\u062f\u0648\u0627\u0645 \u0645\u0646 Malikat Core. \u0623\u0639\u064a\u062f\u064a \u0627\u0644\u062d\u0641\u0638 \u0628\u0639\u062f \u0627\u0643\u062a\u0645\u0627\u0644 \u0627\u0644\u062a\u062d\u0645\u064a\u0644."
      );
      return;
    }

    if (
      shouldValidateSchedule &&
      editId &&
      coreScheduleError
    ) {
      setErrorMsg(
        coreScheduleError
      );
      return;
    }

    if (
      shouldValidateSchedule &&
      editId &&
      coreScheduleLoadedEmployeeId !==
        cleanText(editId)
    ) {
      setErrorMsg(
        "\u0644\u0627 \u064a\u0645\u0643\u0646 \u062d\u0641\u0638 \u062c\u062f\u0648\u0644 \u0627\u0644\u062f\u0648\u0627\u0645 \u0642\u0628\u0644 \u062a\u062d\u0645\u064a\u0644 \u0645\u0635\u062f\u0631 Malikat Core \u0627\u0644\u0645\u0639\u062a\u0645\u062f."
      );
      return;
    }

    const previousCoreWorkingHours =
      editId
        ? resolveCoreScheduleEditorRows(
            coreScheduleRows,
            scheduleEffectiveFrom ||
              todayIso()
          )
        : emptyCoreScheduleEditorRows();

    const scheduleChanged =
      shouldValidateSchedule &&
      (
        !editId ||
        !coreScheduleEditorRowsEqual(
          previousCoreWorkingHours,
          normalizedCustomWorkingHours
        )
      );

    let scheduleChangeReason =
      cleanText(
        modalScheduleChangeReason
      );

    if (
      scheduleChanged &&
      !scheduleEffectiveFrom
    ) {
      setErrorMsg(
        "\u062d\u062f\u062f\u064a \u062a\u0627\u0631\u064a\u062e \u0628\u062f\u0621 \u062a\u0637\u0628\u064a\u0642 \u062c\u062f\u0648\u0644 \u0627\u0644\u062f\u0648\u0627\u0645 \u0627\u0644\u062c\u062f\u064a\u062f."
      );
      return;
    }

    if (
      editId &&
      scheduleChanged &&
      !scheduleChangeReason
    ) {
      const changedClosedDays =
        WEEKDAY_OPTIONS
          .filter(
            (day) => {
              const previousEnabled =
                previousCoreWorkingHours[
                  day.key
                ]?.enabled !== false;

              const nextEnabled =
                normalizedCustomWorkingHours[
                  day.key
                ]?.enabled !== false;

              return (
                previousEnabled !==
                nextEnabled
              );
            }
          )
          .map(
            (day) =>
              day.label
          );

      scheduleChangeReason =
        changedClosedDays.length
          ? `\u062a\u0639\u062f\u064a\u0644 \u0627\u0644\u0625\u062c\u0627\u0632\u0629 \u0627\u0644\u0623\u0633\u0628\u0648\u0639\u064a\u0629: ${changedClosedDays.join("\u060c ")}`
          : "\u062a\u062d\u062f\u064a\u062b \u062c\u062f\u0648\u0644 \u062f\u0648\u0627\u0645 \u0627\u0644\u0645\u0648\u0638\u0641\u0629";

      setModalScheduleChangeReason(
        scheduleChangeReason
      );
    }

    setSaving(true);
    setErrorMsg("");
    setSaveMessage("");
    const normalizedModalLeaveFrom = normalizeLeaveUntil(modalLeaveFrom);
    const normalizedModalLeaveUntil = normalizeLeaveUntil(modalLeaveUntil);
    const normalizedModalLeaveType = normalizeManagedLeaveType(modalLeaveType);
    const normalizedEmploymentEndDate = normalizeLeaveUntil(employmentEndDate);
    const normalizedAttendanceZoneId = String(selectedAttendanceZoneId || "").trim();
    const modalLeaveExpired = !!normalizedModalLeaveUntil && normalizedModalLeaveUntil < todayIso();
    const effectiveModalOnLeave = modalOnLeave && !modalLeaveExpired;
    const normalizedExceptionalDates = editId
      ? normalizeExceptionalLeaveDates((editingStaff as any)?.exceptionalLeaveDates)
      : [];
    const generatedEmployeeId = !editId
      ? cleanName
          .replace(/\s+/g, "_")
          .replace(/[^\w\u0600-\u06FF_]/g, "")
          .slice(0, 40) || crypto.randomUUID()
      : "";
    const targetEmployeeId = cleanText(
      editId
        ? (editingStaff as any)?.staffPublicDocId ||
            ((editingStaff as any)?.source === "staff_public" ? (editingStaff as any)?.sourceDocId : "") ||
            editId
        : generatedEmployeeId
    );
    const linkedUidForSave = cleanText(
      (editingStaff as any)?.linkedUid ||
        (editingStaff as any)?.employeeUid ||
        (editingStaff as any)?.authUid ||
        (editingStaff as any)?.uid ||
        (editingStaff as any)?.userId ||
        (editingStaff as any)?.linkedUserId
    );
    employeeSaveDebug("start", {
      mode: editId ? "edit" : "create",
      activeTab,
    });
    employeeSaveDebug("target identity", {
      employeeId: targetEmployeeId,
      source: (editingStaff as any)?.source || "new",
      sourceDocId: cleanText((editingStaff as any)?.sourceDocId),
      staffPublicDocId: cleanText((editingStaff as any)?.staffPublicDocId),
      hasLinkedUid: !!linkedUidForSave,
    });


    const coreExceptionBaselineReady =
      !editId ||
      coreScheduleLoadedEmployeeId ===
        targetEmployeeId;

    if (!coreExceptionBaselineReady) {
      setErrorMsg(
        "Canonical schedule exceptions are not loaded for this employee. Reload the employee and try again."
      );
      return;
    }

    const expectedCoreCustomHourOverrides =
      editId
        ? projectCoreScheduleExceptionsToOverrides(
            coreScheduleExceptionRows
          )
        : [];

    const workingHourOverridesChanged =
      !workingHourOverridesEqual(
        expectedCoreCustomHourOverrides,
        normalizedCustomHourOverrides
      );

    const payload: StaffPublicDoc = {
      uid: cleanText((editingStaff as any)?.uid || linkedUidForSave),
      linkedUid: linkedUidForSave,
      linkedUserId: cleanText((editingStaff as any)?.linkedUserId || linkedUidForSave),
      employeeUid: cleanText((editingStaff as any)?.employeeUid || linkedUidForSave),
      authUid: cleanText((editingStaff as any)?.authUid),
      userId: cleanText((editingStaff as any)?.userId || (editingStaff as any)?.linkedUserId || linkedUidForSave),
      employeeId: targetEmployeeId,
      employeeDocId: targetEmployeeId,
      linkedEmployeeDocId: targetEmployeeId,
      email: cleanText((editingStaff as any)?.email),
      phone: cleanText((editingStaff as any)?.phone),
      role: cleanText((editingStaff as any)?.role || "staff"),
      department: cleanText((editingStaff as any)?.department),
      title: cleanText((editingStaff as any)?.title),
      employeeProfileEnabled: (editingStaff as any)?.employeeProfileEnabled !== false,
      includeInEmployeeManagement,
      name: cleanName,
      active: !!active,
      showOnAbout: !!showOnAbout,
      showOnBooking: effectiveShowOnBooking,
      employmentEndDate: normalizedEmploymentEndDate,
      onLeave: effectiveModalOnLeave,
      leaveStartDate: effectiveModalOnLeave ? normalizedModalLeaveFrom : "",
      leaveUntil: effectiveModalOnLeave ? normalizedModalLeaveUntil : "",
      leaveType: effectiveModalOnLeave ? normalizedModalLeaveType : "",
      leaveNote: effectiveModalOnLeave ? String(modalLeaveNote || "").trim() : "",
      leaveRequestId: effectiveModalOnLeave ? cleanText((editingStaff as any)?.leaveRequestId) : "",
      coreLeaveId: effectiveModalOnLeave ? cleanText((editingStaff as any)?.coreLeaveId) : "",
      exceptionalLeaveDates: normalizedExceptionalDates,
      allowedAttendanceZoneId: normalizedAttendanceZoneId,
      attendanceZoneId: normalizedAttendanceZoneId,
      assignedAttendanceZoneId: normalizedAttendanceZoneId,
      attendanceScopeId: normalizedAttendanceZoneId,
      allowedZoneIds: normalizedAttendanceZoneId ? [normalizedAttendanceZoneId] : [],
      monthlySalary: safeNonNegativeNumber(monthlySalary, 0),
      payrollMonthlyHours: payrollSettingsPreview.monthlyHours,
      payrollOvertimeEnabled,
      payrollOvertimeMultiplier: payrollOvertimeEnabled
        ? positiveNumberOrZero(payrollOvertimeMultiplier) || 1.5
        : 1.5,
      payrollDeductionMethod,
      overtimeMethod:
        overtimeMethod === "invoice_percentage" ? "invoice_percentage" : "hours_from_salary",
      overtimeDaysPerMonth: safeNonNegativeNumber(overtimeDaysPerMonth, 0),
      overtimeBaseHoursPerDay: safeNonNegativeNumber(overtimeBaseHoursPerDay, 0),
      overtimeSeasonBaseHoursPerDay: Math.max(
        1,
        safeNonNegativeNumber(overtimeSeasonBaseHoursPerDay, 6)
      ),
      overtimeHoursBasis: overtimeHoursBasis === "season" ? "season" : "regular",
      overtimePercent: safeNonNegativeNumber(overtimePercent, 0),
      overtimeInvoicePercent: safeNonNegativeNumber(overtimeInvoicePercent, 0),

      specialties: specialtiesFixed,
      bio: bio.trim(),
      avatarUrl: avatarUrl.trim(),
      cvUrl: cvUrl.trim(),
      rating: Math.min(5, safeNonNegativeNumber(rating, 0)),
      reviewsCount: Math.floor(safeNonNegativeNumber(reviewsCount, 0)),
      updatedAt: serverTimestamp(),
    };
    const saveVerificationServiceOptions = serviceOptionsRef.current.length
      ? serviceOptionsRef.current
      : serviceOptions;
    const expectedSaveSnapshot = buildEmployeeSaveVerificationSnapshot(
      payload,
      saveVerificationServiceOptions
    );
    const attendanceZoneProfilePatch = {
      allowedZoneIds: normalizedAttendanceZoneId ? [normalizedAttendanceZoneId] : [],
      allowedAttendanceZoneId: normalizedAttendanceZoneId,
      attendanceZoneId: normalizedAttendanceZoneId,
      assignedAttendanceZoneId: normalizedAttendanceZoneId,
      attendanceScopeId: normalizedAttendanceZoneId,
    };
    const employeeProfilePatch = {
      employment: attendanceZoneProfilePatch,
    };
    try {
      await CoreHrService.saveEmployee({
        id:
          targetEmployeeId,

        name:
          cleanName,

        firebaseUid:
          cleanText(
            payload.linkedUid ||
            payload.uid ||
            payload.linkedUserId
          ),

        email:
          cleanText(
            payload.email
          ),

        phone:
          cleanText(
            payload.phone
          ),

        status:
          active
            ? "active"
            : "inactive",

        employment: {
          employmentStatus:
            active
              ? "active"
              : "inactive",

          allowedZoneIds:
            normalizedAttendanceZoneId
              ? [
                  normalizedAttendanceZoneId,
                ]
              : [],
        },
      });

      if (workingHourOverridesChanged) {
        const workingHourSync =
          await CoreHrService
            .syncWorkingHourScheduleExceptions({
              employeeId:
                targetEmployeeId,

              expectedOverrides:
                expectedCoreCustomHourOverrides.map(
                  (row) => ({
                    ...row,
                  })
                ),

              desiredOverrides:
                normalizedCustomHourOverrides.map(
                  (row) => ({
                    ...row,
                  })
                ),
            });

        employeeSaveDebug(
          "core working-hour exceptions sync success",
          {
            employeeId:
              targetEmployeeId,

            createdCount:
              workingHourSync.createdCount,

            cancelledCount:
              workingHourSync.cancelledCount,
          }
        );
      }

      await CoreStaffService
        .update(
          targetEmployeeId,
          {
            name:
              cleanName,

            firebaseUid:
              cleanText(
                payload.linkedUid ||
                payload.uid ||
                payload.linkedUserId
              ),

            phone:
              cleanText(
                payload.phone
              ),

            active:
              !!active,

            employmentStatus:
              active
                ? "active"
                : "inactive",

            showOnBooking:
              !!active &&
              effectiveShowOnBooking,

            specialties:
              specialtiesFixed,

            avatarUrl:
              avatarUrl.trim(),

            leaveStartDate:
              effectiveModalOnLeave
                ? normalizedModalLeaveFrom
                : "",

            leaveEndDate:
              effectiveModalOnLeave
                ? normalizedModalLeaveUntil
                : "",

            leaveNote:
              effectiveModalOnLeave
                ? String(
                    modalLeaveNote ||
                    ""
                  ).trim()
                : "",
          }
        )
        .catch(
          (staffSyncError) => {
            console.warn(
              "Core staff booking sync failed after employee save:",
              staffSyncError
            );
          }
        );

      if (scheduleChanged) {
        const versionDate =
          scheduleEffectiveFrom ||
          todayIso();

        await CoreHrService
          .replaceSchedules(
            targetEmployeeId,

            WEEKDAY_OPTIONS.map(
              (day) => {
                const scheduleDay =
                  normalizedCustomWorkingHours[
                    day.key
                  ] || {
                    enabled: false,
                  };

                const enabled =
                  scheduleDay.enabled !==
                  false;

                return {
                  id:
                    `${targetEmployeeId}-${day.key}-${versionDate}`,

                  salonId:
                    SALON_ID,

                  employeeId:
                    targetEmployeeId,

                  weekday:
                    CORE_WEEKDAY_NUMBER[
                      day.key
                    ],

                  shiftTemplateId:
                    enabled
                      ? cleanText(
                          scheduleDay
                            .shiftTemplateId
                        )
                      : null,

                  active:
                    enabled,

                  scheduleSource:
                    enabled
                      ? "shift_template"
                      : "weekly_off",

                  effectiveFrom:
                    versionDate,

                  effectiveTo:
                    null,
                };
              }
            )
          );
      }

      if (!editId) {
        await setDoc(staffPublicDoc(targetEmployeeId), {
          ...payload,
          employeeId: targetEmployeeId,
          employment: attendanceZoneProfilePatch,
          employeeProfile: employeeProfilePatch,
          leaveBalanceDays: 0,
          leaveEntitlementDate: "",
          leaveEntries: [],
          createdAt: serverTimestamp(),
        });
        employeeSaveDebug("firestore staff_public success", { employeeId: targetEmployeeId });
        await setDoc(doc(db, "salons", SALON_ID, "employees", targetEmployeeId), {
          employeeId: targetEmployeeId,
          name: cleanName,
          active: !!active,
          employeeProfileEnabled: payload.employeeProfileEnabled,
          includeInEmployeeManagement,
          showOnAbout: !!showOnAbout,
          showOnBooking: effectiveShowOnBooking,
          employmentEndDate: normalizedEmploymentEndDate,
          allowedAttendanceZoneId: normalizedAttendanceZoneId,
          attendanceZoneId: normalizedAttendanceZoneId,
          assignedAttendanceZoneId: normalizedAttendanceZoneId,
          attendanceScopeId: normalizedAttendanceZoneId,
          employment: attendanceZoneProfilePatch,
          employeeProfile: employeeProfilePatch,
          monthlySalary: payload.monthlySalary,
          payrollMonthlyHours: payload.payrollMonthlyHours,
          payrollOvertimeEnabled: payload.payrollOvertimeEnabled,
          payrollOvertimeMultiplier: payload.payrollOvertimeMultiplier,
          payrollDeductionMethod: payload.payrollDeductionMethod,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
        employeeSaveDebug("employees sync success", { employeeId: targetEmployeeId });
      } else {
        await setDoc(staffPublicDoc(targetEmployeeId), {
          ...(payload as any),
          employeeId: targetEmployeeId,
          employeeDocId: targetEmployeeId,
          linkedEmployeeDocId: targetEmployeeId,
          "employment.allowedZoneIds": attendanceZoneProfilePatch.allowedZoneIds,
          "employment.allowedAttendanceZoneId": normalizedAttendanceZoneId,
          "employment.attendanceZoneId": normalizedAttendanceZoneId,
          "employment.assignedAttendanceZoneId": normalizedAttendanceZoneId,
          "employment.attendanceScopeId": normalizedAttendanceZoneId,
          "employeeProfile.employment.allowedZoneIds": attendanceZoneProfilePatch.allowedZoneIds,
          "employeeProfile.employment.allowedAttendanceZoneId": normalizedAttendanceZoneId,
          "employeeProfile.employment.attendanceZoneId": normalizedAttendanceZoneId,
          "employeeProfile.employment.assignedAttendanceZoneId": normalizedAttendanceZoneId,
          "employeeProfile.employment.attendanceScopeId": normalizedAttendanceZoneId,
        }, { merge: true });
        employeeSaveDebug("firestore staff_public success", { employeeId: targetEmployeeId });
        await setDoc(doc(db, "salons", SALON_ID, "employees", targetEmployeeId), {
          employeeId: targetEmployeeId,
          name: cleanName,
          active: !!active,
          employeeProfileEnabled: payload.employeeProfileEnabled,
          includeInEmployeeManagement,
          showOnAbout: !!showOnAbout,
          showOnBooking: effectiveShowOnBooking,
          employmentEndDate: normalizedEmploymentEndDate,
          allowedAttendanceZoneId: normalizedAttendanceZoneId,
          attendanceZoneId: normalizedAttendanceZoneId,
          assignedAttendanceZoneId: normalizedAttendanceZoneId,
          attendanceScopeId: normalizedAttendanceZoneId,
          employment: attendanceZoneProfilePatch,
          employeeProfile: employeeProfilePatch,
          monthlySalary: payload.monthlySalary,
          payrollMonthlyHours: payload.payrollMonthlyHours,
          payrollOvertimeEnabled: payload.payrollOvertimeEnabled,
          payrollOvertimeMultiplier: payload.payrollOvertimeMultiplier,
          payrollDeductionMethod: payload.payrollDeductionMethod,
          updatedAt: serverTimestamp(),
        }, { merge: true });
        employeeSaveDebug("employees sync success", { employeeId: targetEmployeeId });
      }

      const refreshedCoreEmployee =
        await CoreHrService
          .getEmployee(
            targetEmployeeId
          );


      const refreshedCoreExceptionRows =
        await CoreHrService
          .listScheduleExceptions({
            employeeId:
              targetEmployeeId,
          });

      const refreshedCoreSchedules =
        Array.isArray(
          refreshedCoreEmployee
            .schedules
        )
          ? refreshedCoreEmployee
              .schedules
          : [];

      setCoreScheduleRows(
        refreshedCoreSchedules
      );

      setCoreScheduleExceptionRows(
        refreshedCoreExceptionRows
      );

      setModalCustomHourOverrides(
        projectCoreScheduleExceptionsToOverrides(
          refreshedCoreExceptionRows
        )
      );

      setCoreScheduleLoadedEmployeeId(
        targetEmployeeId
      );

      setCoreScheduleVersionCount(
        countCoreScheduleVersions(
          refreshedCoreSchedules
        )
      );

      setCoreScheduleError("");
      setCoreScheduleLoading(false);

      if (
        scheduleChanged ||
        workingHourOverridesChanged
      ) {
        setCoreResolvedTodayRefreshVersion(
          (version) => version + 1
        );
      }

      employeeSaveDebug(
        "core sync success",
        {
          employeeId:
            targetEmployeeId,

          scheduleChanged,
        }
      );

      selectedEmployeeIdentityRef.current = {
        id: targetEmployeeId,
        linkedUid: cleanText(payload.linkedUid || payload.uid || payload.linkedUserId),
        employeeId: cleanText(payload.employeeId || targetEmployeeId),
        email: cleanText(payload.email).toLowerCase(),
        name: cleanText(payload.name).toLowerCase(),
      };
      setSelectedEmployeeId(targetEmployeeId);
      setEditId(targetEmployeeId);
      setIsOpen(true);
      setMode("edit");
      if (!editId) {
        setActiveTab("basic");
        setModalTab("basic");
        navigate(`/dashboard/employees/${encodeURIComponent(targetEmployeeId)}/basic`);
      }

      if (previousEditSnapshot && editingStaff) {
        const leaveChanged =
          previousEditSnapshot.onLeave !== effectiveModalOnLeave ||
          previousEditSnapshot.leaveStartDate !== normalizedModalLeaveFrom ||
          previousEditSnapshot.leaveUntil !== normalizedModalLeaveUntil ||
          previousEditSnapshot.leaveType !== normalizedModalLeaveType ||
          previousEditSnapshot.leaveNote !== String(modalLeaveNote || "").trim();
        const employmentChanged =
          previousEditSnapshot.active !== !!active ||
          previousEditSnapshot.employmentEndDate !== normalizedEmploymentEndDate;

        if (leaveChanged || employmentChanged) {
          const target = resolveStaffNotificationTarget(editingStaff);
          await createEmployeeNotification({
            targetUid: target.targetUid || undefined,
            targetEmployeeId: target.targetEmployeeId || undefined,
            type: leaveChanged ? "leave" : "system",
            title: leaveChanged ? "تم تحديث حالة الإجازة" : "تم تحديث حالة الموظفة",
            body: leaveChanged
              ? `${effectiveModalOnLeave ? "في إجازة" : "متاحة للعمل"}${normalizedModalLeaveFrom ? ` من ${normalizedModalLeaveFrom}` : ""}${normalizedModalLeaveUntil ? ` حتى ${normalizedModalLeaveUntil}` : ""}${String(modalLeaveNote || "").trim() ? ` - ${String(modalLeaveNote || "").trim()}` : ""}`
              : `${!!active ? "نشطة" : "غير نشطة"}${normalizedEmploymentEndDate ? ` - ينتهي التوظيف في ${normalizedEmploymentEndDate}` : ""}`,
            route: leaveChanged ? "/employee/leave" : "/employee/profile",
          }).catch((notificationError) => {
            console.warn("createEmployeeNotification after employee save failed:", notificationError);
          });
        }
      }

      const savedStaffSnap = await getDocFromServer(staffPublicDoc(targetEmployeeId));
      employeeSaveDebug("firestore verify", {
        employeeId: targetEmployeeId,
        fromServer: true,
        staffPublicExists: savedStaffSnap.exists(),
      });
      if (!savedStaffSnap.exists()) {
        throw new Error("تعذر قراءة ملف الموظفة من staff_public بعد الحفظ.");
      }
      const persistedSaveSnapshot = buildEmployeeSaveVerificationSnapshot(
        savedStaffSnap.data() as Partial<StaffPublicDoc>,
        saveVerificationServiceOptions
      );
      verifyEmployeeSaveSnapshot(
        "staff_public",
        expectedSaveSnapshot,
        persistedSaveSnapshot
      );
      const activeTabBeforeReload = activeTab;
      const modalTabBeforeReload = modalTab;
      const reloadedRows = await load(saveVerificationServiceOptions, {
        fromServer: true,
        strict: true,
      });
      const reloadedEmployee = findSavedEmployeeReloadRow(
        reloadedRows,
        targetEmployeeId,
        selectedEmployeeIdentityRef.current
      );
      if (!reloadedEmployee) {
        throw new Error("تعذر إعادة تحميل الموظفة من السيرفر بعد الحفظ.");
      }
      const rehydratedSaveSnapshot = buildEmployeeSaveVerificationSnapshot(
        reloadedEmployee,
        saveVerificationServiceOptions
      );
      verifyEmployeeSaveSnapshot(
        "reload",
        expectedSaveSnapshot,
        rehydratedSaveSnapshot
      );
      openEdit(reloadedEmployee, false);
      setActiveTab(activeTabBeforeReload);
      setModalTab(
        ["basic", "profile", "services", "booking"].includes(activeTabBeforeReload)
          ? (activeTabBeforeReload as EmployeeModalTab)
          : modalTabBeforeReload
      );
      selectedEmployeeIdentityRef.current = employeeIdentityOf(reloadedEmployee);
      window.dispatchEvent(new Event("queens:staff-updated"));
      setSaveMessage(
        "\u062a\u0645 \u062d\u0641\u0638 \u0627\u0644\u062a\u063a\u064a\u064a\u0631\u0627\u062a \u0628\u0646\u062c\u0627\u062d"
      );

      employeeSaveDebug(
        "completed",
        {
          employeeId:
            targetEmployeeId,

          coreSynced:
            true,
        }
      );
    } catch (e) {
      console.error("save employee profile failed", {
        staffPublicPath: `salons/${SALON_ID}/staff_public/${targetEmployeeId}`,
        employeePath: `salons/${SALON_ID}/employees/${targetEmployeeId}`,
        editingSource: (editingStaff as any)?.source || null,
        linkedUid: cleanText(payload.linkedUid || payload.uid || payload.linkedUserId),
      }, e);
      setSaveMessage("");
      setErrorMsg(toFirestoreErrorMessage(e, "تعذر حفظ الموظفة."));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!ensureCanDelete()) return;
    const target = list.find((row) => row.id === id);
    if (!confirm(`هل تريد أرشفة الموظفة "${target?.name || id}"؟\nستختفي من الحجوزات الجديدة مع بقاء الحجوزات التاريخية.`)) return;
    setSaving(true);
    setErrorMsg("");
    const previousList = list;
    try {
      setList((rows) => rows.filter((row) => row.id !== id));
      await archiveEmployee({
        employeeId: id,
        linkedUids: [target?.linkedUid, target?.uid, target?.linkedUserId, target?.employeeUid],
        deletedBy: authUser?.uid,
      });
      if (selectedEmployeeId === id) {
        setSelectedEmployeeId(null);
        setEditId(null);
        setIsOpen(false);
        setMode("edit");
      }
      setBookingStats((stats) => {
        const next = { ...stats };
        delete next[id];
        return next;
      });
      window.dispatchEvent(new Event("queens:staff-updated"));
    } catch (e) {
      setList(previousList);
      setErrorMsg(toFirestoreErrorMessage(e, "تعذر حذف الموظفة."));
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    let rows = [...list];

    if (directoryVisibility === "visible") {
      rows = rows.filter(
        (x) => (x as any).includeInEmployeeManagement !== false
      );
    } else if (directoryVisibility === "hidden") {
      rows = rows.filter(
        (x) => (x as any).includeInEmployeeManagement === false
      );
    }
    if (onlyActive === "active") rows = rows.filter((x) => x.active);
    if (onlyActive === "inactive") rows = rows.filter((x) => !x.active);
    if (specialtyFilter === "none") {
      rows = rows.filter((x) => normalizeSpecialties(x.specialties).length === 0);
    } else if (specialtyFilter !== "all") {
      rows = rows.filter((x) => normalizeSpecialties(x.specialties).includes(specialtyFilter));
    }
    const t = qText.trim().toLowerCase();
    if (t) {
      rows = rows.filter((x) => {
        const searchable = [
          x.name,
          x.bio,
          x.email,
          x.phone,
          x.employeeId,
          x.linkedUid,
          x.department,
          x.title,
          x.partnerName,
          x.partnerId,
          x.employmentSource,
        ]
          .map((value) => cleanText(value).toLowerCase())
          .join(" ");
        return searchable.includes(t);
      });
    }
    return rows;
  }, [list, directoryVisibility, onlyActive, specialtyFilter, qText]);
  const selectedEmployee = useMemo(() => {
    if (!selectedEmployeeId) return null;
    const selectedIdentity = selectedEmployeeIdentityRef.current;
    return (
      list.find((x) => x.id === selectedEmployeeId) ||
      list.find((x) => employeeMatchesIdentity(x, selectedIdentity)) ||
      null
    );
  }, [list, selectedEmployeeId]);
  const selectedEmployeeLeaveUntil = normalizeLeaveUntil((selectedEmployee as any)?.leaveUntil);
  const selectedEmployeeLeaveExpired =
    !!selectedEmployeeLeaveUntil && selectedEmployeeLeaveUntil < todayIso();
  const selectedEmployeeOnLeave =
    !!(selectedEmployee as any)?.onLeave && !selectedEmployeeLeaveExpired;
  const selectedEmployeeStatusLabel = selectedEmployeeOnLeave
    ? selectedEmployeeLeaveUntil
      ? `في إجازة حتى ${fmtIsoDate(selectedEmployeeLeaveUntil)}`
      : "في إجازة"
    : selectedEmployee?.active
      ? "نشطة"
      : "غير نشطة";
  const selectedEmployeeStatusClass = selectedEmployeeOnLeave
    ? "warn"
    : selectedEmployee?.active
      ? "on"
      : "off";
  const isEmployeeOnLeave = (employee: { onLeave?: boolean; leaveUntil?: string }) => {
    const leaveUntil = normalizeLeaveUntil(employee?.leaveUntil);
    return !!employee?.onLeave && (!leaveUntil || leaveUntil >= todayIso());
  };
  const serviceEmployeeRows = list.filter(
    (employee) =>
      employee.employeeKind !== "administrative"
  );

  const totalEmployeeCount = list.length;

  const availableEmployeeCount =
    serviceEmployeeRows.filter(
      (employee) =>
        employee.active &&
        !isEmployeeOnLeave(employee)
    ).length;

  const leaveEmployeeCount =
    serviceEmployeeRows.filter(
      (employee) =>
        isEmployeeOnLeave(employee)
    ).length;

  const inactiveEmployeeCount =
    serviceEmployeeRows.filter(
      (employee) => !employee.active
    ).length;

  const noServiceEmployeeCount =
    serviceEmployeeRows.filter(
      (employee) =>
        normalizeSpecialties(
          employee.specialties
        ).length === 0
    ).length;
  const incompleteEmployeeCount = list.filter((employee) => employee.profileIncomplete).length;
  const showPayrollSubTab = selectedEmployeeId ? activeTab === "payroll" : activeStatsSubTab === "payroll";
  const showStatsSubTab = selectedEmployeeId ? activeTab === "leave" : activeStatsSubTab === "stats";

  const coreResolvedTodayDateKey = todayIso();

  useEffect(() => {
    const handleCanonicalScheduleChange = () => {
      setCoreResolvedTodayRefreshVersion(
        (version) => version + 1
      );
    };

    window.addEventListener(
      TEMP_WEEKLY_OFF_SYNC_EVENT,
      handleCanonicalScheduleChange
    );

    return () => {
      window.removeEventListener(
        TEMP_WEEKLY_OFF_SYNC_EVENT,
        handleCanonicalScheduleChange
      );
    };
  }, []);

  useEffect(() => {
    const employeeIds =
      uniqueCleanTexts(
        list.map(
          (employee) =>
            employee.id
        )
      );

    if (!employeeIds.length) {
      setCoreResolvedTodayByEmployeeId({});
      setCoreResolvedTodayLoading(false);
      setCoreResolvedTodayError("");
      return;
    }

    let cancelled = false;

    setCoreResolvedTodayLoading(true);
    setCoreResolvedTodayError("");

    CoreHrService
      .resolveEmployeeShiftsBatch({
        employeeIds,
        dateFrom:
          coreResolvedTodayDateKey,
        dateTo:
          coreResolvedTodayDateKey,
      })
      .then((result) => {
        if (cancelled) {
          return;
        }

        const resolvedByEmployeeId:
          Record<
            string,
            CoreResolvedShift | null
          > = {};

        employeeIds.forEach(
          (employeeId) => {
            resolvedByEmployeeId[
              employeeId
            ] = null;
          }
        );

        result.rows.forEach(
          (row) => {
            const employeeId =
              cleanText(
                (row as any).employeeId ||
                (row as any).employee_id
              );

            if (!employeeId) {
              return;
            }

            resolvedByEmployeeId[
              employeeId
            ] = row;
          }
        );

        setCoreResolvedTodayByEmployeeId(
          resolvedByEmployeeId
        );
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        console.warn(
          "dashboard employee canonical today shift load failed",
          error
        );

        setCoreResolvedTodayByEmployeeId(
          {}
        );

        setCoreResolvedTodayError(
          "تعذر تحميل الدوام الفعلي الحالي من Malikat Core."
        );
      })
      .finally(() => {
        if (!cancelled) {
          setCoreResolvedTodayLoading(
            false
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    coreResolvedTodayDateKey,
    coreResolvedTodayRefreshVersion,
    list,
  ]);
  useEffect(() => {
    const employeeId =
      cleanText(editId);

    const targetStaff =
      employeeId
        ? list.find(
            (employee) =>
              cleanText(employee.id) ===
              employeeId
          ) || null
        : null;

    if (!employeeId || !targetStaff) {
      setCoreResolvedFutureRows([]);
      setCoreResolvedFutureEmployeeId("");
      setCoreResolvedFutureLoading(false);
      setCoreResolvedFutureError("");
      return;
    }

    const futureLeaveUntil =
      normalizeLeaveUntil(
        (targetStaff as any).leaveUntil
      );

    const ongoingLeaveWithoutEnd =
      !!(targetStaff as any).onLeave &&
      !futureLeaveUntil;

    setCoreResolvedFutureEmployeeId(
      employeeId
    );

    if (ongoingLeaveWithoutEnd) {
      setCoreResolvedFutureRows([]);
      setCoreResolvedFutureLoading(false);
      setCoreResolvedFutureError("");
      return;
    }

    const rangeStart =
      futureLeaveUntil &&
      futureLeaveUntil >=
        coreResolvedTodayDateKey
        ? addDaysIso(
            futureLeaveUntil,
            1
          )
        : addDaysIso(
            coreResolvedTodayDateKey,
            1
          );

    const firstRangeEnd =
      addDaysIso(
        rangeStart,
        61
      );

    const secondRangeStart =
      addDaysIso(
        firstRangeEnd,
        1
      );

    const secondRangeEnd =
      addDaysIso(
        secondRangeStart,
        57
      );

    let cancelled = false;

    setCoreResolvedFutureRows([]);
    setCoreResolvedFutureLoading(true);
    setCoreResolvedFutureError("");

    Promise.all([
      CoreHrService.resolveEmployeeShiftsBatch({
        employeeIds: [employeeId],
        dateFrom: rangeStart,
        dateTo: firstRangeEnd,
      }),
      CoreHrService.resolveEmployeeShiftsBatch({
        employeeIds: [employeeId],
        dateFrom: secondRangeStart,
        dateTo: secondRangeEnd,
      }),
    ])
      .then(
        ([
          firstRange,
          secondRange,
        ]) => {
          if (cancelled) {
            return;
          }

          const rows =
            [
              ...firstRange.rows,
              ...secondRange.rows,
            ]
              .filter(
                (row) =>
                  cleanText(
                    row.employeeId ||
                    row.employee_id
                  ) === employeeId
              )
              .sort(
                (left, right) =>
                  cleanText(left.date).localeCompare(
                    cleanText(right.date)
                  )
              );

          setCoreResolvedFutureRows(
            rows
          );
        }
      )
      .catch((error) => {
        if (cancelled) {
          return;
        }

        console.warn(
          "dashboard employee canonical future shift load failed",
          error
        );

        setCoreResolvedFutureRows([]);

        setCoreResolvedFutureError(
          "تعذر تحميل الدوام المستقبلي من Malikat Core."
        );
      })
      .finally(() => {
        if (!cancelled) {
          setCoreResolvedFutureLoading(
            false
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    coreResolvedTodayDateKey,
    coreResolvedTodayRefreshVersion,
    editId,
    list,
  ]);

  const staffScheduleSummary = useMemo(() => {
    const now = new Date(nowTick);
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const today = `${yyyy}-${mm}-${dd}`;
    const timeNow = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const weekday = weekdayFromIso(today);
    const booking = (appSettings as any)?.booking || {};
    const businessHours = (booking as any)?.businessHours || {};
    const bookingHourOverrides = readBookingHourOverrides((booking as any)?.bookingHourOverrides);

    const dayKey = weekday || "sat";
    const dayHoursBase = (businessHours as any)?.[dayKey] || {
      enabled: true,
      start: DEFAULT_OPEN_TIME,
      end: DEFAULT_CLOSE_TIME,
    };

    const salonWeeklyEnabled = dayHoursBase?.enabled !== false;
    const salonWeeklyOpen = normalizeTimeHHMM(dayHoursBase?.start) || DEFAULT_OPEN_TIME;
    const salonWeeklyClose = normalizeTimeHHMM(dayHoursBase?.end) || DEFAULT_CLOSE_TIME;
    let salonEnabled = salonWeeklyEnabled;
    let salonOpen = salonWeeklyOpen;
    let salonClose = salonWeeklyClose;
    let salonSourceLabel = "أسبوعي";
    let activeSalonOverride:
      | {
          sourceIndex: number;
          fromDate: string;
          toDate: string;
          mode: BookingHourOverrideMode;
          windowLabel: string;
          includeDays: WeekdayKey[];
          blockedDays: WeekdayKey[];
        }
      | null = null;

    for (let i = bookingHourOverrides.length - 1; i >= 0; i--) {
      const ov = bookingHourOverrides[i];
      if (today < ov.fromDate || today > ov.toDate) continue;
      const includeDays = Array.isArray(ov?.includeWeekdays) ? ov.includeWeekdays : [];
      if (includeDays.length > 0 && !includeDays.includes(dayKey)) continue;
      const blockedDays = Array.isArray(ov?.blockedWeekdays) ? ov.blockedWeekdays : [];
      if (blockedDays.includes(dayKey) || String(ov?.mode || "").trim() === "closed") {
        salonEnabled = false;
        salonSourceLabel = "استثناء فعلي";
        activeSalonOverride = {
          sourceIndex: i,
          fromDate: ov.fromDate,
          toDate: ov.toDate,
          mode: "closed",
          windowLabel: "إغلاق كامل اليوم",
          includeDays: includeDays as WeekdayKey[],
          blockedDays: blockedDays as WeekdayKey[],
        };
      } else {
        salonEnabled = true;
        const ovStart = normalizeTimeHHMM(ov.start) || salonOpen;
        const ovEnd = normalizeTimeHHMM(ov.end) || salonClose;
        salonOpen = ovStart;
        salonClose = ovEnd;
        salonSourceLabel = "استثناء فعلي";
        activeSalonOverride = {
          sourceIndex: i,
          fromDate: ov.fromDate,
          toDate: ov.toDate,
          mode: "hours",
          windowLabel: formatWindow(ovStart, ovEnd),
          includeDays: includeDays as WeekdayKey[],
          blockedDays: blockedDays as WeekdayKey[],
        };
      }
      break;
    }
    const salonWeeklyWindowLabel = salonWeeklyEnabled
      ? formatWindow(salonWeeklyOpen, salonWeeklyClose)
      : "مغلق أسبوعيًا";
    const salonEffectiveWindowLabel = salonEnabled
      ? formatWindow(salonOpen, salonClose)
      : "مغلق للحجوزات اليوم";

    const weekdayLabel = (key: WeekdayKey | "") =>
      WEEKDAY_OPTIONS.find((x) => x.key === key)?.label || "-";
    const formatWeekdaySet = (days: WeekdayKey[]) =>
      days.length ? days.map((d) => weekdayLabel(d)).join(" / ") : "-";
    const formatOverrideMeta = (ov: BookingHourOverride) => {
      const includeDays = Array.isArray(ov?.includeWeekdays) ? (ov.includeWeekdays as WeekdayKey[]) : [];
      const blockedDays = Array.isArray(ov?.blockedWeekdays) ? (ov.blockedWeekdays as WeekdayKey[]) : [];
      const includeLabel = includeDays.length ? formatWeekdaySet(includeDays) : "كل الأيام";
      const blockedLabel = blockedDays.length ? formatWeekdaySet(blockedDays) : "";
      const isClosed = String(ov?.mode || "").trim() === "closed";
      const start = normalizeTimeHHMM(ov?.start) || DEFAULT_OPEN_TIME;
      const end = normalizeTimeHHMM(ov?.end) || DEFAULT_CLOSE_TIME;
      const modeLabel = isClosed ? "إغلاق كامل" : `ساعات ${formatWindow(start, end)}`;
      return `${modeLabel} | الأيام المستهدفة: ${includeLabel}${
        blockedLabel ? ` | أيام الإغلاق: ${blockedLabel}` : ""
      }`;
    };
    const allOverrideDetails = bookingHourOverrides.map((ov, idx) => ({
      sourceIndex: idx,
      rangeDual: formatIsoDateRangeDual(ov.fromDate, ov.toDate),
      meta: formatOverrideMeta(ov),
    }));
        const todayDateGregorian = fmtIsoDate(today);
        const todayDateHijri = fmtIsoDateHijri(today);
        const todayDateCombinedLabel = `${todayDateGregorian} — ${todayDateHijri}`;
        const todayDateLabel = `${todayDateGregorian} م / ${todayDateHijri} هـ`;
    const salonWeeklyDetails = salonWeeklyEnabled
      ? "الدوام الأساسي مأخوذ من الجدول الأسبوعي."
      : "اليوم مغلق في الجدول الأسبوعي.";
    const salonEffectiveBaseDetails = activeSalonOverride
      ? activeSalonOverride.mode === "closed"
        ? "تم إغلاق الصالون اليوم عبر الاستثناء الفعلي."
        : `تم تعديل ساعات الصالون اليوم عبر الاستثناء الفعلي (${activeSalonOverride.windowLabel}).`
      : "لا يوجد استثناء فعلي اليوم على الصالون.";
    const salonSourceDetails = (() => {
      const notes: string[] = [];
      const groups: SummarySourceGroup[] = [];
      const buildGroup = (
        title: string,
        gregorian: string,
        hijri: string,
        details: string[],
        tone: "active" | "other"
      ): SummarySourceGroup => ({
        title,
        gregorian,
        hijri,
        details,
        tone,
      });

      if (activeSalonOverride) {
        const activeDual = formatIsoDateRangeDual(activeSalonOverride.fromDate, activeSalonOverride.toDate);
        const activeDetails: string[] = [];
        if (activeSalonOverride.mode === "closed") {
          activeDetails.push("نوع الاستثناء: إغلاق كامل للحجوزات اليوم.");
        } else {
          activeDetails.push(`وقت الاستثناء الفعلي: ${activeSalonOverride.windowLabel}`);
        }
        if (activeSalonOverride.includeDays.length > 0) {
          activeDetails.push(`الأيام المستهدفة: ${formatWeekdaySet(activeSalonOverride.includeDays)}`);
        }
        if (activeSalonOverride.blockedDays.length > 0) {
          activeDetails.push(`أيام الإغلاق داخل النطاق: ${formatWeekdaySet(activeSalonOverride.blockedDays)}`);
        }
        groups.push(
          buildGroup(
            "الاستثناء الفعلي",
            activeDual.gregorian,
            activeDual.hijri,
            activeDetails,
            "active"
          )
        );

        const others = allOverrideDetails.filter((x) => x.sourceIndex !== activeSalonOverride.sourceIndex);
        if (others.length) {
          notes.push(`استثناءات أخرى مسجلة (${others.length}):`);
          others.forEach((x, idx) => {
            groups.push(
              buildGroup(
                `الاستثناء ${idx + 1}`,
                x.rangeDual.gregorian,
                x.rangeDual.hijri,
                [`تفاصيل الاستثناء ${idx + 1}: ${x.meta}`],
                "other"
              )
            );
          });
        }
      } else if (allOverrideDetails.length) {
        notes.push("لا يوجد استثناء فعلي اليوم.");
        notes.push(`الاستثناءات المسجلة (${allOverrideDetails.length}):`);
        allOverrideDetails.forEach((x, idx) => {
          groups.push(
            buildGroup(
              `الاستثناء ${idx + 1}`,
              x.rangeDual.gregorian,
              x.rangeDual.hijri,
              [`تفاصيل الاستثناء ${idx + 1}: ${x.meta}`],
              "other"
            )
          );
        });
      } else {
        notes.push("لا توجد استثناءات مسجلة على دوام الصالون.");
      }
      return { notes, groups };
    })();

    return list
      .map((staff) => {
        const canonicalResolvedToday =
          coreResolvedTodayByEmployeeId[
            cleanText(staff.id)
          ] || null;

        const canonicalResolvedRecord =
          (canonicalResolvedToday || {}) as Record<string, unknown>;

        const canonicalSource =
          cleanText(
            canonicalResolvedToday?.source
          ).toLowerCase();

        const canonicalExceptionType =
          cleanText(
            canonicalResolvedRecord.exceptionType ||
            canonicalResolvedRecord.exception_type
          ).toLowerCase();

        const canonicalActive =
          Number(
            canonicalResolvedRecord.active
          );

        const canonicalStart =
          normalizeTimeHHMM(
            cleanText(
              canonicalResolvedRecord.startTime ||
              canonicalResolvedRecord.start_time ||
              canonicalResolvedRecord.templateStartTime ||
              canonicalResolvedRecord.template_start_time
            )
          );

        const canonicalEnd =
          normalizeTimeHHMM(
            cleanText(
              canonicalResolvedRecord.endTime ||
              canonicalResolvedRecord.end_time ||
              canonicalResolvedRecord.templateEndTime ||
              canonicalResolvedRecord.template_end_time
            )
          );

        const canonicalOff =
          canonicalExceptionType === "off" ||
          (
            canonicalSource === "weekly_schedule" &&
            canonicalActive !== 1
          );

        const canonicalUnavailable =
          coreResolvedTodayLoading ||
          Boolean(coreResolvedTodayError) ||
          !canonicalResolvedToday;

        const canonicalEmployeeEnabled =
          !canonicalUnavailable &&
          !canonicalOff &&
          canonicalSource !== "none" &&
          Boolean(canonicalStart) &&
          Boolean(canonicalEnd);

        const canonicalResolvedNote =
          cleanText(
            canonicalResolvedRecord.note
          );

        const leaveUntil = normalizeLeaveUntil((staff as any).leaveUntil);
        const employmentEndDate = normalizeLeaveUntil((staff as any).employmentEndDate);
        const exceptionalDates = normalizeExceptionalLeaveDates((staff as any).exceptionalLeaveDates);
        const canonicalScheduleTarget =
          cleanText(staff.id) ===
          coreScheduleLoadedEmployeeId;

        const coreWorkingHours =
          canonicalScheduleTarget
            ? resolveCoreScheduleEditorRows(
                coreScheduleRows,
                today
              )
            : emptyCoreScheduleEditorRows();

        const exceptionalWeekdays =
          canonicalScheduleTarget
            ? WEEKDAY_OPTIONS
                .filter(
                  (day) =>
                    coreWorkingHours[
                      day.key
                    ]?.enabled === false
                )
                .map(
                  (day) =>
                    day.key
                )
            : [];

        const overrides =
          canonicalScheduleTarget
            ? projectCoreScheduleExceptionsToOverrides(
                coreScheduleExceptionRows
              )
            : [];

        const overrideGroups =
          buildWorkingHourOverrideGroups(
            overrides
          );
        const overrideToday =
          canonicalSource === "exception"
            ? {
                date: today,
                enabled: !canonicalOff,
                start: canonicalStart,
                end: canonicalEnd,
                note: canonicalResolvedNote,
              }
            : null;
        const nextSavedOverrideGroup = overrideGroups.find((group) => group.fromDate > today) || null;
        const lastSavedOverrideGroup =
          overrideGroups.length && overrideGroups[overrideGroups.length - 1].toDate < today
            ? overrideGroups[overrideGroups.length - 1]
            : null;

        const formatSavedOverrideGroup = (group: StaffWorkingHourOverrideGroup | null) => {
          if (!group) return null;
          const rangeGregorian = formatIsoDateRange(group.fromDate, group.toDate);
          const rangeHijri = formatIsoDateRangeByCalendar(group.fromDate, group.toDate, "hijri");
          const rangeLabel =
            rangeHijri && rangeHijri !== rangeGregorian
              ? `${rangeGregorian} | هجري: ${rangeHijri}`
              : rangeGregorian;
          const modeLabel =
            group.enabled === false
              ? "إغلاق كامل"
              : `ساعات ${formatWindow(
                  normalizeTimeHHMM(group.start) || salonOpen,
                  normalizeTimeHHMM(group.end) || salonClose
                )}`;
          const dayCountLabel =
            group.count > 1 ? `${formatArabicInteger(group.count)} أيام` : "يوم واحد";
          return {
            rangeLabel,
            modeLabel,
            dayCountLabel,
            note: String(group.note || "").trim(),
          };
        };
        const nextSavedOverrideSummary = formatSavedOverrideGroup(nextSavedOverrideGroup);
        const lastSavedOverrideSummary = formatSavedOverrideGroup(lastSavedOverrideGroup);

        const staffBaseWindowLabel =
          coreResolvedTodayLoading
            ? "جارٍ التحقق من Core"
            : coreResolvedTodayError
              ? "غير متاح"
              : canonicalOff
                ? "مغلق هذا اليوم"
                : canonicalEmployeeEnabled
                  ? formatWindow(
                      canonicalStart,
                      canonicalEnd
                    )
                  : "لا يوجد دوام اليوم";
        const staffBaseMatchesSalonWeekly = staffBaseWindowLabel === salonWeeklyWindowLabel;

        const staffBaseDetails =
          coreResolvedTodayLoading
            ? "جارٍ تحميل الدوام الفعلي من Malikat Core."
            : coreResolvedTodayError
              ? coreResolvedTodayError
              : canonicalSource === "exception"
                ? "الدوام الفعلي مأخوذ من استثناء معتمد في Malikat Core."
                : canonicalSource === "weekly_schedule"
                  ? "الدوام الفعلي مأخوذ من الجدول الأسبوعي المعتمد في Malikat Core."
                  : canonicalSource === "assignment"
                    ? "الدوام الفعلي مأخوذ من تعيين الشفت المعتمد في Malikat Core."
                    : canonicalSource === "none"
                      ? "لا يوجد شفت تشغيلي لهذا اليوم في Malikat Core."
                      : "الحالة التشغيلية مأخوذة من Malikat Core.";

        const staffOverrideLabel = overrideToday
          ? overrideToday.enabled === false
            ? "إغلاق كامل اليوم"
            : formatWindow(
                normalizeTimeHHMM(overrideToday.start) || salonOpen,
                normalizeTimeHHMM(overrideToday.end) || salonClose
              )
          : nextSavedOverrideSummary
            ? nextSavedOverrideSummary.modeLabel
            : lastSavedOverrideSummary
              ? lastSavedOverrideSummary.modeLabel
          : "-";

        const staffOverrideDetails = overrideToday
          ? overrideToday.enabled === false
            ? `تم إغلاق دوام الموظفة بتاريخ ${todayDateLabel}.`
            : `استثناء Malikat Core فعلي اليوم: ${staffOverrideLabel}.`
          : nextSavedOverrideSummary
            ? `لا يوجد استثناء فعلي اليوم. أقرب استثناء محفوظ (${nextSavedOverrideSummary.dayCountLabel}) من ${nextSavedOverrideSummary.rangeLabel}: ${nextSavedOverrideSummary.modeLabel}${
                nextSavedOverrideSummary.note ? ` | ملاحظة: ${nextSavedOverrideSummary.note}` : ""
              }.`
            : lastSavedOverrideSummary
              ? `لا يوجد استثناء فعلي اليوم. آخر استثناء محفوظ كان (${lastSavedOverrideSummary.dayCountLabel}) في ${lastSavedOverrideSummary.rangeLabel}: ${lastSavedOverrideSummary.modeLabel}${
                  lastSavedOverrideSummary.note ? ` | ملاحظة: ${lastSavedOverrideSummary.note}` : ""
                }.`
          : "لا يوجد استثناء يومي خاص بالموظفة اليوم.";

        const leaveByDate = exceptionalDates.includes(today);
        const leaveByWeekday =
          canonicalSource === "weekly_schedule" &&
          canonicalOff;

        const baseWeeklyOffToday =
          weekday
            ? exceptionalWeekdays.includes(weekday)
            : false;

        const leaveByToggle =
          !!(staff as any).onLeave && (!leaveUntil || leaveUntil >= today);

        const leaveActiveToday =
          leaveByDate ||
          leaveByToggle;

        const ended = !!employmentEndDate && today > employmentEndDate;

        const effectiveEnabled =
          canonicalEmployeeEnabled;

        const effectiveStart =
          canonicalStart ||
          salonOpen;

        const effectiveEnd =
          canonicalEnd ||
          salonClose;

        const hardBlockedToday =
          ended ||
          leaveActiveToday ||
          canonicalUnavailable ||
          canonicalOff;
        const intersection =
          !hardBlockedToday && salonEnabled && effectiveEnabled
            ? intersectTimeWindows(salonOpen, salonClose, effectiveStart, effectiveEnd)
            : null;
        const nowInsideWindow =
          !!intersection && isTimeInsideWindow(timeNow, intersection.start, intersection.end);

        const actualNow = ended
          ? "مستبعدة من الحجز (انتهى التوظيف)"
          : leaveActiveToday
            ? "متوقفة اليوم (إجازة)"
            : canonicalUnavailable
              ? "تعذر تحديد الدوام من Malikat Core"
              : canonicalOff
                ? canonicalSource === "exception"
                  ? "متوقفة اليوم (إغلاق استثنائي)"
                  : "راحة أسبوعية اليوم"
                : !salonEnabled
                  ? "الحجوزات مغلقة اليوم على مستوى الصالون"
                  : !effectiveEnabled
                    ? "لا يوجد دوام موظفة اليوم"
                    : !intersection
                      ? "لا يوجد تقاطع بين دوام الموظفة ودوام الحجوزات"
                      : nowInsideWindow
                        ? `تعمل الآن: ${formatWindow(intersection.start, intersection.end)}`
                        : `خارج الدوام الآن: ${formatWindow(intersection.start, intersection.end)}`;
        const statusTone: "good" | "warn" | "muted" =
          nowInsideWindow && !!intersection && !ended && !leaveActiveToday
            ? "good"
            : ended || leaveActiveToday || !salonEnabled || !effectiveEnabled || !intersection
              ? "warn"
              : "muted";
        const salonEffectiveDetails = ended
          ? "الموظفة مستبعدة من الحجز بعد انتهاء التوظيف."
          : leaveActiveToday
            ? "الموظفة في إجازة اليوم، لذلك لا يظهر حجز فعلي لها."
            : !salonEnabled
              ? "الحجوزات مغلقة اليوم على مستوى الصالون."
              : !effectiveEnabled
                ? "دوام الموظفة مغلق اليوم."
                : !intersection
                  ? "لا يوجد وقت مشترك بين دوام الصالون ودوام الموظفة."
                  : `المدى المتاح للحجز مع الموظفة: ${formatWindow(intersection.start, intersection.end)}.`;

        const warnings: string[] = [];
        if (leaveByDate) {
          warnings.push(`اليوم ضمن إجازة استثنائية محددة بتاريخ ${todayDateLabel}.`);
        }
        if ((staff as any).onLeave) {
          if (leaveUntil && leaveUntil >= today) {
            warnings.push(`في إجازة من ${fmtIsoDate(today)} إلى ${fmtIsoDate(leaveUntil)}.`);
          } else if (leaveUntil && leaveUntil < today) {
            warnings.push(`انتهت إجازتها بتاريخ ${fmtIsoDate(leaveUntil)}.`);
          } else {
            warnings.push("في إجازة حالياً بدون تاريخ نهاية محدد.");
          }
        }

        const futureExceptional = exceptionalDates.filter((d) => d > today).sort((a, b) => a.localeCompare(b));
        if (futureExceptional.length > 0) {
          const start = futureExceptional[0];
          let end = start;
          for (let i = 1; i < futureExceptional.length; i++) {
            const expectedNext = addDaysIso(end, 1);
            if (futureExceptional[i] === expectedNext) {
              end = futureExceptional[i];
              continue;
            }
            break;
          }
          const diffDays = Math.max(
            0,
            Math.floor(
              (new Date(`${start}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) /
                86400000
            )
          );
          const lead = diffDays <= 14 ? "إجازة قريبة" : "إجازة مجدولة";
          warnings.push(`${lead} تبدأ ${fmtIsoDate(start)} وتنتهي ${fmtIsoDate(end)}.`);
        }

        if (exceptionalWeekdays.length > 0) {
          const weeklyLabels = exceptionalWeekdays.map((d) => weekdayLabel(d));
          if (weeklyLabels.length === 1) {
            warnings.push(`إجازة ثابتة كل ${weeklyLabels[0]}.`);
          } else {
            warnings.push(`إجازة ثابتة كل: ${weeklyLabels.join(" / ")}.`);
          }
        }

        const leaveDaysLabel = exceptionalWeekdays.length
          ? exceptionalWeekdays.map((d) => weekdayLabel(d)).join("طŒ ")
          : "-";

        const leaveDaysDetails = exceptionalWeekdays.length
          ? baseWeeklyOffToday
            ? canonicalSource === "exception" && !canonicalOff
              ? "اليوم راحة أسبوعية في الجدول الأساسي، لكن استثناء Malikat Core يحوله إلى يوم عمل."
              : "اليوم يقع ضمن الراحة الأسبوعية في الجدول الأساسي."
            : "اليوم ليس ضمن الراحة الأسبوعية في الجدول الأساسي."
          : "لا توجد أيام راحة أسبوعية ثابتة في الجدول الأساسي.";

        const weeklyOffTodayLabel =
          canonicalOff
            ? canonicalSource === "exception"
              ? "راحة / إغلاق استثنائي اليوم حسب Malikat Core"
              : "راحة أسبوعية اليوم حسب Malikat Core"
            : "";
        const finalWindowLabel = hardBlockedToday
          ? leaveByWeekday
            ? "اليوم راحة أسبوعية"
            : "لا يوجد ساعات عمل اليوم"
          : intersection
            ? formatWindow(intersection.start, intersection.end)
            : "مغلق اليوم";
        const operationalState: "working" | "outside" | "closed" =
          canonicalUnavailable ||
          canonicalOff
            ? "closed"
            : nowInsideWindow && !!intersection
              ? "working"
              : intersection
                ? "outside"
                : "closed";
        const operationalStatusLabel = ended
          ? "خارج الخدمة"
          : leaveActiveToday
            ? "متوقفة اليوم"
            : canonicalUnavailable
              ? "الحالة غير متاحة"
              : canonicalOff
                ? canonicalSource === "exception"
                  ? "مغلقة باستثناء"
                  : "راحة أسبوعية"
                : !intersection
                  ? "مغلقة اليوم"
                  : nowInsideWindow
                    ? "تعمل الآن"
                    : "خارج ساعات العمل";
        const reasonLabel = ended
          ? "مغلقة بسبب انتهاء التوظيف"
          : leaveActiveToday
            ? "مغلقة بسبب الإجازة"
            : canonicalUnavailable
              ? "مغلقة لتعذر تحميل الدوام من Malikat Core"
              : !salonEnabled
                ? activeSalonOverride?.mode === "closed"
                  ? "مغلقة بسبب إغلاق الصالون اليوم"
                  : "مغلقة وفق ساعات الصالون"
                : canonicalOff
                  ? canonicalSource === "exception"
                    ? "مغلقة بسبب استثناء معتمد في Malikat Core"
                    : "راحة أسبوعية حسب الجدول المعتمد في Malikat Core"
                  : !intersection
                    ? "مغلقة لعدم وجود وقت مشترك"
                    : canonicalSource === "exception"
                      ? "بناءً على استثناء معتمد في Malikat Core"
                      : canonicalSource === "weekly_schedule"
                        ? "بناءً على الجدول الأسبوعي المعتمد في Malikat Core"
                        : canonicalSource === "assignment"
                          ? "بناءً على تعيين الشفت المعتمد في Malikat Core"
                          : "بناءً على Malikat Core";
        const savedOverrideRows = overrideGroups.map((group, groupIndex) => {
          const tone = group.dates.includes(today)
            ? "active"
            : group.toDate < today
              ? "past"
              : "upcoming";
          const rangeDual = formatIsoDateRangeDual(group.fromDate, group.toDate);
          const weekdaysInGroup = WEEKDAY_OPTIONS.map((x) => x.key).filter((key) =>
            group.dates.some((date) => weekdayFromIso(date) === key)
          ) as WeekdayKey[];
          const appliesToLabel =
            weekdaysInGroup.length === WEEKDAY_OPTIONS.length
              ? "كل الأيام"
              : formatWeekdaySet(weekdaysInGroup);
          return {
            id: group.id,
            tone,
            badge: tone === "active" ? "نشط" : tone === "upcoming" ? "قادم" : "منتهي",
            title: `الاستثناء ${formatArabicInteger(groupIndex + 1)}`,
            gregorianRange: rangeDual.gregorian,
            hijriRange: rangeDual.hijri,
            hoursLabel:
              group.enabled === false
                ? "إغلاق كامل"
                : formatWindow(
                    normalizeTimeHHMM(group.start) || salonOpen,
                    normalizeTimeHHMM(group.end) || salonClose
                  ),
            appliesToLabel,
            note: String(group.note || "").trim(),
            fromDate: group.fromDate,
            toDate: group.toDate,
          };
        });
        const lastTimelineOverrideGroup =
          overrideGroups.length ? overrideGroups[overrideGroups.length - 1] : null;
        const overrideTimelineSummary = lastTimelineOverrideGroup
          ? `آخر استثناء مجدول ينتهي في ${fmtIsoDate(lastTimelineOverrideGroup.toDate)} — ${fmtIsoDateHijri(
              lastTimelineOverrideGroup.toDate
            )}`
          : "";
        const overrideTimelineFallback = lastTimelineOverrideGroup
          ? `بعد ${fmtIsoDate(lastTimelineOverrideGroup.toDate)} (${fmtIsoDateHijri(
              lastTimelineOverrideGroup.toDate
            )}) يعود النظام إلى الجدول الأسبوعي المعتاد ما لم يُضف استثناء جديد.`
          : "";
        const overrideTodayLabel = overrideToday ? staffOverrideLabel : "لا يوجد اليوم";
        const overrideTodayNote = overrideToday
          ? "استثناء Malikat Core المطبق اليوم موضح ضمن تفاصيل الحالة."
          : "لا يوجد استثناء Malikat Core مطبق على هذا اليوم.";
        const hasClosureStatus = ended || leaveActiveToday || !salonEnabled || !effectiveEnabled || !intersection;
        const closureStatusValue = ended
          ? "انتهى التوظيف"
          : leaveActiveToday
            ? "إجازة / توقف"
            : canonicalUnavailable
              ? "تعذر تحميل الدوام"
              : canonicalOff
                ? canonicalSource === "exception"
                  ? "إغلاق استثنائي في Malikat Core"
                  : "راحة أسبوعية"
                : !salonEnabled
                  ? "إغلاق على مستوى الصالون"
                  : !effectiveEnabled
                    ? "إغلاق على مستوى الموظفة"
                    : !intersection
                      ? "لا يوجد وقت مشترك"
                      : "لا يوجد إغلاق اليوم";
        const closureStatusNote = ended
          ? "الموظفة غير متاحة للحجز بعد تاريخ انتهاء التوظيف."
          : leaveActiveToday
            ? "متوقفة اليوم بسبب الإجازة."
            : canonicalUnavailable
              ? "تعذر تحميل الدوام التشغيلي الحالي من Malikat Core."
              : canonicalOff
                ? canonicalSource === "exception"
                  ? "يوجد استثناء معتمد في Malikat Core يغلق دوام الموظفة اليوم."
                  : "اليوم راحة أسبوعية حسب الجدول المعتمد في Malikat Core."
                : !salonEnabled
                  ? "الحجوزات مغلقة اليوم على مستوى الصالون."
                  : !effectiveEnabled
                    ? "لا يوجد دوام تشغيلي للموظفة اليوم في Malikat Core."
                    : !intersection
                      ? "لا يوجد وقت مشترك بين دوام الموظفة وساعات الصالون."
                      : undefined;
        const reasonStatusValue = ended
          ? "انتهاء التوظيف"
          : leaveActiveToday
            ? "إجازة"
            : canonicalUnavailable
              ? "Malikat Core غير متاح"
              : canonicalOff
                ? canonicalSource === "exception"
                  ? "استثناء إغلاق في Malikat Core"
                  : "راحة أسبوعية في Malikat Core"
                : canonicalSource === "exception"
                  ? "استثناء الموظفة في Malikat Core"
                  : canonicalSource === "weekly_schedule"
                    ? "الجدول الأسبوعي في Malikat Core"
                    : canonicalSource === "assignment"
                      ? "تعيين الشفت في Malikat Core"
                      : "Malikat Core";
        const bookingAvailabilityValue =
          ended || leaveActiveToday || !salonEnabled || !effectiveEnabled || !intersection
            ? "غير متاح اليوم"
            : "متاح ضمن هذه الفترة";
        const statusRows = [
          {
            label: "السبب",
            value: reasonStatusValue,
          },
          {
            label: "حالة الإغلاق",
            value: hasClosureStatus ? closureStatusValue : "لا يوجد",
          },
          {
            label: "إتاحة الحجز",
            value: bookingAvailabilityValue,
          },
        ];
        const canonicalFutureTarget =
          cleanText(staff.id) ===
          coreResolvedFutureEmployeeId;

        const canonicalFutureRowsForStaff =
          canonicalFutureTarget
            ? coreResolvedFutureRows
            : [];

        const canonicalFutureLoadingForStaff =
          canonicalFutureTarget &&
          coreResolvedFutureLoading;

        const canonicalFutureErrorForStaff =
          canonicalFutureTarget
            ? coreResolvedFutureError
            : "";

        const upcomingReturn = (() => {
          if (
            ended ||
            !!intersection
          ) {
            return null;
          }

          if (!canonicalFutureTarget) {
            return null;
          }

          const ongoingLeaveWithoutEnd =
            leaveByToggle &&
            !leaveUntil;

          if (ongoingLeaveWithoutEnd) {
            return {
              gregorianDate:
                "غير محدد حتى الآن",
              hijriDate:
                "بانتظار تحديد نهاية الإجازة",
              windowLabel:
                "سيُحدد لاحقًا",
              sourceLabel:
                "بانتظار تحديد نهاية الإجازة",
              availabilityLabel:
                "الحجز غير متاح حتى يتم تحديد موعد العودة",
              note:
                "لا يمكن احتساب أول يوم عمل لأن الإجازة الحالية بلا تاريخ نهاية محدد.",
              leaveEndsLabel: "",
            };
          }

          const leaveEndsOn =
            leaveByToggle &&
            leaveUntil &&
            leaveUntil >= today
              ? leaveUntil
              : leaveByDate
                ? today
                : "";

          if (
            canonicalFutureLoadingForStaff
          ) {
            return {
              gregorianDate:
                "جارٍ التحقق",
              hijriDate: "-",
              windowLabel:
                "جارٍ التحميل",
              sourceLabel:
                "Malikat Core",
              availabilityLabel:
                "جارٍ احتساب أول يوم عودة",
              note:
                "يتم تحميل الدوام المستقبلي المعتمد من Malikat Core.",
              leaveEndsLabel:
                leaveEndsOn
                  ? `${fmtIsoDate(leaveEndsOn)} — ${fmtIsoDateHijri(leaveEndsOn)}`
                  : "",
            };
          }

          if (
            canonicalFutureErrorForStaff
          ) {
            return {
              gregorianDate:
                "غير متاح",
              hijriDate: "-",
              windowLabel:
                "غير متاح",
              sourceLabel:
                "Malikat Core",
              availabilityLabel:
                "تعذر احتساب العودة",
              note:
                canonicalFutureErrorForStaff,
              leaveEndsLabel:
                leaveEndsOn
                  ? `${fmtIsoDate(leaveEndsOn)} — ${fmtIsoDateHijri(leaveEndsOn)}`
                  : "",
            };
          }

          for (
            const candidate
            of canonicalFutureRowsForStaff
          ) {
            const candidateDate =
              normalizeLeaveUntil(
                candidate.date
              );

            if (!candidateDate) {
              continue;
            }

            if (
              employmentEndDate &&
              candidateDate >
                employmentEndDate
            ) {
              break;
            }

            // Leave data is separate from scheduling.
            // Do not call a staff schedule fallback.
            if (
              exceptionalDates.includes(
                candidateDate
              )
            ) {
              continue;
            }

            const candidateRecord =
              candidate as Record<
                string,
                unknown
              >;

            const candidateSource =
              cleanText(
                candidate.source
              ).toLowerCase();

            const candidateExceptionType =
              cleanText(
                candidateRecord.exceptionType ||
                candidateRecord.exception_type
              ).toLowerCase();

            const candidateActive =
              Number(
                candidateRecord.active
              );

            const candidateStart =
              normalizeTimeHHMM(
                cleanText(
                  candidateRecord.startTime ||
                  candidateRecord.start_time ||
                  candidateRecord.templateStartTime ||
                  candidateRecord.template_start_time
                )
              );

            const candidateEnd =
              normalizeTimeHHMM(
                cleanText(
                  candidateRecord.endTime ||
                  candidateRecord.end_time ||
                  candidateRecord.templateEndTime ||
                  candidateRecord.template_end_time
                )
              );

            const candidateOff =
              candidateExceptionType ===
                "off" ||
              candidateSource ===
                "none" ||
              (
                candidateSource ===
                  "weekly_schedule" &&
                candidateActive !== 1
              ) ||
              !candidateStart ||
              !candidateEnd;

            if (candidateOff) {
              continue;
            }

            // Salon opening hours remain an independent
            // booking constraint. Employee scheduling comes
            // exclusively from the resolved Core row above.
            const targetDayKey =
              weekdayFromIso(
                candidateDate
              ) || "sat";

            const targetBusinessHours =
              (businessHours as any)?.[
                targetDayKey
              ] || {
                enabled: true,
                start:
                  DEFAULT_OPEN_TIME,
                end:
                  DEFAULT_CLOSE_TIME,
              };

            let targetSalonEnabled =
              targetBusinessHours
                ?.enabled !== false;

            let targetSalonOpen =
              normalizeTimeHHMM(
                targetBusinessHours?.start
              ) ||
              DEFAULT_OPEN_TIME;

            let targetSalonClose =
              normalizeTimeHHMM(
                targetBusinessHours?.end
              ) ||
              DEFAULT_CLOSE_TIME;

            for (
              let i =
                bookingHourOverrides.length -
                1;
              i >= 0;
              i--
            ) {
              const salonOverride =
                bookingHourOverrides[i];

              if (
                candidateDate <
                  salonOverride.fromDate ||
                candidateDate >
                  salonOverride.toDate
              ) {
                continue;
              }

              const includeDays =
                Array.isArray(
                  salonOverride
                    ?.includeWeekdays
                )
                  ? (salonOverride.includeWeekdays as WeekdayKey[])
                  : [];

              if (
                includeDays.length >
                  0 &&
                !includeDays.includes(
                  targetDayKey
                )
              ) {
                continue;
              }

              const blockedDays =
                Array.isArray(
                  salonOverride
                    ?.blockedWeekdays
                )
                  ? (salonOverride.blockedWeekdays as WeekdayKey[])
                  : [];

              if (
                blockedDays.includes(
                  targetDayKey
                ) ||
                cleanText(
                  salonOverride?.mode
                ) === "closed"
              ) {
                targetSalonEnabled =
                  false;
              } else {
                targetSalonEnabled =
                  true;

                targetSalonOpen =
                  normalizeTimeHHMM(
                    salonOverride.start
                  ) ||
                  targetSalonOpen;

                targetSalonClose =
                  normalizeTimeHHMM(
                    salonOverride.end
                  ) ||
                  targetSalonClose;
              }

              break;
            }

            if (!targetSalonEnabled) {
              continue;
            }

            const candidateIntersection =
              intersectTimeWindows(
                targetSalonOpen,
                targetSalonClose,
                candidateStart,
                candidateEnd
              );

            if (
              !candidateIntersection
            ) {
              continue;
            }

            const sourceLabel =
              candidateSource ===
                "exception"
                ? "استثناء معتمد في Malikat Core"
                : candidateSource ===
                    "weekly_schedule"
                  ? "الجدول الأسبوعي المعتمد في Malikat Core"
                  : candidateSource ===
                      "assignment"
                    ? "تعيين الشفت المعتمد في Malikat Core"
                    : "Malikat Core";

            const candidateNote =
              cleanText(
                candidateRecord.note
              );

            return {
              gregorianDate:
                fmtIsoDate(
                  candidateDate
                ),
              hijriDate:
                fmtIsoDateHijri(
                  candidateDate
                ),
              windowLabel:
                formatWindow(
                  candidateIntersection.start,
                  candidateIntersection.end
                ),
              sourceLabel,
              availabilityLabel:
                "الحجز سيكون متاحًا ابتداءً من هذا الوقت",
              note:
                candidateNote
                  ? `ملاحظة Malikat Core: ${candidateNote}`
                  : "أول يوم عودة محسوب من الدوام التشغيلي المعتمد في Malikat Core.",
              leaveEndsLabel:
                leaveEndsOn
                  ? `${fmtIsoDate(leaveEndsOn)} — ${fmtIsoDateHijri(leaveEndsOn)}`
                  : "",
            };
          }

          return {
            gregorianDate:
              "لا توجد عودة مجدولة",
            hijriDate:
              "بحسب بيانات Malikat Core",
            windowLabel:
              "سيُحدد لاحقًا",
            sourceLabel:
              "Malikat Core",
            availabilityLabel:
              "الحجز غير متاح حتى تتوفر ساعات عمل لاحقة",
            note:
              "لم يتم العثور على يوم عمل قادم خلال 120 يومًا من الدوام التشغيلي المعتمد.",
            leaveEndsLabel:
              leaveEndsOn
                ? `${fmtIsoDate(leaveEndsOn)} — ${fmtIsoDateHijri(leaveEndsOn)}`
                : "",
          };
        })();
        const detailRows = [
          {
            label: "دوام الموظفة الفعلي اليوم",
            value: staffBaseWindowLabel,
            note: staffBaseDetails,
          },
          {
            label: "ساعات تشغيل الصالون",
            value: salonEffectiveWindowLabel,
            note: activeSalonOverride
              ? "تشمل استثناء الصالون المطبق اليوم."
              : "ساعات التشغيل المعتمدة للصالون اليوم.",
          },
          {
            label: "استثناء الموظفة المطبق اليوم",
            value: overrideTodayLabel,
            note: overrideTodayNote,
          },
          hasClosureStatus
            ? {
                label: "حالة الإغلاق",
                value: closureStatusValue,
                note: closureStatusNote,
              }
            : {
                label: "حالة الإغلاق",
                value: "لا يوجد",
                note: "لا يوجد إغلاق أو تعطيل يؤثر على الدوام اليوم.",
              },
          {
            label: "إتاحة الحجز",
            value: bookingAvailabilityValue,
            note:
              bookingAvailabilityValue === "متاح ضمن هذه الفترة"
                ? `الحجز متاح ضمن ${finalWindowLabel}.`
                : "الحجز غير متاح اليوم بحسب النتيجة النهائية أعلاه.",
          },
        ].filter(Boolean);

        return {
          id: staff.id,
          name: String(staff.name || "-"),
          todayWeekdayLabel: weekdayLabel(weekday),
          todayDateGregorianLabel: `${todayDateGregorian} م`,
          todayDateHijriLabel: `${todayDateHijri} هـ`,
          todayDateCombinedLabel,
          salonWeeklyWindowLabel,
          salonWeeklyDetails,
          salonEffectiveWindowLabel,
          salonEffectiveDetails: `${salonEffectiveBaseDetails} ${salonEffectiveDetails}`,
          salonSourceLabel,
          salonSourceDetails,
          staffBaseWindowLabel,
          staffBaseMatchesSalonWeekly,
          staffBaseDetails,
          staffOverrideLabel,
          staffOverrideDetails,
          leaveDaysLabel,
          leaveDaysDetails,
          weeklyOffToday:
            canonicalOff ||
            leaveByWeekday,
          weeklyOffTodayLabel,
          statusNowLabel: actualNow,
          statusTone,
          operationalState,
          operationalStatusLabel,
          finalWindowLabel,
          reasonLabel,
          statusRows,
          savedOverrideRows,
          overrideTimelineSummary,
          overrideTimelineFallback,
          upcomingReturn,
          detailRows,
          warnings,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [
    appSettings,
    coreScheduleExceptionRows,
    coreScheduleLoadedEmployeeId,
    coreScheduleRows,
    coreResolvedFutureEmployeeId,
    coreResolvedFutureError,
    coreResolvedFutureLoading,
    coreResolvedFutureRows,
    coreResolvedTodayByEmployeeId,
    coreResolvedTodayError,
    coreResolvedTodayLoading,
    list,
    nowTick,
  ]);

  const editingStaff = useMemo(
    () => (editId ? list.find((x) => x.id === editId) || null : null),
    [editId, list]
  );
  const modalStaffScheduleSummary = useMemo(
    () => (editingStaff ? staffScheduleSummary.find((x) => x.id === editingStaff.id) || null : null),
    [editingStaff, staffScheduleSummary]
  );
  const payrollSettingsPreview = useMemo(() => {
    const baseSalaryRiyals = positiveNumberOrZero(monthlySalary);
    const workDays = positiveNumberOrZero(overtimeDaysPerMonth);
    const dailyHours = positiveNumberOrZero(overtimeBaseHoursPerDay);
    const manualMonthlyHours = positiveNumberOrZero(payrollMonthlyHours);
    const computedMonthlyHours =
      manualMonthlyHours > 0
        ? manualMonthlyHours
        : workDays > 0 && dailyHours > 0
          ? roundPayrollNumber(workDays * dailyHours)
          : 0;
    const missing: string[] = [];
    if (baseSalaryRiyals <= 0) missing.push("الراتب الأساسي غير محدد");
    if (workDays <= 0) missing.push("أيام العمل غير محددة");
    if (computedMonthlyHours <= 0) missing.push("ساعات العمل غير محددة");
    const dailyRateRiyals = baseSalaryRiyals > 0 && workDays > 0
      ? roundPayrollNumber(baseSalaryRiyals / workDays)
      : 0;
    const hourlyRateRiyals = baseSalaryRiyals > 0 && computedMonthlyHours > 0
      ? roundPayrollNumber(baseSalaryRiyals / computedMonthlyHours)
      : 0;
    return {
      baseSalaryRiyals,
      workDays,
      dailyHours,
      monthlyHours: computedMonthlyHours,
      monthlyHoursSource: manualMonthlyHours > 0 ? "manual" as const : computedMonthlyHours > 0 ? "computed" as const : "missing" as const,
      dailyRateRiyals,
      hourlyRateRiyals,
      complete: missing.length === 0,
      missing,
    };
  }, [monthlySalary, overtimeBaseHoursPerDay, overtimeDaysPerMonth, payrollMonthlyHours]);
  const modalPayrollCycleMonthKey = useMemo(() => {
    if (!editingStaff) {
      return "";
    }

    const monthStats =
      bookingStats[
        editingStaff.id
      ]?.month;

    return (
      payrollCycleKeyFromDate(
        todayIso(),
        PAYROLL_CLOSE_DAY
      ) ||
      String(
        monthStats?.key ||
        currentMonthKey()
      )
    );
  }, [
    editingStaff,
    bookingStats,
  ]);

  const [
    modalPayrollMonthSummary,
    setModalPayrollMonthSummary,
  ] = useState<{
    totalAmount?: number;
    invoiceRevenue?: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    const employeeId =
      String(
        editingStaff?.id ||
        ""
      ).trim();

    const invoiceRevenue =
      Math.max(
        0,
        Number(
          employeeId
            ? bookingStats[
                employeeId
              ]?.month
                ?.invoiceRevenue ||
              0
            : 0
        ) || 0
      );

    if (
      !employeeId ||
      !modalPayrollCycleMonthKey
    ) {
      setModalPayrollMonthSummary(
        null
      );

      return () => {
        cancelled = true;
      };
    }

    if (payrollSettingsSaving) {
      return () => {
        cancelled = true;
      };
    }

    setModalPayrollMonthSummary({
      totalAmount:
        undefined,
      invoiceRevenue,
    });

    void generatePayrollEntriesForMonths({
      monthKeys: [
        modalPayrollCycleMonthKey,
      ],
      employeeId,
    })
      .then((entries) => {
        if (cancelled) {
          return;
        }

        const entry =
          entries.find(
            (row) =>
              String(
                row.employeeId ||
                ""
              ).trim() ===
              employeeId
          ) ||
          entries[0] ||
          null;

        const grossHalalas =
          entry
            ? Math.max(
                0,
                Number(
                  entry
                    .grossSalaryHalalas ??
                  entry
                    .netSalaryHalalas ??
                  entry
                    .finalSalaryHalalas ??
                  0
                ) || 0
              )
            : 0;

        setModalPayrollMonthSummary({
          totalAmount:
            grossHalalas / 100,
          invoiceRevenue,
        });
      })
      .catch((error) => {
        console.warn(
          "Malikat Core employee payroll preview load error:",
          error
        );

        if (cancelled) {
          return;
        }

        setModalPayrollMonthSummary({
          totalAmount: 0,
          invoiceRevenue,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    editingStaff?.id,
    modalPayrollCycleMonthKey,
    bookingStats,
    payrollSettingsSaving,
  ]);

  const employeeProfileHasUnsavedChanges = useMemo(() => {
    if (!editingStaff) return false;

    const normalizeServiceIds = (value: unknown) =>
      canonicalizeSpecialties(value, serviceOptions).slice().sort((a, b) => a.localeCompare(b));

    const savedCoreWorkingHours =
      resolveCoreScheduleEditorRows(
        coreScheduleRows,
        todayIso()
      );

    const coreScheduleReady =
      coreScheduleLoadedEmployeeId ===
      cleanText(
        editingStaff.id
      );

    const scheduleDirty =
      coreScheduleReady &&
      !coreScheduleEditorRowsEqual(
        savedCoreWorkingHours,
        modalCustomWorkingHours
      );

    const workingHourOverridesDirty =
      coreScheduleReady &&
      !workingHourOverridesEqual(
        projectCoreScheduleExceptionsToOverrides(
          coreScheduleExceptionRows
        ),
        modalCustomHourOverrides
      );

    const saved = {
      basic: {
        name: cleanText(editingStaff.name),
        active: !!editingStaff.active,
        showOnAbout: (editingStaff as any).showOnAbout !== false,
        showOnBooking: (editingStaff as any).showOnBooking !== false,
        includeInEmployeeManagement: (editingStaff as any).includeInEmployeeManagement !== false,
      },
      profile: {
        avatarUrl: resolveAvatarFromAssets(pickAvatarUrl(editingStaff as any)),
        bio: cleanText((editingStaff as any).bio),
        cvUrl: cleanText((editingStaff as any).cvUrl),
        rating: Math.min(5, safeNonNegativeNumber((editingStaff as any).rating, 0)),
        reviewsCount: Math.floor(safeNonNegativeNumber((editingStaff as any).reviewsCount || (editingStaff as any).reviewCount, 0)),
      },
      services: {
        specialties: normalizeServiceIds(editingStaff.specialties),
      },
      booking: {
        employmentEndDate: normalizeLeaveUntil((editingStaff as any).employmentEndDate),
        attendanceZoneId: resolveAttendanceZoneId(editingStaff),
      },
    };

    const current = {
      basic: {
        name: cleanText(name),
        active: !!active,
        showOnAbout: !!showOnAbout,
        showOnBooking: !!showOnBooking,
        includeInEmployeeManagement: !!includeInEmployeeManagement,
      },
      profile: {
        avatarUrl: cleanText(avatarUrl),
        bio: cleanText(bio),
        cvUrl: cleanText(cvUrl),
        rating: Math.min(5, safeNonNegativeNumber(rating, 0)),
        reviewsCount: Math.floor(safeNonNegativeNumber(reviewsCount, 0)),
      },
      services: {
        specialties: normalizeServiceIds(specialties),
      },
      booking: {
        employmentEndDate: normalizeLeaveUntil(employmentEndDate),
        attendanceZoneId: cleanText(selectedAttendanceZoneId),
      },
    };

    return (
      JSON.stringify(saved) !==
        JSON.stringify(current) ||
      scheduleDirty ||
      workingHourOverridesDirty
    );
  }, [
    active,
    avatarUrl,
    bio,
    cvUrl,
    editingStaff,
    coreScheduleExceptionRows,
    coreScheduleLoadedEmployeeId,
    coreScheduleRows,
    employmentEndDate,
    includeInEmployeeManagement,
    modalCustomHourOverrides,
    modalCustomWorkingHours,
    name,
    rating,
    resolveAttendanceZoneId,
    reviewsCount,
    selectedAttendanceZoneId,
    serviceOptions,
    showOnAbout,
    showOnBooking,
    specialties,
  ]);
  const modalTabs: Array<{ key: EmployeeModalTab; label: string }> = editingStaff
    ? [
        { key: "basic", label: "البيانات الأساسية" },
        { key: "booking", label: "الحجز والدوام" },
        { key: "services", label: "الخدمات" },
        { key: "profile", label: "الملف" },
        { key: "stats", label: "الإحصائيات والإجازات" },
      ]
    : [
        { key: "basic", label: "البيانات الأساسية" },
        { key: "booking", label: "الحجز والدوام" },
        { key: "services", label: "الخدمات" },
        { key: "profile", label: "الملف" },
      ];
  const detailTabs: Array<{ key: EmployeeSplitTab; label: string; hint: string; icon?: typeof faUserTie }> = [
    { key: "basic", label: "البيانات الأساسية", hint: "الاسم والحالة والظهور", icon: faUserTie },
    { key: "profile", label: "الملف والصورة", hint: "الصورة والنبذة والتقييم", icon: faFileLines },
    { key: "services", label: "الخدمات", hint: "الخدمات المسندة للموظفة", icon: faInbox },
    { key: "booking", label: "الدوام والشفتات", hint: "الجدول والقوالب والسياسات", icon: faClock },
    ...(canViewAttendance
      ? [{ key: "attendance" as EmployeeSplitTab, label: "الحضور", hint: "السجل اليومي", icon: faCalendarCheck }]
      : []),
    ...(canViewPayroll
      ? [{ key: "payroll" as EmployeeSplitTab, label: "سجل الرواتب", hint: "القفل والحساب", icon: faMoneyBillWave }]
      : []),
    ...(canManageLeaveBalance
      ? [
          { key: "requests" as EmployeeSplitTab, label: "الطلبات", hint: "طلبات الموظفة", icon: faInbox },
          { key: "leave" as EmployeeSplitTab, label: "رصيد الإجازات", hint: "الحالة والرصيد والسجل", icon: faCalendarCheck },
        ]
      : []),
    ...(canViewEmployeeMessages
      ? [{ key: "messages" as EmployeeSplitTab, label: "الرسائل", hint: "التواصل الداخلي", icon: faEnvelope }]
      : []),
    ...(canViewEmployeeFiles
      ? [{ key: "files" as EmployeeSplitTab, label: "الملفات", hint: "المستندات", icon: faFileLines }]
      : []),
  ];
  const modalLeaveExpired = useMemo(() => {
    const leaveUntil = normalizeLeaveUntil(modalLeaveUntil);
    return !!leaveUntil && leaveUntil < todayIso();
  }, [modalLeaveUntil]);
  const modalHourOverrideTargetCount = useMemo(() => {
    const fromInput = normalizeLeaveUntil(modalHourOverrideFromDate);
    if (!fromInput) return 0;
    const toInput =
      modalHourOverrideMode === "single"
        ? fromInput
        : normalizeLeaveUntil(modalHourOverrideToDate) || fromInput;
    const from = fromInput <= toInput ? fromInput : toInput;
    const to = fromInput <= toInput ? toInput : fromInput;
    let cursor = from;
    let guard = 0;
    let count = 0;
    while (cursor && cursor <= to) {
      const day = weekdayFromIso(cursor);
      const allowed =
        modalHourOverrideMode !== "specific" ||
        (!!day && modalHourOverrideApplyWeekdays.includes(day));
      if (allowed) count += 1;
      cursor = addDaysIso(cursor, 1);
      guard += 1;
      if (guard > 120) break;
    }
    return count;
  }, [modalHourOverrideFromDate, modalHourOverrideToDate, modalHourOverrideApplyWeekdays, modalHourOverrideMode]);
  const modalHourOverrideExistingTargetCount = useMemo(() => {
    const fromInput = normalizeLeaveUntil(modalHourOverrideFromDate);
    if (!fromInput) return 0;
    const toInput =
      modalHourOverrideMode === "single"
        ? fromInput
        : normalizeLeaveUntil(modalHourOverrideToDate) || fromInput;
    const from = fromInput <= toInput ? fromInput : toInput;
    const to = fromInput <= toInput ? toInput : fromInput;
    const existingDates = new Set(
      modalCustomHourOverrides.map((x) => normalizeLeaveUntil(x.date)).filter((x): x is string => !!x)
    );
    let cursor = from;
    let guard = 0;
    let count = 0;
    while (cursor && cursor <= to) {
      const day = weekdayFromIso(cursor);
      const allowed =
        modalHourOverrideMode !== "specific" ||
        (!!day && modalHourOverrideApplyWeekdays.includes(day));
      if (allowed && existingDates.has(cursor)) count += 1;
      cursor = addDaysIso(cursor, 1);
      guard += 1;
      if (guard > 120) break;
    }
    return count;
  }, [
    modalHourOverrideFromDate,
    modalHourOverrideToDate,
    modalHourOverrideApplyWeekdays,
    modalHourOverrideMode,
    modalCustomHourOverrides,
  ]);
  const modalHourOverrideApplyCount = modalHourOverrideUpdateExistingOnly
    ? modalHourOverrideExistingTargetCount
    : modalHourOverrideTargetCount;
  const modalHourOverridePreview = useMemo(() => {
    const fromInput = normalizeLeaveUntil(modalHourOverrideFromDate);
    if (!fromInput) return { affectedDays: 0, totalHours: 0, baseHours: 0, diffHours: 0 };
    const toInput =
      modalHourOverrideMode === "single"
        ? fromInput
        : normalizeLeaveUntil(modalHourOverrideToDate) || fromInput;
    const from = fromInput <= toInput ? fromInput : toInput;
    const to = fromInput <= toInput ? toInput : fromInput;
    const nextEnabled =
      modalHourOverrideQuickMode === "closed" ? false : modalHourOverrideEnabled;
    const nextHours = durationHours(
      nextEnabled,
      normalizeTimeHHMM(modalHourOverrideStart) || "10:00",
      normalizeTimeHHMM(modalHourOverrideEnd) || "22:00"
    );
    const existingDates = new Set(modalCustomHourOverrides.map((x) => x.date));
    let cursor = from;
    let guard = 0;
    let affected = 0;
    let total = 0;
    let base = 0;
    while (cursor && cursor <= to) {
      const day = weekdayFromIso(cursor);
      const allowed =
        modalHourOverrideMode !== "specific" ||
        (!!day && modalHourOverrideApplyWeekdays.includes(day));
      if (allowed) {
        const canApply = modalHourOverrideUpdateExistingOnly
          ? existingDates.has(cursor)
          : modalHourOverrideApplyMethod === "replace" || !existingDates.has(cursor);
        if (canApply) {
          const baseDay = day ? modalCustomWorkingHours[day] : undefined;
          const baseEnabled = (baseDay?.enabled ?? true) !== false;
          const baseStart = normalizeTimeHHMM(baseDay?.start) || "10:00";
          const baseEnd = normalizeTimeHHMM(baseDay?.end) || "22:00";
          base += durationHours(baseEnabled, baseStart, baseEnd);
          total += nextHours;
          affected += 1;
        }
      }
      cursor = addDaysIso(cursor, 1);
      guard += 1;
      if (guard > 120) break;
    }
    return { affectedDays: affected, totalHours: total, baseHours: base, diffHours: total - base };
  }, [
    modalHourOverrideFromDate,
    modalHourOverrideToDate,
    modalHourOverrideMode,
    modalHourOverrideQuickMode,
    modalHourOverrideEnabled,
    modalHourOverrideStart,
    modalHourOverrideEnd,
    modalHourOverrideApplyWeekdays,
    modalHourOverrideApplyMethod,
    modalHourOverrideUpdateExistingOnly,
    modalCustomHourOverrides,
    modalCustomWorkingHours,
  ]);
  const modalHourOverrideGroups = useMemo(
    () => buildWorkingHourOverrideGroups(modalCustomHourOverrides),
    [modalCustomHourOverrides]
  );

  const updateModalWorkingDay = (
    day: WeekdayKey,
    patch: Partial<StaffWorkingDay>
  ) => {
    setModalCustomWorkingHours((prev) => ({
      ...prev,
      [day]: {
        ...(prev[day] || { enabled: true, start: "10:00", end: "22:00" }),
        ...patch,
      },
    }));

    if (typeof patch.enabled === "boolean") {
      setModalExceptionalLeaveWeekdays((prev) =>
        patch.enabled
          ? prev.filter((item) => item !== day)
          : normalizeExceptionalLeaveWeekdays([...prev, day])
      );
    }
  };
  const copyModalWorkingDayToAll = (sourceDay: WeekdayKey) => {
    setModalCustomWorkingHours((prev) => {
      const sourceRaw = prev[sourceDay] || { enabled: true, start: "10:00", end: "22:00" };
      const source: StaffWorkingDay = {
        enabled: sourceRaw.enabled !== false,
        start: normalizeTimeHHMM(sourceRaw.start) || "10:00",
        end: normalizeTimeHHMM(sourceRaw.end) || "22:00",
      };
      const next = { ...prev };
      WEEKDAY_OPTIONS.forEach((d) => {
        next[d.key] = { ...source };
      });
      return next;
    });
    setModalExceptionalLeaveWeekdays(
      sourceDay && modalCustomWorkingHours[sourceDay]?.enabled === false
        ? WEEKDAY_OPTIONS.map((day) => day.key)
        : []
    );
  };

  const toggleModalHourOverrideWeekday = (day: WeekdayKey) => {
    setModalHourOverrideApplyWeekdays((prev) =>
      prev.includes(day) ? prev.filter((x) => x !== day) : [...prev, day]
    );
  };

  const setModalHourOverrideFromGregorian = (next: string) => {
    const iso = normalizeLeaveUntil(next);
    setModalHourOverrideFromDate(iso);
    if (modalHourOverrideEditingDate || modalHourOverrideMode === "single") {
      setModalHourOverrideToDate(iso);
    }
  };

  const setModalHourOverrideToGregorian = (next: string) => {
    const iso = normalizeLeaveUntil(next);
    setModalHourOverrideToDate(iso);
    if (
      iso &&
      !normalizeLeaveUntil(modalHourOverrideEditingDate) &&
      modalHourOverrideMode === "single"
    ) {
      setModalHourOverrideMode("range");
    }
  };

  const openModalHourOverrideHijriPicker = (target: "from" | "to") => {
    const baseIso =
      target === "from"
        ? normalizeLeaveUntil(modalHourOverrideFromDate) || todayIso()
        : normalizeLeaveUntil(modalHourOverrideToDate) ||
          normalizeLeaveUntil(modalHourOverrideFromDate) ||
          todayIso();
    setModalHourOverrideHijriPickerTarget(target);
    setModalHourOverrideHijriViewMonthISO(findHijriMonthStartIso(baseIso));
    setModalHourOverrideHijriPickerOpen(true);
    setErrorMsg("");
  };

  const applyModalHourOverrideHijriPick = (iso: string) => {
    const dateIso = normalizeLeaveUntil(iso);
    if (!dateIso) return;
    if (modalHourOverrideHijriPickerTarget === "from") {
      setModalHourOverrideFromGregorian(dateIso);
    } else {
      setModalHourOverrideToGregorian(dateIso);
    }
    setModalHourOverrideHijriPickerOpen(false);
    setErrorMsg("");
  };

  const applyModalHourOverrideHijriInput = (
    target: "from" | "to",
    raw: string,
    commit = false
  ) => {
    const nextRaw = String(raw || "");
    if (target === "from") setModalHourOverrideFromDateHijri(nextRaw);
    else setModalHourOverrideToDateHijri(nextRaw);

    const parsed = parseHijriDateInput(nextRaw);
    if (!parsed) {
      if (commit && nextRaw.trim()) {
        setErrorMsg("صيغة التاريخ الهجري يجب أن تكون: يوم/شهر/سنة (مثال: 09/09/1447).");
      }
      return;
    }
    const iso = isoFromHijriDateParts(parsed);
    if (!iso) {
      if (commit) {
        setErrorMsg("تعذر تحويل التاريخ الهجري. تأكد من إدخال تاريخ هجري صحيح.");
      }
      return;
    }
    if (target === "from") setModalHourOverrideFromGregorian(iso);
    else setModalHourOverrideToGregorian(iso);
    if (commit) setErrorMsg("");
  };

  const setModalHourOverrideRangeFromExisting = () => {
    const rows = normalizeWorkingHourOverrides(modalCustomHourOverrides);
    if (!rows.length) {
      setErrorMsg("لا توجد استثناءات حالية لتعديلها.");
      return false;
    }
    const first = rows[0];
    const last = rows[rows.length - 1];

    // Prefill by the most repeated schedule pattern among existing overrides.
    const patternMap = new Map<string, { count: number; row: StaffWorkingHourOverride }>();
    rows.forEach((row) => {
      const enabled = row.enabled !== false;
      const start = normalizeTimeHHMM(row.start) || "10:00";
      const end = normalizeTimeHHMM(row.end) || "22:00";
      const key = `${enabled ? "1" : "0"}|${start}|${end}`;
      const cur = patternMap.get(key);
      if (cur) {
        patternMap.set(key, { count: cur.count + 1, row: cur.row });
      } else {
        patternMap.set(key, { count: 1, row: { date: row.date, enabled, start, end } });
      }
    });
    let seed = first;
    let maxCount = -1;
    patternMap.forEach((entry) => {
      if (entry.count > maxCount) {
        maxCount = entry.count;
        seed = entry.row;
      }
    });

    // Reset stale draft filters so "edit existing only" always targets the saved overrides.
    setModalHourOverrideEditingGroupId("");
    setModalHourOverrideEditingDate("");
    setModalHourOverrideFromDate(first.date);
    setModalHourOverrideToDate(last.date);
    setModalHourOverrideHijriPickerOpen(false);
    setModalHourOverrideHijriPickerTarget("from");
    setModalHourOverrideHijriViewMonthISO(findHijriMonthStartIso(first.date));
    setModalHourOverrideMode(first.date === last.date ? "single" : "range");
    setModalHourOverrideQuickMode("manual");
    setModalHourOverrideEnabled(seed.enabled !== false);
    setModalHourOverrideStart(normalizeTimeHHMM(seed.start) || "10:00");
    setModalHourOverrideEnd(normalizeTimeHHMM(seed.end) || "22:00");
    setModalHourOverrideNote(String(seed.note || "").trim());
    setModalHourOverrideUpdateExistingOnly(true);
    setModalHourOverrideOverwriteExisting(true);
    setModalHourOverrideApplyWeekdays([]);
    return true;
  };

  const fillModalHourOverrideFromBaseDay = () => {
    const baseDate = normalizeLeaveUntil(modalHourOverrideFromDate) || todayIso();
    const dayKey = weekdayFromIso(baseDate);
    if (!dayKey) return;
    let enabled = true;
    let start = DEFAULT_OPEN_TIME;
    let end = DEFAULT_CLOSE_TIME;

    if (modalUseCustomWorkingHours) {
      const row = modalCustomWorkingHours[dayKey];
      if (row) {
        enabled = row.enabled !== false;
        start = normalizeTimeHHMM(row.start) || start;
        end = normalizeTimeHHMM(row.end) || end;
      }
    } else {
      const booking = (appSettings as any)?.booking || {};
      const businessHours = (booking as any)?.businessHours || {};
      const row = (businessHours as any)?.[dayKey];
      if (row) {
        enabled = row.enabled !== false;
        start = normalizeTimeHHMM(row.start) || start;
        end = normalizeTimeHHMM(row.end) || end;
      }
    }

    setModalHourOverrideEnabled(enabled);
    setModalHourOverrideStart(start);
    setModalHourOverrideEnd(end);
  };

  const cancelModalWorkingHourOverrideEdit = () => {
    setModalHourOverrideEditingGroupId("");
    setModalHourOverrideEditingDate("");
    setModalHourOverrideFromDate("");
    setModalHourOverrideToDate("");
    setModalHourOverrideHijriPickerOpen(false);
    setModalHourOverrideHijriPickerTarget("from");
    setModalHourOverrideHijriViewMonthISO(findHijriMonthStartIso(todayIso()));
    setModalHourOverrideStart("10:00");
    setModalHourOverrideEnd("22:00");
    setModalHourOverrideEnabled(true);
    setModalHourOverrideMode("single");
    setModalHourOverrideQuickMode("manual");
    setModalHourOverrideApplyMethod("replace");
    setModalHourOverrideNote("");
    setModalHourOverrideApplyWeekdays([]);
  };

  const startModalWorkingHourOverrideGroupEdit = (group: StaffWorkingHourOverrideGroup) => {
    if (!group) return;
    setModalHourOverrideEditingGroupId(group.id);
    setModalHourOverrideEditingDate("");
    setModalHourOverrideFromDate(group.fromDate);
    setModalHourOverrideToDate(group.toDate);
    setModalHourOverrideHijriPickerOpen(false);
    setModalHourOverrideHijriPickerTarget("from");
    setModalHourOverrideHijriViewMonthISO(findHijriMonthStartIso(group.fromDate));
    setModalHourOverrideEnabled(group.enabled !== false);
    setModalHourOverrideStart(normalizeTimeHHMM(group.start) || "10:00");
    setModalHourOverrideEnd(normalizeTimeHHMM(group.end) || "22:00");
    setModalHourOverrideMode(group.fromDate === group.toDate ? "single" : "range");
    setModalHourOverrideQuickMode("manual");
    setModalHourOverrideApplyMethod("replace");
    setModalHourOverrideNote(String(group.note || "").trim());
    setModalHourOverrideApplyWeekdays([]);
    setModalHourOverrideOverwriteExisting(true);
    setModalHourOverrideUpdateExistingOnly(true);
  };

  const removeModalWorkingHourOverrideGroup = (group: StaffWorkingHourOverrideGroup) => {
    const targetDates = new Set(
      (group?.dates || [])
        .map((d) => normalizeLeaveUntil(d))
        .filter((d): d is string => !!d)
    );
    if (!targetDates.size) return;
    setModalCustomHourOverrides((prev) =>
      prev.filter((x) => !targetDates.has(normalizeLeaveUntil(x.date)))
    );

    const editingDate = normalizeLeaveUntil(modalHourOverrideEditingDate);
    if (editingDate && targetDates.has(editingDate)) {
      cancelModalWorkingHourOverrideEdit();
      return;
    }

    if (!editingDate && modalHourOverrideUpdateExistingOnly) {
      const from = normalizeLeaveUntil(modalHourOverrideFromDate);
      const to = normalizeLeaveUntil(modalHourOverrideToDate) || from;
      if ((from && targetDates.has(from)) || (to && targetDates.has(to))) {
        cancelModalWorkingHourOverrideEdit();
      }
    }
  };

  const buildModalWorkingHourOverrides = (
    sourceOverrides: StaffWorkingHourOverride[]
  ): { next: StaffWorkingHourOverride[]; appliedCount: number; error?: string } => {
    const base = normalizeWorkingHourOverrides(sourceOverrides);
    const editingDate = normalizeLeaveUntil(modalHourOverrideEditingDate);
    if (editingDate) {
      const targetDate = normalizeLeaveUntil(modalHourOverrideFromDate) || editingDate;
      const start = normalizeTimeHHMM(modalHourOverrideStart) || "10:00";
      const end = normalizeTimeHHMM(modalHourOverrideEnd) || "22:00";
      const note = String(modalHourOverrideNote || "").trim() || undefined;
      return {
        next: normalizeWorkingHourOverrides([
          ...base.filter((x) => x.date !== editingDate && x.date !== targetDate),
          {
            date: targetDate,
            enabled: modalHourOverrideQuickMode === "closed" ? false : modalHourOverrideEnabled,
            start,
            end,
            ...(note ? { note } : {}),
          },
        ]),
        appliedCount: 1,
      };
    }

    const fromInput = normalizeLeaveUntil(modalHourOverrideFromDate);
    const toInput =
      modalHourOverrideMode === "single"
        ? fromInput
        : normalizeLeaveUntil(modalHourOverrideToDate) || fromInput;
    if (!fromInput) return { next: base, appliedCount: 0 };
    const from = fromInput <= toInput ? fromInput : toInput;
    const to = fromInput <= toInput ? toInput : fromInput;
    const start = normalizeTimeHHMM(modalHourOverrideStart) || "10:00";
    const end = normalizeTimeHHMM(modalHourOverrideEnd) || "22:00";
    const note = String(modalHourOverrideNote || "").trim() || undefined;
    const maxDays = 120;
    const rows: StaffWorkingHourOverride[] = [];
    let cursor = from;
    let guard = 0;
    while (cursor && cursor <= to) {
      const day = weekdayFromIso(cursor);
      const allowed =
        modalHourOverrideMode !== "specific" ||
        (!!day && modalHourOverrideApplyWeekdays.includes(day));
      if (allowed) {
        const rowStart = start;
        let rowEnd = end;
        let rowEnabled = modalHourOverrideEnabled;
        if (modalHourOverrideQuickMode === "closed") {
          rowEnabled = false;
        } else if (modalHourOverrideQuickMode === "plus1" || modalHourOverrideQuickMode === "plus2") {
          const plusMin = modalHourOverrideQuickMode === "plus1" ? 60 : 120;
          rowEnd = minutesToHHMM(toMinutes(end) + plusMin);
        }
        rows.push({
          date: cursor,
          enabled: rowEnabled,
          start: rowStart,
          end: rowEnd,
          ...(note ? { note } : {}),
        });
      }
      cursor = addDaysIso(cursor, 1);
      guard += 1;
      if (guard > maxDays) {
        return { next: base, appliedCount: 0, error: "نطاق التاريخ كبير جداً. الحد الأقصى 120 يوم." };
      }
    }
    if (rows.length === 0) {
      return { next: base, appliedCount: 0, error: "لا يوجد أيام مطابقة للفلاتر المختارة داخل النطاق." };
    }

    const rowsToApply = modalHourOverrideUpdateExistingOnly
      ? rows.filter((r) => base.some((x) => x.date === r.date))
      : rows;
    if (modalHourOverrideUpdateExistingOnly && rowsToApply.length === 0) {
      return { next: base, appliedCount: 0, error: "لا يوجد استثناءات حالية مطابقة للنطاق/الفلاتر لتعديلها." };
    }

    if (modalHourOverrideUpdateExistingOnly || modalHourOverrideApplyMethod === "replace") {
      return {
        next: normalizeWorkingHourOverrides([
          ...base.filter((x) => !rowsToApply.some((r) => r.date === x.date)),
          ...rowsToApply,
        ]),
        appliedCount: rowsToApply.length,
      };
    }

    const existing = new Set(base.map((x) => x.date));
    const toAdd = rowsToApply.filter((r) => !existing.has(r.date));
    return {
      next: normalizeWorkingHourOverrides([...base, ...toAdd]),
      appliedCount: toAdd.length,
    };
  };

  const addModalWorkingHourOverride = () => {
    const result = buildModalWorkingHourOverrides(modalCustomHourOverrides);
    if (result.error) {
      setErrorMsg(result.error);
      return;
    }
    if (result.appliedCount <= 0) {
      return;
    }
    setModalCustomHourOverrides(result.next);
    if (
      normalizeLeaveUntil(modalHourOverrideEditingDate) ||
      String(modalHourOverrideEditingGroupId || "").trim()
    ) {
      cancelModalWorkingHourOverrideEdit();
      return;
    }
    setModalHourOverrideFromDate("");
    setModalHourOverrideToDate("");
    setModalHourOverrideHijriPickerOpen(false);
    setModalHourOverrideHijriPickerTarget("from");
    setModalHourOverrideHijriViewMonthISO(findHijriMonthStartIso(todayIso()));
    setModalHourOverrideStart("10:00");
    setModalHourOverrideEnd("22:00");
    setModalHourOverrideEnabled(true);
    setModalHourOverrideMode("single");
    setModalHourOverrideQuickMode("manual");
    setModalHourOverrideApplyMethod("replace");
    setModalHourOverrideNote("");
    setModalHourOverrideEditingDate("");
    setModalHourOverrideEditingGroupId("");
    setModalHourOverrideUpdateExistingOnly(false);
  };

  const applyLeaveChange = async (
    mode: "add" | "deduct"
  ) => {
    if (
      !authUser ||
      !editingStaff ||
      !ensureCanManageLeaveBalance()
    ) {
      return;
    }

    const days = Number(
      String(leaveAdjustDays || "")
        .trim()
        .replace(",", ".")
    );

    if (
      !Number.isFinite(days) ||
      days <= 0 ||
      Math.round(days * 2) !== days * 2
    ) {
      setErrorMsg(
        "اكتب عدد أيام صحيح بفواصل نصف يوم مثل 0.5 أو 1 أو 1.5."
      );
      return;
    }

    const opDate = String(
      leaveAdjustDate || ""
    ).trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(opDate)) {
      setErrorMsg("اختر تاريخ العملية.");
      return;
    }

    const operationSignature = [
      editingStaff.id,
      mode,
      String(days),
      opDate,
      leaveAdjustNote.trim(),
    ].join("|");

    const pendingOperation =
      leaveAdjustmentOperationRef.current;

    const generatedOperationId =
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}_${Math.random()
            .toString(36)
            .slice(2)}`;

    const operationId =
      pendingOperation?.signature === operationSignature
        ? pendingOperation.operationId
        : `manual_leave_${generatedOperationId}`;

    leaveAdjustmentOperationRef.current = {
      signature: operationSignature,
      operationId,
    };
    setSaving(true);
    setErrorMsg("");

    try {
      const result =
        await CoreHrService.adjustLeaveBalance(
          editingStaff.id,
          {
            actionType: mode,
            operationId,
            days,
            operationDate: opDate,
            note: leaveAdjustNote.trim(),
          }
        );

      if (!result.createdEntry) {
        throw new Error(
          "core_leave_balance:missing_created_entry"
        );
      }

      const createdEntry =
        result.createdEntry;

      leaveAdjustmentOperationRef.current = null;

      setList((prev) =>
        prev.map((row) =>
          row.id === editingStaff.id
            ? ({
                ...row,
                leaveBalanceDays:
                  result.leaveBalanceDays,
                leaveEntries:
                  result.leaveEntries as LeaveEntry[],
              } as StaffPublicUi)
            : row
        )
      );

      setLeaveAdjustDays("1");
      setLeaveAdjustNote("");

      void writeAuditLog({
        action:
          "employee_leave_balance_updated",
        entityType: "employee",
        entityId: editingStaff.id,
        source: "dashboard",
        description:
          mode === "add"
            ? "إضافة رصيد إجازة للموظفة"
            : "خصم رصيد إجازة من الموظفة",
        before: {
          leaveBalanceDays:
            result.previousBalance,
        },
        after: {
          leaveBalanceDays:
            result.leaveBalanceDays,
        },
        meta: {
          leaveAction: mode,
          days,
          changeAmount:
            createdEntry.changeAmount,
          balanceBefore:
            createdEntry.balanceBefore,
          balanceAfter:
            createdEntry.balanceAfter,
          leaveBalanceEntryId:
            createdEntry.id,
          sourceType:
            createdEntry.sourceType,
          opDate,
          staffName:
            editingStaff.name,
        },
      });

      const target =
        resolveStaffNotificationTarget(
          editingStaff
        );

      await createEmployeeNotification({
        targetUid:
          target.targetUid || undefined,
        targetEmployeeId:
          target.targetEmployeeId ||
          undefined,
        type: "leave",
        title:
          mode === "add"
            ? "تمت إضافة رصيد إجازة"
            : "تم خصم رصيد إجازة",
        body:
          `العملية ${
            mode === "add"
              ? "إضافة"
              : "خصم"
          } ${days} يوم. ` +
          `الرصيد الحالي: ${
            result.leaveBalanceDays
          } يوم.`,
        route: "/employee/leave",
      }).catch(() => {});
    } catch (error) {
      setErrorMsg(
        toFirestoreErrorMessage(
          error,
          "تعذر حفظ حركة الإجازة في Core."
        )
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteLeaveEntry = async (
    entry: LeaveEntry
  ) => {
    if (
      !authUser ||
      !editingStaff ||
      !ensureCanManageLeaveBalance()
    ) {
      return;
    }

    const entryId = String(
      entry?.id || ""
    ).trim();

    if (!entryId) {
      setErrorMsg(
        "تعذر تحديد سجل الإجازة المطلوب."
      );
      return;
    }

    const ok = confirm(
      "هل أنت متأكد من حذف هذا السجل؟ سيتم إنشاء حركة عكسية وتعديل رصيد الإجازات تلقائيًا."
    );

    if (!ok) return;

    setSaving(true);
    setErrorMsg("");

    try {
      const result =
        await CoreHrService.deleteLeaveBalanceEntry(
          editingStaff.id,
          entryId
        );

      if (!result.deletedEntry) {
        throw new Error(
          "core_leave_balance:missing_deleted_entry"
        );
      }

      const deletedEntry =
        result.deletedEntry;

      setList((prev) =>
        prev.map((row) =>
          row.id === editingStaff.id
            ? ({
                ...row,
                leaveBalanceDays:
                  result.leaveBalanceDays,
                leaveEntries:
                  result.leaveEntries as LeaveEntry[],
              } as StaffPublicUi)
            : row
        )
      );

      void writeAuditLog({
        action:
          "employee_leave_balance_updated",
        entityType: "employee",
        entityId: editingStaff.id,
        source: "dashboard",
        description:
          "عكس حركة من سجل رصيد الإجازات للموظفة",
        before: {
          leaveBalanceDays:
            result.previousBalance,
        },
        after: {
          leaveBalanceDays:
            result.leaveBalanceDays,
        },
        meta: {
          leaveAction:
            normalizeLeaveEntryType(
              deletedEntry.type
            ) ||
            String(
              deletedEntry.actionType || ""
            ),
          deletedLeaveEntryId:
            deletedEntry.id,
          reversalEntryId:
            result.reversalEntry?.id || "",
          days:
            deletedEntry.days,
          changeAmount:
            deletedEntry.changeAmount,
          reversedChangeAmount:
            result.reversedChangeAmount,
          balanceBefore:
            deletedEntry.balanceBefore,
          balanceAfter:
            deletedEntry.balanceAfter,
          opDate:
            deletedEntry.date,
          staffName:
            editingStaff.name,
          softDeleted: true,
          sourceType:
            deletedEntry.sourceType,
        },
      });
    } catch (error) {
      setErrorMsg(
        toFirestoreErrorMessage(
          error,
          "تعذر عكس حركة الإجازة في Core."
        )
      );
    } finally {
      setSaving(false);
    }
  };

  const saveEntitlementDate = async () => {
    if (
      !editingStaff ||
      !ensureCanManageLeaveBalance()
    ) {
      return;
    }

    const date = String(
      leaveEntitlementDate || ""
    ).trim();

    if (
      date &&
      !/^\d{4}-\d{2}-\d{2}$/.test(date)
    ) {
      setErrorMsg(
        "تاريخ الاستحقاق غير صحيح."
      );
      return;
    }

    setSaving(true);
    setErrorMsg("");

    try {
      const state =
        await CoreHrService.setLeaveEntitlementDate(
          editingStaff.id,
          date
        );

      const canonicalDate =
        cleanText(
          state.leaveEntitlementDate
        );

      setLeaveEntitlementDate(
        canonicalDate
      );

      setList((prev) =>
        prev.map((row) =>
          row.id === editingStaff.id
            ? ({
                ...row,
                leaveBalanceDays:
                  state.leaveBalance,
                leaveEntitlementDate:
                  canonicalDate,
                leaveEntries:
                  state.entries as LeaveEntry[],
              } as StaffPublicUi)
            : row
        )
      );

      void writeAuditLog({
        action:
          "employee_leave_balance_updated",
        entityType: "employee",
        entityId: editingStaff.id,
        source: "dashboard",
        description:
          "تحديث تاريخ استحقاق رصيد الإجازة",
        after: {
          leaveEntitlementDate:
            canonicalDate,
        },
        meta: {
          staffName:
            editingStaff.name,
        },
      });
    } catch (error) {
      setErrorMsg(
        toFirestoreErrorMessage(
          error,
          "تعذر حفظ تاريخ الاستحقاق في Core."
        )
      );
    } finally {
      setSaving(false);
    }
  };

  if (!authUser) {
    return (
      <div className="dsv2-page dsv2-employees-page">
        <section className="dsv2-card dsv2-card--padded employees-v2-access-state">
          <h2 className="dsv2-section-title">غير مصرح</h2>
          <p className="dsv2-section-caption">سجّل دخول ثم جرّب مرة أخرى.</p>
        </section>
      </div>

    );
  }

  if (!canAccessEmployeesDashboard) {
    return (
      <div className="dsv2-page dsv2-employees-page">
        <section className="dsv2-card dsv2-card--padded employees-v2-access-state">
          <h2 className="dsv2-section-title">صلاحيات غير كافية</h2>
          <p className="dsv2-section-caption">هذه الصفحة مخصصة للإدارة.</p>
        </section>
      </div>
    );
  }

  const openCreateEmployee = () => {
    if (!canCreateEmployees) {
      setErrorMsg("ليست لديك صلاحية لإضافة موظفات.");
      return;
    }
    resetForm();
    setSelectedEmployeeId(null);
    setMode("edit");
    setIsOpen(true);
  };
  const handleSplitTabChange = (tab: EmployeeSplitTab) => {
    const resolvedTab: EmployeeSplitTab = tab === "shifts" ? "booking" : tab;
    if (selectedEmployeeId) {
      navigate(`/dashboard/employees/${encodeURIComponent(selectedEmployeeId)}/${resolvedTab}`);
    }
    setActiveTab(resolvedTab);
    if (resolvedTab === "payroll") {
      setActiveStatsSubTab("payroll");
      setModalTab("stats");
      return;
    }
    if (resolvedTab === "leave") {
      setActiveStatsSubTab("stats");
      setModalTab("stats");
      return;
    }
    if (resolvedTab === "basic") {
      setModalTab("basic");
      return;
    }
    if (resolvedTab === "booking") {
      setModalTab("booking");
      return;
    }
    if (resolvedTab === "profile") {
      setModalTab("profile");
      return;
    }
    if (resolvedTab === "services") {
      setModalTab("services");
      return;
    }
    setModalTab("basic");
  };
  const handleCancelEdit = () => {
    const currentTab = activeTab;
    const currentModalTab = modalTab;
    const currentStatsTab = activeStatsSubTab;
    if (selectedEmployee) {
      openEdit(selectedEmployee, false);
      setActiveTab(currentTab);
      setModalTab(currentModalTab);
      setActiveStatsSubTab(currentStatsTab);
    }
    setMode("edit");
  };
  const modalOverrideEditor = {
    modalHourOverrideMode,
    modalHourOverrideEditingDate,
    modalHourOverrideEditingGroupId,
    modalHourOverrideQuickMode,
    modalHourOverrideUpdateExistingOnly,
    modalHourOverrideCalendar,
    modalHourOverrideHijriPickerOpen,
    modalHourOverrideHijriMonthTitle,
    modalHourOverrideHijriWeekOffset,
    modalHourOverrideHijriMonthDays,
    modalHourOverrideHijriPickerTarget,
    modalHourOverrideFromDate,
    modalHourOverrideToDate,
    modalHourOverrideFromDateHijri,
    modalHourOverrideToDateHijri,
    modalHourOverrideEnabled,
    modalHourOverrideStart,
    modalHourOverrideEnd,
    modalHourOverrideNote,
    modalHourOverridePreview,
    modalHourOverrideApplyWeekdays,
    modalHourOverrideApplyCount,
    modalHourOverrideOverwriteExisting,
    modalCustomHourOverrides,
    modalHourOverrideGroups,
    setModalHourOverrideEditingGroupId,
    setModalHourOverrideMode,
    fillModalHourOverrideFromBaseDay,
    setModalHourOverrideQuickMode,
    setModalHourOverrideEnabled,
    setModalHourOverrideStart,
    setModalHourOverrideEnd,
    setModalHourOverrideApplyMethod,
    setModalHourOverrideOverwriteExisting,
    setModalHourOverrideUpdateExistingOnly,
    setModalHourOverrideCalendar,
    setModalHourOverrideHijriPickerOpen,
    applyModalHourOverrideHijriInput,
    openModalHourOverrideHijriPicker,
    setModalHourOverrideFromGregorian,
    setModalHourOverrideToGregorian,
    setModalHourOverrideHijriViewMonthISO,
    applyModalHourOverrideHijriPick,
    setModalHourOverrideNote,
    addModalWorkingHourOverride,
    cancelModalWorkingHourOverrideEdit,
    toggleModalHourOverrideWeekday,
    startModalWorkingHourOverrideGroupEdit,
    removeModalWorkingHourOverrideGroup,
    setModalCustomHourOverrides,
    setModalHourOverrideRangeFromExisting,
    shiftHijriMonthStartIso,
  };
  const modalLeaveEntries = Array.isArray((editingStaff as any)?.leaveEntries)
    ? ((editingStaff as any).leaveEntries as LeaveEntry[])
    : [];
  const selectedAttendanceIdentity = resolveEmployeeAttendanceIdentity(
    editingStaff || selectedEmployee,
    selectedEmployeeId || ""
  );
  const EmployeeEditorSurface = editingStaff ? EmployeeProfilePageLayout : EmployeeEditorModal;

  return (
    <div
      className={`dsv2-page dsv2-employees-page ${
        isEmployeeProfileRoute
          ? "dsv2-employees-page--profile"
          : "dsv2-employees-page--directory"
      }`}
    >
      <div className="dsv2-employees-page__container">
        {!isEmployeeProfileRoute ? (
          <>
            <header className="dsv2-page-head employees-v2-page-head" aria-label="إدارة الموظفات">
              <div className="employees-v2-page-heading">
                <span className="dsv2-badge dsv2-badge--gold">
                  <FontAwesomeIcon icon={faUserTie} />
                  الموارد البشرية
                </span>
                <h1 className="dsv2-page-title">إدارة الموظفات</h1>
                <p className="dsv2-page-subtitle">
                  إدارة الملفات الوظيفية والحضور والخدمات والرواتب من مساحة موحدة.
                </p>
              </div>

              <div className="employees-v2-page-actions">
                {canCreateEmployees ? (
                  <button className="dsv2-btn dsv2-btn--primary" type="button" onClick={openCreateEmployee}>
                    <FontAwesomeIcon icon={faPlus} />
                    إضافة موظفة
                  </button>
                ) : null}
                {canFixBookings ? (
                  <button
                    className="dsv2-btn dsv2-btn--secondary"
                    type="button"
                    onClick={() => setRepairConfirmOpen(true)}
                    title="إصلاح ربط الحجوزات"
                  >
                    <FontAwesomeIcon icon={faScrewdriverWrench} />
                    إصلاح الملفات
                  </button>
                ) : null}
                <button
                  className="dsv2-btn dsv2-btn--secondary"
                  onClick={() => void reloadData(true)}
                  disabled={busy}
                  type="button"
                >
                  <FontAwesomeIcon icon={faRotateRight} />
                  تحديث البيانات
                </button>
              </div>
            </header>

            <section className="dsv2-grid dsv2-grid--metrics employees-v2-metrics" aria-label="إحصاءات الموظفات">
              <article className="dsv2-metric-card dsv2-metric-card--dark">
                <p className="dsv2-metric-card__label">إجمالي الملفات</p>
                <strong className="dsv2-metric-card__value">{totalEmployeeCount}</strong>
                <p className="dsv2-metric-card__meta">كل الملفات المتاحة حسب الصلاحية</p>
              </article>
              <article className="dsv2-metric-card dsv2-metric-card--success">
                <p className="dsv2-metric-card__label">على رأس العمل</p>
                <strong className="dsv2-metric-card__value">{availableEmployeeCount}</strong>
                <p className="dsv2-metric-card__meta">نشطات ولسن في إجازة</p>
              </article>
              <article className="dsv2-metric-card dsv2-metric-card--gold">
                <p className="dsv2-metric-card__label">في إجازة</p>
                <strong className="dsv2-metric-card__value">{leaveEmployeeCount}</strong>
                <p className="dsv2-metric-card__meta">إجازة حالية من سجل الموظفة</p>
              </article>
              <article className="dsv2-metric-card dsv2-metric-card--danger">
                <p className="dsv2-metric-card__label">تحتاج متابعة</p>
                <strong className="dsv2-metric-card__value">{inactiveEmployeeCount + noServiceEmployeeCount + incompleteEmployeeCount}</strong>
                <p className="dsv2-metric-card__meta">غير نشطة أو بدون خدمات أو ملف غير مكتمل</p>
              </article>
            </section>
          </>
        ) : null}

        {errorMsg ? (
          <div className="employees-v2-alert" role="alert">
            {errorMsg}
          </div>
        ) : null}

        {saveMessage ? (
          <div className="employees-v2-alert employees-v2-alert--success" role="status">
            {saveMessage}
          </div>
        ) : null}

        {repairMessage ? (
          <div className="employees-v2-alert employees-v2-alert--success" role="status">
            {repairMessage}
          </div>
        ) : null}

        <div className={isEmployeeProfileRoute ? "employees-v2-profile-host" : "employees-v2-directory-host"}>
          {!isEmployeeProfileRoute ? (
            <EmployeeListPanel
              qText={qText}
              onlyActive={onlyActive}
              directoryVisibility={directoryVisibility}
              specialtyFilter={specialtyFilter}
              serviceOptions={serviceOptions}
              sectionOptions={sectionOptions}
              filtered={filtered}
              loading={loading}
              statsLoading={statsLoading}
              bookingStats={bookingStats}
              selectedEmployeeId={selectedEmployeeId}
              onQTextChange={setQText}
              onOnlyActiveChange={setOnlyActive}
              onDirectoryVisibilityChange={setDirectoryVisibility}
              onSpecialtyFilterChange={setSpecialtyFilter}
              canManage={canCreateEmployees}
              onCreateEmployee={openCreateEmployee}
              onOpenEmployee={openEdit}
            />
          ) : !editingStaff ? (
            <section className="dsv2-card dsv2-card--padded employees-v2-profile-loading" aria-live="polite">
              <span className="employees-v2-loading-ring" aria-hidden="true" />
              <div>
                <strong>جاري فتح ملف الموظفة...</strong>
                <p>يتم تحميل الملف من السجل الوظيفي الحالي بدون تغيير مسارات الحسابات.</p>
              </div>
            </section>
          ) : null}

          <EmployeeDetailShell
            selectedEmployeeId={selectedEmployeeId}
            selectedEmployee={selectedEmployee}
            selectedEmployeeStatusLabel={selectedEmployeeStatusLabel}
            selectedEmployeeStatusClass={selectedEmployeeStatusClass}
            busy={busy}
            activeTab={activeTab}
            tabs={detailTabs}
            canManage={canUpdateEmployees}
            canDelete={canDeleteEmployees}
            onSave={save}
            onDelete={() => selectedEmployeeId && remove(selectedEmployeeId)}
            onCancelEdit={handleCancelEdit}
            onTabChange={handleSplitTabChange}
            onClose={closeEmployeeDetail}
            showEditor={isOpen}
          >
            <EmployeeEditorSurface
              isOpen={isOpen}
              canManage={editId ? canUpdateEmployees : canCreateEmployees}
              busy={busy}
              saving={saving}
              editId={editId}
              editingStaff={editingStaff}
              name={name}
              modalTab={modalTab}
              modalTabs={modalTabs}
              activeTab={activeTab}
              detailTabs={detailTabs}
              selectedEmployeeStatusLabel={selectedEmployeeStatusLabel}
              selectedEmployeeStatusClass={selectedEmployeeStatusClass}
              hasUnsavedChanges={employeeProfileHasUnsavedChanges}
              canDelete={canDeleteEmployees}
              onClose={editId ? closeEmployeeDetail : closeModal}
              onSave={save}
              onDelete={() => selectedEmployeeId && remove(selectedEmployeeId)}
              onCancelEdit={handleCancelEdit}
              onModalTabChange={setModalTab}
              onDetailTabChange={handleSplitTabChange}
            >
              <ScheduleSummarySection
                isVisible={!!editingStaff && modalTab === "basic"}
                nowTick={nowTick}
                summary={modalStaffScheduleSummary}
              />
              <EmployeeStatsSection
                isVisible={!!editingStaff && ((activeTab === "payroll" && canViewPayroll) || (activeTab === "leave" && canManageLeaveBalance))}
                busy={busy}
                loading={loading}
                canManagePayroll={canManagePayroll}
                canManageLeaveBalance={canManageLeaveBalance}
                leaveBalanceDays={parsePositiveInt(String((editingStaff as any)?.leaveBalanceDays || 0), 0)}
                leaveEntries={modalLeaveEntries}
                showPayrollSubTab={showPayrollSubTab}
                showStatsSubTab={showStatsSubTab}
                currentMonthKeyLabel={currentMonthKey()}
                payroll={{
                  monthlySalary,
                  workDays: overtimeDaysPerMonth,
                  dailyHours: overtimeBaseHoursPerDay,
                  monthlyHours: payrollMonthlyHours,
                  overtimeEnabled: payrollOvertimeEnabled,
                  overtimeMultiplier: payrollOvertimeMultiplier,
                  deductionMethod: payrollDeductionMethod,
                  summary: modalPayrollMonthSummary,
                  setupPreview: payrollSettingsPreview,
                  savingSettings: payrollSettingsSaving,
                  settingsMessage: payrollSettingsMessage,
                  onMonthlySalaryChange: setMonthlySalary,
                  onWorkDaysChange: setOvertimeDaysPerMonth,
                  onDailyHoursChange: setOvertimeBaseHoursPerDay,
                  onMonthlyHoursChange: setPayrollMonthlyHours,
                  onOvertimeEnabledChange: setPayrollOvertimeEnabled,
                  onOvertimeMultiplierChange: setPayrollOvertimeMultiplier,
                  onDeductionMethodChange: setPayrollDeductionMethod,
                  onSaveSettings: () => {
                    void savePayrollSettings();
                  },
                }}
                leave={{
                  modalOnLeave,
                  modalLeaveFrom,
                  modalLeaveUntil,
                  modalLeaveType,
                  modalLeaveNote,
                  modalExceptionalLeaveWeekdays,
                  modalLeaveExpired,
                  leaveEntitlementDate,
                  leaveAdjustDays,
                  leaveAdjustDate,
                  leaveAdjustNote,
                  onCreateApprovedLeave: openApprovedLeaveFromEmployeeProfile,
                  onEndCurrentLeave: () => {
                    void endCurrentApprovedLeave();
                  },
                  onLeaveEntitlementDateChange: setLeaveEntitlementDate,
                  onLeaveAdjustDaysChange: setLeaveAdjustDays,
                  onLeaveAdjustDateChange: setLeaveAdjustDate,
                  onLeaveAdjustNoteChange: setLeaveAdjustNote,
                  onSaveEntitlementDate: () => {
                    void saveEntitlementDate();
                  },
                  onApplyLeaveChange: (leaveMode) => {
                    void applyLeaveChange(leaveMode);
                  },
                  onDeleteLeaveEntry: (entry) => {
                    void deleteLeaveEntry(entry);
                  },
                }}
              />
              <AttendanceSection
                isVisible={!!editingStaff && activeTab === "attendance" && canViewAttendance}
                loading={employeeAttendanceLoading}
                error={employeeAttendanceError}
                rows={employeeAttendanceRows}
                monthKey={employeeAttendanceMonth}
                selectedDate={employeeAttendanceSelectedDate}
                employeeId={selectedAttendanceIdentity.employeeUid || selectedEmployeeId || (editingStaff as any)?.id || ""}
                employeeIds={selectedAttendanceIdentity.allIds}
                canEdit={canCreateAttendance || canUpdateAttendance}
                canDelete={canDeleteAttendance}
                canReview={canViewAttendance}
                canCreateEmergencyLeave={canManageLeaveBalance}
                canCancelLeave={canManageLeaveBalance}
                onMonthChange={(monthKey) => {
                  setEmployeeAttendanceMonth(monthKey);
                  setEmployeeAttendanceSelectedDate((current) =>
                    String(current || "").startsWith(monthKey) ? current : `${monthKey}-01`
                  );
                }}
                onSelectedDateChange={setEmployeeAttendanceSelectedDate}
                onReload={() => {
                  void loadSelectedEmployeeAttendance({ force: true });
                }}
                onEditPunch={openAttendancePunchEditor}
                onDeletePunch={(dateKey) => {
                  void deleteAttendancePunch(dateKey);
                }}
                onCreateEmergencyLeave={(dateKey) => {
                  void createEmergencyLeaveForAttendanceDay(dateKey);
                }}
                onCancelLeave={(dateKey) => {
                  void cancelLeaveForAttendanceDay(dateKey);
                }}
              />
              <DashboardModalV2
                open={
                  attendanceEditOpen &&
                  activeTab === "attendance" &&
                  (canCreateAttendance || canUpdateAttendance)
                }
                onClose={closeAttendancePunchEditor}
                title="تعديل البصمة"
                description={
                  attendanceEditDate
                    ? `تعديل سجل الحضور ليوم ${attendanceEditDate}`
                    : "تعديل سجل الحضور والانصراف"
                }
                eyebrow="الحضور والانصراف"
                size="md"
                closeOnBackdrop={!saving}
                closeOnEscape={!saving}
                footer={
                  <>
                    <button
                      type="button"
                      className="dsv2-btn dsv2-btn--secondary"
                      onClick={closeAttendancePunchEditor}
                      disabled={saving}
                    >
                      إلغاء
                    </button>
                    <button
                      type="button"
                      className="dsv2-btn dsv2-btn--primary"
                      onClick={() => void saveAttendancePunchEditor()}
                      disabled={saving}
                    >
                      {saving ? "جارٍ الحفظ..." : "حفظ تعديل البصمة"}
                    </button>
                  </>
                }
              >
                <div className="dsv2-ew-dialog-grid dsv2-ew-dialog-grid--2 emp-attendance-edit-form-v2">
                  <DashboardFieldV2
                    id="employee-attendance-edit-check-in"
                    label="وقت الحضور"
                    hint="اختاري ساعة ودقيقة الحضور فقط."
                  >
                    <input
                      id="employee-attendance-edit-check-in"
                      className="dsv2-input"
                      type="time"
                      dir="ltr"
                      step={300}
                      value={
                        attendanceEditCheckIn
                          ? attendanceEditCheckIn.slice(11, 16)
                          : ""
                      }
                      onChange={(event) =>
                        setAttendanceEditCheckIn(
                          event.target.value
                            ? `${attendanceEditDate}T${event.target.value}`
                            : ""
                        )
                      }
                      disabled={saving}
                    />
                  </DashboardFieldV2>

                  <DashboardFieldV2
                    id="employee-attendance-edit-check-out"
                    label="وقت الانصراف"
                    hint="يمكن تركه فارغًا إذا لم تسجل الموظفة انصرافًا."
                  >
                    <div className="emp-attendance-edit-time-control-v2">
                      <input
                        id="employee-attendance-edit-check-out"
                        className="dsv2-input"
                        type="time"
                        dir="ltr"
                        step={300}
                        value={
                          attendanceEditCheckOut
                            ? attendanceEditCheckOut.slice(11, 16)
                            : ""
                        }
                        onChange={(event) =>
                          setAttendanceEditCheckOut(
                            event.target.value
                              ? `${attendanceEditDate}T${event.target.value}`
                              : ""
                          )
                        }
                        disabled={saving}
                      />

                      {attendanceEditCheckOut ? (
                        <button
                          type="button"
                          className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm"
                          onClick={() => setAttendanceEditCheckOut("")}
                          disabled={saving}
                        >
                          مسح الوقت
                        </button>
                      ) : null}
                    </div>
                  </DashboardFieldV2>

                  <DashboardFieldV2
                    id="employee-attendance-edit-note"
                    label="ملاحظة الإدارة"
                    hint="يُفضّل توضيح سبب تعديل البصمة لأغراض المراجعة."
                    className="dsv2-ew-form-wide"
                  >
                    <textarea
                      id="employee-attendance-edit-note"
                      className="dsv2-textarea"
                      value={attendanceEditNote}
                      onChange={(event) =>
                        setAttendanceEditNote(event.target.value)
                      }
                      disabled={saving}
                      placeholder="مثال: تصحيح بصمة من الإدارة"
                      rows={4}
                    />
                  </DashboardFieldV2>
                </div>
              </DashboardModalV2>
              <BasicInfoSection
                isVisible={(!editingStaff && modalTab === "basic") || (!!editingStaff && activeTab === "basic")}
                name={name}
                active={active}
                showOnAbout={showOnAbout}
                showOnBooking={showOnBooking}
                includeInEmployeeManagement={includeInEmployeeManagement}
                weeklyOffLabel={
                  modalExceptionalLeaveWeekdays.length
                    ? modalExceptionalLeaveWeekdays.map((day) => WEEKDAY_OPTIONS.find((item) => item.key === day)?.label || day).join("طŒ ")
                    : "لا توجد إجازة أسبوعية ثابتة."
                }
                onNameChange={setName}
                onActiveChange={setActive}
                onShowOnAboutChange={setShowOnAbout}
                onShowOnBookingChange={setShowOnBooking}
                onIncludeInEmployeeManagementChange={setIncludeInEmployeeManagement}
              />
              <BookingSettingsSection
                isVisible={(!editingStaff && modalTab === "booking") || (!!editingStaff && activeTab === "booking")}
                busy={busy || coreScheduleLoading}
                loading={loading || coreScheduleLoading}
                employmentEndDate={employmentEndDate}
                modalUseCustomWorkingHours={modalUseCustomWorkingHours}
                modalCustomWorkingHours={modalCustomWorkingHours}
                modalExceptionalLeaveWeekdays={modalExceptionalLeaveWeekdays}
                scheduleEffectiveFrom={modalScheduleEffectiveFrom}
                scheduleChangeReason={modalScheduleChangeReason}
                scheduleVersionCount={coreScheduleVersionCount}
                attendanceZones={attendanceZones}
                attendanceZonesLoading={attendanceZonesLoading}
                selectedAttendanceZoneId={selectedAttendanceZoneId}
                modalHourOverrideHijriPickerRef={modalHourOverrideHijriPickerRef}
                overrideEditor={modalOverrideEditor}
                onEmploymentEndDateChange={setEmploymentEndDate}
                onModalUseCustomWorkingHoursChange={setModalUseCustomWorkingHours}
                onScheduleEffectiveFromChange={setModalScheduleEffectiveFrom}
                onScheduleChangeReasonChange={setModalScheduleChangeReason}
                onSelectedAttendanceZoneIdChange={setSelectedAttendanceZoneId}
                onReloadAttendanceZones={() => void loadAttendanceZones()}
                onUpdateModalWorkingDay={updateModalWorkingDay}
                onCopyModalWorkingDayToAll={copyModalWorkingDayToAll}
              />
              <ShiftControlSection
                isVisible={!!editingStaff && activeTab === "booking" && canManageSchedule}
                employeeId={selectedEmployeeId || (editingStaff as any)?.id || ""}
                employeeUid={selectedAttendanceIdentity.employeeUid || ""}
                employeeIds={selectedAttendanceIdentity.allIds}
                employeeName={name || (editingStaff as any)?.name || ""}
                canManage={canManageSchedule}
              />
              <ProfileSection
                isVisible={(!editingStaff && modalTab === "profile") || (!!editingStaff && activeTab === "profile")}
                avatarUrl={avatarUrl}
                bio={bio}
                cvUrl={cvUrl}
                rating={rating}
                reviewsCount={reviewsCount}
                staffImageOptions={STAFF_IMAGE_OPTIONS}
                resolveAvatarFromAssets={resolveAvatarFromAssets}
                onAvatarUrlChange={setAvatarUrl}
                onBioChange={setBio}
                onCvUrlChange={setCvUrl}
                onRatingChange={setRating}
                onReviewsCountChange={setReviewsCount}
              />
              <ServicesSection
                isVisible={(!editingStaff && modalTab === "services") || (!!editingStaff && activeTab === "services")}
                srvQ={srvQ}
                srvSection={srvSection}
                sectionOptions={sectionOptions}
                serviceOptions={serviceOptions}
                filteredServicesForPicks={filteredServicesForPicks}
                specialties={specialties}
                onSrvQChange={setSrvQ}
                onSrvSectionChange={setSrvSection}
                onToggleSpecialty={toggleSpecialty}
                onSpecialtiesChange={setSpecialties}
              />
              {editingStaff ? (
                <EmployeeRequestsSection
                  isVisible={activeTab === "requests" && canManageLeaveBalance}
                  employeeId={selectedEmployeeId || editingStaff.id}
                  employeeUid={selectedAttendanceIdentity.employeeUid || selectedEmployeeId || editingStaff.id}
                  employeeName={name || editingStaff.name || ""}
                  reviewerUid={authUser?.uid || ""}
                  reviewerName={authUser?.displayName || authUser?.email || "الإدارة"}
                  canManage={canManageLeaveBalance}
                />
              ) : null}
              {editingStaff ? (
                <EmployeeMessagesSection
                  isVisible={activeTab === "messages" && canViewEmployeeMessages}
                  employeeId={selectedEmployeeId || editingStaff.id}
                  employeeUid={selectedAttendanceIdentity.employeeUid || selectedEmployeeId || editingStaff.id}
                  employeeName={name || editingStaff.name || ""}
                  viewerUid={authUser?.uid || ""}
                  viewerName={authUser?.displayName || authUser?.email || "الإدارة"}
                  canManage={canViewEmployeeMessages}
                />
              ) : null}
              {editingStaff ? (
                <EmployeeFilesSection
                  isVisible={activeTab === "files" && canViewEmployeeFiles}
                  employeeId={selectedEmployeeId || editingStaff.id}
                  employeeUid={selectedAttendanceIdentity.employeeUid || selectedEmployeeId || editingStaff.id}
                  employeeName={name || editingStaff.name || ""}
                  viewerUid={authUser?.uid || ""}
                  viewerName={authUser?.displayName || authUser?.email || "الإدارة"}
                  canManage={canViewEmployeeFiles}
                />
              ) : null}
            </EmployeeEditorSurface>
          </EmployeeDetailShell>
        </div>
      </div>

      <LeaveRequestModal
        open={leaveModalOpen}
        onClose={() => setLeaveModalOpen(false)}
        initialDate={leaveModalDate}
        defaultType={leaveModalDefaultType}
        availableBalance={parsePositiveInt(String((selectedEmployee as any)?.leaveBalanceDays || 0), 0)}
        hasAttendanceInRange={(fromDate: string, toDate: string) => {
          const from = normalizeLeaveUntil(fromDate);
          const to = normalizeLeaveUntil(toDate) || from;
          if (!from || !to) return false;
          return employeeAttendanceRows.some((row) => {
            const d = normalizeLeaveUntil((row as any).date || (row as any).dateKey || (row as any).dayKey);
            if (!d) return false;
            if (d < from || d > to) return false;
            return Boolean((row as any).checkInAtClient || (row as any).checkOutAtClient);
          });
        }}
        hasOverlappingLeave={(fromDate: string, toDate: string) => {
          const from = normalizeLeaveUntil(fromDate);
          const to = normalizeLeaveUntil(toDate) || from;
          if (!from || !to) return false;
          return selectedEmployeeLeaveRequests.some((request) => {
            if (cleanText(request.status).toLowerCase() !== "approved") return false;
            const rf = normalizeLeaveUntil(request.fromDate);
            const rt = normalizeLeaveUntil(request.toDate) || rf;
            if (!rf || !rt) return false;
            return !(rt < from || rf > to);
          });
        }}
        onSubmit={async (payload) => {
          await handleLeaveModalSubmit(payload);
        }}
      />

      <DashboardConfirmV2
        open={repairConfirmOpen}
        onClose={() => setRepairConfirmOpen(false)}
        onConfirm={fixBookingsEmployeeUid}
        title="إصلاح ربط الحجوزات القديمة"
        description="سيتم استكمال معرف الموظفة في الحجوزات القديمة التي ينقصها الربط فقط، دون حذف أي حجز."
        tone="gold"
        confirmLabel="بدء الإصلاح"
        cancelLabel="إلغاء"
        pendingLabel="جاري الإصلاح..."
      >
        <p className="employees-v2-confirm-note">يُنفذ هذا الإجراء عند وجود حجوزات قديمة غير مرتبطة بحساب الموظفة.</p>
      </DashboardConfirmV2>
    </div>
  );
}
