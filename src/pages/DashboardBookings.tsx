// src/pages/DashboardBookings.tsx
import { useEffect, useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSearch,
  faFilter,
  faFileCsv,
  faXmark,
  faCircleInfo,
  faRotate,
} from "@fortawesome/free-solid-svg-icons";

// ✅ Firestore Auth
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../services/firebase";

import {
  listAllBookings,
  watchAllBookings, // ✅ NEW (Realtime)
  updateBookingStatus,
  createDashboardBooking,
  updateBookingDetails as updateBookingFields,
  type BookingStatus,
} from "../services/firestoreBookings";

import type { UiRole } from "../services/userProfile";

// ✅ Styles
import "../styles/DashboardModals.css";
import "../styles/DashboardBookings.css";

type StatusOption = BookingStatus | "all";

const NOTES_KEY = "dashboard_booking_notes_v1";
const SETTINGS_KEY = "dashboard_settings_v1";

const statusLabel: Record<BookingStatus, string> = {
  confirmed: "مؤكد",
  pending: "في الانتظار",
  cancelled: "ملغي",
  completed: "مكتمل",
};

type AppSettings = {
  policies?: {
    allowStaffChangeStatus?: boolean;
    allowStaffViewClients?: boolean;
  };
};

const defaultSettings: AppSettings = {
  policies: {
    allowStaffChangeStatus: true,
    allowStaffViewClients: true,
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
      policies: { ...defaultSettings.policies, ...(parsed?.policies || {}) },
    };
  } catch {
    return defaultSettings;
  }
}

function safeISODate(d: string | undefined | null) {
  if (!d) return "";
  return d.trim();
}

