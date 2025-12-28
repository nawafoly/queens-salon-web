// src/pages/DashboardClients.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSearch,
  faFileCsv,
  faUsers,
  faXmark,
  faCircleInfo,
} from "@fortawesome/free-solid-svg-icons";
import * as XLSX from "xlsx";

/**
 * ✅ قاعدة الاستيراد:
 * - ستايل المودالات الموحّد أولاً
 * - ثم ستايل الصفحة الخاص
 */
import "../styles/DashboardModals.css"; // ✅ مودالات موحّدة للداشبورد
import "../styles/DashboardClients.css";

// ✅ Firestore Bookings
import {
  listAllBookings,
  type BookingDocWithId,
  type BookingStatus,
} from "../services/firestoreBookings";

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
};

const statusLabel: Record<BookingStatus, string> = {
  confirmed: "مؤكد",
  pending: "في الانتظار",
  cancelled: "ملغي",
  completed: "مكتمل",
};

/* =========================
   Helpers: Export
========================= */
function downloadCSV(filename: string, rows: string[][]) {
  const escapeCell = (cell: string) => {
    const s = (cell ?? "").toString();
    if (s.includes('"') || s.includes(",") || s.includes("\n"))
      return `"${s.replace(/"/g, '""')}"`;
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

function downloadXLSX(filename: string, rows: any[][], sheetName = "Sheet1") {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

function cleanPhone(v: any) {
  return String(v ?? "").trim();
}

function makeClientKey(name: string, phone: string) {
  return phone ? `p:${phone}` : `n:${name.trim().toLowerCase()}`;
}

const NOTES_KEY = "dashboard_client_notes_v1";

const DashboardClients: React.FC = () => {
  // ✅ Role + Settings (NEW)
  const [uiRole, setUiRole] = useState<UiRole>(() => getUiRole());
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  const [bookings, setBookings] = useState<BookingDocWithId[]>([]);
  const [query, setQuery] = useState("");
  const [selectedClient, setSelectedClient] = useState<ClientRow | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ✅ Level Up States
  const [sortBy, setSortBy] = useState<"latest" | "most">("latest");
  const [notesMap, setNotesMap] = useState<Record<string, string>>({});
  const [noteText, setNoteText] = useState("");

  // ✅ Custom Sort Dropdown (Unified with DashboardSkin)
  const [sortOpen, setSortOpen] = useState(false);
  const sortWrapRef = useRef<HTMLDivElement | null>(null);

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
  const allowStaffViewClients = settings?.policies?.allowStaffViewClients === true;

  const canViewClients =
    uiRole === "owner" ||
    uiRole === "admin" ||
    uiRole === "reception" ||
    (uiRole === "staff" && allowStaffViewClients);

  // ✅ (اختياري) تصدير Excel نخليه للـ owner/admin فقط
  const canExport = uiRole === "owner" || uiRole === "admin";

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

  // ✅ جلب من Firestore
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
    const map = new Map<
      string,
      { name: string; phone: string; list: BookingDocWithId[] }
    >();

    bookings.forEach((b) => {
      const name = String((b as any).clientName ?? "").trim() || "—";
      const phone = cleanPhone((b as any).clientPhone);
      const key = makeClientKey(name, phone);

      if (!map.has(key)) map.set(key, { name, phone, list: [] });
      map.get(key)!.list.push(b);
    });

    const rows: ClientRow[] = [];
    map.forEach((v, key) => {
      const sorted = [...v.list].sort((a, b) => {
        const da = ((a as any).date ?? "").toString();
        const db = ((b as any).date ?? "").toString();
        if (da !== db) return db.localeCompare(da); // desc
        return ((b as any).time ?? "")
          .toString()
          .localeCompare(((a as any).time ?? "").toString()); // desc
      });

      const last = sorted[0];

      rows.push({
        key,
        name: v.name,
        phone: v.phone || "—",
        bookingsCount: v.list.length,
        lastVisitDate: ((last as any)?.date ?? "").toString(),
        lastVisitTime: ((last as any)?.time ?? "").toString(),
      });
    });

    // ✅ فرز حسب الاختيار
    rows.sort((a, b) => {
      if (sortBy === "most") {
        if (b.bookingsCount !== a.bookingsCount)
          return b.bookingsCount - a.bookingsCount;
      }
      // الأحدث أولاً
      if (b.lastVisitDate !== a.lastVisitDate)
        return (b.lastVisitDate || "").localeCompare(a.lastVisitDate || "");
      return (b.lastVisitTime || "").localeCompare(a.lastVisitTime || "");
    });

    return rows;
  }, [bookings, sortBy]);

  const filteredClients = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;

    return clients.filter((c) => {
      const name = (c.name ?? "").toLowerCase();
      const phone = (c.phone ?? "").toLowerCase();
      return name.includes(q) || phone.includes(q);
    });
  }, [clients, query]);

  const selectedBookings = useMemo(() => {
    if (!selectedClient) return [];

    const list = bookings.filter((b) => {
      const name = String((b as any).clientName ?? "").trim() || "—";
      const phone = cleanPhone((b as any).clientPhone);
      const key = makeClientKey(name, phone);
      return key === selectedClient.key;
    });

    return list.sort((a, b) => {
      const da = ((a as any).date ?? "").toString();
      const db = ((b as any).date ?? "").toString();
      if (da !== db) return db.localeCompare(da);
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
     Export actions (CSV + XLSX)
  ========================= */
  const exportCSV = () => {
    const rows: string[][] = [
      ["العميلة", "الجوال", "عدد الحجوزات", "آخر زيارة (تاريخ)", "آخر زيارة (وقت)"],
    ];

    filteredClients.forEach((c) => {
      rows.push([
        c.name,
        c.phone,
        String(c.bookingsCount),
        c.lastVisitDate,
        c.lastVisitTime,
      ]);
    });

    const stamp = new Date();
    const yyyy = stamp.getFullYear();
    const mm = String(stamp.getMonth() + 1).padStart(2, "0");
    const dd = String(stamp.getDate()).padStart(2, "0");

    downloadCSV(`dashboard_clients_${yyyy}-${mm}-${dd}.csv`, rows);
  };

  const exportClientsXLSX = () => {
    const rows: any[][] = [
      ["العميلة", "الجوال", "عدد الحجوزات", "آخر زيارة (تاريخ)", "آخر زيارة (وقت)"],
    ];

    filteredClients.forEach((c) => {
      rows.push([c.name, c.phone, c.bookingsCount, c.lastVisitDate, c.lastVisitTime]);
    });

    const stamp = new Date();
    const yyyy = stamp.getFullYear();
    const mm = String(stamp.getMonth() + 1).padStart(2, "0");
    const dd = String(stamp.getDate()).padStart(2, "0");

    downloadXLSX(`dashboard_clients_${yyyy}-${mm}-${dd}.xlsx`, rows, "Clients");
  };

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
        </div>
      </div>

      {/* Search + Sort + Export */}
      <div className="cl-section">
        <div className="cl-mini">
          <div className="mini-title">
            <FontAwesomeIcon icon={faSearch} /> بحث (اسم / جوال)
          </div>

          <div className="cl-form">
            <input
              className="cl-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="مثال: نورة أو 05xxxxxxx"
            />

            {/* ✅ Unified Dropdown (DashboardSkin) */}
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
                      className={`dash-dd-item ${
                        sortBy === opt.value ? "is-active" : ""
                      }`}
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

            {/* ✅ Export للـ owner/admin فقط */}
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
                  <th>عدد الحجوزات</th>
                  <th>آخر زيارة</th>
                  <th>سجل</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="cl-td-center">
                      جاري التحميل...
                    </td>
                  </tr>
                ) : filteredClients.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="cl-td-center">
                      لا توجد نتائج
                    </td>
                  </tr>
                ) : (
                  filteredClients.map((c) => (
                    <tr key={c.key}>
                      <td className="cl-nameCell">
                        <span className="cl-name">{c.name}</span>
                        {c.bookingsCount >= 5 ? (
                          <span className="dash-pill dash-pill-primary">VIP</span>
                        ) : null}
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

                      <td className="cl-num">{c.bookingsCount}</td>

                      <td className="cl-last">
                        {c.lastVisitDate
                          ? `${c.lastVisitDate} — ${c.lastVisitTime || ""}`
                          : "—"}
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
        <div className="dash-modal-overlay" onClick={() => setSelectedClient(null)}>
          <div className="dash-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cl-modalHeader">
              <h3 className="cl-modalTitle">
                سجل حجوزات: {selectedClient.name}{" "}
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
                              لا يوجد سجل حجوزات
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
                * السجل مستخرج تلقائيًا من الحجوزات الموجودة في Firestore.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardClients;
