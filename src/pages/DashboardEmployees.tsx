// src/pages/DashboardEmployees.tsx
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
  writeBatch,
} from "firebase/firestore";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPen,
  faTrash,
  faRotateRight,
  faUserTie,
  faXmark,
  faToggleOn,
  faToggleOff,
} from "@fortawesome/free-solid-svg-icons";

import { db } from "../services/firebase";
import { writeAuditLog } from "../services/logService";
import "../styles/DashboardEmployees.css";
import Modal from "../components/Modal";

// ✅ Bookings stats (Owner only)
import {
  listAllBookings,
  type BookingDocWithId,
  type BookingStatus,
} from "../services/firestoreBookings";

/* =========================
   Types
========================= */
type UiRole = "owner" | "admin" | "reception" | "staff" | "client" | "guest";

type AuthUser = {
  uid: string;
  email: string;
  role: UiRole;
  displayName?: string;
};

type StaffPublicDoc = {
  name: string;
  active: boolean;

  // ✅ جديد: هل تظهر في صفحة About؟
  showOnAbout: boolean;
  // ✅ جديد: هل تظهر في الحجز؟
  showOnBooking: boolean;
  onLeave?: boolean;
  leaveUntil?: string;
  leaveNote?: string;
  exceptionalLeaveDates?: string[];
  exceptionalLeaveWeekdays?: string[];
  useCustomWorkingHours?: boolean;
  customWorkingHours?: Partial<Record<WeekdayKey, StaffWorkingDay>>;
  customWorkingHourOverrides?: StaffWorkingHourOverride[];

  specialties: string[];
  bio?: string;
  avatarUrl?: string;
  cvUrl?: string;
  leaveBalanceDays?: number;
  leaveEntitlementDate?: string;
  leaveEntries?: LeaveEntry[];
  createdAt?: any;
  updatedAt?: any;
};

type LeaveEntry = {
  id: string;
  type: "add" | "deduct";
  days: number;
  date: string; // YYYY-MM-DD (operation effective date)
  note?: string;
  createdAtIso: string;
  byUid?: string;
  byName?: string;
};

type StaffWorkingDay = {
  enabled?: boolean;
  start?: string;
  end?: string;
};

type StaffWorkingHourOverride = {
  date: string;
  enabled?: boolean;
  start?: string;
  end?: string;
};

type StaffPublicUi = StaffPublicDoc & { id: string };

type ServiceOption = {
  id: string; // serviceId
  label: string; // service name
  sectionId?: string;
  categoryId?: string;
  active?: boolean;
};

/* =========================
   Const
========================= */
const SALON_ID = "main";
const STAFF_CHIPS_PREVIEW_COUNT = 8;
const STAFF_IMAGE_MODULES = import.meta.glob("../assets/images/*.{png,jpg,jpeg,webp,avif,svg}", {
  eager: true,
  import: "default",
}) as Record<string, string>;

const STAFF_IMAGE_OPTIONS = Object.entries(STAFF_IMAGE_MODULES)
  .map(([path, url]) => {
    const fileName = path.split("/").pop() || path;
    return { label: fileName, value: String(url || "") };
  })
  .filter((x) => x.value)
  .sort((a, b) => a.label.localeCompare(b.label));

const STAFF_IMAGE_BY_FILE = new Map(
  STAFF_IMAGE_OPTIONS.map((x) => [String(x.label || "").toLowerCase(), x.value] as const)
);

/* =========================
   Helpers
========================= */
function getAuthUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem("auth_user");
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

function staffPublicCol() {
  return collection(db, "salons", SALON_ID, "staff_public");
}

function staffPublicDoc(id: string) {
  return doc(db, "salons", SALON_ID, "staff_public", id);
}

function servicesCol() {
  return collection(db, "salons", SALON_ID, "services");
}

function normalizeSpecialties(v: any): string[] {
  if (Array.isArray(v)) return v.map(String).map((x) => x.trim()).filter(Boolean);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

function safeKey(s: string) {
  return String(s || "")
    .trim()
    .replaceAll("/", "-")
    .replace(/\s+/g, "_");
}

function normalizeArabicName(s: string) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي");
}

function pickAvatarUrl(data: any): string {
  const candidates = [
    data?.avatarUrl,
    data?.avatarURL,
    data?.photoURL,
    data?.photoUrl,
    data?.imageUrl,
    data?.imageURL,
    data?.image,
    data?.imgUrl,
    data?.profileImage,
    data?.profileImageUrl,
    data?.picture,
    data?.avatar,
  ];

  for (const c of candidates) {
    const s = String(c ?? "").trim();
    if (s) return s;
  }
  return "";
}

