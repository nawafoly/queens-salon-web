import { useEffect, useMemo, useState } from "react";
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

import { markEmployeeNotificationRead, type EmployeeNotification } from "../../services/employeeHub";
import {
  buildAttendanceVerification,
  checkInStaffAttendance,
  checkOutStaffAttendance,
  getStaffAttendanceForDate,
  getTodayAttendanceDateKey,
  type StaffAttendanceToday,
} from "../../services/firestoreAttendance";
import { AppSettingsService } from "../../services/AppSettingsService";
import {
  findMatchingWorkZone,
  getBrowserPosition,
  listActiveWorkZones,
  type AttendanceLocation,
  type WorkZoneMatch,
} from "../../services/attendanceSettingsService";
import { requestAttendanceBiometric } from "../../helpers/attendanceBiometric";
import {
  computeAttendanceDay,
  getAttendanceDayStatus,
  type AttendanceRecord,
} from "../../helpers/hr/attendanceCalculations";
import { cleanText, formatShortDate, type HrSession } from "./shared";
import { formatNotificationTime, notificationTone, notificationTypeLabel, toMillis } from "./portalUtils";

type Props = {
  session: HrSession;
  notifications: EmployeeNotification[];
  onRefresh?: () => void | Promise<void>;
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

export default function EmployeeOverviewPage({ session, notifications, onRefresh }: Props) {
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
    if (!attendanceEmployeeId) return;
    setAttendanceLoading(true);
    setAttendanceMessage("");
    try {
      const row = await getStaffAttendanceForDate({
        employeeId: attendanceEmployeeId,
        date: attendanceDate,
      });
      setAttendance(row);
    } catch (e) {
      setAttendanceMessage(cleanText((e as any)?.message || "Failed to load attendance."));
    } finally {
      setAttendanceLoading(false);
    }
  };

  useEffect(() => {
    void loadAttendance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendanceEmployeeId, attendanceDate]);

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

  const handleAttendancePunch = async (type: "check_in" | "check_out") => {
    if (!attendanceEmployeeId || attendanceBusy) return;
    setAttendanceBusy(true);
    setAttendanceMessage("");
    try {
      const effectiveAttendanceSettings = attendanceSettings || AppSettingsService.getDefaults().attendance!;
      if (effectiveAttendanceSettings.enabled === false) {
        throw new Error("تسجيل الحضور متوقف من إعدادات الإدارة.");
      }

      let location: AttendanceLocation | undefined;
      let workZoneMatch: WorkZoneMatch | null = null;

      if (effectiveAttendanceSettings.requireWorkZone) {
        setAttendanceMessage("جاري التحقق من الموقع...");
        location = await getBrowserPosition();
        setLastLocation(location);

        if (
          location.accuracy &&
          location.accuracy > effectiveAttendanceSettings.maxLocationAccuracyMeters
        ) {
          throw new Error(`دقة الموقع الحالية ${location.accuracy} م، المطلوب ${effectiveAttendanceSettings.maxLocationAccuracyMeters} م أو أقل.`);
        }

        const zones = await listActiveWorkZones();
        if (!zones.length) {
          throw new Error("لا توجد مناطق عمل مفعلة. راجع إعدادات الحضور والبصمة.");
        }

        workZoneMatch = findMatchingWorkZone(location, zones);
        setLastWorkZone(workZoneMatch);
        if (!workZoneMatch) {
          throw new Error("أنت خارج نطاق مناطق العمل المسموحة لتسجيل الحضور.");
        }
      }

      let biometric: Awaited<ReturnType<typeof requestAttendanceBiometric>> | undefined;
      if (effectiveAttendanceSettings.requireBiometric) {
        setAttendanceMessage("افتح التحقق بالبصمة من جهازك...");
        biometric = await requestAttendanceBiometric({
          employeeId: attendanceEmployeeId,
          displayName,
          action: type,
        });
      }

      const verification = buildAttendanceVerification({
        biometric,
        location,
        workZoneMatch,
      });

      if (type === "check_in") {
        await checkInStaffAttendance({
          employeeId: attendanceEmployeeId,
          date: attendanceDate,
          createdByUid: session.uid,
          createdByName: displayName,
          verification,
        });
      } else {
        await checkOutStaffAttendance({
          employeeId: attendanceEmployeeId,
          date: attendanceDate,
          createdByUid: session.uid,
          createdByName: displayName,
          verification,
        });
      }
      await loadAttendance();
      setAttendanceMessage(type === "check_in" ? "تم تسجيل الحضور." : "تم تسجيل الانصراف.");
    } catch (e) {
      setAttendanceMessage(cleanText((e as any)?.message || "Failed to save attendance."));
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
  const visibleLocation = latestVerification?.location || lastLocation;
  const visibleZoneName = latestVerification?.workZoneName || lastWorkZone?.zone.name || "";
  const visibleDistance =
    latestVerification?.distanceMeters ??
    lastWorkZone?.distanceMeters ??
    null;
  const visibleAccuracy =
    visibleLocation?.accuracy ??
    null;

  return (
    <div className="employee-panel employee-overview">
      <section className="employee-app-intro">
        <p>مساء الخير</p>
        <h1>{displayName}</h1>
        <span>{department || "بدون قسم"} · {title || "بدون مسمى وظيفي"}</span>
      </section>

      <section className="employee-attendance-card">
        <div className="employee-section-title">
          <div>
            <small><FontAwesomeIcon icon={faClock} /> الحضور والانصراف</small>
            <h2>تسجيل الدوام</h2>
          </div>
          <span className="employee-gps-chip">GPS</span>
        </div>

        <div className="employee-attendance-console">
          <div className="employee-attendance-side">
            <span>الانصراف</span>
            <strong>{checkOutTime}</strong>
            <em className={attendance?.checkOutAtClient ? "is-done" : ""}>
              {attendance?.checkOutAtClient ? "تم الانصراف" : "لم يتم الانصراف"}
            </em>
          </div>

          <button
            type="button"
            className={`employee-punch-button employee-punch-button--${punchTone}`}
            onClick={() => void handleAttendancePunch(punchAction)}
            disabled={punchDisabled}
          >
            <span><FontAwesomeIcon icon={faFingerprint} /></span>
            <strong>{attendanceBusy ? "جاري التسجيل..." : punchLabel}</strong>
          </button>

          <div className="employee-attendance-side">
            <span>الحضور</span>
            <strong>{checkInTime}</strong>
            <em className={attendance?.checkInAtClient ? "is-done" : ""}>
              {attendance?.checkInAtClient ? "تم الحضور" : "لم يتم الحضور"}
            </em>
          </div>
        </div>

        <div className="employee-attendance-status">
          {attendanceLoading ? "جاري تحديث حالة اليوم..." : getAttendanceStatusLabel(attendanceStatus)}
        </div>

        <div className="employee-attendance-records">
          <div className={attendance?.checkOutAtClient ? "is-out" : ""}>
            <strong>سجل الانصراف</strong>
            <span>{checkOutTime}</span>
            <small>{attendance?.checkOutAtClient ? "موجود في سجلات اليوم" : "لا يوجد سجل انصراف"}</small>
          </div>
          <div className={attendance?.checkInAtClient ? "is-in" : ""}>
            <strong>سجل الحضور</strong>
            <span>{checkInTime}</span>
            <small>{attendance?.checkInAtClient ? "موجود في سجلات اليوم" : "لا يوجد سجل حضور"}</small>
          </div>
        </div>

        <div className={`employee-attendance-note ${attendanceStatus === "not_started" ? "" : "is-done"}`}>
          <span>
            {attendanceMessage || attendanceDayStatus}
            {visibleAccuracy !== null ? ` · الدقة: ${visibleAccuracy} م` : ""}
            {visibleDistance !== null ? ` · المسافة: ${visibleDistance} م` : visibleZoneName ? ` · النطاق: ${visibleZoneName}` : ""}
          </span>
          <div>
            <small>تسجيل حضور</small>
            <small>الدقة: 84 م</small>
            <small>المسافة: 42 م</small>
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
            <strong>{cleanText(profile.leaveBalanceDays ?? profile.leaveBalance ?? "19")} يوم</strong>
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
