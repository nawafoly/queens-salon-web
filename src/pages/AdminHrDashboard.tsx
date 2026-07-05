import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRight,
  faChartLine,
  faEnvelope,
  faFileLines,
  faHouse,
  faMagnifyingGlass,
  faPlus,
  faRightFromBracket,
  faUserShield,
  faUsers,
  faUserTie,
} from "@fortawesome/free-solid-svg-icons";

import { useEmployeeSession, cleanText } from "./hr/shared";
import { resolveDashboardLandingPath } from "../helpers/routePaths";
import { logoutFirebase } from "../services/authService";
import RecruitmentApplicationsPage from "./hr/RecruitmentApplications";
import CreateStaffAccountPage from "./hr/CreateStaffAccount";
import EmployeeMessagesPage from "./hr/EmployeeMessages";
import EmployeeFilesPage from "./hr/EmployeeFiles";
import DashboardEmployees from "./DashboardEmployees";
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
  listStaffAttendanceByDateRange,
  listStaffAttendanceForDate,
  type StaffAttendanceToday,
} from "../services/firestoreAttendance";
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

function getRosterAttendanceId(item: DirectoryEmployee) {
  return cleanText(item.employeeId || item.id || item.uid || item.linkedUid || item.linkedUserId);
}

function getRosterEmployeeUid(item: DirectoryEmployee) {
  return cleanText(item.linkedUid || item.uid || item.employeeKey || item.employeeId || item.id);
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
    return [...roster].sort((a, b) => {
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
        listStaffAttendanceByDateRange({
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
    <div className="hr-overview madan-hr-overview-v2">
      <section className="hr-hero">
        <div className="hr-hero__copy">
          <span className="hr-hero__eyebrow">لوحة الموارد البشرية</span>
          <h2>إدارة الموظفين</h2>
          <p>
            صفحة مخصصة لإدارة البيانات الوظيفية للموظفين من جهة الإدارة والموارد البشرية، مع فصل
            واضح بين ما يشاهده الموظف في بروفايله وما يتم تعديله من داخل اللوحة.
          </p>

          <div className="hr-hero__actions">
            <button className="hr-button hr-button--primary" type="button" onClick={() => onNavigate("/admin/employees")}>
              <FontAwesomeIcon icon={faUsers} />
              إدارة الموظفين
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
            <span className="hr-badge hr-badge--outline">الموارد</span>
          </div>
        </div>
      </section>

      <section className="hr-metric-grid" aria-label="ملخص الموارد البشرية">
        <HrMetricCard
          label="الموظفون"
          value={String(rosterSorted.length)}
          hint="إجمالي السجلات الظاهرة ضمن صفحة إدارة الموظفين."
        />
        <HrMetricCard
          label="على رأس العمل"
          value={String(activeCount)}
          hint="موظفون بحالة وظيفية نشطة حاليًا."
        />
        <HrMetricCard
          label="متابعة الحالة"
          value={`إجازة: ${leaveCount} | تجربة: ${trialCount}`}
          hint="قراءة سريعة لحالات الموظفين التشغيلية."
        />
      </section>

      <section className="hr-workspace">
        <div className="hr-workspace__main">
          <article className="hr-card hr-card--intro">
            <div className="hr-card-head hr-card-head--stack">
              <div>
                <p className="hr-card-kicker">بيانات الموظف الوظيفية</p>
                <h3>{selected ? `${selectedName}` : "اختر موظفًا لعرض ملفه الوظيفي"}</h3>
                <p className="hr-card-subtitle">
                  هذا القسم مخصص للإدارة والموارد البشرية فقط. الموظف يرى هذه البيانات في بروفايله بشكل
                  للعرض فقط ولا يحررها بنفسه.
                </p>
              </div>

              <button
                className="hr-button hr-button--ghost"
                type="button"
                onClick={onRefresh}
                disabled={loading}
              >
                <FontAwesomeIcon icon={faArrowRight} />
                {loading ? "جارٍ التحديث..." : "تحديث البيانات"}
              </button>
            </div>

            <div className="hr-inline-tabs" aria-label="Employee sections">
              <span className="hr-inline-tab is-active">بيانات الموظف</span>
              <button className="hr-inline-tab" type="button" onClick={() => onNavigate("/admin/employees")}>
                الرواتب
              </button>
              <button className="hr-inline-tab" type="button" onClick={() => onNavigate("/admin/employees")}>
                الإجازات
              </button>
              <button className="hr-inline-tab" type="button" onClick={() => onNavigate("/admin/messages")}>
                الرسائل
              </button>
              <button className="hr-inline-tab" type="button" onClick={() => onNavigate("/admin/files")}>
                الملفات
              </button>
            </div>

            {selected ? (
              <>
                <div className="hr-selected-hero">
                  <div className="hr-selected-hero__nameBlock">
                    <p className="hr-selected-hero__eyebrow">ملخص الموظف</p>
                    <h4>{selectedName}</h4>
                    <p>{selectedTitle}</p>
                    <div className="hr-badge-row">
                      <span className="hr-badge hr-badge--soft">{selectedDepartment}</span>
                      <span className={`hr-badge hr-badge--${selectedStatus?.tone || "neutral"}`}>
                        {selectedStatus?.label || "غير محدد"}
                      </span>
                    </div>
                  </div>

                  <div className="hr-selected-hero__meta">
                    <div>
                      <span>البريد</span>
                      <strong>{selectedEmail}</strong>
                    </div>
                    <div>
                      <span>الجوال</span>
                      <strong>{selectedPhone}</strong>
                    </div>
                    <div>
                      <span>رقم البصمة</span>
                      <strong>{selectedFingerprint}</strong>
                    </div>
                    <div>
                      <span>بداية العمل</span>
                      <strong>{selectedStartDate}</strong>
                    </div>
                  </div>
                </div>

                <div className="hr-note-banner">
                  <strong>بيانات الموظف الوظيفية</strong>
                  <p>
                    يمكن للموارد البشرية تعديل بيانات الموظف من هنا بشكل مباشر، مع إبقاء السجل المرئي
                    داخل الملف الشخصي للموظف للعرض فقط.
                  </p>
                </div>

                <div className="hr-detail-grid">
                  <div className="hr-detail-card">
                    <span>اسم الموظف</span>
                    <strong>{selectedName}</strong>
                  </div>
                  <div className="hr-detail-card">
                    <span>القسم</span>
                    <strong>{selectedDepartment}</strong>
                  </div>
                  <div className="hr-detail-card">
                    <span>المسمى</span>
                    <strong>{selectedTitle}</strong>
                  </div>
                  <div className="hr-detail-card">
                    <span>بداية العمل</span>
                    <strong>{selectedStartDate}</strong>
                  </div>
                </div>

                <div className="hr-actions hr-actions--wrap">
                  <button className="hr-button hr-button--primary" type="button" onClick={() => onNavigate("/admin/employees")}>
                    <FontAwesomeIcon icon={faUsers} />
                    فتح ملف الموظفين
                  </button>
                  <button className="hr-button hr-button--ghost" type="button" onClick={() => onNavigate("/admin/create-staff")}>
                    <FontAwesomeIcon icon={faPlus} />
                    إنشاء حساب جديد
                  </button>
                  <button className="hr-button hr-button--ghost" type="button" onClick={() => onNavigate("/admin/messages")}>
                    <FontAwesomeIcon icon={faEnvelope} />
                    الرسائل الداخلية
                  </button>
                </div>
              </>
            ) : (
              <div className="hr-empty-state">
                <p>لا توجد بطاقة موظف محددة حتى الآن.</p>
                <small>اختر موظفًا من القائمة الجانبية لعرض ملفه الوظيفي.</small>
              </div>
            )}
          </article>

          <div className="hr-grid-2">
            <article className="hr-card">
              <div className="hr-card-head">
                <div>
                  <p className="hr-card-kicker">إجراءات سريعة</p>
                  <h3>تصفّح لوحات الإدارة</h3>
                </div>
              </div>

              <div className="hr-quick-actions">
                <button className="hr-action-card" type="button" onClick={() => onNavigate("/admin/recruitment-applications")}>
                  <FontAwesomeIcon icon={faUserTie} />
                  <strong>طلبات التوظيف</strong>
                  <span>مراجعة المرشحين وتحويلهم إلى حسابات داخلية.</span>
                </button>
                <button className="hr-action-card" type="button" onClick={() => onNavigate("/admin/create-staff")}>
                  <FontAwesomeIcon icon={faUserShield} />
                  <strong>إنشاء حساب موظف</strong>
                  <span>إضافة حساب داخلي وربطه بملف الموظفة من مسار واحد.</span>
                </button>
                <button className="hr-action-card" type="button" onClick={() => onNavigate("/admin/messages")}>
                  <FontAwesomeIcon icon={faEnvelope} />
                  <strong>الرسائل</strong>
                  <span>مراسلات HR مع الموظفين والتنبيهات الداخلية.</span>
                </button>
                <button className="hr-action-card" type="button" onClick={() => onNavigate("/admin/files")}>
                  <FontAwesomeIcon icon={faFileLines} />
                  <strong>الملفات</strong>
                  <span>رفع ومتابعة ملفات الموظفين الداخلية.</span>
                </button>
              </div>
            </article>

            <article className="hr-card">
              <div className="hr-card-head">
                <div>
                  <p className="hr-card-kicker">طلبات التوظيف</p>
                  <h3>مؤشر سريع</h3>
                </div>
              </div>

              <div className="hr-mini-stats">
                <div>
                  <span>إجمالي الطلبات</span>
                  <strong>{applications.length}</strong>
                </div>
                <div>
                  <span>بانتظار المراجعة</span>
                  <strong>{pendingApplications}</strong>
                </div>
              </div>

              <div className="hr-copy-block">
                <p>
                  راجع الطلبات الجديدة ثم حوّل المناسب منها إلى حسابات موظفين مباشرة من داخل لوحة الموارد
                  البشرية.
                </p>
              </div>

              <div className="hr-actions">
                <button className="hr-button hr-button--primary" type="button" onClick={() => onNavigate("/admin/recruitment-applications")}>
                  <FontAwesomeIcon icon={faChartLine} />
                  فتح الطلبات
                </button>
              </div>
            </article>

            <article className="hr-card">
              <div className="hr-card-head">
                <div>
                  <p className="hr-card-kicker">Leave requests</p>
                  <h3>Latest requests</h3>
                </div>
                <span className="hr-badge hr-badge--warning">{pendingLeaveRequests}</span>
              </div>

              <div className="hr-leave-list">
                {recentLeaveRequests.map((item) => {
                  const status = getLeaveStatusMeta(item.status);
                  return (
                    <div key={item.id} className="hr-leave-item">
                      <div className="hr-leave-item__head">
                        <strong>{getLeaveRequestEmployeeName(item)}</strong>
                        <span className={`hr-badge hr-badge--${getLeaveBadgeTone(item.status)}`}>
                          {status.label}
                        </span>
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
                  <div className="hr-empty-state">
                    <p>No leave requests yet.</p>
                    <small>Requests sent from the employee portal will appear here.</small>
                  </div>
                ) : null}
              </div>
            </article>

            <article className="hr-card">
              <div className="hr-card-head">
                <div>
                  <p className="hr-card-kicker">Employee files</p>
                  <h3>Latest files</h3>
                </div>
                <span className="hr-badge hr-badge--neutral">{employeeFiles.length}</span>
              </div>

              <div className="hr-leave-list">
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
                      <span>{item.fileName || "No file name"}</span>
                      <span>{item.employeeId || item.employeeUid || "Unassigned employee"}</span>
                    </div>
                    {item.notes ? <p>{item.notes}</p> : null}
                  </div>
                ))}

                {!recentEmployeeFiles.length ? (
                  <div className="hr-empty-state">
                    <p>No employee files yet.</p>
                    <small>Files uploaded from HR or the employee portal will appear here.</small>
                  </div>
                ) : null}
              </div>
            </article>

            <article className="hr-card">
              <div className="hr-card-head">
                <div>
                  <p className="hr-card-kicker">Attendance</p>
                  <h3>Today summary</h3>
                </div>
                <span className="hr-badge hr-badge--neutral">{attendanceDate}</span>
              </div>

              <div className="hr-mini-stats">
                <div>
                  <span>حاضرون الآن</span>
                  <strong>{attendanceSummary.checkedIn}</strong>
                </div>
                <div>
                  <span>سجلوا الانصراف</span>
                  <strong>{attendanceSummary.checkedOut}</strong>
                </div>
                <div>
                  <span>لم يسجلوا</span>
                  <strong>{attendanceSummary.notStarted}</strong>
                </div>
              </div>

              <div className="hr-leave-list">
                <div className="hr-card-head">
                  <div>
                    <p className="hr-card-kicker">Today log</p>
                    <h3>آخر سجلات حضور اليوم</h3>
                  </div>
                  <button className="hr-button hr-button--ghost" type="button" onClick={() => void onRefresh()} disabled={loading}>
                    تحديث
                  </button>
                </div>

                {recentAttendanceRows.map(({ row, employeeName }) => (
                  <div key={`${row.employeeId}-${row.date}`} className="hr-leave-item">
                    <div className="hr-leave-item__head">
                      <strong>{employeeName}</strong>
                      <span className={`hr-badge hr-badge--${getAttendancePunchTone(row.status)}`}>
                        {getAttendancePunchLabel(row.status)}
                      </span>
                    </div>
                    <div className="hr-leave-item__meta">
                      <span>وقت الحضور: {formatAttendanceTime(row.checkInAtClient)}</span>
                      <span>وقت الانصراف: {formatAttendanceTime(row.checkOutAtClient)}</span>
                      <span>{row.date}</span>
                    </div>
                  </div>
                ))}

                {!recentAttendanceRows.length ? (
                  <div className="hr-empty-state">
                    <p>لا توجد سجلات حضور لهذا اليوم بعد.</p>
                    <small>ستظهر سجلات الموظفين هنا بعد تسجيل الحضور أو الانصراف.</small>
                  </div>
                ) : null}
              </div>
            </article>

            <article className="hr-card">
              <div className="hr-card-head">
                <div>
                  <p className="hr-card-kicker">Absences</p>
                  <h3>Manual absence</h3>
                </div>
                <span className="hr-badge hr-badge--neutral">{absences.length}</span>
              </div>

              <div className="hr-form-grid">
                <label className="hr-field hr-field--wide">
                  <span>Employee</span>
                  <select
                    value={absenceForm.employeeKey}
                    onChange={(e) => setAbsenceForm((current) => ({ ...current, employeeKey: e.target.value }))}
                  >
                    {rosterSorted.map((item) => {
                      const employeeId = getRosterAttendanceId(item);
                      return (
                        <option key={employeeId || getEmployeeName(item)} value={employeeId}>
                          {getEmployeeName(item)}
                        </option>
                      );
                    })}
                  </select>
                </label>

                <label className="hr-field">
                  <span>Date</span>
                  <input
                    type="date"
                    value={absenceForm.date}
                    onChange={(e) => setAbsenceForm((current) => ({ ...current, date: e.target.value }))}
                  />
                </label>

                <label className="hr-field">
                  <span>Type</span>
                  <select
                    value={absenceForm.type}
                    onChange={(e) => setAbsenceForm((current) => ({ ...current, type: e.target.value as EmployeeAbsence["type"] }))}
                  >
                    <option value="full_day">Full day</option>
                    <option value="half_day">Half day</option>
                  </select>
                </label>

                <label className="hr-field hr-field--wide">
                  <span>Reason</span>
                  <textarea
                    rows={3}
                    value={absenceForm.note}
                    onChange={(e) => setAbsenceForm((current) => ({ ...current, note: e.target.value }))}
                    placeholder="Optional reason"
                  />
                </label>
              </div>

              {absenceMessage ? <div className="hr-alert">{absenceMessage}</div> : null}

              <div className="hr-actions">
                <button
                  className="hr-button hr-button--primary"
                  type="button"
                  onClick={() => void handleCreateAbsence()}
                  disabled={absenceSaving || loading || !rosterSorted.length}
                >
                  Save absence
                </button>
              </div>

              <div className="hr-leave-list">
                {recentAbsences.map((item) => (
                  <div key={item.id} className="hr-leave-item">
                    <div className="hr-leave-item__head">
                      <strong>{item.employeeName || item.employeeId || item.employeeUid || "Unassigned employee"}</strong>
                      <span className="hr-badge hr-badge--warning">{getEmployeeAbsenceTypeLabel(item.type)}</span>
                    </div>
                    <div className="hr-leave-item__meta">
                      <span>{formatEmployeeAbsenceDate(item.date)}</span>
                      {item.createdByName || item.createdByUid ? <span>{item.createdByName || item.createdByUid}</span> : null}
                    </div>
                    {item.note ? <p>{item.note}</p> : null}
                  </div>
                ))}

                {!recentAbsences.length ? (
                  <div className="hr-empty-state">
                    <p>No absence records yet.</p>
                    <small>Manual absence records created by HR will appear here.</small>
                  </div>
                ) : null}
              </div>
            </article>

            <article className="hr-card">
              <div className="hr-card-head">
                <div>
                  <p className="hr-card-kicker">Payroll Preview</p>
                  <h3>Preview only</h3>
                </div>
                <span className="hr-badge hr-badge--neutral">No save</span>
              </div>

              <div className="hr-form-grid">
                <label className="hr-field hr-field--wide">
                  <span>Employee</span>
                  <select
                    value={payrollForm.employeeKey}
                    onChange={(e) => handlePayrollEmployeeChange(e.target.value)}
                  >
                    {rosterSorted.map((item) => {
                      const employeeId = getRosterAttendanceId(item);
                      return (
                        <option key={employeeId || getEmployeeName(item)} value={employeeId}>
                          {getEmployeeName(item)}
                        </option>
                      );
                    })}
                  </select>
                </label>

                <label className="hr-field">
                  <span>Month</span>
                  <input
                    type="month"
                    value={payrollForm.payrollMonth}
                    onChange={(e) => {
                      setPayrollForm((current) => ({ ...current, payrollMonth: e.target.value }));
                      setPayrollPreview(null);
                      setPayrollMessage("");
                    }}
                  />
                </label>

                <label className="hr-field">
                  <span>Base salary</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={payrollForm.baseSalary}
                    onChange={(e) => {
                      setPayrollForm((current) => ({ ...current, baseSalary: e.target.value }));
                      setPayrollPreview(null);
                    }}
                  />
                </label>
              </div>

              {payrollMessage ? <div className="hr-alert">{payrollMessage}</div> : null}

              <div className="hr-actions">
                <button
                  className="hr-button hr-button--primary"
                  type="button"
                  onClick={() => void handleCalculatePayrollPreview()}
                  disabled={payrollLoading || !rosterSorted.length}
                >
                  {payrollLoading ? "Calculating..." : "Calculate preview"}
                </button>
              </div>

              {payrollPreview ? (
                <div className="hr-audit-stack">
                  <div className="hr-copy-block">
                    <p>
                      Preview only for {payrollPreview.employeeName} / {payrollPreview.payrollMonth}. Days without attendance are shown for audit only.
                    </p>
                  </div>

                  <div className="hr-mini-stats">
                    <div>
                      <span>Calculation range</span>
                      <strong>{payrollPreview.fromDate} - {payrollPreview.toDate}</strong>
                    </div>
                    <div>
                      <span>Work days</span>
                      <strong>{payrollPreview.requiredWorkDays}</strong>
                    </div>
                    <div>
                      <span>Attendance days</span>
                      <strong>{payrollPreview.attendanceRecordedDays}</strong>
                    </div>
                    <div>
                      <span>Days without attendance (audit only)</span>
                      <strong>{payrollPreview.daysWithoutAttendance}</strong>
                    </div>
                    <div>
                      <span>Manual absence days</span>
                      <strong>{formatHours(payrollPreview.manualAbsenceDays)}</strong>
                    </div>
                    <div>
                      <span>Required hours</span>
                      <strong>{formatHours(payrollPreview.expectedWorkHours)}</strong>
                    </div>
                    <div>
                      <span>Actual hours</span>
                      <strong>{formatHours(payrollPreview.actualWorkedHours)}</strong>
                    </div>
                    <div>
                      <span>Missing hours</span>
                      <strong>{formatHours(payrollPreview.missingHours)}</strong>
                    </div>
                    <div>
                      <span>Overtime hours</span>
                      <strong>{formatHours(payrollPreview.overtimeHours)}</strong>
                    </div>
                    <div>
                      <span>Absence deduction</span>
                      <strong>{formatMoney(payrollPreview.absenceDeduction)}</strong>
                    </div>
                    <div>
                      <span>Missing-hours deduction</span>
                      <strong>{formatMoney(payrollPreview.missingHoursDeduction)}</strong>
                    </div>
                    <div>
                      <span>Base salary</span>
                      <strong>{formatMoney(payrollPreview.baseSalary)}</strong>
                    </div>
                    <div>
                      <span>Final after deductions</span>
                      <strong>{formatMoney(payrollPreview.finalSalary)}</strong>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="hr-empty-state">
                  <p>No payroll preview calculated yet.</p>
                  <small>This preview does not create or update payroll records.</small>
                </div>
              )}
            </article>
          </div>
        </div>

        <aside className="hr-workspace__side">
          <article className="hr-card hr-card--sticky">
            <div className="hr-card-head hr-card-head--stack">
              <div>
                <p className="hr-card-kicker">قائمة الموظفين</p>
                <h3>اختر موظفًا لعرض بياناته أو إدارة ملفه من نفس الصفحة.</h3>
                <p className="hr-card-subtitle">اختر موظفًا لعرض ملفه الوظيفي وإدارة بياناته من نفس الصفحة.</p>
              </div>
            </div>

            <label className="hr-search">
              <FontAwesomeIcon icon={faMagnifyingGlass} />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ابحث بالاسم أو البريد أو القسم"
              />
            </label>

            <div className="hr-roster-list">
              {filteredRoster.map((item) => {
                const id = cleanText(item.id || item.uid || item.employeeId || getEmployeeEmail(item) || getEmployeeName(item));
                const status = getStatusMeta(item);
                const isSelected = cleanText(selectedId || selected?.id || "") === id;
                return (
                  <button
                    key={id || getEmployeeEmail(item)}
                    type="button"
                    className={`hr-roster-card ${isSelected ? "is-selected" : ""}`}
                    onClick={() => setSelectedId(id)}
                  >
                    <div className="hr-roster-card__head">
                      <div>
                        <strong>{getEmployeeName(item)}</strong>
                        <span>{getEmployeeEmail(item)}</span>
                      </div>
                      <span className={`hr-badge hr-badge--${status.tone}`}>{status.label}</span>
                    </div>

                    <div className="hr-roster-card__meta">
                      <div>
                        <span>المسمى</span>
                        <strong>{getJobTitle(item)}</strong>
                      </div>
                      <div>
                        <span>القسم</span>
                        <strong>{getDepartment(item)}</strong>
                      </div>
                      <div>
                        <span>بداية العمل</span>
                        <strong>{getStartDate(item)}</strong>
                      </div>
                    </div>
                  </button>
                );
              })}

              {!filteredRoster.length ? (
                <div className="hr-empty-state hr-empty-state--side">
                  <p>لا توجد نتائج مطابقة لهذا البحث.</p>
                  <small>جرّب كلمة أخرى أو ألغِ التصفية الحالية.</small>
                </div>
              ) : null}
            </div>
          </article>
        </aside>
      </section>
    </div>
  );
}

export default function AdminHrDashboard() {
  const session = useEmployeeSession();
  const navigate = useNavigate();
  const dashboardPath = resolveDashboardLandingPath(session.role);
  const dashboardLabel = session.role === "hr" ? "لوحة HR" : "لوحة التحكم";
  const [loggingOut, setLoggingOut] = useState(false);
  const [roster, setRoster] = useState<DirectoryEmployee[]>([]);
  const [applications, setApplications] = useState<RecruitmentApplication[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<EmployeeLeaveRequest[]>([]);
  const [employeeFiles, setEmployeeFiles] = useState<EmployeeFile[]>([]);
  const [attendanceToday, setAttendanceToday] = useState<StaffAttendanceToday[]>([]);
  const [absences, setAbsences] = useState<EmployeeAbsence[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState("");
  const loadRequestRef = useRef(0);

  const loadData = async () => {
    const requestId = ++loadRequestRef.current;
    setLoadingData(true);
    setError("");
    try {
      const [rosterRows, applicationRows, leaveRows, fileRows, absenceRows] = await Promise.all([
        listEmployeeDirectory(),
        listRecruitmentApplications(),
        listEmployeeLeaveRequests(),
        listEmployeeFiles(40),
        listEmployeeAbsences(80),
      ]);
      const employeeIds = Array.from(
        new Set(
          (Array.isArray(rosterRows) ? rosterRows : [])
            .map((item) => getRosterAttendanceId(item as DirectoryEmployee))
            .filter(Boolean)
        )
      );
      const attendanceRows = await listStaffAttendanceForDate({ employeeIds });
      if (requestId !== loadRequestRef.current) return;
      setRoster(Array.isArray(rosterRows) ? rosterRows : []);
      setApplications(Array.isArray(applicationRows) ? applicationRows : []);
      setLeaveRequests(Array.isArray(leaveRows) ? leaveRows : []);
      setEmployeeFiles(Array.isArray(fileRows) ? fileRows : []);
      setAttendanceToday(Array.isArray(attendanceRows) ? attendanceRows : []);
      setAbsences(Array.isArray(absenceRows) ? absenceRows : []);
    } catch (e) {
      if (requestId !== loadRequestRef.current) return;
      setError(cleanText((e as any)?.message || "تعذر تحميل لوحة الموارد البشرية."));
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoadingData(false);
      }
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

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
          <div className="hr-brand">
            <span className="hr-brand__mark">HR</span>
            <div>
              <strong>الموارد البشرية</strong>
              <small>جاري التحقق من الجلسة...</small>
            </div>
          </div>
        </aside>

        <main className="hr-shell-main">
          <div className="hr-shell-header">
            <div>
              <p className="hr-shell-kicker">الموارد البشرية</p>
              <h1>جاري تحميل لوحة الموارد البشرية...</h1>
              <p className="hr-shell-subtitle">نجهز بيانات الموظفين والطلبات قبل عرض اللوحة.</p>
            </div>
          </div>

          <div className="hr-loading-panel">
            <div className="hr-loading-card" />
            <div className="hr-loading-card" />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="hr-shell madan-admin-shell" dir="rtl">
      <aside className="hr-shell-sidebar">
        <div className="hr-brand">
          <span className="hr-brand__mark">HR</span>
          <div>
            <strong>الموارد البشرية</strong>
            <small>لوحة إدارة الموظفين</small>
          </div>
        </div>

        <div className="hr-shell-switcher" aria-label="تنقل سريع">
          <Link to="/" className="hr-shell-link hr-shell-link--soft">
            <FontAwesomeIcon icon={faHouse} />
            <span>الموقع الرئيسي</span>
          </Link>
          <Link to="/employee/overview" className="hr-shell-link hr-shell-link--soft">
            <FontAwesomeIcon icon={faUserTie} />
            <span>بوابة الموظف</span>
          </Link>
          <NavLink
            to={dashboardPath}
            className={({ isActive }) => `hr-shell-link hr-shell-link--accent ${isActive ? "is-active" : ""}`}
          >
            <FontAwesomeIcon icon={faChartLine} />
            <span>{dashboardLabel}</span>
          </NavLink>
          <button
            type="button"
            className="hr-shell-link hr-shell-link--danger"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
          >
            <FontAwesomeIcon icon={faRightFromBracket} />
            <span>{loggingOut ? "جارِ الخروج..." : "تسجيل الخروج"}</span>
          </button>
        </div>

        <nav className="hr-shell-nav" aria-label="HR navigation">
          <NavLink to="/admin/overview" className={({ isActive }) => `hr-shell-link ${isActive ? "is-active" : ""}`}>
            <FontAwesomeIcon icon={faHouse} />
            <span>نظرة عامة</span>
          </NavLink>
          <NavLink to="/admin/employees" className={({ isActive }) => `hr-shell-link ${isActive ? "is-active" : ""}`}>
            <FontAwesomeIcon icon={faUsers} />
            <span>إدارة الموظفين</span>
          </NavLink>
          <NavLink to="/admin/recruitment-applications" className={({ isActive }) => `hr-shell-link ${isActive ? "is-active" : ""}`}>
            <FontAwesomeIcon icon={faUserTie} />
            <span>طلبات التوظيف</span>
          </NavLink>
          <NavLink to="/admin/messages" className={({ isActive }) => `hr-shell-link ${isActive ? "is-active" : ""}`}>
            <FontAwesomeIcon icon={faEnvelope} />
            <span>الرسائل الداخلية</span>
          </NavLink>
          <NavLink to="/admin/files" className={({ isActive }) => `hr-shell-link ${isActive ? "is-active" : ""}`}>
            <FontAwesomeIcon icon={faFileLines} />
            <span>الملفات الداخلية</span>
          </NavLink>
          <NavLink to="/admin/create-staff" className={({ isActive }) => `hr-shell-link ${isActive ? "is-active" : ""}`}>
            <FontAwesomeIcon icon={faUserShield} />
            <span>إنشاء حساب موظف</span>
          </NavLink>
        </nav>

        <div className="hr-shell-note">
          <span>{session.displayName || "مسجل الدخول"}</span>
          <span>{session.email || ""}</span>
          <small>{readableRole(session.role)}</small>
        </div>
      </aside>

      <main className="hr-shell-main">
        <header className="hr-shell-header">
          <div>
            <p className="hr-shell-kicker">الموارد البشرية</p>
            <h1>إدارة الموارد البشرية</h1>
            <p className="hr-shell-subtitle">
              مساحة موحدة لإدارة التوظيف والموظفين والملفات الإدارية مع فصل واضح بين العرض والتعديل.
            </p>
          </div>

          <div className="hr-shell-user">
            <strong>{session.displayName || "مستخدم الموارد البشرية"}</strong>
            <span>{readableRole(session.role)}</span>
            <button className="hr-refresh" type="button" onClick={() => void loadData()} disabled={loadingData}>
              {loadingData ? "جارٍ التحديث..." : "تحديث البيانات"}
            </button>
          </div>
        </header>

        {error ? <div className="hr-alert">{error}</div> : null}

        <section className="hr-stage">
          <Routes>
            <Route
              index
              element={<Navigate to="overview" replace />}
            />
            <Route
              path="overview"
              element={
                <HrOverview
                  roster={roster}
                  applications={applications}
                  leaveRequests={leaveRequests}
                  employeeFiles={employeeFiles}
                  attendanceToday={attendanceToday}
                  absences={absences}
                  loading={loadingData}
                  onNavigate={(path) => navigate(path)}
                  onRefresh={() => void loadData()}
                  session={session}
                />
              }
            />
            <Route path="recruitment-applications" element={<RecruitmentApplicationsPage session={session} />} />
            <Route path="employees" element={<DashboardEmployees />} />
            <Route path="messages" element={<EmployeeMessagesPage session={session} />} />
            <Route path="files" element={<EmployeeFilesPage session={session} />} />
            <Route path="users" element={<Navigate to="/dashboard/settings/users" replace />} />
            <Route path="create-staff" element={<CreateStaffAccountPage session={session} />} />
            <Route path="*" element={<Navigate to="overview" replace />} />
          </Routes>
        </section>
      </main>
    </div>
  );
}
