// src/pages/DashboardBookings.tsx
import { useEffect, useMemo, useState, useRef } from "react";
import Modal from "../components/Modal";

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
  deleteBooking,
  type BookingStatus,
} from "../services/firestoreBookings";

import type { UiRole } from "../services/userProfile";

// ✅ NEW: resolve service name (make it readable)
import { resolveServiceName } from "../services/serviceResolver";

// ✅ NEW: AppSettings from Firestore (source of truth)
import { AppSettingsService, type AppSettings } from "../services/AppSettingsService";

import { isStaffAvailableForDate } from "../helpers/staffAvailability";

// ✅ Styles
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

function normalizeArabicName(input: string) {
  const s = String(input || "").trim().toLowerCase();
  return s
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

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
  const sArr = Array.isArray(anyB?.services) ? anyB.services : null;
  if (sArr && sArr.length) {
    return sArr.map((x: any) => ({
      serviceId: String(x?.serviceId ?? x?.id ?? x?.key ?? "").trim() || undefined,
      serviceName: String(x?.serviceName ?? x?.name ?? "").trim() || undefined,
      price: Number.isFinite(Number(x?.price)) ? Number(x?.price) : undefined,
      durationMin: Number.isFinite(Number(x?.durationMin)) ? Number(x?.durationMin) : undefined,
    })).filter((x: any) => x.serviceId || x.serviceName);
  }
  const ids = toStringArray(anyB?.serviceIds);
  const names = toStringArray(anyB?.serviceNames);
  if (ids.length || names.length) {
    const max = Math.max(ids.length, names.length);
    const out: BookingServiceItem[] = [];
    for (let i = 0; i < max; i++) {
      if (ids[i] || names[i]) out.push({ serviceId: ids[i] || undefined, serviceName: names[i] || undefined });
    }
    return out;
  }
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
  return `${firstName || (b.serviceName || b.serviceId || "خدمة")} + ${list.length - 1} خدمات`;
}

