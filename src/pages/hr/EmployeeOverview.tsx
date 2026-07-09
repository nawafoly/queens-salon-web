import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBell,
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
  listLeaveRequestsByEmployee,
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
import {
  listEmployeeBookings,
  type BookingDocWithId,
} from "../../services/firestoreBookings";
import {
  getBrowserPosition,
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
} from "../../helpers/hr/attendanceCalculations";
import { buildApprovedLeaveDateKeys } from "../../helpers/hr/attendanceCalendarData";
import { cleanText, formatShortDate, type HrSession } from "./shared";
import { formatNotificationTime, notificationTone, notificationTypeLabel, toMillis } from "./portalUtils";
import AttendanceMonthView from "../../components/AttendanceMonthView";

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

function formatAttendanceTime(value: unknown) {
  const raw = cleanText(value);
  if (!raw) return "—";
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return raw;
  return new Intl.DateTimeFormat("ar-SA", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(parsed));
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
  const profile = getProfileSource(session);
  const displayName = cleanText(profile.displayName || profile.name || session.displayName || session.email || "Employee");
  const department = cleanText(profile.department || "");
  const title = cleanText(profile.title || "");
  const avatarUrl = cleanText(profile.avatarUrl || profile.photoURL || profile.photoUrl || "");
  const leaveUntil = cleanText(profile.leaveUntil || "");
  const onLeave = !!profile.onLeave && (!leaveUntil || leaveUntil >= new Date().toISOString().slice(0, 10));
  const active = profile.active !== false;
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
  const [employeeBookings, setEmployeeBookings] = useState<BookingDocWithId[]>([]);
  const [employeeBookingsLoading, setEmployeeBookingsLoading] = useState(false);
  const [employeeLeaveRequests, setEmployeeLeaveRequests] = useState<EmployeeLeaveRequest[]>([]);
  const attendanceEmployeeId = cleanText(session.employeeId || session.uid);
  const attendanceDate = getTodayAttendanceDateKey();

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

  const approvedLeaveDateKeys = useMemo(
    () =>
      buildApprovedLeaveDateKeys({
        profile,
        leaveRequests: employeeLeaveRequests,
        extraIds: [session.uid, session.employeeId],
        todayDateKey: attendanceDate,
      }),
    [attendanceDate, employeeLeaveRequests, profile, session.employeeId, session.uid]
  );

  const attendanceComputation = useMemo(() => {
    const records: AttendanceRecord[] = [];
    if (attendance?.checkInAtClient) {
      records.push({ id: `${attendance.id}-in`, type: "check_in", serverTime: attendance.checkInAtClient });
    }
    if (attendance?.checkOutAtClient) {
      records.push({ id: `${attendance.id}-out`, type: "check_out", serverTime: attendance.checkOutAtClient });
    }
    return computeAttendanceDay(attendanceDate, records, {
      startTime: cleanText(profile.startTime || profile.workStartTime || profile.shiftStartTime || "09:00"),
      endTime: cleanText(profile.endTime || profile.workEndTime || profile.shiftEndTime || "17:00"),
      weeklyOffDays: profile.weeklyOffDays || profile.offDays || null,
    });
  }, [attendance, attendanceDate, profile.endTime, profile.offDays, profile.shiftEndTime, profile.shiftStartTime, profile.startTime, profile.weeklyOffDays, profile.workEndTime, profile.workStartTime]);

  const attendanceDayStatus = getAttendanceDayStatus({
    date: attendanceDate,
    hasAttendance: Boolean(attendance?.checkInAtClient || attendance?.checkOutAtClient),
    checkOut: attendanceComputation.checkOut,
    computation: attendanceComputation,
    todayDateKey: attendanceDate,
    weeklyOffDays: profile.weeklyOffDays || profile.offDays || null,
  });

  const loadAttendance = async () => {
    if (!attendanceEmployeeId || !session.uid) return;

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
    if (!attendanceEmployeeId || !session.uid) {
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
  }, [attendanceEmployeeId, attendanceMonth, session.uid]);

  useEffect(() => {
    void loadAttendance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendanceEmployeeId, attendanceDate]);

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
      setEmployeeLeaveRequests([]);
      return;
    }

    let alive = true;

    async function loadEmployeeLeaveRequests() {
      try {
        const rows = await listLeaveRequestsByEmployee(session.uid, 120);
        if (alive) setEmployeeLeaveRequests(rows);
      } catch {
        if (alive) setEmployeeLeaveRequests([]);
      }
    }

    void loadEmployeeLeaveRequests();

    return () => {
      alive = false;
    };
  }, [session.uid]);

  useEffect(() => {
    if (!attendanceOnly) return;
    void loadAttendanceMonth();
  }, [attendanceOnly, loadAttendanceMonth]);

  useEffect(() => {
    AppSettingsService.fetchRemote()
      .then((remote) => setAttendanceSettings(remote.attendance))
      .catch(() => {});

    return AppSettingsService.subscribe((remote) => {
      setAttendanceSettings(remote.attendance);
    });
  }, []);

  const quickActions = [
    { label: "تصحيح البصمة", href: "/employee/attendance", icon: faFingerprint },
    { label: "طلب إجازة", href: "/employee/leave", icon: faCalendarDays },
    { label: "طلب استئذان", href: "/employee/messages", icon: faPaperPlane },
  ];

  const hrInfoItems = [
    { label: "شخصي", description: "المعلومات الشخصية، الهوية، العنوان", href: "/employee/profile", icon: faUser },
    { label: "البيانات الوظيفية", description: "تاريخ الالتحاق، المسمى الوظيفي، نوع التوظيف", href: "/employee/profile", icon: faBriefcase },
    { label: "جدول الدوام", description: "بداية ونهاية الدوام، أيام الراحة، ونطاق الحضور", href: "/employee/attendance", icon: faClock },
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
    if (!attendanceEmployeeId || !session.uid || attendanceBusy) {
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

      if (!active) {
        throw new Error(
          "لا يمكن تسجيل الحضور لموظفة غير نشطة."
        );
      }

      setAttendanceMessage(
        "جاري الحصول على موقعك بدقة..."
      );

      const location: AttendanceLocation =
        await getBrowserPosition({
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 20000,
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
        employeeId: attendanceEmployeeId,
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
    : active
      ? "نشط"
      : "غير نشط";
  const attendanceStatus = attendance?.status || "not_started";
  const canCheckIn = !attendanceBusy && !attendanceLoading && attendanceStatus === "not_started";
  const canCheckOut = !attendanceBusy && !attendanceLoading && attendanceStatus === "checked_in";
  const punchAction = canCheckOut ? "check_out" : "check_in";
  const punchDisabled = !canCheckIn && !canCheckOut;
  const punchLabel = attendanceStatus === "checked_out" ? "تم اكتمال الدوام" : canCheckOut ? "تسجيل انصراف" : "تسجيل حضور";
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
  const leaveBalanceValue = cleanText(profile.leaveBalanceDays ?? profile.leaveBalance ?? "") || "—";
  const attendanceDateLabel = formatAttendanceDateLabel(attendanceDate);
  const punchHint = attendanceStatus === "checked_out"
    ? "تم حفظ الحضور والانصراف لهذا اليوم"
    : attendanceBusy
      ? "لا تغلق الصفحة أثناء التحقق"
      : "اضغط بعد السماح بالوصول إلى الموقع والبصمة";

  if (attendanceOnly) {
    return (
      <div className="employee-panel employee-overview employee-attendance-month-page">
        <AttendanceMonthView
          rows={attendanceMonthRows}
          loading={attendanceMonthLoading || attendanceLoading}
          monthKey={attendanceMonth}
          selectedDate={attendanceSelectedDate}
          title="سجل حضور الموظفة"
          subtitle="اختر الشهر لعرض تقويم الحضور اليومي، ثم اختر اليوم لمراجعة السجل."
          viewerMode="employee"
          schedule={profile}
          approvedLeaveDateKeys={approvedLeaveDateKeys}
          onMonthChange={(monthKey) => {
            setAttendanceMonth(monthKey);
            setAttendanceSelectedDate((current) =>
              String(current || "").startsWith(monthKey) ? current : `${monthKey}-01`
            );
          }}
          onSelectedDateChange={setAttendanceSelectedDate}
          onGenerateSummary={() => {
            void loadAttendanceMonth();
          }}
        />

        {attendanceMessage ? (
          <div className="employee-attendance-month-message">{attendanceMessage}</div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="employee-panel employee-overview">
      <section className="employee-app-intro">
        <div className="employee-app-intro__identity">
          <span className="employee-app-intro__avatar">
            {avatarUrl ? <img src={avatarUrl} alt="" /> : displayInitial(displayName)}
          </span>
          <div>
            <p>{getGreeting()}</p>
            <h1>{displayName}</h1>
            <span>{department || "بدون قسم"} · {title || "بدون مسمى وظيفي"}</span>
          </div>
        </div>
        <div className="employee-app-intro__meta">
          <span className={`employee-status-pill ${onLeave ? "is-leave" : active ? "is-active" : "is-inactive"}`}>{statusLabel}</span>
          <span>{roleLabel(session.role)}</span>
          <span>{attendanceDateLabel}</span>
        </div>
      </section>

      <section className="employee-overview-kpis" aria-label="ملخص التنبيهات">
        <Link to="/employee/notifications" className="employee-overview-kpi">
          <span>التنبيهات غير المقروءة</span>
          <strong>{summary.all}</strong>
        </Link>
        <Link to="/employee/messages" className="employee-overview-kpi">
          <span>الرسائل</span>
          <strong>{summary.message}</strong>
        </Link>
        <Link to="/employee/files" className="employee-overview-kpi">
          <span>تحديثات الملفات</span>
          <strong>{summary.file}</strong>
        </Link>
        <Link to="/employee/leave" className="employee-overview-kpi">
          <span>الإجازات والرواتب</span>
          <strong>{summary.leave + summary.payroll}</strong>
        </Link>
      </section>

      <section className={`employee-attendance-card employee-attendance-card--${attendanceStatus}`} data-status={attendanceStatus}>
        <div className="employee-section-title">
          <div>
            <small><FontAwesomeIcon icon={faClock} /> الحضور والانصراف</small>
            <h2>تسجيل الدوام</h2>
            <p>{attendanceDateLabel}</p>
          </div>
          <span className="employee-gps-chip"><i aria-hidden="true" /> يعتمد على GPS</span>
        </div>

        <div className="employee-attendance-console">
<button
            type="button"
            className={`employee-punch-button employee-punch-button--${punchTone}`}
            onClick={() => void handleAttendancePunch(punchAction)}
            disabled={punchDisabled}
            aria-describedby="employee-punch-hint"
          >
            <span><FontAwesomeIcon icon={faFingerprint} /></span>
            <strong>{attendanceBusy ? "جاري التسجيل..." : punchLabel}</strong>
            <small id="employee-punch-hint">{punchHint}</small>
          </button>
</div>

        <div className={`employee-attendance-status employee-attendance-status--${attendanceStatus}`} aria-live="polite">
          <span>{attendanceLoading ? "جاري تحديث حالة اليوم..." : getAttendanceStatusLabel(attendanceStatus)}</span>
          <small>{attendanceDayStatus}</small>
        </div>

        <div className="employee-attendance-records">
          <div className={attendance?.checkOutAtClient ? "is-out" : ""}>
            <span className="employee-attendance-records__icon"><FontAwesomeIcon icon={faClock} /></span>
            <div>
              <strong>سجل الانصراف</strong>
              <small>{attendance?.checkOutAtClient ? "موجود في سجلات اليوم" : "لا يوجد سجل انصراف"}</small>
            </div>
            <b>{checkOutTime}</b>
          </div>
          <div className={attendance?.checkInAtClient ? "is-in" : ""}>
            <span className="employee-attendance-records__icon"><FontAwesomeIcon icon={faFingerprint} /></span>
            <div>
              <strong>سجل الحضور</strong>
              <small>{attendance?.checkInAtClient ? "موجود في سجلات اليوم" : "لا يوجد سجل حضور"}</small>
            </div>
            <b>{checkInTime}</b>
          </div>
        </div>

        <div
          className={`employee-attendance-note ${attendanceStatus === "not_started" ? "" : "is-done"}`}
          role="status"
          aria-live="polite"
        >
          <span>
            {attendanceMessage || attendanceDayStatus}
            {visibleAccuracyLabel ? ` · ${visibleAccuracyLabel}` : ""}
            {visibleDistance !== null ? ` · المسافة: ${visibleDistance} م` : visibleZoneName ? ` · النطاق: ${visibleZoneName}` : ""}
          </span>
          <div>
            {visibleZoneName ? <small>{visibleZoneName}</small> : null}
            {visibleAccuracyLabel ? <small>{visibleAccuracyLabel}</small> : null}
            {visibleDistance !== null ? <small>المسافة: {visibleDistance} م</small> : null}
          </div>
        </div>
      </section>

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
            <span>رصيد الإجازات</span>
            <strong>{leaveBalanceValue === "—" ? "—" : `${leaveBalanceValue} يوم`}</strong>
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





