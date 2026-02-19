// ✅ src/pages/Dashboard.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Routes, Route, NavLink, useNavigate, Navigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faUsers,
  faCalendarAlt,
  faChartLine,
  faCog,
  faSignOutAlt,
  faUserShield,
  faUserTie,
  faUser,
  faPercent,
  faChartPie,
  faMoneyBillWave,
  faWallet,
  faXmark,
  faBars,
  faHouse,
  faClockRotateLeft,
} from "@fortawesome/free-solid-svg-icons";

import "../styles/DashboardSkin.css";
import "../styles/DashboardModals.css";
import "../styles/DashboardOverview.css";
import LoadingBrand from "../components/LoadingBrand";
import Modal from "../components/Modal";

import DashboardBookings from "../pages/DashboardBookings";
import DashboardEmployees from "../pages/DashboardEmployees";
import DashboardOffers from "../pages/DashboardOffers";
import DashboardReports from "./DashboardReports";
import DashboardClients from "./DashboardClients";
import DashboardLoyalty from "./DashboardLoyalty";
import DashboardSettings from "../pages/DashboardSettings";
import DashboardExpenses from "../pages/DashboardExpenses";
import DashboardIncome from "../pages/DashboardIncome";
import DashboardLogs from "../pages/DashboardLogs";

import DashboardStaff from "../pages/DashboardStaff";

// ✅ NEW: الحجز الداخلي داخل الداشبورد
import BookingInternal from "../pages/BookingInternal";

import logo1 from "../assets/images/ssunnamed3.png";

import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "../services/firebase";

import type { Booking, BookingStatus } from "../helpers/dashboardService";
import { DashboardService } from "../helpers/dashboardService";

import {
  listAllBookings as listAllBookingsFS,
  updateBookingStatus as updateBookingStatusFS,
  type BookingDocWithId,
} from "../services/firestoreBookings";

import {
  listAllExpensesFS,
  countMonthlyExpensesMissingNotesFS,
} from "../services/firestoreExpenses";

import { listAllIncomeFS } from "../services/firestoreIncome";

import {
  canAccessDashboard,
  createOrLoadUserProfile,
  type UiRole as ProfileRole,
  type UserProfile,
} from "../services/userProfile";

// ✅ NEW: App Settings from Firestore (settings/app)
import { AppSettingsService } from "../services/AppSettingsService";

import { resolveServiceName } from "../services/serviceResolver";

/** ===== Settings (LocalStorage fallback) ===== */
type SectionKey =
  | "overview"
  | "bookings"
  | "clients"
  | "employees"
  | "offers"
  | "reports"
  | "income"
  | "expenses"
  | "logs"
  | "settings";

type WeekdayKey = "sat" | "sun" | "mon" | "tue" | "wed" | "thu" | "fri";
type BusinessHoursDay = { enabled?: boolean; start?: string; end?: string };
type BusinessHoursMap = Partial<Record<WeekdayKey, BusinessHoursDay>>;
const JS_DAY_TO_WEEKDAY: WeekdayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

type AppSettings = {
  salonName: string;
  phone: string;
  city: string;
  sections: Record<SectionKey, boolean>;
  policies: {
    allowStaffChangeStatus: boolean;
    allowReceptionChangeStatus: boolean;
    allowStaffViewClients: boolean;
    allowAdminManageUsers: boolean;
  };
  booking?: {
    businessHours?: BusinessHoursMap;
  };
};

const SETTINGS_KEY = "dashboard_settings_v1";

const defaultSettings: AppSettings = {
  salonName: "MALIKAT SALON",
  phone: "",
  city: "",
  sections: {
    overview: true,
    bookings: true,
    clients: true,
    employees: true,
    offers: true,
    reports: true,
    income: true,
    expenses: true,
    logs: true,
    settings: true,
  },
  policies: {
    allowStaffChangeStatus: true,
    allowReceptionChangeStatus: true,
    allowStaffViewClients: true,
    allowAdminManageUsers: false,
  },
};

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw);

    return {
      ...defaultSettings,
      ...parsed,
      sections: { ...defaultSettings.sections, ...(parsed?.sections || {}) },
      policies: { ...defaultSettings.policies, ...(parsed?.policies || {}) },
    };
  } catch {
    return defaultSettings;
  }
}

function formatTime12(time24: string) {
  const m = String(time24 || "").trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return String(time24 || "-");
  const h24 = Number(m[1]);
  const mm = m[2];
  const h12 = h24 % 12 || 12;
  return `${String(h12).padStart(2, "0")}:${mm} ${h24 >= 12 ? "م" : "ص"}`;
}