function inDateRange(bookingDate: string, from: string, to: string) {
  const d = safeISODate(bookingDate);
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function downloadCSV(filename: string, rows: string[][]) {
  const escapeCell = (cell: string) => {
    const s = (cell ?? "").toString();
    if (s.includes('"') || s.includes(",") || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const csv = rows.map((r) => r.map(escapeCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function loadNotesMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
    return {};
  } catch {
    return {};
  }
}

function saveNotesMap(map: Record<string, string>) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(map));
}

/** ✅ قراءة الدور من localStorage بشكل آمن
 * ✅ تعديل مهم: يقرأ من auth_user أولاً (الأصح) ثم userRole كـ fallback
 */
function getUiRole(): UiRole {
  try {
    const authUserRaw = localStorage.getItem("auth_user");
    if (authUserRaw) {
      const au = JSON.parse(authUserRaw);
      const r = String(au?.role || "").toLowerCase().trim();
      if (r === "owner") return "owner";
      if (r === "admin") return "admin";
      if (r === "reception") return "reception";
      if (r === "staff") return "staff";
      if (r === "client") return "client";
    }
  } catch {
    // ignore
  }

  const raw = (localStorage.getItem("userRole") || "").toLowerCase().trim();

  if (raw === "owner") return "owner";
  if (raw === "admin") return "admin";
  if (raw === "reception") return "reception";
  if (raw === "staff") return "staff";
  if (raw === "client") return "client";

  return "guest";
}

/** ✅ نوع UI للحجز داخل الصفحة */
type Booking = {
  id: string;

  customerName?: string;
  phone?: string;

  serviceName?: string;
  serviceId?: string;

  employeeName?: string;

  date: string;
  time: string;

  status: BookingStatus;

  total?: number;
  finalPrice?: number;
};

/** ✅ حل مشكلة اختلاف أسماء الهاتف في البيانات القديمة */
function getBookingPhone(b: Booking): string {
  const anyB = b as any;
  return String(
    anyB?.phone ??
      anyB?.customerPhone ??
      anyB?.customerMobile ??
      anyB?.mobile ??
      ""
  ).trim();
}

function getBookingTotal(b: Booking): number {
  const anyB = b as any;
  const v = Number(anyB?.total ?? anyB?.finalPrice ?? 0);
  return Number.isFinite(v) ? v : 0;
}

const DashboardBookings = () => {
  const [uiRole, setUiRole] = useState<UiRole>(() => getUiRole());
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [selected, setSelected] = useState<Booking | null>(null);

  // ✅ Loading
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>("");

  // فلترة
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [status, setStatus] = useState<StatusOption>("all");
  const [employee, setEmployee] = useState<string>("all");
  const [query, setQuery] = useState<string>("");

  // ✅ Dropdowns (custom) - Filters
  const [statusOpen, setStatusOpen] = useState(false);
  const [empOpen, setEmpOpen] = useState(false);
  const statusWrapRef = useRef<HTMLDivElement | null>(null);
  const empWrapRef = useRef<HTMLDivElement | null>(null);

  // ✅ Dropdowns (custom) - Table row status
  const [rowStatusOpenId, setRowStatusOpenId] = useState<string | null>(null);
  const rowStatusWrapRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // ✅ Dropdowns (custom) - Modal status
  const [modalStatusOpen, setModalStatusOpen] = useState(false);
  const modalStatusWrapRef = useRef<HTMLDivElement | null>(null);

  // ✅ Realtime unsubscribe holder
  const watchUnsubRef = useRef<null | (() => void)>(null);

  // ملاحظات إدارية محفوظة محليًا
  const [notesMap, setNotesMap] = useState<Record<string, string>>({});

  // ✅ مودال إضافة حجز
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string>("");

  const [form, setForm] = useState({
    clientName: "",
    clientPhone: "",
    serviceName: "",
    employeeName: "",
    date: "",
    time: "",
    total: "",
    note: "",
  });

  // ✅ تعديل كامل للحجز داخل المودال
  const [editMode, setEditMode] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");

  const [editForm, setEditForm] = useState({
    customerName: "",
    phone: "",
    serviceName: "",
    employeeName: "",
    date: "",
    time: "",
    total: "",
  });

  // ===== الصلاحيات =====
  const canView =
    uiRole === "owner" ||
    uiRole === "admin" ||
    uiRole === "reception" ||
    uiRole === "staff";

  const allowReceptionChangeStatus =
    settings?.policies?.allowStaffChangeStatus !== false;

  // ✅ تغيير الحالة: owner/admin دائمًا — reception حسب policy
  const canEditStatus =
    uiRole === "owner" ||
    uiRole === "admin" ||
    (uiRole === "reception" && allowReceptionChangeStatus);

  const canExportCSV = uiRole === "owner" || uiRole === "admin";

  // ✅ الملاحظات: owner/admin دائمًا — reception حسب policy
  const canEditNotes =
    uiRole === "owner" ||
    uiRole === "admin" ||
    (uiRole === "reception" && allowReceptionChangeStatus);

  /** ✅ refresh: قراءة الحجوزات من Firestore (manual fallback) */
  const refresh = async () => {
    const u = auth.currentUser;
    if (!u) {
      setLoading(false);
      setBookings([]);
      setLoadError("⚠️ سجّل دخول الإدارة أولاً ثم أعد المحاولة.");
      return;
    }

    try {
      setLoading(true);
      setLoadError("");

      const data = await listAllBookings();

      const mapped: Booking[] = (Array.isArray(data) ? data : []).map(
        (b: any) => ({
          id: String(b.id ?? ""),

          customerName:
            b.clientName ?? b.customerName ?? b.name ?? b.customer ?? "",
          phone: b.clientPhone ?? b.phone ?? b.mobile ?? "",

          serviceName: b.serviceName ?? b.service ?? "",
          serviceId: b.serviceId ?? "",

          employeeName: b.employeeName ?? b.employee ?? "",

          date: b.date ?? "",
          time: b.time ?? "",

          status: (b.status ?? "pending") as BookingStatus,

          total: Number(b.total ?? 0) || 0,
          finalPrice: Number(b.finalPrice ?? 0) || 0,
        })
      );

      setBookings(mapped);

      setSelected((prev) => {
        if (!prev?.id) return prev;
        const fresh = mapped.find((x) => x.id === prev.id);
        return fresh ?? prev;
      });
    } catch (e: any) {
      console.error("Failed to load bookings from Firestore:", e);

      const msg = String(e?.message || "");
      if (msg.toLowerCase().includes("missing or insufficient permissions")) {
        setLoadError(
          "⚠️ لا توجد صلاحيات كافية لعرض الحجوزات. تأكد من Firestore Rules أو تسجيل دخول الإدارة."
        );
      } else {
        setLoadError("⚠️ تعذر تحميل الحجوزات. جرّب تحديث الصفحة.");
      }

      setBookings([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setNotesMap(loadNotesMap());

    const unsub = onAuthStateChanged(auth, (u) => {
      setUiRole(getUiRole());

      // ✅ فصل أي اشتراك لايف سابق
      if (watchUnsubRef.current) {
        watchUnsubRef.current();
        watchUnsubRef.current = null;
      }

      if (u) {
        setLoading(true);
        setLoadError("");

        // ✅ Realtime: watchAllBookings
        // ✅ FIX: watchAllBookings يقبل callback واحد فقط (بدون onError ثاني)
        watchUnsubRef.current = watchAllBookings((data) => {
          try {
            const mapped: Booking[] = (Array.isArray(data) ? data : []).map(
              (b: any) => ({
                id: String(b.id ?? ""),

                customerName:
                  b.clientName ?? b.customerName ?? b.name ?? b.customer ?? "",
                phone: b.clientPhone ?? b.phone ?? b.mobile ?? "",

                serviceName: b.serviceName ?? b.service ?? "",
                serviceId: b.serviceId ?? "",

                employeeName: b.employeeName ?? b.employee ?? "",

                date: b.date ?? "",
                time: b.time ?? "",

                status: (b.status ?? "pending") as BookingStatus,

                total: Number(b.total ?? 0) || 0,
                finalPrice: Number(b.finalPrice ?? 0) || 0,
              })
            );

            setBookings(mapped);

            setSelected((prev) => {
              if (!prev?.id) return prev;
              const fresh = mapped.find((x) => x.id === prev.id);
              return fresh ?? prev;
            });

            setLoading(false);
          } catch (err: unknown) {
            console.error("watchAllBookings failed:", err);

            const msg = String((err as any)?.message || "");
            if (
              msg.toLowerCase().includes("missing or insufficient permissions")
            ) {
              setLoadError(
                "⚠️ لا توجد صلاحيات كافية لعرض الحجوزات. تأكد من Firestore Rules أو تسجيل دخول الإدارة."
              );
            } else {
              setLoadError("⚠️ تعذر تحميل الحجوزات (Realtime).");
            }

            setBookings([]);
            setLoading(false);
          }
        });
      } else {
        setBookings([]);
        setLoadError("⚠️ سجّل دخول الإدارة أولاً لعرض الحجوزات.");
        setLoading(false);
      }
    });

    const onAuthChanged = () => setUiRole(getUiRole());
    window.addEventListener("authChanged", onAuthChanged);

    const onSettingsChanged = () => setSettings(loadSettings());
    window.addEventListener("settingsChanged", onSettingsChanged);

    return () => {
      unsub();

      // ✅ فصل الريال تايم عند خروج الصفحة
      if (watchUnsubRef.current) {
        watchUnsubRef.current();
        watchUnsubRef.current = null;
      }

      window.removeEventListener("authChanged", onAuthChanged);
      window.removeEventListener("settingsChanged", onSettingsChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ Close dropdowns on outside click + ESC
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;

      // Filters
      if (statusOpen) {
        const el = statusWrapRef.current;
        if (el && !el.contains(t)) setStatusOpen(false);
      }

      if (empOpen) {
        const el = empWrapRef.current;
        if (el && !el.contains(t)) setEmpOpen(false);
      }

      // Row status dropdown
      if (rowStatusOpenId) {
        const el = rowStatusWrapRefs.current[rowStatusOpenId];
        if (el && !el.contains(t)) setRowStatusOpenId(null);
      }

      // Modal status dropdown
      if (modalStatusOpen) {
        const el = modalStatusWrapRef.current;
        if (el && !el.contains(t)) setModalStatusOpen(false);
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setStatusOpen(false);
        setEmpOpen(false);
        setRowStatusOpenId(null);
        setModalStatusOpen(false);
      }
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [statusOpen, empOpen, rowStatusOpenId, modalStatusOpen]);

  const employeesList = useMemo(() => {
    const s = new Set<string>();
    bookings.forEach((b) => {
      const name = (b.employeeName ?? "").trim();
      if (name) s.add(name);
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b, "ar"));
  }, [bookings]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return bookings.filter((b) => {
      if (dateFrom || dateTo) {
        if (!inDateRange(b.date, dateFrom, dateTo)) return false;
      }

      if (status !== "all" && b.status !== status) return false;

      if (employee !== "all") {
        const emp = (b.employeeName ?? "").trim();
        if (emp !== employee) return false;
      }

      if (q) {
        const name = String(b.customerName ?? "").toLowerCase();
        const phone = getBookingPhone(b).toLowerCase();
        if (!name.includes(q) && !phone.includes(q)) return false;
      }

      return true;
    });
  }, [bookings, dateFrom, dateTo, status, employee, query]);

  const stats = useMemo(() => {
    const totalBookings = filtered.length;
    const totalRevenue = filtered.reduce((sum, b) => sum + getBookingTotal(b), 0);

    const dist: Record<BookingStatus, number> = {
      confirmed: 0,
      pending: 0,
      cancelled: 0,
      completed: 0,
    };

    filtered.forEach((b) => {
      dist[b.status] = (dist[b.status] ?? 0) + 1;
    });

    return { totalBookings, totalRevenue, dist };
  }, [filtered]);

  const setToday = () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const iso = `${yyyy}-${mm}-${dd}`;
    setDateFrom(iso);
    setDateTo(iso);
  };

  const resetFilters = () => {
    setDateFrom("");
    setDateTo("");
    setStatus("all");
    setEmployee("all");
    setQuery("");
  };

  /** ✅ تحديث الحالة في Firestore */
  const changeStatus = async (
    id: string | undefined | null,
    newStatus: BookingStatus
  ) => {
    if (!id) return;
    if (!canEditStatus) return;

    try {
      await updateBookingStatus(id, newStatus);

      setBookings((prev) =>
        prev.map((b) => (b.id === id ? { ...b, status: newStatus } : b))
      );

      setSelected((prev) =>
        prev && prev.id === id ? { ...prev, status: newStatus } : prev
      );
    } catch (e) {
      console.error("Failed to update booking status:", e);
      refresh();
    }
  };

  const getAdminNote = (id: string | undefined | null) => {
    if (!id) return "";
    return notesMap[id] ?? "";
  };

  const saveAdminNote = (id: string | undefined | null, note: string) => {
    if (!id) return;
    if (!canEditNotes) return;

    const next = { ...notesMap, [id]: note };
    setNotesMap(next);
    saveNotesMap(next);
  };

  const exportCSV = () => {
    if (!canExportCSV) return;

    const rows: string[][] = [
      [
        "ID",
        "العميلة",
        "الجوال",
        "الخدمة",
        "الموظفة",
        "التاريخ",
        "الوقت",
        "الحالة",
        "الإجمالي",
        "ملاحظة إدارية",
      ],
    ];

    filtered.forEach((b) => {
      rows.push([
        b.id ?? "",
        b.customerName ?? "",
        getBookingPhone(b),
        String((b.serviceName ?? b.serviceId ?? "") ?? ""),
        String((b.employeeName ?? "") ?? ""),
        b.date ?? "",
        b.time ?? "",
        statusLabel[b.status] ?? b.status,
        String(getBookingTotal(b) || ""),
        canEditNotes ? getAdminNote(b.id) : "",
      ]);
    });

    const stamp = new Date();
    const yyyy = stamp.getFullYear();
    const mm = String(stamp.getMonth() + 1).padStart(2, "0");
    const dd = String(stamp.getDate()).padStart(2, "0");

    downloadCSV(`dashboard_bookings_${yyyy}-${mm}-${dd}.csv`, rows);
  };

  const statusBadgeClass = (s: BookingStatus) => `status-badge ${s}`;

  // ====== إنشاء حجز من الداشبورد ======
  function setField<K extends keyof typeof form>(key: K, value: string) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  function openCreate() {
    setCreateError("");
    setCreating(false);
    setCreateOpen(true);
  }

  function closeCreate() {
    if (creating) return;
    setCreateOpen(false);
  }

  async function handleCreateBooking() {
    try {
      setCreateError("");

      const uid = auth.currentUser?.uid;
      if (!uid) {
        setCreateError("لا يوجد مستخدم مسجّل دخول حالياً. سجّل دخول الإدارة أولاً.");
        return;
      }

      const clientName = form.clientName.trim();
      const clientPhone = form.clientPhone.trim();
      const serviceName = form.serviceName.trim();
      const employeeName = form.employeeName.trim();
      const date = form.date.trim();
      const time = form.time.trim();

      if (!clientName) return setCreateError("اكتب اسم العميلة.");
      if (!clientPhone) return setCreateError("اكتب رقم جوال العميلة.");
      if (!serviceName) return setCreateError("اكتب اسم الخدمة.");
      if (!employeeName) return setCreateError("اكتب اسم الموظفة.");
      if (!date) return setCreateError("اختر التاريخ.");
      if (!time) return setCreateError("اختر الوقت.");

      setCreating(true);

      const totalNumber = Number(form.total || 0);
      const total = Number.isFinite(totalNumber) ? totalNumber : 0;

      await createDashboardBooking({
        createdBy: uid,
        clientName,
        clientPhone,
        serviceName,
        employeeName,
        date,
        time,
        total,
        finalPrice: total,
        status: "confirmed",
        note: form.note?.trim() || undefined,
      });

      setCreateOpen(false);
      setForm({
        clientName: "",
        clientPhone: "",
        serviceName: "",
        employeeName: "",
        date: "",
        time: "",
        total: "",
        note: "",
      });

      // ✅ مع Realtime غالبًا ما تحتاج refresh، لكن نخليه كـ fallback
      await refresh();
    } catch (e) {
      console.error(e);
      setCreateError(
        "صار خطأ أثناء إنشاء الحجز. تأكد من Firestore Rules ثم جرّب مرة ثانية."
      );
    } finally {
      setCreating(false);
    }
  }

  // ====== تعديل الحجز كامل (داخل المودال) ======
  function setEditField(key: keyof typeof editForm, value: string) {
    setEditForm((p) => ({ ...p, [key]: value }));
  }

  function openDetails(b: Booking) {
    setSelected(b);
    setEditMode(false);
    setEditError("");
    setSavingEdit(false);
    setModalStatusOpen(false);

    setEditForm({
      customerName: String(b.customerName ?? ""),
      phone: String(getBookingPhone(b) ?? ""),
      serviceName: String(b.serviceName ?? b.serviceId ?? ""),
      employeeName: String(b.employeeName ?? ""),
      date: String(b.date ?? ""),
      time: String(b.time ?? ""),
      total: String(getBookingTotal(b) || ""),
    });
  }

  function closeDetails() {
    if (savingEdit) return;
    setSelected(null);
    setEditMode(false);
    setEditError("");
    setSavingEdit(false);
    setModalStatusOpen(false);
  }

  async function saveBookingEdits() {
    if (!selected?.id) return;
    if (!canEditStatus) return;

    setEditError("");

    const customerName = editForm.customerName.trim();
    const phone = editForm.phone.trim();
    const serviceName = editForm.serviceName.trim();
    const employeeName = editForm.employeeName.trim();
    const date = editForm.date.trim();
    const time = editForm.time.trim();

    if (!customerName) return setEditError("اكتب اسم العميلة.");
    if (!phone) return setEditError("اكتب رقم جوال العميلة.");
    if (!serviceName) return setEditError("اكتب اسم الخدمة.");
    if (!employeeName) return setEditError("اكتب اسم الموظفة.");
    if (!date) return setEditError("اختر التاريخ.");
    if (!time) return setEditError("اختر الوقت.");

    const totalNumber = Number(editForm.total || 0);
    const total = Number.isFinite(totalNumber) ? totalNumber : 0;

    try {
      setSavingEdit(true);

      await updateBookingFields(selected.id, {
        clientName: customerName,
        clientPhone: phone,
        serviceName,
        employeeName,
        date,
        time,
        total,
        finalPrice: total,
      });

      setBookings((prev) =>
        prev.map((b) =>
          b.id === selected.id
            ? {
                ...b,
                customerName,
                phone,
                serviceName,
                employeeName,
                date,
                time,
                total,
                finalPrice: total,
              }
            : b
        )
      );

      setSelected((prev) =>
        prev
          ? {
              ...prev,
              customerName,
              phone,
              serviceName,
              employeeName,
              date,
              time,
              total,
              finalPrice: total,
            }
          : prev
      );

      setEditMode(false);
    } catch (e) {
      console.error(e);
      setEditError("صار خطأ أثناء حفظ التعديل. تأكد من الصلاحيات ثم جرّب مرة ثانية.");
    } finally {
      setSavingEdit(false);
    }
  }

  if (!canView) {
    return (
      <div className="dashboard-section">
        <h3>غير مصرح</h3>
        <p>هذه الصفحة مخصصة للإدارة وموظفات الاستقبال فقط.</p>
      </div>
    );
  }

  // ✅ label helpers for dropdown
  const statusText =
    status === "all" ? "الكل" : statusLabel[status as BookingStatus] ?? "اختر";

  return (
    <div className="bookings-page">
      <div className="bookings-header">
        <h1>الحجوزات</h1>
        {!loading && loadError && <div className="bookings-error">{loadError}</div>}
      </div>

      {/* Filters Card */}
      <div className="bk-mini">
        <div className="bk-filters">
          <div className="bk-field">
            <label>
              <FontAwesomeIcon icon={faFilter} /> من تاريخ
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="form-control"
            />
          </div>

          <div className="bk-field">
            <label>إلى تاريخ</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="form-control"
            />
          </div>

          {/* ✅ Custom Dropdown: Status */}
          <div className="bk-field w-180">
            <label>الحالة</label>

            <div className="dash-dd-wrap" ref={statusWrapRef}>
              <button
                type="button"
                className="dash-select"
                onClick={() => {
                  setStatusOpen((s) => !s);
                  setEmpOpen(false);
                  setRowStatusOpenId(null);
                  setModalStatusOpen(false);
                }}
                aria-expanded={statusOpen}
              >
                {statusText}
              </button>

              {statusOpen && (
                <div className="dash-dd-menu" role="listbox">
                  {([
                    { value: "all", label: "الكل" },
                    { value: "confirmed", label: "مؤكد" },
                    { value: "pending", label: "في الانتظار" },
                    { value: "completed", label: "مكتمل" },
                    { value: "cancelled", label: "ملغي" },
                  ] as const).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`dash-dd-item ${status === opt.value ? "is-active" : ""}`}
                      onClick={() => {
                        setStatus(opt.value as StatusOption);
                        setStatusOpen(false);
                      }}
                      role="option"
                      aria-selected={status === opt.value}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ✅ Custom Dropdown: Employee */}
          <div className="bk-field w-200">
            <label>الموظفة</label>

            <div className="dash-dd-wrap" ref={empWrapRef}>
              <button
                type="button"
                className="dash-select"
                onClick={() => {
                  setEmpOpen((s) => !s);
                  setStatusOpen(false);
                  setRowStatusOpenId(null);
                  setModalStatusOpen(false);
                }}
                aria-expanded={empOpen}
              >
                {employee === "all" ? "الكل" : employee}
              </button>

              {empOpen && (
                <div className="dash-dd-menu" role="listbox">
                  <button
                    type="button"
                    className={`dash-dd-item ${employee === "all" ? "is-active" : ""}`}
                    onClick={() => {
                      setEmployee("all");
                      setEmpOpen(false);
                    }}
                    role="option"
                    aria-selected={employee === "all"}
                  >
                    الكل
                  </button>

                  {employeesList.map((emp) => (
                    <button
                      key={emp}
                      type="button"
                      className={`dash-dd-item ${employee === emp ? "is-active" : ""}`}
                      onClick={() => {
                        setEmployee(emp);
                        setEmpOpen(false);
                      }}
                      role="option"
                      aria-selected={employee === emp}
                    >
                      {emp}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="bk-search">
            <label>
              <FontAwesomeIcon icon={faSearch} /> بحث (الاسم / الجوال)
            </label>

            <div className="bk-search-row">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="form-control dash-select"
                placeholder="مثال: نورة أو 05xxxxxxx"
                style={{ flex: 1, minWidth: 200 }}
              />

              {canExportCSV && (
                <button
                  className="reports-btn "
                  type="button"
                  onClick={exportCSV}
                  disabled={loading}
                  title="Excel .xlsx"
                >
                  <FontAwesomeIcon icon={faFileCsv} /> تصدير Excel
                </button>
              )}
            </div>
          </div>

          <div className="bk-actions">
            <button className="dash-btn ghost" type="button" onClick={setToday}>
              اليوم
            </button>

            <button className="dash-btn ghost" type="button" onClick={resetFilters}>
              <FontAwesomeIcon icon={faRotate} /> إعادة ضبط
            </button>

            <button className="dash-btn ghost" type="button" onClick={refresh}>
              <FontAwesomeIcon icon={faRotate} /> تحديث
            </button>

            {canEditStatus && (
              <button className="exp-btn primary" type="button" onClick={openCreate}>
                + إضافة حجز
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="row mb-3">
        <div className="col-md-3 mb-2">
          <div className="stat-card">
            <div className="stat-info">
              <h3 className="value">{stats.totalBookings}</h3>
              <p>عدد الحجوزات (بعد الفلترة)</p>
            </div>
          </div>
        </div>

        <div className="col-md-3 mb-2">
          <div className="stat-card">
            <div className="stat-info">
              <h3 className="value">{stats.totalRevenue.toLocaleString()}</h3>
              <p>الإجمالي (ريال)</p>
            </div>
          </div>
        </div>

        <div className="col-md-6 mb-2">
          <div className="stat-card">
            <div className="stat-info">
              <h3 style={{ fontSize: 18 }}>توزيع الحالة</h3>
              <p>
                مؤكد: {stats.dist.confirmed} — انتظار: {stats.dist.pending} — مكتمل:{" "}
                {stats.dist.completed} — ملغي: {stats.dist.cancelled}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Table Card */}
      <div className="bookings-table-card">
        <div className="bk-table-wrap">
          <div className="table-responsive">
            <table className="bookings-table">
              <thead>
                <tr>
                  <th>العميلة</th>
                  <th>الجوال</th>
                  <th>الخدمة</th>
                  <th>الموظفة</th>
                  <th>التاريخ</th>
                  <th>الوقت</th>
                  <th>الحالة</th>
                  <th>تحكم</th>
                </tr>
              </thead>

              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center", padding: 16 }}>
                      {loading ? "جاري التحميل..." : "لا توجد نتائج مطابقة للفلترة"}
                    </td>
                  </tr>
                ) : (
                  filtered.map((b, idx) => (
                    <tr key={b.id ?? `row_${idx}`}>
                      <td>{b.customerName}</td>
                      <td>{getBookingPhone(b) || "-"}</td>
                      <td>{String((b.serviceName ?? b.serviceId ?? "-") ?? "-")}</td>
                      <td>{String((b.employeeName ?? "-") ?? "-")}</td>
                      <td>{b.date}</td>
                      <td>{b.time}</td>
                      <td>
                        <span className={statusBadgeClass(b.status)}>
                          {statusLabel[b.status]}
                        </span>
                      </td>

                      <td>
                        <div className="bk-actions-cell">
                          <button
                            className="exp-btn ghost"
                            onClick={() => openDetails(b)}
                            type="button"
                          >
                            <FontAwesomeIcon icon={faCircleInfo} /> تفاصيل
                          </button>

                          {canEditStatus && (
                            <button
                              className="exp-btn primary"
                              type="button"
                              onClick={() => {
                                openDetails(b);
                                setEditMode(true);
                              }}
                            >
                              تعديل
                            </button>
                          )}

                          {/* ✅ Custom Dropdown بدل <select> */}
                          <div
                            className="dash-dd-wrap"
                            ref={(el) => {
                              rowStatusWrapRefs.current[b.id] = el;
                            }}
                            style={{ minWidth: 170 }}
                          >
                            <button
                              type="button"
                              className="dash-select dash-select--sm"
                              disabled={!canEditStatus}
                              title={!canEditStatus ? "غير مصرح" : ""}
                              onClick={() => {
                                if (!canEditStatus) return;
                                setRowStatusOpenId((prev) => (prev === b.id ? null : b.id));
                                setStatusOpen(false);
                                setEmpOpen(false);
                                setModalStatusOpen(false);
                              }}
                              aria-expanded={rowStatusOpenId === b.id}
                            >
                              {statusLabel[b.status]}
                            </button>

                            {rowStatusOpenId === b.id && (
                              <div className="dash-dd-menu" role="listbox">
                                {([
                                  { value: "confirmed", label: "مؤكد" },
                                  { value: "pending", label: "في الانتظار" },
                                  { value: "completed", label: "مكتمل" },
                                  { value: "cancelled", label: "ملغي" },
                                ] as const).map((opt) => (
                                  <button
                                    key={opt.value}
                                    type="button"
                                    className={`dash-dd-item ${
                                      b.status === opt.value ? "is-active" : ""
                                    }`}
                                    onClick={() => {
                                      changeStatus(b.id, opt.value as BookingStatus);
                                      setRowStatusOpenId(null);
                                    }}
                                    role="option"
                                    aria-selected={b.status === opt.value}
                                  >
                                    {opt.label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Details Modal (UNIFIED) */}
      {selected &&
        createPortal(
          <div className="dash-modal-overlay" onClick={closeDetails}>
            <div className="dash-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <div className="modal-title-wrap">
                  <div className="modal-icon">
                    <FontAwesomeIcon icon={faCircleInfo} />
                  </div>
                  <h3 className="modal-title">
                    {editMode ? "تعديل الحجز" : "تفاصيل الحجز"}
                  </h3>
                </div>

                <button className="modal-close" type="button" onClick={closeDetails}>
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </div>

              <div className="modal-body">
                <div className="bk-details-grid">
                  <div className="bk-item">
                    <b>رقم الحجز:</b> {selected.id}
                  </div>

                  <div className="bk-item">
                    <b>الحالة:</b>
                    <span className={statusBadgeClass(selected.status)}>
                      {statusLabel[selected.status]}
                    </span>
                  </div>

                  <div className="bk-item">
                    <b>العميلة:</b>
                    {editMode ? (
                      <input
                        className="form-control"
                        value={editForm.customerName}
                        onChange={(e) => setEditField("customerName", e.target.value)}
                      />
                    ) : (
                      selected.customerName
                    )}
                  </div>

                  <div className="bk-item">
                    <b>الجوال:</b>
                    {editMode ? (
                      <input
                        className="form-control"
                        value={editForm.phone}
                        onChange={(e) => setEditField("phone", e.target.value)}
                      />
                    ) : (
                      getBookingPhone(selected) || "-"
                    )}
                  </div>

                  <div className="bk-item">
                    <b>الخدمة:</b>
                    {editMode ? (
                      <input
                        className="form-control"
                        value={editForm.serviceName}
                        onChange={(e) => setEditField("serviceName", e.target.value)}
                      />
                    ) : (
                      String(selected.serviceName ?? selected.serviceId ?? "-")
                    )}
                  </div>

                  <div className="bk-item">
                    <b>الموظفة:</b>
                    {editMode ? (
                      <input
                        className="form-control"
                        value={editForm.employeeName}
                        onChange={(e) => setEditField("employeeName", e.target.value)}
                      />
                    ) : (
                      selected.employeeName || "-"
                    )}
                  </div>

                  <div className="bk-item">
                    <b>التاريخ:</b>
                    {editMode ? (
                      <input
                        type="date"
                        className="form-control"
                        value={editForm.date}
                        onChange={(e) => setEditField("date", e.target.value)}
                      />
                    ) : (
                      selected.date
                    )}
                  </div>

                  <div className="bk-item">
                    <b>الوقت:</b>
                    {editMode ? (
                      <input
                        type="time"
                        className="form-control"
                        value={editForm.time}
                        onChange={(e) => setEditField("time", e.target.value)}
                      />
                    ) : (
                      selected.time
                    )}
                  </div>

                  <div className="bk-item" style={{ gridColumn: "1 / -1" }}>
                    <b>تغيير الحالة:</b>

                    {/* ✅ Custom Dropdown بدل <select> */}
                    <div className="dash-dd-wrap" ref={modalStatusWrapRef} style={{ marginTop: 8 }}>
                      <button
                        type="button"
                        className="dash-select dash-select--sm"
                        disabled={!canEditStatus}
                        title={!canEditStatus ? "غير مصرح" : ""}
                        onClick={() => {
                          if (!canEditStatus) return;
                          setModalStatusOpen((s) => !s);
                          setStatusOpen(false);
                          setEmpOpen(false);
                          setRowStatusOpenId(null);
                        }}
                        aria-expanded={modalStatusOpen}
                      >
                        {statusLabel[selected.status]}
                      </button>

                      {modalStatusOpen && (
                        <div className="dash-dd-menu" role="listbox">
                          {([
                            { value: "confirmed", label: "مؤكد" },
                            { value: "pending", label: "في الانتظار" },
                            { value: "completed", label: "مكتمل" },
                            { value: "cancelled", label: "ملغي" },
                          ] as const).map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              className={`dash-dd-item ${
                                selected.status === opt.value ? "is-active" : ""
                              }`}
                              onClick={() => {
                                changeStatus(selected.id, opt.value as BookingStatus);
                                setModalStatusOpen(false);
                              }}
                              role="option"
                              aria-selected={selected.status === opt.value}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {!canEditStatus && (
                      <span style={{ fontSize: 12, opacity: 0.7 }}>
                        (غير مسموح حسب صلاحياتك/الإعدادات)
                      </span>
                    )}
                  </div>
                </div>

                {editError && (
                  <div style={{ marginTop: 12, color: "#b00020", fontSize: 13 }}>
                    {editError}
                  </div>
                )}

                <div className="bk-note-card">
                  <b style={{ display: "block", marginBottom: 8 }}>ملاحظات إدارية:</b>

                  {canEditNotes ? (
                    <>
                      <textarea
                        className="form-control"
                        rows={4}
                        value={notesMap[selected.id ?? ""] ?? ""}
                        onChange={(e) => saveAdminNote(selected.id, e.target.value)}
                        placeholder="اكتب ملاحظة خاصة بالإدارة…"
                      />
                      <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
                        * يتم حفظ الملاحظة تلقائيًا في localStorage.
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 13, opacity: 0.8 }}>غير مصرح لك.</div>
                  )}
                </div>
              </div>

              <div className="modal-actions">
                {!editMode ? (
                  <button
                    className="btn-confirm"
                    type="button"
                    onClick={() => setEditMode(true)}
                    disabled={!canEditStatus}
                    title={!canEditStatus ? "غير مصرح" : ""}
                  >
                    تعديل
                  </button>
                ) : (
                  <button
                    className="btn-confirm"
                    type="button"
                    onClick={saveBookingEdits}
                    disabled={savingEdit}
                  >
                    {savingEdit ? "جاري الحفظ..." : "حفظ التعديل"}
                  </button>
                )}

                <button className="btn-cancel" type="button" onClick={refresh}>
                  <FontAwesomeIcon icon={faRotate} /> تحديث
                </button>

                <button className="btn-cancel" type="button" onClick={closeDetails}>
                  إغلاق
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Create Modal (UNIFIED) */}
      {createOpen &&
        createPortal(
          <div className="dash-modal-overlay" onClick={closeCreate}>
            <div className="dash-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <div className="modal-title-wrap">
                  <div className="modal-icon">+</div>
                  <h3 className="modal-title">إضافة حجز</h3>
                </div>

                <button
                  className="modal-close"
                  type="button"
                  onClick={closeCreate}
                  disabled={creating}
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </div>

              <div className="modal-body">
                <div className="bk-details-grid">
                  <div className="bk-item stack">
                    <label style={{ fontSize: 12, marginBottom: 6, display: "block" }}>
                      اسم العميلة
                    </label>
                    <input
                      className="form-control"
                      value={form.clientName}
                      onChange={(e) => setField("clientName", e.target.value)}
                      placeholder="مثال: نورة"
                    />
                  </div>

                  <div className="bk-item stack">
                    <label style={{ fontSize: 12, marginBottom: 6, display: "block" }}>
                      جوال العميلة
                    </label>
                    <input
                      className="form-control"
                      value={form.clientPhone}
                      onChange={(e) => setField("clientPhone", e.target.value)}
                      placeholder="05xxxxxxxx"
                    />
                  </div>

                  <div className="bk-item stack">
                    <label style={{ fontSize: 12, marginBottom: 6, display: "block" }}>
                      الخدمة
                    </label>
                    <input
                      className="form-control"
                      value={form.serviceName}
                      onChange={(e) => setField("serviceName", e.target.value)}
                      placeholder="مثال: قص شعر"
                    />
                  </div>

                  <div className="bk-item stack">
                    <label style={{ fontSize: 12, marginBottom: 6, display: "block" }}>
                      الموظفة
                    </label>
                    <input
                      className="form-control"
                      value={form.employeeName}
                      onChange={(e) => setField("employeeName", e.target.value)}
                      placeholder="مثال: سارة"
                    />
                  </div>

                  <div className="bk-item stack">
                    <label style={{ fontSize: 12, marginBottom: 6, display: "block" }}>
                      التاريخ
                    </label>
                    <input
                      type="date"
                      className="form-control"
                      value={form.date}
                      onChange={(e) => setField("date", e.target.value)}
                    />
                  </div>

                  <div className="bk-item stack">
                    <label style={{ fontSize: 12, marginBottom: 6, display: "block" }}>
                      الوقت
                    </label>
                    <input
                      type="time"
                      className="form-control"
                      value={form.time}
                      onChange={(e) => setField("time", e.target.value)}
                    />
                  </div>

                  <div className="bk-item stack">
                    <label style={{ fontSize: 12, marginBottom: 6, display: "block" }}>
                      الإجمالي (اختياري)
                    </label>
                    <input
                      type="number"
                      className="form-control"
                      value={form.total}
                      onChange={(e) => setField("total", e.target.value)}
                      placeholder="0"
                    />
                  </div>

                  <div className="bk-item stack">
                    <label style={{ fontSize: 12, marginBottom: 6, display: "block" }}>
                      ملاحظة (اختياري)
                    </label>
                    <input
                      className="form-control"
                      value={form.note}
                      onChange={(e) => setField("note", e.target.value)}
                      placeholder="مثال: تبيها بدري"
                    />
                  </div>
                </div>

                {createError && (
                  <div style={{ marginTop: 12, color: "#b00020", fontSize: 13 }}>
                    {createError}
                  </div>
                )}
              </div>

              <div className="modal-actions">
                <button
                  className="btn-confirm"
                  onClick={handleCreateBooking}
                  type="button"
                  disabled={creating}
                >
                  {creating ? "جاري الحفظ..." : "حفظ الحجز"}
                </button>

                <button
                  className="btn-cancel"
                  onClick={closeCreate}
                  type="button"
                  disabled={creating}
                >
                  إلغاء
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default DashboardBookings;
