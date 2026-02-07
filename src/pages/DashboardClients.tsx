// src/pages/DashboardClients.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSearch,
  faFileCsv,
  faUsers,
  faXmark,
  faCircleInfo,
  faFileArrowUp,
} from "@fortawesome/free-solid-svg-icons";
import * as XLSX from "xlsx";

/**
 * ✅ قاعدة الاستيراد:
 * - ستايل المودالات الموحّد أولاً
 * - ثم ستايل الصفحة الخاص
 */
import "../styles/DashboardModals.css"; // ✅ مودالات موحّدة للداشبورد
import "../styles/DashboardClients.css";
import Modal from "../components/Modal";

// ✅ Firestore Bookings
import {
  listAllBookings,
  type BookingDocWithId,
  type BookingStatus,
} from "../services/firestoreBookings";

// ✅ Firestore (for Clients import)
import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "../services/firebase";

/** ✅ UiRole */
type UiRole = "owner" | "admin" | "reception" | "staff" | "client" | "guest";

/** ✅ Settings (LocalStorage) */
type AppSettings = {
  policies?: {
    allowStaffViewClients?: boolean; // ✅ NEW: تحكم فتح صفحة العميلات للـ staff
  };
};

const SETTINGS_KEY = "dashboard_settings_v1";

const defaultSettings: AppSettings = {
  // ✅ قرارك رقم 1: منع staff افتراضيًا
  policies: {
    allowStaffViewClients: false,
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

/** ✅ قراءة الدور من localStorage بشكل آمن */
function getUiRole(): UiRole {
  const raw = (localStorage.getItem("userRole") || "").toLowerCase().trim();

  if (raw === "owner") return "owner";
  if (raw === "admin") return "admin";
  if (raw === "reception") return "reception";
  if (raw === "staff") return "staff";
  if (raw === "client") return "client";

  return "guest";
}

type ClientRow = {
  key: string; // identifier
  name: string;
  phone: string;
  bookingsCount: number;
  lastVisitDate: string; // YYYY-MM-DD
  lastVisitTime: string;
  // ✅ from imported clients collection
  vip?: boolean;
  importedNote?: string;
  source?: "bookings" | "imported" | "both";
};

type ImportedClientDoc = {
  id: string; // phoneDigits (recommended)
  name?: string;
  phone?: string; // normalized phone string
  vip?: boolean;
  note?: string;
  createdAt?: any;
  updatedAt?: any;
};

const statusLabel: Record<BookingStatus, string> = {
  confirmed: "مؤكد",
  pending: "في الانتظار",
  cancelled: "ملغي",
  completed: "مكتمل",
};

function downloadXLSX(filename: string, rows: any[][], sheetName = "Sheet1") {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

/** ✅ تنظيف الجوال (للعرض) */
function cleanPhone(v: any) {
  return String(v ?? "").trim();
}

/** ✅ استخراج أرقام فقط (للمطابقة والتخزين) */
function phoneDigits(v: any) {
  const s = String(v ?? "").trim();
  const d = s.replace(/[^\d]/g, "");
  return d;
}

/** ✅ توحيد الجوال السعودي بشكل بسيط */
function normalizeSaudiPhone(raw: any) {
  const d = phoneDigits(raw);
  if (!d) return { phone: "", digits: "" };

  // حالات شائعة:
  // 05xxxxxxxx -> digits = 05...
  // 9665xxxxxxxx -> digits = 9665...
  // 5xxxxxxxx -> digits = 5...
  let digits = d;

  // لو يبدأ 00966
  if (digits.startsWith("00966")) digits = "966" + digits.slice(5);

  // لو يبدأ 9660 (خطأ شائع)
  if (digits.startsWith("9660")) digits = "966" + digits.slice(4);

  // لو يبدأ 0 وتاليه 5 -> نخليه كما هو للعرض، لكن key بنحوله
  // key الأفضل: 9665xxxxxxxx
  let keyDigits = digits;

  if (digits.length === 10 && digits.startsWith("05")) {
    keyDigits = "966" + digits.slice(1); // 9665xxxxxxxx
  } else if (digits.length === 9 && digits.startsWith("5")) {
    keyDigits = "966" + digits; // 9665xxxxxxxx
  } else if (digits.length === 12 && digits.startsWith("966")) {
    keyDigits = digits;
  }

  // للعرض نخليه 05xxxxxxxx إذا ممكن
  let display = digits;
  if (keyDigits.startsWith("9665") && keyDigits.length === 12) {
    display = "0" + keyDigits.slice(3); // 05xxxxxxxx
  }

  return { phone: display, digits: keyDigits };
}

function makeClientKey(name: string, phone: string) {
  // ✅ نحاول نخلي المفتاح دايم بالجوال لو موجود
  const norm = normalizeSaudiPhone(phone);
  const pd = norm.digits;
  return pd ? `p:${pd}` : `n:${name.trim().toLowerCase()}`;
}

const NOTES_KEY = "dashboard_client_notes_v1";

const SALON_ID = "main";
const CLIENTS_COLLECTION = ["salons", SALON_ID, "clients"] as const;

function pickHeader(obj: any, keys: string[]) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  }
  return undefined;
}

function normalizeHeaderKey(k: string) {
  return String(k || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** ✅ يحاول يلقط العمود من عدة أسماء (عربي/إنجليزي) */
function getField(row: any, candidates: string[]) {
  // row keys may be Arabic/English with random spacing
  const map: Record<string, any> = {};
  Object.keys(row || {}).forEach((kk) => {
    map[normalizeHeaderKey(kk)] = row[kk];
  });

  for (const c of candidates) {
    const v = map[normalizeHeaderKey(c)];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return "";
}

const DashboardClients: React.FC = () => {
  // ✅ Role + Settings (NEW)
  const [uiRole, setUiRole] = useState<UiRole>(() => getUiRole());
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  const [bookings, setBookings] = useState<BookingDocWithId[]>([]);
  const [queryText, setQueryText] = useState("");
  const [selectedClient, setSelectedClient] = useState<ClientRow | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ✅ Level Up States
  const [sortBy, setSortBy] = useState<"latest" | "most">("latest");
  const [notesMap, setNotesMap] = useState<Record<string, string>>({});
  const [noteText, setNoteText] = useState("");

  // ✅ Imported clients (Firestore)
  const [importedMap, setImportedMap] = useState<Record<string, ImportedClientDoc>>({});
  const [importLoading, setImportLoading] = useState(false);

  // ✅ Custom Sort Dropdown (Unified with DashboardSkin)
  const [sortOpen, setSortOpen] = useState(false);
  const sortWrapRef = useRef<HTMLDivElement | null>(null);

  // ✅ Import Excel UI
  const [importOpen, setImportOpen] = useState(false);
  const [importErr, setImportErr] = useState("");
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  type ImportPreviewRow = {
    name: string;
    phone: string; // display
    digits: string; // key digits 9665...
    vip: boolean;
    note: string;
  };

  const [preview, setPreview] = useState<ImportPreviewRow[]>([]);

  const sortOptions = useMemo(
    () => [
      { value: "latest" as const, label: "الأحدث زيارة" },
      { value: "most" as const, label: "الأكثر حجوزات" },
    ],
    []
  );

  const sortLabel =
    sortOptions.find((o) => o.value === sortBy)?.label || "اختر";

  const selectSort = (v: "latest" | "most") => {
    setSortBy(v);
    setSortOpen(false);
  };

  // ✅ صلاحيات العرض لصفحة العميلات (NEW)
  const allowStaffViewClients =
    settings?.policies?.allowStaffViewClients === true;

  const canViewClients =
    uiRole === "owner" ||
    uiRole === "admin" ||
    uiRole === "reception" ||
    (uiRole === "staff" && allowStaffViewClients);

  // ✅ تصدير + استيراد: نخليها owner/admin
  const canExport = uiRole === "owner" || uiRole === "admin";
  const canImport = uiRole === "owner" || uiRole === "admin";

  // ✅ إغلاق قائمة الفرز عند الضغط خارجها أو ESC
  useEffect(() => {
    if (!sortOpen) return;

    const onDown = (e: MouseEvent) => {
      const el = sortWrapRef.current;
      if (!el) return;
      if (el.contains(e.target as Node)) return;
      setSortOpen(false);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSortOpen(false);
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [sortOpen]);

  // ✅ مراقبة تغييرات الدور + الإعدادات (NEW)
  useEffect(() => {
    const onAuthChanged = () => setUiRole(getUiRole());
    window.addEventListener("authChanged", onAuthChanged);

    const onSettingsChanged = () => setSettings(loadSettings());
    window.addEventListener("settingsChanged", onSettingsChanged);

    return () => {
      window.removeEventListener("authChanged", onAuthChanged);
      window.removeEventListener("settingsChanged", onSettingsChanged);
    };
  }, []);

  // ✅ جلب الحجوزات من Firestore
  useEffect(() => {
    if (!canViewClients) {
      // ما نحمّل بيانات أصلاً إذا غير مصرح
      setLoading(false);
      setBookings([]);
      return;
    }

    let mounted = true;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const data = await listAllBookings();
        if (!mounted) return;

        setBookings(Array.isArray(data) ? data : []);
      } catch (e: any) {
        console.error("DashboardClients: listAllBookings failed", e);
        if (!mounted) return;
        setError(e?.message || "فشل تحميل الحجوزات من قاعدة البيانات");
        setBookings([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [canViewClients]);

  // ✅ جلب العملاء المستوردين (Firestore) - آمن وما يأثر على الحجوزات
  useEffect(() => {
    if (!canViewClients) return;

    let mounted = true;

    (async () => {
      try {
        setImportLoading(true);
        const q = query(collection(db, ...CLIENTS_COLLECTION), orderBy("updatedAt", "desc"));
        const snap = await getDocs(q);

        if (!mounted) return;

        const next: Record<string, ImportedClientDoc> = {};
        snap.docs.forEach((d) => {
          const x = d.data() as any;
          next[d.id] = {
            id: d.id,
            name: String(x?.name || "").trim() || undefined,
            phone: String(x?.phone || "").trim() || undefined,
            vip: !!x?.vip,
            note: String(x?.note || "").trim() || undefined,
            createdAt: x?.createdAt,
            updatedAt: x?.updatedAt,
          };
        });

        setImportedMap(next);
      } catch (e) {
        console.error("DashboardClients: load imported clients failed", e);
        setImportedMap({});
      } finally {
        if (mounted) setImportLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [canViewClients]);

  // ✅ تحميل الملاحظات من localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(NOTES_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") setNotesMap(parsed);
    } catch {
      // ignore
    }
  }, []);

  const clients = useMemo<ClientRow[]>(() => {
    // 1) جمع العملاء من الحجوزات
    const map = new Map<
      string,
      { name: string; phone: string; list: BookingDocWithId[] }
    >();

    bookings.forEach((b) => {
      const name = String((b as any).clientName ?? "").trim() || "—";
      const phoneRaw = cleanPhone((b as any).clientPhone);
      const norm = normalizeSaudiPhone(phoneRaw);
      const phone = norm.phone || phoneRaw;
      const key = makeClientKey(name, phone);

      if (!map.has(key)) map.set(key, { name, phone, list: [] });
      map.get(key)!.list.push(b);
    });

    // 2) تحويل إلى rows من الحجوزات
    const rowsFromBookings: ClientRow[] = [];
    map.forEach((v, key) => {
      const sorted = [...v.list].sort((a, b) => {
        const da = ((a as any).date ?? "").toString();
        const dbb = ((b as any).date ?? "").toString();
        if (da !== dbb) return dbb.localeCompare(da); // desc
        return ((b as any).time ?? "")
          .toString()
          .localeCompare(((a as any).time ?? "").toString()); // desc
      });

      const last = sorted[0];

      // match imported by phone digits if possible
      const pd = key.startsWith("p:") ? key.slice(2) : "";
      const imported = pd ? importedMap[pd] : undefined;

      rowsFromBookings.push({
        key,
        name: v.name,
        phone: v.phone || "—",
        bookingsCount: v.list.length,
        lastVisitDate: ((last as any)?.date ?? "").toString(),
        lastVisitTime: ((last as any)?.time ?? "").toString(),
        vip: imported?.vip ?? (v.list.length >= 5),
        importedNote: imported?.note,
        source: imported ? "both" : "bookings",
      });
    });

    // 3) إضافة العملاء المستوردين اللي ما عندهم حجوزات
    const rows: ClientRow[] = [...rowsFromBookings];

    Object.keys(importedMap).forEach((idDigits) => {
      const imp = importedMap[idDigits];
      if (!imp) return;

      const key = `p:${idDigits}`;
      const already = rowsFromBookings.find((r) => r.key === key);
      if (already) return;

      const name = String(imp.name || "—").trim() || "—";
      const phone = String(imp.phone || "").trim() || (idDigits ? "0" + idDigits.slice(3) : "—");

      rows.push({
        key,
        name,
        phone: phone || "—",
        bookingsCount: 0,
        lastVisitDate: "",
        lastVisitTime: "",
        vip: !!imp.vip,
        importedNote: String(imp.note || "").trim() || undefined,
        source: "imported",
      });
    });

    // ✅ فرز حسب الاختيار
    rows.sort((a, b) => {
      if (sortBy === "most") {
        if (b.bookingsCount !== a.bookingsCount)
          return b.bookingsCount - a.bookingsCount;
      }

      // الأحدث أولاً (اللي عنده آخر زيارة)
      if (b.lastVisitDate !== a.lastVisitDate)
        return (b.lastVisitDate || "").localeCompare(a.lastVisitDate || "");
      return (b.lastVisitTime || "").localeCompare(a.lastVisitTime || "");
    });

    return rows;
  }, [bookings, sortBy, importedMap]);

  const filteredClients = useMemo(() => {
    const q = queryText.trim().toLowerCase();
    if (!q) return clients;

    return clients.filter((c) => {
      const name = (c.name ?? "").toLowerCase();
      const phone = (c.phone ?? "").toLowerCase();
      const src = (c.source ?? "").toLowerCase();
      return name.includes(q) || phone.includes(q) || src.includes(q);
    });
  }, [clients, queryText]);

  const selectedBookings = useMemo(() => {
    if (!selectedClient) return [];

    const list = bookings.filter((b) => {
      const name = String((b as any).clientName ?? "").trim() || "—";
      const phoneRaw = cleanPhone((b as any).clientPhone);
      const norm = normalizeSaudiPhone(phoneRaw);
      const phone = norm.phone || phoneRaw;
      const key = makeClientKey(name, phone);
      return key === selectedClient.key;
    });

    return list.sort((a, b) => {
      const da = ((a as any).date ?? "").toString();
      const dbb = ((b as any).date ?? "").toString();
      if (da !== dbb) return dbb.localeCompare(da);
      return ((b as any).time ?? "")
        .toString()
        .localeCompare(((a as any).time ?? "").toString());
    });
  }, [selectedClient, bookings]);

  const stats = useMemo(() => {
    const totalClients = filteredClients.length;
    const totalBookings = bookings.length;

    const topClient =
      clients.length > 0
        ? clients.reduce(
            (best, cur) =>
              cur.bookingsCount > best.bookingsCount ? cur : best,
            clients[0]
          )
        : null;

    return { totalClients, totalBookings, topClient };
  }, [filteredClients.length, bookings.length, clients]);

  /* =========================
     Export actions (XLSX)
  ========================= */
  const exportClientsXLSX = () => {
    const rows: any[][] = [
      ["العميلة", "الجوال", "VIP", "عدد الحجوزات", "آخر زيارة (تاريخ)", "آخر زيارة (وقت)", "المصدر"],
    ];

    filteredClients.forEach((c) => {
      rows.push([
        c.name,
        c.phone,
        c.vip ? "YES" : "NO",
        c.bookingsCount,
        c.lastVisitDate,
        c.lastVisitTime,
        c.source || "",
      ]);
    });

    const stamp = new Date();
    const yyyy = stamp.getFullYear();
    const mm = String(stamp.getMonth() + 1).padStart(2, "0");
    const dd = String(stamp.getDate()).padStart(2, "0");

    downloadXLSX(`dashboard_clients_${yyyy}-${mm}-${dd}.xlsx`, rows, "Clients");
  };

  /* =========================
     Import Excel actions (SAFE MERGE)
  ========================= */

  function openImport() {
    setImportErr("");
    setPreview([]);
    setImportOpen(true);
    setImporting(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function closeImport() {
    if (importing) return;
    setImportOpen(false);
    setImportErr("");
    setPreview([]);
  }

  function parseVip(v: any) {
    const s = String(v ?? "").trim().toLowerCase();
    if (!s) return false;
    return s === "1" || s === "true" || s === "yes" || s === "vip" || s === "نعم" || s === "صح";
  }

  function onPickFile(file: File) {
    setImportErr("");
    setPreview([]);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = evt.target?.result;
        const wb = XLSX.read(data, { type: "array" });

        const firstSheet = wb.SheetNames[0];
        if (!firstSheet) {
          setImportErr("الملف ما فيه Sheets.");
          return;
        }

        const ws = wb.Sheets[firstSheet];
        const json: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

        if (!json.length) {
          setImportErr("الملف فاضي.");
          return;
        }

        const tmp: ImportPreviewRow[] = [];
        const seen = new Set<string>();

        json.forEach((row: any) => {
          const name = String(
            getField(row, ["name", "الاسم", "اسم", "العميلة", "client", "clientName"])
          ).trim();

          const phoneRaw = String(
            getField(row, ["phone", "الجوال", "رقم", "mobile", "clientPhone"])
          ).trim();

          const note = String(
            getField(row, ["note", "ملاحظة", "ملاحظات", "notes", "remark"])
          ).trim();

          const vipRaw = getField(row, ["vip", "VIP", "مميزة", "عميلة مميزة"]);

          const norm = normalizeSaudiPhone(phoneRaw);
          if (!norm.digits) return; // تجاهل اللي ما عنده رقم

          const digits = norm.digits;
          if (seen.has(digits)) return;
          seen.add(digits);

          tmp.push({
            name: name || "—",
            phone: norm.phone || phoneRaw || "—",
            digits,
            vip: parseVip(vipRaw),
            note: note || "",
          });
        });

        if (!tmp.length) {
          setImportErr("ما لقينا صفوف صالحة (لازم اسم + جوال).");
          return;
        }

        setPreview(tmp);
      } catch (e) {
        console.error(e);
        setImportErr("فشل قراءة الملف. تأكد إنه Excel صحيح (.xlsx).");
      }
    };

    reader.readAsArrayBuffer(file);
  }

  async function commitImport() {
    try {
      setImportErr("");

      if (!preview.length) {
        setImportErr("ما فيه بيانات للحفظ.");
        return;
      }

      setImporting(true);

      // ✅ Batch merge (no overwrite destructive)
      const batch = writeBatch(db);

      preview.forEach((r) => {
        const ref = doc(db, ...CLIENTS_COLLECTION, r.digits);
        batch.set(
          ref,
          {
            name: r.name || "",
            phone: r.phone || "",
            vip: !!r.vip,
            note: r.note || "",
            updatedAt: serverTimestamp(),
            // createdAt only if not exists? (batch can't check) so we keep both:
            createdAt: serverTimestamp(),
          },
          { merge: true }
        );
      });

      await batch.commit();

      // ✅ reload imported list
      const q = query(collection(db, ...CLIENTS_COLLECTION), orderBy("updatedAt", "desc"));
      const snap = await getDocs(q);
      const next: Record<string, ImportedClientDoc> = {};
      snap.docs.forEach((d) => {
        const x = d.data() as any;
        next[d.id] = {
          id: d.id,
          name: String(x?.name || "").trim() || undefined,
          phone: String(x?.phone || "").trim() || undefined,
          vip: !!x?.vip,
          note: String(x?.note || "").trim() || undefined,
          createdAt: x?.createdAt,
          updatedAt: x?.updatedAt,
        };
      });
      setImportedMap(next);

      setImportOpen(false);
      setPreview([]);
    } catch (e) {
      console.error(e);
      setImportErr("صار خطأ أثناء الحفظ. تأكد من Rules وصلاحيات Firestore ثم جرّب.");
    } finally {
      setImporting(false);
    }
  }

  // ✅ Gate: غير مصرح (NEW)
  if (!canViewClients) {
    return (
      <div className="dashboard-section">
        <h3>غير مصرح</h3>
        <p>
          هذه الصفحة مخصصة للإدارة/الاستقبال فقط.
          <br />
          (يمكن فتحها للـ staff لاحقًا من الإعدادات)
        </p>
      </div>
    );
  }

  return (
    <div className="clients-page">
      {/* Header */}
      <div className="clients-header">
        <div>
          <h1>
            <FontAwesomeIcon icon={faUsers} /> العميلات
          </h1>
          <div style={{ opacity: 0.75, marginTop: 6, fontSize: 13 }}>
            {importLoading ? "جارٍ تحميل عميلات Excel..." : "الصفحة تجمع: حجوزات + عميلات مستوردات"}
          </div>
        </div>
      </div>

      {/* Search + Sort + Export + Import */}
      <div className="cl-section">
        <div className="cl-mini">
          <div className="mini-title">
            <FontAwesomeIcon icon={faSearch} /> بحث (اسم / جوال)
          </div>

          <div className="cl-form">
            <input
              className="cl-input"
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="مثال: نورة أو 05xxxxxxx"
            />

            {/* ✅ Unified Dropdown */}
            <div className="dash-dd-wrap cl-sort-wrap" ref={sortWrapRef}>
              <button
                type="button"
                className="dash-select dash-select--sm cl-sort-btn"
                onClick={() => setSortOpen((s) => !s)}
                aria-expanded={sortOpen}
              >
                {sortLabel}
              </button>

              {sortOpen && (
                <div className="dash-dd-menu" role="listbox">
                  {sortOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`dash-dd-item ${sortBy === opt.value ? "is-active" : ""}`}
                      onClick={() => selectSort(opt.value)}
                      role="option"
                      aria-selected={sortBy === opt.value}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ✅ Import Excel (owner/admin) */}
            {canImport && (
              <button
                className="reports-btn cl-export"
                type="button"
                onClick={openImport}
                disabled={loading || importLoading}
                title="استيراد Excel .xlsx"
              >
                <FontAwesomeIcon icon={faFileArrowUp} /> استيراد Excel
              </button>
            )}

            {/* ✅ Export (owner/admin) */}
            {canExport && (
              <button
                className="reports-btn cl-export"
                type="button"
                onClick={exportClientsXLSX}
                disabled={loading}
                title="Excel .xlsx"
              >
                <FontAwesomeIcon icon={faFileCsv} /> تصدير Excel
              </button>
            )}
          </div>

          <div className="mini-hint">
            {loading ? "جارٍ تحميل الحجوزات..." : "البحث بالاسم أو رقم الجوال"}
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="cl-section">
          <div className="cl-mini cl-errorCard">
            <div className="mini-title cl-errorTitle">تنبيه</div>
            <div className="cl-errorText">{error}</div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="clients-stats">
        <div className="stat-card stat-3">
          <div className="stat-info">
            <h3 className="value">{stats.totalClients}</h3>
            <p>عدد العميلات (بعد البحث)</p>
          </div>
        </div>

        <div className="stat-card stat-3">
          <div className="stat-info">
            <h3 className="value">{stats.totalBookings}</h3>
            <p>إجمالي الحجوزات</p>
          </div>
        </div>

        <div className="stat-card stat-6 cl-topClientCard">
          <div className="stat-info">
            <h3 className="cl-topTitle value1">أكثر عميلة حجزًا</h3>
            <p className="cl-topValue" style={{ fontSize: 18 }}>
              {stats.topClient
                ? `${stats.topClient.name} — (${stats.topClient.bookingsCount})`
                : "—"}
            </p>
          </div>
        </div>
      </div>

      {/* Clients Table */}
      <div className="clients-table-card">
        <div className="cl-table-wrap">
          <div className="table-responsive">
            <table className="clients-table">
              <thead>
                <tr>
                  <th>العميلة</th>
                  <th>الجوال</th>
                  <th>VIP</th>
                  <th>عدد الحجوزات</th>
                  <th>آخر زيارة</th>
                  <th>المصدر</th>
                  <th>سجل</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="cl-td-center">
                      جاري التحميل...
                    </td>
                  </tr>
                ) : filteredClients.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="cl-td-center">
                      لا توجد نتائج
                    </td>
                  </tr>
                ) : (
                  filteredClients.map((c) => (
                    <tr key={c.key}>
                      <td className="cl-nameCell">
                        <span className="cl-name">{c.name}</span>
                      </td>

                      <td className="cl-phone">
                        <div className="cl-phoneRow">
                          <span>{c.phone}</span>

                          {c.phone !== "—" && (
                            <div className="cl-miniActions">
                              <button
                                className="cl-iconBtn"
                                type="button"
                                title="نسخ الجوال"
                                onClick={() => navigator.clipboard.writeText(c.phone)}
                              >
                                📋
                              </button>

                              <a
                                className="cl-iconBtn"
                                title="واتساب"
                                href={`https://wa.me/${c.phone.replace(/^0/, "966")}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                💬
                              </a>
                            </div>
                          )}
                        </div>
                      </td>

                      <td>
                        {c.vip ? (
                          <span className="dash-pill dash-pill-primary">VIP</span>
                        ) : (
                          <span style={{ opacity: 0.5 }}>—</span>
                        )}
                      </td>

                      <td className="cl-num">{c.bookingsCount}</td>

                      <td className="cl-last">
                        {c.lastVisitDate
                          ? `${c.lastVisitDate} — ${c.lastVisitTime || ""}`
                          : "—"}
                      </td>

                      <td style={{ opacity: 0.75 }}>
                        {c.source === "both" ? "حجوزات + Excel" : c.source === "imported" ? "Excel" : "حجوزات"}
                      </td>

                      <td>
                        <button
                          className="cl-btn ghost"
                          type="button"
                          onClick={() => {
                            setSelectedClient(c);
                            setNoteText(notesMap[c.key] || "");
                          }}
                        >
                          <FontAwesomeIcon icon={faCircleInfo} /> عرض السجل
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Client Bookings Modal (Unified) */}
      {selectedClient && (
        <Modal
          open={!!selectedClient}
          onClose={() => setSelectedClient(null)}
          ariaLabel="سجل العميل"
          panelClassName="dash-modal"
          size="lg"
        >
            <div className="cl-modalHeader">
              <h3 className="cl-modalTitle">
                سجل: {selectedClient.name}{" "}
                {selectedClient.phone !== "—" ? `— ${selectedClient.phone}` : ""}
              </h3>

              <button
                className="cl-btn"
                type="button"
                onClick={() => setSelectedClient(null)}
              >
                <FontAwesomeIcon icon={faXmark} /> إغلاق
              </button>
            </div>

            <div className="cl-modalBody">
              {(() => {
                const totalSpend = selectedBookings.reduce((sum: number, x: any) => {
                  const n = Number(x?.total);
                  return sum + (Number.isFinite(n) ? n : 0);
                }, 0);

                const last = selectedBookings[0];

                const saveNote = () => {
                  const next = { ...notesMap, [selectedClient.key]: noteText.trim() };
                  setNotesMap(next);
                  localStorage.setItem(NOTES_KEY, JSON.stringify(next));
                };

                // ✅ imported note (from excel)
                const importedNote = selectedClient.importedNote || "";

                return (
                  <>
                    <div className="cl-client-summary">
                      <div className="cl-sum-card">
                        <div className="cl-sum-num">{selectedBookings.length}</div>
                        <div className="cl-sum-label">عدد الحجوزات</div>
                      </div>

                      <div className="cl-sum-card">
                        <div className="cl-sum-num">
                          {last?.date ? `${last.date} ${last.time || ""}` : "—"}
                        </div>
                        <div className="cl-sum-label">آخر زيارة</div>
                      </div>

                      <div className="cl-sum-card">
                        <div className="cl-sum-num">
                          {totalSpend ? `${totalSpend.toLocaleString()} ريال` : "—"}
                        </div>
                        <div className="cl-sum-label">إجمالي الصرف</div>
                      </div>
                    </div>

                    {importedNote ? (
                      <div className="cl-notes" style={{ marginTop: 10 }}>
                        <div className="cl-notesHead">ملاحظة (من Excel)</div>
                        <div style={{ padding: 10, borderRadius: 10, background: "rgba(255,255,255,0.04)" }}>
                          {importedNote}
                        </div>
                      </div>
                    ) : null}

                    <div className="cl-notes">
                      <div className="cl-notesHead">ملاحظات إدارية (داخلية)</div>
                      <textarea
                        className="cl-notesInput"
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder="مثال: تفضّل موظفة معينة / حساسية / أوقات مناسبة..."
                      />
                      <button className="cl-btn primary" type="button" onClick={saveNote}>
                        حفظ الملاحظة
                      </button>
                    </div>
                  </>
                );
              })()}

              <div className="clients-table-card">
                <div className="cl-table-wrap">
                  <div className="table-responsive">
                    <table className="clients-table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>الخدمة</th>
                          <th>الموظفة</th>
                          <th>التاريخ</th>
                          <th>الوقت</th>
                          <th>الحالة</th>
                          <th>الإجمالي</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedBookings.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="cl-td-center">
                              لا يوجد سجل حجوزات (هذه عميلة Excel فقط)
                            </td>
                          </tr>
                        ) : (
                          selectedBookings.map((b: any) => (
                            <tr key={b.id}>
                              <td className="cl-id">{b.id}</td>
                              <td>{(b.serviceName ?? "-").toString()}</td>
                              <td>{(b.employeeName ?? "-").toString()}</td>
                              <td className="cl-date">{b.date}</td>
                              <td className="cl-time">{b.time}</td>
                              <td>
                                <span className={`status-badge ${b.status}`}>
                                  {statusLabel[(b.status as BookingStatus) ?? "pending"] ??
                                    ((b.status as any) ?? "pending")}
                                </span>
                              </td>
                              <td className="cl-money">
                                {Number.isFinite(Number(b.total))
                                  ? `${Number(b.total).toLocaleString()} ريال`
                                  : "-"}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="cl-modalHint">
                * السجل من الحجوزات + بيانات Excel محفوظة في Firestore (clients).
              </div>
            </div>
          </Modal>
        )}

      {/* Import Modal (Unified style using same overlay pattern) */}
      {importOpen && (
        <Modal
          open={importOpen}
          onClose={closeImport}
          ariaLabel="استيراد عميلات من Excel"
          panelClassName="dash-modal"
          size="lg"
        >
            <div className="dash-modal-header">
              <h3>استيراد عميلات من Excel (دمج آمن)</h3>
              <button className="dash-close" type="button" onClick={closeImport} disabled={importing}>
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            <div className="dash-modal-body">
              {importErr && (
                <div className="bookings-error" style={{ marginBottom: 10 }}>
                  {importErr}
                </div>
              )}

              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontSize: 13, opacity: 0.8 }}>
                  الأعمدة المدعومة: <b>name/الاسم</b> + <b>phone/الجوال</b> (اختياري: vip, note/ملاحظة)
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onPickFile(f);
                  }}
                  disabled={importing}
                />

                {preview.length > 0 && (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontWeight: 900 }}>
                        Preview: {preview.length} عميلة
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>
                        سيتم الدمج على رقم الجوال (بدون مسح بيانات)
                      </div>
                    </div>

                    <div style={{ maxHeight: 260, overflow: "auto", borderRadius: 10 }}>
                      <table className="clients-table">
                        <thead>
                          <tr>
                            <th>الاسم</th>
                            <th>الجوال</th>
                            <th>VIP</th>
                            <th>ملاحظة</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.slice(0, 80).map((r) => (
                            <tr key={r.digits}>
                              <td>{r.name}</td>
                              <td>{r.phone}</td>
                              <td>{r.vip ? "VIP" : "—"}</td>
                              <td style={{ maxWidth: 280, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {r.note || "—"}
                              </td>
                            </tr>
                          ))}
                          {preview.length > 80 ? (
                            <tr>
                              <td colSpan={4} style={{ textAlign: "center", opacity: 0.7 }}>
                                تم عرض 80 فقط من {preview.length}
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
                      <button className="reports-btn" type="button" onClick={closeImport} disabled={importing}>
                        إلغاء
                      </button>
                      <button className="reports-btn" type="button" onClick={commitImport} disabled={importing}>
                        {importing ? "جارٍ الحفظ..." : "حفظ ودمج"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </Modal>
        )}
    </div>
  );
};

export default DashboardClients;
