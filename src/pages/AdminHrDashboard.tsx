import "../styles/AdminHrMobileShell.css";
import "../styles/dashboard-v2/dashboard-v2.css";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRight,
  faBell,
  faChartLine,
  faClock,
  faClipboardList,
  faChevronLeft,
  faChevronRight,
  faEnvelope,
  faFileLines,
  faHouse,
  faMagnifyingGlass,
  faPlus,
  faUserShield,
  faUsers,
  faUserTie,
} from "@fortawesome/free-solid-svg-icons";
import logo1 from "../assets/images/ssunnamed.png";

import { useEmployeeSession, cleanText } from "./hr/shared";
import DashboardHeader from "../components/DashboardHeader";
import DashboardSidebarTooltipV2 from "../components/DashboardSidebarTooltipV2";
import MalikatPortalSidebarV2 from "../components/MalikatPortalSidebarV2";
import InternalPortalSwitcher from "../components/InternalPortalSwitcher";
import PermissionRoute from "../components/PermissionRoute";
import {
  DashboardDatePickerV2,
  DashboardEmptyStateV2,
  DashboardFieldV2,
  DashboardSelectV2,
  DashboardSkeletonV2,
} from "../components/dashboard-v2";
import { usePermissions } from "../security/PermissionContext";
import type { AppPermission } from "../helpers/permissions";
import { logoutFirebase } from "../services/authService";
import RecruitmentApplicationsPage from "./hr/RecruitmentApplications";
import CreateStaffAccountPage from "./hr/CreateStaffAccount";
import EmployeeMessagesPage from "./hr/EmployeeMessages";
import EmployeeFilesPage from "./hr/EmployeeFiles";
import AdminEmployeeRequestsPage from "./hr/AdminEmployeeRequests";
import {
  listEmployeeRequestNotifications,
  listEmployeeRequests,
  markAllEmployeeRequestNotificationsRead,
  markEmployeeRequestNotificationRead,
  type CoreEmployeeRequestNotification,
} from "../services/employeeRequests";
import { listEmployeeDirectory } from "../services/employeeDirectory";
import { CoreHrService } from "../services/CoreHrService";
import type { CoreLeave } from "../types/hrCoreApi";
import { listCoreEmployeeFiles, type CoreEmployeeFile } from "../services/employeeFilesCore";
import {
  createEmployeeAbsenceRecord,
  listEmployeeAbsences,
  listEmployeeLeaveRequests,
  listRecruitmentApplications,
  type EmployeeAbsence,
  type EmployeeLeaveRequest,
  type RecruitmentApplication,
} from "../services/employeeHub";
import {
  formatLeaveDateRange,
  getLeaveStatusMeta,
  getLeaveTypeLabel,
} from "../helpers/hr/employeeLeave";
import {
  getEmployeeFileStatusLabel,
  getEmployeeFileTypeLabel,
} from "../helpers/hr/employeeFiles";
import {
  buildEmployeeAbsenceDateInput,
  formatEmployeeAbsenceDate,
  getEmployeeAbsenceTypeLabel,
} from "../helpers/hr/employeeAbsence";
import {
  getTodayAttendanceDateKey,
  type StaffAttendanceToday,
} from "../services/firestoreAttendance";
import { listAttendanceForEmployeesDateFromWorker } from "../services/attendanceWorkerService";
import {
  getAttendanceDayStatus,
} from "../helpers/hr/attendanceCalculations";
import {
  generatePayrollEntriesForMonths,
  payrollMonthBounds,
} from "../services/CorePayrollService";

const DashboardEmployees = lazy(() => import("./DashboardEmployees"));

type DirectoryEmployee = Record<string, any> & { id?: string };
type StatusTone = "success" | "warning" | "neutral" | "muted";
type PayrollPreviewState = {
  employeeName: string;
  payrollMonth: string;
  fromDate: string;
  toDate: string;
  baseSalary: number;
  requiredWorkDays: number;
  approvedLeaveDays: number;
  attendanceRecordedDays: number;
  daysWithoutAttendance: number;
  expectedWorkHours: number;
  actualWorkedHours: number;
  missingHours: number;
  overtimeHours: number;
  absenceDeduction: number;
  missingHoursDeduction: number;
  finalSalary: number;
};

type HrOverviewProps = {
  roster: DirectoryEmployee[];
  applications: RecruitmentApplication[];
  leaveRequests: EmployeeLeaveRequest[];
  operationalLeaves: CoreLeave[];
  employeeFiles: CoreEmployeeFile[];
  attendanceToday: StaffAttendanceToday[];
  absences: EmployeeAbsence[];
  loading: boolean;
  onNavigate: (path: string) => void;
  onRefresh: () => void;
  session: ReturnType<typeof useEmployeeSession>;
};

function normalizeText(value: unknown) {
  return cleanText(value).toLowerCase().trim();
}

function readableRole(role: unknown) {
  const value = normalizeText(role);
  if (value === "owner") return "المالك";
  if (value === "admin") return "الإدارة";
  if (value === "hr") return "الموارد البشرية";
  if (value === "reception") return "الاستقبال";
  if (value === "staff") return "الموظفين";
  return cleanText(role) || "غير محدد";
}

function formatLongDate(value: unknown) {
  const raw = cleanText(value);
  if (!raw) return "غير محدد";
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return raw;
  try {
    return new Intl.DateTimeFormat("ar-SA", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(parsed));
  } catch {
    return raw;
  }
}

function formatRequestNotificationTime(value: unknown) {
  const raw = cleanText(value);
  if (!raw) return "";
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return raw;
  try {
    return new Intl.DateTimeFormat("ar-SA", {
      timeZone: "Asia/Riyadh",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(parsed));
  } catch {
    return raw;
  }
}

function getFirstText(item: DirectoryEmployee, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = cleanText(item?.[key]);
    if (value) return value;
  }
  return fallback;
}

function formatAttendanceTime(value: unknown) {
  const raw = cleanText(value);
  if (!raw) return "-";
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return raw;
  return new Intl.DateTimeFormat("ar-SA", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Riyadh",
  }).format(new Date(parsed));
}

function getAttendancePunchLabel(status: StaffAttendanceToday["status"]) {
  if (status === "checked_out") return "تم تسجيل الانصراف";
  if (status === "checked_in") return "حاضر";
  return "لم يسجل حضور";
}

function getAttendancePunchTone(status: StaffAttendanceToday["status"]): StatusTone {
  if (status === "checked_out") return "neutral";
  if (status === "checked_in") return "success";
  return "muted";
}

