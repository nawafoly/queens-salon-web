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
  faPlus,
} from "@fortawesome/free-solid-svg-icons";

// ✅ Firestore Auth
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../services/firebase";

import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query as fsQuery,
} from "firebase/firestore";

import {
  listAllBookings,
  watchAllBookings, // ✅ Realtime
  updateBookingStatus,
  createDashboardBooking,
  updateBookingDetails as updateBookingFields,
  type BookingStatus,
} from "../services/firestoreBookings";

import type { UiRole } from "../services/userProfile";

// ✅ NEW: resolve service name (make it readable)
import { resolveServiceName } from "../services/serviceResolver";

// ✅ NEW: AppSettings from Firestore (source of truth)
import { AppSettingsService, type AppSettings } from "../services/AppSettingsService";

// ✅ Styles
import "../styles/DashboardModals.css";
import "../styles/DashboardBookings.css";

/* =========================
   Constants / Types
========================= */

type StatusOption = BookingStatus | "all";

const NOTES_KEY = "dashboard_booking_notes_v1";

const statusLabel: Record<BookingStatus, string> = {
  confirmed: "مؤكد",
  pending: "في الانتظار",
  cancelled: "ملغي",
  completed: "مكتمل",
};

/* =========================
   Helpers
========================= */

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
 * ✅ يقرأ من auth_user أولاً (الأصح) ثم userRole كـ fallback
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

/** ✅ Get auth user name/email safely (from localStorage first, fallback to firebase user) */
function getAuthUserSafe(): { displayName: string; email: string } {
  try {
    const raw = localStorage.getItem("auth_user");
    if (raw) {
      const au = JSON.parse(raw);
      const displayName = String(au?.name || au?.displayName || "").trim();
      const email = String(au?.email || "").trim();
      return { displayName, email };
    }
  } catch {
    // ignore
  }

  const u = auth.currentUser;
  const displayName = String(u?.displayName || "").trim();
  const email = String(u?.email || "").trim();
  return { displayName, email };
}

/* =========================
   ✅ Smart name matching (Arabic-friendly)
========================= */

function stripArabicDiacritics(s: string) {
  return s
    .replace(
      /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED]/g,
      ""
    )
    .replace(/\u0640/g, "");
}

function normalizeArabicName(input: string) {
  const s = String(input || "").trim().toLowerCase();
  const noDia = stripArabicDiacritics(s);

  const unified = noDia
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  return unified;
}

function tokenizeName(s: string) {
  return normalizeArabicName(s)
    .split(" ")
    .map((t) => t.trim())
    .filter(Boolean);
}

function smartEmployeeMatch(
  employeeNameFromBooking: string,
  my: { displayName: string; email: string }
) {
  const empRaw = String(employeeNameFromBooking || "").trim();
  if (!empRaw) return false;

  const myNameRaw = String(my.displayName || "").trim();
  const myEmail = String(my.email || "").trim().toLowerCase();

  const emp = normalizeArabicName(empRaw);
  const meN = normalizeArabicName(myNameRaw);

  if (meN && emp === meN) return true;
  if (meN && (emp.includes(meN) || meN.includes(emp))) return true;

  const empTokens = tokenizeName(empRaw);
  const meTokens = tokenizeName(myNameRaw);

  if (meTokens.length && empTokens.length) {
    const setEmp = new Set(empTokens);
    const hasStrongCommon = meTokens.some((t) => t.length >= 3 && setEmp.has(t));
    if (hasStrongCommon) return true;
  }

  if (myEmail) {
    const local = myEmail.split("@")[0] || "";
    const localN = normalizeArabicName(local.replace(/[._-]/g, " "));
    if (localN && (emp.includes(localN) || localN.includes(emp))) return true;
  }

  return false;
}

/* =========================
   ✅ Services helpers (multi-services support)
========================= */

type BookingServiceItem = {
  serviceId?: string;
  serviceName?: string;
  price?: number;
  durationMin?: number;
};

function toStringArray(v: any): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x ?? "").trim()).filter(Boolean);
  return [];
}

function extractServicesFromAny(anyB: any): BookingServiceItem[] {
  // ✅ #1: services: [{serviceId, serviceName, ...}]
  const sArr = Array.isArray(anyB?.services) ? anyB.services : null;
  if (sArr && sArr.length) {
    return sArr
      .map((x: any) => ({
        serviceId: String(x?.serviceId ?? x?.id ?? x?.key ?? "").trim() || undefined,
        serviceName: String(x?.serviceName ?? x?.name ?? "").trim() || undefined,
        price: Number.isFinite(Number(x?.price)) ? Number(x?.price) : undefined,
        durationMin: Number.isFinite(Number(x?.durationMin)) ? Number(x?.durationMin) : undefined,
      }))
      .filter((x: any) => x.serviceId || x.serviceName);
  }

  // ✅ #2: serviceIds + serviceNames (arrays)
  const ids = toStringArray(anyB?.serviceIds);
  const names = toStringArray(anyB?.serviceNames);

  if (ids.length || names.length) {
    const max = Math.max(ids.length, names.length);
    const out: BookingServiceItem[] = [];
    for (let i = 0; i < max; i++) {
      const serviceId = ids[i] || "";
      const serviceName = names[i] || "";
      if (serviceId || serviceName) out.push({ serviceId: serviceId || undefined, serviceName: serviceName || undefined });
    }
    return out;
  }

  // ✅ #3: fallback single service
  const serviceId = String(anyB?.serviceId ?? anyB?.service ?? anyB?.serviceKey ?? "").trim();
  const serviceName = String(anyB?.serviceName ?? "").trim();

  if (serviceId || serviceName) return [{ serviceId: serviceId || undefined, serviceName: serviceName || undefined }];

  return [];
}