function resolveAvatarFromAssets(raw: string): string {
  const v = String(raw || "").trim();
  if (!v) return "";

  const normalized = v.replaceAll("\\", "/");
  const file = normalized
    .split("/")
    .pop()
    ?.split(/[?#]/)[0]
    ?.trim()
    .toLowerCase() || "";
  if (file && STAFF_IMAGE_BY_FILE.has(file)) {
    return String(STAFF_IMAGE_BY_FILE.get(file) || "");
  }

  return v;
}
type StaffBookingStats = {
  total: number;
  byStatus: Record<BookingStatus, number>;
  month: {
    key: string;
    salonTotal: number;
    staffTotal: number;
    sharePct: number;
  };
};

function monthKey(dateIso: string) {
  const s = String(dateIso || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(0, 7);
  return "";
}

function currentMonthKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtIsoDate(v?: string) {
  const s = String(v || "").trim();
  if (!s) return "-";
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("ar-SA", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function addDaysIso(dateIso: string, days: number) {
  const s = normalizeLeaveUntil(dateIso);
  if (!s) return "";
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + Math.trunc(days || 0));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parsePositiveInt(v: string, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

function normalizeLeaveUntil(v: any) {
  const s = String(v || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function normalizeExceptionalLeaveDates(v: any) {
  const arr = Array.isArray(v) ? v : [];
  return Array.from(
    new Set(
      arr
        .map((x: any) => normalizeLeaveUntil(x))
        .filter(Boolean)
        .sort((a: string, b: string) => a.localeCompare(b))
    )
  );
}

type WeekdayKey = "sat" | "sun" | "mon" | "tue" | "wed" | "thu" | "fri";
const WEEKDAY_OPTIONS: Array<{ key: WeekdayKey; label: string }> = [
  { key: "sat", label: "السبت" },
  { key: "sun", label: "الأحد" },
  { key: "mon", label: "الاثنين" },
  { key: "tue", label: "الثلاثاء" },
  { key: "wed", label: "الأربعاء" },
  { key: "thu", label: "الخميس" },
  { key: "fri", label: "الجمعة" },
];

function normalizeWeekdayKey(v: any): WeekdayKey | "" {
  const s = String(v || "").trim().toLowerCase();
  return (WEEKDAY_OPTIONS.some((d) => d.key === s) ? s : "") as WeekdayKey | "";
}

function normalizeExceptionalLeaveWeekdays(v: any): WeekdayKey[] {
  const arr = Array.isArray(v) ? v : [];
  return Array.from(
    new Set(
      arr
        .map((x: any) => normalizeWeekdayKey(x))
        .filter(Boolean)
    )
  ) as WeekdayKey[];
}

function normalizeTimeHHMM(v: any) {
  const s = String(v || "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "";
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return "";
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return "";
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function createDefaultWorkingHours(): Record<WeekdayKey, StaffWorkingDay> {
  return {
    sat: { enabled: true, start: "10:00", end: "22:00" },
    sun: { enabled: true, start: "10:00", end: "22:00" },
    mon: { enabled: true, start: "10:00", end: "22:00" },
    tue: { enabled: true, start: "10:00", end: "22:00" },
    wed: { enabled: true, start: "10:00", end: "22:00" },
    thu: { enabled: true, start: "10:00", end: "22:00" },
    fri: { enabled: true, start: "10:00", end: "22:00" },
  };
}

function normalizeWorkingHours(v: any): Record<WeekdayKey, StaffWorkingDay> {
  const defaults = createDefaultWorkingHours();
  const src = v && typeof v === "object" ? v : {};
  const out = { ...defaults };
  WEEKDAY_OPTIONS.forEach((d) => {
    const row = (src as any)?.[d.key];
    if (!row || typeof row !== "object") return;
    out[d.key] = {
      enabled: row.enabled !== false,
      start: normalizeTimeHHMM(row.start) || defaults[d.key].start,
      end: normalizeTimeHHMM(row.end) || defaults[d.key].end,
    };
  });
  return out;
}

function normalizeWorkingHourOverrides(v: any): StaffWorkingHourOverride[] {
  const rows = Array.isArray(v) ? v : [];
  return rows
    .map((row: any) => ({
      date: normalizeLeaveUntil(row?.date),
      enabled: row?.enabled !== false,
      start: normalizeTimeHHMM(row?.start) || "10:00",
      end: normalizeTimeHHMM(row?.end) || "22:00",
    }))
    .filter((row) => row.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/* =========================
   Component
========================= */
export default function DashboardEmployees() {
  const authUser = useMemo(() => getAuthUser(), []);
  const canManage =
    authUser?.role === "owner" ||
    authUser?.role === "admin" ||
    authUser?.role === "reception";

  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<StaffPublicUi[]>([]);
  const [errorMsg, setErrorMsg] = useState("");

  const [statsLoading, setStatsLoading] = useState(false);
  const [bookingStats, setBookingStats] =
    useState<Record<string, StaffBookingStats>>({});
  const [leaveAdjustDays, setLeaveAdjustDays] = useState("1");
  const [leaveAdjustDate, setLeaveAdjustDate] = useState<string>(todayIso());
  const [leaveAdjustNote, setLeaveAdjustNote] = useState("");
  const [leaveEntitlementDate, setLeaveEntitlementDate] = useState("");

  const [qText, setQText] = useState("");
  const [onlyActive, setOnlyActive] =
    useState<"all" | "active" | "inactive">("all");

  const [specialtyFilter, setSpecialtyFilter] = useState<string>("all");

  const [isOpen, setIsOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [cvUrl, setCvUrl] = useState("");

  const [active, setActive] = useState(true);

  // ✅ جديد
  const [showOnAbout, setShowOnAbout] = useState(true);
  const [showOnBooking, setShowOnBooking] = useState(true);
  const [modalOnLeave, setModalOnLeave] = useState(false);
  const [modalLeaveUntil, setModalLeaveUntil] = useState("");
  const [modalLeaveNote, setModalLeaveNote] = useState("");
  const [modalExceptionalLeaveWeekdays, setModalExceptionalLeaveWeekdays] = useState<WeekdayKey[]>([]);
  const [modalLeaveWeekdayDraft, setModalLeaveWeekdayDraft] = useState<WeekdayKey | "">("");
  const [modalUseCustomWorkingHours, setModalUseCustomWorkingHours] = useState(false);
  const [modalCustomWorkingHours, setModalCustomWorkingHours] =
    useState<Record<WeekdayKey, StaffWorkingDay>>(createDefaultWorkingHours());
  const [modalCustomHourOverrides, setModalCustomHourOverrides] = useState<StaffWorkingHourOverride[]>([]);
  const [modalHourOverrideFromDate, setModalHourOverrideFromDate] = useState("");
  const [modalHourOverrideToDate, setModalHourOverrideToDate] = useState("");
  const [modalHourOverrideStart, setModalHourOverrideStart] = useState("10:00");
  const [modalHourOverrideEnd, setModalHourOverrideEnd] = useState("22:00");
  const [modalHourOverrideEnabled, setModalHourOverrideEnabled] = useState(true);

  const [specialties, setSpecialties] = useState<string[]>([]);
  const [serviceOptions, setServiceOptions] = useState<ServiceOption[]>([]);
  const [expandedSpecialtiesByStaff, setExpandedSpecialtiesByStaff] = useState<Record<string, boolean>>({});
  const [leaveExceptionWeekdayByStaff, setLeaveExceptionWeekdayByStaff] = useState<
    Record<string, WeekdayKey | "">
  >({});

  const [srvQ, setSrvQ] = useState("");
  const [srvSection, setSrvSection] = useState<string>("all");

  const resetForm = () => {
    setEditId(null);
    setName("");
    setBio("");
    setAvatarUrl("");
    setCvUrl("");
    setActive(true);

    // ✅ جديد
    setShowOnAbout(true);
    setShowOnBooking(true);
    setModalOnLeave(false);
    setModalLeaveUntil("");
    setModalLeaveNote("");
    setModalExceptionalLeaveWeekdays([]);
    setModalLeaveWeekdayDraft("");
    setModalUseCustomWorkingHours(false);
    setModalCustomWorkingHours(createDefaultWorkingHours());
    setModalCustomHourOverrides([]);
    setModalHourOverrideFromDate("");
    setModalHourOverrideToDate("");
    setModalHourOverrideStart("10:00");
    setModalHourOverrideEnd("22:00");
    setModalHourOverrideEnabled(true);

    setSpecialties([]);
    setLeaveAdjustDays("1");
    setLeaveAdjustDate(todayIso());
    setLeaveAdjustNote("");
    setLeaveEntitlementDate("");
  };

  const openEdit = (x: StaffPublicUi) => {
    setEditId(x.id);
    setName(x.name ?? "");
    setBio(x.bio ?? "");
    setAvatarUrl(resolveAvatarFromAssets(pickAvatarUrl(x as any)));
    setCvUrl((x as any).cvUrl ?? "");
    setActive(!!x.active);
    setShowOnBooking((x as any).showOnBooking !== false);
    const initialLeaveUntil = normalizeLeaveUntil((x as any).leaveUntil);
    const initialLeaveExpired = !!initialLeaveUntil && initialLeaveUntil < todayIso();
    setModalOnLeave(!!(x as any).onLeave && !initialLeaveExpired);
    setModalLeaveUntil(initialLeaveUntil);
    setModalLeaveNote(String((x as any).leaveNote || ""));
    setModalExceptionalLeaveWeekdays(
      normalizeExceptionalLeaveWeekdays((x as any).exceptionalLeaveWeekdays)
    );
    setModalLeaveWeekdayDraft("");
    setModalUseCustomWorkingHours(!!(x as any).useCustomWorkingHours);
    setModalCustomWorkingHours(normalizeWorkingHours((x as any).customWorkingHours));
    setModalCustomHourOverrides(
      normalizeWorkingHourOverrides((x as any).customWorkingHourOverrides)
    );
    setModalHourOverrideFromDate("");
    setModalHourOverrideToDate("");
    setModalHourOverrideStart("10:00");
    setModalHourOverrideEnd("22:00");
    setModalHourOverrideEnabled(true);

    // ✅ جديد
    setShowOnAbout((x as any).showOnAbout !== false);

    setSpecialties(normalizeSpecialties(x.specialties));
    setLeaveAdjustDays("1");
    setLeaveAdjustDate(todayIso());
    setLeaveAdjustNote("");
    setLeaveEntitlementDate(String((x as any).leaveEntitlementDate || ""));
    setIsOpen(true);
  };

  const closeModal = () => {
    setIsOpen(false);
    resetForm();
  };

  const load = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const snap = await getDocs(staffPublicCol());
      const rows = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          name: data?.name ?? "",
          active: !!data?.active,

          // ✅ جديد (افتراضي: تظهر إذا ما كان الحقل موجود)
          showOnAbout: data?.showOnAbout !== false,
          showOnBooking: data?.showOnBooking !== false,
          onLeave: !!data?.onLeave,
          leaveUntil: normalizeLeaveUntil(data?.leaveUntil),
          leaveNote: String(data?.leaveNote || ""),
          exceptionalLeaveDates: normalizeExceptionalLeaveDates(data?.exceptionalLeaveDates),
          exceptionalLeaveWeekdays: normalizeExceptionalLeaveWeekdays(data?.exceptionalLeaveWeekdays),
          useCustomWorkingHours: !!data?.useCustomWorkingHours,
          customWorkingHours: normalizeWorkingHours(data?.customWorkingHours),
          customWorkingHourOverrides: normalizeWorkingHourOverrides(data?.customWorkingHourOverrides),

          specialties: normalizeSpecialties(data?.specialties),
          bio: data?.bio ?? "",
          avatarUrl: resolveAvatarFromAssets(pickAvatarUrl(data)),
          cvUrl: data?.cvUrl ?? "",
          leaveBalanceDays: Number(data?.leaveBalanceDays || 0),
          leaveEntitlementDate: String(data?.leaveEntitlementDate || ""),
          leaveEntries: Array.isArray(data?.leaveEntries) ? data.leaveEntries : [],
          createdAt: data?.createdAt,
          updatedAt: data?.updatedAt,
        } as StaffPublicUi;
      });
      rows.sort((a, b) => (a.name || "").localeCompare(b.name || "", "ar"));
      setList(rows);
      setLeaveExceptionWeekdayByStaff({});
    } catch {
      setErrorMsg("تعذر تحميل الموظفات");
      setList([]);
    } finally {
      setLoading(false);
    }
  };

  const loadServiceOptions = async () => {
    try {
      const qSrv = query(servicesCol(), orderBy("name", "asc"));
      const snap = await getDocs(qSrv);

      const opts: ServiceOption[] = snap.docs
        .map((d) => {
          const x = d.data() as any;
          return {
            id: d.id,
            label: String(x?.name || d.id),
            sectionId: String(x?.sectionId || ""),
            categoryId: String(x?.categoryId || ""),
            active: x?.active !== false,
          };
        })
        .filter((s) => s.label.trim())
        .filter((s) => s.active !== false);

      setServiceOptions(opts);
    } catch (e) {
      console.warn("loadServiceOptions error:", e);
      setServiceOptions([]);
    }
  };

  // ✅ Original logic for fixing bookings
  const fixBookingsEmployeeUid = async () => {
    if (!canManage) return;
    const ok = confirm(
      "سيتم إصلاح الحجوزات القديمة بإضافة employeeUid/employeeKey. هل تريد المتابعة؟"
    );
    if (!ok) return;
    setLoading(true);
    try {
      const staffSnap = await getDocs(staffPublicCol());
      const uidByEmployeeId = new Map<string, string>();
      staffSnap.docs.forEach((d) => {
        const data: any = d.data();
        const linkedUid = String(data?.linkedUid || "").trim();
        if (linkedUid) uidByEmployeeId.set(d.id, linkedUid);
      });
      const bookingsRef = collection(db, "salons", SALON_ID, "bookings");
      const bSnap = await getDocs(bookingsRef);
      let batch = writeBatch(db);
      let batchCount = 0;
      for (const d of bSnap.docs) {
        const b: any = d.data();
        const employeeUid = String(b?.employeeUid || "").trim();
        const employeeId = String(b?.employeeId || "").trim();
        if (employeeUid || !employeeId) continue;
        const linkedUid = uidByEmployeeId.get(employeeId) || "";
        if (!linkedUid) continue;
        batch.update(doc(db, "salons", SALON_ID, "bookings", d.id), {
          employeeUid: linkedUid,
          employeeKey: linkedUid,
          updatedAt: serverTimestamp(),
        });
        batchCount++;
        if (batchCount >= 450) {
          await batch.commit();
          batch = writeBatch(db);
          batchCount = 0;
        }
      }
      await batch.commit();
      alert("✅ تم إصلاح الحجوزات");
    } catch (e) {
      console.warn(e);
      setErrorMsg("خطأ في الإصلاح");
    } finally {
      setLoading(false);
    }
  };

  // ✅ Toggle Active (نشط/غير نشط)
  const toggleActiveQuick = async (x: StaffPublicUi) => {
    if (!canManage) return;
    setLoading(true);
    setErrorMsg("");
    try {
      const next = !x.active;
      await updateDoc(staffPublicDoc(x.id), {
        active: next,
        updatedAt: serverTimestamp(),
      } as any);
      setList((prev) => prev.map((r) => (r.id === x.id ? { ...r, active: next } : r)));
    } catch (e) {
      console.warn("toggleActiveQuick error:", e);
      setErrorMsg("تعذر تغيير حالة الموظفة");
    } finally {
      setLoading(false);
    }
  };

  // ✅ Toggle ShowOnAbout (يظهر في About أو لا)
  const toggleShowOnAboutQuick = async (x: StaffPublicUi) => {
    if (!canManage) return;
    setLoading(true);
    setErrorMsg("");
    try {
      const cur = (x as any).showOnAbout !== false;
      const next = !cur;
      await updateDoc(staffPublicDoc(x.id), {
        showOnAbout: next,
        updatedAt: serverTimestamp(),
      } as any);
      setList((prev) =>
        prev.map((r) => (r.id === x.id ? { ...r, showOnAbout: next } : r))
      );
    } catch (e) {
      console.warn("toggleShowOnAboutQuick error:", e);
      setErrorMsg("تعذر تغيير ظهور الموظفة في صفحة من نحن");
    } finally {
      setLoading(false);
    }
  };

  const updateStaffBookingDraft = (
    staffId: string,
    patch: Partial<
      Pick<
        StaffPublicUi,
        | "showOnBooking"
        | "onLeave"
        | "leaveUntil"
        | "leaveNote"
        | "exceptionalLeaveDates"
        | "exceptionalLeaveWeekdays"
      >
    >
  ) => {
    setList((prev) =>
      prev.map((row) =>
        row.id === staffId
          ? ({
              ...row,
              ...patch,
            } as StaffPublicUi)
          : row
      )
    );
  };

  const addExceptionalLeaveWeekday = (staffId: string) => {
    const nextWeekday = normalizeWeekdayKey(leaveExceptionWeekdayByStaff[staffId]);
    if (!nextWeekday) return;
    setList((prev) =>
      prev.map((row) => {
        if (row.id !== staffId) return row;
        const current = normalizeExceptionalLeaveWeekdays(
          (row as any).exceptionalLeaveWeekdays
        );
        return {
          ...row,
          exceptionalLeaveWeekdays: normalizeExceptionalLeaveWeekdays([
            ...current,
            nextWeekday,
          ]),
        } as StaffPublicUi;
      })
    );
    setLeaveExceptionWeekdayByStaff((prev) => ({ ...prev, [staffId]: "" }));
  };

  const removeExceptionalLeaveWeekday = (staffId: string, dayKey: WeekdayKey) => {
    setList((prev) =>
      prev.map((row) => {
        if (row.id !== staffId) return row;
        const current = normalizeExceptionalLeaveWeekdays(
          (row as any).exceptionalLeaveWeekdays
        );
        return {
          ...row,
          exceptionalLeaveWeekdays: current.filter((d) => d !== dayKey),
        } as StaffPublicUi;
      })
    );
  };

  const saveStaffBookingSettings = async (staff: StaffPublicUi) => {
    if (!canManage) return;

    const leaveUntil = normalizeLeaveUntil((staff as any).leaveUntil);
    const leaveExpired = !!leaveUntil && leaveUntil < todayIso();
    const effectiveOnLeave = !!(staff as any).onLeave && !leaveExpired;
    const leaveNote = String((staff as any).leaveNote || "").trim();
    const exceptionalLeaveDates = normalizeExceptionalLeaveDates(
      (staff as any).exceptionalLeaveDates
    );
    const exceptionalLeaveWeekdays = normalizeExceptionalLeaveWeekdays(
      (staff as any).exceptionalLeaveWeekdays
    );

    setLoading(true);
    setErrorMsg("");
    try {
      await updateDoc(staffPublicDoc(staff.id), {
        showOnBooking: (staff as any).showOnBooking !== false,
        onLeave: effectiveOnLeave,
        leaveUntil,
        leaveNote,
        exceptionalLeaveDates,
        exceptionalLeaveWeekdays,
        updatedAt: serverTimestamp(),
      } as any);

      setList((prev) =>
        prev.map((row) =>
          row.id === staff.id
            ? ({
                ...row,
                showOnBooking: (staff as any).showOnBooking !== false,
                onLeave: effectiveOnLeave,
                leaveUntil,
                leaveNote,
                exceptionalLeaveDates,
                exceptionalLeaveWeekdays,
              } as StaffPublicUi)
            : row
        )
      );
    } catch (e) {
      console.warn("saveStaffBookingSettings error:", e);
      setErrorMsg("تعذر حفظ إعدادات الحجز للموظفة");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    loadServiceOptions();
  }, []);

  useEffect(() => {
    let alive = true;
    const compute = async () => {
      if (!(authUser?.role === "owner" || authUser?.role === "admin") || !list.length) {
        setBookingStats({});
        return;
      }
      setStatsLoading(true);
      try {
        const thisMonth = currentMonthKey();
        const initStats = (): StaffBookingStats => ({
          total: 0,
          byStatus: { pending: 0, confirmed: 0, completed: 0, cancelled: 0 },
          month: { key: thisMonth, salonTotal: 0, staffTotal: 0, sharePct: 0 },
        });
        const staffById = new Set(list.map((s) => s.id));
        const staffByKey = new Map<string, string>();
        const staffByName = new Map<string, string>();
        let salonMonthTotal = 0;

        for (const s of list) {
          const sid = String(s.id || "").trim();
          if (sid) staffByKey.set(sid, sid);
          const nKey = normalizeArabicName(s.name);
          if (nKey) staffByName.set(nKey, sid);
          const nk2 = safeKey(String(s.name || "").trim());
          if (nk2) staffByKey.set(nk2, sid);
        }

        const rows: BookingDocWithId[] = await listAllBookings();
        const m: Record<string, StaffBookingStats> = {};

        for (const b of rows) {
          const bMonth = monthKey(String((b as any).date || ""));
          const st = (String((b as any).status || "pending").toLowerCase() ||
            "pending") as BookingStatus;
          if (bMonth === thisMonth && st !== "cancelled") salonMonthTotal += 1;

          const eid = String((b as any).employeeId || "").trim();
          const euid = String((b as any).employeeUid || "").trim();
          const ekey = String((b as any).employeeKey || "").trim();
          const ename = String((b as any).employeeName || "").trim();

          let staffId: string | null = null;
          if (ekey && staffByKey.has(ekey)) staffId = staffByKey.get(ekey) || null;
          if (!staffId && euid && staffByKey.has(euid))
            staffId = staffByKey.get(euid) || null;
          if (!staffId && eid && staffById.has(eid)) staffId = eid;
          if (!staffId && ename) {
            const k = normalizeArabicName(ename);
            staffId = staffByName.get(k) || null;
          }
          if (!staffId) continue;

          if (!m[staffId]) m[staffId] = initStats();
          m[staffId].total += 1;
          m[staffId].byStatus[st] = (m[staffId].byStatus[st] || 0) + 1;
          if (bMonth === thisMonth && st !== "cancelled") {
            m[staffId].month.staffTotal += 1;
          }
        }

        Object.keys(m).forEach((sid) => {
          m[sid].month.salonTotal = salonMonthTotal;
          m[sid].month.sharePct =
            salonMonthTotal > 0 ? Math.round((m[sid].month.staffTotal / salonMonthTotal) * 100) : 0;
        });

        list.forEach((s) => {
          if (!m[s.id]) {
            m[s.id] = initStats();
            m[s.id].month.salonTotal = salonMonthTotal;
          }
        });

        Object.keys(m).forEach((sid) => {
          if (!m[sid].month.sharePct && m[sid].month.salonTotal > 0 && m[sid].month.staffTotal > 0) {
            m[sid].month.sharePct = Math.round(
              (m[sid].month.staffTotal / m[sid].month.salonTotal) * 100
            );
          }
        });
        if (alive) setBookingStats(m);
      } catch (e) {
        console.warn("booking stats error:", e);
        if (alive) setBookingStats({});
      } finally {
        if (alive) setStatsLoading(false);
      }
    };
    compute();
    return () => {
      alive = false;
    };
  }, [authUser?.role, list]);

  const sectionOptions = useMemo(() => {
    const m = new Map<string, { id: string; label: string }>();
    for (const s of serviceOptions) {
      const sid = String(s.sectionId || "").trim();
      if (!sid) continue;
      if (!m.has(sid)) m.set(sid, { id: sid, label: sid });
    }
    return Array.from(m.values()).sort((a, b) =>
      a.label.localeCompare(b.label, "ar")
    );
  }, [serviceOptions]);

  const filteredServicesForPicks = useMemo(() => {
    let rows = [...serviceOptions];
    if (srvSection !== "all") {
      rows = rows.filter((s) => String(s.sectionId || "").trim() === srvSection);
    }
    const q = srvQ.trim().toLowerCase();
    if (q) {
      rows = rows.filter((s) => String(s.label || "").toLowerCase().includes(q));
    }
    rows.sort((a, b) => String(a.label).localeCompare(String(b.label), "ar"));
    return rows;
  }, [serviceOptions, srvSection, srvQ]);

  const toggleSpecialty = (serviceId: string) => {
    setSpecialties((prev) =>
      prev.includes(serviceId) ? prev.filter((x) => x !== serviceId) : [...prev, serviceId]
    );
  };

  const save = async () => {
    if (!canManage) return;
    const cleanName = name.trim();
    if (!cleanName) {
      setErrorMsg("اكتب اسم الموظفة");
      return;
    }
    if (specialties.length === 0) {
      setErrorMsg("اختَر خدمة واحدة على الأقل");
      return;
    }
    // ✅ منع "النسيان": موظفة نشطة لكن مخفية من الحجز
    if (active && !showOnBooking) {
      const ok = confirm(
        "⚠️ تنبيه: الموظفة (نشطة) لكن (مخفية من الحجز).\nهل تريد الحفظ بهذا الشكل؟"
      );
      if (!ok) return;
    }


    setLoading(true);
    setErrorMsg("");
    const normalizedModalLeaveUntil = normalizeLeaveUntil(modalLeaveUntil);
    const modalLeaveExpired = !!normalizedModalLeaveUntil && normalizedModalLeaveUntil < todayIso();
    const effectiveModalOnLeave = modalOnLeave && !modalLeaveExpired;
    const normalizedExceptionalWeekdays = normalizeExceptionalLeaveWeekdays(
      modalExceptionalLeaveWeekdays
    );
    const normalizedCustomWorkingHours = normalizeWorkingHours(modalCustomWorkingHours);
    const normalizedCustomHourOverrides = normalizeWorkingHourOverrides(modalCustomHourOverrides);
    const normalizedExceptionalDates = editId
      ? normalizeExceptionalLeaveDates((editingStaff as any)?.exceptionalLeaveDates)
      : [];

    const payload: StaffPublicDoc = {
      name: cleanName,
      active: !!active,
      showOnAbout: !!showOnAbout,
      showOnBooking: !!showOnBooking,
      onLeave: effectiveModalOnLeave,
      leaveUntil: normalizedModalLeaveUntil,
      leaveNote: String(modalLeaveNote || "").trim(),
      exceptionalLeaveDates: normalizedExceptionalDates,
      exceptionalLeaveWeekdays: normalizedExceptionalWeekdays,
      useCustomWorkingHours: !!modalUseCustomWorkingHours,
      customWorkingHours: normalizedCustomWorkingHours,
      customWorkingHourOverrides: normalizedCustomHourOverrides,

      specialties,
      bio: bio.trim(),
      avatarUrl: avatarUrl.trim(),
      cvUrl: cvUrl.trim(),
      updatedAt: serverTimestamp(),
    };

    try {
      if (!editId) {
        const id = cleanName
          .replace(/\s+/g, "_")
          .replace(/[^\w\u0600-\u06FF_]/g, "")
          .slice(0, 40);
        await setDoc(staffPublicDoc(id || crypto.randomUUID()), {
          ...payload,
          leaveBalanceDays: 0,
          leaveEntitlementDate: "",
          leaveEntries: [],
          createdAt: serverTimestamp(),
        });
      } else {
        await updateDoc(staffPublicDoc(editId), payload as any);
      }
      closeModal();
      await load();
    } catch (e) {
      console.warn("save staff_public error:", e);
      setErrorMsg("تعذر حفظ الموظفة");
    } finally {
      setLoading(false);
    }
  };

  const remove = async (id: string) => {
    if (!canManage) return;
    if (!confirm("متأكد حذف الموظفة؟")) return;
    setLoading(true);
    setErrorMsg("");
    try {
      await deleteDoc(staffPublicDoc(id));
      await load();
    } catch (e) {
      console.warn("delete staff_public error:", e);
      setErrorMsg("تعذر حذف الموظفة");
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    let rows = [...list];
    if (onlyActive === "active") rows = rows.filter((x) => x.active);
    if (onlyActive === "inactive") rows = rows.filter((x) => !x.active);
    if (specialtyFilter !== "all") {
      rows = rows.filter((x) => normalizeSpecialties(x.specialties).includes(specialtyFilter));
    }
    const t = qText.trim().toLowerCase();
    if (t) {
      rows = rows.filter((x) => {
        const n = (x.name || "").toLowerCase();
        const b = (x.bio || "").toLowerCase();
        return n.includes(t) || b.includes(t);
      });
    }
    return rows;
  }, [list, onlyActive, specialtyFilter, qText]);

  const editingStaff = useMemo(
    () => (editId ? list.find((x) => x.id === editId) || null : null),
    [editId, list]
  );
  const modalLeaveExpired = useMemo(() => {
    const leaveUntil = normalizeLeaveUntil(modalLeaveUntil);
    return !!leaveUntil && leaveUntil < todayIso();
  }, [modalLeaveUntil]);

  const updateModalWorkingDay = (
    day: WeekdayKey,
    patch: Partial<StaffWorkingDay>
  ) => {
    setModalCustomWorkingHours((prev) => ({
      ...prev,
      [day]: {
        ...(prev[day] || { enabled: true, start: "10:00", end: "22:00" }),
        ...patch,
      },
    }));
  };

  const addModalWorkingHourOverride = () => {
    const fromInput = normalizeLeaveUntil(modalHourOverrideFromDate);
    const toInput = normalizeLeaveUntil(modalHourOverrideToDate) || fromInput;
    if (!fromInput) return;
    const from = fromInput <= toInput ? fromInput : toInput;
    const to = fromInput <= toInput ? toInput : fromInput;
    const start = normalizeTimeHHMM(modalHourOverrideStart) || "10:00";
    const end = normalizeTimeHHMM(modalHourOverrideEnd) || "22:00";
    const maxDays = 120;
    const rows: StaffWorkingHourOverride[] = [];
    let cursor = from;
    let guard = 0;
    while (cursor && cursor <= to) {
      rows.push({ date: cursor, enabled: modalHourOverrideEnabled, start, end });
      cursor = addDaysIso(cursor, 1);
      guard += 1;
      if (guard > maxDays) {
        setErrorMsg("نطاق التاريخ كبير جداً. الحد الأقصى 120 يوم.");
        return;
      }
    }
    setModalCustomHourOverrides((prev) =>
      normalizeWorkingHourOverrides([
        ...prev.filter((x) => !rows.some((r) => r.date === x.date)),
        ...rows,
      ])
    );
    setModalHourOverrideFromDate("");
    setModalHourOverrideToDate("");
    setModalHourOverrideStart("10:00");
    setModalHourOverrideEnd("22:00");
    setModalHourOverrideEnabled(true);
  };

  const applyLeaveChange = async (mode: "add" | "deduct") => {
    if (authUser?.role !== "owner" || !editingStaff) return;
    const days = parsePositiveInt(leaveAdjustDays, 0);
    if (days <= 0) {
      setErrorMsg("اكتب عدد أيام صحيح.");
      return;
    }
    const opDate = String(leaveAdjustDate || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(opDate)) {
      setErrorMsg("اختر تاريخ العملية.");
      return;
    }

    const currentBalance = parsePositiveInt(String((editingStaff as any).leaveBalanceDays || 0), 0);
    const nextBalance = mode === "add" ? currentBalance + days : currentBalance - days;
    if (mode === "deduct" && nextBalance < 0) {
      setErrorMsg("لا يمكن خصم أكثر من الرصيد المتبقي.");
      return;
    }

    const currentEntries: LeaveEntry[] = Array.isArray((editingStaff as any).leaveEntries)
      ? ((editingStaff as any).leaveEntries as LeaveEntry[])
      : [];

    const entry: LeaveEntry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: mode,
      days,
      date: opDate,
      note: leaveAdjustNote.trim(),
      createdAtIso: new Date().toISOString(),
      byUid: String(authUser.uid || ""),
      byName: String(authUser.displayName || authUser.email || ""),
    };

    const nextEntries = [entry, ...currentEntries].slice(0, 200);

    setLoading(true);
    setErrorMsg("");
    try {
      await updateDoc(staffPublicDoc(editingStaff.id), {
        leaveBalanceDays: nextBalance,
        leaveEntries: nextEntries,
        updatedAt: serverTimestamp(),
      } as any);

      setList((prev) =>
        prev.map((r) =>
          r.id === editingStaff.id
            ? ({ ...r, leaveBalanceDays: nextBalance, leaveEntries: nextEntries } as StaffPublicUi)
            : r
        )
      );

      setLeaveAdjustDays("1");
      setLeaveAdjustNote("");

      void writeAuditLog({
        action: "employee_updated",
        entityType: "employee",
        entityId: editingStaff.id,
        source: "dashboard",
        description: mode === "add" ? "إضافة رصيد إجازة للموظفة" : "خصم رصيد إجازة من الموظفة",
        before: { leaveBalanceDays: currentBalance },
        after: { leaveBalanceDays: nextBalance },
        meta: { leaveAction: mode, days, opDate, staffName: editingStaff.name },
      });
    } catch (e) {
      console.warn("leave change error:", e);
      setErrorMsg("تعذر حفظ حركة الإجازة.");
    } finally {
      setLoading(false);
    }
  };

  const saveEntitlementDate = async () => {
    if (authUser?.role !== "owner" || !editingStaff) return;
    const d = String(leaveEntitlementDate || "").trim();
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      setErrorMsg("تاريخ الاستحقاق غير صحيح.");
      return;
    }
    setLoading(true);
    setErrorMsg("");
    try {
      await updateDoc(staffPublicDoc(editingStaff.id), {
        leaveEntitlementDate: d || "",
        updatedAt: serverTimestamp(),
      } as any);
      setList((prev) =>
        prev.map((r) => (r.id === editingStaff.id ? ({ ...r, leaveEntitlementDate: d } as StaffPublicUi) : r))
      );
    } catch (e) {
      console.warn("save entitlement date error:", e);
      setErrorMsg("تعذر حفظ تاريخ الاستحقاق.");
    } finally {
      setLoading(false);
    }
  };

  if (!authUser) {
    return (
      <div className="emp-page-wrapper">
        <div className="container">
          <div className="dash-card">
            <h3>غير مصرح</h3>
            <p>سجّل دخول ثم جرّب.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="emp-page-wrapper">
        <div className="container">
          <div className="dash-card">
            <h3>صلاحيات غير كافية</h3>
            <p>هذه الصفحة للإدارة فقط.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="emp-page-wrapper">
      <div className="container">
        <div className="dash-topbar dash-topbar--sticky">
          <div className="dash-topbar-title">
            <h2>
              <FontAwesomeIcon icon={faUserTie} /> إدارة الموظفات
            </h2>
            <p className="dash-sub">
              المصدر: <b>salons/main/staff_public</b>
            </p>
          </div>

          <div className="dash-topbar-actions">
            {authUser?.role === "owner" && (
              <button
                className="exp-btn ghost"
                onClick={fixBookingsEmployeeUid}
                title="إصلاح الحجوزات"
              >
                🔧 إصلاح
              </button>
            )}
            <button
              className="exp-btn"
              onClick={async () => {
                await loadServiceOptions();
                await load();
              }}
              disabled={loading}
              type="button"
            >
              <FontAwesomeIcon icon={faRotateRight} /> تحديث
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="alert alert-danger mt-3" style={{ borderRadius: 14 }}>
            {errorMsg}
          </div>
        )}

        <div className="dash-card mt-3">
          <div className="dash-row">
            <div className="dash-field">
              <label className="emp-label">بحث بالاسم أو النبذة</label>
              <input
                className="dash-input"
                placeholder="ابحث هنا..."
                value={qText}
                onChange={(e) => setQText(e.target.value)}
              />
            </div>

            <div className="dash-field">
              <label className="emp-label">تصفية بالخدمة</label>
              <select
                className="dash-select"
                value={specialtyFilter}
                onChange={(e) => setSpecialtyFilter(e.target.value)}
              >
                <option value="all">كل الخدمات</option>
                {serviceOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="dash-field">
              <label className="emp-label">الحالة</label>
              <select
                className="dash-select"
                value={onlyActive}
                onChange={(e) => setOnlyActive(e.target.value as any)}
              >
                <option value="all">الكل</option>
                <option value="active">نشطة فقط</option>
                <option value="inactive">غير نشطة</option>
              </select>
            </div>
          </div>
        </div>

        <div className="dash-grid">
          {filtered.map((x) => (
            <div
              key={x.id}
              className="staff-card staff-card-cover"
              role="button"
              tabIndex={0}
              onClick={() => openEdit(x)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openEdit(x);
                }
              }}
            >
              {(() => {
                const allSpecialties = normalizeSpecialties(x.specialties);
                const isExpanded = !!expandedSpecialtiesByStaff[x.id];
                const visibleSpecialties = isExpanded
                  ? allSpecialties
                  : allSpecialties.slice(0, STAFF_CHIPS_PREVIEW_COUNT);
                const hiddenCount = Math.max(0, allSpecialties.length - visibleSpecialties.length);
                const leaveUntil = normalizeLeaveUntil((x as any).leaveUntil);
                const leaveExpired = !!leaveUntil && leaveUntil < todayIso();
                const effectiveOnLeave = !!(x as any).onLeave && !leaveExpired;

                return (
                  <>
              <div className="staff-top">
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div className="staff-avatar-box">
                    {String(x.avatarUrl || "").trim() ? (
                      <img
                        src={resolveAvatarFromAssets(String(x.avatarUrl))}
                        alt={x.name || "موظفة"}
                        className="staff-avatar-img"
                      />
                    ) : (
                      <FontAwesomeIcon icon={faUserTie} />
                    )}
                  </div>
                  <div>
                    <h4 style={{ margin: 0, fontWeight: 900 }}>{x.name}</h4>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                      <span className={`staff-pill ${x.active ? "on" : "off"}`}>
                        {x.active ? "نشطة" : "غير نشطة"}
                      </span>

                      <span className={`staff-pill ${x.showOnAbout ? "on" : "off"}`}>
                        {x.showOnAbout ? "تظهر في من نحن" : "مخفية من من نحن"}
                      </span>

                      <span className={`staff-pill ${x.showOnBooking ? "on" : "off"}`}>
                        {x.showOnBooking ? "تظهر في الحجز" : "مخفية من الحجز"}
                      </span>

                      {/* ✅ تحذير إضافي إذا نشطة ومخفية */}
                      {(x.active && !x.showOnBooking) && (
                        <span className="staff-pill off" title="لن تظهر للعميلات في صفحة الحجز">
                          ⚠️ نشطة لكنها مخفية
                        </span>
                      )}

                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {/* ✅ تبديل سريع: نشط/غير نشط */}
                  <button
                    className="exp-btn ghost sm"
                    title={x.active ? "تعطيل الموظفة" : "تفعيل الموظفة"}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleActiveQuick(x);
                    }}
                    disabled={loading}
                    type="button"
                  >
                    <FontAwesomeIcon icon={x.active ? faToggleOn : faToggleOff} />
                  </button>

                  {/* ✅ تبديل سريع: يظهر في About أو لا */}
                  <button
                    className="exp-btn ghost sm"
                    title={x.showOnAbout ? "إخفاء من صفحة من نحن" : "إظهار في صفحة من نحن"}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleShowOnAboutQuick(x);
                    }}
                    disabled={loading}
                    type="button"
                  >
                    <FontAwesomeIcon icon={x.showOnAbout ? faToggleOn : faToggleOff} />
                  </button>

                  <button
                    className="exp-btn ghost sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(x);
                    }}
                    type="button"
                  >
                    <FontAwesomeIcon icon={faPen} />
                  </button>

                  <button
                    className="exp-btn ghost sm text-danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(x.id);
                    }}
                    type="button"
                  >
                    <FontAwesomeIcon icon={faTrash} />
                  </button>
                </div>
              </div>

              {x.bio ? <div className="staff-bio">{x.bio}</div> : <div className="staff-bio muted">بدون نبذة</div>}

              <div className="staff-chips">
                {visibleSpecialties.map((sid) => {
                  const label = serviceOptions.find((o) => o.id === sid)?.label ?? sid;
                  return (
                    <span className="staff-chip" key={sid}>
                      {label}
                    </span>
                  );
                })}
                {hiddenCount > 0 && !isExpanded && (
                  <button
                    type="button"
                    className="staff-chips-toggle"
                    onClick={() =>
                      setExpandedSpecialtiesByStaff((prev) => ({ ...prev, [x.id]: true }))
                    }
                  >
                    +{hiddenCount} أكثر
                  </button>
                )}
                {isExpanded && allSpecialties.length > STAFF_CHIPS_PREVIEW_COUNT && (
                  <button
                    type="button"
                    className="staff-chips-toggle"
                    onClick={() =>
                      setExpandedSpecialtiesByStaff((prev) => ({ ...prev, [x.id]: false }))
                    }
                  >
                    عرض أقل
                  </button>
                )}
              </div>

              {authUser?.role === "owner" && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span className="staff-pill stat total">
                      الحجوزات: <b>{statsLoading ? "..." : bookingStats[x.id]?.total ?? 0}</b>
                    </span>
                    <span className="staff-pill stat confirmed">
                      مؤكد: <b>{statsLoading ? "..." : bookingStats[x.id]?.byStatus.confirmed ?? 0}</b>
                    </span>
                    <span className="staff-pill stat pending">
                      انتظار: <b>{statsLoading ? "..." : bookingStats[x.id]?.byStatus.pending ?? 0}</b>
                    </span>
                  </div>
                </div>
              )}
                  </>
                );
              })()}
            </div>
          ))}
        </div>

        {isOpen && (
          <Modal
            open={isOpen}
            onClose={closeModal}
            ariaLabel={editId ? "تعديل موظفة" : "إضافة موظفة"}
            panelClassName="emp-modal"
            size="lg"
          >
            <div className="modal-head">
              <b style={{ fontSize: "1.2rem" }}>
                {editId
                  ? `تعديل موظفة${String(name || editingStaff?.name || "").trim() ? ` - ${String(name || editingStaff?.name || "").trim()}` : ""}`
                  : "إضافة موظفة"}
              </b>
              <button className="exp-btn ghost" onClick={closeModal} type="button">
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            <div className="modal-body emp-modal-grid">
              {editingStaff ? (
                <div className="emp-modal-section">
                  <b className="emp-modal-section-title">إحصائيات الشهر والإجازات</b>

                  <div className="staff-metrics">
                    <div className="staff-metrics-grid">
                      <div className="staff-metric">
                        <span>حجوزاتها هذا الشهر</span>
                        <b>{statsLoading ? "..." : bookingStats[editingStaff.id]?.month.staffTotal ?? 0}</b>
                      </div>
                      <div className="staff-metric">
                        <span>إجمالي حجوزات الشهر (الصالون)</span>
                        <b>{statsLoading ? "..." : bookingStats[editingStaff.id]?.month.salonTotal ?? 0}</b>
                      </div>
                      <div className="staff-metric accent">
                        <span>نسبة الشغل من إجمالي الشهر</span>
                        <b>{statsLoading ? "..." : `${bookingStats[editingStaff.id]?.month.sharePct ?? 0}%`}</b>
                      </div>
                      <div className="staff-metric">
                        <span>رصيد الإجازات المتبقي</span>
                        <b>{parsePositiveInt(String((editingStaff as any).leaveBalanceDays || 0), 0)} يوم</b>
                      </div>
                    </div>
                    <div className="staff-month-hint">الشهر الحالي: {currentMonthKey()}</div>
                  </div>

                  <div className="staff-leave-box">
                    <div className="staff-leave-head">
                      <span>تاريخ الاستحقاق القادم</span>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input
                          className="dash-input"
                          type="date"
                          value={leaveEntitlementDate}
                          onChange={(e) => setLeaveEntitlementDate(e.target.value)}
                        />
                        <button className="exp-btn" type="button" onClick={saveEntitlementDate} disabled={loading}>
                          حفظ الاستحقاق
                        </button>
                      </div>
                    </div>

                    {authUser?.role === "owner" ? (
                      <div className="staff-leave-controls">
                        <input
                          className="dash-input staff-leave-input"
                          type="number"
                          min={1}
                          step={1}
                          value={leaveAdjustDays}
                          onChange={(e) => setLeaveAdjustDays(e.target.value)}
                          placeholder="عدد الأيام"
                        />
                        <input
                          className="dash-input"
                          type="date"
                          value={leaveAdjustDate}
                          onChange={(e) => setLeaveAdjustDate(e.target.value)}
                        />
                        <input
                          className="dash-input"
                          value={leaveAdjustNote}
                          onChange={(e) => setLeaveAdjustNote(e.target.value)}
                          placeholder="ملاحظة (اختياري)"
                        />
                        <button
                          className="exp-btn primary"
                          type="button"
                          disabled={loading}
                          onClick={() => applyLeaveChange("add")}
                        >
                          إضافة رصيد
                        </button>
                        <button
                          className="exp-btn ghost"
                          type="button"
                          disabled={loading}
                          onClick={() => applyLeaveChange("deduct")}
                        >
                          تسجيل إجازة (خصم)
                        </button>
                      </div>
                    ) : null}

                    <div className="leave-log-list">
                      <div className="leave-log-title">سجل الإجازات</div>
                      {(Array.isArray((editingStaff as any).leaveEntries) ? (editingStaff as any).leaveEntries : [])
                        .slice()
                        .sort((a: LeaveEntry, b: LeaveEntry) => String(b.createdAtIso || "").localeCompare(String(a.createdAtIso || "")))
                        .slice(0, 12)
                        .map((entry: LeaveEntry) => (
                          <div className="leave-log-row" key={entry.id}>
                            <span className={`leave-log-type ${entry.type === "deduct" ? "deduct" : "add"}`}>
                              {entry.type === "deduct" ? "إجازة" : "إضافة"}
                            </span>
                            <span className="leave-log-days">{entry.days} يوم</span>
                            <span className="leave-log-date">{fmtIsoDate(entry.date)}</span>
                            <span className="leave-log-note">{String(entry.note || "-")}</span>
                          </div>
                        ))}
                      {!Array.isArray((editingStaff as any).leaveEntries) ||
                      (editingStaff as any).leaveEntries.length === 0 ? (
                        <div className="leave-log-empty">لا يوجد سجل إجازات حتى الآن.</div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="emp-modal-section">
                <b className="emp-modal-section-title">المعلومات الأساسية</b>

                <div className="emp-modal-fields two-cols">
  <div className="dash-field">
    <label className="emp-label">اسم الموظفة</label>
    <input
      className="dash-input"
      value={name}
      onChange={(e) => setName(e.target.value)}
      placeholder="مثال: حنان"
    />
  </div>

  <div className="dash-field">
    <label className="emp-label">الحالة</label>
    <select
      className="dash-select"
      value={active ? "1" : "0"}
      onChange={(e) => setActive(e.target.value === "1")}
    >
      <option value="1">نشطة</option>
      <option value="0">غير نشطة</option>
    </select>
  </div>

  {/* ✅ يظهر في صفحة "من نحن" */}
  <div className="dash-field">
    <label className="emp-label">يظهر في صفحة "من نحن"؟</label>
    <select
      className="dash-select"
      value={showOnAbout ? "1" : "0"}
      onChange={(e) => setShowOnAbout(e.target.value === "1")}
    >
      <option value="1">نعم (يظهر)</option>
      <option value="0">لا (مخفي)</option>
    </select>
  </div>

  {/* ✅ يظهر في صفحة "الحجز" */}
  <div className="dash-field">
    <label className="emp-label">تظهر في صفحة "الحجز"؟</label>
    <select
      className="dash-select"
      value={showOnBooking ? "1" : "0"}
      onChange={(e) => setShowOnBooking(e.target.value === "1")}
    >
      <option value="1">نعم (تظهر)</option>
      <option value="0">لا (مخفية)</option>
    </select>
  </div>

</div>
              </div>

              <div className="emp-modal-section">
                <b className="emp-modal-section-title">إعدادات الحجز لهذه الموظفة</b>
                <div className="emp-modal-fields emp-booking-settings">
                  <div className="dash-field">
                    <label className="emp-label emp-check-label">
                      <input
                        type="checkbox"
                        checked={modalOnLeave}
                        disabled={loading}
                        onChange={(e) => setModalOnLeave(e.target.checked)}
                      />
                      في إجازة
                    </label>
                  </div>

                  <div className="dash-field">
                    <label className="emp-label">تاريخ العودة (Date) — مثال: 21/02/2026</label>
                    <input
                      className="dash-input"
                      type="date"
                      value={modalLeaveUntil}
                      disabled={loading}
                      onChange={(e) => setModalLeaveUntil(e.target.value)}
                    />
                  </div>

                  <div className="dash-field">
                    <label className="emp-label">ملاحظة للزبائن (اختياري)</label>
                    <input
                      className="dash-input"
                      value={modalLeaveNote}
                      disabled={loading}
                      onChange={(e) => setModalLeaveNote(e.target.value)}
                      placeholder="مثال: العودة يوم الأحد بإذن الله"
                    />
                  </div>

                  <div className="dash-field">
                    <label className="emp-label">إجازة استثنائية (يوم محدد)</label>
                    <div className="emp-inline-actions">
                      <select
                        className="dash-select"
                        value={String(modalLeaveWeekdayDraft || "")}
                        disabled={loading}
                        onChange={(e) => setModalLeaveWeekdayDraft(e.target.value as WeekdayKey | "")}
                      >
                        <option value="">اختاري اليوم</option>
                        {WEEKDAY_OPTIONS.map((d) => (
                          <option key={`modal_${d.key}`} value={d.key}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="exp-btn ghost sm"
                        disabled={loading || !normalizeWeekdayKey(modalLeaveWeekdayDraft)}
                        onClick={() => {
                          const next = normalizeWeekdayKey(modalLeaveWeekdayDraft);
                          if (!next) return;
                          setModalExceptionalLeaveWeekdays((prev) =>
                            normalizeExceptionalLeaveWeekdays([...prev, next])
                          );
                          setModalLeaveWeekdayDraft("");
                        }}
                      >
                        إضافة اليوم
                      </button>
                    </div>

                    {modalExceptionalLeaveWeekdays.length > 0 ? (
                      <div className="emp-tags-row">
                        {modalExceptionalLeaveWeekdays.map((d) => (
                          <button
                            key={`modal_day_${d}`}
                            type="button"
                            className="exp-btn ghost sm"
                            disabled={loading}
                            onClick={() =>
                              setModalExceptionalLeaveWeekdays((prev) =>
                                prev.filter((day) => day !== d)
                              )
                            }
                            title="حذف اليوم الاستثنائي"
                          >
                            {WEEKDAY_OPTIONS.find((x) => x.key === d)?.label || d} ×
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="emp-field-note danger">
                        لا توجد أيام استثنائية حالياً.
                      </div>
                    )}
                  </div>

                  <div className="dash-field">
                    <label className="emp-label emp-check-label">
                      <input
                        type="checkbox"
                        checked={modalUseCustomWorkingHours}
                        disabled={loading}
                        onChange={(e) => setModalUseCustomWorkingHours(e.target.checked)}
                      />
                      ساعات عمل خاصة لهذه الموظفة
                    </label>
                  </div>

                  {modalUseCustomWorkingHours ? (
                    <div className="dash-field emp-working-hours-block">
                      <label className="emp-label">الساعات الأسبوعية</label>
                      <div className="emp-working-week-grid">
                        {WEEKDAY_OPTIONS.map((d) => {
                          const row = modalCustomWorkingHours[d.key] || {
                            enabled: true,
                            start: "10:00",
                            end: "22:00",
                          };
                          return (
                            <div key={`work_${d.key}`} className="emp-working-day-row">
                              <div className="emp-working-day-name">{d.label}</div>
                              <label className="emp-mini-check">
                                <input
                                  type="checkbox"
                                  checked={row.enabled !== false}
                                  disabled={loading}
                                  onChange={(e) =>
                                    updateModalWorkingDay(d.key, { enabled: e.target.checked })
                                  }
                                />
                                <span>دوام</span>
                              </label>
                              <input
                                className="dash-input"
                                type="time"
                                value={normalizeTimeHHMM(row.start) || "10:00"}
                                disabled={loading || row.enabled === false}
                                onChange={(e) =>
                                  updateModalWorkingDay(d.key, { start: e.target.value })
                                }
                              />
                              <input
                                className="dash-input"
                                type="time"
                                value={normalizeTimeHHMM(row.end) || "22:00"}
                                disabled={loading || row.enabled === false}
                                onChange={(e) =>
                                  updateModalWorkingDay(d.key, { end: e.target.value })
                                }
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {modalUseCustomWorkingHours ? (
                    <div className="dash-field emp-working-override-block">
                      <label className="emp-label">استثناء ساعات يوم محدد</label>
                      <div className="emp-working-override-grid">
                        <div className="emp-working-override-form">
                          <div>
                            <label className="emp-label">من تاريخ</label>
                            <input
                              className="dash-input"
                              type="date"
                              value={modalHourOverrideFromDate}
                              disabled={loading}
                              onChange={(e) => setModalHourOverrideFromDate(e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="emp-label">إلى تاريخ</label>
                            <input
                              className="dash-input"
                              type="date"
                              value={modalHourOverrideToDate}
                              disabled={loading}
                              onChange={(e) => setModalHourOverrideToDate(e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="emp-label">من الساعة</label>
                            <input
                              className="dash-input"
                              type="time"
                              value={modalHourOverrideStart}
                              disabled={loading || !modalHourOverrideEnabled}
                              onChange={(e) => setModalHourOverrideStart(e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="emp-label">إلى الساعة</label>
                            <input
                              className="dash-input"
                              type="time"
                              value={modalHourOverrideEnd}
                              disabled={loading || !modalHourOverrideEnabled}
                              onChange={(e) => setModalHourOverrideEnd(e.target.value)}
                            />
                          </div>
                          <label className="emp-mini-check">
                            <input
                              type="checkbox"
                              checked={modalHourOverrideEnabled}
                              disabled={loading}
                              onChange={(e) => setModalHourOverrideEnabled(e.target.checked)}
                            />
                            <span>دوام</span>
                          </label>
                          <button
                            type="button"
                            className="exp-btn ghost sm"
                            disabled={loading || !normalizeLeaveUntil(modalHourOverrideFromDate)}
                            onClick={addModalWorkingHourOverride}
                          >
                            إضافة النطاق
                          </button>
                        </div>
                        <div className="emp-field-note">
                          حددي من تاريخ إلى تاريخ لتطبيق نفس الساعات على كامل الفترة.
                        </div>

                        {modalCustomHourOverrides.length ? (
                          <div className="emp-override-list">
                            {modalCustomHourOverrides.map((ov) => (
                              <div key={`ov_${ov.date}`} className="emp-override-item">
                                <span className="emp-override-item-text">
                                  {fmtIsoDate(ov.date)} -{" "}
                                  {ov.enabled === false
                                    ? "إجازة هذا اليوم"
                                    : `${ov.start || "10:00"} إلى ${ov.end || "22:00"}`}
                                </span>
                                <button
                                  type="button"
                                  className="exp-btn ghost sm"
                                  disabled={loading}
                                  onClick={() =>
                                    setModalCustomHourOverrides((prev) =>
                                      prev.filter((x) => x.date !== ov.date)
                                    )
                                  }
                                >
                                  حذف
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="emp-field-note">
                            لا توجد استثناءات ساعات حالياً.
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {modalLeaveExpired ? (
                    <div style={{ color: "#b91c1c", fontSize: 13, fontWeight: 800 }}>
                      تاريخ الإجازة انتهى؛ بعد الحفظ سيتم اعتبار الموظفة غير مجازة.
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="emp-modal-section">
                <b className="emp-modal-section-title">ملف الموظفة</b>
                <div className="emp-modal-fields">
                  <div className="dash-field">
                    <label className="emp-label">صورة الموظفة (من ملفات المشروع)</label>
                    <select
                      className="dash-select"
                      value={resolveAvatarFromAssets(avatarUrl)}
                      onChange={(e) => setAvatarUrl(e.target.value)}
                    >
                      <option value="">بدون صورة</option>
                      {STAFF_IMAGE_OPTIONS.map((img) => (
                        <option key={img.value} value={img.value}>
                          {img.label}
                        </option>
                      ))}
                    </select>
                    {resolveAvatarFromAssets(avatarUrl) ? (
                      <div style={{ marginTop: 10 }}>
                        <img
                          src={resolveAvatarFromAssets(avatarUrl)}
                          alt="معاينة صورة الموظفة"
                          style={{
                            width: 56,
                            height: 56,
                            borderRadius: 12,
                            objectFit: "cover",
                            border: "1px solid rgba(13,13,13,0.12)",
                          }}
                        />
                      </div>
                    ) : null}
                  </div>

                  <div className="dash-field">
                    <label className="emp-label">نبذة تعريفية</label>
                    <textarea
                      className="dash-textarea"
                      rows={3}
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      placeholder="مثال: خبيرة شعر وصبغات بخبرة 8 سنوات..."
                    />
                  </div>

                  <div className="dash-field">
                    <label className="emp-label">رابط السيرة الذاتية PDF (اختياري)</label>
                    <input
                      className="dash-input"
                      value={cvUrl}
                      onChange={(e) => setCvUrl(e.target.value)}
                      placeholder="https://.../cv.pdf"
                      dir="ltr"
                    />
                  </div>
                </div>
              </div>

              <div className="emp-modal-section">
                <b className="emp-modal-section-title">الخدمات التي تقدمها الموظفة</b>
                <div className="emp-picks-toolbar">
                  <input
                    className="dash-input"
                    placeholder="بحث بالخدمات..."
                    value={srvQ}
                    onChange={(e) => setSrvQ(e.target.value)}
                  />
                  <select
                    className="dash-select"
                    value={srvSection}
                    onChange={(e) => setSrvSection(e.target.value)}
                  >
                    <option value="all">كل الأقسام</option>
                    {sectionOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="staff-picks staff-picks--scroll">
                  {filteredServicesForPicks.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className={`pick ${specialties.includes(o.id) ? "on" : ""}`}
                      onClick={() => toggleSpecialty(o.id)}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="modal-foot">
              <button className="exp-btn" onClick={closeModal} type="button">
                إلغاء
              </button>
              <button className="exp-btn primary" onClick={save} disabled={loading} type="button">
                {loading ? "جاري الحفظ..." : "حفظ التغييرات"}
              </button>
            </div>
          </Modal>
        )}
      </div>
    </div>
  );
}
