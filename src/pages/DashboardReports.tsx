import React, { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFileCsv, faFilter, faRotate } from "@fortawesome/free-solid-svg-icons";

import "../styles/DashboardReports.css";
import "../styles/DashboardModals.css"; // ✅ نفس مودالات الداشبورد

import { listAllBookings, type BookingStatus } from "../services/firestoreBookings";

type Booking = {
  id?: string;
  date: string; // YYYY-MM-DD
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
    bookings.forEach((b) => agg[b.status]++);
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

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="reports-btn" disabled={loading}>
            <FontAwesomeIcon icon={faFilter} />
            فلترة
          </button>

          <button
              className="reports-btn"
              onClick={load}
              disabled={loading}
              title="Excel .xlsx"
            >
              <FontAwesomeIcon icon={faFileCsv} /> تصدير Excel
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
                  <td>{b.date}</td>
                  <td>{statusLabel[b.status]}</td>
                  <td>{b.serviceName || "-"}</td>
                  <td>{b.employeeName || "-"}</td>
                  <td>{b.total ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