function serviceSummaryForTable(b: Booking): string {
  const list = b.services || [];
  if (!list.length) return b.serviceName || b.serviceId || "—";

  const firstName = (list[0]?.serviceName || list[0]?.serviceId || "").trim();
  if (list.length <= 1) return firstName || b.serviceName || b.serviceId || "—";

  const extra = list.length - 1;
  return `${firstName || (b.serviceName || b.serviceId || "خدمة")} + ${extra} خدمات`;
}

function servicesFullListText(b: Booking): string[] {
  const list = b.services || [];
  if (!list.length) {
    const single = String(b.serviceName || b.serviceId || "").trim();
    return single ? [single] : [];
  }
  return list.map((x) => String(x.serviceName || x.serviceId || "").trim()).filter(Boolean);
}

/* =========================
   UI Booking type + mappers
========================= */

type Booking = {
  id: string;

  publicId?: string;

  customerName?: string;
  phone?: string;

  // legacy (single)
  serviceName?: string;
  serviceId?: string;

  // ✅ multi
  services?: BookingServiceItem[];

  employeeName?: string;
  employeeId?: string | null;
  employeeUid?: string | null;

  date: string;
  time: string;

  status: BookingStatus;

  total?: number;
  finalPrice?: number;
};

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

function mapBooking(b: any): Booking {
  const serviceId = String(b?.serviceId ?? b?.service ?? b?.serviceKey ?? "").trim();
  const rawServiceName = String(b?.serviceName ?? "").trim();

  const services = extractServicesFromAny(b);

  return {
    id: String(b.id ?? ""),
    publicId: String(b?.publicId ?? "").trim() || undefined,

    customerName: b.clientName ?? b.customerName ?? b.name ?? b.customer ?? "",
    phone: b.clientPhone ?? b.phone ?? b.mobile ?? "",

    serviceId,
    serviceName: rawServiceName || serviceId || "",

    services: services.length ? services : undefined,

    employeeName: b.employeeName ?? b.employee ?? "",
    employeeId: b.employeeId ?? null,
    employeeUid: b.employeeUid ?? null,

    date: b.date ?? "",
    time: b.time ?? "",

    status: (b.status ?? "pending") as BookingStatus,

    total: Number(b.total ?? 0) || 0,
    finalPrice: Number(b.finalPrice ?? 0) || 0,
  };
}

/* =========================
   ✅ Resolve Services (Readable Names) + cache
========================= */

const serviceNameCache = new Map<string, string>();

async function safeResolveServiceName(key: string): Promise<string> {
  const k = String(key || "").trim();
  if (!k) return "";

  if (serviceNameCache.has(k)) return serviceNameCache.get(k)!;

  try {
    const name = await resolveServiceName(k);
    const finalName = String(name || k).trim() || k;
    serviceNameCache.set(k, finalName);
    return finalName;
  } catch {
    serviceNameCache.set(k, k);
    return k;
  }
}

async function enrichBookingsServiceNames(list: Booking[]): Promise<Booking[]> {
  const out = await Promise.all(
    list.map(async (b) => {
      // ✅ multi-services: resolve each item by serviceId (if present)
      if (b.services?.length) {
        const nextServices = await Promise.all(
          b.services.map(async (it) => {
            const id = String(it?.serviceId || "").trim();
            if (!id) return it;
            const resolved = await safeResolveServiceName(id);
            return { ...it, serviceName: resolved || it.serviceName };
          })
        );

        // also keep legacy serviceName resolved (for older UI parts)
        const legacyKey = String(b.serviceId || b.serviceName || "").trim();
        const legacyResolved = legacyKey ? await safeResolveServiceName(legacyKey) : "";

        return {
          ...b,
          services: nextServices,
          serviceName: legacyResolved || b.serviceName,
        };
      }

      // legacy single
      const key = String(b.serviceId || b.serviceName || "").trim();
      if (!key) return b;

      const resolved = await safeResolveServiceName(key);

      return {
        ...b,
        serviceName: resolved || b.serviceName,
      };
    })
  );
  return out;
}

/* =========================
   Small UI Pieces
========================= */

function StatusDot({ status }: { status: BookingStatus }) {
  const label = statusLabel[status] ?? status;
  return <span className={`status-badge ${status}`}>{label}</span>;
}

