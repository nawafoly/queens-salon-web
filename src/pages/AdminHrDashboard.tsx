import "../styles/AdminHrMobileShell.css";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRight,
  faChartLine,
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
import InternalPortalSwitcher from "../components/InternalPortalSwitcher";
import PermissionRoute from "../components/PermissionRoute";
import { usePermissions } from "../security/PermissionContext";
import type { AppPermission } from "../helpers/permissions";
import { logoutFirebase } from "../services/authService";
import RecruitmentApplicationsPage from "./hr/RecruitmentApplications";
import CreateStaffAccountPage from "./hr/CreateStaffAccount";
import EmployeeMessagesPage from "./hr/EmployeeMessages";
import EmployeeFilesPage from "./hr/EmployeeFiles";
import { listEmployeeDirectory } from "../services/employeeDirectory";
import {
  createEmployeeAbsenceRecord,
  listEmployeeAbsences,
  listEmployeeAbsencesByEmployee,
  listEmployeeFiles,
  listEmployeeLeaveRequests,
  listRecruitmentApplications,
  type EmployeeAbsence,
  type EmployeeFile,
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
import {
  listAttendanceByDateRangeForEmployeeFromWorker,
  listAttendanceForEmployeesDateFromWorker,
} from "../services/attendanceWorkerService";
import {
  getShiftExpectedHours,
  getAttendanceDayStatus,
  summarizeAttendanceForPayroll,
  type AttendanceRecord,
} from "../helpers/hr/attendanceCalculations";
import {
  buildDateKeysInRange,
  buildWorkDateKeysInRange,
} from "../helpers/hr/workSchedule";
import {
  buildEmployeePayrollMonthInput,
  computeEmployeePayroll,
  parseEmployeePayrollMonth,
  type EmployeePayrollComputation,
} from "../helpers/hr/employeePayroll";

const DashboardEmployees = lazy(() => import("./DashboardEmployees"));

type DirectoryEmployee = Record<string, any> & { id?: string };
type StatusTone = "success" | "warning" | "neutral" | "muted";
type PayrollPreviewState = {
  employeeName: string;
  payrollMonth: string;
  fromDate: string;
  toDate: string;
  isCurrentMonthPartial: boolean;
  baseSalary: number;
  requiredWorkDays: number;
  excludedWeeklyOffDays: number;
  manualAbsenceDays: number;
  attendanceRecordedDays: number;
  daysWithoutAttendance: number;
  expectedWorkHours: number;
  actualWorkedHours: number;
  missingHours: number;
  overtimeHours: number;
  hourlyRate: number;
  absenceDays: number;
  absenceDeduction: number;
  missingHoursDeduction: number;
  extraDeductions: number;
  grossSalary: number;
  finalSalary: number;
  computation: EmployeePayrollComputation;
};

type HrOverviewProps = {
  roster: DirectoryEmployee[];
  applications: RecruitmentApplication[];
  leaveRequests: EmployeeLeaveRequest[];
  employeeFiles: EmployeeFile[];
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

function getEmployeeFileBadgeTone(status: EmployeeFile["status"]): StatusTone {
  const normalized = normalizeText(status || "active");
  if (normalized === "active" || normalized === "read") return "success";
  if (normalized === "replaced" || normalized === "archived") return "muted";
  return "neutral";
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
  const docCandidates = uniqueCleanTexts([
    item.employeeDocId,
    item.linkedEmployeeDocId,
    item.employeeId,
    item.id,
    item.employeeUid,
    item.linkedUid,
    item.authUid,
    item.uid,
    item.linkedUserId,
    item.employeeKey,
  ]);
  const fullUid = uidCandidates.find(isFullAttendanceIdentifier) || "";
  const fullDocId = docCandidates.find(isFullAttendanceIdentifier) || "";
  const employeeUid =
    fullUid || fullDocId || uidCandidates[0] || docCandidates[0] || "";
  const employeeId =
    fullDocId || fullUid || docCandidates[0] || employeeUid;

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

function getEmployeeBaseSalary(item: DirectoryEmployee | null) {
  if (!item) return 0;
  const payroll = item.payroll || item.payrollConfig || item.salaryConfig || {};
  const value =
    item.baseSalary ??
    item.monthlySalary ??
    item.salary ??
    item.basicSalary ??
    payroll.baseSalary ??
    payroll.monthlySalary ??
    payroll.salary;
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function getEmployeeSchedule(item: DirectoryEmployee | null) {
  const payroll = item?.payroll || item?.payrollConfig || {};
  return {
    startTime: cleanText(item?.startTime || item?.workStartTime || item?.shiftStartTime || payroll.startTime || "09:00"),
    endTime: cleanText(item?.endTime || item?.workEndTime || item?.shiftEndTime || payroll.endTime || "17:00"),
    weeklyOffDays: item?.weeklyOffDays || item?.offDays || payroll.weeklyOffDays || null,
  };
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
    <article className="hr-metric-card">
      <span className="hr-metric-card__label">{label}</span>
      <strong className="hr-metric-card__value">{value}</strong>
      <p className="hr-metric-card__hint">{hint}</p>
    </article>
  );
}

function HrOverview({
  roster,
  applications,
  leaveRequests,
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
    payrollMonth: buildEmployeePayrollMonthInput(),
    baseSalary: "0",
  });
  const [payrollPreview, setPayrollPreview] = useState<PayrollPreviewState | null>(null);
  const [payrollLoading, setPayrollLoading] = useState(false);
  const [payrollMessage, setPayrollMessage] = useState("");

  const rosterSorted = useMemo(() => {
    const uniqueRoster = new Map<string, DirectoryEmployee>();

    for (const item of roster) {
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
  }, [roster]);

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
  const leaveCount = useMemo(
    () => rosterSorted.filter((item) => getStatusMeta(item).onLeave).length,
    [rosterSorted]
  );
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
      const employeeKey = getRosterAttendanceId(rosterSorted[0]);
      setPayrollForm((current) => ({
        ...current,
        employeeKey,
        baseSalary: String(getEmployeeBaseSalary(rosterSorted[0])),
      }));
    }
  }, [payrollForm.employeeKey, rosterSorted]);

  const handlePayrollEmployeeChange = (employeeKey: string) => {
    const employee = rosterSorted.find((item) => getRosterAttendanceId(item) === cleanText(employeeKey)) || null;
    setPayrollForm((current) => ({
      ...current,
      employeeKey,
      baseSalary: String(getEmployeeBaseSalary(employee)),
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

    const parsedMonth = parseEmployeePayrollMonth(payrollForm.payrollMonth);
    if (!parsedMonth) {
      setPayrollMessage("Select a valid payroll month.");
      return;
    }

    const today = getTodayAttendanceDateKey();
    if (parsedMonth.monthStart > today) {
      setPayrollPreview(null);
      setPayrollMessage("This month is in the future. Payroll preview is not calculated.");
      return;
    }

    const calculationEndDate = parsedMonth.monthEnd > today ? today : parsedMonth.monthEnd;
    if (calculationEndDate < parsedMonth.monthStart) {
      setPayrollPreview(null);
      setPayrollMessage("No payroll days are available for this month yet.");
      return;
    }

    setPayrollLoading(true);
    setPayrollMessage("");
    try {
      const employeeId = getRosterAttendanceId(selectedEmployee);
      const employeeUid = getRosterEmployeeUid(selectedEmployee);
      const schedule = getEmployeeSchedule(selectedEmployee);
      const workDateKeys = buildWorkDateKeysInRange({
        fromDate: parsedMonth.monthStart,
        toDate: calculationEndDate,
        weeklyOffDays: schedule.weeklyOffDays,
      });
      const calculationDateKeys = buildDateKeysInRange(parsedMonth.monthStart, calculationEndDate);

      const [attendanceRows, absenceRows] = await Promise.all([
        listAttendanceByDateRangeForEmployeeFromWorker({
          employeeUid,
          employeeId,
          fromDate: parsedMonth.monthStart,
          toDate: calculationEndDate,
        }),
        listEmployeeAbsencesByEmployee({
          employeeId,
          employeeUid,
          fromDate: parsedMonth.monthStart,
          toDate: calculationEndDate,
        }),
      ]);

      const attendanceRecords: AttendanceRecord[] = [];
      const attendanceDateKeys = new Set<string>();
      attendanceRows.forEach((row) => {
        if (row.checkInAtClient) {
          attendanceRecords.push({
            id: `${row.id}-in`,
            type: "check_in",
            serverTime: row.checkInAtClient,
          });
          attendanceDateKeys.add(row.date);
        }
        if (row.checkOutAtClient) {
          attendanceRecords.push({
            id: `${row.id}-out`,
            type: "check_out",
            serverTime: row.checkOutAtClient,
          });
          attendanceDateKeys.add(row.date);
        }
      });

      const attendanceSummary = summarizeAttendanceForPayroll(attendanceRecords, schedule, {
        workDateKeys,
        todayDateKey: today,
      });
      const expectedWorkHours = workDateKeys.length * getShiftExpectedHours(schedule);
      const actualWorkedHours = attendanceSummary.actualHours;
      const computation = computeEmployeePayroll({
        baseSalary: Number(payrollForm.baseSalary || 0),
        expectedWorkDays: workDateKeys.length,
        expectedWorkHours,
        attendanceExpectedHours: expectedWorkHours,
        actualWorkedHours,
        attendanceOvertimeHours: attendanceSummary.overtimeHours,
        absences: absenceRows,
      });

      setPayrollPreview({
        employeeName: getEmployeeName(selectedEmployee),
        payrollMonth: parsedMonth.payrollMonth,
        fromDate: parsedMonth.monthStart,
        toDate: calculationEndDate,
        isCurrentMonthPartial: parsedMonth.monthStart <= today && parsedMonth.monthEnd > today,
        baseSalary: computation.baseSalary,
        requiredWorkDays: workDateKeys.length,
        excludedWeeklyOffDays: Math.max(0, calculationDateKeys.length - workDateKeys.length),
        manualAbsenceDays: computation.absenceDays,
        attendanceRecordedDays: attendanceDateKeys.size,
        daysWithoutAttendance: Math.max(0, workDateKeys.length - attendanceDateKeys.size),
        expectedWorkHours,
        actualWorkedHours,
        missingHours: computation.missingHours,
        overtimeHours: computation.overtimeHours,
        hourlyRate: computation.hourlyRate,
        absenceDays: computation.absenceDays,
        absenceDeduction: computation.absenceDeduction,
        missingHoursDeduction: computation.delayDeduction,
        extraDeductions: computation.totalSalaryDeductions + computation.insuranceDeduction,
        grossSalary: computation.grossSalary,
        finalSalary: computation.finalSalary,
        computation,
      });
    } catch (e) {
      setPayrollPreview(null);
      setPayrollMessage(cleanText((e as any)?.message || "Failed to calculate payroll preview."));
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
    <div className="hr-overview madan-hr-overview-v3">
      <section className="hr-hero hr-overview-hero">
        <div className="hr-hero__copy">
          <span className="hr-hero__eyebrow">مركز الموارد البشرية</span>
          <h2>ملخص الموارد البشرية</h2>
          <p>
            هذه الصفحة للمتابعة السريعة فقط: الحضور، الطلبات، الملفات والغياب. إدارة بيانات الموظفات
            والرواتب والإجازات التفصيلية أصبحت في صفحة واحدة مخصصة لتقليل التكرار والتعليق.
          </p>

          <div className="hr-hero__actions">
            <button className="hr-button hr-button--primary" type="button" onClick={() => onNavigate("/admin/employees")}>
              <FontAwesomeIcon icon={faUsers} />
              فتح إدارة الموظفات
            </button>
            <button className="hr-button hr-button--ghost" type="button" onClick={() => onNavigate("/admin/recruitment-applications")}>
              <FontAwesomeIcon icon={faUserTie} />
              طلبات التوظيف
            </button>
          </div>
        </div>

        <div className="hr-hero__aside">
          <span className="hr-chip">الحساب الحالي</span>
          <strong>{session.displayName || "مستخدم الموارد البشرية"}</strong>
          <span>{session.email || "غير محدد"}</span>
          <div className="hr-hero__badges">
            <span className="hr-badge hr-badge--soft">{readableRole(session.role)}</span>
            <span className="hr-badge hr-badge--outline">متابعة مباشرة</span>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="hr-overview-loading" role="status" aria-live="polite">
          <span className="hr-workspace-loading__spinner" />
          <div>
            <strong>جاري تحديث ملخص الموارد البشرية</strong>
            <small>لن يتم تحميل شاشة إدارة الموظفات الثقيلة إلا عند فتحها.</small>
          </div>
        </div>
      ) : null}

      <section className="hr-metric-grid hr-metric-grid--overview" aria-label="ملخص الموارد البشرية">
        <HrMetricCard label="إجمالي الموظفات" value={String(rosterSorted.length)} hint="إجمالي الملفات الوظيفية الحالية." />
        <HrMetricCard label="على رأس العمل" value={String(activeCount)} hint="الحسابات والملفات النشطة حاليًا." />
        <HrMetricCard label="في إجازة" value={String(leaveCount)} hint="الموظفات المسجلات في إجازة حالية." />
        <HrMetricCard label="حاضرون الآن" value={String(attendanceSummary.checkedIn)} hint="تم تسجيل حضورهم ولم يسجلوا الانصراف." />
        <HrMetricCard label="طلبات إجازة معلقة" value={String(pendingLeaveRequests)} hint="طلبات تحتاج مراجعة من الإدارة." />
        <HrMetricCard label="طلبات توظيف معلقة" value={String(pendingApplications)} hint="طلبات جديدة أو قيد المراجعة." />
      </section>

      <section className="hr-overview-command-grid">
        <article className="hr-card hr-card--attendance-overview">
          <div className="hr-card-head">
            <div>
              <p className="hr-card-kicker">الحضور اليوم</p>
              <h3>الحالة التشغيلية الحالية</h3>
            </div>
            <span className="hr-badge hr-badge--neutral">{attendanceDate}</span>
          </div>

          <div className="hr-mini-stats">
            <div><span>حاضرون الآن</span><strong>{attendanceSummary.checkedIn}</strong></div>
            <div><span>سجلوا الانصراف</span><strong>{attendanceSummary.checkedOut}</strong></div>
            <div><span>لم يسجلوا</span><strong>{attendanceSummary.notStarted}</strong></div>
          </div>

          <div className="hr-card-toolbar">
            <strong>آخر سجلات اليوم</strong>
            <button className="hr-button hr-button--ghost" type="button" onClick={() => void onRefresh()} disabled={loading}>
              {loading ? "جارٍ التحديث..." : "تحديث"}
            </button>
          </div>

          <div className="hr-leave-list hr-list-compact">
            {recentAttendanceRows.map(({ row, employeeName }) => (
              <div key={`${row.employeeId}-${row.date}`} className="hr-leave-item">
                <div className="hr-leave-item__head">
                  <strong>{employeeName}</strong>
                  <span className={`hr-badge hr-badge--${getAttendancePunchTone(row.status)}`}>
                    {getAttendancePunchLabel(row.status)}
                  </span>
                </div>
                <div className="hr-leave-item__meta">
                  <span>الحضور: {formatAttendanceTime(row.checkInAtClient)}</span>
                  <span>الانصراف: {formatAttendanceTime(row.checkOutAtClient)}</span>
                </div>
              </div>
            ))}
            {!recentAttendanceRows.length ? (
              <div className="hr-empty-state">
                <p>لا توجد سجلات حضور لهذا اليوم بعد.</p>
                <small>ستظهر السجلات هنا بعد تسجيل الحضور أو الانصراف.</small>
              </div>
            ) : null}
          </div>
        </article>

        <article className="hr-card">
          <div className="hr-card-head">
            <div>
              <p className="hr-card-kicker">إجراءات سريعة</p>
              <h3>انتقل مباشرة إلى المهمة المطلوبة</h3>
            </div>
          </div>
          <div className="hr-quick-actions">
            <button className="hr-action-card" type="button" onClick={() => onNavigate("/admin/employees")}>
              <FontAwesomeIcon icon={faUsers} />
              <strong>إدارة الموظفات</strong>
              <span>الملف الوظيفي والحضور والرواتب والإجازات والخدمات.</span>
            </button>
            <button className="hr-action-card" type="button" onClick={() => onNavigate("/admin/create-staff")}>
              <FontAwesomeIcon icon={faPlus} />
              <strong>إنشاء حساب</strong>
              <span>إنشاء حساب موظفة وربطه بالملف الوظيفي.</span>
            </button>
            <button className="hr-action-card" type="button" onClick={() => onNavigate("/admin/messages")}>
              <FontAwesomeIcon icon={faEnvelope} />
              <strong>الرسائل الداخلية</strong>
              <span>مراجعة الرسائل والتنبيهات الواردة من الموظفات.</span>
            </button>
            <button className="hr-action-card" type="button" onClick={() => onNavigate("/admin/files")}>
              <FontAwesomeIcon icon={faFileLines} />
              <strong>الملفات الداخلية</strong>
              <span>متابعة المرفقات والمستندات الإدارية.</span>
            </button>
          </div>
        </article>

        <article className="hr-card">
          <div className="hr-card-head">
            <div>
              <p className="hr-card-kicker">طلبات الإجازة</p>
              <h3>أحدث الطلبات</h3>
            </div>
            <span className="hr-badge hr-badge--warning">{pendingLeaveRequests}</span>
          </div>
          <div className="hr-leave-list hr-list-compact">
            {recentLeaveRequests.map((item) => {
              const status = getLeaveStatusMeta(item.status);
              return (
                <div key={item.id} className="hr-leave-item">
                  <div className="hr-leave-item__head">
                    <strong>{getLeaveRequestEmployeeName(item)}</strong>
                    <span className={`hr-badge hr-badge--${getLeaveBadgeTone(item.status)}`}>{status.label}</span>
                  </div>
                  <div className="hr-leave-item__meta">
                    <span>{getLeaveTypeLabel(item.type)}</span>
                    <span>{formatLeaveDateRange(item.fromDate, item.toDate)}</span>
                  </div>
                  {item.note ? <p>{item.note}</p> : null}
                </div>
              );
            })}
            {!recentLeaveRequests.length ? (
              <div className="hr-empty-state"><p>لا توجد طلبات إجازة.</p><small>الطلبات الجديدة ستظهر هنا.</small></div>
            ) : null}
          </div>
        </article>

        <article className="hr-card">
          <div className="hr-card-head">
            <div>
              <p className="hr-card-kicker">التوظيف</p>
              <h3>حالة الطلبات</h3>
            </div>
            <span className="hr-badge hr-badge--neutral">{applications.length}</span>
          </div>
          <div className="hr-mini-stats">
            <div><span>إجمالي الطلبات</span><strong>{applications.length}</strong></div>
            <div><span>بانتظار المراجعة</span><strong>{pendingApplications}</strong></div>
          </div>
          <div className="hr-copy-block">
            <p>افتح صفحة التوظيف لمراجعة الطلبات وتحويل المقبول منها إلى حساب موظفة.</p>
          </div>
          <div className="hr-actions">
            <button className="hr-button hr-button--primary" type="button" onClick={() => onNavigate("/admin/recruitment-applications")}>
              <FontAwesomeIcon icon={faChartLine} /> فتح الطلبات
            </button>
          </div>
        </article>

        <article className="hr-card">
          <div className="hr-card-head">
            <div>
              <p className="hr-card-kicker">الملفات الداخلية</p>
              <h3>أحدث الملفات</h3>
            </div>
            <span className="hr-badge hr-badge--neutral">{employeeFiles.length}</span>
          </div>
          <div className="hr-leave-list hr-list-compact">
            {recentEmployeeFiles.map((item) => (
              <div key={item.id} className="hr-leave-item">
                <div className="hr-leave-item__head">
                  <strong>{item.title}</strong>
                  <span className={`hr-badge hr-badge--${getEmployeeFileBadgeTone(item.status)}`}>
                    {getEmployeeFileStatusLabel(item.status, item.status !== "replaced")}
                  </span>
                </div>
                <div className="hr-leave-item__meta">
                  <span>{getEmployeeFileTypeLabel(item.fileType)}</span>
                  <span>{item.fileName || "بدون اسم ملف"}</span>
                </div>
              </div>
            ))}
            {!recentEmployeeFiles.length ? (
              <div className="hr-empty-state"><p>لا توجد ملفات داخلية.</p><small>المرفقات الجديدة ستظهر هنا.</small></div>
            ) : null}
          </div>
        </article>
      </section>

      <section className="hr-overview-operations">
        <article className="hr-card hr-card--operation">
          <div className="hr-card-head">
            <div>
              <p className="hr-card-kicker">الغياب اليدوي</p>
              <h3>تسجيل غياب أو نصف يوم</h3>
            </div>
            <span className="hr-badge hr-badge--neutral">{absences.length}</span>
          </div>

          <div className="hr-form-grid">
            <label className="hr-field hr-field--wide">
              <span>الموظفة</span>
              <select value={absenceForm.employeeKey} onChange={(e) => setAbsenceForm((current) => ({ ...current, employeeKey: e.target.value }))}>
                {rosterSorted.map((item) => {
                  const employeeId = getRosterAttendanceId(item);
                  return (
                    <option
                      key={`absence-${employeeId || getEmployeeName(item)}`}
                      value={employeeId}
                    >
                      {getEmployeeName(item)}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="hr-field">
              <span>التاريخ</span>
              <input type="date" value={absenceForm.date} onChange={(e) => setAbsenceForm((current) => ({ ...current, date: e.target.value }))} />
            </label>
            <label className="hr-field">
              <span>النوع</span>
              <select value={absenceForm.type} onChange={(e) => setAbsenceForm((current) => ({ ...current, type: e.target.value as EmployeeAbsence["type"] }))}>
                <option value="full_day">يوم كامل</option>
                <option value="half_day">نصف يوم</option>
              </select>
            </label>
            <label className="hr-field hr-field--wide">
              <span>السبب أو الملاحظة</span>
              <textarea rows={3} value={absenceForm.note} onChange={(e) => setAbsenceForm((current) => ({ ...current, note: e.target.value }))} placeholder="ملاحظة اختيارية" />
            </label>
          </div>
          {absenceMessage ? <div className="hr-alert">{absenceMessage}</div> : null}
          <div className="hr-actions">
            <button className="hr-button hr-button--primary" type="button" onClick={() => void handleCreateAbsence()} disabled={absenceSaving || loading || !rosterSorted.length}>
              {absenceSaving ? "جارٍ الحفظ..." : "حفظ الغياب"}
            </button>
            <button className="hr-button hr-button--ghost" type="button" onClick={() => onNavigate("/admin/employees")}>فتح سجل الموظفة</button>
          </div>

          <div className="hr-leave-list hr-list-compact">
            {recentAbsences.map((item) => (
              <div key={item.id} className="hr-leave-item">
                <div className="hr-leave-item__head">
                  <strong>{item.employeeName || item.employeeId || item.employeeUid || "موظفة غير محددة"}</strong>
                  <span className="hr-badge hr-badge--warning">{getEmployeeAbsenceTypeLabel(item.type)}</span>
                </div>
                <div className="hr-leave-item__meta">
                  <span>{formatEmployeeAbsenceDate(item.date)}</span>
                  {item.createdByName || item.createdByUid ? <span>{item.createdByName || item.createdByUid}</span> : null}
                </div>
                {item.note ? <p>{item.note}</p> : null}
              </div>
            ))}
          </div>
        </article>

        <article className="hr-card hr-card--operation">
          <div className="hr-card-head">
            <div>
              <p className="hr-card-kicker">معاينة الراتب</p>
              <h3>حساب مبدئي دون إنشاء سجل</h3>
            </div>
            <span className="hr-badge hr-badge--neutral">معاينة فقط</span>
          </div>

          <div className="hr-form-grid">
            <label className="hr-field hr-field--wide">
              <span>الموظفة</span>
              <select value={payrollForm.employeeKey} onChange={(e) => handlePayrollEmployeeChange(e.target.value)}>
                {rosterSorted.map((item) => {
                  const employeeId = getRosterAttendanceId(item);
                  return (
                    <option
                      key={`payroll-${employeeId || getEmployeeName(item)}`}
                      value={employeeId}
                    >
                      {getEmployeeName(item)}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="hr-field">
              <span>الشهر</span>
              <input type="month" value={payrollForm.payrollMonth} onChange={(e) => {
                setPayrollForm((current) => ({ ...current, payrollMonth: e.target.value }));
                setPayrollPreview(null);
                setPayrollMessage("");
              }} />
            </label>
            <label className="hr-field">
              <span>الراتب الأساسي</span>
              <input type="number" min="0" step="0.01" value={payrollForm.baseSalary} onChange={(e) => {
                setPayrollForm((current) => ({ ...current, baseSalary: e.target.value }));
                setPayrollPreview(null);
              }} />
            </label>
          </div>
          {payrollMessage ? <div className="hr-alert">{payrollMessage}</div> : null}
          <div className="hr-actions">
            <button className="hr-button hr-button--primary" type="button" onClick={() => void handleCalculatePayrollPreview()} disabled={payrollLoading || !rosterSorted.length}>
              {payrollLoading ? "جارٍ الحساب..." : "حساب المعاينة"}
            </button>
            <button className="hr-button hr-button--ghost" type="button" onClick={() => onNavigate("/admin/employees")}>إدارة الرواتب التفصيلية</button>
          </div>

          {payrollPreview ? (
            <div className="hr-audit-stack">
              <div className="hr-copy-block">
                <p>معاينة للموظفة {payrollPreview.employeeName} عن شهر {payrollPreview.payrollMonth}. لا يتم حفظ أي سجل راتب من هذه البطاقة.</p>
              </div>
              <div className="hr-mini-stats hr-mini-stats--payroll">
                <div><span>فترة الحساب</span><strong>{payrollPreview.fromDate} - {payrollPreview.toDate}</strong></div>
                <div><span>أيام العمل</span><strong>{payrollPreview.requiredWorkDays}</strong></div>
                <div><span>أيام الحضور</span><strong>{payrollPreview.attendanceRecordedDays}</strong></div>
                <div><span>أيام بلا بصمة</span><strong>{payrollPreview.daysWithoutAttendance}</strong></div>
                <div><span>ساعات العمل المطلوبة</span><strong>{formatHours(payrollPreview.expectedWorkHours)}</strong></div>
                <div><span>الساعات الفعلية</span><strong>{formatHours(payrollPreview.actualWorkedHours)}</strong></div>
                <div><span>ساعات النقص</span><strong>{formatHours(payrollPreview.missingHours)}</strong></div>
                <div><span>الأوفر تايم</span><strong>{formatHours(payrollPreview.overtimeHours)}</strong></div>
                <div><span>خصم الغياب</span><strong>{formatMoney(payrollPreview.absenceDeduction)}</strong></div>
                <div><span>خصم نقص الساعات</span><strong>{formatMoney(payrollPreview.missingHoursDeduction)}</strong></div>
                <div><span>الراتب الأساسي</span><strong>{formatMoney(payrollPreview.baseSalary)}</strong></div>
                <div className="is-total"><span>الصافي المبدئي</span><strong>{formatMoney(payrollPreview.finalSalary)}</strong></div>
              </div>
            </div>
          ) : (
            <div className="hr-empty-state"><p>لم يتم حساب المعاينة بعد.</p><small>اختر الموظفة والشهر ثم اضغط حساب المعاينة.</small></div>
          )}
        </article>
      </section>
    </div>
  );
}

export default function AdminHrDashboard() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const session = useEmployeeSession();
  const navigate = useNavigate();
  const location = useLocation();
  const { hasPermission, hasAnyPermission, hasAllPermissions } = usePermissions();
  const adminNavItems = useMemo(
    () =>
      [
        { to: "/admin/overview", label: "نظرة عامة", icon: faHouse, permission: "employees.view" as AppPermission },
        { to: "/admin/employees", label: "إدارة الموظفين", icon: faUsers, permission: "employees.view" as AppPermission },
        { to: "/admin/recruitment-applications", label: "طلبات التوظيف", icon: faUserTie, permission: "recruitment.view" as AppPermission },
        { to: "/admin/messages", label: "الرسائل الداخلية", icon: faEnvelope, permission: "messages.manage" as AppPermission },
        { to: "/admin/files", label: "الملفات الداخلية", icon: faFileLines, permission: "employees.files.view" as AppPermission },
        {
          to: "/admin/create-staff",
          label: "إنشاء حساب موظف",
          icon: faUserShield,
          permission: "admin_accounts.manage" as AppPermission,
          allOf: ["admin_accounts.manage", "employees.create"] as AppPermission[],
        },
      ].filter((item) =>
        item.allOf ? hasAllPermissions(item.allOf) : hasPermission(item.permission)
      ),
    [hasAllPermissions, hasPermission]
  );
  const adminLandingPath = adminNavItems[0]?.to || "/employee/overview";
  const canOpenDashboard = hasPermission("workspace.dashboard.view");
  const canOpenHr = hasAnyPermission([
    "employees.view",
    "attendance.view",
    "recruitment.view",
    "messages.manage",
    "employees.files.view",
    "admin_accounts.view",
  ]);
  const adminSection = useMemo(() => {
    const section = location.pathname.replace(/^\/admin\/?/, "").split("/")[0];
    return section || "overview";
  }, [location.pathname]);
  const isOverviewRoute = adminSection === "overview";
  const isEmployeesRoute = adminSection === "employees";
  const routeMeta = useMemo(() => {
    const meta: Record<string, { kicker: string; title: string; subtitle: string }> = {
      overview: {
        kicker: "الموارد البشرية",
        title: "نظرة عامة على الموارد البشرية",
        subtitle: "ملخص تشغيلي سريع للحضور والطلبات والملفات، بينما تتم إدارة الموظفات من الصفحة المخصصة.",
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
  const [employeeFiles, setEmployeeFiles] = useState<EmployeeFile[]>([]);
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
      const [rosterRows, applicationRows, leaveRows, fileRows, absenceRows] = await Promise.all([
        hasPermission("employees.view") ? listEmployeeDirectory() : Promise.resolve([]),
        hasPermission("recruitment.view") ? listRecruitmentApplications() : Promise.resolve([]),
        hasPermission("attendance.leaves.manage") ? listEmployeeLeaveRequests() : Promise.resolve([]),
        hasPermission("employees.files.view") ? listEmployeeFiles(40) : Promise.resolve([]),
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

  if (session.loading) {
    return (
      <div className="hr-shell madan-admin-shell" dir="rtl">
        <aside className="hr-shell-sidebar hr-shell-sidebar--loading">
          <div className="hr-sidebar-header">
            <img src={logo1} alt="Malikat" className="hr-sidebar-logo" />
          </div>
        </aside>

        <main className="hr-shell-main">
          <DashboardHeader
            theme="admin"
            title="جاري تحميل لوحة الموارد البشرية..."
            subtitle="Queens Salon"
            className="hr-shell-header"
            showProfileButton={false}
          />

          <div className="hr-loading-panel">
            <div className="hr-loading-card" />
            <div className="hr-loading-card" />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={`hr-shell madan-admin-shell ${isEmployeesRoute ? "hr-shell--employees" : ""}${isSidebarCollapsed ? " is-sidebar-collapsed" : ""}`} dir="rtl">
      <aside className="hr-shell-sidebar">
        <div className="hr-sidebar-header">
          <img src={logo1} alt="Malikat" className="hr-sidebar-logo" />
          <button
            type="button"
            className="hr-sidebar-collapse"
            onClick={() => setIsSidebarCollapsed((value) => !value)}
            aria-label={isSidebarCollapsed ? "توسيع القائمة" : "طي القائمة"}
          >
            <FontAwesomeIcon icon={isSidebarCollapsed ? faChevronLeft : faChevronRight} />
          </button>
        </div>

        <nav className="hr-shell-nav" aria-label="HR navigation">
          <span className="hr-sidebar-section-title">الموارد البشرية</span>
          {adminNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `hr-shell-link ${isActive ? "is-active" : ""}`}
            >
              <FontAwesomeIcon icon={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="hr-shell-note">
          <span>{session.displayName || "مسجل الدخول"}</span>
          <span>{session.email || ""}</span>
          <small>{readableRole(session.role)}</small>
        </div>
      </aside>

      <DashboardHeader
        theme="admin"
        title={isEmployeesRoute ? "إدارة الموظفات" : routeMeta.title}
        subtitle="Queens Salon"
        className="hr-mobile-appbar dashboard-header--mobile-shell"
        actions={
            <InternalPortalSwitcher
              canOpenDashboard={canOpenDashboard}
              canOpenHr={canOpenHr}
              loggingOut={loggingOut}
              onLogout={handleLogout}
              className="hr-mobile-appbar__actions"
          />
        }
      />
      <main className={`hr-shell-main ${isEmployeesRoute ? "hr-shell-main--workspace" : ""}`}>
        <DashboardHeader
          theme="admin"
          title={isEmployeesRoute ? "إدارة الموظفات" : routeMeta.title}
          subtitle="Queens Salon"
          className={`hr-shell-header ${isEmployeesRoute ? "hr-shell-header--compact" : ""}`}
          actions={
            <>
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
        />

        {isOverviewRoute && error ? <div className="hr-alert">{error}</div> : null}

        <section className={`hr-stage ${isEmployeesRoute ? "hr-stage--workspace" : ""}`}>
          <Routes>
            <Route index element={<Navigate to={adminLandingPath} replace />} />
            <Route
              path="overview"
              element={
                <PermissionRoute permission="employees.view">
                  <HrOverview
                    roster={roster}
                    applications={applications}
                    leaveRequests={leaveRequests}
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
              path="recruitment-applications"
              element={<PermissionRoute permission="recruitment.view"><RecruitmentApplicationsPage session={session} /></PermissionRoute>}
            />
            <Route
              path="employees"
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
      <nav className="hr-mobile-bottom-nav" aria-label="تنقل الموارد البشرية">
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
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
