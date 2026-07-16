import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FiActivity,
  FiAlertTriangle,
  FiCheck,
  FiCheckCircle,
  FiClock,
  FiCpu,
  FiEye,
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
import {
  fetchAttendanceSecurityDashboard,
  updateAttendanceDeviceStatus,
  updateAttendanceSecurityEventStatus,
  type AttendanceSecurityDashboard,
  type AttendanceSecurityDevice,
  type AttendanceSecurityEvent,
  type AttendanceWorkerRecord,
} from "../services/attendanceWorkerService";
import "../styles/DashboardAttendanceSecurity.css";

type AttendanceTab = "overview" | "records" | "devices" | "alerts" | "zones";
type RecordResultFilter = "all" | "allowed" | "rejected";
type RecordTypeFilter = "all" | "check_in" | "check_out";

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

function formatDateTime(value?: string | null) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return "—";
  return new Intl.DateTimeFormat("ar-SA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
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
  if (value === "trusted") return "موثوق";
  if (value === "blocked") return "محظور";
  return "جديد";
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

export default function DashboardAttendanceSecurity() {
  const { hasPermission } = usePermissions();
  const canManageDevices = hasPermission("attendance.settings.manage");
  const canResolveAlerts =
    hasPermission("attendance.records.update") || canManageDevices;

  const [activeTab, setActiveTab] = useState<AttendanceTab>("overview");
  const [dashboard, setDashboard] = useState<AttendanceSecurityDashboard>(EMPTY_DASHBOARD);
  const [staffNames, setStaffNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState(initialFromDate);
  const [toDate, setToDate] = useState(() => localDateKey(new Date()));
  const [resultFilter, setResultFilter] = useState<RecordResultFilter>("all");
  const [typeFilter, setTypeFilter] = useState<RecordTypeFilter>("all");
  const [selectedRecord, setSelectedRecord] = useState<AttendanceWorkerRecord | null>(null);
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
          result: resultFilter === "all" ? undefined : resultFilter,
          type: typeFilter === "all" ? undefined : typeFilter,
          alertStatus: "open",
          limit: 150,
        }),
        listActiveStaffAll(),
      ]);

      if (result.status === "rejected") throw result.reason;
      setDashboard(result.value);

      if (staffResult.status === "fulfilled" && Array.isArray(staffResult.value)) {
        const next = new Map<string, string>();
        for (const row of staffResult.value as Array<Record<string, unknown>>) {
          const name = String(
            row.name || row.displayName || row.fullName || row.title || ""
          ).trim();
          if (!name) continue;
          const ids = [
            row.id,
            row.uid,
            row.employeeUid,
            row.employeeId,
            row.linkedUid,
            row.linkedEmployeeId,
            row.linkedUserUid,
          ];
          for (const rawId of ids) {
            const id = String(rawId || "").trim();
            if (id) next.set(id, name);
          }
        }
        setStaffNames(next);
      }
    } catch (loadError: any) {
      setError(String(loadError?.message || "تعذر تحميل مركز متابعة البصمة."));
    } finally {
      setLoading(false);
    }
  }, [fromDate, resultFilter, toDate, typeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleRecords = useMemo(
    () =>
      dashboard.records.filter((record) =>
        searchable(search, [
          resolveStaffName(record, staffNames),
          record.employeeUid,
          record.employeeDocId,
          record.zoneName,
          deviceIdOf(record),
          record.rejectionReason,
          recordTypeLabel(record.type),
          recordResultLabel(record.result),
        ])
      ),
    [dashboard.records, search, staffNames]
  );

  const visibleDevices = useMemo(
    () =>
      dashboard.devices.filter((device) =>
        searchable(search, [
          device.deviceId,
          device.platform,
          device.appVariant,
          device.appVersion,
          device.screenSize,
          device.trustStatus,
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
    { id: "overview", label: "نظرة عامة" },
    { id: "records", label: "سجل البصمات" },
    { id: "devices", label: "الأجهزة" },
    { id: "alerts", label: "التنبيهات" },
    { id: "zones", label: "نطاقات العمل" },
  ];

  return (
    <section className="attendance-security-page" dir="rtl">
      <header className="attendance-security-heading">
        <div>
          <p className="attendance-security-eyebrow">Attendance D1</p>
          <h1>سجل البصمة والأجهزة</h1>
          <p>متابعة كل عملية حضور وانصراف، الأجهزة المستخدمة، والمخالفات الأمنية من مصدر واحد.</p>
        </div>
        <button
          type="button"
          className="attendance-security-refresh"
          onClick={() => void load()}
          disabled={loading}
        >
          <FiRefreshCw className={loading ? "is-spinning" : ""} />
          {loading ? "جاري التحديث" : "تحديث البيانات"}
        </button>
      </header>

      <div className="attendance-security-shell">
        <nav className="attendance-security-tabs" aria-label="أقسام سجل البصمة">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={activeTab === tab.id ? "is-active" : ""}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              {tab.id === "alerts" && dashboard.summary.openAlerts > 0 ? (
                <span>{dashboard.summary.openAlerts}</span>
              ) : null}
            </button>
          ))}
        </nav>

        {notice ? <div className="attendance-security-notice"><FiCheckCircle />{notice}</div> : null}
        {error ? (
          <div className="attendance-security-error">
            <FiAlertTriangle />
            <div><strong>تعذر تحميل سجل البصمة</strong><p>{error}</p></div>
            <button type="button" onClick={() => void load()}>إعادة المحاولة</button>
          </div>
        ) : null}

        {!error && activeTab !== "overview" && activeTab !== "zones" ? (
          <div className="attendance-security-toolbar">
            <label className="attendance-security-search">
              <FiSearch />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ابحث باسم الموظفة أو الجهاز أو النطاق أو الحالة..."
              />
            </label>
            {activeTab === "records" ? (
              <div className="attendance-security-filters">
                <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
                <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
                <select value={resultFilter} onChange={(event) => setResultFilter(event.target.value as RecordResultFilter)}>
                  <option value="all">كل النتائج</option>
                  <option value="allowed">المقبولة</option>
                  <option value="rejected">المرفوضة</option>
                </select>
                <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as RecordTypeFilter)}>
                  <option value="all">حضور وانصراف</option>
                  <option value="check_in">حضور</option>
                  <option value="check_out">انصراف</option>
                </select>
              </div>
            ) : null}
          </div>
        ) : null}

        {!error && activeTab === "overview" ? (
          <>
            <div className="attendance-security-stats">
              <article><span><FiActivity /></span><small>بصمات اليوم</small><strong>{dashboard.summary.punchesToday}</strong></article>
              <article><span><FiUserCheck /></span><small>داخل الدوام الآن</small><strong>{dashboard.summary.checkedInNow}</strong></article>
              <article><span><FiXCircle /></span><small>مرفوضة اليوم</small><strong>{dashboard.summary.rejectedToday}</strong></article>
              <article><span><FiSmartphone /></span><small>أجهزة جديدة</small><strong>{dashboard.summary.newDevicesToday}</strong></article>
              <article className="is-warning"><span><FiUsers /></span><small>أجهزة مشتركة</small><strong>{dashboard.summary.sharedDevices}</strong></article>
              <article className="is-danger"><span><FiShield /></span><small>تنبيهات مفتوحة</small><strong>{dashboard.summary.openAlerts}</strong></article>
            </div>

            <div className="attendance-security-overview-grid">
              <article className="attendance-security-panel">
                <header><div><h2>آخر عمليات البصمة</h2><p>أحدث الحركات المقبولة والمرفوضة.</p></div><button type="button" onClick={() => setActiveTab("records")}>السجل الكامل</button></header>
                <div className="attendance-security-compact-list">
                  {dashboard.records.slice(0, 7).map((record) => (
                    <button key={record.id} type="button" onClick={() => setSelectedRecord(record)}>
                      <span className={`attendance-security-record-icon is-${record.result}`}><FiActivity /></span>
                      <span><strong>{resolveStaffName(record, staffNames)}</strong><small>{recordTypeLabel(record.type)} · {formatDateTime(record.serverTime)}</small></span>
                      <em className={`is-${record.result}`}>{recordResultLabel(record.result)}</em>
                    </button>
                  ))}
                  {!loading && !dashboard.records.length ? <p className="attendance-security-empty">لا توجد عمليات بصمة في الفترة المحددة.</p> : null}
                </div>
              </article>

              <article className="attendance-security-panel">
                <header><div><h2>تحتاج مراجعة</h2><p>جهاز جديد، تغيير جهاز، مشاركة أو رفض.</p></div><button type="button" onClick={() => setActiveTab("alerts")}>كل التنبيهات</button></header>
                <div className="attendance-security-compact-list">
                  {recentRiskRecords.slice(0, 7).map((record) => (
                    <button key={record.id} type="button" onClick={() => setSelectedRecord(record)}>
                      <span className="attendance-security-record-icon is-risk"><FiAlertTriangle /></span>
                      <span><strong>{resolveStaffName(record, staffNames)}</strong><small>{record.rejectionReason ? rejectionLabel(record.rejectionReason) : "تغيير أو مشاركة جهاز"}</small></span>
                      <em>{shortDeviceId(deviceIdOf(record))}</em>
                    </button>
                  ))}
                  {!loading && !recentRiskRecords.length ? <p className="attendance-security-empty">لا توجد عمليات تحتاج مراجعة حاليًا.</p> : null}
                </div>
              </article>
            </div>
          </>
        ) : null}

        {!error && activeTab === "records" ? (
          <div className="attendance-security-table-wrap">
            <table className="attendance-security-table">
              <thead><tr><th>الموظفة</th><th>العملية</th><th>الوقت</th><th>النطاق</th><th>الدقة</th><th>الجهاز</th><th>النتيجة</th><th>التفاصيل</th></tr></thead>
              <tbody>
                {visibleRecords.map((record) => {
                  const info = record.deviceInfo || {};
                  const hasRisk = info.deviceChanged === true || info.isNewDevice === true || Boolean(info.sharedDevice);
                  return (
                    <tr key={record.id} className={hasRisk ? "is-risk" : ""}>
                      <td><strong>{resolveStaffName(record, staffNames)}</strong><small>{record.employeeDocId || record.employeeUid}</small></td>
                      <td><span className={`attendance-security-kind is-${record.type}`}>{recordTypeLabel(record.type)}</span></td>
                      <td>{formatDateTime(record.serverTime)}</td>
                      <td><strong>{record.zoneName || "—"}</strong><small>{record.distanceMeters == null ? "" : `${Math.round(record.distanceMeters)} م`}</small></td>
                      <td>{Math.round(Number(record.location?.accuracy || 0))} م</td>
                      <td><strong dir="ltr">{shortDeviceId(deviceIdOf(record))}</strong>{hasRisk ? <small className="is-warning">جهاز يحتاج مراجعة</small> : null}</td>
                      <td><span className={`attendance-security-result is-${record.result}`}>{recordResultLabel(record.result)}</span>{record.rejectionReason ? <small>{rejectionLabel(record.rejectionReason)}</small> : null}</td>
                      <td><button type="button" className="attendance-security-row-action" onClick={() => setSelectedRecord(record)}><FiEye />عرض</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!loading && !visibleRecords.length ? <p className="attendance-security-empty">لا توجد بصمات مطابقة للفلاتر.</p> : null}
          </div>
        ) : null}

        {!error && activeTab === "devices" ? (
          <div className="attendance-security-device-grid">
            {visibleDevices.map((device) => (
              <article key={device.deviceId} className={`attendance-security-device-card is-${device.trustStatus}`}>
                <header>
                  <span><FiCpu /></span>
                  <div><strong dir="ltr">{shortDeviceId(device.deviceId)}</strong><small>{device.platform || "منصة غير معروفة"} · {device.appVariant || "web"}</small></div>
                  <em>{deviceStatusLabel(device.trustStatus)}</em>
                </header>
                <dl>
                  <div><dt>أول استخدام</dt><dd>{formatDateTime(device.firstSeenAt)}</dd></div>
                  <div><dt>آخر استخدام</dt><dd>{formatDateTime(device.lastSeenAt)}</dd></div>
                  <div><dt>عدد البصمات</dt><dd>{device.totalRecords}</dd></div>
                  <div><dt>الموظفات</dt><dd>{device.assignments.length}</dd></div>
                  <div><dt>الشاشة</dt><dd>{device.screenSize || "—"}</dd></div>
                  <div><dt>نسخة التطبيق</dt><dd>{device.appVersion || "—"}</dd></div>
                </dl>
                <div className="attendance-security-device-users">
                  {device.assignments.map((assignment) => (
                    <span key={assignment.employeeUid}>
                      {assignment.employeeName || staffNames.get(assignment.employeeUid) || assignment.employeeDocId || assignment.employeeUid}
                      <small>{assignment.recordsCount} بصمة</small>
                    </span>
                  ))}
                </div>
                {canManageDevices ? (
                  <footer>
                    <button type="button" disabled={busyKey === `device:${device.deviceId}` || device.trustStatus === "trusted"} onClick={() => void setDeviceStatus(device, "trusted")}><FiUnlock />اعتماد</button>
                    <button type="button" className="is-danger" disabled={busyKey === `device:${device.deviceId}` || device.trustStatus === "blocked"} onClick={() => void setDeviceStatus(device, "blocked")}><FiLock />حظر</button>
                    {device.trustStatus !== "new" ? <button type="button" disabled={busyKey === `device:${device.deviceId}`} onClick={() => void setDeviceStatus(device, "new")}>إعادة للمراجعة</button> : null}
                  </footer>
                ) : null}
              </article>
            ))}
            {!loading && !visibleDevices.length ? <p className="attendance-security-empty">لا توجد أجهزة مطابقة للبحث.</p> : null}
          </div>
        ) : null}

        {!error && activeTab === "alerts" ? (
          <div className="attendance-security-alert-list">
            {visibleAlerts.map((event) => (
              <article key={event.id} className={`is-${event.severity}`}>
                <span><FiAlertTriangle /></span>
                <div>
                  <header><strong>{event.title}</strong><em>{eventTypeLabel(event.eventType)}</em></header>
                  <p>{event.detail || "تنبيه أمني مرتبط بعملية بصمة."}</p>
                  <small>{event.employeeName || staffNames.get(event.employeeUid) || event.employeeDocId || event.employeeUid} · {formatDateTime(event.createdAt)} · {shortDeviceId(event.deviceId)}</small>
                </div>
                {canResolveAlerts ? (
                  <footer>
                    <button type="button" disabled={busyKey === `alert:${event.id}`} onClick={() => void setAlertStatus(event, "resolved")}><FiCheck />تمت المعالجة</button>
                    <button type="button" disabled={busyKey === `alert:${event.id}`} onClick={() => void setAlertStatus(event, "ignored")}>تجاهل</button>
                  </footer>
                ) : null}
              </article>
            ))}
            {!loading && !visibleAlerts.length ? <p className="attendance-security-empty">لا توجد تنبيهات مفتوحة مطابقة للبحث.</p> : null}
          </div>
        ) : null}

        {!error && activeTab === "zones" ? (
          <div className="attendance-security-zone-grid">
            {dashboard.zones.map((zone) => (
              <article key={zone.id} className={zone.active ? "is-active" : ""}>
                <span><FiMapPin /></span>
                <div><strong>{zone.name}</strong><small dir="ltr">{Number(zone.lat).toFixed(5)}, {Number(zone.lng).toFixed(5)}</small></div>
                <dl><div><dt>نصف القطر</dt><dd>{zone.radiusMeters} م</dd></div><div><dt>الحالة</dt><dd>{zone.active ? "مفعل" : "متوقف"}</dd></div></dl>
              </article>
            ))}
            {!loading && !dashboard.zones.length ? <p className="attendance-security-empty">لا توجد نطاقات عمل مسجلة.</p> : null}
          </div>
        ) : null}
      </div>

      {selectedRecord ? (
        <div className="attendance-security-detail-backdrop" role="presentation" onMouseDown={() => setSelectedRecord(null)}>
          <aside className="attendance-security-detail" role="dialog" aria-modal="true" aria-label="تفاصيل عملية البصمة" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><p>تفاصيل العملية</p><h2>{recordTypeLabel(selectedRecord.type)} · {resolveStaffName(selectedRecord, staffNames)}</h2></div><button type="button" onClick={() => setSelectedRecord(null)}>×</button></header>
            <div className="attendance-security-detail-status"><span className={`is-${selectedRecord.result}`}>{recordResultLabel(selectedRecord.result)}</span><strong>{formatDateTime(selectedRecord.serverTime)}</strong></div>
            <dl>
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
            <a className="attendance-security-map-link" href={`https://www.google.com/maps?q=${selectedRecord.location.lat},${selectedRecord.location.lng}`} target="_blank" rel="noreferrer"><FiMapPin />فتح الموقع على الخريطة</a>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