function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title?: string;
  onClose: () => void;
  children: any;
}) {
  if (!open) return null;

  return createPortal(
    <div className="dash-modal-overlay" onClick={onClose}>
      <div className="dash-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dash-modal-header">
          <h3>{title || "تفاصيل"}</h3>
          <button className="dash-close" type="button" onClick={onClose}>
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
        <div className="dash-modal-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}

/* =========================
   Staff list (for proper employeeId/uid)
========================= */

type StaffRow = {
  id: string; // staff_public doc id (employeeId)
  name: string;
  linkedUid?: string; // employeeUid (optional)
  active: boolean;
  showOnBooking?: boolean;
  onLeave?: boolean;
};

const SALON_ID = "main";
const STAFF_PUBLIC_COLLECTION = ["salons", SALON_ID, "staff_public"] as const;

function pickStaffById(list: StaffRow[], id: string) {
  const key = String(id || "").trim();
  if (!key) return null;
  return list.find((x) => x.id === key) || null;
}

/* =========================
   Component
========================= */

const DashboardBookings = () => {
  // ✅ role + settings (SOURCE OF TRUTH: AppSettingsService)
  const [uiRole, setUiRole] = useState<UiRole>(() => getUiRole());
  const [appSettings, setAppSettings] = useState<AppSettings>(() => AppSettingsService.getCached());

  // ✅ staff list
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);

  // ✅ data
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [selected, setSelected] = useState<Booking | null>(null);

  // ✅ loading + error
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>("");

  // ✅ filters
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

  // ✅ notes map
  const [notesMap, setNotesMap] = useState<Record<string, string>>({});

  // ✅ create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string>("");

  const [form, setForm] = useState({
    clientName: "",
    clientPhone: "",
    serviceKey: "", // can be serviceId OR name (temporary)
    staffId: "", // staff_public id
    employeeName: "", // fallback
    date: "",
    time: "",
    total: "",
    note: "",
  });

  // ✅ edit booking modal
  const [editMode, setEditMode] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");

  const [editForm, setEditForm] = useState({
    customerName: "",
    phone: "",
    serviceKey: "",
    staffId: "",
    employeeName: "",
    date: "",
    time: "",
    total: "",
  });

  /* =========================
     Permissions (IMPORTANT)
     ✅ staff NOT allowed here
  ========================= */

  const canView = uiRole === "owner" || uiRole === "admin" || uiRole === "reception";

  const allowReceptionChangeStatus =
    (appSettings as any)?.policies?.allowReceptionChangeStatus ??
    (appSettings as any)?.policies?.allowStaffChangeStatus ??
    true;

  const canEditStatus =
    uiRole === "owner" ||
    uiRole === "admin" ||
    (uiRole === "reception" && allowReceptionChangeStatus);

  const canExportCSV = uiRole === "owner" || uiRole === "admin";

  const canEditNotes =
    uiRole === "owner" ||
    uiRole === "admin" ||
    (uiRole === "reception" && allowReceptionChangeStatus);

  // ✅ staff view logic (kept for future use if you enable staff on this page)
  const isStaffView = uiRole === "staff";

  const me = useMemo(() => getAuthUserSafe(), [uiRole]);

  /* =========================
     Data loading
  ========================= */

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
      const mapped: Booking[] = (Array.isArray(data) ? data : []).map(mapBooking);

      const withNames = await enrichBookingsServiceNames(mapped);

      setBookings(withNames);
      setSelected((prev) => {
        if (!prev?.id) return prev;
        const fresh = withNames.find((x) => x.id === prev.id);
        return fresh ?? prev;
      });
    } catch (e: any) {
      console.error("Failed to load bookings from Firestore:", e);

      const code = String(e?.code || e?.name || "").toLowerCase();
      const msg = String(e?.message || "");
      const m = msg.toLowerCase();

      if (m.includes("missing or insufficient permissions") || code.includes("permission-denied")) {
        setLoadError(
          "⚠️ لا توجد صلاحيات كافية لعرض الحجوزات (permission-denied). تأكد من Rules وأن حسابك owner/admin/reception."
        );
      } else if (code.includes("unavailable") || m.includes("network")) {
        setLoadError("⚠️ تعذر الاتصال بـ Firestore (Network/Unavailable). جرّب تحديث الصفحة.");
      } else {
        setLoadError(`⚠️ تعذر تحميل الحجوزات.${msg ? ` تفاصيل: ${msg}` : ""}`);
      }

      setBookings([]);
    } finally {
      setLoading(false);
    }
  };

  /* =========================
     Staff list loader (realtime)
  ========================= */

  useEffect(() => {
    if (!canView) return;

    setStaffLoading(true);

    const q = fsQuery(collection(db, ...STAFF_PUBLIC_COLLECTION), orderBy("name", "asc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: StaffRow[] = snap.docs.map((d) => {
          const x = d.data() as any;
          return {
            id: d.id,
            name: String(x?.name || "").trim(),
            linkedUid: String(x?.linkedUid || x?.uid || "").trim() || undefined,
            active: x?.active !== false,
            showOnBooking: x?.showOnBooking !== false,
            onLeave: !!x?.onLeave,
          };
        });

        // خليها مرتبة عربي
        rows.sort((a, b) => (a.name || "").localeCompare(b.name || "", "ar"));

        setStaff(rows);
        setStaffLoading(false);
      },
      (err) => {
        console.error("staff_public watch error:", err);
        setStaff([]);
        setStaffLoading(false);
      }
    );

    return () => unsub();
  }, [canView]);

  /* =========================
     Effects: auth + realtime + AppSettings
  ========================= */

  useEffect(() => {
    setNotesMap(loadNotesMap());

    // ✅ subscribe AppSettings (source of truth)
    const unsubSettings = AppSettingsService.subscribe((s) => setAppSettings(s));

    const unsubAuth = onAuthStateChanged(auth, (u) => {
      setUiRole(getUiRole());

      // stop previous realtime watcher
      if (watchUnsubRef.current) {
        watchUnsubRef.current();
        watchUnsubRef.current = null;
      }

      const roleNow = getUiRole();
      const canViewNow = roleNow === "owner" || roleNow === "admin" || roleNow === "reception";

      if (!u) {
        setBookings([]);
        setLoadError("⚠️ سجّل دخول الإدارة أولاً لعرض الحجوزات.");
        setLoading(false);
        return;
      }

      if (!canViewNow) {
        setBookings([]);
        setLoadError("");
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadError("");

      watchUnsubRef.current = watchAllBookings(async (data) => {
        try {
          const mapped: Booking[] = (Array.isArray(data) ? data : []).map(mapBooking);
          const withNames = await enrichBookingsServiceNames(mapped);

          setBookings(withNames);
          setSelected((prev) => {
            if (!prev?.id) return prev;
            const fresh = withNames.find((x) => x.id === prev.id);
            return fresh ?? prev;
          });
        } finally {
          setLoading(false);
        }
      });
    });

    const onAuthChanged = () => setUiRole(getUiRole());
    window.addEventListener("authChanged", onAuthChanged);

    return () => {
      unsubAuth();

      if (watchUnsubRef.current) {
        watchUnsubRef.current();
        watchUnsubRef.current = null;
      }

      unsubSettings?.();
      window.removeEventListener("authChanged", onAuthChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ Close dropdowns on outside click + ESC
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;

      if (statusOpen) {
        const el = statusWrapRef.current;
        if (el && !el.contains(t)) setStatusOpen(false);
      }

      if (empOpen) {
        const el = empWrapRef.current;
        if (el && !el.contains(t)) setEmpOpen(false);
      }

      if (rowStatusOpenId) {
        const el = rowStatusWrapRefs.current[rowStatusOpenId];
        if (el && !el.contains(t)) setRowStatusOpenId(null);
      }

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

  /* =========================
     Derived data
  ========================= */

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

      if (isStaffView) {
        if (!smartEmployeeMatch(String(b.employeeName ?? ""), me)) return false;
      }

      if (q) {
        const name = String(b.customerName ?? "").toLowerCase();
        const phone = getBookingPhone(b).toLowerCase();
        const pid = String(b.publicId || "").toLowerCase();

        // ✅ search service summary too (helpful)
        const svc = serviceSummaryForTable(b).toLowerCase();

        if (!name.includes(q) && !phone.includes(q) && !pid.includes(q) && !svc.includes(q)) return false;
      }

      return true;
    });
  }, [bookings, dateFrom, dateTo, status, employee, query, isStaffView, me]);

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

  /* =========================
     Actions
  ========================= */

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

  const changeStatus = async (id: string | undefined | null, newStatus: BookingStatus) => {
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
        "MK",
        "العميلة",
        "الجوال",
        "الخدمة (مختصر)",
        "الخدمات (تفصيل)",
        "الموظفة",
        "employeeId",
        "التاريخ",
        "الوقت",
        "الحالة",
        "الإجمالي",
        "ملاحظة إدارية",
      ],
    ];

    filtered.forEach((b) => {
      const fullList = servicesFullListText(b).join(" | ");
      rows.push([
        b.id ?? "",
        b.publicId ?? "",
        b.customerName ?? "",
        getBookingPhone(b),
        serviceSummaryForTable(b),
        fullList,
        String(b.employeeName ?? ""),
        String(b.employeeId ?? ""),
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

  // ====== إنشاء حجز من الداشبورد ======
  function setField<K extends keyof typeof form>(key: K, value: string) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  function openCreate() {
    setCreateError("");
    setCreating(false);
    setCreateOpen(true);

    // reset quickly
    setForm((p) => ({
      ...p,
      staffId: "",
      employeeName: "",
    }));
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
      const serviceKey = form.serviceKey.trim();
      const date = form.date.trim();
      const time = form.time.trim();

      const staffId = String(form.staffId || "").trim();
      const picked = pickStaffById(staff, staffId);

      const employeeId = String(picked?.id || staffId || "").trim();
      const employeeUid = picked?.linkedUid || null;
      const employeeName = String(picked?.name || form.employeeName || "").trim();

      if (!employeeId) return setCreateError("اختر الموظفة من القائمة (لازم employeeId).");
      if (!clientName) return setCreateError("اكتب اسم العميلة.");
      if (!clientPhone) return setCreateError("اكتب رقم جوال العميلة.");
      if (!serviceKey) return setCreateError("اكتب الخدمة (اسم أو ID).");
      if (!employeeName) return setCreateError("اختر الموظفة أو اكتب اسمها.");
      if (!date) return setCreateError("اختر التاريخ.");
      if (!time) return setCreateError("اختر الوقت.");

      setCreating(true);

      const totalNumber = Number(form.total || 0);
      const total = Number.isFinite(totalNumber) ? totalNumber : 0;

      // ✅ مهم: نرسل employeeId لو متوفر (علشان Slot locks تكون صحيحة)
      await createDashboardBooking({
        createdBy: uid,
        clientName,
        clientPhone,

        // legacy (temporarily)
        serviceName: serviceKey,

        employeeName,
        employeeId: employeeId,
        employeeUid: employeeUid ?? null,

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
        serviceKey: "",
        staffId: "",
        employeeName: "",
        date: "",
        time: "",
        total: "",
        note: "",
      });

      await refresh();
    } catch (e) {
      console.error(e);
      setCreateError("صار خطأ أثناء إنشاء الحجز. تأكد من Firestore Rules ثم جرّب مرة ثانية.");
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

    // try match staffId from booking.employeeId
    const staffId = String(b.employeeId ?? "").trim();

    setEditForm({
      customerName: String(b.customerName ?? ""),
      phone: String(getBookingPhone(b) ?? ""),
      serviceKey: String(b.serviceId ?? b.serviceName ?? ""),
      staffId: staffId,
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
    const serviceKey = editForm.serviceKey.trim();
    const date = editForm.date.trim();
    const time = editForm.time.trim();

    const staffId = String(editForm.staffId || "").trim();
    const picked = pickStaffById(staff, staffId);

    const employeeId = String(picked?.id || staffId || "").trim();
    const employeeUid = picked?.linkedUid || null;
    const employeeName = String(picked?.name || editForm.employeeName || "").trim();

    if (!customerName) return setEditError("اكتب اسم العميلة.");
    if (!phone) return setEditError("اكتب رقم جوال العميلة.");
    if (!serviceKey) return setEditError("اكتب الخدمة (اسم أو ID).");
    if (!employeeName) return setEditError("اختر الموظفة أو اكتب اسمها.");
    if (!date) return setEditError("اختر التاريخ.");
    if (!time) return setEditError("اختر الوقت.");

    const totalNumber = Number(editForm.total || 0);
    const total = Number.isFinite(totalNumber) ? totalNumber : 0;

    try {
      setSavingEdit(true);

      await updateBookingFields(selected.id, {
        clientName: customerName,
        clientPhone: phone,

        // legacy for now
        serviceName: serviceKey,

        employeeName,
        employeeId: employeeId,
        employeeUid: employeeUid ?? null,

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
                serviceName: serviceKey,
                employeeName,
                employeeId,
                employeeUid,
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
              serviceName: serviceKey,
              employeeName,
              employeeId,
              employeeUid,
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

  /* =========================
     Guard UI
  ========================= */

  if (!canView) {
    return (
      <div className="dashboard-section">
        <h3>غير مصرح</h3>
        <p>هذه الصفحة مخصصة للإدارة وموظفات الاستقبال فقط.</p>
      </div>
    );
  }

  const statusText = status === "all" ? "الكل" : statusLabel[status as BookingStatus] ?? "اختر";

  /* =========================
     JSX
  ========================= */

  return (
    <div className="bookings-page">
      {/* Header */}
      <div className="bookings-header">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1>الحجوزات</h1>
            <p style={{ marginTop: 6 }}>
              إدارة واضحة وسريعة (Realtime) ✅
              <span style={{ opacity: 0.7 }}> • البحث يشمل الاسم/الجوال/رقم MK</span>
            </p>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button className="reports-btn" type="button" onClick={refresh} disabled={loading}>
              <FontAwesomeIcon icon={faRotate} /> تحديث
            </button>

            <button
              className="reports-btn"
              type="button"
              onClick={openCreate}
              disabled={!canEditStatus}
              title={!canEditStatus ? "لا تملك صلاحية الإنشاء" : "إنشاء حجز"}
            >
              <FontAwesomeIcon icon={faPlus} /> إنشاء حجز
            </button>

            {canExportCSV && (
              <button className="reports-btn" type="button" onClick={exportCSV} disabled={loading}>
                <FontAwesomeIcon icon={faFileCsv} /> CSV
              </button>
            )}
          </div>
        </div>

        {loadError && <div className="bookings-error">{loadError}</div>}
      </div>

      {/* Stats */}
      <div className="bookings-header" style={{ marginTop: 0 }}>
        <div className="clients-stats" style={{ margin: 0 }}>
          <div className="stat-card stat-3">
            <div className="stat-info">
              <h3 className="value">{stats.totalBookings}</h3>
              <p>عدد الحجوزات (بعد الفلترة)</p>
            </div>
          </div>

          <div className="stat-card stat-3">
            <div className="stat-info">
              <h3 className="value">{stats.totalRevenue.toLocaleString()}</h3>
              <p>إجمالي الإيراد</p>
            </div>
          </div>

          <div className="stat-card stat-6">
            <div className="stat-info">
              <h3 className="value1">
                مؤكد: {stats.dist.confirmed} — انتظار: {stats.dist.pending} — ملغي:{" "}
                {stats.dist.cancelled} — مكتمل: {stats.dist.completed}
              </h3>
              <p>توزيع الحالات</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters (no nested scroll, clean) */}
      <div className="bk-mini">
        <div className="bk-filters">
          <div className="bk-field w-180">
            <label>من تاريخ</label>
            <input className="form-control" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>

          <div className="bk-field w-180">
            <label>إلى تاريخ</label>
            <input className="form-control" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>

          {/* Status */}
          <div className="bk-field w-200" ref={statusWrapRef}>
            <label>
              <FontAwesomeIcon icon={faFilter} /> الحالة
            </label>

            <button type="button" className="bk-select" onClick={() => setStatusOpen((s) => !s)} aria-expanded={statusOpen}>
              {statusText}
            </button>

            {statusOpen && (
              <div className="dash-dd-menu" role="listbox">
                <button
                  type="button"
                  className={`dash-dd-item ${status === "all" ? "is-active" : ""}`}
                  onClick={() => {
                    setStatus("all");
                    setStatusOpen(false);
                  }}
                >
                  الكل
                </button>

                {(["confirmed", "pending", "cancelled", "completed"] as BookingStatus[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`dash-dd-item ${status === s ? "is-active" : ""}`}
                    onClick={() => {
                      setStatus(s);
                      setStatusOpen(false);
                    }}
                  >
                    {statusLabel[s]}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Employee */}
          <div className="bk-field w-200" ref={empWrapRef}>
            <label>الموظفة</label>
            <button type="button" className="bk-select" onClick={() => setEmpOpen((s) => !s)} aria-expanded={empOpen}>
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
                >
                  الكل
                </button>

                {employeesList.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={`dash-dd-item ${employee === name ? "is-active" : ""}`}
                    onClick={() => {
                      setEmployee(name);
                      setEmpOpen(false);
                    }}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Search */}
          <div className="bk-search">
            <label>
              <FontAwesomeIcon icon={faSearch} /> بحث (اسم / جوال / MK)
            </label>
            <div className="bk-search-row">
              <input
                className="form-control"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="مثال: نورة أو 05xxxxxxx أو MK-10021"
              />

              <button className="reports-btn" type="button" onClick={setToday}>
                اليوم
              </button>

              <button className="reports-btn" type="button" onClick={resetFilters}>
                تصفير
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Table (single-scroll page) */}
      <div className="bookings-table-card">
        <table className="bookings-table">
          <thead>
            <tr>
              <th>MK</th>
              <th>العميلة</th>
              <th>الجوال</th>
              <th>الخدمة</th>
              <th>الموظفة</th>
              <th>التاريخ</th>
              <th>الوقت</th>
              <th>الحالة</th>
              <th>الإجمالي</th>
              <th>إجراء</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} style={{ padding: 16, textAlign: "center" }}>
                  جاري التحميل...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ padding: 16, textAlign: "center" }}>
                  لا توجد نتائج
                </td>
              </tr>
            ) : (
              filtered.map((b) => (
                <tr key={b.id}>
                  <td style={{ fontWeight: 900 }}>{b.publicId || "—"}</td>
                  <td>{b.customerName || "—"}</td>
                  <td>{getBookingPhone(b) || "—"}</td>

                  {/* ✅ هنا المطلوب: عرض مبسط بالجدول */}
                  <td>{serviceSummaryForTable(b)}</td>

                  <td>{b.employeeName || "—"}</td>
                  <td>{b.date || "—"}</td>
                  <td>{b.time || "—"}</td>

                  <td>
                    {!canEditStatus ? (
                      <StatusDot status={b.status} />
                    ) : (
                      <div
                        className="dash-dd-wrap"
                        ref={(el) => {
                          rowStatusWrapRefs.current[b.id] = el;
                        }}
                      >
                        <button
                          type="button"
                          className="dash-select dash-select--sm"
                          onClick={() =>
                            setRowStatusOpenId((prev) => (prev === b.id ? null : b.id))
                          }
                          aria-expanded={rowStatusOpenId === b.id}
                        >
                          {statusLabel[b.status] ?? b.status}
                        </button>

                        {rowStatusOpenId === b.id && (
                          <div className="dash-dd-menu" role="listbox">
                            {(["confirmed", "pending", "cancelled", "completed"] as BookingStatus[]).map((s) => (
                              <button
                                key={s}
                                type="button"
                                className={`dash-dd-item ${b.status === s ? "is-active" : ""}`}
                                onClick={() => {
                                  setRowStatusOpenId(null);
                                  changeStatus(b.id, s);
                                }}
                                role="option"
                                aria-selected={b.status === s}
                              >
                                {statusLabel[s]}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </td>

                  <td>
                    {getBookingTotal(b) ? getBookingTotal(b).toLocaleString() : "—"}
                  </td>

                  <td>
                    <div className="bk-actions-cell">
                      <button className="reports-btn" type="button" onClick={() => openDetails(b)} title="تفاصيل">
                        <FontAwesomeIcon icon={faCircleInfo} /> تفاصيل
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create Booking Modal */}
      <Modal open={createOpen} title="إنشاء حجز (Dashboard)" onClose={closeCreate}>
        <div style={{ display: "grid", gap: 10 }}>
          {createError && <div className="bookings-error">{createError}</div>}

          <div style={{ display: "grid", gap: 8 }}>
            <label>اسم العميلة</label>
            <input
              className="form-control"
              value={form.clientName}
              onChange={(e) => setField("clientName", e.target.value)}
              placeholder="مثال: نورة"
              disabled={creating}
            />
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <label>جوال العميلة</label>
            <input
              className="form-control"
              value={form.clientPhone}
              onChange={(e) => setField("clientPhone", e.target.value)}
              placeholder="05xxxxxxxx"
              disabled={creating}
            />
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <label>الخدمة (اسم أو ID)</label>
            <input
              className="form-control"
              value={form.serviceKey}
              onChange={(e) => setField("serviceKey", e.target.value)}
              placeholder="مثال: قص الشعر أو serviceId"
              disabled={creating}
            />
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <label>الموظفة (الأفضل: اختر من القائمة)</label>

            <select
              className="form-select dash-select"
              value={form.staffId}
              disabled={creating || staffLoading}
              onChange={(e) => {
                const id = e.target.value;
                setField("staffId", id);

                const picked = pickStaffById(staff, id);
                if (picked?.name) setField("employeeName", picked.name);
              }}
            >
              <option value="">{staffLoading ? "جاري تحميل الموظفات..." : "اختر موظفة (يعبي employeeId تلقائيًا)"}</option>
              {staff
                .filter((s) => s.active !== false)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name || s.id}
                  </option>
                ))}
            </select>

            <input
              className="form-control"
              value={form.employeeName}
              onChange={(e) => setField("employeeName", e.target.value)}
              placeholder="Fallback: اكتب الاسم يدويًا"
              disabled={creating}
              style={{ marginTop: 8 }}
            />

            <div style={{ fontSize: 12, opacity: 0.7 }}>
              * اختيار الموظفة من القائمة يرسل employeeId (staff_public id) وهذا أهم شيء لقفل الـ slots صح ✅
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ display: "grid", gap: 8 }}>
              <label>التاريخ</label>
              <input className="form-control" type="date" value={form.date} onChange={(e) => setField("date", e.target.value)} disabled={creating} />
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <label>الوقت</label>
              <input
                className="form-control"
                value={form.time}
                onChange={(e) => setField("time", e.target.value)}
                placeholder="مثال: 18:00"
                disabled={creating}
              />
            </div>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <label>الإجمالي (اختياري)</label>
            <input className="form-control" value={form.total} onChange={(e) => setField("total", e.target.value)} placeholder="مثال: 200" disabled={creating} />
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <label>ملاحظة (اختياري)</label>
            <textarea
              className="form-control"
              value={form.note}
              onChange={(e) => setField("note", e.target.value)}
              placeholder="مثال: حجز VIP"
              disabled={creating}
              style={{ minHeight: 90, resize: "vertical" }}
            />
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button className="reports-btn" type="button" onClick={closeCreate} disabled={creating}>
              إلغاء
            </button>
            <button className="reports-btn" type="button" onClick={handleCreateBooking} disabled={creating}>
              {creating ? "جارٍ الإنشاء..." : "إنشاء"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Details / Edit Modal */}
      <Modal
        open={!!selected}
        title={selected ? `تفاصيل الحجز — ${selected.publicId || selected.customerName || "—"}` : "تفاصيل"}
        onClose={closeDetails}
      >
        {!selected ? null : (
          <div>
            {/* Top actions */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
              <button
                className="reports-btn"
                type="button"
                onClick={() => setEditMode((s) => !s)}
                disabled={!canEditStatus || savingEdit}
                title={!canEditStatus ? "لا تملك صلاحية التعديل" : "تعديل"}
              >
                {editMode ? "إلغاء التعديل" : "تعديل الحجز"}
              </button>

              {/* Modal status */}
              <div className="dash-dd-wrap" ref={modalStatusWrapRef}>
                <button
                  type="button"
                  className="dash-select dash-select--sm"
                  onClick={() => canEditStatus && setModalStatusOpen((s) => !s)}
                  aria-expanded={modalStatusOpen}
                  disabled={!canEditStatus}
                  title={!canEditStatus ? "لا تملك صلاحية تغيير الحالة" : "تغيير الحالة"}
                >
                  {statusLabel[selected.status] ?? selected.status}
                </button>

                {canEditStatus && modalStatusOpen && (
                  <div className="dash-dd-menu" role="listbox">
                    {(["confirmed", "pending", "cancelled", "completed"] as BookingStatus[]).map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`dash-dd-item ${selected.status === s ? "is-active" : ""}`}
                        onClick={() => {
                          setModalStatusOpen(false);
                          changeStatus(selected.id, s);
                        }}
                        role="option"
                        aria-selected={selected.status === s}
                      >
                        {statusLabel[s]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {editError && <div className="bookings-error">{editError}</div>}

            {/* Quick meta */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10, opacity: 0.85 }}>
              <span style={{ fontWeight: 900 }}>MK:</span> <span>{selected.publicId || "—"}</span>
              <span style={{ fontWeight: 900 }}>DocId:</span> <span>{selected.id}</span>
              <span style={{ fontWeight: 900 }}>employeeId:</span> <span>{String(selected.employeeId ?? "—")}</span>
            </div>

            {/* ✅ Services details (show FULL list when available) */}
            {!editMode && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 900, marginBottom: 8 }}>الخدمات</div>

                {servicesFullListText(selected).length ? (
                  <div style={{ display: "grid", gap: 6 }}>
                    {servicesFullListText(selected).map((name, idx) => (
                      <div
                        key={`${selected.id}-svc-${idx}`}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 12,
                          border: "1px solid rgba(255,255,255,0.10)",
                          background: "rgba(255,255,255,0.04)",
                        }}
                      >
                        {idx + 1}. {name}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ opacity: 0.7 }}>—</div>
                )}

                {selected.services?.length && selected.services.length > 1 ? (
                  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
                    * في الجدول يظهر مختصر فقط (مثال: {serviceSummaryForTable(selected)})
                  </div>
                ) : null}
              </div>
            )}

            {/* Details grid */}
            <div className="bk-details-grid">
              <div className="bk-item">
                <strong>العميلة</strong>
                {!editMode ? (
                  <span>{selected.customerName || "—"}</span>
                ) : (
                  <input className="form-control" value={editForm.customerName} onChange={(e) => setEditField("customerName", e.target.value)} disabled={savingEdit} />
                )}
              </div>

              <div className="bk-item">
                <strong>الجوال</strong>
                {!editMode ? (
                  <span>{getBookingPhone(selected) || "—"}</span>
                ) : (
                  <input className="form-control" value={editForm.phone} onChange={(e) => setEditField("phone", e.target.value)} disabled={savingEdit} />
                )}
              </div>

              <div className="bk-item">
                <strong>الخدمة (للتعديل اليدوي)</strong>
                {!editMode ? (
                  <span>{serviceSummaryForTable(selected)}</span>
                ) : (
                  <input className="form-control" value={editForm.serviceKey} onChange={(e) => setEditField("serviceKey", e.target.value)} disabled={savingEdit} />
                )}
              </div>

              <div className="bk-item">
                <strong>الموظفة</strong>
                {!editMode ? (
                  <span>{selected.employeeName || "—"}</span>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    <select
                      className="form-select dash-select"
                      value={editForm.staffId}
                      disabled={savingEdit || staffLoading}
                      onChange={(e) => {
                        const id = e.target.value;
                        setEditField("staffId", id);

                        const picked = pickStaffById(staff, id);
                        if (picked?.name) setEditField("employeeName", picked.name);
                      }}
                    >
                      <option value="">{staffLoading ? "جاري تحميل..." : "اختر موظفة (يعبي employeeId)"}</option>
                      {staff
                        .filter((s) => s.active !== false)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name || s.id}
                          </option>
                        ))}
                    </select>

                    <input
                      className="form-control"
                      value={editForm.employeeName}
                      onChange={(e) => setEditField("employeeName", e.target.value)}
                      disabled={savingEdit}
                      placeholder="Fallback: اكتب الاسم"
                    />
                  </div>
                )}
              </div>

              <div className="bk-item">
                <strong>التاريخ</strong>
                {!editMode ? (
                  <span>{selected.date || "—"}</span>
                ) : (
                  <input className="form-control" type="date" value={editForm.date} onChange={(e) => setEditField("date", e.target.value)} disabled={savingEdit} />
                )}
              </div>

              <div className="bk-item">
                <strong>الوقت</strong>
                {!editMode ? (
                  <span>{selected.time || "—"}</span>
                ) : (
                  <input className="form-control" value={editForm.time} onChange={(e) => setEditField("time", e.target.value)} disabled={savingEdit} />
                )}
              </div>

              <div className="bk-item">
                <strong>الإجمالي</strong>
                {!editMode ? (
                  <span>
                    {getBookingTotal(selected) ? `${getBookingTotal(selected).toLocaleString()} ريال` : "—"}
                  </span>
                ) : (
                  <input className="form-control" value={editForm.total} onChange={(e) => setEditField("total", e.target.value)} disabled={savingEdit} />
                )}
              </div>

              <div className="bk-item">
                <strong>الحالة</strong>
                <StatusDot status={selected.status} />
              </div>
            </div>

            {/* Notes */}
            <div className="bk-note-card">
              <div style={{ fontWeight: 900, marginBottom: 8 }}>ملاحظة إدارية (داخلية)</div>

              <textarea
                className="form-control"
                style={{ minHeight: 90, resize: "vertical" }}
                value={getAdminNote(selected.id)}
                onChange={(e) => saveAdminNote(selected.id, e.target.value)}
                disabled={!canEditNotes}
                placeholder={canEditNotes ? "اكتب ملاحظة داخلية..." : "لا تملك صلاحية تعديل الملاحظات"}
              />

              {editMode && (
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
                  <button className="reports-btn" type="button" onClick={saveBookingEdits} disabled={savingEdit}>
                    {savingEdit ? "جارٍ الحفظ..." : "حفظ التعديل"}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default DashboardBookings;
