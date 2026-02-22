import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFileCsv, faFilter, faRotate } from "@fortawesome/free-solid-svg-icons";

import "../styles/DashboardReports.css";
import "../styles/DashboardModals.css";

import { listAllBookings, type BookingStatus } from "../services/firestoreBookings";

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

export default function DashboardReports() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);

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

  return (
    <div className="reports-page">
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

    </div>
  );
}