type Booking = {
  id: string;
  publicId?: string;
  customerName?: string;
  phone?: string;
  serviceName?: string;
  serviceId?: string;
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

/* =========================
   Component
========================= */
export default function DashboardBookings() {
  const [loading, setLoading] = useState(true);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState("");

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusOption>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [notesMap, setNotesMap] = useState<Record<string, string>>({});

  const uiRole = useMemo(() => getUiRole(), []);
  const authUser = useMemo(() => getAuthUserSafe(), []);

  useEffect(() => {
    setNotesMap(loadNotesMap());
    const unsub = watchAllBookings((data) => {
      const list = data.map((b: any) => ({
        ...b,
        services: extractServicesFromAny(b),
      }));
      setBookings(list);
      setLoading(false);
    }, (err) => {
      setError("خطأ في تحميل الحجوزات");
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    let list = [...bookings];
    if (statusFilter !== "all") {
      list = list.filter((b) => b.status === statusFilter);
    }
    if (dateFrom || dateTo) {
      list = list.filter((b) => inDateRange(b.date, dateFrom, dateTo));
    }
    const search = normalizeArabicName(q);
    if (search) {
      list = list.filter((b) => {
        const name = normalizeArabicName(b.customerName || "");
        const phone = (b.phone || "").toLowerCase();
        const emp = normalizeArabicName(b.employeeName || "");
        return name.includes(search) || phone.includes(search) || emp.includes(search);
      });
    }
    // Filter by role if staff
    if (uiRole === "staff") {
      list = list.filter((b) => {
        const bUid = String(b.employeeUid || "").trim();
        const bId = String(b.employeeId || "").trim();
        const bName = String(b.employeeName || "").trim();
        const myUid = auth.currentUser?.uid;
        if (myUid && bUid === myUid) return true;
        if (myUid && bId === myUid) return true;
        return bName && normalizeArabicName(bName).includes(normalizeArabicName(authUser.displayName));
      });
    }
    return list.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
  }, [bookings, q, statusFilter, dateFrom, dateTo, uiRole, authUser]);

  const handleUpdateStatus = async (id: string, newStatus: BookingStatus) => {
    try {
      await updateBookingStatus(id, newStatus);
    } catch (e) {
      alert("فشل تحديث الحالة");
    }
  };

  const handleDeleteBooking = async (b: Booking) => {
    if (uiRole !== "owner") {
      alert("الحذف النهائي متاح للمالك فقط");
      return;
    }

    const ref = b.publicId || b.id.slice(0, 6);
    const ok = window.confirm(`تأكيد الحذف النهائي للحجز #${ref}؟ لا يمكن التراجع.`);
    if (!ok) return;

    try {
      await deleteBooking(b.id);
      if (selectedBooking?.id === b.id) setSelectedBooking(null);
    } catch (e) {
      alert("تعذر حذف الحجز نهائيًا");
    }
  };

  const handleExport = () => {
    const rows = [
      ["ID", "الزبون", "الهاتف", "الخدمة", "الموظفة", "التاريخ", "الوقت", "الحالة", "السعر"],
      ...filtered.map(b => [
        b.publicId || b.id,
        b.customerName || "—",
        b.phone || "—",
        serviceSummaryForTable(b),
        b.employeeName || "—",
        b.date,
        b.time,
        statusLabel[b.status],
        String(b.finalPrice || b.total || 0)
      ])
    ];
    downloadCSV(`bookings_${new Date().toISOString().slice(0,10)}.csv`, rows);
  };

  const updateNote = (id: string, note: string) => {
    const newMap = { ...notesMap, [id]: note };
    setNotesMap(newMap);
    saveNotesMap(newMap);
  };

  if (loading) return <div className="p-5 text-center">جاري التحميل...</div>;

  return (
    <div className="bk-page-wrapper">
      <div className="container-fluid">
        <div className="bookings-header">
          <h1>إدارة الحجوزات</h1>
          <p>عرض وتعديل كافة الحجوزات في النظام</p>
          {error && <div className="bookings-error">{error}</div>}
        </div>

        <div className="bk-mini">
          <div className="bk-filters">
            <div className="bk-field">
              <label>بحث</label>
              <input 
                className="bk-input" 
                placeholder="اسم، هاتف، أو موظفة..." 
                value={q} 
                onChange={e => setQ(e.target.value)} 
              />
            </div>
            <div className="bk-field">
              <label>الحالة</label>
              <select className="bk-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}>
                <option value="all">الكل</option>
                <option value="pending">قيد الانتظار</option>
                <option value="confirmed">مؤكد</option>
                <option value="completed">مكتمل</option>
                <option value="cancelled">ملغي</option>
              </select>
            </div>
            <div className="bk-field">
              <label>من تاريخ</label>
              <input type="date" className="bk-input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            <div className="bk-field">
              <label>إلى تاريخ</label>
              <input type="date" className="bk-input" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
          </div>
          <div className="bk-actions">
            <button className="exp-btn" onClick={handleExport}>
              <FontAwesomeIcon icon={faFileCsv} /> تصدير CSV
            </button>
            <button className="exp-btn ghost" onClick={() => { setQ(""); setStatusFilter("all"); setDateFrom(""); setDateTo(""); }}>
              <FontAwesomeIcon icon={faRotate} /> إعادة ضبط
            </button>
          </div>
        </div>

        <div className="bookings-table-card">
          <div className="bk-table-wrap">
            <table className="bookings-table">
              <thead>
                <tr>
                  <th>الزبون</th>
                  <th>الخدمة</th>
                  <th>الموظفة</th>
                  <th>التاريخ والوقت</th>
                  <th>الحالة</th>
                  <th>السعر</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(b => (
                  <tr key={b.id}>
                    <td>
                      <div style={{fontWeight: 800}}>{b.customerName || "—"}</div>
                      <div style={{fontSize: 11, opacity: 0.6}}>{b.phone || "—"}</div>
                    </td>
                    <td>{serviceSummaryForTable(b)}</td>
                    <td>{b.employeeName || "—"}</td>
                    <td>
                      <div>{b.date}</div>
                      <div style={{fontSize: 11, opacity: 0.7}}>{b.time}</div>
                    </td>
                    <td>
                      <span className={`status-badge ${b.status}`}>
                        {statusLabel[b.status]}
                      </span>
                    </td>
                    <td>{b.finalPrice || b.total || 0} ر.س</td>
                    <td>
                      <div style={{display: 'flex', gap: 6, justifyContent: 'center'}}>
                        <button className="exp-btn ghost sm" onClick={() => setSelectedBooking(b)}>
                          <FontAwesomeIcon icon={faCircleInfo} />
                        </button>
                        {uiRole === "owner" && (
                          <button
                            className="exp-btn danger sm"
                            onClick={() => handleDeleteBooking(b)}
                            title="حذف نهائي"
                          >
                            حذف
                          </button>
                        )}
                        <select 
                          className="bk-select sm" 
                          style={{width: 'auto', height: 32, padding: '0 8px', fontSize: 11}}
                          value={b.status}
                          onChange={e => handleUpdateStatus(b.id, e.target.value as BookingStatus)}
                        >
                          <option value="pending">انتظار</option>
                          <option value="confirmed">تأكيد</option>
                          <option value="completed">اكتمل</option>
                          <option value="cancelled">إلغاء</option>
                        </select>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bk-mobile-grid">
            {filtered.map(b => (
              <div key={b.id} className="bk-mobile-card">
                <div className="bk-mobile-row">
                  <span className="bk-mobile-label">الزبون:</span>
                  <span className="bk-mobile-val">{b.customerName}</span>
                </div>
                <div className="bk-mobile-row">
                  <span className="bk-mobile-label">الخدمة:</span>
                  <span className="bk-mobile-val">{serviceSummaryForTable(b)}</span>
                </div>
                <div className="bk-mobile-row">
                  <span className="bk-mobile-label">التاريخ:</span>
                  <span className="bk-mobile-val">{b.date} {b.time}</span>
                </div>
                <div className="bk-mobile-row">
                  <span className="bk-mobile-label">الحالة:</span>
                  <span className={`status-badge ${b.status}`}>{statusLabel[b.status]}</span>
                </div>
                <div style={{marginTop: 12, display: 'flex', gap: 8}}>
                   <button className="exp-btn ghost sm w-100" onClick={() => setSelectedBooking(b)}>تفاصيل</button>
                   {uiRole === "owner" && (
                     <button className="exp-btn danger sm w-100" onClick={() => handleDeleteBooking(b)}>
                       حذف نهائي
                     </button>
                   )}
                   <select 
                      className="bk-select sm" 
                      value={b.status}
                      onChange={e => handleUpdateStatus(b.id, e.target.value as BookingStatus)}
                    >
                      <option value="pending">انتظار</option>
                      <option value="confirmed">تأكيد</option>
                      <option value="completed">اكتمل</option>
                      <option value="cancelled">إلغاء</option>
                    </select>
                </div>
              </div>
            ))}
          </div>
        </div>

        {selectedBooking && (
          <Modal
            open={!!selectedBooking}
            onClose={() => setSelectedBooking(null)}
            ariaLabel="تفاصيل الحجز"
            panelClassName="bk-modal"
            size="lg"
          >
            <div className="modal-head">
              <b>تفاصيل الحجز #{selectedBooking.publicId || selectedBooking.id.slice(0,6)}</b>
              <button className="exp-btn ghost" onClick={() => setSelectedBooking(null)}>
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            <div className="modal-body">
              <div className="bk-details-grid">
                <div className="bk-item">
                  <span className="bk-item-label">اسم الزبون</span>
                  <span className="bk-item-val">{selectedBooking.customerName || "—"}</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">رقم الهاتف</span>
                  <span className="bk-item-val">{selectedBooking.phone || "—"}</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">التاريخ</span>
                  <span className="bk-item-val">{selectedBooking.date}</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">الوقت</span>
                  <span className="bk-item-val">{selectedBooking.time}</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">الموظفة</span>
                  <span className="bk-item-val">{selectedBooking.employeeName || "—"}</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">السعر الإجمالي</span>
                  <span className="bk-item-val">{selectedBooking.finalPrice || selectedBooking.total || 0} ر.س</span>
                </div>
              </div>

              <div className="bk-note-area">
                <label className="bk-item-label">ملاحظات الإدارة (خاصة)</label>
                <textarea 
                  className="bk-input" 
                  rows={3} 
                  placeholder="أضف ملاحظات هنا..."
                  value={notesMap[selectedBooking.id] || ""}
                  onChange={e => updateNote(selectedBooking.id, e.target.value)}
                />
              </div>
            </div>
            <div className="modal-foot">
              {uiRole === "owner" && (
                <button className="exp-btn danger" onClick={() => handleDeleteBooking(selectedBooking)}>
                  حذف نهائي
                </button>
              )}
              <button className="exp-btn primary" onClick={() => setSelectedBooking(null)}>إغلاق</button>
            </div>
          </Modal>
        )}
      </div>
    </div>
  );
}