function getAttendanceEventMillis(row: StaffAttendanceToday) {
  const value = row.checkOutAtClient || row.checkInAtClient || "";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getEmployeeName(item: DirectoryEmployee) {
  return getFirstText(item, ["displayName", "name", "fullName", "employeeName", "title"], "موظف غير محدد");
}

function getEmployeeEmail(item: DirectoryEmployee) {
  return getFirstText(item, ["email", "workEmail", "userEmail", "accountEmail"], "غير محدد");
}

function getDepartment(item: DirectoryEmployee) {
  return getFirstText(item, ["department", "section", "team", "group", "unit"], "غير محدد");
}

function getJobTitle(item: DirectoryEmployee) {
  return getFirstText(item, ["jobTitle", "title", "position", "roleTitle", "designation"], "غير محدد");
}

function getStartDate(item: DirectoryEmployee) {
  return formatLongDate(
    item?.startDate || item?.hireDate || item?.employmentStartDate || item?.joinedAt || item?.createdAt
  );
}

function getFingerprint(item: DirectoryEmployee) {
  return getFirstText(item, ["fingerprintNo", "fingerprint", "badgeNo", "badgeNumber", "employeeNo"], "غير محدد");
}

function getPhone(item: DirectoryEmployee) {
  return getFirstText(item, ["phone", "mobile", "mobileNumber", "phoneNumber"], "غير محدد");
}

function getStatusMeta(item: DirectoryEmployee) {
  const rawStatus = normalizeText(
    item?.status || item?.employmentStatus || item?.workStatus || item?.state || item?.employeeStatus
  );
  const onLeave = !!item?.onLeave || rawStatus.includes("leave") || rawStatus.includes("vacation");
  const trial =
    rawStatus.includes("trial") ||
    rawStatus.includes("probation") ||
    rawStatus.includes("trainee") ||
    normalizeText(item?.employmentType).includes("trial");
  const active =
    item?.active !== false &&
    !rawStatus.includes("inactive") &&
    !rawStatus.includes("terminated") &&
    !rawStatus.includes("resign") &&
    !rawStatus.includes("left");

  let label = "على رأس العمل";
  let tone: StatusTone = "success";

  if (!active) {
    label = "غير نشط";
    tone = "muted";
  }
  if (trial) {
    label = "فترة تجربة";
    tone = "neutral";
  }
  if (onLeave) {
    label = "على إجازة";
    tone = "warning";
  }

  return { active, trial, onLeave, label, tone };
}

function getLeaveRequestEmployeeName(item: EmployeeLeaveRequest) {
  return cleanText(item.employeeName || item.employeeId || item.employeeUid) || "Unassigned employee";
}

function getLeaveBadgeTone(status: EmployeeLeaveRequest["status"]): StatusTone {
  const tone = getLeaveStatusMeta(status).tone;
  if (tone === "success" || tone === "warning" || tone === "muted") return tone;
  return "neutral";
}

function getEmployeeFileBadgeTone(status: CoreEmployeeFile["status"]): StatusTone {
  const normalized = normalizeText(status || "active");
  if (normalized === "active" || normalized === "read") return "success";
  if (normalized === "replaced" || normalized === "archived") return "muted";
  return "neutral";
}

function dashboardBadgeToneClass(tone: StatusTone) {
  if (tone === "success") return "dsv2-badge--success";
  if (tone === "warning") return "dsv2-badge--gold";
  return "";
}

function uniqueCleanTexts(values: unknown[]) {
  return Array.from(
    new Set(values.map(cleanText).filter(Boolean))
  );
}

function isFullAttendanceIdentifier(value: unknown) {
  return /^[A-Za-z0-9_-]{20,}$/.test(cleanText(value));
}

function resolveRosterAttendanceIdentity(item: DirectoryEmployee) {
  const canonicalDocId = uniqueCleanTexts([
    item.employeeDocId,
    item.linkedEmployeeDocId,
    item.employeeId,
    item.id,
    item.employeeKey,
  ]).find((value) => !isFullAttendanceIdentifier(value)) || "";
  const uidCandidates = uniqueCleanTexts([
    item.employeeUid,
    item.linkedUid,
    item.authUid,
    item.uid,
    item.userId,
    item.linkedUserId,
    item.employeeDocId,
    item.linkedEmployeeDocId,
    item.employeeId,
    item.id,
    item.employeeKey,
  ]);
  const fullUid = uidCandidates.find(isFullAttendanceIdentifier) || "";
  const employeeUid = fullUid || uidCandidates[0] || "";
  const employeeId = canonicalDocId || cleanText(item.id) || employeeUid;

  return {
    employeeUid,
    employeeId,
  };
}

function getRosterAttendanceId(item: DirectoryEmployee) {
  return resolveRosterAttendanceIdentity(item).employeeId;
}

function getRosterEmployeeUid(item: DirectoryEmployee) {
  return resolveRosterAttendanceIdentity(item).employeeUid;
}

function formatMoney(value: unknown) {
  return new Intl.NumberFormat("ar-SA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function formatHours(value: unknown) {
  return new Intl.NumberFormat("ar-SA", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function matchesSearch(item: DirectoryEmployee, search: string) {
  const haystack = [
    getEmployeeName(item),
    getEmployeeEmail(item),
    getDepartment(item),
    getJobTitle(item),
    normalizeText(item?.role),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(search.toLowerCase().trim());
}

function HrMetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <article className="dsv2-metric-card hr-overview-v2__metric">
      <p className="dsv2-metric-card__label">{label}</p>
      <p className="dsv2-metric-card__value">{value}</p>
      <p className="dsv2-metric-card__meta">{hint}</p>
    </article>
  );
}

function HrOverview({
  roster,
  applications,
  leaveRequests,
  operationalLeaves,
  employeeFiles,
  attendanceToday,
  absences,
  loading,
  onNavigate,
  onRefresh,
  session,
}: HrOverviewProps) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [absenceForm, setAbsenceForm] = useState({
    employeeKey: "",
    date: buildEmployeeAbsenceDateInput(),
    type: "full_day" as EmployeeAbsence["type"],
    note: "",
  });
  const [absenceSaving, setAbsenceSaving] = useState(false);
  const [absenceMessage, setAbsenceMessage] = useState("");
  const [payrollForm, setPayrollForm] = useState({
    employeeKey: "",
    payrollMonth: getTodayAttendanceDateKey().slice(0, 7),
  });
  const [payrollPreview, setPayrollPreview] = useState<PayrollPreviewState | null>(null);
  const [payrollLoading, setPayrollLoading] = useState(false);
  const [payrollMessage, setPayrollMessage] = useState("");

  const currentFullDayLeaveEmployeeIds = useMemo(() => {
    const today = getTodayAttendanceDateKey();
    const ids = new Set<string>();

    for (const leave of operationalLeaves) {
      if (normalizeText(leave.status) !== "approved") continue;
      if (normalizeText(leave.durationKind) === "partial") continue;
      const employeeId = cleanText(leave.employeeId);
      const fromDate = cleanText(leave.startDate);
      const toDate = cleanText(leave.endDate || leave.startDate);
      if (!employeeId || !fromDate || !toDate) continue;
      if (fromDate <= today && today <= toDate) ids.add(employeeId);
    }

    return ids;
  }, [operationalLeaves]);

  const rosterSorted = useMemo(() => {
    const uniqueRoster = new Map<string, DirectoryEmployee>();

    for (const rawItem of roster) {
      const item: DirectoryEmployee = {
        ...rawItem,
        onLeave: currentFullDayLeaveEmployeeIds.has(getRosterAttendanceId(rawItem)),
      };
      const identity =
        getRosterAttendanceId(item) ||
        cleanText(item.id) ||
        cleanText(item.email) ||
        getEmployeeName(item);

      const current = uniqueRoster.get(identity);
      if (!current) {
        uniqueRoster.set(identity, item);
        continue;
      }

      const currentScore = Object.values(current).filter((value) => {
        if (Array.isArray(value)) return value.length > 0;
        if (typeof value === "boolean" || typeof value === "number") return true;
        return cleanText(value).length > 0;
      }).length;
      const nextScore = Object.values(item).filter((value) => {
        if (Array.isArray(value)) return value.length > 0;
        if (typeof value === "boolean" || typeof value === "number") return true;
        return cleanText(value).length > 0;
      }).length;

      if (nextScore > currentScore) uniqueRoster.set(identity, item);
    }

    return Array.from(uniqueRoster.values()).sort((a, b) => {
      const aStatus = getStatusMeta(a);
      const bStatus = getStatusMeta(b);
      if (aStatus.active !== bStatus.active) return Number(bStatus.active) - Number(aStatus.active);
      return getEmployeeName(a).localeCompare(getEmployeeName(b), "ar");
    });
  }, [currentFullDayLeaveEmployeeIds, roster]);

  const employeeSelectOptions = useMemo(
    () =>
      rosterSorted
        .map((item) => ({
          value: getRosterAttendanceId(item),
          label: getEmployeeName(item),
        }))
        .filter((option) => Boolean(option.value)),
    [rosterSorted]
  );

  const filteredRoster = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rosterSorted;
    return rosterSorted.filter((item) => matchesSearch(item, q));
  }, [rosterSorted, search]);

  useEffect(() => {
    if (!selectedId && rosterSorted[0]?.id) {
      setSelectedId(cleanText(rosterSorted[0].id));
    }
  }, [rosterSorted, selectedId]);

  const selected = useMemo(() => {
    if (selectedId) {
      const exact = rosterSorted.find((item) => cleanText(item.id) === cleanText(selectedId));
      if (exact) return exact;
    }
    return rosterSorted[0] || null;
  }, [rosterSorted, selectedId]);

  const activeCount = useMemo(
    () => rosterSorted.filter((item) => getStatusMeta(item).active).length,
    [rosterSorted]
  );
  const leaveCount = currentFullDayLeaveEmployeeIds.size;
  const trialCount = useMemo(
    () => rosterSorted.filter((item) => getStatusMeta(item).trial).length,
    [rosterSorted]
  );
  const pendingApplications = useMemo(
    () =>
      applications.filter((application) => {
        const status = normalizeText(application?.status);
        return status === "new" || status === "reviewing" || status === "pending";
      }).length,
    [applications]
  );
  const recentLeaveRequests = useMemo(() => leaveRequests.slice(0, 6), [leaveRequests]);
  const pendingLeaveRequests = useMemo(
    () => leaveRequests.filter((item) => normalizeText(item.status || "pending") === "pending").length,
    [leaveRequests]
  );
  const recentEmployeeFiles = useMemo(() => employeeFiles.slice(0, 5), [employeeFiles]);
  const attendanceDate = getTodayAttendanceDateKey();
  const attendanceSummary = useMemo(() => {
    const byEmployee = new Map(attendanceToday.map(row => [cleanText(row.employeeId), row]));
    return rosterSorted.reduce(
      (summary, item) => {
        const employeeId = getRosterAttendanceId(item);
        const row = byEmployee.get(employeeId);
        const status = row?.status || "not_started";
        const dayStatus = getAttendanceDayStatus({
          date: attendanceDate,
          hasAttendance: Boolean(row?.checkInAtClient || row?.checkOutAtClient),
          todayDateKey: attendanceDate,
        });
        if (status === "checked_out") {
          summary.checkedOut += 1;
        } else if (status === "checked_in") {
          summary.checkedIn += 1;
        } else if (dayStatus === "today_pending") {
          summary.notStarted += 1;
        } else {
          summary.notStarted += 1;
        }
        return summary;
      },
      { checkedIn: 0, checkedOut: 0, notStarted: 0 }
    );
  }, [attendanceDate, attendanceToday, rosterSorted]);
  const recentAttendanceRows = useMemo(() => {
    const employeeByAttendanceId = new Map(
      rosterSorted.map(item => [getRosterAttendanceId(item), item])
    );
    return attendanceToday
      .filter(row => Boolean(row.checkInAtClient || row.checkOutAtClient))
      .map(row => {
        const employee = employeeByAttendanceId.get(cleanText(row.employeeId));
        return {
          row,
          employeeName: employee ? getEmployeeName(employee) : cleanText(row.employeeId) || "Employee",
        };
      })
      .sort((left, right) => getAttendanceEventMillis(right.row) - getAttendanceEventMillis(left.row))
      .slice(0, 8);
  }, [attendanceToday, rosterSorted]);
  const recentAbsences = useMemo(() => absences.slice(0, 6), [absences]);

  useEffect(() => {
    if (!absenceForm.employeeKey && rosterSorted[0]) {
      setAbsenceForm((current) => ({
        ...current,
        employeeKey: getRosterAttendanceId(rosterSorted[0]),
      }));
    }
  }, [absenceForm.employeeKey, rosterSorted]);

  useEffect(() => {
    if (!payrollForm.employeeKey && rosterSorted[0]) {
      setPayrollForm((current) => ({
        ...current,
        employeeKey: getRosterAttendanceId(rosterSorted[0]),
      }));
    }
  }, [payrollForm.employeeKey, rosterSorted]);

  const handlePayrollEmployeeChange = (employeeKey: string) => {
    setPayrollForm((current) => ({
      ...current,
      employeeKey,
    }));
    setPayrollPreview(null);
    setPayrollMessage("");
  };

  const handleCreateAbsence = async () => {
    if (absenceSaving) return;
    const selectedEmployee = rosterSorted.find(
      (item) => getRosterAttendanceId(item) === cleanText(absenceForm.employeeKey)
    );
    if (!selectedEmployee) {
      setAbsenceMessage("Select an employee first.");
      return;
    }

    setAbsenceSaving(true);
    setAbsenceMessage("");
    try {
      await createEmployeeAbsenceRecord({
        employeeUid: getRosterEmployeeUid(selectedEmployee),
        employeeId: getRosterAttendanceId(selectedEmployee),
        employeeName: getEmployeeName(selectedEmployee),
        date: absenceForm.date,
        type: absenceForm.type || "full_day",
        note: absenceForm.note,
        createdByUid: session.uid,
        createdByName: session.displayName || session.email,
      });
      setAbsenceForm((current) => ({ ...current, note: "" }));
      setAbsenceMessage("Absence record saved.");
      await Promise.resolve(onRefresh());
    } catch (e) {
      setAbsenceMessage(cleanText((e as any)?.message || "Failed to save absence."));
    } finally {
      setAbsenceSaving(false);
    }
  };

  const handleCalculatePayrollPreview = async () => {
    if (payrollLoading) return;

    const selectedEmployee = rosterSorted.find(
      (item) => getRosterAttendanceId(item) === cleanText(payrollForm.employeeKey)
    );
    if (!selectedEmployee) {
      setPayrollMessage("Select an employee first.");
      return;
    }

    const payrollMonth = cleanText(payrollForm.payrollMonth);
    const match = /^(\d{4})-(\d{2})$/.exec(payrollMonth);
    if (!match) {
      setPayrollMessage("Select a valid payroll month.");
      return;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) {
      setPayrollMessage("Select a valid payroll month.");
      return;
    }

    const today = getTodayAttendanceDateKey();
    if (payrollMonth > today.slice(0, 7)) {
      setPayrollPreview(null);
      setPayrollMessage("This month is in the future. Payroll preview is not calculated.");
      return;
    }

    setPayrollLoading(true);
    setPayrollMessage("");

    try {
      const employeeId = getRosterAttendanceId(selectedEmployee);
      const entries = await generatePayrollEntriesForMonths({
        monthKeys: [payrollMonth],
        employeeId,
        currentEntries: [],
      });

      const entry = entries.find(
        (row) => cleanText(row.employeeId) === employeeId
      );

      if (!entry) {
        setPayrollPreview(null);
        setPayrollMessage("No canonical Core payroll preview is available for this employee.");
        return;
      }

      const bounds = payrollMonthBounds(year, month);
      const yesterday = new Date(
        Date.parse(`${today}T00:00:00Z`) - 86400000
      ).toISOString().slice(0, 10);
      const calculationEndDate =
        bounds.monthEnd < today ? bounds.monthEnd : yesterday;


      if (calculationEndDate < bounds.monthStart) {
        setPayrollPreview(null);
        setPayrollMessage("No completed payroll days are available for this month yet.");
        return;
      }

      const attendance = entry.attendanceSummary || {};









      setPayrollPreview({
        employeeName: entry.employeeName || getEmployeeName(selectedEmployee),
        payrollMonth: entry.payrollMonth,
        fromDate: bounds.monthStart,
        toDate: calculationEndDate,






        baseSalary: Number(entry.baseSalaryHalalas || 0) / 100,
        requiredWorkDays: Number(entry.workDays || 0),
        approvedLeaveDays: Number(attendance.approvedLeaveDays || 0),
        attendanceRecordedDays: Number(attendance.attendanceDays || 0),
        daysWithoutAttendance: Number(attendance.absentDays || 0),





        expectedWorkHours: Number(attendance.totalScheduledHours || 0),
        actualWorkedHours: Number(attendance.totalActualWorkedHours || 0),
        missingHours: Number(attendance.totalMissingHours || 0),
        overtimeHours: Number(entry.financialOvertimeHours || 0),




        absenceDeduction: Number(entry.absenceDeductionHalalas || 0) / 100,
        missingHoursDeduction:
          Number(entry.missingHoursDeductionHalalas || 0) / 100,
        finalSalary: Number(entry.finalSalaryHalalas || 0) / 100,




      });
    } catch (e) {
      setPayrollPreview(null);
      setPayrollMessage(




        cleanText((e as any)?.message || "Failed to calculate payroll preview.")
      );
    } finally {
      setPayrollLoading(false);
    }
  };




  const selectedStatus = selected ? getStatusMeta(selected) : null;
  const selectedName = selected ? getEmployeeName(selected) : "اختر موظفًا";
  const selectedEmail = selected ? getEmployeeEmail(selected) : "غير محدد";
  const selectedDepartment = selected ? getDepartment(selected) : "غير محدد";
  const selectedTitle = selected ? getJobTitle(selected) : "غير محدد";
  const selectedPhone = selected ? getPhone(selected) : "غير محدد";
  const selectedFingerprint = selected ? getFingerprint(selected) : "غير محدد";
  const selectedStartDate = selected ? getStartDate(selected) : "غير محدد";

  return (
    <div className="dashboard-v2 hr-overview-v2-scope" dir="rtl">
      <div className="dsv2-page hr-overview-v2">
        <section className="dsv2-card hr-overview-v2__hero">
          <div className="hr-overview-v2__hero-copy">
            <span className="dsv2-badge dsv2-badge--gold">الموارد البشرية</span>
            <h1 className="dsv2-page-title">ملخص الموارد البشرية</h1>
            <p className="dsv2-page-subtitle">
              متابعة الحضور والطلبات والملفات والغياب من نفس لغة لوحة التحكم الموحدة، مع إبقاء إدارة
              الموظفات والرواتب التفصيلية في مساحاتها المخصصة.
            </p>

            <div className="hr-overview-v2__hero-actions">
              <button className="dsv2-btn dsv2-btn--primary" type="button" onClick={() => onNavigate("/dashboard/employees")}>
                <FontAwesomeIcon icon={faUsers} />
                فتح إدارة الموظفات
              </button>
              <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={() => onNavigate("/dashboard/recruitment-applications")}>
                <FontAwesomeIcon icon={faUserTie} />
                طلبات التوظيف
              </button>
            </div>
          </div>

          <aside className="hr-overview-v2__identity">
            <span className="dsv2-badge">الحساب الحالي</span>
            <strong>{session.displayName || "مستخدم الموارد البشرية"}</strong>
            <span>{session.email || "غير محدد"}</span>
            <div className="hr-overview-v2__identity-badges">
              <span className="dsv2-badge dsv2-badge--gold">{readableRole(session.role)}</span>
              <span className="dsv2-badge">متابعة مباشرة</span>
            </div>
          </aside>
        </section>

        {loading ? (
          <section className="dsv2-card dsv2-card--padded hr-overview-v2__loading" role="status" aria-live="polite">
            <DashboardSkeletonV2 variant="title" width="42%" />
            <DashboardSkeletonV2 lines={3} />
          </section>
        ) : null}

        <section className="hr-overview-v2__metrics" aria-label="ملخص الموارد البشرية">
          <HrMetricCard label="إجمالي الموظفات" value={String(rosterSorted.length)} hint="إجمالي الملفات الوظيفية الحالية." />
          <HrMetricCard label="على رأس العمل" value={String(activeCount)} hint="الحسابات والملفات النشطة حاليًا." />
          <HrMetricCard label="في إجازة" value={String(leaveCount)} hint="الموظفات المسجلات في إجازة حالية." />
          <HrMetricCard label="حاضرون الآن" value={String(attendanceSummary.checkedIn)} hint="تم تسجيل حضورهم ولم يسجلوا الانصراف." />
          <HrMetricCard label="طلبات إجازة معلقة" value={String(pendingLeaveRequests)} hint="طلبات تحتاج مراجعة من الإدارة." />
          <HrMetricCard label="طلبات توظيف معلقة" value={String(pendingApplications)} hint="طلبات جديدة أو قيد المراجعة." />
        </section>

        <section className="hr-overview-v2__grid">
          <article className="dsv2-card dsv2-card--padded hr-overview-v2__card">
            <div className="hr-overview-v2__card-head">
              <div>
                <p className="hr-overview-v2__kicker">الحضور اليوم</p>
                <h2>الحالة التشغيلية الحالية</h2>
              </div>
              <span className="dsv2-badge">{attendanceDate}</span>
            </div>

            <div className="hr-overview-v2__mini-stats">
              <div className="hr-overview-v2__mini-stat"><span>حاضرون الآن</span><strong>{attendanceSummary.checkedIn}</strong></div>
              <div className="hr-overview-v2__mini-stat"><span>سجلوا الانصراف</span><strong>{attendanceSummary.checkedOut}</strong></div>
              <div className="hr-overview-v2__mini-stat"><span>لم يسجلوا</span><strong>{attendanceSummary.notStarted}</strong></div>
            </div>

            <div className="hr-overview-v2__toolbar">
              <strong>آخر سجلات اليوم</strong>
              <button className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" type="button" onClick={() => void onRefresh()} disabled={loading}>
                {loading ? "جارٍ التحديث..." : "تحديث"}
              </button>
            </div>

            {recentAttendanceRows.length ? (
              <div className="hr-overview-v2__list">
                {recentAttendanceRows.map(({ row, employeeName }) => (
                  <div key={`${row.employeeId}-${row.date}`} className="hr-overview-v2__list-item">
                    <div className="hr-overview-v2__list-item-head">
                      <strong>{employeeName}</strong>
                      <span className={`dsv2-badge ${dashboardBadgeToneClass(getAttendancePunchTone(row.status))}`}>
                        {getAttendancePunchLabel(row.status)}
                      </span>
                    </div>
                    <div className="hr-overview-v2__list-item-meta">
                      <span>الحضور: {formatAttendanceTime(row.checkInAtClient)}</span>
                      <span>الانصراف: {formatAttendanceTime(row.checkOutAtClient)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <DashboardEmptyStateV2
                compact
                className="hr-overview-v2__state"
                title="لا توجد سجلات حضور لهذا اليوم بعد"
                description="ستظهر السجلات هنا بعد تسجيل الحضور أو الانصراف."
              />
            )}
          </article>

          <article className="dsv2-card dsv2-card--padded hr-overview-v2__card">
            <div className="hr-overview-v2__card-head">
              <div>
                <p className="hr-overview-v2__kicker">إجراءات سريعة</p>
                <h2>انتقل مباشرة إلى المهمة المطلوبة</h2>
              </div>
            </div>
            <div className="hr-overview-v2__quick-actions">
              <button className="hr-overview-v2__action-card" type="button" onClick={() => onNavigate("/dashboard/employees")}>
                <FontAwesomeIcon icon={faUsers} />
                <strong>إدارة الموظفات</strong>
                <span>الملف الوظيفي والحضور والرواتب والإجازات والخدمات.</span>
              </button>
              <button className="hr-overview-v2__action-card" type="button" onClick={() => onNavigate("/dashboard/create-staff")}>
                <FontAwesomeIcon icon={faPlus} />
                <strong>إنشاء حساب</strong>
                <span>إنشاء حساب موظفة وربطه بالملف الوظيفي.</span>
              </button>
              <button className="hr-overview-v2__action-card" type="button" onClick={() => onNavigate("/dashboard/messages")}>
                <FontAwesomeIcon icon={faEnvelope} />
                <strong>الرسائل الداخلية</strong>
                <span>مراجعة الرسائل والتنبيهات الواردة من الموظفات.</span>
              </button>
              <button className="hr-overview-v2__action-card" type="button" onClick={() => onNavigate("/dashboard/files")}>
                <FontAwesomeIcon icon={faFileLines} />
                <strong>الملفات الداخلية</strong>
                <span>متابعة المرفقات والمستندات الإدارية.</span>
              </button>
            </div>
          </article>

          <article className="dsv2-card dsv2-card--padded hr-overview-v2__card">
            <div className="hr-overview-v2__card-head">
              <div>
                <p className="hr-overview-v2__kicker">طلبات الإجازة</p>
                <h2>أحدث الطلبات</h2>
              </div>
              <span className="dsv2-badge dsv2-badge--gold">{pendingLeaveRequests}</span>
            </div>
            {recentLeaveRequests.length ? (
              <div className="hr-overview-v2__list">
                {recentLeaveRequests.map((item) => {
                  const status = getLeaveStatusMeta(item.status);
                  return (
                    <div key={item.id} className="hr-overview-v2__list-item">
                      <div className="hr-overview-v2__list-item-head">
                        <strong>{getLeaveRequestEmployeeName(item)}</strong>
                        <span className={`dsv2-badge ${dashboardBadgeToneClass(getLeaveBadgeTone(item.status))}`}>{status.label}</span>
                      </div>
                      <div className="hr-overview-v2__list-item-meta">
                        <span>{getLeaveTypeLabel(item.type)}</span>
                        <span>{formatLeaveDateRange(item.fromDate, item.toDate)}</span>
                      </div>
                      {item.note ? <p>{item.note}</p> : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <DashboardEmptyStateV2 compact className="hr-overview-v2__state" title="لا توجد طلبات إجازة" description="الطلبات الجديدة ستظهر هنا." />
            )}
          </article>

          <article className="dsv2-card dsv2-card--padded hr-overview-v2__card">
            <div className="hr-overview-v2__card-head">
              <div>
                <p className="hr-overview-v2__kicker">التوظيف</p>
                <h2>حالة الطلبات</h2>
              </div>
              <span className="dsv2-badge">{applications.length}</span>
            </div>
            <div className="hr-overview-v2__mini-stats">
              <div className="hr-overview-v2__mini-stat"><span>إجمالي الطلبات</span><strong>{applications.length}</strong></div>
              <div className="hr-overview-v2__mini-stat"><span>بانتظار المراجعة</span><strong>{pendingApplications}</strong></div>
            </div>
            <p className="hr-overview-v2__copy">افتح صفحة التوظيف لمراجعة الطلبات وتحويل المقبول منها إلى حساب موظفة.</p>
            <div className="hr-overview-v2__actions">
              <button className="dsv2-btn dsv2-btn--primary" type="button" onClick={() => onNavigate("/dashboard/recruitment-applications")}>
                <FontAwesomeIcon icon={faChartLine} /> فتح الطلبات
              </button>
            </div>
          </article>

          <article className="dsv2-card dsv2-card--padded hr-overview-v2__card">
            <div className="hr-overview-v2__card-head">
              <div>
                <p className="hr-overview-v2__kicker">الملفات الداخلية</p>
                <h2>أحدث الملفات</h2>
              </div>
              <span className="dsv2-badge">{employeeFiles.length}</span>
            </div>
            {recentEmployeeFiles.length ? (
              <div className="hr-overview-v2__list">
                {recentEmployeeFiles.map((item) => (
                  <div key={item.id} className="hr-overview-v2__list-item">
                    <div className="hr-overview-v2__list-item-head">
                      <strong>{item.title}</strong>
                      <span className={`dsv2-badge ${dashboardBadgeToneClass(getEmployeeFileBadgeTone(item.status))}`}>
                        {getEmployeeFileStatusLabel(item.status, item.status !== "replaced")}
                      </span>
                    </div>
                    <div className="hr-overview-v2__list-item-meta">
                      <span>{getEmployeeFileTypeLabel(item.fileType)}</span>
                      <span>{item.fileName || "بدون اسم ملف"}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <DashboardEmptyStateV2 compact className="hr-overview-v2__state" title="لا توجد ملفات داخلية" description="المرفقات الجديدة ستظهر هنا." />
            )}
          </article>
        </section>

        <section className="hr-overview-v2__operations">
          <article className="dsv2-card dsv2-card--padded hr-overview-v2__card">
            <div className="hr-overview-v2__card-head">
              <div>
                <p className="hr-overview-v2__kicker">الغياب اليدوي</p>
                <h2>تسجيل غياب أو نصف يوم</h2>
              </div>
              <span className="dsv2-badge">{absences.length}</span>
            </div>

            <div className="hr-overview-v2__form-grid">
              <DashboardFieldV2 id="hr-overview-absence-employee" label="الموظفة" className="hr-overview-v2__field--wide">
                <DashboardSelectV2
                  id="hr-overview-absence-employee"
                  value={absenceForm.employeeKey}
                  options={employeeSelectOptions}
                  placeholder="اختر الموظفة"
                  disabled={absenceSaving || loading || !employeeSelectOptions.length}
                  onChange={(value) => setAbsenceForm((current) => ({ ...current, employeeKey: value }))}
                />
              </DashboardFieldV2>

              <DashboardFieldV2 id="hr-overview-absence-date" label="التاريخ">
                <DashboardDatePickerV2
                  id="hr-overview-absence-date"
                  value={absenceForm.date}
                  clearable={false}
                  disabled={absenceSaving}
                  onChange={(value) => setAbsenceForm((current) => ({ ...current, date: value }))}
                />
              </DashboardFieldV2>

              <DashboardFieldV2 id="hr-overview-absence-type" label="النوع">
                <DashboardSelectV2
                  id="hr-overview-absence-type"
                  value={absenceForm.type}
                  options={[
                    { value: "full_day", label: "يوم كامل" },
                    { value: "half_day", label: "نصف يوم" },
                  ]}
                  disabled={absenceSaving}
                  onChange={(value) => setAbsenceForm((current) => ({ ...current, type: value as EmployeeAbsence["type"] }))}
                />
              </DashboardFieldV2>

              <DashboardFieldV2 id="hr-overview-absence-note" label="السبب أو الملاحظة" className="hr-overview-v2__field--wide">
                <textarea
                  id="hr-overview-absence-note"
                  className="dsv2-textarea"
                  rows={3}
                  value={absenceForm.note}
                  onChange={(event) => setAbsenceForm((current) => ({ ...current, note: event.target.value }))}
                  placeholder="ملاحظة اختيارية"
                  disabled={absenceSaving}
                />
              </DashboardFieldV2>
            </div>

            {absenceMessage ? <div className="hr-overview-v2__alert">{absenceMessage}</div> : null}
            <div className="hr-overview-v2__actions">
              <button className="dsv2-btn dsv2-btn--primary" type="button" onClick={() => void handleCreateAbsence()} disabled={absenceSaving || loading || !rosterSorted.length}>
                {absenceSaving ? "جارٍ الحفظ..." : "حفظ الغياب"}
              </button>
              <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={() => onNavigate("/dashboard/employees")}>فتح سجل الموظفة</button>
            </div>

            {recentAbsences.length ? (
              <div className="hr-overview-v2__list">
                {recentAbsences.map((item) => (
                  <div key={item.id} className="hr-overview-v2__list-item">
                    <div className="hr-overview-v2__list-item-head">
                      <strong>{item.employeeName || item.employeeId || item.employeeUid || "موظفة غير محددة"}</strong>
                      <span className="dsv2-badge dsv2-badge--gold">{getEmployeeAbsenceTypeLabel(item.type)}</span>
                    </div>
                    <div className="hr-overview-v2__list-item-meta">
                      <span>{formatEmployeeAbsenceDate(item.date)}</span>
                      {item.createdByName || item.createdByUid ? <span>{item.createdByName || item.createdByUid}</span> : null}
                    </div>
                    {item.note ? <p>{item.note}</p> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </article>

          <article className="dsv2-card dsv2-card--padded hr-overview-v2__card">
            <div className="hr-overview-v2__card-head">
              <div>
                <p className="hr-overview-v2__kicker">معاينة الراتب</p>
                <h2>حساب مبدئي دون إنشاء سجل</h2>
              </div>
              <span className="dsv2-badge">معاينة فقط</span>
            </div>

            <div className="hr-overview-v2__form-grid">
              <DashboardFieldV2 id="hr-overview-payroll-employee" label="الموظفة" className="hr-overview-v2__field--wide">
                <DashboardSelectV2
                  id="hr-overview-payroll-employee"
                  value={payrollForm.employeeKey}
                  options={employeeSelectOptions}
                  placeholder="اختر الموظفة"
                  disabled={payrollLoading || !employeeSelectOptions.length}
                  onChange={handlePayrollEmployeeChange}
                />
              </DashboardFieldV2>

              <DashboardFieldV2 id="hr-overview-payroll-month" label="الشهر">
                <input
                  id="hr-overview-payroll-month"
                  className="dsv2-input"
                  type="month"
                  value={payrollForm.payrollMonth}
                  disabled={payrollLoading}
                  onChange={(event) => {
                    setPayrollForm((current) => ({ ...current, payrollMonth: event.target.value }));
                    setPayrollPreview(null);
                    setPayrollMessage("");
                  }}
                />
              </DashboardFieldV2>
            </div>

            {payrollMessage ? <div className="hr-overview-v2__alert">{payrollMessage}</div> : null}
            <div className="hr-overview-v2__actions">
              <button className="dsv2-btn dsv2-btn--primary" type="button" onClick={() => void handleCalculatePayrollPreview()} disabled={payrollLoading || !rosterSorted.length}>
                {payrollLoading ? "جارٍ الحساب..." : "حساب المعاينة"}
              </button>
              <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={() => onNavigate("/dashboard/employees")}>إدارة الرواتب التفصيلية</button>
            </div>

            {payrollPreview ? (
              <div className="hr-overview-v2__audit">
                <p className="hr-overview-v2__copy">معاينة للموظفة {payrollPreview.employeeName} عن شهر {payrollPreview.payrollMonth}. لا يتم حفظ أي سجل راتب من هذه البطاقة.</p>
                <div className="hr-overview-v2__mini-stats hr-overview-v2__payroll-stats">
                  <div className="hr-overview-v2__mini-stat"><span>أيام الإجازة المعتمدة</span><strong>{payrollPreview.approvedLeaveDays}</strong></div>
                  <div className="hr-overview-v2__mini-stat"><span>فترة الحساب</span><strong>{payrollPreview.fromDate} - {payrollPreview.toDate}</strong></div>
                  <div className="hr-overview-v2__mini-stat"><span>أيام العمل</span><strong>{payrollPreview.requiredWorkDays}</strong></div>
                  <div className="hr-overview-v2__mini-stat"><span>أيام الحضور</span><strong>{payrollPreview.attendanceRecordedDays}</strong></div>
                  <div className="hr-overview-v2__mini-stat"><span>أيام بلا بصمة</span><strong>{payrollPreview.daysWithoutAttendance}</strong></div>
                  <div className="hr-overview-v2__mini-stat"><span>ساعات العمل المطلوبة</span><strong>{formatHours(payrollPreview.expectedWorkHours)}</strong></div>
                  <div className="hr-overview-v2__mini-stat"><span>الساعات الفعلية</span><strong>{formatHours(payrollPreview.actualWorkedHours)}</strong></div>
                  <div className="hr-overview-v2__mini-stat"><span>ساعات النقص</span><strong>{formatHours(payrollPreview.missingHours)}</strong></div>
                  <div className="hr-overview-v2__mini-stat"><span>الأوفر تايم</span><strong>{formatHours(payrollPreview.overtimeHours)}</strong></div>
                  <div className="hr-overview-v2__mini-stat"><span>خصم الغياب</span><strong>{formatMoney(payrollPreview.absenceDeduction)}</strong></div>
                  <div className="hr-overview-v2__mini-stat"><span>خصم نقص الساعات</span><strong>{formatMoney(payrollPreview.missingHoursDeduction)}</strong></div>
                  <div className="hr-overview-v2__mini-stat"><span>الراتب الأساسي</span><strong>{formatMoney(payrollPreview.baseSalary)}</strong></div>
                  <div className="hr-overview-v2__mini-stat is-total"><span>الصافي المبدئي</span><strong>{formatMoney(payrollPreview.finalSalary)}</strong></div>
                </div>
              </div>
            ) : (
              <DashboardEmptyStateV2 compact className="hr-overview-v2__state" title="لم يتم حساب المعاينة بعد" description="اختر الموظفة والشهر ثم اضغط حساب المعاينة." tone="gold" />
            )}
          </article>
        </section>
      </div>
    </div>
  );
}

type AdminHrDashboardProps = {
  embedded?: boolean;
};

export default function AdminHrDashboard({
  embedded = false,
}: AdminHrDashboardProps) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const session = useEmployeeSession();
  const navigate = useNavigate();
  const location = useLocation();
  const { hasPermission, hasAnyPermission, hasAllPermissions } = usePermissions();
  const [pendingPermissionCount, setPendingPermissionCount] = useState(0);
  const [requestNotifications, setRequestNotifications] = useState<CoreEmployeeRequestNotification[]>([]);
  const [requestNotificationCount, setRequestNotificationCount] = useState(0);
  const [requestNotificationsOpen, setRequestNotificationsOpen] = useState(false);
  const [requestNotificationsLoading, setRequestNotificationsLoading] = useState(false);

  useEffect(() => {
    let disposed = false;
    const refreshPermissionCount = async () => {
      try {
        const rows = await listEmployeeRequests({ type: "permission", limit: 100 });
        if (!disposed) {
          setPendingPermissionCount(
            rows.filter((item) => !["completed", "rejected", "cancelled"].includes(item.status)).length
          );
        }
      } catch {
        if (!disposed) setPendingPermissionCount(0);
      }
    };
    void refreshPermissionCount();
    const timer = window.setInterval(() => void refreshPermissionCount(), 30_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [session.uid]);

  const refreshRequestNotifications = useCallback(async () => {
    if (!session.uid || !hasPermission("employee_requests.view")) {
      setRequestNotifications([]);
      setRequestNotificationCount(0);
      return;
    }
    setRequestNotificationsLoading(true);
    try {
      const rows = await listEmployeeRequestNotifications(100);
      const unreadRows = rows.filter((item) => Number(item.is_read) !== 1);
      setRequestNotifications(unreadRows);
      setRequestNotificationCount(unreadRows.length);
    } catch {
      setRequestNotifications([]);
      setRequestNotificationCount(0);
    } finally {
      setRequestNotificationsLoading(false);
    }
  }, [hasPermission, session.uid]);

  useEffect(() => {
    void refreshRequestNotifications();
    const timer = window.setInterval(() => void refreshRequestNotifications(), 30_000);
    const handleNotificationsChanged = () => void refreshRequestNotifications();
    window.addEventListener("employee-request-notifications-changed", handleNotificationsChanged);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("employee-request-notifications-changed", handleNotificationsChanged);
    };
  }, [refreshRequestNotifications]);

  useEffect(() => {
    if (!requestNotificationsOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".hr-request-notification-shell") && !target?.closest(".hr-request-notification-popover")) {
        setRequestNotificationsOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRequestNotificationsOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [requestNotificationsOpen]);

  const openRequestNotification = useCallback(async (notification: CoreEmployeeRequestNotification) => {
    if (Number(notification.is_read) !== 1) {
      try {
        await markEmployeeRequestNotificationRead(notification.id);
        setRequestNotifications((current) =>
          current.filter((item) => item.id !== notification.id)
        );
        setRequestNotificationCount((count) => Math.max(0, count - 1));
        window.dispatchEvent(new CustomEvent("employee-request-notifications-changed"));
      } catch {
        // Navigation remains available even if the read state could not be synchronized.
      }
    }
    setRequestNotificationsOpen(false);
    if (notification.related_id) {
      navigate(`/dashboard/requests?request=${encodeURIComponent(notification.related_id)}`);
    } else {
      navigate("/dashboard/requests");
    }
  }, [navigate]);

  const markAllRequestNotificationsRead = useCallback(async () => {
    if (!requestNotificationCount) return;
    try {
      await markAllEmployeeRequestNotificationsRead();
      setRequestNotifications([]);
      setRequestNotificationCount(0);
      window.dispatchEvent(new CustomEvent("employee-request-notifications-changed"));
    } catch {
      // Keep the current badge when the server rejects the action.
    }
  }, [requestNotificationCount]);

  const adminNavItems = useMemo(
    () =>
      [
        { to: "/dashboard/hr", label: "نظرة عامة", icon: faHouse, permission: "employees.view" as AppPermission },
        { to: "/dashboard/requests", label: "طلبات الموظفات", icon: faClipboardList, badge: requestNotificationCount, permission: "employee_requests.view" as AppPermission },
        { to: "/dashboard/employees", label: "إدارة الموظفين", icon: faUsers, permission: "employees.view" as AppPermission },
        { to: "/dashboard/permissions", label: "الاستئذانات", icon: faClock, badge: pendingPermissionCount, permission: "employee_requests.view" as AppPermission },
        { to: "/dashboard/recruitment-applications", label: "طلبات التوظيف", icon: faUserTie, permission: "recruitment.view" as AppPermission },
        { to: "/dashboard/messages", label: "الرسائل الداخلية", icon: faEnvelope, permission: "messages.manage" as AppPermission },
        { to: "/dashboard/files", label: "الملفات الداخلية", icon: faFileLines, permission: "employees.files.view" as AppPermission },
        {
          to: "/dashboard/create-staff",
          label: "إنشاء حساب موظف",
          icon: faUserShield,
          permission: "admin_accounts.manage" as AppPermission,
          allOf: ["admin_accounts.manage", "employees.create"] as AppPermission[],
        },
      ].filter((item) =>
        item.allOf ? hasAllPermissions(item.allOf) : hasPermission(item.permission)
      ),
    [hasAllPermissions, hasPermission, pendingPermissionCount, requestNotificationCount]
  );
  const adminLandingPath = adminNavItems[0]?.to || "/employee/overview";
  const canOpenDashboard = hasPermission("workspace.dashboard.view");
  const canOpenHr = hasAnyPermission([
    "employees.view",
    "attendance.view",
    "attendance.leaves.manage",
    "recruitment.view",
    "messages.manage",
    "employees.files.view",
    "admin_accounts.view",
    "admin_accounts.manage",
    "employee_requests.view",
  ]);
  const adminSection = useMemo(() => {
    const section = location.pathname.replace(/^\/dashboard\/?/, "").split("/")[0];
    return section || "overview";
  }, [location.pathname]);
  const isOverviewRoute = adminSection === "hr";
  const isEmployeesRoute = adminSection === "employees";
  const isFilesRoute = adminSection === "files";
  const isRequestsRoute = adminSection === "requests";
  const isPermissionsRoute = adminSection === "permissions";
  const isCompactWorkspaceRoute =
    isEmployeesRoute || isFilesRoute || isPermissionsRoute || isRequestsRoute;
  const compactWorkspaceTitle = isEmployeesRoute
    ? "إدارة الموظفات"
    : isFilesRoute
      ? "ملفات الموظفات"
      : isRequestsRoute
        ? "طلبات الموظفات"
        : "إدارة الاستئذانات";
  const compactWorkspaceLoadingText = isEmployeesRoute
    ? "جاري فتح إدارة الموظفات..."
    : isFilesRoute
      ? "جاري فتح ملفات الموظفات..."
      : isRequestsRoute
        ? "جاري فتح مركز الطلبات..."
        : "جاري فتح إدارة الاستئذانات...";
  const compactWorkspaceLoadingHint = isEmployeesRoute
    ? "يتم تجهيز الصلاحيات والجلسة داخل نفس إطار صفحة الموظفات."
    : isFilesRoute
      ? "يتم تجهيز ملفات الموظفات والمرفقات دون توسيع مساحة الصفحة."
      : isRequestsRoute
        ? "يتم تجهيز دورة الاستلام والمراجعة والتنفيذ من Core D1."
        : "يتم تجهيز طلبات الاستئذان المعتمدة دون توسيع مساحة الصفحة.";
  const isEmployeeProfileRoute = /^\/dashboard\/employees\/[^/]+/.test(location.pathname);
  const routeMeta = useMemo(() => {
    const meta: Record<string, { kicker: string; title: string; subtitle: string }> = {
      hr: {
        kicker: "الموارد البشرية",
        title: "نظرة عامة على الموارد البشرية",
        subtitle: "ملخص تشغيلي سريع للحضور والطلبات والملفات، بينما تتم إدارة الموظفات من الصفحة المخصصة.",
      },
      employees: {
        kicker: "الموارد البشرية",
        title: "إدارة الموظفات",
        subtitle: "ملفات الموظفات والدوام والرواتب والصلاحيات من مساحة موحدة.",
      },
      requests: {
        kicker: "الخدمة الذاتية",
        title: "مركز طلبات الموظفات",
        subtitle: "استلام ومراجعة واعتماد وتنفيذ الطلبات مع سجل زمني كامل.",
      },
      permissions: {
        kicker: "الحضور والاستئذان",
        title: "إدارة الاستئذانات",
        subtitle: "مراجعة طلبات الموظفات وتسجيل الخروج والعودة مباشرة من الإدارة.",
      },
      "recruitment-applications": {
        kicker: "التوظيف",
        title: "طلبات التوظيف",
        subtitle: "مراجعة الطلبات وفرزها ومتابعة حالتها من مساحة مستقلة وواضحة.",
      },
      messages: {
        kicker: "التواصل الداخلي",
        title: "الرسائل الداخلية",
        subtitle: "متابعة المحادثات الإدارية ورسائل الموظفات دون تحميل بيانات لوحة الموارد البشرية كاملة.",
      },
      files: {
        kicker: "الملفات الداخلية",
        title: "ملفات الموظفات",
        subtitle: "إدارة الملفات والمرفقات الإدارية في صفحة مستقلة عن بيانات الموظفات التشغيلية.",
      },
      "create-staff": {
        kicker: "الحسابات",
        title: "إنشاء حساب موظفة",
        subtitle: "إنشاء وربط حساب الموظفة مع الحفاظ على الأدوار والصلاحيات الحالية.",
      },
    };
    return meta[adminSection] || meta.overview;
  }, [adminSection]);
  const [loggingOut, setLoggingOut] = useState(false);
  const [roster, setRoster] = useState<DirectoryEmployee[]>([]);
  const [applications, setApplications] = useState<RecruitmentApplication[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<EmployeeLeaveRequest[]>([]);
  const [operationalLeaves, setOperationalLeaves] = useState<CoreLeave[]>([]);
  const [employeeFiles, setEmployeeFiles] = useState<CoreEmployeeFile[]>([]);
  const [attendanceToday, setAttendanceToday] = useState<StaffAttendanceToday[]>([]);
  const [absences, setAbsences] = useState<EmployeeAbsence[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState("");
  const loadRequestRef = useRef(0);
  const overviewLoadedRef = useRef(false);

  const loadData = useCallback(async (force = false) => {
    if (!force && overviewLoadedRef.current) return;
    const requestId = ++loadRequestRef.current;
    setLoadingData(true);
    setError("");
    try {
      const [rosterRows, applicationRows, leaveRows, operationalLeaveRows, fileRows, absenceRows] = await Promise.all([
        hasPermission("employees.view") ? listEmployeeDirectory() : Promise.resolve([]),
        hasPermission("recruitment.view") ? listRecruitmentApplications() : Promise.resolve([]),
        hasPermission("attendance.leaves.manage") ? listEmployeeLeaveRequests() : Promise.resolve([]),
        hasPermission("attendance.leaves.manage")
          ? CoreHrService.listLeaves({ status: "approved" })
          : Promise.resolve([] as CoreLeave[]),
        hasPermission("employees.files.view") ? listCoreEmployeeFiles(40) : Promise.resolve([]),
        hasPermission("attendance.absences.manage") ? listEmployeeAbsences(80) : Promise.resolve([]),
      ]);
      const attendanceEmployees = (
        Array.isArray(rosterRows)
          ? rosterRows
          : []
      )
        .map((item) => ({
          employeeId: getRosterAttendanceId(
            item as DirectoryEmployee
          ),
          employeeUid: getRosterEmployeeUid(
            item as DirectoryEmployee
          ),
        }))
        .filter((item) => item.employeeId);

      const attendanceRows = hasPermission("attendance.view")
        ? await listAttendanceForEmployeesDateFromWorker({
            employees: attendanceEmployees,
            date: getTodayAttendanceDateKey(),
          })
        : [];
      if (requestId !== loadRequestRef.current) return;
      setRoster(Array.isArray(rosterRows) ? rosterRows : []);
      setApplications(Array.isArray(applicationRows) ? applicationRows : []);
      setLeaveRequests(Array.isArray(leaveRows) ? leaveRows : []);
      setOperationalLeaves(Array.isArray(operationalLeaveRows) ? operationalLeaveRows : []);
      setEmployeeFiles(Array.isArray(fileRows) ? fileRows : []);
      setAttendanceToday(Array.isArray(attendanceRows) ? attendanceRows : []);
      setAbsences(Array.isArray(absenceRows) ? absenceRows : []);
      overviewLoadedRef.current = true;
    } catch (e) {
      if (requestId !== loadRequestRef.current) return;
      setError(cleanText((e as any)?.message || "تعذر تحميل لوحة الموارد البشرية."));
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoadingData(false);
      }
    }
  }, [hasPermission]);

  useEffect(() => {
    if (!isOverviewRoute) {
      loadRequestRef.current += 1;
      setLoadingData(false);
      return;
    }
    void loadData();
    return () => {
      loadRequestRef.current += 1;
    };
  }, [isOverviewRoute, loadData]);

  const renderRequestNotificationButton = () => {
    if (!hasPermission("employee_requests.view")) return null;
    return (
      <div className="hr-request-notification-shell">
        <button
          type="button"
          className={`hr-request-notification-button ${requestNotificationsOpen ? "is-open" : ""}`}
          onClick={() => {
            setRequestNotificationsOpen((value) => !value);
            if (!requestNotificationsOpen) void refreshRequestNotifications();
          }}
          aria-label={`تنبيهات طلبات الموظفات${requestNotificationCount ? `، ${requestNotificationCount} غير مقروء` : ""}`}
          aria-expanded={requestNotificationsOpen}
          title="تنبيهات طلبات الموظفات"
        >
          <FontAwesomeIcon icon={faBell} />
          {requestNotificationCount > 0 ? (
            <span>{requestNotificationCount > 99 ? "99+" : requestNotificationCount}</span>
          ) : null}
        </button>
      </div>
    );
  };

  const renderRequestNotificationPopover = () => {
    if (!requestNotificationsOpen || !hasPermission("employee_requests.view") || typeof document === "undefined") return null;
    return createPortal(
      <section className="hr-request-notification-popover" aria-label="تنبيهات طلبات الموظفات">
        <header>
          <div>
            <small>التنبيهات</small>
            <strong>طلبات الموظفات</strong>
          </div>
          {requestNotificationCount > 0 ? (
            <button type="button" onClick={() => void markAllRequestNotificationsRead()}>
              تعليم الكل كمقروء
            </button>
          ) : null}
        </header>
        <div className="hr-request-notification-popover__list">
          {requestNotificationsLoading ? (
            <p>جاري تحديث التنبيهات...</p>
          ) : requestNotifications.length ? (
            requestNotifications.slice(0, 12).map((item) => (
              <button
                type="button"
                key={item.id}
                className={Number(item.is_read) === 1 ? "is-read" : "is-unread"}
                onClick={() => void openRequestNotification(item)}
              >
                <span className="hr-request-notification-popover__dot" />
                <span>
                  <strong>{item.title}</strong>
                  {item.body ? <small>{item.body}</small> : null}
                  <time>{formatRequestNotificationTime(item.created_at)}</time>
                </span>
              </button>
            ))
          ) : (
            <p>لا توجد تنبيهات جديدة.</p>
          )}
        </div>
        <footer>
          <button type="button" onClick={() => { setRequestNotificationsOpen(false); navigate("/dashboard/requests"); }}>
            فتح مركز الطلبات
          </button>
        </footer>
      </section>,
      document.body
    );
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logoutFirebase();
    } finally {
      navigate("/hr", { replace: true });
      setLoggingOut(false);
    }
  };

  if (session.loading && embedded) {
    return (
      <div className="hr-embedded-loading" dir="rtl">
        <span className="hr-workspace-loading__spinner" />
        <strong>جاري تحميل الموارد البشرية...</strong>
      </div>
    );
  }

  if (session.loading) {
    return (
      <div className={`hr-shell madan-admin-shell malikat-portal-shell-v2 ${isEmployeesRoute ? "dashboard-v2 hr-shell--employees " : ""}${isCompactWorkspaceRoute ? "hr-shell--compact-workspace" : ""}`} dir="rtl">
        <MalikatPortalSidebarV2
          variant="admin"
          logoSrc={logo1}
          collapsed={false}
          onToggleCollapsed={() => undefined}
          loading
          className="hr-shell-sidebar--loading"
          ariaLabel="جاري تحميل تنقل الموارد البشرية"
          navigation={<nav className="hr-shell-nav" aria-hidden="true" />}
        />

        <main className={`hr-shell-main ${isCompactWorkspaceRoute ? "hr-shell-main--workspace" : ""}`}>
          <DashboardHeader
            theme="admin"
            title={isCompactWorkspaceRoute ? routeMeta.title : "جاري تحميل لوحة الموارد البشرية..."}
            subtitle="Queens Salon"
            className="hr-shell-header hr-shell-header--unified"
            showProfileButton={false}
          />

          {isCompactWorkspaceRoute ? (
            <section className="hr-stage hr-stage--workspace">
              <div className="hr-workspace-loading" role="status" aria-live="polite">
                <span className="hr-workspace-loading__spinner" />
                <div>
                  <strong>{compactWorkspaceLoadingText}</strong>
                  <small>{compactWorkspaceLoadingHint}</small>
                </div>
              </div>
            </section>
          ) : (
            <div className="hr-loading-panel">
              <div className="hr-loading-card" />
              <div className="hr-loading-card" />
            </div>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className={`hr-shell madan-admin-shell malikat-portal-shell-v2 ${isEmployeesRoute ? "dashboard-v2 hr-shell--employees " : ""}${isCompactWorkspaceRoute ? "hr-shell--compact-workspace" : ""}${isSidebarCollapsed ? " is-sidebar-collapsed" : ""}${embedded ? " hr-shell--embedded" : ""}`} dir="rtl">
      <DashboardSidebarTooltipV2 enabled={!embedded && isSidebarCollapsed} />
      <MalikatPortalSidebarV2
        variant="admin"
        logoSrc={logo1}
        collapsed={isSidebarCollapsed}
        onToggleCollapsed={() => setIsSidebarCollapsed((value) => !value)}
        className={embedded ? "hr-embedded-hidden" : undefined}
        ariaLabel="التنقل داخل الموارد البشرية"
        profileTooltip={`${session.displayName || "مسجل الدخول"} — ${readableRole(session.role)}`}
        profile={
          <div className="malikat-sidebar-identity">
            <span className="malikat-sidebar-identity__avatar" aria-hidden="true">
              <FontAwesomeIcon icon={faUserShield} />
            </span>
            <div className="malikat-sidebar-identity__copy">
              <strong>{session.displayName || "مسجل الدخول"}</strong>
              <span>{readableRole(session.role)}</span>
              {session.email ? <small>{session.email}</small> : null}
            </div>
          </div>
        }
        navigation={
          <nav className="hr-shell-nav" aria-label="HR navigation">
            <span className="hr-sidebar-section-title">الموارد البشرية</span>
            {adminNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `hr-shell-link ${isActive ? "is-active" : ""}`}
                data-sidebar-tooltip={item.label}
              >
                <FontAwesomeIcon icon={item.icon} />
                <span>{item.label}</span>
                {"badge" in item && Number(item.badge || 0) > 0 ? (
                  <em className="hr-shell-link__badge">{item.badge}</em>
                ) : null}
              </NavLink>
            ))}
          </nav>
        }
      />

      <DashboardHeader
        theme="admin"
        title={isCompactWorkspaceRoute ? compactWorkspaceTitle : routeMeta.title}
        subtitle="Queens Salon"
        className={`hr-mobile-appbar dashboard-header--mobile-shell${embedded ? " hr-embedded-hidden" : ""}`}
        actions={
          <>
            {renderRequestNotificationButton()}
            <InternalPortalSwitcher
              canOpenDashboard={canOpenDashboard}
              canOpenHr={canOpenHr}
              loggingOut={loggingOut}
              onLogout={handleLogout}
              className="hr-mobile-appbar__actions"
            />
          </>
        }
      />
      <main className={`hr-shell-main ${isCompactWorkspaceRoute ? "hr-shell-main--workspace" : ""}${embedded ? " hr-shell-main--embedded" : ""}`}>
        {!embedded && !isEmployeeProfileRoute ? <DashboardHeader
          theme="admin"
          title={routeMeta.title}
          subtitle="Queens Salon"
          className="hr-shell-header hr-shell-header--unified"
          actions={
            <>
            {renderRequestNotificationButton()}
            <InternalPortalSwitcher
              canOpenDashboard={canOpenDashboard}
              canOpenHr={canOpenHr}
              loggingOut={loggingOut}
              onLogout={handleLogout}
            />

            {isOverviewRoute ? (
              <button
                className="hr-refresh"
                type="button"
                onClick={() => void loadData(true)}
                disabled={loadingData}
              >
                {loadingData ? "جارٍ التحديث..." : "تحديث الملخص"}
              </button>
            ) : null}
            </>
          }
        /> : null}

        {isOverviewRoute && error ? <div className="hr-alert">{error}</div> : null}

        <section className={`hr-stage ${isCompactWorkspaceRoute ? "hr-stage--workspace" : ""}`}>
          <Routes>
            <Route index element={<Navigate to={adminLandingPath} replace />} />
            <Route
              path="hr"
              element={
                <PermissionRoute permission="employees.view">
                  <HrOverview
                    roster={roster}
                    applications={applications}
                    leaveRequests={leaveRequests}
                    operationalLeaves={operationalLeaves}
                    employeeFiles={employeeFiles}
                    attendanceToday={attendanceToday}
                    absences={absences}
                    loading={loadingData}
                    onNavigate={(path) => navigate(path)}
                    onRefresh={() => void loadData(true)}
                    session={session}
                  />
                </PermissionRoute>
              }
            />
            <Route
              path="requests"
              element={
                <PermissionRoute permission="employee_requests.view">
                  <AdminEmployeeRequestsPage session={session} />
                </PermissionRoute>
              }
            />
            <Route
              path="permissions"
              element={
                <PermissionRoute permission="employee_requests.view">
                  <AdminEmployeeRequestsPage session={session} initialType="permission" />
                </PermissionRoute>
              }
            />
            <Route
              path="recruitment-applications"
              element={<PermissionRoute permission="recruitment.view"><RecruitmentApplicationsPage session={session} /></PermissionRoute>}
            />
            <Route
              path="employees/*"
              element={
                <PermissionRoute permission="employees.view">
                  <Suspense
                    fallback={
                      <div className="hr-workspace-loading" role="status" aria-live="polite">
                        <span className="hr-workspace-loading__spinner" />
                        <strong>جاري فتح إدارة الموظفات...</strong>
                        <small>يتم تحميل مساحة الموظفات فقط دون إعادة تحميل ملخص الموارد البشرية.</small>
                      </div>
                    }
                  >
                    <DashboardEmployees />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route path="messages" element={<PermissionRoute permission="messages.manage"><EmployeeMessagesPage session={session} /></PermissionRoute>} />
            <Route path="files" element={<PermissionRoute permission="employees.files.view"><EmployeeFilesPage session={session} /></PermissionRoute>} />
            <Route path="users" element={<Navigate to="/dashboard/settings/users" replace />} />
            <Route
              path="create-staff"
              element={
                <PermissionRoute allOf={["admin_accounts.manage", "employees.create"]}>
                  <CreateStaffAccountPage session={session} />
                </PermissionRoute>
              }
            />
            <Route path="*" element={<Navigate to={adminLandingPath} replace />} />
          </Routes>
        </section>
      </main>
      <nav className={`hr-mobile-bottom-nav${embedded ? " hr-embedded-hidden" : ""}`} aria-label="تنقل الموارد البشرية">
        {adminNavItems.slice(0, 5).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `hr-mobile-bottom-nav__item ${isActive ? "is-active" : ""}`
            }
          >
            <FontAwesomeIcon icon={item.icon} />
            <span>{item.label.replace("إدارة ", "").replace(" الداخلية", "")}</span>
            {"badge" in item && Number(item.badge || 0) > 0 ? (
              <em className="hr-mobile-bottom-nav__badge">{item.badge}</em>
            ) : null}
          </NavLink>
        ))}
      </nav>
      {renderRequestNotificationPopover()}
    </div>
  );
}
