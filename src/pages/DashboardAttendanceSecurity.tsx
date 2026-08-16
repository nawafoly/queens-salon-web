import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FiActivity,
  FiAlertTriangle,
  FiCheck,
  FiCheckCircle,
  FiClock,
  FiCpu,
  FiDownload,
  FiEye,
  FiFileText,
  FiLock,
  FiMapPin,
  FiRefreshCw,
  FiSearch,
  FiShield,
  FiSmartphone,
  FiUnlock,
  FiUserCheck,
  FiUsers,
  FiXCircle,
} from "react-icons/fi";
import { usePermissions } from "../security/PermissionContext";
import { listActiveStaffAll } from "../services/bookingDataSourceCompat";
import { CoreHrService } from "../services/CoreHrService";
import {
  getPermissionPayrollSummary,
  type EmployeePermissionRequest,
} from "../services/employeePermissionRequests";
import type { CoreResolvedShift } from "../types/hrCoreApi";
import {
  fetchAttendanceSecurityDashboard,
  updateAttendanceDeviceStatus,
  updateAttendanceSecurityEventStatus,
  type AttendanceDeviceAssignment,
  type AttendanceSecurityDashboard,
  type AttendanceSecurityDevice,
  type AttendanceSecurityEvent,
  type AttendanceWorkerRecord,
} from "../services/attendanceWorkerService";
import { permissionIntervalsFromRequests } from "../helpers/hr/permissionAttendance";
import {
  calculateAttendanceDisciplineDay,
  formatAttendanceHours,
  formatSignedAttendanceHours,
  normalizeAttendanceTimeHHMM,
  riyadhDateKeyFromTimestamp,
  summarizeAttendanceDisciplineMonth,
  type AttendanceDayStatus,
  type AttendanceDisciplineDaySummary,
} from "../helpers/hr/attendanceDiscipline";
import {
  exportAttendanceReportExcel,
  exportAttendanceReportPdf,
  type AttendanceReportRowInput,
} from "../helpers/reports/exportAttendanceReport";
import {
  DashboardDatePickerV2,
  DashboardDrawerV2,
  DashboardEmptyStateV2,
  DashboardErrorStateV2,
  DashboardSkeletonV2,
  DashboardSelectV2,
  type DashboardSelectOptionV2,
} from "../components/dashboard-v2";

type AttendanceTab = "discipline" | "overview" | "records" | "devices" | "alerts" | "zones";
type RecordResultFilter = "all" | "allowed" | "rejected";
type RecordTypeFilter = "all" | "check_in" | "check_out";

type AttendanceDisciplineRow = AttendanceReportRowInput;

const RECORD_RESULT_FILTER_OPTIONS: DashboardSelectOptionV2[] = [
  { value: "all", label: "كل النتائج" },
  { value: "allowed", label: "المقبولة" },
  { value: "rejected", label: "المرفوضة" },
];

const RECORD_TYPE_FILTER_OPTIONS: DashboardSelectOptionV2[] = [
  { value: "all", label: "حضور وانصراف" },
  { value: "check_in", label: "حضور" },
  { value: "check_out", label: "انصراف" },
];

type FriendlyDeviceInput = {
  userAgent?: unknown;
  platform?: unknown;
  appVariant?: unknown;
};

const ATTENDANCE_AR_LOCALE = "ar-SA-u-ca-gregory-nu-latn";

const EMPTY_DASHBOARD: AttendanceSecurityDashboard = {
  summary: {
    date: "",
    punchesToday: 0,
    checkInsToday: 0,
    checkOutsToday: 0,
    rejectedToday: 0,
    checkedInNow: 0,
    newDevicesToday: 0,
    sharedDevices: 0,
    openAlerts: 0,
    averageAccuracy: null,
  },
  records: [],
  devices: [],
  alerts: [],
  zones: [],
};

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function initialFromDate() {
  const date = new Date();
  date.setDate(date.getDate() - 6);
  return localDateKey(date);
}