function parseTimeToMinutes(time24: string): number | null {
  const m = String(time24 || "").trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function bookingNoOf(b: Partial<Booking> | null | undefined) {
  const raw = String(b?.publicId || "").trim();
  if (!raw) return "—";
  const up = raw.toUpperCase();
  if (/^MK-\d+$/.test(up)) return up;
  if (/^\d+$/.test(up)) return `MK-${up}`;
  return up;
}

/** ✅ تحويل حجز Firestore لشكل Booking اللي تستخدمه الواجهة */
async function mapFirestoreToUiBooking(b: BookingDocWithId): Promise<Booking> {
  const serviceId = (b as any)?.serviceId || b.serviceName || "";

  return {
    id: b.id,
    publicId: (b as any)?.publicId ? String((b as any).publicId) : undefined,
    customerName: b.clientName || "-",
    phone: b.clientPhone || "",
    serviceId,
    serviceName: await resolveServiceName(serviceId),
    employeeName: b.employeeName || "",
    date: b.date || "",
    time: b.time || "",
    status: (b.status || "pending") as BookingStatus,
    total: Number(b.finalPrice ?? (b as any).total ?? 0),
    createdAt: (b.createdAt as any) || undefined,
    note: (b.note as any) || undefined,
  };
}

/** ===== Overview ===== */
type OverviewProps = {
  userInfo: any;
  stats: {
    todayBookings: number;
    totalRevenue: number;
    totalOperations: number;
    employeesCount: number;
  };
  scheduleBookings: Booking[];
  businessHours?: BusinessHoursMap;
  onOpenBooking: (booking: Booking) => void;
  onQuickAction: (key: "newBooking" | "bookings" | "reports") => void;
  financial: {
    income: number;
    expenses: number;
    profit: number;
  };
};

const DashboardOverview: React.FC<OverviewProps> = ({
  userInfo,
  stats,
  scheduleBookings,
  businessHours,
  onOpenBooking,
  onQuickAction,
  financial,
}) => {
  const statusLabel = useMemo(
    () =>
    ({
      confirmed: "مؤكد",
      pending: "في الانتظار",
      cancelled: "ملغي",
      completed: "مكتمل",
    } as Record<BookingStatus, string>),
    []
  );

  const hourRows = useMemo(() => {
    const bookingByHour = new Map<number, Booking[]>();

    const sorted = (scheduleBookings || [])
      .map((booking) => ({ booking, minute: parseTimeToMinutes(booking.time) }))
      .filter((x): x is { booking: Booking; minute: number } => x.minute !== null)
      .sort((a, b) => a.minute - b.minute);

    sorted.forEach(({ booking, minute }) => {
      const hour = Math.floor(minute / 60);
      if (!bookingByHour.has(hour)) bookingByHour.set(hour, []);
      bookingByHour.get(hour)!.push(booking);
    });

    const todayKey = JS_DAY_TO_WEEKDAY[new Date().getDay()] || "sun";
    const todayHours = businessHours?.[todayKey];

    const startMin = parseTimeToMinutes(String(todayHours?.start || ""));
    const endMin = parseTimeToMinutes(String(todayHours?.end || ""));
    const rows: Array<{ hour: number; bookings: Booking[] }> = [];

    if (
      todayHours?.enabled !== false &&
      startMin !== null &&
      endMin !== null &&
      endMin > startMin
    ) {
      let startHour = Math.floor(startMin / 60);
      let endHourExclusive = Math.ceil(endMin / 60);

      if (bookingByHour.size > 0) {
        const hours = Array.from(bookingByHour.keys()).sort((a, b) => a - b);
        startHour = Math.min(startHour, hours[0]);
        endHourExclusive = Math.max(endHourExclusive, hours[hours.length - 1] + 1);
      }

      for (let hour = startHour; hour < endHourExclusive; hour += 1) {
        rows.push({ hour, bookings: bookingByHour.get(hour) || [] });
      }
      return rows;
    }

    if (bookingByHour.size > 0) {
      const hours = Array.from(bookingByHour.keys()).sort((a, b) => a - b);
      const minHour = hours[0];
      const maxHour = hours[hours.length - 1];
      for (let hour = minHour; hour <= maxHour; hour += 1) {
        rows.push({ hour, bookings: bookingByHour.get(hour) || [] });
      }
    }

    return rows;
  }, [scheduleBookings, businessHours]);

  const scheduleHint = useMemo(() => {
    const todayKey = JS_DAY_TO_WEEKDAY[new Date().getDay()] || "sun";
    const todayHours = businessHours?.[todayKey];

    if (todayHours?.enabled === false) return "اليوم مغلق حسب إعدادات ساعات العمل";

    const start = String(todayHours?.start || "").trim();
    const end = String(todayHours?.end || "").trim();
    if (start && end) return `ساعات العمل اليوم: ${formatTime12(start)} - ${formatTime12(end)}`;

    return "اضغط على أي حجز لعرض التفاصيل";
  }, [businessHours]);

  const formatHourLabel = (hour: number) => {
    const normalized = ((hour % 24) + 24) % 24;
    return formatTime12(`${String(normalized).padStart(2, "0")}:00`);
  };

  return (
    <div className="overview-page">
      <div className="overview-header">
        <div className="overview-title">
          <h1>مرحباً بك، {userInfo.name}</h1>
          <p>إليك نظرة عامة على أنشطة الصالون اليوم</p>
        </div>
      </div>

      <div className="overview-content">
        <div className="overview-grid">
          <div
            className="ov-stat-card"
            role="button"
            onClick={() => onQuickAction("bookings")}
          >
            <div className="ov-icon">
              <FontAwesomeIcon icon={faCalendarAlt} />
            </div>
            <div className="ov-info">
              <h3 className="value">{stats.todayBookings}</h3>
              <p>حجوزات اليوم</p>
            </div>
          </div>

          <div
            className="ov-stat-card"
            role="button"
            onClick={() => onQuickAction("reports")}
          >
            <div className="ov-icon">
              <FontAwesomeIcon icon={faChartLine} />
            </div>
            <div className="ov-info">
              <h3 className="value">{stats.totalRevenue.toLocaleString()}</h3>
              <p>الإيرادات (من الحجوزات)</p>
            </div>
          </div>

          <div
            className="ov-stat-card"
            role="button"
            onClick={() => onQuickAction("bookings")}
          >
            <div className="ov-icon">
              <FontAwesomeIcon icon={faUsers} />
            </div>
            <div className="ov-info">
              <h3 className="value">{stats.totalOperations}</h3>
              <p>إجمالي العمليات</p>
            </div>
          </div>

          <div className="ov-stat-card">
            <div className="ov-icon">
              <FontAwesomeIcon icon={faUsers} />
            </div>
            <div className="ov-info">
              <h3 className="value">{stats.employeesCount}</h3>
              <p>عدد الموظفات لديهم حجز</p>
            </div>
          </div>
        </div>

        <div className="overview-grid overview-grid-3">
          <div className="ov-stat-card">
            <div className="ov-icon">
              <FontAwesomeIcon icon={faWallet} />
            </div>
            <div className="ov-info">
              <h3 className="value">{financial.income.toLocaleString()}</h3>
              <p>الدخل (من الحجوزات)</p>
            </div>
          </div>

          <div className="ov-stat-card">
            <div className="ov-icon">
              <FontAwesomeIcon icon={faMoneyBillWave} />
            </div>
            <div className="ov-info">
              <h3 className="value">{financial.expenses.toLocaleString()}</h3>
              <p>المصروفات</p>
            </div>
          </div>

          <div className="ov-stat-card">
            <div className="ov-icon">
              <FontAwesomeIcon icon={faChartLine} />
            </div>
            <div className="ov-info">
              <h3 className="value">{financial.profit.toLocaleString()}</h3>
              <p>صافي الربح</p>
            </div>
          </div>
        </div>

        <div className="ov-card">
          <div className="ov-card-head">
            <h3>جدول حجوزات اليوم حسب الساعة</h3>
            <span className="ov-actions-hint">{scheduleHint}</span>
          </div>

          <div className="table-responsive">
            <table className="ov-table">
              <thead>
                <tr>
                  <th>الساعة</th>
                  <th>الحجوزات داخل الساعة</th>
                </tr>
              </thead>

              <tbody>
                {hourRows.length === 0 ? (
                  <tr>
                    <td className="ov-empty" colSpan={2}>
                      لا توجد بيانات ساعات عمل أو حجوزات لليوم
                    </td>
                  </tr>
                ) : (
                  hourRows.map((row) => (
                    <tr key={`h_${row.hour}`}>
                      <td className="ov-hour-cell">{formatHourLabel(row.hour)}</td>
                      <td>
                        {row.bookings.length === 0 ? (
                          <span className="ov-hour-empty-chip">لا يوجد حجز</span>
                        ) : (
                          <div className="ov-hour-bookings">
                            {row.bookings.map((b) => (
                              <button
                                key={`${row.hour}_${b.id}`}
                                type="button"
                                className="ov-hour-booking-pill"
                                onClick={() => onOpenBooking(b)}
                                title="عرض تفاصيل الحجز"
                              >
                                <span className="ov-hour-booking-name">{b.customerName}</span>
                                <span className="ov-hour-booking-time">{formatTime12(b.time)}</span>
                                <span className={`status-badge ${b.status}`}>
                                  {statusLabel[b.status]}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="ov-latest-mobile">
            {hourRows.length === 0 ? (
              <div className="ov-empty">لا توجد بيانات ساعات عمل أو حجوزات لليوم</div>
            ) : (
              hourRows.map((row) => (
                <div key={`m_h_${row.hour}`} className="ov-hour-mobile-row">
                  <div className="ov-hour-mobile-title">{formatHourLabel(row.hour)}</div>
                  {row.bookings.length === 0 ? (
                    <div className="ov-hour-mobile-empty">لا يوجد حجز</div>
                  ) : (
                    <div className="ov-hour-mobile-list">
                      {row.bookings.map((b) => (
                        <button
                          key={`m_${row.hour}_${b.id}`}
                          type="button"
                          className="ov-hour-mobile-booking"
                          onClick={() => onOpenBooking(b)}
                        >
                          <div className="ov-hour-mobile-top">
                            <strong>{b.customerName}</strong>
                            <span className={`status-badge ${b.status}`}>{statusLabel[b.status]}</span>
                          </div>
                          <div className="ov-hour-mobile-meta">
                            <span>{formatTime12(b.time)}</span>
                            <span>{b.serviceName || b.serviceId || "-"}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="ov-card">
          <div className="ov-card-head">
            <h3>إجراءات سريعة</h3>
          </div>

          <div className="ov-actions">
            <div className="ov-action">
              <div className="ov-action-ico">
                <FontAwesomeIcon icon={faCalendarAlt} />
              </div>
              <div className="ov-action-body">
                <h4>حجز جديد</h4>
                <p>إضافة حجز جديد للعميلات</p>
              </div>
              <button
                className="exp-btn primary"
                onClick={() => onQuickAction("newBooking")}
                type="button"
              >
                إضافة حجز
              </button>
            </div>

            <div className="ov-action">
              <div className="ov-action-ico">
                <FontAwesomeIcon icon={faUsers} />
              </div>
              <div className="ov-action-body">
                <h4>إدارة الحجوزات</h4>
                <p>عرض وإدارة جميع الحجوزات</p>
              </div>
              <button
                className="exp-btn ghost"
                onClick={() => onQuickAction("bookings")}
                type="button"
              >
                إدارة الحجوزات
              </button>
            </div>

            <div className="ov-action">
              <div className="ov-action-ico">
                <FontAwesomeIcon icon={faChartLine} />
              </div>
              <div className="ov-action-body">
                <h4>التقارير</h4>
                <p>عرض تقارير الأداء والإيرادات</p>
              </div>
              <button
                className="exp-btn outline"
                onClick={() => onQuickAction("reports")}
                type="button"
              >
                عرض التقارير
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ✅ Roles
type UiRole = "owner" | "admin" | "reception" | "staff";

interface UserInfo {
  name: string;
  role: UiRole;
  email: string;
}

// ✅ IMPORTANT: normalize role هنا (حل تعليق staff بسبب Staff/ staff / spaces)
function mapProfileRoleToDashboardRole(role: ProfileRole): UiRole | null {
  const r = String(role || "").toLowerCase().trim() as ProfileRole;

  if (r === "owner" || r === "admin" || r === "reception" || r === "staff") {
    return r;
  }
  return null;
}

const Dashboard: React.FC = () => {
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [dashError, setDashError] = useState<string>("");

  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  const [stats, setStats] = useState({
    todayBookings: 0,
    totalRevenue: 0,
    totalOperations: 0,
    employeesCount: 0,
  });

  const [todayScheduleBookings, setTodayScheduleBookings] = useState<Booking[]>([]);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);

  const [expensesTotalFS, setExpensesTotalFS] = useState(0);
  const [incomeTotalFS, setIncomeTotalFS] = useState(0);

  const [missingExpenseNotesCount, setMissingExpenseNotesCount] = useState(0);

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const navigate = useNavigate();

  const totalIncome = incomeTotalFS;
  const totalExpenses = expensesTotalFS;
  const netProfit = totalIncome - totalExpenses;

  /**
   * ✅ refresh من Firestore
   * ✅ تعديل مهم: لا نقرأ المصروفات إلا لو AdminPower (Owner/Admin)
   */
  const refreshDashboard = async (roleForRefresh?: UiRole) => {
    if (roleForRefresh === "staff") {
      setStats((prev) => ({
        ...prev,
        todayBookings: 0,
        totalRevenue: 0,
        totalOperations: 0,
      }));
      setTodayScheduleBookings([]);
      setExpensesTotalFS(0);
      setIncomeTotalFS(0);
      return;
    }

    let step = "start";

    const canReadExpensesNow = roleForRefresh === "owner" || roleForRefresh === "admin";

    try {
      step = "migrateBookingsIfNeeded";
      try {
        DashboardService.migrateBookingsIfNeeded?.();
      } catch (err) {
        console.warn("REFRESH -> migrateBookingsIfNeeded skipped:", err);
      }

      step = "bookings:listAllBookings";
      const docs = await listAllBookingsFS();

      step = "bookings:mapFirestoreToUiBooking";
      const uiBookings = await Promise.all(docs.map(mapFirestoreToUiBooking));

      step = "today:compute";
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, "0");
      const dd = String(today.getDate()).padStart(2, "0");
      const todayStr = `${yyyy}-${mm}-${dd}`;

      const todayListAll = uiBookings.filter((b) => String(b.date) === todayStr);

      const todayList = todayListAll.filter(
        (b) => b.status === "confirmed" || b.status === "completed"
      );

      let todayRevenue = todayList.reduce(
        (sum, b) => sum + (Number((b as any).total) || 0),
        0
      );


      let employeesCount = 0;
      try {
        step = "stats:DashboardService.getStats";
        const s = await DashboardService.getStats();
        employeesCount = Number(s?.employeesCount || 0);
      } catch (err) {
        console.warn("REFRESH -> getStats failed:", err);
        employeesCount = 0;
      }

      if (canReadExpensesNow) {
        // ✅ income
        step = "income:listAllIncomeFS";
        const incomes = await listAllIncomeFS("main");

        step = "income:sum";
        const incomeTotal = incomes
          .filter((x: any) => {
            const source = String(x?.source || "").toLowerCase().trim();
            if (source === "invoice") return true;
            const st = String(x?.status || "").toLowerCase().trim();
            return source === "booking" && (st === "confirmed" || st === "completed");
          })
          .reduce((sum: number, x: any) => sum + (Number(x?.amount) || 0), 0);

        todayRevenue = incomes
          .filter((x: any) => {
            const source = String(x?.source || "").toLowerCase().trim();
            if (source === "invoice") {
              return String(x?.date || "").trim() === todayStr;
            }
            const st = String(x?.status || "").toLowerCase().trim();
            return (
              source === "booking" &&
              (st === "confirmed" || st === "completed") &&
              String(x?.date || "").trim() === todayStr
            );
          })
          .reduce((sum: number, x: any) => sum + (Number(x?.amount) || 0), 0);

        setIncomeTotalFS(incomeTotal);

        // ✅ expenses
        step = "expenses:listAllExpensesFS";
        const expenses = await listAllExpensesFS();

        step = "expenses:sum";
        const expensesTotal = expenses.reduce(
          (sum, e) => sum + (Number((e as any).amount) || 0),
          0
        );
        setExpensesTotalFS(expensesTotal);
      } else {
        setIncomeTotalFS(0);
        setExpensesTotalFS(0);
      }

      step = "ui:setStats/setTodayScheduleBookings";
      setStats({
        todayBookings: todayList.length,
        totalRevenue: todayRevenue,
        totalOperations: uiBookings.length,
        employeesCount,
      });

      const todaySchedule = todayListAll
        .filter((b) => b.status !== "cancelled")
        .sort((a, b) => {
          const aMin = parseTimeToMinutes(a.time);
          const bMin = parseTimeToMinutes(b.time);
          if (aMin === null && bMin === null) return 0;
          if (aMin === null) return 1;
          if (bMin === null) return -1;
          return aMin - bMin;
        });

      setTodayScheduleBookings(todaySchedule);
    } catch (e) {
      console.error("refreshDashboard error:", e);

      const code = (e as any)?.code || (e as any)?.name || "-";
      const msg = String((e as any)?.message || "");

      alert(`❌ Dashboard Refresh Failed\nstep: ${step}\ncode: ${code}\nmsg: ${msg}`);

      setStats((prev) => ({
        ...prev,
        todayBookings: 0,
        totalRevenue: 0,
        totalOperations: 0,
      }));
      setTodayScheduleBookings([]);
      setExpensesTotalFS(0);
      setIncomeTotalFS(0); // ✅ FIX (كان ناقص)
    }
  };

  // ✅ Badge المصروفات بدون ملاحظات (AdminPower only)
  useEffect(() => {
    if (!userInfo) return;

    const isAdminPowerNow = userInfo.role === "owner" || userInfo.role === "admin";

    if (!isAdminPowerNow) {
      setMissingExpenseNotesCount(0);
      return;
    }

    let alive = true;

    const load = async () => {
      try {
        const n = await countMonthlyExpensesMissingNotesFS("main");
        if (alive) setMissingExpenseNotesCount(Number(n || 0));
      } catch {
        if (alive) setMissingExpenseNotesCount(0);
      }
    };

    load();
    const t = window.setInterval(load, 60_000);

    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [userInfo?.role]);

  /**
   * ✅ ربط Dashboard مع Firestore settings/app (Realtime)
   */
  useEffect(() => {
    try {
      const cached = AppSettingsService.getCached() as any;
      setSettings((prev) => ({
        ...prev,
        ...cached,
        sections: { ...prev.sections, ...(cached?.sections || {}) },
        policies: { ...prev.policies, ...(cached?.policies || {}) },
      }));
    } catch { }

    const unsub = AppSettingsService.subscribe((remote: any) => {
      setSettings((prev) => ({
        ...prev,
        ...remote,
        sections: { ...prev.sections, ...(remote?.sections || {}) },
        policies: { ...prev.policies, ...(remote?.policies || {}) },
      }));

      localStorage.setItem(SETTINGS_KEY, JSON.stringify(remote));
      window.dispatchEvent(new Event("settingsChanged"));
    });

    return () => unsub?.();
  }, []);

  /**
   * ✅ FIX تعليق الموظف:
   */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      let step = "auth:start";
      try {
        setDashError("");

        step = "auth:checkUser";
        if (!user) {
          navigate("/login");
          return;
        }

        step = "profile:createOrLoadUserProfile";
        let profile: UserProfile | null = null;

        try {
          profile = await createOrLoadUserProfile(user);
        } catch (e: any) {
          const msg = String(e?.message || "");
          console.warn("createOrLoadUserProfile failed:", msg);

          if (msg.includes("Missing or insufficient permissions")) {
            profile = null;
          } else {
            throw e;
          }
        }

        if (!profile) {
          step = "profile:fallback";

          const cachedRole = String(localStorage.getItem("userRole") || "")
            .toLowerCase()
            .trim();

          const fallbackRole: UiRole =
            cachedRole === "owner" ||
              cachedRole === "admin" ||
              cachedRole === "reception" ||
              cachedRole === "staff"
              ? (cachedRole as UiRole)
              : "staff";

          const fallbackName =
            localStorage.getItem("userName") ||
            user.displayName ||
            user.email ||
            "موظفة";

          setUserInfo({
            name: fallbackName,
            role: fallbackRole,
            email: user.email || "",
          });

          await refreshDashboard(fallbackRole);
          return;
        }

        step = `profile:loaded role=${profile?.role || "-"}`;

        step = "profile:canAccessDashboard";
        if (!canAccessDashboard(profile.role)) {
          navigate("/profile");
          return;
        }

        step = "profile:mapRoleToDashboardRole";
        const dashRole = mapProfileRoleToDashboardRole(profile.role);
        if (!dashRole) {
          navigate("/profile");
          return;
        }

        step = "ui:setUserInfo";
        const name = profile.name || user.displayName || "مستخدم";

        setUserInfo({
          name,
          role: dashRole,
          email: profile.email || user.email || "",
        });

        await refreshDashboard(dashRole);
      } catch (err: any) {
        const msg = String(err?.message || err || "");
        console.error("Dashboard auth error:", { step, err });
        setDashError(`❌ Dashboard blocked\nstep: ${step}\nmsg: ${msg}`);
      }
    });

    return () => unsub();
  }, [navigate]);

  // ✅ Auto Job (Client-side): كل 5 دقائق
  // - pending  -> cancelled (يفك slots)
  // - confirmed -> completed (لا يفك slots)
  // ✅ حماية: يشتغل Owner/Admin فقط
  useEffect(() => {
    if (!userInfo) return;

    const canRun = userInfo.role === "owner" || userInfo.role === "admin";
    if (!canRun) return;

    const role = userInfo.role; // ✅ ثبت الدور هنا عشان TS ما يقول userInfo ممكن null
    const businessHoursMap = (settings as any)?.booking?.businessHours || {};

    let alive = true;
    let running = false;

    const parseHHMM = (time: string) => {
      const m = String(time || "").trim().match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return null;
      const hh = Number(m[1]);
      const mm = Number(m[2]);
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
      return { hh, mm };
    };

    const parseISODate = (dateStr: string) => {
      const m = String(dateStr || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return null;
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
      return { y, mo, d };
    };

    const resolveWeekdayFromISO = (dateStr: string): WeekdayKey | null => {
      const p = parseISODate(dateStr);
      if (!p) return null;
      const dt = new Date(p.y, Math.max(0, p.mo - 1), p.d);
      return JS_DAY_TO_WEEKDAY[dt.getDay()] || null;
    };

    const toMinutesFromHHMM = (timeStr: string): number | null => {
      const t = parseHHMM(timeStr);
      if (!t) return null;
      return t.hh * 60 + t.mm;
    };

    // ✅ ليلية-aware:
    // - الحجز يظل business-date كما هو
    // - لكن لو اليوم Overnight (start > end) والوقت بعد منتصف الليل (< end) نحسبه اليوم التالي فعليًا
    const toEffectiveDateStart = (dateStr: string, timeStr: string) => {
      const p = parseISODate(dateStr);
      const t = parseHHMM(timeStr);
      if (!p || !t) return null;

      const start = new Date(p.y, Math.max(0, p.mo - 1), p.d, t.hh, t.mm, 0, 0);

      const dayKey = resolveWeekdayFromISO(dateStr);
      if (!dayKey) return start;

      const dayCfg = (businessHoursMap as any)?.[dayKey] || {};
      const openMin = toMinutesFromHHMM(String(dayCfg?.start || ""));
      const closeMin = toMinutesFromHHMM(String(dayCfg?.end || ""));
      const slotMin = t.hh * 60 + t.mm;

      const isOvernight =
        openMin !== null &&
        closeMin !== null &&
        openMin > closeMin;

      if (isOvernight && closeMin !== null && slotMin < closeMin) {
        start.setDate(start.getDate() + 1);
      }

      return start;
    };

    async function tick() {
      if (!alive) return;
      if (running) return;
      running = true;

      try {
        const rows = await listAllBookingsFS();
        const now = new Date();

        for (const b of rows) {
          if (!b?.date || !b?.time) continue;

          const st = String(b.status || "pending");
          if (st !== "pending" && st !== "confirmed") continue;

          const start = toEffectiveDateStart(String(b.date || ""), String(b.time || ""));
          if (!start) continue;

          // ✅ SAFE duration (بدون كراش)
          const duration =
            Number(b?.serviceSnapshot?.durationAtBooking ?? b?.durationMin ?? 0) || 60;

          const end = new Date(start.getTime() + duration * 60_000);

          if (now < end) continue;

          if (st === "pending") {
            await updateBookingStatusFS(b.id, "cancelled"); // يفك slots من داخل firestoreBookings
          } else if (st === "confirmed") {
            await updateBookingStatusFS(b.id, "completed");
          }
        }

        await refreshDashboard(role); // ✅ بدل userInfo.role
      } catch (e) {
        console.error("[AUTO] tick error:", e);
      } finally {
        running = false;
      }
    }

    tick();
    const id = window.setInterval(tick, 5 * 60_000);

    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [userInfo?.role, settings.booking?.businessHours]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } finally {
      localStorage.removeItem("authToken");
      localStorage.removeItem("userRole");
      localStorage.removeItem("userName");
      localStorage.removeItem("userUid");
      localStorage.removeItem("userEmail");
      localStorage.removeItem("userPhone");
      localStorage.removeItem("auth_user");
      localStorage.removeItem("user_profile_v1");
      localStorage.removeItem("showWelcome");
      window.dispatchEvent(new Event("authChanged"));
      navigate("/");
    }
  };

  const isOwner = userInfo?.role === "owner";
  const isAdmin = userInfo?.role === "admin";
  const isReception = userInfo?.role === "reception";
  const isStaff = userInfo?.role === "staff";

  const hasAdminPower = Boolean(isOwner || isAdmin);

  const allowStaffChangeStatus = settings.policies.allowStaffChangeStatus;
  const allowReceptionChangeStatus = settings.policies.allowReceptionChangeStatus;
  const allowStaffViewClients = settings.policies.allowStaffViewClients;

  const canSeeSection = (key: SectionKey) => settings.sections[key] !== false;

  const getRoleIcon = (role: UiRole) => {
    switch (role) {
      case "owner":
        return faUserShield;
      case "admin":
        return faUserShield;
      case "staff":
        return faUserTie;
      default:
        return faUser;
    }
  };

  const getRoleTitle = (role: UiRole) => {
    switch (role) {
      case "owner":
        return "المالكة";
      case "admin":
        return "مديرة الصالون";
      case "reception":
        return "موظفة الاستقبال";
      case "staff":
        return "موظفة";
      default:
        return "مستخدم";
    }
  };

  // ✅ QUICK ACTIONS (تم تعديل newBooking)
  const handleQuickAction = (key: "newBooking" | "bookings" | "reports") => {
    if (key === "newBooking") navigate("/dashboard/booking-internal");
    if (key === "bookings") navigate("/dashboard/bookings");
    if (key === "reports") navigate("/dashboard/reports");
    setIsSidebarOpen(false);
  };


  const handleOpenBooking = (booking: Booking) => setSelectedBooking(booking);

  const handleChangeStatus = async (id: string, status: BookingStatus) => {
    const canReceptionChange = isReception && allowReceptionChangeStatus;
    const canStaffChange = isStaff && allowStaffChangeStatus;

    if (hasAdminPower || canReceptionChange || canStaffChange) {
      try {
        await updateBookingStatusFS(id, status);
        const roleNow = userInfo?.role;
        await refreshDashboard(roleNow);
        setSelectedBooking((prev) =>
          prev && prev.id === id ? { ...prev, status } : prev
        );
      } catch (e) {
        console.error(e);
        alert("تعذر تحديث الحالة. تأكد من الصلاحيات/Rules.");
      }
    }
  };

  useEffect(() => {
    const close = () => setIsSidebarOpen(false);
    window.addEventListener("popstate", close);
    return () => window.removeEventListener("popstate", close);
  }, []);

  if (dashError) {
    return (
      <div className="dashboard-loading" style={{ direction: "ltr", textAlign: "left" }}>
        <pre style={{ whiteSpace: "pre-wrap", maxWidth: 900 }}>{dashError}</pre>
      </div>
    );
  }

  if (!userInfo) {
    return <LoadingBrand text="جاري تحميل لوحة التحكم..." />;
  }

  const topbarName = String(userInfo?.name ?? "")
    .replace(/[\u200B-\u200F\u202A-\u202E]/g, "")
    .replace(/\s+/g, " ")
    .trim();


  return (
    <div className="dashboard-skin dashboard-page dashboard-skin-page">
      {/* ✅ Scoped styles: Booking Details Modal layout (fix broken column/white space) */}
      <style>
        {`
          .dash-booking-modal { direction: rtl; }

          .dash-booking-modal .dash-modal-head{
            display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;
          }

          .dash-booking-modal .dash-modal-title{ display:flex; flex-direction:column; gap:2px; }
          .dash-booking-modal .dash-modal-title h3{ margin:0; font-weight:900; letter-spacing:.2px; }
          .dash-booking-modal .dash-modal-title small{ opacity:.7; font-weight:700; }

          .dash-booking-modal .dash-details-grid{
            display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:12px; margin-top:14px;
          }

          .dash-booking-modal .dash-detail{
            background:rgba(255,255,255,0.85);
            border:1px solid rgba(0,0,0,0.06);
            border-radius:16px;
            padding:12px;
            box-shadow:0 8px 20px rgba(0,0,0,0.04);
            min-width:0;
          }

          .dash-booking-modal .dash-detail b{
            display:block; font-size:12px; opacity:.75; margin-bottom:6px; font-weight:900;
          }

          .dash-booking-modal .dash-detail .dash-value{
            font-weight:900; font-size:14px; color:#2f2a2a; word-break:break-word;
          }

          .dash-booking-modal .dash-detail--wide{ grid-column:span 3; }

          .dash-booking-modal .dash-status-row{
            display:flex; align-items:center; gap:10px; flex-wrap:wrap;
          }

          .dash-booking-modal .dash-select{
            height:44px !important;
            border-radius:14px !important;
            font-weight:900 !important;
            border:1px solid rgba(0,0,0,0.10) !important;
            background:#fff !important;
            padding:0 12px !important;
          }

          .dash-booking-modal .dash-modal-actions{
            display:flex; gap:10px; justify-content:flex-end; margin-top:14px; flex-wrap:wrap;
          }

          @media (max-width: 992px){
            .dash-booking-modal .dash-details-grid{ grid-template-columns:repeat(2, minmax(0, 1fr)); }
            .dash-booking-modal .dash-detail--wide{ grid-column:span 2; }
          }

          @media (max-width: 600px){
            .dash-booking-modal .dash-details-grid{ grid-template-columns:1fr; }
            .dash-booking-modal .dash-detail--wide{ grid-column:span 1; }
            .dash-booking-modal .dash-modal-actions .exp-btn{ width:100%; justify-content:center; }
          }
        `}
      </style>

      {isSidebarOpen && (
        <div className="dash-side-overlay" onClick={() => setIsSidebarOpen(false)} />
      )}

      <div className="container-fluid">
        <div className="row">
          {/* Sidebar */}
          <div
            className={`col-md-3 col-lg-2 dashboard-sidebar ${isSidebarOpen ? "is-open" : ""}`}
          >
            <button
              type="button"
              className="dash-mobile-close"
              onClick={() => setIsSidebarOpen(false)}
              aria-label="إغلاق القائمة"
              title="إغلاق"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>

            <div className="sidebar-header">
              <img src={logo1} alt="MALIKAT SALON Logo" className="sidebar-logo" />
            </div>

            <div className="user-info">
              <div className="user-avatar">
                <FontAwesomeIcon icon={getRoleIcon(userInfo.role)} />
              </div>
              <div className="user-details">
                <h5>{userInfo.name}</h5>
                <p>{getRoleTitle(userInfo.role)}</p>
              </div>
            </div>

            <nav className="sidebar-nav">
              <ul>
                {(isStaff || hasAdminPower || isReception) && (
                  <li>
                    <NavLink
                      to="/dashboard/staff"
                      className="nav-link"
                      onClick={() => setIsSidebarOpen(false)}
                    >
                      <FontAwesomeIcon icon={faUserTie} />
                      بوابة الموظفات
                    </NavLink>
                  </li>
                )}

                {!isStaff && canSeeSection("overview") && (
                  <li>
                    <NavLink
                      to="/dashboard/overview"
                      className="nav-link"
                      onClick={() => setIsSidebarOpen(false)}
                    >
                      <FontAwesomeIcon icon={faChartLine} />
                      نظرة عامة
                    </NavLink>
                  </li>
                )}

                {(hasAdminPower || isReception) && canSeeSection("bookings") && (
                  <li>
                    <NavLink
                      to="/dashboard/bookings"
                      className="nav-link"
                      onClick={() => setIsSidebarOpen(false)}
                    >
                      <FontAwesomeIcon icon={faCalendarAlt} />
                      الحجوزات
                    </NavLink>
                  </li>
                )}

                {(hasAdminPower || isReception) && canSeeSection("bookings") && (
                  <li>
                    <NavLink
                      to="/dashboard/booking-internal"
                      className="nav-link"
                      onClick={() => setIsSidebarOpen(false)}
                    >
                      <FontAwesomeIcon icon={faUserShield} />
                      الحجز الإداري
                    </NavLink>
                  </li>
                )}

                {(hasAdminPower || (isReception && allowStaffViewClients)) &&
                  canSeeSection("clients") && (
                    <li>
                      <NavLink
                        to="/dashboard/clients"
                        className="nav-link"
                        onClick={() => setIsSidebarOpen(false)}
                      >
                        <FontAwesomeIcon icon={faUsers} />
                        العملاء
                      </NavLink>
                    </li>
                  )}

                {hasAdminPower && canSeeSection("employees") && (
                  <li>
                    <NavLink
                      to="/dashboard/employees"
                      className="nav-link"
                      onClick={() => setIsSidebarOpen(false)}
                    >
                      <FontAwesomeIcon icon={faUserTie} />
                      الموظفات
                    </NavLink>
                  </li>
                )}

                {hasAdminPower && canSeeSection("offers") && (
                  <li>
                    <NavLink
                      to="/dashboard/offers"
                      className="nav-link"
                      onClick={() => setIsSidebarOpen(false)}
                    >
                      <FontAwesomeIcon icon={faPercent} />
                      العروض والكوبونات
                    </NavLink>
                  </li>
                )}

                {hasAdminPower && canSeeSection("reports") && (
                  <li>
                    <NavLink
                      to="/dashboard/reports"
                      className="nav-link"
                      onClick={() => setIsSidebarOpen(false)}
                    >
                      <FontAwesomeIcon icon={faChartPie} />
                      التقارير
                    </NavLink>
                  </li>
                )}

                {hasAdminPower && canSeeSection("income") && (
                  <li>
                    <NavLink
                      to="/dashboard/income"
                      className="nav-link"
                      onClick={() => setIsSidebarOpen(false)}
                    >
                      <FontAwesomeIcon icon={faWallet} />
                      الإيرادات
                    </NavLink>
                  </li>
                )}

                {hasAdminPower && canSeeSection("expenses") && (
                  <li>
                    <NavLink
                      to="/dashboard/expenses"
                      className="nav-link"
                      onClick={() => setIsSidebarOpen(false)}
                    >
                      <FontAwesomeIcon icon={faMoneyBillWave} />
                      <span className="dash-nav-label">
                        المصروفات
                        {missingExpenseNotesCount > 0 && (
                          <span className="dash-badge">{missingExpenseNotesCount}</span>
                        )}
                      </span>
                    </NavLink>
                  </li>
                )}

                {hasAdminPower && canSeeSection("logs") && (
                  <li>
                    <NavLink
                      to="/dashboard/logs"
                      className="nav-link"
                      onClick={() => setIsSidebarOpen(false)}
                    >
                      <FontAwesomeIcon icon={faClockRotateLeft} />
                      سجل الحركات
                    </NavLink>
                  </li>
                )}

                {hasAdminPower && (
                  <li>
                    <NavLink
                      to="/dashboard/loyalty"
                      className="nav-link"
                      onClick={() => setIsSidebarOpen(false)}
                    >
                      <FontAwesomeIcon icon={faChartPie} />
                      الولاء (VIP)
                    </NavLink>
                  </li>
                )}



                {hasAdminPower && canSeeSection("settings") && (
                  <li>
                    <NavLink
                      to="/dashboard/settings"
                      className="nav-link"
                      onClick={() => setIsSidebarOpen(false)}
                    >
                      <FontAwesomeIcon icon={faCog} />
                      الإعدادات
                    </NavLink>
                  </li>
                )}
              </ul>
            </nav>

            <div className="sidebar-footer">
              <button
                className="exp-btn home"
                type="button"
                onClick={() => navigate("/")}
                title="الصفحة الرئيسية"
                aria-label="الصفحة الرئيسية"
              >
                <FontAwesomeIcon icon={faHouse} />
                الصفحة الرئيسية
              </button>

              <button className="exp-btn logout" onClick={handleLogout} type="button">
                <FontAwesomeIcon icon={faSignOutAlt} />
                تسجيل الخروج
              </button>
            </div>
          </div>

          {/* Main Content */}
          <div className="col-md-9 col-lg-10 dashboard-main">
            <div className="dash-topbar dash-topbar--sticky">
              <div className="dash-topbar-left">
                <button
                  type="button"
                  className="dash-topbar-toggle"
                  onClick={() => setIsSidebarOpen(true)}
                  aria-label="فتح القائمة"
                  title="القائمة"
                >
                  <FontAwesomeIcon icon={faBars} />
                </button>

                <div className="dash-topbar-title">
                  <h2>لوحة التحكم</h2>
                  <span>{settings.salonName}</span>
                </div>
              </div>

              <div className="dash-topbar-right">
                <div className="dash-topbar-user">
                  <span
                    className="dash-topbar-name"
                    dir="rtl"
                    style={{ unicodeBidi: "plaintext" }}
                  >
                    {topbarName || "-"}
                  </span>
                  <span className="dash-topbar-role">{getRoleTitle(userInfo.role)}</span>
                </div>
              </div>
            </div>

            <div className="dashboard-inner">
              <Routes>
                <Route
                  index
                  element={
                    isStaff ? (
                      <Navigate to="staff" replace />
                    ) : (
                      <DashboardOverview
                        userInfo={userInfo}
                        stats={stats}
                        scheduleBookings={todayScheduleBookings}
                        businessHours={settings.booking?.businessHours}
                        onOpenBooking={handleOpenBooking}
                        onQuickAction={handleQuickAction}
                        financial={{
                          income: totalIncome,
                          expenses: totalExpenses,
                          profit: netProfit,
                        }}
                      />
                    )
                  }
                />

                <Route
                  path="staff"
                  element={
                    isStaff || hasAdminPower || isReception ? (
                      <DashboardStaff />
                    ) : (
                      <Navigate to="/dashboard/overview" replace />
                    )
                  }
                />

                {!isStaff && canSeeSection("overview") && (
                  <Route
                    path="overview"
                    element={
                      <DashboardOverview
                        userInfo={userInfo}
                        stats={stats}
                        scheduleBookings={todayScheduleBookings}
                        businessHours={settings.booking?.businessHours}
                        onOpenBooking={handleOpenBooking}
                        onQuickAction={handleQuickAction}
                        financial={{
                          income: totalIncome,
                          expenses: totalExpenses,
                          profit: netProfit,
                        }}
                      />
                    }
                  />
                )}

                // ✅ NEW: Route للحجز الداخلي داخل الداشبورد (Owner/Admin/Reception فقط)
                {(hasAdminPower || isReception) && (
                  <Route
                    path="booking-internal"
                    element={<BookingInternal internalMode />}
                  />
                )}

                {(hasAdminPower || isReception) && canSeeSection("bookings") && (
                  <Route path="bookings" element={<DashboardBookings />} />
                )}

                {(hasAdminPower || (isReception && allowStaffViewClients)) &&
                  canSeeSection("clients") && (
                    <Route path="clients" element={<DashboardClients />} />
                  )}

                {hasAdminPower && (
                  <Route path="loyalty" element={<DashboardLoyalty />} />
                )}


                {hasAdminPower && canSeeSection("employees") && (
                  <Route path="employees" element={<DashboardEmployees />} />
                )}

                {hasAdminPower && canSeeSection("offers") && (
                  <Route path="offers" element={<DashboardOffers />} />
                )}

                {hasAdminPower && canSeeSection("reports") && (
                  <Route path="reports" element={<DashboardReports />} />
                )}

                {hasAdminPower && canSeeSection("income") && (
                  <Route path="income" element={<DashboardIncome />} />
                )}

                {hasAdminPower && canSeeSection("expenses") && (
                  <Route path="expenses" element={<DashboardExpenses />} />
                )}

                {hasAdminPower && canSeeSection("settings") && (
                  <Route path="settings/*" element={<DashboardSettings />} />
                )}

                {hasAdminPower && canSeeSection("logs") && (
                  <Route path="logs" element={<DashboardLogs />} />
                )}

                <Route
                  path="*"
                  element={
                    isStaff ? (
                      <Navigate to="/dashboard/staff" replace />
                    ) : (
                      <Navigate to="/dashboard/overview" replace />
                    )
                  }
                />
              </Routes>
            </div>
          </div>
        </div>
      </div>

      {/* ✅ Modal تفاصيل الحجز */}
      {selectedBooking && (
        <Modal
          open={!!selectedBooking}
          onClose={() => setSelectedBooking(null)}
          ariaLabel="تفاصيل الحجز"
          panelClassName="dash-modal dash-booking-modal"
          size="lg"
        >
          <div className="dash-modal-head">
            <div className="dash-modal-title">
              <h3>تفاصيل الحجز</h3>
              <small>عرض تفاصيل الحجز بشكل مرتب وواضح</small>
            </div>

            <button
              className="exp-btn ghost"
              type="button"
              onClick={() => setSelectedBooking(null)}
            >
              <FontAwesomeIcon icon={faXmark} /> إغلاق
            </button>
          </div>

          <div className="dash-modal-body">
            <div className="dash-details-grid">
              <div className="dash-detail">
                <b>رقم الحجز</b>
                <div className="dash-value">{bookingNoOf(selectedBooking)}</div>
              </div>

              <div className="dash-detail">
                <b>العميلة</b>
                <div className="dash-value">{selectedBooking.customerName}</div>
              </div>

              <div className="dash-detail">
                <b>الخدمة</b>
                <div className="dash-value">
                  {selectedBooking.serviceName || selectedBooking.serviceId || "-"}
                </div>
              </div>

              <div className="dash-detail">
                <b>الموظفة</b>
                <div className="dash-value">{selectedBooking.employeeName ?? "-"}</div>
              </div>

              <div className="dash-detail">
                <b>التاريخ</b>
                <div className="dash-value">{selectedBooking.date}</div>
              </div>

              <div className="dash-detail">
                <b>الوقت</b>
                <div className="dash-value">{formatTime12(selectedBooking.time)}</div>
              </div>

              <div className="dash-detail">
                <b>الإجمالي</b>
                <div className="dash-value">
                  {selectedBooking.total ? `${selectedBooking.total} ريال` : "-"}
                </div>
              </div>

              <div className="dash-detail dash-detail--wide">
                <b>الحالة</b>

                <div className="dash-status-row">
                  {hasAdminPower ||
                    (isReception && allowReceptionChangeStatus) ||
                    (isStaff && allowStaffChangeStatus) ? (
                    <select
                      className="dash-select"
                      value={selectedBooking.status}
                      onChange={(e) =>
                        handleChangeStatus(selectedBooking.id, e.target.value as BookingStatus)
                      }
                    >
                      <option value="confirmed">مؤكد</option>
                      <option value="pending">في الانتظار</option>
                      <option value="completed">مكتمل</option>
                      <option value="cancelled">ملغي</option>
                    </select>
                  ) : (
                    <span className={`status-badge ${selectedBooking.status}`}>
                      {selectedBooking.status}
                    </span>
                  )}

                  {!hasAdminPower &&
                    !(isReception && allowReceptionChangeStatus) &&
                    !(isStaff && allowStaffChangeStatus) && (
                      <span style={{ fontSize: 12, opacity: 0.75 }}>
                        التعديل غير مسموح حسب إعدادات النظام
                      </span>
                    )}
                </div>
              </div>
            </div>

            <div className="dash-modal-actions">
              <button
                className="exp-btn ghost"
                onClick={() => navigate("/dashboard/bookings")}
                type="button"
              >
                فتح صفحة الحجوزات
              </button>
              <button
                className="exp-btn primary"
                onClick={() => setSelectedBooking(null)}
                type="button"
              >
                تم
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default Dashboard;

