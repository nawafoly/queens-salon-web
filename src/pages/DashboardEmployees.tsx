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

// âœ… Bookings stats (Owner only)
import {
  listBookings,
  type BookingDocWithId,
  type BookingStatus,
} from "../services/firestoreBookings";
import {
  buildApprovedLeaveDateKeys,
  buildAttendanceSpecialDayMap,
  leaveRequestMatchesProfile,
  type AttendanceSpecialDay,
} from "../helpers/hr/attendanceCalendarData";
import {
  appendDateEffectiveScheduleVersion,
  normalizeScheduleDateKey,
  normalizeStaffScheduleVersions,
  resolveDateEffectiveScheduleSnapshot,
  scheduleSnapshotsEqual,
} from "../helpers/hr/staffScheduleHistory";
import {
  computeStaffPayrollForMonth,
  normalizePayrollConfig,
  PAYROLL_CLOSE_DAY,
  payrollCycleKeyFromDate,
  type StaffPayrollMethod,
  type StaffOvertimeHoursBasis,
} from "../helpers/staffPayroll";

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
    useCustomWorkingHours: pickEditableBoolean("useCustomWorkingHours", false),
    customWorkingHours: primaryIsStaffPublic
      ? primary.customWorkingHours
      : primary.customWorkingHours || fallback.customWorkingHours,
    workingScheduleVersions: pickEditableArray("workingScheduleVersions", normalizeStaffScheduleVersions),
    customWorkingHourOverrides: pickEditableArray("customWorkingHourOverrides", normalizeWorkingHourOverrides),
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
    exceptionalLeaveWeekdays: sortedWeekdayKeys(staff.exceptionalLeaveWeekdays),
    attendanceZoneId: employeeVerificationAttendanceZoneId(staff),
    allowedZoneIds: employeeVerificationAllowedZoneIds(staff),
    useCustomWorkingHours: staff.useCustomWorkingHours === true,
    customWorkingHours: normalizeWorkingHours(staff.customWorkingHours),
    workingScheduleVersions: normalizeStaffScheduleVersions(staff.workingScheduleVersions),
    customWorkingHourOverrides: normalizeWorkingHourOverrides(staff.customWorkingHourOverrides),
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
    throw new Error(`طھط¹ط°ط± طھط£ظƒظٹط¯ ط­ظپط¸ ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ…ظˆط¸ظپط© (${stage}): ${mismatches.join(", ")}`);
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

  // âœ… ط¬ط¯ظٹط¯
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
        ? "ظ„ظٹط³طھ ظ„ط¯ظٹظƒ طµظ„ط§ط­ظٹط© ظ„طھط¹ط¯ظٹظ„ ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ…ظˆط¸ظپط§طھ."
        : "ظ„ظٹط³طھ ظ„ط¯ظٹظƒ طµظ„ط§ط­ظٹط© ظ„ط¥ط¶ط§ظپط© ظ…ظˆط¸ظپط§طھ."
    );
    return false;
  }, [canCreateEmployees, canUpdateEmployees, editId]);
  const ensureCanDelete = useCallback(() => {
    if (canDeleteEmployees) return true;
    setErrorMsg("ظ„ظٹط³طھ ظ„ط¯ظٹظƒ طµظ„ط§ط­ظٹط© ظ„ط­ط°ظپ ط§ظ„ظ…ظˆط¸ظپط§طھ.");
    return false;
  }, [canDeleteEmployees]);
  const ensureCanManageLeaveBalance = useCallback(() => {
    if (canManageLeaveBalance) return true;
    setErrorMsg("ظ„ظٹط³طھ ظ„ط¯ظٹظƒ طµظ„ط§ط­ظٹط© ظ„ط¥ط¯ط§ط±ط© ط±طµظٹط¯ ط§ظ„ط¥ط¬ط§ط²ط§طھ.");
    return false;
  }, [canManageLeaveBalance]);
  const resolveStaffWeeklyOffDays = useCallback((staffLike: any): WeekdayKey[] => {
    const sources = [
      staffLike?.exceptionalLeaveWeekdays,
      staffLike?.weeklyOffDays,
      staffLike?.weeklyOffDay,
      staffLike?.fixedWeeklyDayOff,
      staffLike?.weeklyHoliday,
      staffLike?.dayOff,
    ];
    const values = sources.flatMap((value) => (Array.isArray(value) ? value : value == null || value === "" ? [] : [value]));
    return normalizeExceptionalLeaveWeekdays(values);
  }, []);

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
      setErrorMsg(toFirestoreErrorMessage(error, "طھط¹ط°ط± طھط­ظ…ظٹظ„ ظ†ط·ط§ظ‚ط§طھ ط§ظ„ط­ط¶ظˆط±."));
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
        const message = `طھط¹ط°ط± طھط­ظ…ظٹظ„ ط³ط¬ظ„ ط§ظ„ط­ط¶ظˆط± ط¨ط³ط¨ط¨ طµظ„ط§ط­ظٹط§طھ ط§ظ„ظˆطµظˆظ„. ظƒظˆط¯ ط§ظ„ظ…ط·ظˆط±: 403${developerCode ? ` / ${developerCode}` : ""}`;
        setEmployeeAttendanceError(message);
        setErrorMsg(message);
      } else {
        const message = toFirestoreErrorMessage(error, "طھط¹ط°ط± طھط­ظ…ظٹظ„ ط³ط¬ظ„ ط­ط¶ظˆط± ط§ظ„ظ…ظˆط¸ظپط©.");
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
          ? "ظ„ظٹط³طھ ظ„ط¯ظٹظƒ طµظ„ط§ط­ظٹط© ظ„طھط¹ط¯ظٹظ„ ط¨طµظ…ط© ط§ظ„ظ…ظˆط¸ظپط©."
          : "ظ„ظٹط³طھ ظ„ط¯ظٹظƒ طµظ„ط§ط­ظٹط© ظ„ط¥ط¶ط§ظپط© ط¨طµظ…ط© ط¥ط¯ط§ط±ظٹط©."
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
      setErrorMsg("ظ„ظ… ظٹطھظ… طھط­ط¯ظٹط¯ ط§ظ„ظ…ظˆط¸ظپط©.");
      return;
    }
    const date = normalizeLeaveUntil(attendanceEditDate);
    const existingRow = employeeAttendanceRows.find((item) => item.date === date) || null;
    const allowed = existingRow ? canUpdateAttendance : canCreateAttendance;
    if (!allowed) {
      setErrorMsg(
        existingRow
          ? "ظ„ظٹط³طھ ظ„ط¯ظٹظƒ طµظ„ط§ط­ظٹط© ظ„طھط¹ط¯ظٹظ„ ط¨طµظ…ط© ط§ظ„ظ…ظˆط¸ظپط©."
          : "ظ„ظٹط³طھ ظ„ط¯ظٹظƒ طµظ„ط§ط­ظٹط© ظ„ط¥ط¶ط§ظپط© ط¨طµظ…ط© ط¥ط¯ط§ط±ظٹط©."
      );
      return;
    }
    const checkInIso = dateTimeLocalToIso(attendanceEditCheckIn);
    const checkOutIso = dateTimeLocalToIso(attendanceEditCheckOut);
    if (!date || !checkInIso) {
      setErrorMsg("ط§ط®طھط± ط§ظ„ظٹظˆظ… ظˆظˆظ‚طھ ط§ظ„ط­ط¶ظˆط± ظ‚ط¨ظ„ ط­ظپط¸ طھط¹ط¯ظٹظ„ ط§ظ„ط¨طµظ…ط©.");
      return;
    }
    if (checkOutIso && Date.parse(checkOutIso) <= Date.parse(checkInIso)) {
      setErrorMsg("ظˆظ‚طھ ط§ظ„ط§ظ†طµط±ط§ظپ ظٹط¬ط¨ ط£ظ† ظٹظƒظˆظ† ط¨ط¹ط¯ ظˆظ‚طھ ط§ظ„ط­ط¶ظˆط±.");
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

      const attendanceIdentity = resolveEmployeeAttendanceIdentity(null, selectedEmployeeId);

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
        description: "طھط¹ط¯ظٹظ„ ط¨طµظ…ط© ط­ط¶ظˆط± ط§ظ„ظ…ظˆط¸ظپط© ظ…ظ† ط§ظ„ط¥ط¯ط§ط±ط©",
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
      setErrorMsg(toFirestoreErrorMessage(error, "طھط¹ط°ط± ط­ظپط¸ طھط¹ط¯ظٹظ„ ط§ظ„ط¨طµظ…ط©."));
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
      setErrorMsg("ظ„ظٹط³طھ ظ„ط¯ظٹظƒ طµظ„ط§ط­ظٹط© ظ„ظ…ط³ط­ ط¨طµظ…ط© ط§ظ„ظ…ظˆط¸ظپط©.");
      return;
    }
    const date = normalizeLeaveUntil(dateKey);
    if (!date) return;
    const ok = confirm(`ط³ظٹطھظ… ظ…ط³ط­ ط³ط¬ظ„ ط§ظ„ط¨طµظ…ط© ظ„ظٹظˆظ… ${date}. ظ‡ظ„ طھط±ظٹط¯ ط§ظ„ظ…طھط§ط¨ط¹ط©طں`);
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

      const attendanceIdentity = resolveEmployeeAttendanceIdentity(null, selectedEmployeeId);

      const clearResult = await clearAttendanceDayFromWorker({
        employeeUid: attendanceIdentity.employeeUid,
        employeeId: attendanceIdentity.employeeDocId,
        date,
        note: "ظ…ط³ط­ ط¨طµظ…ط© ط§ظ„ظٹظˆظ… ظ…ظ† ط¥ط¯ط§ط±ط© ط§ظ„ظ…ظˆط¸ظپط§طھ",
      });

      const clearedRecords = Number(clearResult?.clearedRecords || 0);
      if (clearedRecords <= 0) {
        throw new Error(
          "ظ„ظ… ظٹطھظ… ط§ظ„ط¹ط«ظˆط± ط¹ظ„ظ‰ ط¨طµظ…ط§طھ ظ„ظ‡ط°ط§ ط§ظ„ظٹظˆظ…طŒ ظ„ط°ظ„ظƒ ظ„ظ… ظٹطھظ… ط­ط°ظپ ط£ظٹ ط³ط¬ظ„."
        );
      }

      await writeAuditLog({
        action: "attendance_deleted",
        entityType: "attendance",
        entityId: `${selectedEmployeeId}/${date}`,
        source: "dashboard",
        description: "ظ…ط³ط­ ط¨طµظ…ط© ط­ط¶ظˆط± ط§ظ„ظ…ظˆط¸ظپط© ظ…ظ† ط§ظ„ط¥ط¯ط§ط±ط©",
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
      setErrorMsg(toFirestoreErrorMessage(error, "طھط¹ط°ط± ظ…ط³ط­ ط§ظ„ط¨طµظ…ط©."));
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
      setErrorMsg("ظ„ظ… ظٹطھظ… طھط­ط¯ظٹط¯ ط§ظ„ظ…ظˆط¸ظپط©.");
      return;
    }
    if (!authUser?.uid) {
      setErrorMsg("طھط¹ط°ط± طھط­ط¯ظٹط¯ ط§ظ„ظ…ط³طھط®ط¯ظ… ط§ظ„ظ…ظ†ظپط° ظ„ظ„ط¹ظ…ظ„ظٹط©.");
      return;
    }
    if (!ensureCanManageLeaveBalance()) return;

    const date = normalizeLeaveUntil(dateKey);
    if (!date) {
      setErrorMsg("ط§ط®طھط± ظٹظˆظ…ظ‹ط§ طµط­ظٹط­ظ‹ط§ ظ„طھط³ط¬ظٹظ„ ط§ظ„ط¥ط¬ط§ط²ط©.");
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
      setErrorMsg("طھط¹ط°ط± طھط­ط¯ظٹط¯ ط­ط³ط§ط¨ ط§ظ„ظ…ظˆط¸ظپط© ظ„طھط³ط¬ظٹظ„ ط§ظ„ط¥ط¬ط§ط²ط©.");
      return;
    }

    const approvedLeaveDateKeys = buildApprovedLeaveDateKeys({
      profile: employeeProfile,
      leaveRequests: selectedEmployeeLeaveRequests,
      extraIds: attendanceIdentity.allIds,
      todayDateKey: todayIso(),
    });
    if (approvedLeaveDateKeys.includes(date)) {
      setErrorMsg("ظ‡ط°ط§ ط§ظ„ظٹظˆظ… ظ…ط³ط¬ظ„ ظƒط¥ط¬ط§ط²ط© ظ…ط¹طھظ…ط¯ط© ط¨ط§ظ„ظپط¹ظ„.");
      return;
    }

    const hasAttendanceRecord = employeeAttendanceRows.some(
      (row) =>
        row.date === date &&
        Boolean(row.checkInAtClient || row.checkOutAtClient)
    );
    if (hasAttendanceRecord) {
      setErrorMsg("ظ„ط§ ظٹظ…ظƒظ† طھط­ظˆظٹظ„ ظٹظˆظ… ط¹ظ„ظٹظ‡ ط¨طµظ…ط© ط¥ظ„ظ‰ ط¥ط¬ط§ط²ط© ظ…ظپط§ط¬ط¦ط© ظ…ظ† ظ‡ط°ط§ ط§ظ„ط¥ط¬ط±ط§ط،.");
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
      setErrorMsg("ظ„ظ… ظٹطھظ… طھط­ط¯ظٹط¯ ط§ظ„ظ…ظˆط¸ظپط©.");
      return;
    }
    if (!authUser?.uid) {
      setErrorMsg("طھط¹ط°ط± طھط­ط¯ظٹط¯ ط§ظ„ظ…ط³طھط®ط¯ظ… ط§ظ„ظ…ظ†ظپط° ظ„ظ„ط¹ظ…ظ„ظٹط©.");
      return;
    }
    if (!ensureCanManageLeaveBalance()) return;

    const date = normalizeLeaveUntil(dateKey);
    if (!date) {
      setErrorMsg("ط§ط®طھط± ظٹظˆظ…ظ‹ط§ طµط­ظٹط­ظ‹ط§ ظ„ط¥ظ„ط؛ط§ط، ط§ظ„ط¥ط¬ط§ط²ط©.");
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
        setErrorMsg("ظ„ظ… ظٹطھظ… ط§ظ„ط¹ط«ظˆط± ط¹ظ„ظ‰ ط¥ط¬ط§ط²ط© ط£ظˆ ط§ط³طھط¦ط°ط§ظ† ظ…ط¹طھظ…ط¯ ظ„ظ‡ط°ط§ ط§ظ„ظٹظˆظ….");
        return;
      }

      const ok = confirm("ط³ظٹطھظ… ط¥ظ„ط؛ط§ط، ط§ظ„ط§ط³طھط¦ط°ط§ظ† ط§ظ„ظ…ط¹طھظ…ط¯ ظ„ظٹظˆظ… " + date + ". ظ‡ظ„ طھط±ظٹط¯ ط§ظ„ظ…طھط§ط¨ط¹ط©طں");
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
          description: "ط¥ظ„ط؛ط§ط، ط§ط³طھط¦ط°ط§ظ† ظ…ط¹طھظ…ط¯ ظ…ظ† ط³ط¬ظ„ ط§ظ„ط­ط¶ظˆط±",
          before: { date, status: "approved", coreLeaveId: permissionLeave.id },
          after: { date, status: "cancelled" },
          meta: { staffId: selectedEmployeeId },
        });
        await Promise.all([load(), loadSelectedEmployeeAttendance({ force: true })]);
      } catch (error) {
        setErrorMsg(toFirestoreErrorMessage(error, "طھط¹ط°ط± ط¥ظ„ط؛ط§ط، ط§ظ„ط§ط³طھط¦ط°ط§ظ†."));
      } finally {
        setSaving(false);
      }
      return;
    }

    const ok = confirm(`ط³ظٹطھظ… ط¥ظ„ط؛ط§ط، ط§ظ„ط¥ط¬ط§ط²ط© ط§ظ„ظ…ط¹طھظ…ط¯ط© ظ„ظٹظˆظ… ${date}. ظ‡ظ„ طھط±ظٹط¯ ط§ظ„ظ…طھط§ط¨ط¹ط©طں`);
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
        description: "ط¥ظ„ط؛ط§ط، ط¥ط¬ط§ط²ط© ظ…ط¹طھظ…ط¯ط© ظ…ظ† ط³ط¬ظ„ ط§ظ„ط­ط¶ظˆط±",
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
      setErrorMsg(toFirestoreErrorMessage(error, "طھط¹ط°ط± ط¥ظ„ط؛ط§ط، ط§ظ„ط¥ط¬ط§ط²ط©."));
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
      setErrorMsg("ظ„ظ… ظٹطھظ… طھط­ط¯ظٹط¯ ط§ظ„ظ…ظˆط¸ظپط©.");
      return;
    }
    if (!authUser?.uid) {
      setErrorMsg("طھط¹ط°ط± طھط­ط¯ظٹط¯ ط§ظ„ظ…ط³طھط®ط¯ظ… ط§ظ„ظ…ظ†ظپط° ظ„ظ„ط¹ظ…ظ„ظٹط©.");
      return;
    }
    if (!ensureCanManageLeaveBalance()) return;

    const employeeProfile =
      list.find((item) => item.id === selectedEmployeeId) ||
      list.find((item) => employeeMatchesIdentity(item, selectedEmployeeIdentityRef.current)) ||
      { id: selectedEmployeeId, name: leaveModalEmployeeName };
    const attendanceIdentity = resolveEmployeeAttendanceIdentity(employeeProfile, selectedEmployeeId);
    const employeeUidLocal = attendanceIdentity.employeeUid;
    const employeeIdLocal = attendanceIdentity.employeeDocId || selectedEmployeeId;
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
      throw new Error("ظ…ط¯ظ‰ ط§ظ„ط¥ط¬ط§ط²ط© ط؛ظٹط± طµط­ظٹط­.");
    }
    if (isPartialLeave) {
      if (fromDate !== toDate) throw new Error("ط§ظ„ط§ط³طھط¦ط°ط§ظ† ظٹط¬ط¨ ط£ظ† ظٹظƒظˆظ† ظپظٹ ظٹظˆظ… ظˆط§ط­ط¯.");
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(partialStartTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(partialEndTime)) {
        throw new Error("ظˆظ‚طھ ط§ظ„ط§ط³طھط¦ط°ط§ظ† ط؛ظٹط± طµط­ظٹط­.");
      }
      if (partialStartTime >= partialEndTime) throw new Error("ظˆظ‚طھ ظ†ظ‡ط§ظٹط© ط§ظ„ط§ط³طھط¦ط°ط§ظ† ظٹط¬ط¨ ط£ظ† ظٹظƒظˆظ† ط¨ط¹ط¯ ط§ظ„ط¨ط¯ط§ظٹط©.");

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
          reason: cleanText(payload.note) || "ط§ط³طھط¦ط°ط§ظ† ط¥ط¯ط§ط±ظٹ",
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
          description: "طھط³ط¬ظٹظ„ ط§ط³طھط¦ط°ط§ظ† ظ…ط¹طھظ…ط¯ ظˆط±ط¨ط·ظ‡ ط¨ط§ظ„ط­ط¶ظˆط± ظˆط§ظ„ط­ط¬ط²",
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
        setErrorMsg(toFirestoreErrorMessage(error, "طھط¹ط°ط± طھط³ط¬ظٹظ„ ط§ظ„ط§ط³طھط¦ط°ط§ظ† ظˆط±ط¨ط·ظ‡ ط¨ط§ظ„ط­ط¶ظˆط± ظˆط§ظ„ط­ط¬ط²."));
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
          note: payload.note || (isPartialLeave ? "طھط³ط¬ظٹظ„ ط§ط³طھط¦ط°ط§ظ† ظ…ط¹طھظ…ط¯ ظ…ظ† ط¥ط¯ط§ط±ط© ط§ظ„ظ…ظˆط¸ظپط§طھ" : "طھط³ط¬ظٹظ„ ط¥ط¬ط§ط²ط© ظ…ط¹طھظ…ط¯ط© ظ…ظ† ط¥ط¯ط§ط±ط© ط§ظ„ظ…ظˆط¸ظپط§طھ"),
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
        description: "طھط³ط¬ظٹظ„ ط¥ط¬ط§ط²ط© ظ…ط¹طھظ…ط¯ط© ظˆط±ط¨ط·ظ‡ط§ ط¨ط§ظ„ط­ط¶ظˆط± ظˆط§ظ„ط±ط§طھط¨",
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
      setErrorMsg(toFirestoreErrorMessage(error, "طھط¹ط°ط± طھط³ط¬ظٹظ„ ط§ظ„ط¥ط¬ط§ط²ط© ظˆط±ط¨ط·ظ‡ط§ ط¨ط§ظ„ط­ط¶ظˆط± ظˆط§ظ„ط±ط§طھط¨."));
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
      setErrorMsg("ظ„ظ… ظٹطھظ… طھط­ط¯ظٹط¯ ط§ظ„ظ…ظˆط¸ظپط©.");
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
      setErrorMsg("طھط¹ط°ط± طھط­ط¯ظٹط¯ ط§ظ„ظ…ظˆط¸ظپط© ط£ظˆ ط§ظ„ظ…ط³طھط®ط¯ظ… ط§ظ„ظ…ظ†ظپط°.");
      return;
    }
    if (!ensureCanManageLeaveBalance()) return;
    const employee =
      list.find((item) => item.id === selectedEmployeeId) ||
      { id: selectedEmployeeId, name };
    if (!employee) {
      setErrorMsg("طھط¹ط°ط± ط§ظ„ط¹ط«ظˆط± ط¹ظ„ظ‰ ظ…ظ„ظپ ط§ظ„ظ…ظˆط¸ظپط©.");
      return;
    }
    const ok = confirm("ط³ظٹطھظ… ط¥ظ†ظ‡ط§ط، ط§ظ„ط¥ط¬ط§ط²ط© ط§ظ„ط­ط§ظ„ظٹط© ظˆط¥ظ„ط؛ط§ط، ط£ط«ط±ظ‡ط§ ط§ظ„ظ…ط³طھظ‚ط¨ظ„ظٹ. ظ‡ظ„ طھط±ظٹط¯ ط§ظ„ظ…طھط§ط¨ط¹ط©طں");
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
      setErrorMsg(toFirestoreErrorMessage(error, "طھط¹ط°ط± ط¥ظ†ظ‡ط§ط، ط§ظ„ط¥ط¬ط§ط²ط© ط§ظ„ط­ط§ظ„ظٹط©."));
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

    // âœ… ط¬ط¯ظٹط¯
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
    const currentScheduleSnapshot = resolveDateEffectiveScheduleSnapshot(x as any, todayIso());
    const initialUseCustomWorkingHours = currentScheduleSnapshot.snapshot
      ? currentScheduleSnapshot.snapshot.useCustomWorkingHours
      : !!(x as any).useCustomWorkingHours;
    const initialCustomWorkingHours = normalizeWorkingHours(
      currentScheduleSnapshot.snapshot?.customWorkingHours || (x as any).customWorkingHours
    );
    const initialWeeklyOffDays = initialUseCustomWorkingHours
      ? WEEKDAY_OPTIONS.filter(
          (day) => initialCustomWorkingHours[day.key]?.enabled === false
        ).map((day) => day.key)
      : currentScheduleSnapshot.hasHistoricalVersion
        ? normalizeExceptionalLeaveWeekdays(currentScheduleSnapshot.weeklyOffDays)
        : resolveStaffWeeklyOffDays(x);
    const alignedInitialWorkingHours = initialUseCustomWorkingHours
      ? initialCustomWorkingHours
      : WEEKDAY_OPTIONS.reduce((next, day) => {
          next[day.key] = {
            ...initialCustomWorkingHours[day.key],
            enabled: !initialWeeklyOffDays.includes(day.key),
          };
          return next;
        }, { ...initialCustomWorkingHours });
    setModalExceptionalLeaveWeekdays(initialWeeklyOffDays);
    setModalUseCustomWorkingHours(initialUseCustomWorkingHours);
    setModalCustomWorkingHours(alignedInitialWorkingHours);
    setModalCustomHourOverrides(
      normalizeWorkingHourOverrides((x as any).customWorkingHourOverrides)
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

    // âœ… ط¬ط¯ظٹط¯
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
    if (closingEmployeeDetailRef.current || !routeEmployeeId || !list.length) return;
    const matched = list.find((item) => employeeMatchesRouteId(item, routeEmployeeId));
    if (!matched) {
      if (!loading) {
        setErrorMsg("طھط¹ط°ط± ط§ظ„ط¹ط«ظˆط± ط¹ظ„ظ‰ ظ…ظ„ظپ ط§ظ„ظ…ظˆط¸ظپط© ط§ظ„ظ…ط·ظ„ظˆط¨. طھظ… ط§ظ„ط±ط¬ظˆط¹ ط¥ظ„ظ‰ ظ‚ط§ط¦ظ…ط© ط§ظ„ظ…ظˆط¸ظپظٹظ†.");
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
      setErrorMsg(toFirestoreErrorMessage(e, "طھط¹ط°ط± طھط­ظ…ظٹظ„ ط§ظ„ط®ط¯ظ…ط§طھ."));
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

          // ط­ط³ط§ط¨ ط§ظ„ط¯ط®ظˆظ„ ظ„ط§ ظٹطھط­ظˆظ„ طھظ„ظ‚ط§ط¦ظٹظ‹ط§ ط¥ظ„ظ‰ ظ…ظˆط¸ظپط©. طھظپط¶ظٹظ„ users ظ‡ظˆ ظ…طµط¯ط± ط§ظ„ط­ظ‚ظٹظ‚ط©طŒ
          // ط«ظ… ظ†ط±ط¬ط¹ ظ„ط¹ظ„ط§ظ…ط© ط§ظ„ط³ط¬ظ„طŒ ظˆط¨ط¹ط¯ظ‡ط§ ظپظ‚ط· ظ†ط­ط§ظپط¸ ط¹ظ„ظ‰ ط§ظ„ظ…ظˆط¸ظپط§طھ ط§ظ„طھط´ط؛ظٹظ„ظٹط§طھ ط§ظ„ظ‚ط¯ظٹظ…ط©.
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
            exceptionalLeaveWeekdays: resolveStaffWeeklyOffDays(combined),
            useCustomWorkingHours: !!combined?.useCustomWorkingHours,
            customWorkingHours: normalizeWorkingHours(combined?.customWorkingHours),
            workingScheduleVersions: normalizeStaffScheduleVersions(combined?.workingScheduleVersions),
            customWorkingHourOverrides: normalizeWorkingHourOverrides(combined?.customWorkingHourOverrides),
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
            setSelectedEmployeeId(matched.id);
            setEditId((current) => (current ? matched.id : current));
            selectedEmployeeIdentityRef.current = employeeIdentityOf(matched);
          }
        }

        setList(rows);
        return rows;
      } catch (e) {
        setErrorMsg(toFirestoreErrorMessage(e, "طھط¹ط°ط± طھط­ظ…ظٹظ„ ط§ظ„ظ…ظˆط¸ظپط§طھ."));
        if (loadOptions.strict) throw e;
        // ظ„ط§ ظ†ظ…ط³ط­ ط§ظ„ظ‚ط§ط¦ظ…ط© ط§ظ„ط­ط§ظ„ظٹط© ط¹ظ†ط¯ ظپط´ظ„ ط§ظ„طھط­ط¯ظٹط« ط­طھظ‰ ظ„ط§ طھظڈط؛ظ„ظ‚ ط§ظ„ظ…ظˆط¸ظپط© ط§ظ„ظ…ط­ط¯ط¯ط©.
        return [];
      } finally {
        setLoading(false);
      }
    },
    [resolveAttendanceZoneId, resolveStaffWeeklyOffDays]
  );

  // âœ… Original logic for fixing bookings
  const fixBookingsEmployeeUid = async () => {
    if (!canFixBookings) {
      setErrorMsg("ظ„ظٹط³طھ ظ„ط¯ظٹظƒ طµظ„ط§ط­ظٹط© ظ„ط¥طµظ„ط§ط­ ط§ظ„ط­ط¬ظˆط²ط§طھ.");
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
      setRepairMessage("طھظ… ط¥طµظ„ط§ط­ ط±ط¨ط· ط§ظ„ط­ط¬ظˆط²ط§طھ ط§ظ„ظ‚ط¯ظٹظ…ط© ط¨ظ†ط¬ط§ط­.");
    } catch (e) {
      setErrorMsg(toFirestoreErrorMessage(e, "طھط¹ط°ط± ط¥ظƒظ…ط§ظ„ ط¥طµظ„ط§ط­ ط§ظ„ط­ط¬ظˆط²ط§طھ."));
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
      setErrorMsg("ظ„ظٹط³طھ ظ„ط¯ظٹظƒ طµظ„ط§ط­ظٹط© ظ„ط¥ط¯ط§ط±ط© ط§ظ„ط±ظˆط§طھط¨.");
      return;
    }
    const targetEmployeeId = cleanText(selectedEmployeeId || editId || routeEmployeeId);
    const currentEmployee = editingStaff || selectedEmployee;
    if (!targetEmployeeId || !currentEmployee) {
      setErrorMsg("ظ„ظ… ظٹطھظ… طھط­ط¯ظٹط¯ ط§ظ„ظ…ظˆط¸ظپط©.");
      return;
    }
    const cleanName = cleanText(name || currentEmployee.name || targetEmployeeId);
    if (!cleanName) {
      setErrorMsg("ط§ظƒطھط¨ ط§ط³ظ… ط§ظ„ظ…ظˆط¸ظپط© ظ‚ط¨ظ„ ط­ظپط¸ ط¥ط¹ط¯ط§ط¯ط§طھ ط§ظ„ط±ط§طھط¨.");
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
      setPayrollSettingsMessage("طھظ… ط­ظپط¸ ط¥ط¹ط¯ط§ط¯ط§طھ ط§ظ„ط±ط§طھط¨ ظˆط§ظ„ط¯ظˆط§ظ… ظپظٹ ظ…طµط¯ط± ظ…ط³ظٹط±ط§طھ ط§ظ„ط±ظˆط§طھط¨.");
    } catch (error) {
      setErrorMsg(toFirestoreErrorMessage(error, "طھط¹ط°ط± ط­ظپط¸ ط¥ط¹ط¯ط§ط¯ط§طھ ط§ظ„ط±ط§طھط¨."));
    } finally {
      setPayrollSettingsSaving(false);
    }
  };

  const save = async () => {
    if (!ensureCanManage()) return;
    const cleanName = name.trim();
    const specialtiesFixed = canonicalizeSpecialties(specialties, serviceOptions);
    const effectiveShowOnBooking = specialtiesFixed.length > 0 ? !!showOnBooking : false;
    if (!cleanName) {
      setErrorMsg("ط§ظƒطھط¨ ط§ط³ظ… ط§ظ„ظ…ظˆط¸ظپط©");
      return;
    }
    // Allow saving basic data even when no services are assigned.
    // In that case, force-hide from booking until services are added.
    if (specialtiesFixed.length === 0 && showOnBooking) {
      setShowOnBooking(false);
    }
    // âœ… ظ…ظ†ط¹ "ط§ظ„ظ†ط³ظٹط§ظ†": ظ…ظˆط¸ظپط© ظ†ط´ط·ط© ظ„ظƒظ† ظ…ط®ظپظٹط© ظ…ظ† ط§ظ„ط­ط¬ط²
    if (active && specialtiesFixed.length > 0 && !effectiveShowOnBooking) {
      const ok = confirm(
        "âڑ ï¸ڈ طھظ†ط¨ظٹظ‡: ط§ظ„ظ…ظˆط¸ظپط© ظ„ط¯ظٹظ‡ط§ ط®ط¯ظ…ط§طھ ظ„ظƒظ†ظ‡ط§ ظ…ط®ظپظٹط© ظ…ظ† ط§ظ„ط­ط¬ط².\nظ‡ظ„ طھط±ظٹط¯ ط§ظ„ط­ظپط¸ ط¨ظ‡ط°ط§ ط§ظ„ط´ظƒظ„طں"
      );
      if (!ok) return;
    }

    // ط§ط­ظپط¸ ظپظ‚ط· ط§ظ„ط§ط³طھط«ظ†ط§ط،ط§طھ ط§ظ„طھظٹ طھظ… ط¥ط¶ط§ظپطھظ‡ط§ ظپط¹ظ„ظٹط§ظ‹ ظپظٹ ط§ظ„ظ‚ط§ط¦ظ…ط©.
    // ظ„ط§ ظ†ط·ط¨ظ‚ ط§ظ„ظ…ط³ظˆط¯ط© طھظ„ظ‚ط§ط¦ظٹط§ظ‹ ط¹ظ†ط¯ ط§ظ„ط­ظپط¸ ط­طھظ‰ ظ„ط§ طھط¹ظٹط¯ ط§ظ„ظ‚ظٹظ… ط§ظ„ظ‚ط¯ظٹظ…ط©.
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
      setErrorMsg(`ط§ط®طھط§ط±ظٹ ط´ظپطھظ‹ط§ ظ„ط£ظٹط§ظ… ط§ظ„ط¹ظ…ظ„ ط§ظ„طھط§ظ„ظٹط©: ${missingShiftDays.map((day) => day.label).join("طŒ ")}`);
      return;
    }
    const scheduleEffectiveFrom = normalizeScheduleDateKey(modalScheduleEffectiveFrom);
    const previousEffectiveSchedule = resolveDateEffectiveScheduleSnapshot(
      editingStaff as any,
      scheduleEffectiveFrom || todayIso()
    );
    const previousScheduleSnapshot = previousEffectiveSchedule.snapshot || {
      useCustomWorkingHours: !!(editingStaff as any)?.useCustomWorkingHours,
      customWorkingHours: normalizeWorkingHours((editingStaff as any)?.customWorkingHours),
    };
    const nextScheduleSnapshot = {
      useCustomWorkingHours: !!modalUseCustomWorkingHours,
      customWorkingHours: normalizedCustomWorkingHours,
    };
    const scheduleChanged =
      shouldValidateSchedule &&
      (!editId || !scheduleSnapshotsEqual(previousScheduleSnapshot, nextScheduleSnapshot));
    let scheduleChangeReason = cleanText(modalScheduleChangeReason);
    if (scheduleChanged && !scheduleEffectiveFrom) {
      setErrorMsg("ط­ط¯ط¯ظٹ طھط§ط±ظٹط® ط¨ط¯ط، طھط·ط¨ظٹظ‚ ط¬ط¯ظˆظ„ ط§ظ„ط¯ظˆط§ظ… ط§ظ„ط¬ط¯ظٹط¯.");
      return;
    }
    if (editId && scheduleChanged && !scheduleChangeReason) {
      const changedClosedDays = WEEKDAY_OPTIONS.filter((day) => {
        const previousEnabled = previousScheduleSnapshot.customWorkingHours[day.key]?.enabled !== false;
        const nextEnabled = nextScheduleSnapshot.customWorkingHours[day.key]?.enabled !== false;
        return previousEnabled !== nextEnabled;
      }).map((day) => day.label);

      scheduleChangeReason = changedClosedDays.length
        ? `طھط¹ط¯ظٹظ„ ط§ظ„ط¥ط¬ط§ط²ط© ط§ظ„ط£ط³ط¨ظˆط¹ظٹط©: ${changedClosedDays.join("طŒ ")}`
        : "طھط­ط¯ظٹط« ط¬ط¯ظˆظ„ ط¯ظˆط§ظ… ط§ظ„ظ…ظˆط¸ظپط©";

      setModalScheduleChangeReason(scheduleChangeReason);
    }
    let workingScheduleVersions = normalizeStaffScheduleVersions((editingStaff as any)?.workingScheduleVersions);
    if (scheduleChanged) {
      workingScheduleVersions = appendDateEffectiveScheduleVersion({
        versions: workingScheduleVersions,
        effectiveFrom: scheduleEffectiveFrom,
        next: nextScheduleSnapshot,
        previous: editId ? previousScheduleSnapshot : null,
        changeReason: scheduleChangeReason || "ط¥ظ†ط´ط§ط، ط¬ط¯ظˆظ„ ط§ظ„ظ…ظˆط¸ظپط©",
        createdByUid: cleanText(authUser?.uid),
      });
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
    const normalizedExceptionalWeekdays = modalUseCustomWorkingHours
      ? WEEKDAY_OPTIONS.filter(
          (day) => normalizedCustomWorkingHours[day.key]?.enabled === false
        ).map((day) => day.key)
      : normalizeExceptionalLeaveWeekdays(modalExceptionalLeaveWeekdays);
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
      exceptionalLeaveWeekdays: normalizedExceptionalWeekdays,
      useCustomWorkingHours: !!modalUseCustomWorkingHours,
      customWorkingHours: normalizedCustomWorkingHours,
      workingScheduleVersions,
      customWorkingHourOverrides: normalizedCustomHourOverrides,
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

      const weekdayNumbers: Record<WeekdayKey, number> = {
        sun: 0,
        mon: 1,
        tue: 2,
        wed: 3,
        thu: 4,
        fri: 5,
        sat: 6,
      };
      let coreSyncWarning = "";
      try {
        await CoreHrService.saveEmployee({
          id: targetEmployeeId,
          name: cleanName,
          firebaseUid: cleanText(payload.linkedUid || payload.uid || payload.linkedUserId),
          email: cleanText(payload.email),
          phone: cleanText(payload.phone),
          status: active ? "active" : "inactive",
          employment: {
            employmentStatus: active ? "active" : "inactive",
            weeklyOffDays: normalizedExceptionalWeekdays,
            allowedZoneIds: normalizedAttendanceZoneId ? [normalizedAttendanceZoneId] : [],
          },
        });
        await CoreStaffService.update(targetEmployeeId, {
          name: cleanName,
          firebaseUid: cleanText(payload.linkedUid || payload.uid || payload.linkedUserId),
          phone: cleanText(payload.phone),
          active: !!active,
          employmentStatus: active ? "active" : "inactive",
          showOnBooking: !!active && effectiveShowOnBooking,
          specialties: specialtiesFixed,
          avatarUrl: avatarUrl.trim(),
          leaveStartDate: effectiveModalOnLeave ? normalizedModalLeaveFrom : "",
          leaveEndDate: effectiveModalOnLeave ? normalizedModalLeaveUntil : "",
          leaveNote: effectiveModalOnLeave ? String(modalLeaveNote || "").trim() : "",
        }).catch((staffSyncError) => {
          console.warn("Core staff booking sync failed after employee save:", staffSyncError);
        });
        if (scheduleChanged) {
          await CoreHrService.replaceSchedules(
            targetEmployeeId,
            WEEKDAY_OPTIONS.map((day) => {
              const scheduleDay = normalizedCustomWorkingHours[day.key] || { enabled: false };
              const enabled = scheduleDay.enabled !== false;
              return {
                id: `${targetEmployeeId}-${day.key}`,
                salonId: SALON_ID,
                employeeId: targetEmployeeId,
                weekday: weekdayNumbers[day.key],
                shiftTemplateId: enabled ? cleanText(scheduleDay.shiftTemplateId) : null,
                active: enabled,
                scheduleSource: enabled ? "shift_template" : "weekly_off",
                effectiveFrom: scheduleEffectiveFrom || todayIso(),
                effectiveTo: null,
              };
            })
          );
        }
      employeeSaveDebug("core sync success", {
        employeeId: targetEmployeeId,
        scheduleChanged,
      });

      } catch (coreSyncError) {
        coreSyncWarning = toFirestoreErrorMessage(coreSyncError, "طھط¹ط°ط±طھ ظ…ط²ط§ظ…ظ†ط© Core HR ط¨ط¹ط¯ ط­ظپط¸ Firestore.");
        employeeSaveDebug("core sync failed", {
          employeeId: targetEmployeeId,
          message: coreSyncWarning,
        });
        console.warn(
          "Core HR sync failed after employee Firestore save:",
          coreSyncError
        );
      }
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
            title: leaveChanged ? "طھظ… طھط­ط¯ظٹط« ط­ط§ظ„ط© ط§ظ„ط¥ط¬ط§ط²ط©" : "طھظ… طھط­ط¯ظٹط« ط­ط§ظ„ط© ط§ظ„ظ…ظˆط¸ظپط©",
            body: leaveChanged
              ? `${effectiveModalOnLeave ? "ظپظٹ ط¥ط¬ط§ط²ط©" : "ظ…طھط§ط­ط© ظ„ظ„ط¹ظ…ظ„"}${normalizedModalLeaveFrom ? ` ظ…ظ† ${normalizedModalLeaveFrom}` : ""}${normalizedModalLeaveUntil ? ` ط­طھظ‰ ${normalizedModalLeaveUntil}` : ""}${String(modalLeaveNote || "").trim() ? ` - ${String(modalLeaveNote || "").trim()}` : ""}`
              : `${!!active ? "ظ†ط´ط·ط©" : "ط؛ظٹط± ظ†ط´ط·ط©"}${normalizedEmploymentEndDate ? ` - ظٹظ†طھظ‡ظٹ ط§ظ„طھظˆط¸ظٹظپ ظپظٹ ${normalizedEmploymentEndDate}` : ""}`,
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
        throw new Error("طھط¹ط°ط± ظ‚ط±ط§ط،ط© ظ…ظ„ظپ ط§ظ„ظ…ظˆط¸ظپط© ظ…ظ† staff_public ط¨ط¹ط¯ ط§ظ„ط­ظپط¸.");
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
        throw new Error("طھط¹ط°ط± ط¥ط¹ط§ط¯ط© طھط­ظ…ظٹظ„ ط§ظ„ظ…ظˆط¸ظپط© ظ…ظ† ط§ظ„ط³ظٹط±ظپط± ط¨ط¹ط¯ ط§ظ„ط­ظپط¸.");
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
        coreSyncWarning
          ? `طھظ… ط­ظپط¸ ط§ظ„طھط؛ظٹظٹط±ط§طھ ط¨ظ†ط¬ط§ط­طŒ ظ„ظƒظ† طھط¹ط°ط±طھ ظ…ط²ط§ظ…ظ†ط© Core HR: ${coreSyncWarning}`
          : "طھظ… ط­ظپط¸ ط§ظ„طھط؛ظٹظٹط±ط§طھ ط¨ظ†ط¬ط§ط­"
      );
      employeeSaveDebug("completed", {
        employeeId: targetEmployeeId,
        coreSynced: !coreSyncWarning,
      });
    } catch (e) {
      console.error("save employee profile failed", {
        staffPublicPath: `salons/${SALON_ID}/staff_public/${targetEmployeeId}`,
        employeePath: `salons/${SALON_ID}/employees/${targetEmployeeId}`,
        editingSource: (editingStaff as any)?.source || null,
        linkedUid: cleanText(payload.linkedUid || payload.uid || payload.linkedUserId),
      }, e);
      setSaveMessage("");
      setErrorMsg(toFirestoreErrorMessage(e, "طھط¹ط°ط± ط­ظپط¸ ط§ظ„ظ…ظˆط¸ظپط©."));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!ensureCanDelete()) return;
    const target = list.find((row) => row.id === id);
    if (!confirm(`ظ‡ظ„ طھط±ظٹط¯ ط£ط±ط´ظپط© ط§ظ„ظ…ظˆط¸ظپط© "${target?.name || id}"طں\nط³طھط®طھظپظٹ ظ…ظ† ط§ظ„ط­ط¬ظˆط²ط§طھ ط§ظ„ط¬ط¯ظٹط¯ط© ظ…ط¹ ط¨ظ‚ط§ط، ط§ظ„ط­ط¬ظˆط²ط§طھ ط§ظ„طھط§ط±ظٹط®ظٹط©.`)) return;
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
      setErrorMsg(toFirestoreErrorMessage(e, "طھط¹ط°ط± ط­ط°ظپ ط§ظ„ظ…ظˆط¸ظپط©."));
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
      ? `ظپظٹ ط¥ط¬ط§ط²ط© ط­طھظ‰ ${fmtIsoDate(selectedEmployeeLeaveUntil)}`
      : "ظپظٹ ط¥ط¬ط§ط²ط©"
    : selectedEmployee?.active
      ? "ظ†ط´ط·ط©"
      : "ط؛ظٹط± ظ†ط´ط·ط©";
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
    let salonSourceLabel = "ط£ط³ط¨ظˆط¹ظٹ";
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
        salonSourceLabel = "ط§ط³طھط«ظ†ط§ط، ظپط¹ظ„ظٹ";
        activeSalonOverride = {
          sourceIndex: i,
          fromDate: ov.fromDate,
          toDate: ov.toDate,
          mode: "closed",
          windowLabel: "ط¥ط؛ظ„ط§ظ‚ ظƒط§ظ…ظ„ ط§ظ„ظٹظˆظ…",
          includeDays: includeDays as WeekdayKey[],
          blockedDays: blockedDays as WeekdayKey[],
        };
      } else {
        salonEnabled = true;
        const ovStart = normalizeTimeHHMM(ov.start) || salonOpen;
        const ovEnd = normalizeTimeHHMM(ov.end) || salonClose;
        salonOpen = ovStart;
        salonClose = ovEnd;
        salonSourceLabel = "ط§ط³طھط«ظ†ط§ط، ظپط¹ظ„ظٹ";
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
      : "ظ…ط؛ظ„ظ‚ ط£ط³ط¨ظˆط¹ظٹظ‹ط§";
    const salonEffectiveWindowLabel = salonEnabled
      ? formatWindow(salonOpen, salonClose)
      : "ظ…ط؛ظ„ظ‚ ظ„ظ„ط­ط¬ظˆط²ط§طھ ط§ظ„ظٹظˆظ…";

    const weekdayLabel = (key: WeekdayKey | "") =>
      WEEKDAY_OPTIONS.find((x) => x.key === key)?.label || "-";
    const formatWeekdaySet = (days: WeekdayKey[]) =>
      days.length ? days.map((d) => weekdayLabel(d)).join(" / ") : "-";
    const formatOverrideMeta = (ov: BookingHourOverride) => {
      const includeDays = Array.isArray(ov?.includeWeekdays) ? (ov.includeWeekdays as WeekdayKey[]) : [];
      const blockedDays = Array.isArray(ov?.blockedWeekdays) ? (ov.blockedWeekdays as WeekdayKey[]) : [];
      const includeLabel = includeDays.length ? formatWeekdaySet(includeDays) : "ظƒظ„ ط§ظ„ط£ظٹط§ظ…";
      const blockedLabel = blockedDays.length ? formatWeekdaySet(blockedDays) : "";
      const isClosed = String(ov?.mode || "").trim() === "closed";
      const start = normalizeTimeHHMM(ov?.start) || DEFAULT_OPEN_TIME;
      const end = normalizeTimeHHMM(ov?.end) || DEFAULT_CLOSE_TIME;
      const modeLabel = isClosed ? "ط¥ط؛ظ„ط§ظ‚ ظƒط§ظ…ظ„" : `ط³ط§ط¹ط§طھ ${formatWindow(start, end)}`;
      return `${modeLabel} | ط§ظ„ط£ظٹط§ظ… ط§ظ„ظ…ط³طھظ‡ط¯ظپط©: ${includeLabel}${
        blockedLabel ? ` | ط£ظٹط§ظ… ط§ظ„ط¥ط؛ظ„ط§ظ‚: ${blockedLabel}` : ""
      }`;
    };
    const allOverrideDetails = bookingHourOverrides.map((ov, idx) => ({
      sourceIndex: idx,
      rangeDual: formatIsoDateRangeDual(ov.fromDate, ov.toDate),
      meta: formatOverrideMeta(ov),
    }));
        const todayDateGregorian = fmtIsoDate(today);
        const todayDateHijri = fmtIsoDateHijri(today);
        const todayDateCombinedLabel = `${todayDateGregorian} â€” ${todayDateHijri}`;
        const todayDateLabel = `${todayDateGregorian} ظ… / ${todayDateHijri} ظ‡ظ€`;
    const salonWeeklyDetails = salonWeeklyEnabled
      ? "ط§ظ„ط¯ظˆط§ظ… ط§ظ„ط£ط³ط§ط³ظٹ ظ…ط£ط®ظˆط° ظ…ظ† ط§ظ„ط¬ط¯ظˆظ„ ط§ظ„ط£ط³ط¨ظˆط¹ظٹ."
      : "ط§ظ„ظٹظˆظ… ظ…ط؛ظ„ظ‚ ظپظٹ ط§ظ„ط¬ط¯ظˆظ„ ط§ظ„ط£ط³ط¨ظˆط¹ظٹ.";
    const salonEffectiveBaseDetails = activeSalonOverride
      ? activeSalonOverride.mode === "closed"
        ? "طھظ… ط¥ط؛ظ„ط§ظ‚ ط§ظ„طµط§ظ„ظˆظ† ط§ظ„ظٹظˆظ… ط¹ط¨ط± ط§ظ„ط§ط³طھط«ظ†ط§ط، ط§ظ„ظپط¹ظ„ظٹ."
        : `طھظ… طھط¹ط¯ظٹظ„ ط³ط§ط¹ط§طھ ط§ظ„طµط§ظ„ظˆظ† ط§ظ„ظٹظˆظ… ط¹ط¨ط± ط§ظ„ط§ط³طھط«ظ†ط§ط، ط§ظ„ظپط¹ظ„ظٹ (${activeSalonOverride.windowLabel}).`
      : "ظ„ط§ ظٹظˆط¬ط¯ ط§ط³طھط«ظ†ط§ط، ظپط¹ظ„ظٹ ط§ظ„ظٹظˆظ… ط¹ظ„ظ‰ ط§ظ„طµط§ظ„ظˆظ†.";
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
          activeDetails.push("ظ†ظˆط¹ ط§ظ„ط§ط³طھط«ظ†ط§ط،: ط¥ط؛ظ„ط§ظ‚ ظƒط§ظ…ظ„ ظ„ظ„ط­ط¬ظˆط²ط§طھ ط§ظ„ظٹظˆظ….");
        } else {
          activeDetails.push(`ظˆظ‚طھ ط§ظ„ط§ط³طھط«ظ†ط§ط، ط§ظ„ظپط¹ظ„ظٹ: ${activeSalonOverride.windowLabel}`);
        }
        if (activeSalonOverride.includeDays.length > 0) {
          activeDetails.push(`ط§ظ„ط£ظٹط§ظ… ط§ظ„ظ…ط³طھظ‡ط¯ظپط©: ${formatWeekdaySet(activeSalonOverride.includeDays)}`);
        }
        if (activeSalonOverride.blockedDays.length > 0) {
          activeDetails.push(`ط£ظٹط§ظ… ط§ظ„ط¥ط؛ظ„ط§ظ‚ ط¯ط§ط®ظ„ ط§ظ„ظ†ط·ط§ظ‚: ${formatWeekdaySet(activeSalonOverride.blockedDays)}`);
        }
        groups.push(
          buildGroup(
            "ط§ظ„ط§ط³طھط«ظ†ط§ط، ط§ظ„ظپط¹ظ„ظٹ",
            activeDual.gregorian,
            activeDual.hijri,
            activeDetails,
            "active"
          )
        );

        const others = allOverrideDetails.filter((x) => x.sourceIndex !== activeSalonOverride.sourceIndex);
        if (others.length) {
          notes.push(`ط§ط³طھط«ظ†ط§ط،ط§طھ ط£ط®ط±ظ‰ ظ…ط³ط¬ظ„ط© (${others.length}):`);
          others.forEach((x, idx) => {
            groups.push(
              buildGroup(
                `ط§ظ„ط§ط³طھط«ظ†ط§ط، ${idx + 1}`,
                x.rangeDual.gregorian,
                x.rangeDual.hijri,
                [`طھظپط§طµظٹظ„ ط§ظ„ط§ط³طھط«ظ†ط§ط، ${idx + 1}: ${x.meta}`],
                "other"
              )
            );
          });
        }
      } else if (allOverrideDetails.length) {
        notes.push("ظ„ط§ ظٹظˆط¬ط¯ ط§ط³طھط«ظ†ط§ط، ظپط¹ظ„ظٹ ط§ظ„ظٹظˆظ….");
        notes.push(`ط§ظ„ط§ط³طھط«ظ†ط§ط،ط§طھ ط§ظ„ظ…ط³ط¬ظ„ط© (${allOverrideDetails.length}):`);
        allOverrideDetails.forEach((x, idx) => {
          groups.push(
            buildGroup(
              `ط§ظ„ط§ط³طھط«ظ†ط§ط، ${idx + 1}`,
              x.rangeDual.gregorian,
              x.rangeDual.hijri,
              [`طھظپط§طµظٹظ„ ط§ظ„ط§ط³طھط«ظ†ط§ط، ${idx + 1}: ${x.meta}`],
              "other"
            )
          );
        });
      } else {
        notes.push("ظ„ط§ طھظˆط¬ط¯ ط§ط³طھط«ظ†ط§ط،ط§طھ ظ…ط³ط¬ظ„ط© ط¹ظ„ظ‰ ط¯ظˆط§ظ… ط§ظ„طµط§ظ„ظˆظ†.");
      }
      return { notes, groups };
    })();

    return list
      .map((staff) => {
        const leaveUntil = normalizeLeaveUntil((staff as any).leaveUntil);
        const employmentEndDate = normalizeLeaveUntil((staff as any).employmentEndDate);
        const exceptionalDates = normalizeExceptionalLeaveDates((staff as any).exceptionalLeaveDates);
        const todayScheduleSnapshot = resolveDateEffectiveScheduleSnapshot(staff as any, today);
        const overrides = normalizeWorkingHourOverrides((staff as any).customWorkingHourOverrides);
        const overrideGroups = buildWorkingHourOverrideGroups(overrides);
        const customWorkingHours = normalizeWorkingHours(
          todayScheduleSnapshot.snapshot?.customWorkingHours || (staff as any).customWorkingHours
        );
        const useCustom = todayScheduleSnapshot.snapshot
          ? todayScheduleSnapshot.snapshot.useCustomWorkingHours
          : !!(staff as any).useCustomWorkingHours;
        const exceptionalWeekdays = todayScheduleSnapshot.hasHistoricalVersion
          ? normalizeExceptionalLeaveWeekdays(todayScheduleSnapshot.weeklyOffDays)
          : resolveStaffWeeklyOffDays(staff);
        const overrideToday = overrides.find((x) => x.date === today);
        const nextSavedOverrideGroup = overrideGroups.find((group) => group.fromDate > today) || null;
        const lastSavedOverrideGroup =
          overrideGroups.length && overrideGroups[overrideGroups.length - 1].toDate < today
            ? overrideGroups[overrideGroups.length - 1]
            : null;
        const baseDay = weekday ? customWorkingHours[weekday] : undefined;
        const resolveOperationalDay = (dateIso: string) => {
          const targetDate = normalizeLeaveUntil(dateIso);
          const targetDayKey = weekdayFromIso(targetDate) || "sat";
          const targetBusinessHours = (businessHours as any)?.[targetDayKey] || {
            enabled: true,
            start: DEFAULT_OPEN_TIME,
            end: DEFAULT_CLOSE_TIME,
          };
          const targetSalonWeeklyEnabled = targetBusinessHours?.enabled !== false;
          const targetSalonWeeklyOpen =
            normalizeTimeHHMM(targetBusinessHours?.start) || DEFAULT_OPEN_TIME;
          const targetSalonWeeklyClose =
            normalizeTimeHHMM(targetBusinessHours?.end) || DEFAULT_CLOSE_TIME;
          let targetSalonEnabled = targetSalonWeeklyEnabled;
          let targetSalonOpen = targetSalonWeeklyOpen;
          let targetSalonClose = targetSalonWeeklyClose;
          let targetSalonOverride:
            | {
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
            if (targetDate < ov.fromDate || targetDate > ov.toDate) continue;
            const includeDays = Array.isArray(ov?.includeWeekdays) ? (ov.includeWeekdays as WeekdayKey[]) : [];
            if (includeDays.length > 0 && !includeDays.includes(targetDayKey)) continue;
            const blockedDays = Array.isArray(ov?.blockedWeekdays) ? (ov.blockedWeekdays as WeekdayKey[]) : [];
            if (blockedDays.includes(targetDayKey) || String(ov?.mode || "").trim() === "closed") {
              targetSalonEnabled = false;
              targetSalonOverride = {
                fromDate: ov.fromDate,
                toDate: ov.toDate,
                mode: "closed",
                windowLabel: "ط¥ط؛ظ„ط§ظ‚ ظƒط§ظ…ظ„ ط§ظ„ظٹظˆظ…",
                includeDays,
                blockedDays,
              };
            } else {
              targetSalonEnabled = true;
              const ovStart = normalizeTimeHHMM(ov.start) || targetSalonOpen;
              const ovEnd = normalizeTimeHHMM(ov.end) || targetSalonClose;
              targetSalonOpen = ovStart;
              targetSalonClose = ovEnd;
              targetSalonOverride = {
                fromDate: ov.fromDate,
                toDate: ov.toDate,
                mode: "hours",
                windowLabel: formatWindow(ovStart, ovEnd),
                includeDays,
                blockedDays,
              };
            }
            break;
          }

          const targetScheduleSnapshot = resolveDateEffectiveScheduleSnapshot(staff as any, targetDate);
          const targetCustomWorkingHours = normalizeWorkingHours(
            targetScheduleSnapshot.snapshot?.customWorkingHours || (staff as any).customWorkingHours
          );
          const targetUseCustom = targetScheduleSnapshot.snapshot
            ? targetScheduleSnapshot.snapshot.useCustomWorkingHours
            : !!(staff as any).useCustomWorkingHours;
          const targetExceptionalWeekdays = targetScheduleSnapshot.hasHistoricalVersion
            ? normalizeExceptionalLeaveWeekdays(targetScheduleSnapshot.weeklyOffDays)
            : exceptionalWeekdays;
          const targetOverride = overrides.find((x) => x.date === targetDate) || null;
          const targetBaseDay = targetDayKey ? targetCustomWorkingHours[targetDayKey] : undefined;
          const targetLeaveByDate = exceptionalDates.includes(targetDate);
          const targetLeaveByWeekday = targetDayKey ? targetExceptionalWeekdays.includes(targetDayKey) : false;
          const targetLeaveByToggle =
            !!(staff as any).onLeave && (!leaveUntil || leaveUntil >= targetDate);
          const targetLeaveActive = targetLeaveByDate || targetLeaveByWeekday || targetLeaveByToggle;
          const targetEmploymentEnded = !!employmentEndDate && targetDate > employmentEndDate;

          let targetEffectiveEnabled = true;
          let targetEffectiveStart = targetSalonOpen;
          let targetEffectiveEnd = targetSalonClose;

          if (targetOverride) {
            targetEffectiveEnabled = targetOverride.enabled !== false;
            targetEffectiveStart = normalizeTimeHHMM(targetOverride.start) || targetSalonOpen;
            targetEffectiveEnd = normalizeTimeHHMM(targetOverride.end) || targetSalonClose;
          } else if (targetUseCustom) {
            if (!targetBaseDay || targetBaseDay.enabled === false) {
              targetEffectiveEnabled = false;
            } else {
              targetEffectiveStart = normalizeTimeHHMM(targetBaseDay.start) || targetSalonOpen;
              targetEffectiveEnd = normalizeTimeHHMM(targetBaseDay.end) || targetSalonClose;
            }
          }

          const targetHardBlocked = targetEmploymentEnded || targetLeaveActive;
          const targetIntersection =
            !targetHardBlocked && targetSalonEnabled && targetEffectiveEnabled
              ? intersectTimeWindows(
                  targetSalonOpen,
                  targetSalonClose,
                  targetEffectiveStart,
                  targetEffectiveEnd
                )
              : null;
          const targetSourceLabel = targetOverride
            ? "ط§ط³طھط«ظ†ط§ط، ط§ظ„ظ…ظˆط¸ظپط©"
            : targetSalonOverride
              ? "ط³ط§ط¹ط§طھ ط§ظ„طµط§ظ„ظˆظ† ط§ظ„ط®ط§طµط©"
              : targetUseCustom
                ? "ط§ظ„ط¬ط¯ظˆظ„ ط§ظ„ط£ط³ط¨ظˆط¹ظٹ ظ„ظ„ظ…ظˆط¸ظپط©"
                : "ط³ط§ط¹ط§طھ طھط´ط؛ظٹظ„ ط§ظ„طµط§ظ„ظˆظ†";
          const targetSourceNote = targetOverride ? String(targetOverride.note || "").trim() : "";
          const targetImpactNote = targetOverride
            ? targetSourceNote
              ? `ط£ظˆظ„ ظٹظˆظ… ط§ظ„ط¹ظˆط¯ط© ظٹطھط£ط«ط± ط¨ط§ط³طھط«ظ†ط§ط، ط§ظ„ظ…ظˆط¸ظپط©: ${targetSourceNote}`
              : "ط£ظˆظ„ ظٹظˆظ… ط§ظ„ط¹ظˆط¯ط© ظٹطھط£ط«ط± ط¨ط§ط³طھط«ظ†ط§ط، ط§ظ„ظ…ظˆط¸ظپط© ظپظٹ ظ‡ط°ط§ ط§ظ„طھط§ط±ظٹط®."
            : targetSalonOverride
              ? "ط£ظˆظ„ ظٹظˆظ… ط§ظ„ط¹ظˆط¯ط© ظٹطھط£ط«ط± ط¨ط§ط³طھط«ظ†ط§ط، ط³ط§ط¹ط§طھ ط§ظ„طµط§ظ„ظˆظ† ظپظٹ ظ‡ط°ط§ ط§ظ„طھط§ط±ظٹط®."
              : "";

          return {
            dateIso: targetDate,
            dayKey: targetDayKey,
            salonEnabled: targetSalonEnabled,
            salonOpen: targetSalonOpen,
            salonClose: targetSalonClose,
            salonOverride: targetSalonOverride,
            override: targetOverride,
            baseDay: targetBaseDay,
            leaveActive: targetLeaveActive,
            leaveByDate: targetLeaveByDate,
            leaveByWeekday: targetLeaveByWeekday,
            leaveByToggle: targetLeaveByToggle,
            employmentEnded: targetEmploymentEnded,
            effectiveEnabled: targetEffectiveEnabled,
            effectiveStart: targetEffectiveStart,
            effectiveEnd: targetEffectiveEnd,
            intersection: targetIntersection,
            sourceLabel: targetSourceLabel,
            impactNote: targetImpactNote,
          };
        };

        const formatSavedOverrideGroup = (group: StaffWorkingHourOverrideGroup | null) => {
          if (!group) return null;
          const rangeGregorian = formatIsoDateRange(group.fromDate, group.toDate);
          const rangeHijri = formatIsoDateRangeByCalendar(group.fromDate, group.toDate, "hijri");
          const rangeLabel =
            rangeHijri && rangeHijri !== rangeGregorian
              ? `${rangeGregorian} | ظ‡ط¬ط±ظٹ: ${rangeHijri}`
              : rangeGregorian;
          const modeLabel =
            group.enabled === false
              ? "ط¥ط؛ظ„ط§ظ‚ ظƒط§ظ…ظ„"
              : `ط³ط§ط¹ط§طھ ${formatWindow(
                  normalizeTimeHHMM(group.start) || salonOpen,
                  normalizeTimeHHMM(group.end) || salonClose
                )}`;
          const dayCountLabel =
            group.count > 1 ? `${formatArabicInteger(group.count)} ط£ظٹط§ظ…` : "ظٹظˆظ… ظˆط§ط­ط¯";
          return {
            rangeLabel,
            modeLabel,
            dayCountLabel,
            note: String(group.note || "").trim(),
          };
        };
        const nextSavedOverrideSummary = formatSavedOverrideGroup(nextSavedOverrideGroup);
        const lastSavedOverrideSummary = formatSavedOverrideGroup(lastSavedOverrideGroup);

        const staffBaseWindowLabel = useCustom
          ? baseDay && baseDay.enabled !== false
            ? formatWindow(
                normalizeTimeHHMM(baseDay.start) || salonOpen,
                normalizeTimeHHMM(baseDay.end) || salonClose
              )
            : "ظ…ط؛ظ„ظ‚ ظ‡ط°ط§ ط§ظ„ظٹظˆظ…"
          : formatWindow(salonOpen, salonClose);
        const staffBaseMatchesSalonWeekly = staffBaseWindowLabel === salonWeeklyWindowLabel;

        const staffOverrideLabel = overrideToday
          ? overrideToday.enabled === false
            ? "ط¥ط؛ظ„ط§ظ‚ ظƒط§ظ…ظ„ ط§ظ„ظٹظˆظ…"
            : formatWindow(
                normalizeTimeHHMM(overrideToday.start) || salonOpen,
                normalizeTimeHHMM(overrideToday.end) || salonClose
              )
          : nextSavedOverrideSummary
            ? nextSavedOverrideSummary.modeLabel
            : lastSavedOverrideSummary
              ? lastSavedOverrideSummary.modeLabel
          : "-";
        const staffBaseDetails = useCustom
          ? baseDay && baseDay.enabled !== false
            ? "ط§ظ„ط¯ظˆط§ظ… ظ…ط£ط®ظˆط° ظ…ظ† ط§ظ„ط¬ط¯ظˆظ„ ط§ظ„ط£ط³ط¨ظˆط¹ظٹ ط§ظ„ظ…ط®طµطµ ظ„ظ„ظ…ظˆط¸ظپط©."
            : "ط§ظ„ظٹظˆظ… ظ…ط؛ظ„ظ‚ ظپظٹ ط¬ط¯ظˆظ„ ط§ظ„ظ…ظˆط¸ظپط© ط§ظ„ط£ط³ط¨ظˆط¹ظٹ ط§ظ„ظ…ط®طµطµ."
          : "ظ„ط§ ظٹظˆط¬ط¯ ط¬ط¯ظˆظ„ ط£ط³ط¨ظˆط¹ظٹ ظ…ط®طµطµط› ظٹطھظ… ط§ظ„ط§ط¹طھظ…ط§ط¯ ط¹ظ„ظ‰ ط¯ظˆط§ظ… ط§ظ„طµط§ظ„ظˆظ† ط§ظ„ظپط¹ظ„ظٹ.";
        const staffOverrideDetails = overrideToday
          ? overrideToday.enabled === false
            ? `طھظ… ط¥ط؛ظ„ط§ظ‚ ط¯ظˆط§ظ… ط§ظ„ظ…ظˆط¸ظپط© ط¨طھط§ط±ظٹط® ${todayDateLabel}.`
            : `ط§ط³طھط«ظ†ط§ط، ظ…ظˆط¸ظپط© ظپط¹ظ„ظٹ ط§ظ„ظٹظˆظ…: ${staffOverrideLabel}.`
          : nextSavedOverrideSummary
            ? `ظ„ط§ ظٹظˆط¬ط¯ ط§ط³طھط«ظ†ط§ط، ظپط¹ظ„ظٹ ط§ظ„ظٹظˆظ…. ط£ظ‚ط±ط¨ ط§ط³طھط«ظ†ط§ط، ظ…ط­ظپظˆط¸ (${nextSavedOverrideSummary.dayCountLabel}) ظ…ظ† ${nextSavedOverrideSummary.rangeLabel}: ${nextSavedOverrideSummary.modeLabel}${
                nextSavedOverrideSummary.note ? ` | ظ…ظ„ط§ط­ط¸ط©: ${nextSavedOverrideSummary.note}` : ""
              }.`
            : lastSavedOverrideSummary
              ? `ظ„ط§ ظٹظˆط¬ط¯ ط§ط³طھط«ظ†ط§ط، ظپط¹ظ„ظٹ ط§ظ„ظٹظˆظ…. ط¢ط®ط± ط§ط³طھط«ظ†ط§ط، ظ…ط­ظپظˆط¸ ظƒط§ظ† (${lastSavedOverrideSummary.dayCountLabel}) ظپظٹ ${lastSavedOverrideSummary.rangeLabel}: ${lastSavedOverrideSummary.modeLabel}${
                  lastSavedOverrideSummary.note ? ` | ظ…ظ„ط§ط­ط¸ط©: ${lastSavedOverrideSummary.note}` : ""
                }.`
          : "ظ„ط§ ظٹظˆط¬ط¯ ط§ط³طھط«ظ†ط§ط، ظٹظˆظ…ظٹ ط®ط§طµ ط¨ط§ظ„ظ…ظˆط¸ظپط© ط§ظ„ظٹظˆظ….";

        const leaveByDate = exceptionalDates.includes(today);
        const leaveByWeekday = weekday ? exceptionalWeekdays.includes(weekday) : false;
        const leaveByToggle =
          !!(staff as any).onLeave && (!leaveUntil || leaveUntil >= today);
        const leaveActiveToday = leaveByDate || leaveByWeekday || leaveByToggle;

        const ended = !!employmentEndDate && today > employmentEndDate;

        let effectiveEnabled = true;
        let effectiveStart = salonOpen;
        let effectiveEnd = salonClose;

        if (overrideToday) {
          effectiveEnabled = overrideToday.enabled !== false;
          effectiveStart = normalizeTimeHHMM(overrideToday.start) || salonOpen;
          effectiveEnd = normalizeTimeHHMM(overrideToday.end) || salonClose;
        } else if (useCustom) {
          if (!baseDay || baseDay.enabled === false) {
            effectiveEnabled = false;
          } else {
            effectiveStart = normalizeTimeHHMM(baseDay.start) || salonOpen;
            effectiveEnd = normalizeTimeHHMM(baseDay.end) || salonClose;
          }
        }
        const hardBlockedToday = ended || leaveActiveToday;
        const intersection =
          !hardBlockedToday && salonEnabled && effectiveEnabled
            ? intersectTimeWindows(salonOpen, salonClose, effectiveStart, effectiveEnd)
            : null;
        const nowInsideWindow =
          !!intersection && isTimeInsideWindow(timeNow, intersection.start, intersection.end);

        const actualNow = ended
          ? "ظ…ط³طھط¨ط¹ط¯ط© ظ…ظ† ط§ظ„ط­ط¬ط² (ط§ظ†طھظ‡ظ‰ ط§ظ„طھظˆط¸ظٹظپ)"
          : leaveActiveToday
            ? "ظ…طھظˆظ‚ظپط© ط§ظ„ظٹظˆظ… (ط¥ط¬ط§ط²ط©)"
            : !salonEnabled
              ? "ط§ظ„ط­ط¬ظˆط²ط§طھ ظ…ط؛ظ„ظ‚ط© ط§ظ„ظٹظˆظ… ط¹ظ„ظ‰ ظ…ط³طھظˆظ‰ ط§ظ„طµط§ظ„ظˆظ†"
              : !effectiveEnabled
                ? "ظ„ط§ ظٹظˆط¬ط¯ ط¯ظˆط§ظ… ظ…ظˆط¸ظپط© ط§ظ„ظٹظˆظ…"
                : !intersection
                  ? "ظ„ط§ ظٹظˆط¬ط¯ طھظ‚ط§ط·ط¹ ط¨ظٹظ† ط¯ظˆط§ظ… ط§ظ„ظ…ظˆط¸ظپط© ظˆط¯ظˆط§ظ… ط§ظ„ط­ط¬ظˆط²ط§طھ"
                  : nowInsideWindow
                    ? `طھط¹ظ…ظ„ ط§ظ„ط¢ظ†: ${formatWindow(intersection.start, intersection.end)}`
                    : `ط®ط§ط±ط¬ ط§ظ„ط¯ظˆط§ظ… ط§ظ„ط¢ظ†: ${formatWindow(intersection.start, intersection.end)}`;
        const statusTone: "good" | "warn" | "muted" =
          nowInsideWindow && !!intersection && !ended && !leaveActiveToday
            ? "good"
            : ended || leaveActiveToday || !salonEnabled || !effectiveEnabled || !intersection
              ? "warn"
              : "muted";
        const salonEffectiveDetails = ended
          ? "ط§ظ„ظ…ظˆط¸ظپط© ظ…ط³طھط¨ط¹ط¯ط© ظ…ظ† ط§ظ„ط­ط¬ط² ط¨ط¹ط¯ ط§ظ†طھظ‡ط§ط، ط§ظ„طھظˆط¸ظٹظپ."
          : leaveActiveToday
            ? "ط§ظ„ظ…ظˆط¸ظپط© ظپظٹ ط¥ط¬ط§ط²ط© ط§ظ„ظٹظˆظ…طŒ ظ„ط°ظ„ظƒ ظ„ط§ ظٹط¸ظ‡ط± ط­ط¬ط² ظپط¹ظ„ظٹ ظ„ظ‡ط§."
            : !salonEnabled
              ? "ط§ظ„ط­ط¬ظˆط²ط§طھ ظ…ط؛ظ„ظ‚ط© ط§ظ„ظٹظˆظ… ط¹ظ„ظ‰ ظ…ط³طھظˆظ‰ ط§ظ„طµط§ظ„ظˆظ†."
              : !effectiveEnabled
                ? "ط¯ظˆط§ظ… ط§ظ„ظ…ظˆط¸ظپط© ظ…ط؛ظ„ظ‚ ط§ظ„ظٹظˆظ…."
                : !intersection
                  ? "ظ„ط§ ظٹظˆط¬ط¯ ظˆظ‚طھ ظ…ط´طھط±ظƒ ط¨ظٹظ† ط¯ظˆط§ظ… ط§ظ„طµط§ظ„ظˆظ† ظˆط¯ظˆط§ظ… ط§ظ„ظ…ظˆط¸ظپط©."
                  : `ط§ظ„ظ…ط¯ظ‰ ط§ظ„ظ…طھط§ط­ ظ„ظ„ط­ط¬ط² ظ…ط¹ ط§ظ„ظ…ظˆط¸ظپط©: ${formatWindow(intersection.start, intersection.end)}.`;

        const warnings: string[] = [];
        if (leaveByDate) {
          warnings.push(`ط§ظ„ظٹظˆظ… ط¶ظ…ظ† ط¥ط¬ط§ط²ط© ط§ط³طھط«ظ†ط§ط¦ظٹط© ظ…ط­ط¯ط¯ط© ط¨طھط§ط±ظٹط® ${todayDateLabel}.`);
        }
        if ((staff as any).onLeave) {
          if (leaveUntil && leaveUntil >= today) {
            warnings.push(`ظپظٹ ط¥ط¬ط§ط²ط© ظ…ظ† ${fmtIsoDate(today)} ط¥ظ„ظ‰ ${fmtIsoDate(leaveUntil)}.`);
          } else if (leaveUntil && leaveUntil < today) {
            warnings.push(`ط§ظ†طھظ‡طھ ط¥ط¬ط§ط²طھظ‡ط§ ط¨طھط§ط±ظٹط® ${fmtIsoDate(leaveUntil)}.`);
          } else {
            warnings.push("ظپظٹ ط¥ط¬ط§ط²ط© ط­ط§ظ„ظٹط§ظ‹ ط¨ط¯ظˆظ† طھط§ط±ظٹط® ظ†ظ‡ط§ظٹط© ظ…ط­ط¯ط¯.");
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
          const lead = diffDays <= 14 ? "ط¥ط¬ط§ط²ط© ظ‚ط±ظٹط¨ط©" : "ط¥ط¬ط§ط²ط© ظ…ط¬ط¯ظˆظ„ط©";
          warnings.push(`${lead} طھط¨ط¯ط£ ${fmtIsoDate(start)} ظˆطھظ†طھظ‡ظٹ ${fmtIsoDate(end)}.`);
        }

        if (exceptionalWeekdays.length > 0) {
          const weeklyLabels = exceptionalWeekdays.map((d) => weekdayLabel(d));
          if (weeklyLabels.length === 1) {
            warnings.push(`ط¥ط¬ط§ط²ط© ط«ط§ط¨طھط© ظƒظ„ ${weeklyLabels[0]}.`);
          } else {
            warnings.push(`ط¥ط¬ط§ط²ط© ط«ط§ط¨طھط© ظƒظ„: ${weeklyLabels.join(" / ")}.`);
          }
        }

        const leaveDaysLabel = exceptionalWeekdays.length
          ? exceptionalWeekdays.map((d) => weekdayLabel(d)).join("طŒ ")
          : "-";
        const leaveDaysDetails = exceptionalWeekdays.length
          ? leaveByWeekday
            ? "ط§ظ„ظٹظˆظ… ظٹظ‚ط¹ ط¶ظ…ظ† ط§ظ„ط¥ط¬ط§ط²ط© ط§ظ„ط£ط³ط¨ظˆط¹ظٹط© ط§ظ„ط«ط§ط¨طھط©."
            : "ط§ظ„ظٹظˆظ… ظ„ظٹط³ ط¶ظ…ظ† ط§ظ„ط¥ط¬ط§ط²ط© ط§ظ„ط£ط³ط¨ظˆط¹ظٹط© ط§ظ„ط«ط§ط¨طھط©."
          : "ظ„ط§ طھظˆط¬ط¯ ط£ظٹط§ظ… ط¥ط¬ط§ط²ط© ط£ط³ط¨ظˆط¹ظٹط© ط«ط§ط¨طھط©.";
        const weeklyOffTodayLabel = exceptionalWeekdays.length
          ? `ط¥ط¬ط§ط²ط© ط§ظ„ظ…ظˆط¸ظپط© ط§ظ„ط«ط§ط¨طھط©: ${exceptionalWeekdays.map((d) => weekdayLabel(d)).join("طŒ ")}`
          : "";
        const finalWindowLabel = hardBlockedToday
          ? leaveByWeekday
            ? "ط§ظ„ظٹظˆظ… ط¥ط¬ط§ط²ط© ط£ط³ط¨ظˆط¹ظٹط© ط«ط§ط¨طھط©"
            : "ظ„ط§ ظٹظˆط¬ط¯ ط³ط§ط¹ط§طھ ط¹ظ…ظ„ ط§ظ„ظٹظˆظ…"
          : intersection
            ? formatWindow(intersection.start, intersection.end)
            : "ظ…ط؛ظ„ظ‚ ط§ظ„ظٹظˆظ…";
        const operationalState: "working" | "outside" | "closed" =
          nowInsideWindow && !!intersection ? "working" : intersection ? "outside" : "closed";
        const operationalStatusLabel = ended
          ? "ط®ط§ط±ط¬ ط§ظ„ط®ط¯ظ…ط©"
          : leaveActiveToday
            ? "ظ…طھظˆظ‚ظپط© ط§ظ„ظٹظˆظ…"
            : !intersection
              ? "ظ…ط؛ظ„ظ‚ط© ط§ظ„ظٹظˆظ…"
              : nowInsideWindow
                ? "طھط¹ظ…ظ„ ط§ظ„ط¢ظ†"
                : "ط®ط§ط±ط¬ ط³ط§ط¹ط§طھ ط§ظ„ط¹ظ…ظ„";
        const reasonLabel = ended
          ? "ظ…ط؛ظ„ظ‚ط© ط¨ط³ط¨ط¨ ط§ظ†طھظ‡ط§ط، ط§ظ„طھظˆط¸ظٹظپ"
          : leaveActiveToday
            ? "ظ…ط؛ظ„ظ‚ط© ط¨ط³ط¨ط¨ ط§ظ„ط¥ط¬ط§ط²ط©"
            : !salonEnabled
              ? activeSalonOverride?.mode === "closed"
                ? "ظ…ط؛ظ„ظ‚ط© ط¨ط³ط¨ط¨ ط¥ط؛ظ„ط§ظ‚ ط§ظ„طµط§ظ„ظˆظ† ط§ظ„ظٹظˆظ…"
                : "ظ…ط؛ظ„ظ‚ط© ظˆظپظ‚ ط³ط§ط¹ط§طھ ط§ظ„طµط§ظ„ظˆظ†"
              : !effectiveEnabled
                ? overrideToday?.enabled === false
                  ? "ظ…ط؛ظ„ظ‚ط© ط¨ط³ط¨ط¨ ط§ط³طھط«ظ†ط§ط، ط§ظ„ظ…ظˆط¸ظپط©"
                  : useCustom
                    ? "ظ…ط؛ظ„ظ‚ط© ظˆظپظ‚ ط¬ط¯ظˆظ„ ط§ظ„ظ…ظˆط¸ظپط© ط§ظ„ط£ط³ط¨ظˆط¹ظٹ"
                    : "ظ…ط؛ظ„ظ‚ط© ظˆظپظ‚ ط¬ط¯ظˆظ„ ط§ظ„طµط§ظ„ظˆظ†"
                : !intersection
                  ? "ظ…ط؛ظ„ظ‚ط© ظ„ط¹ط¯ظ… ظˆط¬ظˆط¯ ظˆظ‚طھ ظ…ط´طھط±ظƒ"
                  : overrideToday
                    ? "ط¨ظ†ط§ط،ظ‹ ط¹ظ„ظ‰ ط§ط³طھط«ظ†ط§ط، ط§ظ„ظ…ظˆط¸ظپط©"
                    : useCustom
                      ? "ط¨ظ†ط§ط،ظ‹ ط¹ظ„ظ‰ ط¬ط¯ظˆظ„ ط§ظ„ظ…ظˆط¸ظپط© ط§ظ„ط£ط³ط¨ظˆط¹ظٹ"
                      : activeSalonOverride
                        ? "ط¨ظ†ط§ط،ظ‹ ط¹ظ„ظ‰ ط³ط§ط¹ط§طھ ط§ظ„طµط§ظ„ظˆظ† ط§ظ„ط®ط§طµط©"
                        : "ط¨ظ†ط§ط،ظ‹ ط¹ظ„ظ‰ ط¬ط¯ظˆظ„ ط§ظ„طµط§ظ„ظˆظ†";
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
              ? "ظƒظ„ ط§ظ„ط£ظٹط§ظ…"
              : formatWeekdaySet(weekdaysInGroup);
          return {
            id: group.id,
            tone,
            badge: tone === "active" ? "ظ†ط´ط·" : tone === "upcoming" ? "ظ‚ط§ط¯ظ…" : "ظ…ظ†طھظ‡ظٹ",
            title: `ط§ظ„ط§ط³طھط«ظ†ط§ط، ${formatArabicInteger(groupIndex + 1)}`,
            gregorianRange: rangeDual.gregorian,
            hijriRange: rangeDual.hijri,
            hoursLabel:
              group.enabled === false
                ? "ط¥ط؛ظ„ط§ظ‚ ظƒط§ظ…ظ„"
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
          ? `ط¢ط®ط± ط§ط³طھط«ظ†ط§ط، ظ…ط¬ط¯ظˆظ„ ظٹظ†طھظ‡ظٹ ظپظٹ ${fmtIsoDate(lastTimelineOverrideGroup.toDate)} â€” ${fmtIsoDateHijri(
              lastTimelineOverrideGroup.toDate
            )}`
          : "";
        const overrideTimelineFallback = lastTimelineOverrideGroup
          ? `ط¨ط¹ط¯ ${fmtIsoDate(lastTimelineOverrideGroup.toDate)} (${fmtIsoDateHijri(
              lastTimelineOverrideGroup.toDate
            )}) ظٹط¹ظˆط¯ ط§ظ„ظ†ط¸ط§ظ… ط¥ظ„ظ‰ ط§ظ„ط¬ط¯ظˆظ„ ط§ظ„ط£ط³ط¨ظˆط¹ظٹ ط§ظ„ظ…ط¹طھط§ط¯ ظ…ط§ ظ„ظ… ظٹظڈط¶ظپ ط§ط³طھط«ظ†ط§ط، ط¬ط¯ظٹط¯.`
          : "";
        const overrideTodayLabel = overrideToday ? staffOverrideLabel : "ظ„ط§ ظٹظˆط¬ط¯ ط§ظ„ظٹظˆظ…";
        const overrideTodayNote = overrideToday
          ? "ط§ظ„ط§ط³طھط«ظ†ط§ط، ط§ظ„ظ…ط·ط¨ظ‚ ط§ظ„ظٹظˆظ… ظ…ظˆط¶ط­ ط¶ظ…ظ† ط§ظ„ط¬ط¯ظˆظ„ ط§ظ„ط²ظ…ظ†ظٹ ط£ط¹ظ„ط§ظ‡."
          : "ظ„ط§ ظٹظˆط¬ط¯ ط§ط³طھط«ظ†ط§ط، ظ…ظˆط¸ظپط© ظ…ط·ط¨ظ‚ ط¹ظ„ظ‰ ظ‡ط°ط§ ط§ظ„ظٹظˆظ….";
        const hasClosureStatus = ended || leaveActiveToday || !salonEnabled || !effectiveEnabled || !intersection;
        const closureStatusValue = ended
          ? "ط§ظ†طھظ‡ظ‰ ط§ظ„طھظˆط¸ظٹظپ"
          : leaveActiveToday
            ? "ط¥ط¬ط§ط²ط© / طھظˆظ‚ظپ"
            : !salonEnabled
              ? "ط¥ط؛ظ„ط§ظ‚ ط¹ظ„ظ‰ ظ…ط³طھظˆظ‰ ط§ظ„طµط§ظ„ظˆظ†"
              : !effectiveEnabled
                ? "ط¥ط؛ظ„ط§ظ‚ ط¹ظ„ظ‰ ظ…ط³طھظˆظ‰ ط§ظ„ظ…ظˆط¸ظپط©"
                : !intersection
                  ? "ظ„ط§ ظٹظˆط¬ط¯ ظˆظ‚طھ ظ…ط´طھط±ظƒ"
                  : "ظ„ط§ ظٹظˆط¬ط¯ ط¥ط؛ظ„ط§ظ‚ ط§ظ„ظٹظˆظ…";
        const closureStatusNote = ended
          ? "ط§ظ„ظ…ظˆط¸ظپط© ط؛ظٹط± ظ…طھط§ط­ط© ظ„ظ„ط­ط¬ط² ط¨ط¹ط¯ طھط§ط±ظٹط® ط§ظ†طھظ‡ط§ط، ط§ظ„طھظˆط¸ظٹظپ."
          : leaveActiveToday
            ? "ظ…طھظˆظ‚ظپط© ط§ظ„ظٹظˆظ… ط¨ط³ط¨ط¨ ط§ظ„ط¥ط¬ط§ط²ط© ط£ظˆ ط§ظ„طھط¹ط·ظٹظ„."
            : !salonEnabled
              ? "ط§ظ„ط­ط¬ظˆط²ط§طھ ظ…ط؛ظ„ظ‚ط© ط§ظ„ظٹظˆظ… ط¹ظ„ظ‰ ظ…ط³طھظˆظ‰ ط§ظ„طµط§ظ„ظˆظ†."
              : !effectiveEnabled
                ? "ط¯ظˆط§ظ… ط§ظ„ظ…ظˆط¸ظپط© ظ…ط؛ظ„ظ‚ ط§ظ„ظٹظˆظ…."
                : !intersection
                  ? "ظ„ط§ ظٹظˆط¬ط¯ ظˆظ‚طھ ظ…ط´طھط±ظƒ ط¨ظٹظ† ط¯ظˆط§ظ… ط§ظ„ظ…ظˆط¸ظپط© ظˆط³ط§ط¹ط§طھ ط§ظ„طµط§ظ„ظˆظ†."
                  : undefined;
        const reasonStatusValue = ended
          ? "ط§ظ†طھظ‡ط§ط، ط§ظ„طھظˆط¸ظٹظپ"
          : leaveActiveToday
            ? "ط¥ط¬ط§ط²ط© ط£ظˆ طھط¹ط·ظٹظ„"
            : overrideToday
              ? "ط§ط³طھط«ظ†ط§ط، ط§ظ„ظ…ظˆط¸ظپط©"
              : useCustom
                ? "ط§ظ„ط¬ط¯ظˆظ„ ط§ظ„ط£ط³ط¨ظˆط¹ظٹ ظ„ظ„ظ…ظˆط¸ظپط©"
                : activeSalonOverride
                  ? activeSalonOverride.mode === "closed"
                    ? "ط¥ط؛ظ„ط§ظ‚ ط§ظ„طµط§ظ„ظˆظ† ط§ظ„ظٹظˆظ…"
                    : "ط³ط§ط¹ط§طھ ط§ظ„طµط§ظ„ظˆظ† ط§ظ„ط®ط§طµط©"
                  : "ط³ط§ط¹ط§طھ ط§ظ„طµط§ظ„ظˆظ†";
        const bookingAvailabilityValue =
          ended || leaveActiveToday || !salonEnabled || !effectiveEnabled || !intersection
            ? "ط؛ظٹط± ظ…طھط§ط­ ط§ظ„ظٹظˆظ…"
            : "ظ…طھط§ط­ ط¶ظ…ظ† ظ‡ط°ظ‡ ط§ظ„ظپطھط±ط©";
        const statusRows = [
          {
            label: "ط§ظ„ط³ط¨ط¨",
            value: reasonStatusValue,
          },
          {
            label: "ط­ط§ظ„ط© ط§ظ„ط¥ط؛ظ„ط§ظ‚",
            value: hasClosureStatus ? closureStatusValue : "ظ„ط§ ظٹظˆط¬ط¯",
          },
          {
            label: "ط¥طھط§ط­ط© ط§ظ„ط­ط¬ط²",
            value: bookingAvailabilityValue,
          },
        ];
        const upcomingReturn = (() => {
          if (ended || !!intersection) return null;

          const ongoingLeaveWithoutEnd = leaveByToggle && !leaveUntil;
          if (ongoingLeaveWithoutEnd) {
            return {
              gregorianDate: "ط؛ظٹط± ظ…ط­ط¯ط¯ ط­طھظ‰ ط§ظ„ط¢ظ†",
              hijriDate: "ط¨ط§ظ†طھط¸ط§ط± طھط­ط¯ظٹط¯ ظ†ظ‡ط§ظٹط© ط§ظ„ط¥ط¬ط§ط²ط©",
              windowLabel: "ط³ظٹظڈط­ط¯ط¯ ظ„ط§ط­ظ‚ظ‹ط§",
              sourceLabel: "ط¨ط§ظ†طھط¸ط§ط± طھط­ط¯ظٹط¯ ظ†ظ‡ط§ظٹط© ط§ظ„ط¥ط¬ط§ط²ط©",
              availabilityLabel: "ط§ظ„ط­ط¬ط² ط؛ظٹط± ظ…طھط§ط­ ط­طھظ‰ ظٹطھظ… طھط­ط¯ظٹط¯ ظ…ظˆط¹ط¯ ط§ظ„ط¹ظˆط¯ط©",
              note: "ظ„ط§ ظٹظ…ظƒظ† ط§ط­طھط³ط§ط¨ ط£ظˆظ„ ظٹظˆظ… ط¹ظ…ظ„ ظ„ط£ظ† ط§ظ„ط¥ط¬ط§ط²ط© ط§ظ„ط­ط§ظ„ظٹط© ط¨ظ„ط§ طھط§ط±ظٹط® ظ†ظ‡ط§ظٹط© ظ…ط­ط¯ط¯.",
              leaveEndsLabel: "",
            };
          }

          const leaveEndsOn =
            leaveByToggle && leaveUntil && leaveUntil >= today
              ? leaveUntil
              : leaveByDate
                ? today
                : "";
          let cursor =
            leaveByToggle && leaveUntil && leaveUntil >= today ? addDaysIso(leaveUntil, 1) : addDaysIso(today, 1);

          for (let i = 0; i < 120; i++) {
            const candidate = resolveOperationalDay(cursor);
            if (candidate.employmentEnded) break;
            if (candidate.intersection) {
              return {
                gregorianDate: fmtIsoDate(candidate.dateIso),
                hijriDate: fmtIsoDateHijri(candidate.dateIso),
                windowLabel: formatWindow(candidate.intersection.start, candidate.intersection.end),
                sourceLabel: candidate.sourceLabel,
                availabilityLabel: "ط§ظ„ط­ط¬ط² ط³ظٹظƒظˆظ† ظ…طھط§ط­ظ‹ط§ ط§ط¨طھط¯ط§ط،ظ‹ ظ…ظ† ظ‡ط°ط§ ط§ظ„ظˆظ‚طھ",
                note: candidate.impactNote,
                leaveEndsLabel: leaveEndsOn
                  ? `${fmtIsoDate(leaveEndsOn)} â€” ${fmtIsoDateHijri(leaveEndsOn)}`
                  : "",
              };
            }
            cursor = addDaysIso(cursor, 1);
          }

          return {
            gregorianDate: "ظ„ط§ طھظˆط¬ط¯ ط¹ظˆط¯ط© ظ…ط¬ط¯ظˆظ„ط©",
            hijriDate: "ط¨ط­ط³ط¨ ط§ظ„ط¨ظٹط§ظ†ط§طھ ط§ظ„ط­ط§ظ„ظٹط©",
            windowLabel: "ط³ظٹظڈط­ط¯ط¯ ظ„ط§ط­ظ‚ظ‹ط§",
            sourceLabel: "ظ„ط§ طھظˆط¬ط¯ ط³ط§ط¹ط§طھ ط¹ظ…ظ„ ظ„ط§ط­ظ‚ط© ط¶ظ…ظ† ط§ظ„ط¥ط¹ط¯ط§ط¯ط§طھ ط§ظ„ط­ط§ظ„ظٹط©",
            availabilityLabel: "ط§ظ„ط­ط¬ط² ط؛ظٹط± ظ…طھط§ط­ ط­طھظ‰ طھطھظˆظپط± ط³ط§ط¹ط§طھ ط¹ظ…ظ„ ظ„ط§ط­ظ‚ط©",
            note: "ظ„ظ… ظٹطھظ… ط§ظ„ط¹ط«ظˆط± ط¹ظ„ظ‰ ظٹظˆظ… ط¹ظ…ظ„ ظ‚ط§ط¯ظ… ط¶ظ…ظ† ط§ظ„ط¬ط¯ظˆظ„ ط§ظ„ط­ط§ظ„ظٹ.",
            leaveEndsLabel: leaveEndsOn ? `${fmtIsoDate(leaveEndsOn)} â€” ${fmtIsoDateHijri(leaveEndsOn)}` : "",
          };
        })();
        const detailRows = [
          {
            label: "ط§ظ„ط¬ط¯ظˆظ„ ط§ظ„ط£ط³ط¨ظˆط¹ظٹ ظ„ظ„ظ…ظˆط¸ظپط©",
            value: staffBaseWindowLabel,
            note: useCustom
              ? "ط§ظ„ط³ط§ط¹ط§طھ ط§ظ„ط£ط³ط§ط³ظٹط© ط§ظ„ظ…ط¹طھظ…ط¯ط© ظ…ظ† ط¬ط¯ظˆظ„ ط§ظ„ظ…ظˆط¸ظپط©."
              : "ظ„ط§ ظٹظˆط¬ط¯ ط¬ط¯ظˆظ„ ط£ط³ط¨ظˆط¹ظٹ ظ…ط®طµطµط› طھط¹طھظ…ط¯ ط§ظ„ظ…ظˆط¸ظپط© ط¹ظ„ظ‰ ط³ط§ط¹ط§طھ ط§ظ„طµط§ظ„ظˆظ†.",
          },
          {
            label: "ط³ط§ط¹ط§طھ طھط´ط؛ظٹظ„ ط§ظ„طµط§ظ„ظˆظ†",
            value: salonEffectiveWindowLabel,
            note: activeSalonOverride
              ? "طھط´ظ…ظ„ ط§ط³طھط«ظ†ط§ط، ط§ظ„طµط§ظ„ظˆظ† ط§ظ„ظ…ط·ط¨ظ‚ ط§ظ„ظٹظˆظ…."
              : "ط³ط§ط¹ط§طھ ط§ظ„طھط´ط؛ظٹظ„ ط§ظ„ظ…ط¹طھظ…ط¯ط© ظ„ظ„طµط§ظ„ظˆظ† ط§ظ„ظٹظˆظ….",
          },
          {
            label: "ط§ط³طھط«ظ†ط§ط، ط§ظ„ظ…ظˆط¸ظپط© ط§ظ„ظ…ط·ط¨ظ‚ ط§ظ„ظٹظˆظ…",
            value: overrideTodayLabel,
            note: overrideTodayNote,
          },
          hasClosureStatus
            ? {
                label: "ط­ط§ظ„ط© ط§ظ„ط¥ط؛ظ„ط§ظ‚",
                value: closureStatusValue,
                note: closureStatusNote,
              }
            : {
                label: "ط­ط§ظ„ط© ط§ظ„ط¥ط؛ظ„ط§ظ‚",
                value: "ظ„ط§ ظٹظˆط¬ط¯",
                note: "ظ„ط§ ظٹظˆط¬ط¯ ط¥ط؛ظ„ط§ظ‚ ط£ظˆ طھط¹ط·ظٹظ„ ظٹط¤ط«ط± ط¹ظ„ظ‰ ط§ظ„ط¯ظˆط§ظ… ط§ظ„ظٹظˆظ….",
              },
          {
            label: "ط¥طھط§ط­ط© ط§ظ„ط­ط¬ط²",
            value: bookingAvailabilityValue,
            note:
              bookingAvailabilityValue === "ظ…طھط§ط­ ط¶ظ…ظ† ظ‡ط°ظ‡ ط§ظ„ظپطھط±ط©"
                ? `ط§ظ„ط­ط¬ط² ظ…طھط§ط­ ط¶ظ…ظ† ${finalWindowLabel}.`
                : "ط§ظ„ط­ط¬ط² ط؛ظٹط± ظ…طھط§ط­ ط§ظ„ظٹظˆظ… ط¨ط­ط³ط¨ ط§ظ„ظ†طھظٹط¬ط© ط§ظ„ظ†ظ‡ط§ط¦ظٹط© ط£ط¹ظ„ط§ظ‡.",
          },
        ].filter(Boolean);

        return {
          id: staff.id,
          name: String(staff.name || "-"),
          todayWeekdayLabel: weekdayLabel(weekday),
          todayDateGregorianLabel: `${todayDateGregorian} ظ…`,
          todayDateHijriLabel: `${todayDateHijri} ظ‡ظ€`,
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
          weeklyOffToday: leaveByWeekday,
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
  }, [appSettings, list, nowTick, resolveStaffWeeklyOffDays]);

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
    if (baseSalaryRiyals <= 0) missing.push("ط§ظ„ط±ط§طھط¨ ط§ظ„ط£ط³ط§ط³ظٹ ط؛ظٹط± ظ…ط­ط¯ط¯");
    if (workDays <= 0) missing.push("ط£ظٹط§ظ… ط§ظ„ط¹ظ…ظ„ ط؛ظٹط± ظ…ط­ط¯ط¯ط©");
    if (computedMonthlyHours <= 0) missing.push("ط³ط§ط¹ط§طھ ط§ظ„ط¹ظ…ظ„ ط؛ظٹط± ظ…ط­ط¯ط¯ط©");
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
  const modalPayrollMonthSummary = useMemo(() => {
    if (!editingStaff) return null;
    const monthStats = bookingStats[editingStaff.id]?.month;
    const cycleMonthKey =
      payrollCycleKeyFromDate(todayIso(), PAYROLL_CLOSE_DAY) ||
      String(monthStats?.key || currentMonthKey());
    const staffCalc: StaffPublicDoc & { id: string } = {
      ...editingStaff,
      id: editingStaff.id,
      name: String(name || editingStaff.name || "").trim() || editingStaff.name || editingStaff.id,
      active: !!active,
      useCustomWorkingHours: !!modalUseCustomWorkingHours,
      customWorkingHours: normalizeWorkingHours(modalCustomWorkingHours),
      customWorkingHourOverrides: normalizeWorkingHourOverrides(modalCustomHourOverrides),
      monthlySalary: safeNonNegativeNumber(monthlySalary, 0),
      overtimeMethod:
        overtimeMethod === "invoice_percentage" ? "invoice_percentage" : "hours_from_salary",
      overtimeDaysPerMonth: Math.max(1, safeNonNegativeNumber(overtimeDaysPerMonth, 30)),
      overtimeBaseHoursPerDay: Math.max(1, safeNonNegativeNumber(overtimeBaseHoursPerDay, 8)),
      overtimeSeasonBaseHoursPerDay: Math.max(
        1,
        safeNonNegativeNumber(overtimeSeasonBaseHoursPerDay, 6)
      ),
      overtimeHoursBasis: overtimeHoursBasis === "season" ? "season" : "regular",
      overtimePercent: safeNonNegativeNumber(overtimePercent, 0),
      overtimeInvoicePercent: safeNonNegativeNumber(overtimeInvoicePercent, 0),
    };
    return computeStaffPayrollForMonth({
      staff: staffCalc as any,
      monthKey: cycleMonthKey,
      appSettings,
      invoiceCount: Number(monthStats?.invoiceCount || 0),
      invoiceRevenue: Number(monthStats?.invoiceRevenue || 0),
    });
  }, [
    editingStaff,
    bookingStats,
    appSettings,
    name,
    active,
    modalUseCustomWorkingHours,
    modalCustomWorkingHours,
    modalCustomHourOverrides,
    monthlySalary,
    overtimeMethod,
    overtimeDaysPerMonth,
    overtimeBaseHoursPerDay,
    overtimeSeasonBaseHoursPerDay,
    overtimeHoursBasis,
    overtimePercent,
    overtimeInvoicePercent,
  ]);
  const employeeProfileHasUnsavedChanges = useMemo(() => {
    if (!editingStaff) return false;

    const normalizeServiceIds = (value: unknown) =>
      canonicalizeSpecialties(value, serviceOptions).slice().sort((a, b) => a.localeCompare(b));

    const todayScheduleSnapshot = resolveDateEffectiveScheduleSnapshot(editingStaff as any, todayIso());
    const savedUseCustomWorkingHours = todayScheduleSnapshot.snapshot
      ? todayScheduleSnapshot.snapshot.useCustomWorkingHours
      : !!(editingStaff as any).useCustomWorkingHours;
    const savedCustomWorkingHours = normalizeWorkingHours(
      todayScheduleSnapshot.snapshot?.customWorkingHours || (editingStaff as any).customWorkingHours
    );
    const savedWeeklyOffDays = savedUseCustomWorkingHours
      ? WEEKDAY_OPTIONS.filter(
          (day) => savedCustomWorkingHours[day.key]?.enabled === false
        ).map((day) => day.key)
      : todayScheduleSnapshot.hasHistoricalVersion
        ? normalizeExceptionalLeaveWeekdays(todayScheduleSnapshot.weeklyOffDays)
        : resolveStaffWeeklyOffDays(editingStaff);
    const savedAlignedWorkingHours = savedUseCustomWorkingHours
      ? savedCustomWorkingHours
      : WEEKDAY_OPTIONS.reduce((next, day) => {
          next[day.key] = {
            ...savedCustomWorkingHours[day.key],
            enabled: !savedWeeklyOffDays.includes(day.key),
          };
          return next;
        }, { ...savedCustomWorkingHours });

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
        useCustomWorkingHours: savedUseCustomWorkingHours,
        customWorkingHours: normalizeWorkingHours(savedAlignedWorkingHours),
        customWorkingHourOverrides: normalizeWorkingHourOverrides((editingStaff as any).customWorkingHourOverrides),
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
        useCustomWorkingHours: !!modalUseCustomWorkingHours,
        customWorkingHours: normalizeWorkingHours(modalCustomWorkingHours),
        customWorkingHourOverrides: normalizeWorkingHourOverrides(modalCustomHourOverrides),
      },
    };

    return JSON.stringify(saved) !== JSON.stringify(current);
  }, [
    active,
    avatarUrl,
    bio,
    cvUrl,
    editingStaff,
    employmentEndDate,
    includeInEmployeeManagement,
    modalCustomHourOverrides,
    modalCustomWorkingHours,
    modalUseCustomWorkingHours,
    name,
    rating,
    resolveAttendanceZoneId,
    resolveStaffWeeklyOffDays,
    reviewsCount,
    selectedAttendanceZoneId,
    serviceOptions,
    showOnAbout,
    showOnBooking,
    specialties,
  ]);
  const modalTabs: Array<{ key: EmployeeModalTab; label: string }> = editingStaff
    ? [
        { key: "basic", label: "ط§ظ„ط¨ظٹط§ظ†ط§طھ ط§ظ„ط£ط³ط§ط³ظٹط©" },
        { key: "booking", label: "ط§ظ„ط­ط¬ط² ظˆط§ظ„ط¯ظˆط§ظ…" },
        { key: "services", label: "ط§ظ„ط®ط¯ظ…ط§طھ" },
        { key: "profile", label: "ط§ظ„ظ…ظ„ظپ" },
        { key: "stats", label: "ط§ظ„ط¥ط­طµط§ط¦ظٹط§طھ ظˆط§ظ„ط¥ط¬ط§ط²ط§طھ" },
      ]
    : [
        { key: "basic", label: "ط§ظ„ط¨ظٹط§ظ†ط§طھ ط§ظ„ط£ط³ط§ط³ظٹط©" },
        { key: "booking", label: "ط§ظ„ط­ط¬ط² ظˆط§ظ„ط¯ظˆط§ظ…" },
        { key: "services", label: "ط§ظ„ط®ط¯ظ…ط§طھ" },
        { key: "profile", label: "ط§ظ„ظ…ظ„ظپ" },
      ];
  const detailTabs: Array<{ key: EmployeeSplitTab; label: string; hint: string; icon?: typeof faUserTie }> = [
    { key: "basic", label: "ط§ظ„ط¨ظٹط§ظ†ط§طھ ط§ظ„ط£ط³ط§ط³ظٹط©", hint: "ط§ظ„ط§ط³ظ… ظˆط§ظ„ط­ط§ظ„ط© ظˆط§ظ„ط¸ظ‡ظˆط±", icon: faUserTie },
    { key: "profile", label: "ط§ظ„ظ…ظ„ظپ ظˆط§ظ„طµظˆط±ط©", hint: "ط§ظ„طµظˆط±ط© ظˆط§ظ„ظ†ط¨ط°ط© ظˆط§ظ„طھظ‚ظٹظٹظ…", icon: faFileLines },
    { key: "services", label: "ط§ظ„ط®ط¯ظ…ط§طھ", hint: "ط§ظ„ط®ط¯ظ…ط§طھ ط§ظ„ظ…ط³ظ†ط¯ط© ظ„ظ„ظ…ظˆط¸ظپط©", icon: faInbox },
    { key: "booking", label: "ط§ظ„ط¯ظˆط§ظ… ظˆط§ظ„ط´ظپطھط§طھ", hint: "ط§ظ„ط¬ط¯ظˆظ„ ظˆط§ظ„ظ‚ظˆط§ظ„ط¨ ظˆط§ظ„ط³ظٹط§ط³ط§طھ", icon: faClock },
    ...(canViewAttendance
      ? [{ key: "attendance" as EmployeeSplitTab, label: "ط§ظ„ط­ط¶ظˆط±", hint: "ط§ظ„ط³ط¬ظ„ ط§ظ„ظٹظˆظ…ظٹ", icon: faCalendarCheck }]
      : []),
    ...(canViewPayroll
      ? [{ key: "payroll" as EmployeeSplitTab, label: "ط³ط¬ظ„ ط§ظ„ط±ظˆط§طھط¨", hint: "ط§ظ„ظ‚ظپظ„ ظˆط§ظ„ط­ط³ط§ط¨", icon: faMoneyBillWave }]
      : []),
    ...(canManageLeaveBalance
      ? [
          { key: "requests" as EmployeeSplitTab, label: "ط§ظ„ط·ظ„ط¨ط§طھ", hint: "ط·ظ„ط¨ط§طھ ط§ظ„ظ…ظˆط¸ظپط©", icon: faInbox },
          { key: "leave" as EmployeeSplitTab, label: "ط±طµظٹط¯ ط§ظ„ط¥ط¬ط§ط²ط§طھ", hint: "ط§ظ„ط­ط§ظ„ط© ظˆط§ظ„ط±طµظٹط¯ ظˆط§ظ„ط³ط¬ظ„", icon: faCalendarCheck },
        ]
      : []),
    ...(canViewEmployeeMessages
      ? [{ key: "messages" as EmployeeSplitTab, label: "ط§ظ„ط±ط³ط§ط¦ظ„", hint: "ط§ظ„طھظˆط§طµظ„ ط§ظ„ط¯ط§ط®ظ„ظٹ", icon: faEnvelope }]
      : []),
    ...(canViewEmployeeFiles
      ? [{ key: "files" as EmployeeSplitTab, label: "ط§ظ„ظ…ظ„ظپط§طھ", hint: "ط§ظ„ظ…ط³طھظ†ط¯ط§طھ", icon: faFileLines }]
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
        setErrorMsg("طµظٹط؛ط© ط§ظ„طھط§ط±ظٹط® ط§ظ„ظ‡ط¬ط±ظٹ ظٹط¬ط¨ ط£ظ† طھظƒظˆظ†: ظٹظˆظ…/ط´ظ‡ط±/ط³ظ†ط© (ظ…ط«ط§ظ„: 09/09/1447).");
      }
      return;
    }
    const iso = isoFromHijriDateParts(parsed);
    if (!iso) {
      if (commit) {
        setErrorMsg("طھط¹ط°ط± طھط­ظˆظٹظ„ ط§ظ„طھط§ط±ظٹط® ط§ظ„ظ‡ط¬ط±ظٹ. طھط£ظƒط¯ ظ…ظ† ط¥ط¯ط®ط§ظ„ طھط§ط±ظٹط® ظ‡ط¬ط±ظٹ طµط­ظٹط­.");
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
      setErrorMsg("ظ„ط§ طھظˆط¬ط¯ ط§ط³طھط«ظ†ط§ط،ط§طھ ط­ط§ظ„ظٹط© ظ„طھط¹ط¯ظٹظ„ظ‡ط§.");
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
        return { next: base, appliedCount: 0, error: "ظ†ط·ط§ظ‚ ط§ظ„طھط§ط±ظٹط® ظƒط¨ظٹط± ط¬ط¯ط§ظ‹. ط§ظ„ط­ط¯ ط§ظ„ط£ظ‚طµظ‰ 120 ظٹظˆظ…." };
      }
    }
    if (rows.length === 0) {
      return { next: base, appliedCount: 0, error: "ظ„ط§ ظٹظˆط¬ط¯ ط£ظٹط§ظ… ظ…ط·ط§ط¨ظ‚ط© ظ„ظ„ظپظ„ط§طھط± ط§ظ„ظ…ط®طھط§ط±ط© ط¯ط§ط®ظ„ ط§ظ„ظ†ط·ط§ظ‚." };
    }

    const rowsToApply = modalHourOverrideUpdateExistingOnly
      ? rows.filter((r) => base.some((x) => x.date === r.date))
      : rows;
    if (modalHourOverrideUpdateExistingOnly && rowsToApply.length === 0) {
      return { next: base, appliedCount: 0, error: "ظ„ط§ ظٹظˆط¬ط¯ ط§ط³طھط«ظ†ط§ط،ط§طھ ط­ط§ظ„ظٹط© ظ…ط·ط§ط¨ظ‚ط© ظ„ظ„ظ†ط·ط§ظ‚/ط§ظ„ظپظ„ط§طھط± ظ„طھط¹ط¯ظٹظ„ظ‡ط§." };
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
            ? "ط¥ط¶ط§ظپط© ط±طµظٹط¯ ط¥ط¬ط§ط²ط© ظ„ظ„ظ…ظˆط¸ظپط©"
            : "ط®طµظ… ط±طµظٹط¯ ط¥ط¬ط§ط²ط© ظ…ظ† ط§ظ„ظ…ظˆط¸ظپط©",
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
            ? "طھظ…طھ ط¥ط¶ط§ظپط© ط±طµظٹط¯ ط¥ط¬ط§ط²ط©"
            : "طھظ… ط®طµظ… ط±طµظٹط¯ ط¥ط¬ط§ط²ط©",
        body:
          `ط§ظ„ط¹ظ…ظ„ظٹط© ${
            mode === "add"
              ? "ط¥ط¶ط§ظپط©"
              : "ط®طµظ…"
          } ${days} ظٹظˆظ…. ` +
          `ط§ظ„ط±طµظٹط¯ ط§ظ„ط­ط§ظ„ظٹ: ${
            result.leaveBalanceDays
          } ظٹظˆظ….`,
        route: "/employee/leave",
      }).catch(() => {});
    } catch (error) {
      setErrorMsg(
        toFirestoreErrorMessage(
          error,
          "طھط¹ط°ط± ط­ظپط¸ ط­ط±ظƒط© ط§ظ„ط¥ط¬ط§ط²ط© ظپظٹ Core."
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
        "طھط¹ط°ط± طھط­ط¯ظٹط¯ ط³ط¬ظ„ ط§ظ„ط¥ط¬ط§ط²ط© ط§ظ„ظ…ط·ظ„ظˆط¨."
      );
      return;
    }

    const ok = confirm(
      "ظ‡ظ„ ط£ظ†طھ ظ…طھط£ظƒط¯ ظ…ظ† ط­ط°ظپ ظ‡ط°ط§ ط§ظ„ط³ط¬ظ„طں ط³ظٹطھظ… ط¥ظ†ط´ط§ط، ط­ط±ظƒط© ط¹ظƒط³ظٹط© ظˆطھط¹ط¯ظٹظ„ ط±طµظٹط¯ ط§ظ„ط¥ط¬ط§ط²ط§طھ طھظ„ظ‚ط§ط¦ظٹظ‹ط§."
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
          "ط¹ظƒط³ ط­ط±ظƒط© ظ…ظ† ط³ط¬ظ„ ط±طµظٹط¯ ط§ظ„ط¥ط¬ط§ط²ط§طھ ظ„ظ„ظ…ظˆط¸ظپط©",
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
          "طھط¹ط°ط± ط¹ظƒط³ ط­ط±ظƒط© ط§ظ„ط¥ط¬ط§ط²ط© ظپظٹ Core."
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
        "طھط§ط±ظٹط® ط§ظ„ط§ط³طھط­ظ‚ط§ظ‚ ط؛ظٹط± طµط­ظٹط­."
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
          "طھط­ط¯ظٹط« طھط§ط±ظٹط® ط§ط³طھط­ظ‚ط§ظ‚ ط±طµظٹط¯ ط§ظ„ط¥ط¬ط§ط²ط©",
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
          "طھط¹ط°ط± ط­ظپط¸ طھط§ط±ظٹط® ط§ظ„ط§ط³طھط­ظ‚ط§ظ‚ ظپظٹ Core."
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
          <h2 className="dsv2-section-title">ط؛ظٹط± ظ…طµط±ط­</h2>
          <p className="dsv2-section-caption">ط³ط¬ظ‘ظ„ ط¯ط®ظˆظ„ ط«ظ… ط¬ط±ظ‘ط¨ ظ…ط±ط© ط£ط®ط±ظ‰.</p>
        </section>
      </div>

    );
  }

  if (!canAccessEmployeesDashboard) {
    return (
      <div className="dsv2-page dsv2-employees-page">
        <section className="dsv2-card dsv2-card--padded employees-v2-access-state">
          <h2 className="dsv2-section-title">طµظ„ط§ط­ظٹط§طھ ط؛ظٹط± ظƒط§ظپظٹط©</h2>
          <p className="dsv2-section-caption">ظ‡ط°ظ‡ ط§ظ„طµظپط­ط© ظ…ط®طµطµط© ظ„ظ„ط¥ط¯ط§ط±ط©.</p>
        </section>
      </div>
    );
  }

  const openCreateEmployee = () => {
    if (!canCreateEmployees) {
      setErrorMsg("ظ„ظٹط³طھ ظ„ط¯ظٹظƒ طµظ„ط§ط­ظٹط© ظ„ط¥ط¶ط§ظپط© ظ…ظˆط¸ظپط§طھ.");
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
  const selectedAttendanceIdentityKey = selectedAttendanceIdentity.allIds.join("|");
  const selectedEmployeeSpecialDays = useMemo<AttendanceSpecialDay[]>(() => {
    const profile = editingStaff || selectedEmployee;
    if (!profile) return [];
    const cleanMonth = /^\d{4}-\d{2}$/.test(employeeAttendanceMonth)
      ? employeeAttendanceMonth
      : todayIso().slice(0, 7);
    const fromDate = `${cleanMonth}-01`;
    const toDate = new Date(
      Date.UTC(Number(cleanMonth.slice(0, 4)), Number(cleanMonth.slice(5, 7)), 0)
    ).toISOString().slice(0, 10);

    return Array.from(buildAttendanceSpecialDayMap({
      profile,
      leaveRequests: selectedEmployeeLeaveRequests,
      leaveEntries: modalLeaveEntries as any[],
      extraIds: selectedAttendanceIdentity.allIds,
      fromDate,
      toDate,
      todayDateKey: todayIso(),
    }).values()).sort((left, right) => left.date.localeCompare(right.date));
  }, [
    editingStaff,
    employeeAttendanceMonth,
    modalLeaveEntries,
    selectedAttendanceIdentityKey,
    selectedEmployee,
    selectedEmployeeLeaveRequests,
  ]);
  const selectedEmployeeApprovedLeaveDateKeys = useMemo(
    () => selectedEmployeeSpecialDays
      .filter((day) => day.kind === "leave" || day.kind === "rest")
      .map((day) => day.date),
    [selectedEmployeeSpecialDays]
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
            <header className="dsv2-page-head employees-v2-page-head" aria-label="ط¥ط¯ط§ط±ط© ط§ظ„ظ…ظˆط¸ظپط§طھ">
              <div className="employees-v2-page-heading">
                <span className="dsv2-badge dsv2-badge--gold">
                  <FontAwesomeIcon icon={faUserTie} />
                  ط§ظ„ظ…ظˆط§ط±ط¯ ط§ظ„ط¨ط´ط±ظٹط©
                </span>
                <h1 className="dsv2-page-title">ط¥ط¯ط§ط±ط© ط§ظ„ظ…ظˆط¸ظپط§طھ</h1>
                <p className="dsv2-page-subtitle">
                  ط¥ط¯ط§ط±ط© ط§ظ„ظ…ظ„ظپط§طھ ط§ظ„ظˆط¸ظٹظپظٹط© ظˆط§ظ„ط­ط¶ظˆط± ظˆط§ظ„ط®ط¯ظ…ط§طھ ظˆط§ظ„ط±ظˆط§طھط¨ ظ…ظ† ظ…ط³ط§ط­ط© ظ…ظˆط­ط¯ط©.
                </p>
              </div>

              <div className="employees-v2-page-actions">
                {canCreateEmployees ? (
                  <button className="dsv2-btn dsv2-btn--primary" type="button" onClick={openCreateEmployee}>
                    <FontAwesomeIcon icon={faPlus} />
                    ط¥ط¶ط§ظپط© ظ…ظˆط¸ظپط©
                  </button>
                ) : null}
                {canFixBookings ? (
                  <button
                    className="dsv2-btn dsv2-btn--secondary"
                    type="button"
                    onClick={() => setRepairConfirmOpen(true)}
                    title="ط¥طµظ„ط§ط­ ط±ط¨ط· ط§ظ„ط­ط¬ظˆط²ط§طھ"
                  >
                    <FontAwesomeIcon icon={faScrewdriverWrench} />
                    ط¥طµظ„ط§ط­ ط§ظ„ظ…ظ„ظپط§طھ
                  </button>
                ) : null}
                <button
                  className="dsv2-btn dsv2-btn--secondary"
                  onClick={() => void reloadData(true)}
                  disabled={busy}
                  type="button"
                >
                  <FontAwesomeIcon icon={faRotateRight} />
                  طھط­ط¯ظٹط« ط§ظ„ط¨ظٹط§ظ†ط§طھ
                </button>
              </div>
            </header>

            <section className="dsv2-grid dsv2-grid--metrics employees-v2-metrics" aria-label="ط¥ط­طµط§ط،ط§طھ ط§ظ„ظ…ظˆط¸ظپط§طھ">
              <article className="dsv2-metric-card dsv2-metric-card--dark">
                <p className="dsv2-metric-card__label">ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظ…ظ„ظپط§طھ</p>
                <strong className="dsv2-metric-card__value">{totalEmployeeCount}</strong>
                <p className="dsv2-metric-card__meta">ظƒظ„ ط§ظ„ظ…ظ„ظپط§طھ ط§ظ„ظ…طھط§ط­ط© ط­ط³ط¨ ط§ظ„طµظ„ط§ط­ظٹط©</p>
              </article>
              <article className="dsv2-metric-card dsv2-metric-card--success">
                <p className="dsv2-metric-card__label">ط¹ظ„ظ‰ ط±ط£ط³ ط§ظ„ط¹ظ…ظ„</p>
                <strong className="dsv2-metric-card__value">{availableEmployeeCount}</strong>
                <p className="dsv2-metric-card__meta">ظ†ط´ط·ط§طھ ظˆظ„ط³ظ† ظپظٹ ط¥ط¬ط§ط²ط©</p>
              </article>
              <article className="dsv2-metric-card dsv2-metric-card--gold">
                <p className="dsv2-metric-card__label">ظپظٹ ط¥ط¬ط§ط²ط©</p>
                <strong className="dsv2-metric-card__value">{leaveEmployeeCount}</strong>
                <p className="dsv2-metric-card__meta">ط¥ط¬ط§ط²ط© ط­ط§ظ„ظٹط© ظ…ظ† ط³ط¬ظ„ ط§ظ„ظ…ظˆط¸ظپط©</p>
              </article>
              <article className="dsv2-metric-card dsv2-metric-card--danger">
                <p className="dsv2-metric-card__label">طھط­طھط§ط¬ ظ…طھط§ط¨ط¹ط©</p>
                <strong className="dsv2-metric-card__value">{inactiveEmployeeCount + noServiceEmployeeCount + incompleteEmployeeCount}</strong>
                <p className="dsv2-metric-card__meta">ط؛ظٹط± ظ†ط´ط·ط© ط£ظˆ ط¨ط¯ظˆظ† ط®ط¯ظ…ط§طھ ط£ظˆ ظ…ظ„ظپ ط؛ظٹط± ظ…ظƒطھظ…ظ„</p>
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
                <strong>ط¬ط§ط±ظٹ ظپطھط­ ظ…ظ„ظپ ط§ظ„ظ…ظˆط¸ظپط©...</strong>
                <p>ظٹطھظ… طھط­ظ…ظٹظ„ ط§ظ„ظ…ظ„ظپ ظ…ظ† ط§ظ„ط³ط¬ظ„ ط§ظ„ظˆط¸ظٹظپظٹ ط§ظ„ط­ط§ظ„ظٹ ط¨ط¯ظˆظ† طھط؛ظٹظٹط± ظ…ط³ط§ط±ط§طھ ط§ظ„ط­ط³ط§ط¨ط§طھ.</p>
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
                isVisible={!editingStaff && modalTab === "basic"}
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
                schedule={editingStaff}
                salonBusinessHours={((appSettings as any)?.booking || {})?.businessHours || null}
                employeeId={selectedAttendanceIdentity.employeeUid || selectedEmployeeId || (editingStaff as any)?.id || ""}
                employeeIds={selectedAttendanceIdentity.allIds}
                approvedLeaveDateKeys={selectedEmployeeApprovedLeaveDateKeys}
                specialDays={selectedEmployeeSpecialDays}
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
                title="طھط¹ط¯ظٹظ„ ط§ظ„ط¨طµظ…ط©"
                description={
                  attendanceEditDate
                    ? `طھط¹ط¯ظٹظ„ ط³ط¬ظ„ ط§ظ„ط­ط¶ظˆط± ظ„ظٹظˆظ… ${attendanceEditDate}`
                    : "طھط¹ط¯ظٹظ„ ط³ط¬ظ„ ط§ظ„ط­ط¶ظˆط± ظˆط§ظ„ط§ظ†طµط±ط§ظپ"
                }
                eyebrow="ط§ظ„ط­ط¶ظˆط± ظˆط§ظ„ط§ظ†طµط±ط§ظپ"
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
                      ط¥ظ„ط؛ط§ط،
                    </button>
                    <button
                      type="button"
                      className="dsv2-btn dsv2-btn--primary"
                      onClick={() => void saveAttendancePunchEditor()}
                      disabled={saving}
                    >
                      {saving ? "ط¬ط§ط±ظچ ط§ظ„ط­ظپط¸..." : "ط­ظپط¸ طھط¹ط¯ظٹظ„ ط§ظ„ط¨طµظ…ط©"}
                    </button>
                  </>
                }
              >
                <div className="dsv2-ew-dialog-grid dsv2-ew-dialog-grid--2 emp-attendance-edit-form-v2">
                  <DashboardFieldV2
                    id="employee-attendance-edit-check-in"
                    label="ظˆظ‚طھ ط§ظ„ط­ط¶ظˆط±"
                    hint="ط§ط®طھط§ط±ظٹ ط³ط§ط¹ط© ظˆط¯ظ‚ظٹظ‚ط© ط§ظ„ط­ط¶ظˆط± ظپظ‚ط·."
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
                    label="ظˆظ‚طھ ط§ظ„ط§ظ†طµط±ط§ظپ"
                    hint="ظٹظ…ظƒظ† طھط±ظƒظ‡ ظپط§ط±ط؛ظ‹ط§ ط¥ط°ط§ ظ„ظ… طھط³ط¬ظ„ ط§ظ„ظ…ظˆط¸ظپط© ط§ظ†طµط±ط§ظپظ‹ط§."
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
                          ظ…ط³ط­ ط§ظ„ظˆظ‚طھ
                        </button>
                      ) : null}
                    </div>
                  </DashboardFieldV2>

                  <DashboardFieldV2
                    id="employee-attendance-edit-note"
                    label="ظ…ظ„ط§ط­ط¸ط© ط§ظ„ط¥ط¯ط§ط±ط©"
                    hint="ظٹظڈظپط¶ظ‘ظ„ طھظˆط¶ظٹط­ ط³ط¨ط¨ طھط¹ط¯ظٹظ„ ط§ظ„ط¨طµظ…ط© ظ„ط£ط؛ط±ط§ط¶ ط§ظ„ظ…ط±ط§ط¬ط¹ط©."
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
                      placeholder="ظ…ط«ط§ظ„: طھطµط­ظٹط­ ط¨طµظ…ط© ظ…ظ† ط§ظ„ط¥ط¯ط§ط±ط©"
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
                    : "ظ„ط§ طھظˆط¬ط¯ ط¥ط¬ط§ط²ط© ط£ط³ط¨ظˆط¹ظٹط© ط«ط§ط¨طھط©."
                }
                onNameChange={setName}
                onActiveChange={setActive}
                onShowOnAboutChange={setShowOnAbout}
                onShowOnBookingChange={setShowOnBooking}
                onIncludeInEmployeeManagementChange={setIncludeInEmployeeManagement}
              />
              <BookingSettingsSection
                isVisible={(!editingStaff && modalTab === "booking") || (!!editingStaff && activeTab === "booking")}
                busy={busy}
                loading={loading}
                employmentEndDate={employmentEndDate}
                modalUseCustomWorkingHours={modalUseCustomWorkingHours}
                modalCustomWorkingHours={modalCustomWorkingHours}
                modalExceptionalLeaveWeekdays={modalExceptionalLeaveWeekdays}
                scheduleEffectiveFrom={modalScheduleEffectiveFrom}
                scheduleChangeReason={modalScheduleChangeReason}
                scheduleVersionCount={normalizeStaffScheduleVersions((editingStaff as any)?.workingScheduleVersions).length}
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
                  reviewerName={authUser?.displayName || authUser?.email || "ط§ظ„ط¥ط¯ط§ط±ط©"}
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
                  viewerName={authUser?.displayName || authUser?.email || "ط§ظ„ط¥ط¯ط§ط±ط©"}
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
                  viewerName={authUser?.displayName || authUser?.email || "ط§ظ„ط¥ط¯ط§ط±ط©"}
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
        title="ط¥طµظ„ط§ط­ ط±ط¨ط· ط§ظ„ط­ط¬ظˆط²ط§طھ ط§ظ„ظ‚ط¯ظٹظ…ط©"
        description="ط³ظٹطھظ… ط§ط³طھظƒظ…ط§ظ„ ظ…ط¹ط±ظپ ط§ظ„ظ…ظˆط¸ظپط© ظپظٹ ط§ظ„ط­ط¬ظˆط²ط§طھ ط§ظ„ظ‚ط¯ظٹظ…ط© ط§ظ„طھظٹ ظٹظ†ظ‚طµظ‡ط§ ط§ظ„ط±ط¨ط· ظپظ‚ط·طŒ ط¯ظˆظ† ط­ط°ظپ ط£ظٹ ط­ط¬ط²."
        tone="gold"
        confirmLabel="ط¨ط¯ط، ط§ظ„ط¥طµظ„ط§ط­"
        cancelLabel="ط¥ظ„ط؛ط§ط،"
        pendingLabel="ط¬ط§ط±ظٹ ط§ظ„ط¥طµظ„ط§ط­..."
      >
        <p className="employees-v2-confirm-note">ظٹظڈظ†ظپط° ظ‡ط°ط§ ط§ظ„ط¥ط¬ط±ط§ط، ط¹ظ†ط¯ ظˆط¬ظˆط¯ ط­ط¬ظˆط²ط§طھ ظ‚ط¯ظٹظ…ط© ط؛ظٹط± ظ…ط±طھط¨ط·ط© ط¨ط­ط³ط§ط¨ ط§ظ„ظ…ظˆط¸ظپط©.</p>
      </DashboardConfirmV2>
    </div>
  );
}
