import { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFileCsv, faFilter, faPrint, faRotate, faLock } from "@fortawesome/free-solid-svg-icons";

import "../styles/DashboardReports.css";
import "../styles/DashboardModals.css";

import { listAllBookings, type BookingStatus } from "../services/firestoreBookings";
import { DashboardService } from "../helpers/dashboardService";

type Booking = {
  id?: string;
  date: string; // YYYY-MM-DD
  time?: string;
  status: BookingStatus;
  total?: number;
  serviceName?: string;
  employeeName?: string;
};

const statusLabel: Record<BookingStatus, string> = {
  confirmed: "مؤكد",
  pending: "في الانتظار",
  cancelled: "ملغي",
  completed: "مكتمل",
};

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatTime12(time24?: string) {
  const m = String(time24 || "").trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return String(time24 || "--:--");
  const h24 = Number(m[1]);
  const mm = m[2];
  const h12 = h24 % 12 || 12;
  return `${String(h12).padStart(2, "0")}:${mm} ${h24 >= 12 ? "م" : "ص"}`;
}

export default function DashboardReports() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);

  // ✅ جرد اليوم
  const [auditDate, setAuditDate] = useState<string>(todayISO());
  const [manualCash, setManualCash] = useState<string>("");
  const [printing, setPrinting] = useState(false);

  const printRef = useRef<HTMLDivElement | null>(null);

  async function load() {
    setLoading(true);
    try {
      const rows = await listAllBookings();
      setBookings(rows as any);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const stats = useMemo(() => {
    const agg: Record<BookingStatus, number> = {
      confirmed: 0,
      pending: 0,
      cancelled: 0,
      completed: 0,
    };
    bookings.forEach((b) => {
      if (agg[b.status] !== undefined) agg[b.status]++;
    });
    return {
      total: bookings.length,
      ...agg,
    };
  }, [bookings]);

  // ✅ حجوزات يوم الجرد فقط (تم إصلاح التداخل هنا)
  const dayBookings = useMemo(() => {
    return bookings
      .filter((b) => String(b.date || "").trim() === auditDate)
      .slice()
      .sort((a, b) => String(a.time || "").localeCompare(String(b.time || "")));
  }, [bookings, auditDate]);

  // ✅ تقسيم الحجوزات للطباعة (تم نقلها خارج التداخل)
  const approvedBookings = useMemo(() => {
    return dayBookings.filter((b) => b.status === "confirmed" || b.status === "completed");
  }, [dayBookings]);

  const unapprovedBookings = useMemo(() => {
    return dayBookings.filter((b) => b.status === "pending" || b.status === "cancelled");
  }, [dayBookings]);

  // ✅ إيراد الحجوزات: confirmed + completed فقط
  const dayRevenue = useMemo(() => {
    return approvedBookings.reduce((sum, b) => sum + (Number(b.total) || 0), 0);
  }, [approvedBookings]);

  const manualCashNum = useMemo(() => {
    const n = Number(manualCash);
    return Number.isFinite(n) ? n : 0;
  }, [manualCash]);

  const diffCash = useMemo(() => manualCashNum - dayRevenue, [manualCashNum, dayRevenue]);

  function doPrint() {
    setPrinting(true);

    // ✅ اترك رندر بسيط قبل الطباعة
    setTimeout(() => {
      window.print();
      setTimeout(() => setPrinting(false), 300);
    }, 100);
  }

  async function printAuditOnly() {
    // طباعة بدون قفلة (جرد فقط)
    doPrint();
  }

  async function printAndCloseDay() {
    const ok = window.confirm(
      `تأكيد قفل يوم ${auditDate}؟\n\nسيتم تحويل:\n- مؤكد ➜ مكتمل\n- انتظار ➜ ملغي\n\nثم الطباعة.`
    );
    if (!ok) return;

    setLoading(true);
    try {
      await DashboardService.finalizeClosedDate(auditDate);
      await load();
      doPrint();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`reports-page ${printing ? "is-printing" : ""}`}>
      {/* Header */}
      <div className="reports-header">
        <div>
          <h1>التقارير</h1>
          <p>ملخص سريع لحركة الحجوزات حسب الحالة</p>
        </div>

        <div className="reports-actions">
          <button className="reports-btn" disabled={loading}>
            <FontAwesomeIcon icon={faFilter} />
            فلترة
          </button>

          <button className="reports-btn" onClick={load} disabled={loading} title="Excel .xlsx">
            <FontAwesomeIcon icon={faFileCsv} />
            تصدير Excel
          </button>

          <button className="reports-btn primary" onClick={load} disabled={loading}>
            <FontAwesomeIcon icon={faRotate} />
            {loading ? "جارٍ التحديث..." : "تحديث"}
          </button>
        </div>
      </div>

      {/* ✅ جرد اليوم */}
      <div className="reports-audit" style={{ width: 'min(1180px, calc(100% - 28px))', margin: '0 auto 18px auto', background: 'rgba(255,255,255,0.92)', border: '1px solid rgba(13,13,13,0.07)', borderRadius: '18px', padding: '20px', boxShadow: '0 10px 26px rgba(13,13,13,0.05)' }}>
        <div className="reports-audit-head">
        <h2 className="qs-black  today-inventory-title">جرد اليوم</h2>
        <p style={{ fontSize: '13px', color: 'rgba(13,13,13,0.60)', margin: '0 0 15px 0' }}>اطبع ملخص اليوم + إدخال الكاش اليدوي قبل الطباعة</p>
        </div>

        <div className="reports-audit-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px' }}>
          <div className="field">
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '800', marginBottom: '6px' }}>تاريخ الجرد</label>
            <input
              style={{ width: '100%', padding: '10px', borderRadius: '10px', border: '1px solid #ddd' }}
              type="date"
              value={auditDate}
              onChange={(e) => setAuditDate(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="field">
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '800', marginBottom: '6px' }}>الكاش اليدوي قبل الطباعة</label>
            <input
              style={{ width: '100%', padding: '10px', borderRadius: '10px', border: '1px solid #ddd' }}
              type="number"
              inputMode="numeric"
              placeholder="مثال: 500"
              value={manualCash}
              onChange={(e) => setManualCash(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="field">
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '800', marginBottom: '6px' }}>إيراد الحجوزات (مؤكد + مكتمل)</label>
            <div className="readonly" style={{ padding: '10px', background: '#f9f9f9', borderRadius: '10px', fontWeight: '900' }}>{dayRevenue}</div>
          </div>

          <div className="field">
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '800', marginBottom: '6px' }}>فرق الكاش (الكاش - الإيراد)</label>
            <div className="readonly" style={{ padding: '10px', background: '#f9f9f9', borderRadius: '10px', fontWeight: '900', color: diffCash < 0 ? 'red' : 'green' }}>{diffCash}</div>
          </div>
        </div>

        <div className="reports-audit-actions" style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
          <button className="reports-btn" onClick={printAuditOnly} disabled={loading}>
            <FontAwesomeIcon icon={faPrint} />
            طباعة جرد اليوم
          </button>

          <button className="reports-btn primary" onClick={printAndCloseDay} disabled={loading}>
            <FontAwesomeIcon icon={faLock} />
            طباعة + قفل اليوم
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="reports-stats">
        <div className="report-stat">
          <div className="label">إجمالي الحجوزات</div>
          <div className="value">{stats.total}</div>
        </div>
        <div className="report-stat">
          <div className="label">مؤكد</div>
          <div className="value">{stats.confirmed}</div>
        </div>
        <div className="report-stat">
          <div className="label">في الانتظار</div>
          <div className="value">{stats.pending}</div>
        </div>
        <div className="report-stat">
          <div className="label">ملغي</div>
          <div className="value">{stats.cancelled}</div>
        </div>
      </div>

      {/* Table */}
      <div className="reports-table-wrap">
        {bookings.length === 0 ? (
          <div className="reports-empty">لا توجد بيانات لعرضها</div>
        ) : (
          <div className="reports-table-scroll">
            <table className="reports-table">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>الحالة</th>
                  <th>الخدمة</th>
                  <th>الموظفة</th>
                  <th>الإجمالي</th>
                </tr>
              </thead>

              <tbody>
                {bookings.map((b, i) => (
                  <tr key={b.id || i}>
                    <td data-label="التاريخ">{b.date}</td>

                    <td data-label="الحالة">
                      <span className={`status-badge status-${b.status}`}>
                        {statusLabel[b.status]}
                      </span>
                    </td>

                    <td data-label="الخدمة">{b.serviceName || "-"}</td>
                    <td data-label="الموظفة">{b.employeeName || "-"}</td>
                    <td data-label="الإجمالي">{b.total ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ✅ منطقة الطباعة (Receipt) */}
      {printing && (
        <div className="print-area" ref={printRef}>
          <div className="receipt">
            <div className="receipt-title">صالون ملكات</div>
            <div className="receipt-sub">جرد يوم: {auditDate}</div>
            <div className="receipt-line" />

            <div className="receipt-row">
              <div>عدد حجوزات اليوم</div>
              <div>{dayBookings.length}</div>
            </div>

            <div className="receipt-row">
              <div>إيراد الحجوزات</div>
              <div>{dayRevenue}</div>
            </div>

            <div className="receipt-row">
              <div>كاش يدوي</div>
              <div>{manualCashNum}</div>
            </div>

            <div className="receipt-row">
              <div>الفرق</div>
              <div>{diffCash}</div>
            </div>

            <div className="receipt-line" />

            {/* ✅ تقسيم الحجوزات */}
            <div className="receipt-items">
              {dayBookings.length === 0 ? (
                <div className="receipt-empty">لا توجد حجوزات لهذا اليوم</div>
              ) : (
                <>
                  {/* ===== المعتمدة ===== */}
                  <div className="receipt-section-title">المعتمدة (مؤكد + مكتمل)</div>
                  <div className="receipt-section-sep" />

                  {approvedBookings.length === 0 ? (
                    <div className="receipt-empty">لا يوجد</div>
                  ) : (
                    approvedBookings.map((b, idx) => (
                      <div className="receipt-item" key={b.id || `ok-${idx}`}>
                        <div className="left">
                          <div className="top">
                            <span className="time">{formatTime12(b.time)}</span>
                            <span className={`st st-${b.status}`}>{statusLabel[b.status]}</span>
                          </div>
                          <div className="name">{b.serviceName || "-"}</div>
                          <div className="emp">{b.employeeName || "-"}</div>
                        </div>
                        <div className="right">{Number(b.total) || 0}</div>
                      </div>
                    ))
                  )}

                  <div className="receipt-section-sep" />

                  {/* ===== غير المعتمدة ===== */}
                  <div className="receipt-section-title">غير معتمد (في الانتظار + ملغي)</div>
                  <div className="receipt-section-sep" />

                  {unapprovedBookings.length === 0 ? (
                    <div className="receipt-empty">لا يوجد</div>
                  ) : (
                    unapprovedBookings.map((b, idx) => (
                      <div className="receipt-item" key={b.id || `bad-${idx}`}>
                        <div className="left">
                          <div className="top">
                            <span className="time">{formatTime12(b.time)}</span>
                            <span className={`st st-${b.status}`}>{statusLabel[b.status]}</span>
                          </div>
                          <div className="name">{b.serviceName || "-"}</div>
                          <div className="emp">{b.employeeName || "-"}</div>
                        </div>
                        <div className="right">{Number(b.total) || 0}</div>
                      </div>
                    ))
                  )}
                </>
              )}
            </div>

            <div className="receipt-line" />
            <div className="receipt-footer">تمت الطباعة من لوحة التحكم</div>
          </div>
        </div>
      )}
    </div>
  );
}