function parseAttendanceTimestamp(value?: string | null) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function formatDateTime(value?: string | null) {
  const date = parseAttendanceTimestamp(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(ATTENDANCE_AR_LOCALE, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatRecordDate(value?: string | null) {
  const date = parseAttendanceTimestamp(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(ATTENDANCE_AR_LOCALE, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function formatRecordTime(value?: string | null) {
  const date = parseAttendanceTimestamp(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(ATTENDANCE_AR_LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function shortDeviceId(value?: string | null) {
  const text = String(value || "").trim();
  if (!text) return "بدون معرّف";
  if (text.length <= 20) return text;
  return `${text.slice(0, 10)}…${text.slice(-6)}`;
}

function recordTypeLabel(value: string) {
  return value === "check_out" ? "انصراف" : "حضور";
}

function recordResultLabel(value: string) {
  return value === "allowed" ? "مقبولة" : "مرفوضة";
}

function rejectionLabel(value?: string | null) {
  const labels: Record<string, string> = {
    poor_accuracy: "دقة الموقع ضعيفة",
    outside_zone: "خارج نطاق العمل",
    zone_not_assigned: "لا يوجد نطاق مخصص",
    zone_not_found: "نطاق العمل غير موجود",
    attendance_zone_mismatch: "النطاق لا يطابق الموظفة",
    duplicate_check_in: "تم تسجيل الحضور مسبقًا",
    not_checked_in: "لا يوجد حضور سابق",
    blocked_device: "الجهاز محظور",
  };
  return labels[String(value || "")] || String(value || "—");
}

function deviceStatusLabel(value: string) {
  if (value === "trusted") return "معتمد";
  if (value === "blocked") return "محظور";
  return "جديد";
}

function deviceStatusDescription(value: string) {
  if (value === "trusted") return "جهاز معتمد ومسموح باستخدامه للبصمة.";
  if (value === "blocked") return "جهاز محظور، وستُرفض أي بصمة جديدة منه.";
  return "جهاز جديد — لم يتم اعتماده بعد.";
}

function eventTypeLabel(value: string) {
  const labels: Record<string, string> = {
    new_device: "جهاز جديد",
    device_changed: "تغيير جهاز",
    shared_device: "جهاز مشترك",
    blocked_device_attempt: "محاولة من جهاز محظور",
    rejected_punch: "بصمة مرفوضة",
    poor_accuracy: "دقة ضعيفة",
  };
  return labels[value] || value;
}

function searchable(search: string, values: unknown[]) {
  const needle = search.trim().toLocaleLowerCase("ar");
  if (!needle) return true;
  return values.some((value) =>
    String(value || "").toLocaleLowerCase("ar").includes(needle)
  );
}

function deviceIdOf(record: AttendanceWorkerRecord) {
  return String(record.deviceInfo?.deviceId || "").trim();
}

function resolveStaffName(
  record: Pick<AttendanceWorkerRecord, "employeeUid" | "employeeDocId" | "employeeName">,
  staffNames: Map<string, string>
) {
  return (
    record.employeeName ||
    staffNames.get(record.employeeUid) ||
    staffNames.get(record.employeeDocId) ||
    record.employeeDocId ||
    record.employeeUid ||
    "موظفة غير معروفة"
  );
}

function resolveAssignmentName(
  assignment: AttendanceDeviceAssignment,
  staffNames: Map<string, string>
) {
  return (
    assignment.employeeName ||
    staffNames.get(assignment.employeeUid) ||
    staffNames.get(String(assignment.employeeDocId || "")) ||
    assignment.employeeDocId ||
    assignment.employeeUid ||
    "موظفة غير معروفة"
  );
}

function deviceEmployeeNames(
  device: AttendanceSecurityDevice,
  staffNames: Map<string, string>
) {
  return Array.from(
    new Set(device.assignments.map((assignment) => resolveAssignmentName(assignment, staffNames)))
  );
}

function primaryDeviceEmployeeName(
  device: AttendanceSecurityDevice,
  staffNames: Map<string, string>
) {
  const assignment =
    device.assignments.find((item) => item.isPrimary) || device.assignments[0];
  return assignment
    ? resolveAssignmentName(assignment, staffNames)
    : "لم يتم ربط الجهاز بموظفة";
}

function friendlyDeviceLabel(device: FriendlyDeviceInput) {
  const userAgent = String(device.userAgent || "");
  const platform = String(device.platform || "").trim();
  const lowerAgent = userAgent.toLowerCase();
  const lowerPlatform = platform.toLowerCase();

  let hardware = "جهاز غير معروف";

  if (lowerAgent.includes("iphone")) {
    hardware = "iPhone";
  } else if (lowerAgent.includes("ipad")) {
    hardware = "iPad";
  } else if (lowerAgent.includes("android")) {
    const modelMatch = userAgent.match(/;\s*([^;()]+?)\s+Build\//i);
    const model = String(modelMatch?.[1] || "").trim();
    if (/^SM-/i.test(model)) hardware = `Samsung ${model}`;
    else if (/^Pixel/i.test(model)) hardware = `Google ${model}`;
    else if (model && !/^wv$/i.test(model)) hardware = model;
    else hardware = "هاتف Android";
  } else if (lowerAgent.includes("windows") || lowerPlatform.includes("win")) {
    hardware = "جهاز Windows";
  } else if (lowerAgent.includes("macintosh") || lowerPlatform.includes("mac")) {
    hardware = "جهاز Mac";
  } else if (lowerPlatform.includes("linux arm")) {
    hardware = "هاتف Android";
  } else if (platform) {
    hardware = platform;
  }

  const variant = String(device.appVariant || "web").trim().toLowerCase();
  const surface =
    variant === "staff"
      ? "تطبيق الموظفات"
      : variant === "web"
        ? "متصفح الويب"
        : variant || "واجهة غير معروفة";

  return `${hardware} · ${surface}`;
}

function friendlyDeviceName(device: AttendanceSecurityDevice) {
  return friendlyDeviceLabel(device);
}

function recordDevicePresentation(
  record: AttendanceWorkerRecord,
  devicesById: Map<string, AttendanceSecurityDevice>
) {
  const info = record.deviceInfo || {};
  const device = devicesById.get(deviceIdOf(record));
  const hasRisk =
    info.deviceChanged === true ||
    info.isNewDevice === true ||
    Boolean(info.sharedDevice) ||
    device?.trustStatus === "blocked";

  const label = friendlyDeviceLabel({
    userAgent: info.userAgent || device?.userAgent,
    platform: info.platform || device?.platform,
    appVariant: info.appVariant || device?.appVariant,
  });

  let status = "جهاز مسجل";
  if (device?.trustStatus === "blocked") status = "جهاز محظور";
  else if (Boolean(info.sharedDevice)) status = "جهاز مشترك";
  else if (info.deviceChanged === true) status = "تم تغيير الجهاز";
  else if (device?.trustStatus === "trusted") status = "جهاز معتمد";
  else if (device?.trustStatus === "new" || info.isNewDevice === true) {
    status = "جهاز غير معتمد";
  }

  return { label, status, hasRisk };
}



function staffIdentityKeys(row: Record<string, unknown>) {
  const keys = [
    row.id,
    row.uid,
    row.employeeUid,
    row.employeeId,
    row.employeeDocId,
    row.linkedUid,
    row.linkedEmployeeId,
    row.linkedEmployeeDocId,
    row.linkedUserUid,
    row.authUid,
    row.userId,
  ];
  return Array.from(
    new Set(keys.map((key) => String(key || "").trim()).filter(Boolean))
  );
}







function attendanceShiftKey(employeeId: string, date: string) {
  return `${employeeId}:${date}`;
}

function parseResolvedShiftSnapshot(row?: CoreResolvedShift | null) {
  const raw = String((row as any)?.snapshotJson || (row as any)?.snapshot_json || "").trim();
  if (!raw) return {} as Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {} as Record<string, unknown>;
  }
}

function resolvedShiftTime(row: CoreResolvedShift, snapshot: Record<string, unknown>, kind: "start" | "end") {
  const values = kind === "start"
    ? [
        (row as any).startTime,
        (row as any).start_time,
        (row as any).templateStartTime,
        (row as any).template_start_time,
        snapshot.startTime,
        snapshot.start_time,
      ]
    : [
        (row as any).endTime,
        (row as any).end_time,
        (row as any).templateEndTime,
        (row as any).template_end_time,
        snapshot.endTime,
        snapshot.end_time,
      ];
  for (const value of values) {
    const normalized = normalizeAttendanceTimeHHMM(String(value || ""));
    if (normalized) return normalized;
  }
  return "";
}

function readPolicyMinutes(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return Math.round(number);
  }
  return undefined;
}

function resolveCoreAttendanceSchedule(
  row: CoreResolvedShift | null | undefined
) {
  const unavailable = (note: string) => ({
    available: false,
    enabled: false,
    start: undefined,
    end: undefined,
    lateGraceMinutes: 0,
    earlyLeaveGraceMinutes: 0,
    label: "\u063a\u064a\u0631 \u0645\u062a\u0627\u062d",
    note,
  });

  const source = String(
    (row as any)?.source || ""
  ).trim();

  if (!row || !source) {
    return unavailable(
      "\u062a\u0639\u0630\u0631 \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0634\u0641\u062a \u0627\u0644\u0645\u0639\u062a\u0645\u062f \u0645\u0646 Core"
    );
  }

  if (source === "none") {
    return {
      available: true,
      enabled: false,
      start: undefined,
      end: undefined,
      lateGraceMinutes: 0,
      earlyLeaveGraceMinutes: 0,
      label: "\u063a\u064a\u0631 \u0645\u062c\u062f\u0648\u0644",
      note: "\u0644\u0627 \u064a\u0648\u062c\u062f \u0634\u0641\u062a \u0645\u0646\u0634\u0648\u0631 \u0641\u064a Core",
    };
  }

  const exceptionType = String(
    (row as any)?.exceptionType ||
      (row as any)?.exception_type ||
      ""
  ).trim();

  if (
    exceptionType === "off" ||
    (
      source === "weekly_schedule" &&
      Number((row as any)?.active) !== 1
    )
  ) {
    return {
      available: true,
      enabled: false,
      start: undefined,
      end: undefined,
      lateGraceMinutes: 0,
      earlyLeaveGraceMinutes: 0,
      label: "\u063a\u064a\u0631 \u0645\u062c\u062f\u0648\u0644",
      note: "\u0627\u0633\u062a\u062b\u0646\u0627\u0621 \u0645\u0646\u0634\u0648\u0631 \u0641\u064a Core",
    };
  }

  const snapshot = parseResolvedShiftSnapshot(row);
  const start = resolvedShiftTime(
    row,
    snapshot,
    "start"
  );
  const end = resolvedShiftTime(
    row,
    snapshot,
    "end"
  );

  if (!start || !end) {
    return unavailable(
      "\u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u0634\u0641\u062a \u0627\u0644\u0645\u0639\u062a\u0645\u062f \u0645\u0646 Core \u063a\u064a\u0631 \u0645\u0643\u062a\u0645\u0644\u0629"
    );
  }

  return {
    available: true,
    enabled: true,
    start,
    end,
    lateGraceMinutes:
      readPolicyMinutes(
        (row as any)?.lateGraceMinutes,
        (row as any)?.late_grace_minutes,
        snapshot.lateGraceMinutes,
        snapshot.late_grace_minutes
      ) ?? 0,
    earlyLeaveGraceMinutes: 0,
    label: `${start} - ${end}`,
    note:
      source === "exception"
        ? "\u0627\u0633\u062a\u062b\u0646\u0627\u0621 \u0645\u0646\u0634\u0648\u0631 \u0641\u064a Core"
        : "\u0634\u0641\u062a \u0645\u0646\u0634\u0648\u0631 \u0641\u064a Core",
  };
}

function actualWorkedHoursFromPunches(
  checkInAt?: string,
  checkOutAt?: string
) {
  const start = Date.parse(String(checkInAt || ""));
  const end = Date.parse(String(checkOutAt || ""));

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end < start
  ) {
    return 0;
  }

  return Math.round(
    ((end - start) / 3600000) * 100
  ) / 100;
}

function unavailableScheduleSummary(input: {
  date: string;
  checkInAt?: string;
  checkOutAt?: string;
}): AttendanceDisciplineDaySummary {
  return {
    date: input.date,
    scheduledHours: 0,
    actualWorkedHours: actualWorkedHoursFromPunches(
      input.checkInAt,
      input.checkOutAt
    ),
    lateHours: 0,
    earlyLeaveHours: 0,
    compensatedLateHours: 0,
    rawMissingHours: 0,
    permissionRequestedHours: 0,
    permissionCoveredHours: 0,
    missingHours: 0,
    extraHours: 0,
    afterScheduleHours: 0,
    netHourDifference: 0,
    status: "schedule_unavailable",
    statusLabel: "\u0627\u0644\u062f\u0648\u0627\u0645 \u0627\u0644\u0645\u0639\u062a\u0645\u062f \u063a\u064a\u0631 \u0645\u062a\u0627\u062d",
  };
}

function disciplineStatusTone(status: AttendanceDayStatus) {
  if (status === "absent" || status === "missing_hours" || status === "incomplete") {
    return "danger";
  }
  if (status === "schedule_unavailable") return "warning";
  if (status === "in_progress") return "active";
  if (
    status === "complete_with_permission" ||
    status === "complete_with_compensated_late" ||
    status === "complete_with_extra_hours" ||
    status === "compensated_late_with_extra_hours" ||
    status === "off_day_work"
  ) {
    return "warning";
  }
  if (status === "off_day" || status === "leave") return "muted";
  return "ok";
}

export default function DashboardAttendanceSecurity() {
  const { hasPermission } = usePermissions();
  const canManageDevices = hasPermission("attendance.settings.manage");
  const canResolveAlerts =
    hasPermission("attendance.records.update") || canManageDevices;

  const [activeTab, setActiveTab] = useState<AttendanceTab>("discipline");
  const [dashboard, setDashboard] = useState<AttendanceSecurityDashboard>(EMPTY_DASHBOARD);
  const [staffNames, setStaffNames] = useState<Map<string, string>>(new Map());
  const [coreResolvedShifts, setCoreResolvedShifts] = useState<Record<string, CoreResolvedShift | null>>({});
  const [permissionEntriesByEmployee, setPermissionEntriesByEmployee] = useState<Record<string, EmployeePermissionRequest[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState(initialFromDate);
  const [toDate, setToDate] = useState(() => localDateKey(new Date()));
  const [resultFilter, setResultFilter] = useState<RecordResultFilter>("all");
  const [typeFilter, setTypeFilter] = useState<RecordTypeFilter>("all");
  const [selectedRecord, setSelectedRecord] = useState<AttendanceWorkerRecord | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<AttendanceSecurityDevice | null>(null);
  const [busyKey, setBusyKey] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [result, staffResult] = await Promise.allSettled([
        fetchAttendanceSecurityDashboard({
          fromDate,
          toDate,
          alertStatus: "open",
          limit: 200,
        }),
        listActiveStaffAll(),
      ]);

      if (result.status === "rejected") throw result.reason;
      setDashboard(result.value);

      const attendancePairs = new Map<string, { employeeId: string; date: string }>();
      for (const record of result.value.records) {
        if (record.result !== "allowed") continue;
        const employeeId = String(record.employeeDocId || record.employeeUid || "").trim();
        const date = riyadhDateKeyFromTimestamp(record.serverTime);
        if (!employeeId || !date) continue;
        attendancePairs.set(attendanceShiftKey(employeeId, date), { employeeId, date });
      }

      const employeeIds = Array.from(
        new Set(Array.from(attendancePairs.values()).map((item) => item.employeeId))
      );
      const [resolvedShiftPairs, permissionPairs] = await Promise.all([
        Promise.all(
          Array.from(attendancePairs.values()).map(async ({ employeeId, date }) => {
            try {
              return [
                attendanceShiftKey(employeeId, date),
                await CoreHrService.resolveEmployeeShift(employeeId, date),
              ] as const;
            } catch (contextError) {
              console.warn("attendance discipline Core context load failed", {
                kind: "resolved-shift",
                employeeId,
                date,
                error: contextError,
              });
              return [attendanceShiftKey(employeeId, date), null] as const;
            }
          })
        ),
        Promise.all(
          employeeIds.map(async (employeeId) => {
            try {
              const summary = await getPermissionPayrollSummary({
                employeeId,
                fromDate,
                toDate,
              });
              return [employeeId, summary.entries || []] as const;
            } catch (contextError) {
              console.warn("attendance discipline Core context load failed", {
                kind: "permissions",
                employeeId,
                fromDate,
                toDate,
                error: contextError,
              });
              return [employeeId, [] as EmployeePermissionRequest[]] as const;
            }
          })
        ),
      ]);
      setCoreResolvedShifts(Object.fromEntries(resolvedShiftPairs));
      setPermissionEntriesByEmployee(Object.fromEntries(permissionPairs));

      if (staffResult.status === "fulfilled" && Array.isArray(staffResult.value)) {
        const next = new Map<string, string>();
        for (const row of staffResult.value as Array<Record<string, unknown>>) {
          const name = String(
            row.name || row.displayName || row.fullName || row.title || ""
          ).trim();
          for (const id of staffIdentityKeys(row)) {
            if (name) next.set(id, name);
          }
        }
        setStaffNames(next);
      }
    } catch (loadError: any) {
      setError(String(loadError?.message || "تعذر تحميل مركز متابعة البصمة."));
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const devicesById = useMemo(
    () => new Map(dashboard.devices.map((device) => [device.deviceId, device])),
    [dashboard.devices]
  );

  const visibleRecords = useMemo(
    () =>
      dashboard.records.filter((record) => {
        if (resultFilter !== "all" && record.result !== resultFilter) return false;
        if (typeFilter !== "all" && record.type !== typeFilter) return false;
        const deviceView = recordDevicePresentation(record, devicesById);
        return searchable(search, [
          resolveStaffName(record, staffNames),
          record.employeeUid,
          record.employeeDocId,
          record.zoneName,
          deviceIdOf(record),
          deviceView.label,
          deviceView.status,
          record.rejectionReason,
          recordTypeLabel(record.type),
          recordResultLabel(record.result),
        ]);
      }),
    [dashboard.records, devicesById, resultFilter, search, staffNames, typeFilter]
  );

  const visibleDevices = useMemo(
    () =>
      dashboard.devices.filter((device) =>
        searchable(search, [
          device.deviceId,
          device.platform,
          device.userAgent,
          device.appVariant,
          device.appVersion,
          device.screenSize,
          device.trustStatus,
          friendlyDeviceName(device),
          ...device.assignments.flatMap((assignment) => [
            assignment.employeeName,
            staffNames.get(assignment.employeeUid),
            assignment.employeeUid,
            assignment.employeeDocId,
          ]),
        ])
      ),
    [dashboard.devices, search, staffNames]
  );

  const visibleAlerts = useMemo(
    () =>
      dashboard.alerts.filter((event) =>
        searchable(search, [
          event.title,
          event.detail,
          event.eventType,
          event.deviceId,
          event.employeeName,
          staffNames.get(event.employeeUid),
          event.employeeUid,
          event.employeeDocId,
        ])
      ),
    [dashboard.alerts, search, staffNames]
  );

  const recentRiskRecords = useMemo(
    () =>
      dashboard.records.filter((record) => {
        const info = record.deviceInfo || {};
        return (
          record.result === "rejected" ||
          info.deviceChanged === true ||
          info.isNewDevice === true ||
          Boolean(info.sharedDevice)
        );
      }),
    [dashboard.records]
  );

  const disciplineRows = useMemo<AttendanceDisciplineRow[]>(() => {
    const grouped = new Map<
      string,
      {
        employeeId: string;
        date: string;
        records: AttendanceWorkerRecord[];
      }
    >();

    for (const record of dashboard.records) {
      if (record.result !== "allowed") continue;
      const date = riyadhDateKeyFromTimestamp(record.serverTime);
      const employeeId = String(record.employeeDocId || record.employeeUid || "").trim();
      if (!date || !employeeId) continue;
      const key = `${employeeId}:${date}`;
      const current = grouped.get(key) || { employeeId, date, records: [] };
      current.records.push(record);
      grouped.set(key, current);
    }

    const rows = Array.from(grouped.values()).map((group) => {
      const records = [...group.records].sort(
        (left, right) => Date.parse(left.serverTime) - Date.parse(right.serverTime)
      );
      const firstCheckIn = records.find((record) => record.type === "check_in");
      const lastCheckOut = [...records]
        .reverse()
        .find((record) => record.type === "check_out");
      const firstRecord = records[0];
      const schedule = resolveCoreAttendanceSchedule(
        coreResolvedShifts[
          attendanceShiftKey(
            group.employeeId,
            group.date
          )
        ]
      );
      const permissionIntervals = permissionIntervalsFromRequests(
        permissionEntriesByEmployee[group.employeeId],
        group.date
      );
      const summary = schedule.available
        ? calculateAttendanceDisciplineDay({
            date: group.date,
            scheduledStart: schedule.start,
            scheduledEnd: schedule.end,
            lateGraceMinutes: schedule.lateGraceMinutes,
            earlyLeaveGraceMinutes:
              schedule.earlyLeaveGraceMinutes,
            isScheduledWorkDay: schedule.enabled,
            checkInAt: firstCheckIn?.serverTime,
            checkOutAt: lastCheckOut?.serverTime,
            permissionIntervals,
          })
        : unavailableScheduleSummary({
            date: group.date,
            checkInAt: firstCheckIn?.serverTime,
            checkOutAt: lastCheckOut?.serverTime,
          });

      return {
        key: `${group.employeeId}:${group.date}`,
        employeeName: firstRecord ? resolveStaffName(firstRecord, staffNames) : group.employeeId,
        employeeId: group.employeeId,
        date: group.date,
        shiftLabel: schedule.label,
        scheduleNote: schedule.note,
        firstCheckInAt: firstCheckIn?.serverTime,
        lastCheckOutAt: lastCheckOut?.serverTime,
        summary,
      };
    });

    return rows
      .filter((row) =>
        searchable(search, [
          row.employeeName,
          row.employeeId,
          row.date,
          row.shiftLabel,
          row.scheduleNote,
          row.summary.statusLabel,
        ])
      )
      .sort((left, right) => {
        const dateSort = right.date.localeCompare(left.date);
        if (dateSort !== 0) return dateSort;
        return left.employeeName.localeCompare(right.employeeName, "ar");
      });
  }, [
    coreResolvedShifts,
    dashboard.records,
    permissionEntriesByEmployee,
    search,
    staffNames,
  ]);

  const disciplineSummary = useMemo(
    () => summarizeAttendanceDisciplineMonth(disciplineRows.map((row) => row.summary)),
    [disciplineRows]
  );

  const attendanceReportInput = () => ({
    rows: disciplineRows,
    summary: disciplineSummary,
    filters: { fromDate, toDate, search },
  });

  const handleExportAttendancePdf = () => {
    exportAttendanceReportPdf(attendanceReportInput());
  };

  const handleExportAttendanceExcel = () => {
    exportAttendanceReportExcel(attendanceReportInput());
  };

  const setDeviceStatus = async (
    device: AttendanceSecurityDevice,
    trustStatus: "new" | "trusted" | "blocked"
  ) => {
    const key = `device:${device.deviceId}`;
    setBusyKey(key);
    setNotice("");
    try {
      await updateAttendanceDeviceStatus({
        deviceId: device.deviceId,
        trustStatus,
        notes: device.notes || "",
      });
      setNotice(
        trustStatus === "trusted"
          ? "تم اعتماد الجهاز."
          : trustStatus === "blocked"
            ? "تم حظر الجهاز، وستُرفض بصماته القادمة."
            : "تمت إعادة الجهاز إلى حالة جديد."
      );
      setSelectedDevice(null);
      await load();
    } catch (actionError: any) {
      setError(String(actionError?.message || "تعذر تحديث حالة الجهاز."));
    } finally {
      setBusyKey("");
    }
  };

  const setAlertStatus = async (
    event: AttendanceSecurityEvent,
    status: "resolved" | "ignored"
  ) => {
    const key = `alert:${event.id}`;
    setBusyKey(key);
    setNotice("");
    try {
      await updateAttendanceSecurityEventStatus({ eventId: event.id, status });
      setNotice(status === "resolved" ? "تمت معالجة التنبيه." : "تم تجاهل التنبيه.");
      await load();
    } catch (actionError: any) {
      setError(String(actionError?.message || "تعذر تحديث التنبيه."));
    } finally {
      setBusyKey("");
    }
  };

  const tabs: Array<{ id: AttendanceTab; label: string }> = [
    { id: "discipline", label: "الحضور والانضباط" },
    { id: "overview", label: "نظرة عامة" },
    { id: "records", label: "سجل البصمات" },
    { id: "devices", label: "الأجهزة" },
    { id: "alerts", label: "التنبيهات" },
    { id: "zones", label: "نطاقات العمل" },
  ];

  return (
    <section className="dsv2-page dsv2-attendance-page" dir="rtl">
      <header className="dsv2-page-head dsv2-attendance-heading">
        <div>
          <p className="dsv2-badge dsv2-badge--gold">Attendance D1</p>
          <h1 className="dsv2-page-title">الحضور والانضباط</h1>
          <p className="dsv2-page-subtitle">متابعة وقت الحضور والانصراف وفروقات الساعات من البصمات المقبولة حسب الدوام المعتمد.</p>
        </div>
        <button
          type="button"
          className="dsv2-btn dsv2-btn--secondary dsv2-attendance-refresh"
          onClick={() => void load()}
          disabled={loading}
        >
          <FiRefreshCw className={loading ? "is-spinning" : ""} />
          {loading ? "جاري التحديث" : "تحديث البيانات"}
        </button>
      </header>

      <div className="dsv2-attendance-shell dsv2-stack dsv2-stack--lg">
        <nav className="dsv2-card dsv2-card--padded dsv2-attendance-tabs" aria-label="أقسام سجل البصمة">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={activeTab === tab.id ? "is-active" : ""}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              {tab.id === "alerts" && dashboard.summary.openAlerts > 0 ? (
                <span className="dsv2-attendance-tab-count">{dashboard.summary.openAlerts}</span>
              ) : null}
            </button>
          ))}
        </nav>

        {notice ? <div className="dsv2-attendance-notice"><FiCheckCircle />{notice}</div> : null}
        {error ? (
          <DashboardErrorStateV2
            compact
            title="تعذر تحميل سجل البصمة"
            description={error}
            action={(
              <button type="button" className="dsv2-btn dsv2-btn--danger" onClick={() => void load()}>
                إعادة المحاولة
              </button>
            )}
          />
        ) : null}

        {!error && activeTab !== "overview" && activeTab !== "zones" ? (
          <div className="dsv2-filter-bar dsv2-attendance-toolbar">
            <label className="dsv2-field dsv2-attendance-search">
              <span className="dsv2-field__label">البحث</span>
              <span className="dsv2-attendance-search-control">
              <FiSearch />
              <input
                className="dsv2-input"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ابحث باسم الموظفة أو الجهاز أو النطاق أو الحالة..."
              />
              </span>
            </label>
            {activeTab === "discipline" || activeTab === "records" ? (
              <div className="dsv2-attendance-filters">
                <label className="dsv2-field">
                  <span className="dsv2-field__label">من تاريخ</span>
                  <DashboardDatePickerV2
                    id="attendance-from-date"
                    value={fromDate}
                    clearable={false}
                    onChange={setFromDate}
                  />
                </label>
                <label className="dsv2-field">
                  <span className="dsv2-field__label">إلى تاريخ</span>
                  <DashboardDatePickerV2
                    id="attendance-to-date"
                    value={toDate}
                    clearable={false}
                    onChange={setToDate}
                  />
                </label>
                {activeTab === "records" ? (
                  <>
                    <label className="dsv2-field">
                      <span className="dsv2-field__label">النتيجة</span>
                      <DashboardSelectV2
                        id="attendance-result-filter"
                        value={resultFilter}
                        options={RECORD_RESULT_FILTER_OPTIONS}
                        onChange={(value) => setResultFilter(value as RecordResultFilter)}
                      />
                    </label>
                    <label className="dsv2-field">
                      <span className="dsv2-field__label">العملية</span>
                      <DashboardSelectV2
                        id="attendance-type-filter"
                        value={typeFilter}
                        options={RECORD_TYPE_FILTER_OPTIONS}
                        onChange={(value) => setTypeFilter(value as RecordTypeFilter)}
                      />
                    </label>
                  </>
                ) : null}
              </div>
            ) : null}
            {activeTab === "discipline" ? (
              <div className="dsv2-attendance-export-actions" aria-label="تصدير تقرير الحضور والانضباط">
                <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={handleExportAttendancePdf} disabled={loading}>
                  <FiFileText /> تصدير PDF
                </button>
                <button type="button" className="dsv2-btn dsv2-btn--primary" onClick={handleExportAttendanceExcel} disabled={loading}>
                  <FiDownload /> تصدير Excel
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {loading ? (
          <div className="dsv2-card dsv2-card--padded dsv2-attendance-loading" role="status" aria-live="polite">
            <FiRefreshCw className="is-spinning" />
            <div>
              <strong>جاري تحميل بيانات الحضور</strong>
              <DashboardSkeletonV2 lines={2} />
            </div>
          </div>
        ) : null}

        {!error && activeTab === "discipline" ? (
          <>
            <div className="dsv2-grid--metrics dsv2-attendance-metrics dsv2-attendance-discipline-metrics">
              <article className="dsv2-metric-card dsv2-metric-card--gold"><span className="dsv2-metric-card__icon"><FiClock /></span><small className="dsv2-metric-card__label">ساعات الدوام المعتمدة</small><strong className="dsv2-metric-card__value">{formatAttendanceHours(disciplineSummary.totalScheduledHours)}</strong></article>
              <article className="dsv2-metric-card dsv2-metric-card--success"><span className="dsv2-metric-card__icon"><FiActivity /></span><small className="dsv2-metric-card__label">ساعات العمل الفعلية</small><strong className="dsv2-metric-card__value">{formatAttendanceHours(disciplineSummary.totalActualWorkedHours)}</strong></article>
              <article className="dsv2-metric-card dsv2-metric-card--danger"><span className="dsv2-metric-card__icon"><FiAlertTriangle /></span><small className="dsv2-metric-card__label">التأخير الفعلي</small><strong className="dsv2-metric-card__value">{formatAttendanceHours(disciplineSummary.totalLateHours)}</strong></article>
              <article className="dsv2-metric-card dsv2-metric-card--success"><span className="dsv2-metric-card__icon"><FiCheck /></span><small className="dsv2-metric-card__label">التعويض بعد الدوام</small><strong className="dsv2-metric-card__value">{formatAttendanceHours(disciplineSummary.totalCompensatedLateHours)}</strong></article>
              <article className="dsv2-metric-card dsv2-metric-card--gold"><span className="dsv2-metric-card__icon"><FiCheckCircle /></span><small className="dsv2-metric-card__label">الاستئذان المحتسب</small><strong className="dsv2-metric-card__value">{formatAttendanceHours(disciplineSummary.totalPermissionCoveredHours || 0)}</strong></article>
              <article className="dsv2-metric-card dsv2-metric-card--danger"><span className="dsv2-metric-card__icon"><FiXCircle /></span><small className="dsv2-metric-card__label">نقص الساعات</small><strong className="dsv2-metric-card__value">{formatAttendanceHours(disciplineSummary.totalMissingHours)}</strong></article>
              <article className="dsv2-metric-card dsv2-metric-card--gold"><span className="dsv2-metric-card__icon"><FiClock /></span><small className="dsv2-metric-card__label">زيادة الساعات</small><strong className="dsv2-metric-card__value">{formatAttendanceHours(disciplineSummary.totalExtraHours)}</strong></article>
            </div>

            <div className="dsv2-table-card dsv2-table-scroll dsv2-attendance-table-wrap dsv2-attendance-discipline-table-wrap">
              <table className="dsv2-table dsv2-attendance-table dsv2-attendance-discipline-table">
                <thead>
                  <tr>
                    <th>الموظفة</th>
                    <th>التاريخ</th>
                    <th>الدوام المعتمد</th>
                    <th>أول حضور</th>
                    <th>آخر انصراف</th>
                    <th>مدة العمل الفعلية</th>
                    <th>التأخير الفعلي</th>
                    <th>التعويض بعد الدوام</th>
                    <th>الاستئذان المحتسب</th>
                    <th>نقص الساعات</th>
                    <th>زيادة الساعات</th>
                    <th>صافي فرق الساعات</th>
                    <th>الحالة الإدارية لليوم</th>
                  </tr>
                </thead>
                <tbody>
                  {disciplineRows.map((row) => {
                    const tone = disciplineStatusTone(row.summary.status);
                    return (
                      <tr key={row.key} className={`is-discipline-${tone}`}>
                        <td><strong className="dsv2-table__primary">{row.employeeName}</strong><small className="dsv2-table__secondary">{row.employeeId}</small></td>
                        <td><strong className="dsv2-table__primary">{formatRecordDate(`${row.date}T00:00:00+03:00`)}</strong><small className="dsv2-table__secondary" dir="ltr">{row.date}</small></td>
                        <td><strong className="dsv2-table__primary" dir="ltr">{row.shiftLabel}</strong><small className="dsv2-table__secondary">{row.scheduleNote}</small></td>
                        <td><strong dir="ltr">{formatRecordTime(row.firstCheckInAt)}</strong></td>
                        <td><strong dir="ltr">{formatRecordTime(row.lastCheckOutAt)}</strong></td>
                        <td>{formatAttendanceHours(row.summary.actualWorkedHours)}</td>
                        <td>{formatAttendanceHours(row.summary.lateHours)}</td>
                        <td>{formatAttendanceHours(row.summary.compensatedLateHours)}</td>
                        <td>{formatAttendanceHours(row.summary.permissionCoveredHours || 0)}</td>
                        <td>{formatAttendanceHours(row.summary.missingHours)}</td>
                        <td>{formatAttendanceHours(row.summary.extraHours)}</td>
                        <td>{formatSignedAttendanceHours(row.summary.netHourDifference)}</td>
                        <td><span className={`dsv2-badge dsv2-attendance-discipline-status is-${tone}`}>{row.summary.statusLabel}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="dsv2-attendance-discipline-mobile-list" aria-label="سجل الحضور والانضباط للجوال">
              {disciplineRows.map((row) => {
                const tone = disciplineStatusTone(row.summary.status);
                return (
                  <article key={row.key} className={`dsv2-card dsv2-card--padded dsv2-attendance-discipline-mobile-card is-${tone}`}>
                    <header>
                      <div>
                        <strong>{row.employeeName}</strong>
                        <small>{row.employeeId}</small>
                      </div>
                      <span className={`dsv2-badge dsv2-attendance-discipline-status is-${tone}`}>{row.summary.statusLabel}</span>
                    </header>

                    <div className="dsv2-attendance-discipline-mobile-date">
                      <strong>{formatRecordDate(`${row.date}T00:00:00+03:00`)}</strong>
                      <small dir="ltr">{row.date}</small>
                    </div>

                    <div className="dsv2-attendance-discipline-mobile-shift">
                      <span>الدوام المعتمد</span>
                      <strong dir="ltr">{row.shiftLabel}</strong>
                      <small>{row.scheduleNote}</small>
                    </div>

                    <div className="dsv2-attendance-discipline-mobile-times">
                      <div>
                        <span>أول حضور</span>
                        <strong dir="ltr">{formatRecordTime(row.firstCheckInAt)}</strong>
                      </div>
                      <div>
                        <span>آخر انصراف</span>
                        <strong dir="ltr">{formatRecordTime(row.lastCheckOutAt)}</strong>
                      </div>
                    </div>

                    <dl className="dsv2-attendance-discipline-mobile-metrics">
                      <div><dt>العمل الفعلي</dt><dd>{formatAttendanceHours(row.summary.actualWorkedHours)}</dd></div>
                      <div><dt>التأخير</dt><dd>{formatAttendanceHours(row.summary.lateHours)}</dd></div>
                      <div><dt>التعويض</dt><dd>{formatAttendanceHours(row.summary.compensatedLateHours)}</dd></div>
                      <div><dt>الاستئذان</dt><dd>{formatAttendanceHours(row.summary.permissionCoveredHours || 0)}</dd></div>
                      <div><dt>النقص</dt><dd>{formatAttendanceHours(row.summary.missingHours)}</dd></div>
                      <div><dt>الزيادة</dt><dd>{formatAttendanceHours(row.summary.extraHours)}</dd></div>
                      <div className="is-wide"><dt>صافي فرق الساعات</dt><dd>{formatSignedAttendanceHours(row.summary.netHourDifference)}</dd></div>
                    </dl>
                  </article>
                );
              })}
            </div>

            {!loading && !disciplineRows.length ? (
              <DashboardEmptyStateV2
                compact
                title="لا توجد سجلات حضور مكتملة أو مطابقة للفترة المحددة."
              />
            ) : null}
          </>
        ) : null}

        {!error && activeTab === "overview" ? (
          <>
            <div className="dsv2-grid--metrics dsv2-attendance-metrics">
              <article className="dsv2-metric-card dsv2-metric-card--gold"><span className="dsv2-metric-card__icon"><FiActivity /></span><small className="dsv2-metric-card__label">بصمات اليوم</small><strong className="dsv2-metric-card__value">{dashboard.summary.punchesToday}</strong></article>
              <article className="dsv2-metric-card dsv2-metric-card--success"><span className="dsv2-metric-card__icon"><FiUserCheck /></span><small className="dsv2-metric-card__label">داخل الدوام الآن</small><strong className="dsv2-metric-card__value">{dashboard.summary.checkedInNow}</strong></article>
              <article className="dsv2-metric-card dsv2-metric-card--danger"><span className="dsv2-metric-card__icon"><FiXCircle /></span><small className="dsv2-metric-card__label">مرفوضة اليوم</small><strong className="dsv2-metric-card__value">{dashboard.summary.rejectedToday}</strong></article>
              <article className="dsv2-metric-card dsv2-metric-card--gold"><span className="dsv2-metric-card__icon"><FiSmartphone /></span><small className="dsv2-metric-card__label">أجهزة جديدة</small><strong className="dsv2-metric-card__value">{dashboard.summary.newDevicesToday}</strong></article>
              <article className="dsv2-metric-card dsv2-metric-card--gold"><span className="dsv2-metric-card__icon"><FiUsers /></span><small className="dsv2-metric-card__label">أجهزة مشتركة</small><strong className="dsv2-metric-card__value">{dashboard.summary.sharedDevices}</strong></article>
              <article className="dsv2-metric-card dsv2-metric-card--danger"><span className="dsv2-metric-card__icon"><FiShield /></span><small className="dsv2-metric-card__label">تنبيهات مفتوحة</small><strong className="dsv2-metric-card__value">{dashboard.summary.openAlerts}</strong></article>
            </div>

            <div className="dsv2-grid--2 dsv2-attendance-overview-grid">
              <article className="dsv2-card dsv2-card--padded dsv2-attendance-panel">
                <header><div><h2>آخر عمليات البصمة</h2><p>أحدث الحركات المقبولة والمرفوضة.</p></div><button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => setActiveTab("records")}>السجل الكامل</button></header>
                <div className="dsv2-attendance-compact-list">
                  {dashboard.records.slice(0, 7).map((record) => (
                    <button key={record.id} type="button" onClick={() => setSelectedRecord(record)}>
                      <span className={`dsv2-attendance-record-icon is-${record.result}`}><FiActivity /></span>
                      <span><strong>{resolveStaffName(record, staffNames)}</strong><small>{recordTypeLabel(record.type)} · {formatDateTime(record.serverTime)}</small></span>
                      <em className={`is-${record.result}`}>{recordResultLabel(record.result)}</em>
                    </button>
                  ))}
                  {!loading && !dashboard.records.length ? <DashboardEmptyStateV2 compact title="لا توجد عمليات بصمة في الفترة المحددة." /> : null}
                </div>
              </article>

              <article className="dsv2-card dsv2-card--padded dsv2-attendance-panel">
                <header><div><h2>تحتاج مراجعة</h2><p>جهاز جديد، تغيير جهاز، مشاركة أو رفض.</p></div><button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => setActiveTab("alerts")}>كل التنبيهات</button></header>
                <div className="dsv2-attendance-compact-list">
                  {recentRiskRecords.slice(0, 7).map((record) => {
                    const deviceView = recordDevicePresentation(record, devicesById);
                    return (
                      <button key={record.id} type="button" onClick={() => setSelectedRecord(record)}>
                        <span className="dsv2-attendance-record-icon is-risk"><FiAlertTriangle /></span>
                        <span><strong>{resolveStaffName(record, staffNames)}</strong><small>{record.rejectionReason ? rejectionLabel(record.rejectionReason) : "تغيير أو مشاركة جهاز"}</small></span>
                        <em>{deviceView.status}</em>
                      </button>
                    );
                  })}
                  {!loading && !recentRiskRecords.length ? <DashboardEmptyStateV2 compact title="لا توجد عمليات تحتاج مراجعة حاليًا." /> : null}
                </div>
              </article>
            </div>
          </>
        ) : null}

        {!error && activeTab === "records" ? (
          <>
            <div className="dsv2-table-card dsv2-table-scroll dsv2-attendance-table-wrap dsv2-attendance-records-table-wrap">
              <table className="dsv2-table dsv2-attendance-table">
                <thead><tr><th>الموظفة</th><th>العملية</th><th>الوقت</th><th>النطاق</th><th>الدقة</th><th>الجهاز</th><th>النتيجة</th><th>التفاصيل</th></tr></thead>
                <tbody>
                  {visibleRecords.map((record) => {
                    const deviceView = recordDevicePresentation(record, devicesById);
                    return (
                      <tr key={record.id} className={deviceView.hasRisk ? "is-risk" : ""}>
                        <td><strong className="dsv2-table__primary">{resolveStaffName(record, staffNames)}</strong><small className="dsv2-table__secondary">{record.employeeDocId || record.employeeUid}</small></td>
                        <td><span className={`dsv2-badge dsv2-attendance-kind is-${record.type}`}>{recordTypeLabel(record.type)}</span></td>
                        <td><strong className="dsv2-table__primary">{formatRecordDate(record.serverTime)}</strong><small className="dsv2-table__secondary" dir="ltr">{formatRecordTime(record.serverTime)}</small></td>
                        <td><strong className="dsv2-table__primary">{record.zoneName || "—"}</strong><small className="dsv2-table__secondary">{record.distanceMeters == null ? "" : `${Math.round(record.distanceMeters)} م`}</small></td>
                        <td>{Math.round(Number(record.location?.accuracy || 0))} م</td>
                        <td><strong className="dsv2-table__primary">{deviceView.label}</strong><small className={`dsv2-table__secondary${deviceView.hasRisk ? " is-warning" : ""}`}>{deviceView.status}</small></td>
                        <td><span className={`dsv2-badge dsv2-attendance-result is-${record.result}`}>{recordResultLabel(record.result)}</span>{record.rejectionReason ? <small className="dsv2-table__secondary">{rejectionLabel(record.rejectionReason)}</small> : null}</td>
                        <td><button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm dsv2-attendance-row-action" onClick={() => setSelectedRecord(record)}><FiEye />عرض</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="dsv2-attendance-records-mobile-list" aria-label="سجل البصمات للجوال">
              {visibleRecords.map((record) => {
                const deviceView = recordDevicePresentation(record, devicesById);
                return (
                  <article key={record.id} className={`dsv2-card dsv2-card--padded dsv2-attendance-record-mobile-card is-${record.result}${deviceView.hasRisk ? " is-risk" : ""}`}>
                    <header>
                      <span className={`dsv2-attendance-record-icon is-${record.result}`}>
                        <FiActivity />
                      </span>
                      <div>
                        <strong>{resolveStaffName(record, staffNames)}</strong>
                        <small>{record.employeeDocId || record.employeeUid}</small>
                      </div>
                      <span className={`dsv2-badge dsv2-attendance-result is-${record.result}`}>{recordResultLabel(record.result)}</span>
                    </header>

                    <div className="dsv2-attendance-record-mobile-main">
                      <div>
                        <span>العملية</span>
                        <strong>{recordTypeLabel(record.type)}</strong>
                      </div>
                      <div>
                        <span>الوقت</span>
                        <strong>{formatRecordTime(record.serverTime)}</strong>
                        <small>{formatRecordDate(record.serverTime)}</small>
                      </div>
                    </div>

                    <dl>
                      <div><dt>النطاق</dt><dd>{record.zoneName || "—"}</dd></div>
                      <div><dt>المسافة</dt><dd>{record.distanceMeters == null ? "—" : `${Math.round(record.distanceMeters)} م`}</dd></div>
                      <div><dt>دقة GPS</dt><dd>{Math.round(Number(record.location?.accuracy || 0))} م</dd></div>
                      <div><dt>الجهاز</dt><dd>{deviceView.status}</dd></div>
                    </dl>

                    {record.rejectionReason ? (
                      <p className="dsv2-attendance-record-mobile-reason">{rejectionLabel(record.rejectionReason)}</p>
                    ) : null}

                    <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-attendance-row-action" onClick={() => setSelectedRecord(record)}>
                      <FiEye /> عرض التفاصيل
                    </button>
                  </article>
                );
              })}
            </div>

            {!loading && !visibleRecords.length ? <DashboardEmptyStateV2 compact title="لا توجد بصمات مطابقة للفلاتر." /> : null}
          </>
        ) : null}

        {!error && activeTab === "devices" ? (
          <div className="dsv2-attendance-device-grid">
            {visibleDevices.map((device) => {
              const employeeNames = deviceEmployeeNames(device, staffNames);
              const primaryEmployee = primaryDeviceEmployeeName(device, staffNames);
              const isShared = employeeNames.length > 1;
              return (
                <article key={device.deviceId} className={`dsv2-card dsv2-card--padded dsv2-attendance-device-card is-${device.trustStatus}`}>
                  <header>
                    <span><FiSmartphone /></span>
                    <div className="dsv2-attendance-device-identity">
                      <strong>{primaryEmployee}</strong>
                      <small>{friendlyDeviceName(device)}</small>
                    </div>
                    <em className={`dsv2-badge dsv2-attendance-device-status is-${device.trustStatus}`}>{deviceStatusLabel(device.trustStatus)}</em>
                  </header>

                  <p className="dsv2-attendance-device-status-note">
                    {deviceStatusDescription(device.trustStatus)}
                  </p>

                  <dl>
                    <div className="dsv2-attendance-device-owner">
                      <dt>{isShared ? "الموظفات المستخدمات للجهاز" : "الموظفة المرتبطة بالجهاز"}</dt>
                      <dd>{employeeNames.length ? employeeNames.join("، ") : "لم يتم تحديد الموظفة"}</dd>
                    </div>
                    <div><dt>أول استخدام</dt><dd>{formatDateTime(device.firstSeenAt)}</dd></div>
                    <div><dt>آخر استخدام</dt><dd>{formatDateTime(device.lastSeenAt)}</dd></div>
                    <div><dt>عدد البصمات</dt><dd>{device.totalRecords}</dd></div>
                    <div><dt>حالة الاستخدام</dt><dd>{isShared ? `مشترك بين ${employeeNames.length} موظفات` : "تستخدمه موظفة واحدة"}</dd></div>
                  </dl>

                  <span className="dsv2-attendance-device-users-label">سجل الاستخدام حسب الموظفة</span>
                  <div className="dsv2-attendance-device-users">
                    {device.assignments.map((assignment) => (
                      <span key={`${assignment.employeeUid}:${assignment.employeeDocId || ""}`}>
                        {resolveAssignmentName(assignment, staffNames)}
                        <small>{assignment.recordsCount} بصمة</small>
                      </span>
                    ))}
                  </div>

                  <footer>
                    {canManageDevices ? (
                      <>
                        <button type="button" className="dsv2-btn dsv2-btn--success dsv2-btn--sm" disabled={busyKey === `device:${device.deviceId}` || device.trustStatus === "trusted"} onClick={() => void setDeviceStatus(device, "trusted")}><FiUnlock />اعتماد الجهاز</button>
                        <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" disabled={busyKey === `device:${device.deviceId}` || device.trustStatus === "blocked"} onClick={() => void setDeviceStatus(device, "blocked")}><FiLock />حظر الجهاز</button>
                        {device.trustStatus !== "new" ? <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={busyKey === `device:${device.deviceId}`} onClick={() => void setDeviceStatus(device, "new")}>إعادة للمراجعة</button> : null}
                      </>
                    ) : null}
                    <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => setSelectedDevice(device)}><FiEye />التفاصيل التقنية</button>
                  </footer>
                </article>
              );
            })}
            {!loading && !visibleDevices.length ? <DashboardEmptyStateV2 compact title="لا توجد أجهزة مطابقة للبحث." /> : null}
          </div>
        ) : null}

        {!error && activeTab === "alerts" ? (
          <div className="dsv2-attendance-alert-list">
            {visibleAlerts.map((event) => (
              <article key={event.id} className={`dsv2-card dsv2-card--padded is-${event.severity}`}>
                <span><FiAlertTriangle /></span>
                <div>
                  <header><strong>{event.title}</strong><em>{eventTypeLabel(event.eventType)}</em></header>
                  <p>{event.detail || "تنبيه أمني مرتبط بعملية بصمة."}</p>
                  <small>{event.employeeName || staffNames.get(event.employeeUid) || event.employeeDocId || event.employeeUid} · {formatDateTime(event.createdAt)} · {shortDeviceId(event.deviceId)}</small>
                </div>
                {canResolveAlerts ? (
                  <footer>
                    <button type="button" className="dsv2-btn dsv2-btn--success dsv2-btn--sm" disabled={busyKey === `alert:${event.id}`} onClick={() => void setAlertStatus(event, "resolved")}><FiCheck />تمت المعالجة</button>
                    <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={busyKey === `alert:${event.id}`} onClick={() => void setAlertStatus(event, "ignored")}>تجاهل</button>
                  </footer>
                ) : null}
              </article>
            ))}
            {!loading && !visibleAlerts.length ? <DashboardEmptyStateV2 compact title="لا توجد تنبيهات مفتوحة مطابقة للبحث." /> : null}
          </div>
        ) : null}

        {!error && activeTab === "zones" ? (
          <div className="dsv2-attendance-zone-grid">
            {dashboard.zones.map((zone) => (
              <article key={zone.id} className={`dsv2-card dsv2-card--padded${zone.active ? " is-active" : ""}`}>
                <span><FiMapPin /></span>
                <div><strong>{zone.name}</strong><small dir="ltr">{Number(zone.lat).toFixed(5)}, {Number(zone.lng).toFixed(5)}</small></div>
                <dl><div><dt>نصف القطر</dt><dd>{zone.radiusMeters} م</dd></div><div><dt>الحالة</dt><dd>{zone.active ? "مفعل" : "متوقف"}</dd></div></dl>
              </article>
            ))}
            {!loading && !dashboard.zones.length ? <DashboardEmptyStateV2 compact title="لا توجد نطاقات عمل مسجلة." /> : null}
          </div>
        ) : null}
      </div>

      {selectedRecord ? (
        <DashboardDrawerV2
          open={Boolean(selectedRecord)}
          onClose={() => setSelectedRecord(null)}
          eyebrow="تفاصيل العملية"
          title={`${recordTypeLabel(selectedRecord.type)} · ${resolveStaffName(selectedRecord, staffNames)}`}
          description={formatDateTime(selectedRecord.serverTime)}
          size="md"
          tone={selectedRecord.result === "rejected" ? "danger" : "success"}
        >
          <div className="dsv2-attendance-detail-status">
            <span className={`dsv2-badge dsv2-attendance-result is-${selectedRecord.result}`}>{recordResultLabel(selectedRecord.result)}</span>
            <strong>{formatDateTime(selectedRecord.serverTime)}</strong>
          </div>
          <dl className="dsv2-attendance-detail-list">
            <div><dt>رقم العملية</dt><dd dir="ltr">{selectedRecord.id}</dd></div>
            <div><dt>الموظفة</dt><dd>{resolveStaffName(selectedRecord, staffNames)}</dd></div>
            <div><dt>النطاق</dt><dd>{selectedRecord.zoneName || "—"}</dd></div>
            <div><dt>المسافة</dt><dd>{selectedRecord.distanceMeters == null ? "—" : `${Math.round(selectedRecord.distanceMeters)} متر`}</dd></div>
            <div><dt>دقة GPS</dt><dd>{Math.round(Number(selectedRecord.location?.accuracy || 0))} متر</dd></div>
            <div><dt>سبب الرفض</dt><dd>{selectedRecord.rejectionReason ? rejectionLabel(selectedRecord.rejectionReason) : "—"}</dd></div>
            <div><dt>معرف الجهاز</dt><dd dir="ltr">{deviceIdOf(selectedRecord) || "—"}</dd></div>
            <div><dt>المنصة</dt><dd>{String(selectedRecord.deviceInfo?.platform || "—")}</dd></div>
            <div><dt>المنطقة الزمنية</dt><dd>{String(selectedRecord.deviceInfo?.timeZone || "—")}</dd></div>
            <div><dt>تغيير الجهاز</dt><dd>{selectedRecord.deviceInfo?.deviceChanged === true ? "نعم" : "لا"}</dd></div>
          </dl>
          <a className="dsv2-btn dsv2-btn--primary dsv2-attendance-map-link" href={`https://www.google.com/maps?q=${selectedRecord.location.lat},${selectedRecord.location.lng}`} target="_blank" rel="noreferrer"><FiMapPin />فتح الموقع على الخريطة</a>
        </DashboardDrawerV2>
      ) : null}

      {selectedDevice ? (
        <DashboardDrawerV2
          open={Boolean(selectedDevice)}
          onClose={() => setSelectedDevice(null)}
          eyebrow="التفاصيل التقنية للجهاز"
          title={primaryDeviceEmployeeName(selectedDevice, staffNames)}
          description={friendlyDeviceName(selectedDevice)}
          size="md"
          tone={selectedDevice.trustStatus === "blocked" ? "danger" : selectedDevice.trustStatus === "trusted" ? "success" : "gold"}
        >
          <div className="dsv2-attendance-detail-status">
            <span className={`dsv2-badge dsv2-attendance-device-status is-${selectedDevice.trustStatus}`}>{deviceStatusLabel(selectedDevice.trustStatus)}</span>
            <strong>{friendlyDeviceName(selectedDevice)}</strong>
          </div>
          <dl className="dsv2-attendance-detail-list">
            <div><dt>معرف الجهاز</dt><dd dir="ltr">{selectedDevice.deviceId}</dd></div>
            <div><dt>المنصة</dt><dd>{selectedDevice.platform || "—"}</dd></div>
            <div><dt>واجهة التطبيق</dt><dd>{selectedDevice.appVariant || "—"}</dd></div>
            <div><dt>نسخة التطبيق</dt><dd>{selectedDevice.appVersion || "—"}</dd></div>
            <div><dt>حجم الشاشة</dt><dd>{selectedDevice.screenSize || "—"}</dd></div>
            <div><dt>اللغة</dt><dd>{selectedDevice.language || "—"}</dd></div>
            <div><dt>المنطقة الزمنية</dt><dd>{selectedDevice.timeZone || "—"}</dd></div>
            <div><dt>وضع التطبيق المستقل</dt><dd>{selectedDevice.standalone ? "نعم" : "لا"}</dd></div>
            <div><dt>أول استخدام</dt><dd>{formatDateTime(selectedDevice.firstSeenAt)}</dd></div>
            <div><dt>آخر استخدام</dt><dd>{formatDateTime(selectedDevice.lastSeenAt)}</dd></div>
            <div><dt>البصمات المقبولة</dt><dd>{selectedDevice.allowedRecords}</dd></div>
            <div><dt>البصمات المرفوضة</dt><dd>{selectedDevice.rejectedRecords}</dd></div>
            <div className="dsv2-attendance-detail-wide"><dt>User Agent</dt><dd dir="ltr">{selectedDevice.userAgent || "—"}</dd></div>
          </dl>
          <div className="dsv2-attendance-device-detail-users">
            {selectedDevice.assignments.map((assignment) => (
              <span key={`${assignment.employeeUid}:${assignment.employeeDocId || ""}`}>
                {resolveAssignmentName(assignment, staffNames)}
                <small>{assignment.recordsCount} بصمة · {assignment.allowedCount} مقبولة · {assignment.rejectedCount} مرفوضة</small>
              </span>
            ))}
          </div>
        </DashboardDrawerV2>
      ) : null}
    </section>
  );
}
