import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  FiAlertTriangle,
  FiBarChart2,
  FiCalendar,
  FiDownload,
  FiDollarSign,
  FiEye,
  FiFileText,
  FiRefreshCw,
  FiStar,
  FiUsers,
} from "react-icons/fi";
import { formatAttendanceHours } from "../helpers/hr/attendanceDiscipline";
import type { StaffPerformanceResult, StaffPerformanceRow } from "../helpers/hr/staffPerformance";
import {
  exportStaffPerformanceReportExcel,
  exportStaffPerformanceReportPdf,
} from "../helpers/reports/exportStaffPerformanceReport";
import { StaffPerformanceService } from "../services/StaffPerformanceService";
import "../styles/DashboardStaffPerformance.css";

const EMPTY_RESULT: StaffPerformanceResult = {
  filters: { fromDate: "", toDate: "", bookingStatus: "completed" },
  rows: [],
  summary: {
    totalCompletedBookings: 0,
    totalAttributedRevenueHalalas: 0,
    activeEmployees: 0,
    averagePerformanceScore: 0,
    unassignedCompletedBookings: 0,
    ratingAvailable: false,
    attendanceAvailable: false,
  },
  warnings: [],
};

function currentYearMonth() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function formatSar(value: number) {
  return `${(Number(value || 0) / 100).toLocaleString("ar-SA", {
    maximumFractionDigits: 2,
  })} ر.س`;
}

function formatNullableSar(value: number | null) {
  return value == null ? "غير متوفر" : formatSar(value);
}

function formatRating(row: StaffPerformanceRow) {
  return row.averageRating == null
    ? "غير متوفر"
    : `${row.averageRating.toLocaleString("ar-SA", { maximumFractionDigits: 2 })} (${row.ratingCount})`;
}

function formatPercent(value: number | null) {
  return value == null ? "غير متوفر" : `${Math.round(value).toLocaleString("ar-SA")}%`;
}

function scoreTone(score: number) {
  if (score >= 80) return "is-strong";
  if (score >= 55) return "is-steady";
  return "is-low";
}

export default function DashboardStaffPerformance() {
  const params = useParams();
  const navigate = useNavigate();
  const initial = useMemo(() => currentYearMonth(), []);
  const routeEmployeeId = String(params.employeeId || "").trim();

  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [fromDate, setFromDate] = useState(() => StaffPerformanceService.monthBounds(initial.year, initial.month).fromDate);
  const [toDate, setToDate] = useState(() => StaffPerformanceService.monthBounds(initial.year, initial.month).toDate);
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [bookingStatus, setBookingStatus] = useState<"completed" | "all">("completed");
  const [result, setResult] = useState<StaffPerformanceResult>(EMPTY_RESULT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!routeEmployeeId) return;
    setEmployeeFilter(routeEmployeeId);
  }, [routeEmployeeId]);

  const selectedRow = useMemo(
    () => result.rows.find((row) => row.employeeId === (routeEmployeeId || employeeFilter)) || null,
    [employeeFilter, result.rows, routeEmployeeId]
  );

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const next = await StaffPerformanceService.load({
        year,
        month,
        fromDate,
        toDate,
        employeeId: routeEmployeeId || employeeFilter,
        bookingStatus,
      });
      setResult(next);
    } catch (err) {
      console.error("[staff-performance] load failed", err);
      setResult(EMPTY_RESULT);
      setError(err instanceof Error ? err.message : "تعذر تحميل أداء الموظفات.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeEmployeeId]);

  const applyMonth = (nextYear: number, nextMonth: number) => {
    setYear(nextYear);
    setMonth(nextMonth);
    const bounds = StaffPerformanceService.monthBounds(nextYear, nextMonth);
    setFromDate(bounds.fromDate);
    setToDate(bounds.toDate);
  };

  const employeeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    result.rows.forEach((row) => seen.set(row.employeeId, row.employeeName));
    if (selectedRow) seen.set(selectedRow.employeeId, selectedRow.employeeName);
    return Array.from(seen.entries()).sort((left, right) => left[1].localeCompare(right[1], "ar"));
  }, [result.rows, selectedRow]);

  const loadedEmployeeName =
    result.filters.employeeId
      ? result.rows.find((row) => row.employeeId === result.filters.employeeId)?.employeeName || result.filters.employeeId
      : "كل الموظفات";
  const loadedBookingStatusLabel =
    result.filters.bookingStatus === "all" ? "كل حالات الحجز للتحليل" : "المكتملة فقط";
  const staffPerformanceReportInput = () => ({
    result,
    filters: {
      fromDate: result.filters.fromDate,
      toDate: result.filters.toDate,
      employeeName: loadedEmployeeName,
      bookingStatusLabel: loadedBookingStatusLabel,
    },
  });

  const handleExportPerformancePdf = () => {
    exportStaffPerformanceReportPdf(staffPerformanceReportInput());
  };

  const handleExportPerformanceExcel = () => {
    exportStaffPerformanceReportExcel(staffPerformanceReportInput());
  };

  return (
    <div className="staff-performance-page">
      <header className="staff-performance-hero">
        <div>
          <span>تحليل تشغيلي</span>
          <h1>أداء الموظفات</h1>
          <p>تحليل أداء الموظفات حسب الحجوزات المكتملة والحضور والإيرادات.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}>
          <FiRefreshCw className={loading ? "is-spinning" : ""} />
          تحديث
        </button>
      </header>

      <section className="staff-performance-toolbar" aria-label="فلاتر أداء الموظفات">
        <label>
          <span>السنة</span>
          <input
            type="number"
            value={year}
            min={2020}
            max={2100}
            onChange={(event) => applyMonth(Number(event.target.value), month)}
          />
        </label>
        <label>
          <span>الشهر</span>
          <select value={month} onChange={(event) => applyMonth(year, Number(event.target.value))}>
            {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => (
              <option key={value} value={value}>{value.toLocaleString("ar-SA")}</option>
            ))}
          </select>
        </label>
        <label>
          <span>من تاريخ</span>
          <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
        </label>
        <label>
          <span>إلى تاريخ</span>
          <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
        </label>
        <label>
          <span>الموظفة</span>
          <select
            value={employeeFilter}
            onChange={(event) => {
              const next = event.target.value;
              setEmployeeFilter(next);
              if (routeEmployeeId) navigate(next ? `/dashboard/staff-performance/${encodeURIComponent(next)}` : "/dashboard/staff-performance");
            }}
          >
            <option value="">كل الموظفات</option>
            {employeeOptions.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>حالة الحجز</span>
          <select value={bookingStatus} onChange={(event) => setBookingStatus(event.target.value as "completed" | "all")}>
            <option value="completed">المكتملة فقط</option>
            <option value="all">كل الحالات للتحليل</option>
          </select>
        </label>
        <div className="staff-performance-export-actions" aria-label="تصدير تقرير أداء الموظفات">
          <button type="button" onClick={handleExportPerformancePdf} disabled={loading}>
            <FiFileText /> تصدير PDF
          </button>
          <button type="button" onClick={handleExportPerformanceExcel} disabled={loading}>
            <FiDownload /> تصدير Excel
          </button>
        </div>
      </section>

      {error ? <div className="staff-performance-alert" role="alert"><FiAlertTriangle />{error}</div> : null}
      {result.warnings.length ? (
        <div className="staff-performance-alert is-soft" role="status">
          <FiAlertTriangle />
          <div>{result.warnings.map((warning) => <span key={warning}>{warning}</span>)}</div>
        </div>
      ) : null}

      <section className="staff-performance-stats" aria-label="ملخص أداء الموظفات">
        <article>
          <FiCalendar />
          <small>الحجوزات المكتملة</small>
          <strong>{result.summary.totalCompletedBookings.toLocaleString("ar-SA")}</strong>
        </article>
        <article>
          <FiDollarSign />
          <small>الإيراد المنسوب</small>
          <strong>{formatSar(result.summary.totalAttributedRevenueHalalas)}</strong>
        </article>
        <article>
          <FiUsers />
          <small>الموظفات النشطات</small>
          <strong>{result.summary.activeEmployees.toLocaleString("ar-SA")}</strong>
        </article>
        <article>
          <FiBarChart2 />
          <small>متوسط درجة الأداء</small>
          <strong>{result.summary.averagePerformanceScore.toLocaleString("ar-SA")}/100</strong>
        </article>
      </section>

      <section className="staff-performance-table-wrap" aria-label="جدول أداء الموظفات">
        <table className="staff-performance-table">
          <thead>
            <tr>
              <th>الموظفة</th>
              <th>الحالة/القسم</th>
              <th>الحجوزات المكتملة</th>
              <th>العميلات المخدومات</th>
              <th>الخدمات المنفذة</th>
              <th>الإيراد المنسوب</th>
              <th>متوسط التقييم</th>
              <th>الالتزام بالحضور</th>
              <th>درجة الأداء</th>
              <th>الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.employeeId}>
                <td className="staff-performance-person">
                  <strong>{row.employeeName}</strong>
                  <small>{row.employeeId}</small>
                </td>
                <td>
                  <span className={`staff-performance-badge ${row.active ? "is-active" : "is-muted"}`}>
                    {row.active ? "نشطة" : "غير نشطة"}
                  </span>
                  <small>{row.department || row.jobTitle || "غير محدد"}</small>
                </td>
                <td>{row.completedBookings.toLocaleString("ar-SA")}</td>
                <td>{row.uniqueClients.toLocaleString("ar-SA")}</td>
                <td>{row.servicesPerformed.toLocaleString("ar-SA")}</td>
                <td>{formatSar(row.attributedRevenueHalalas)}</td>
                <td>{formatRating(row)}</td>
                <td>{formatPercent(row.attendance.commitmentPercent)}</td>
                <td>
                  <span className={`staff-performance-score ${scoreTone(row.performanceScore)}`}>
                    {row.performanceScore.toLocaleString("ar-SA")}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className="staff-performance-icon-btn"
                    onClick={() => navigate(`/dashboard/staff-performance/${encodeURIComponent(row.employeeId)}`)}
                    title="عرض التفاصيل"
                    aria-label={`عرض تفاصيل ${row.employeeName}`}
                  >
                    <FiEye />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !result.rows.length ? (
          <p className="staff-performance-empty">لا توجد بيانات في الفترة المحددة.</p>
        ) : null}
      </section>

      {selectedRow ? (
        <section className="staff-performance-detail" aria-label="تفاصيل أداء الموظفة">
          <div className="staff-performance-detail__head">
            <div>
              <span>تفاصيل الموظفة</span>
              <h2>{selectedRow.employeeName}</h2>
            </div>
            <button
              type="button"
              onClick={() => {
                setEmployeeFilter("");
                navigate("/dashboard/staff-performance");
              }}
            >
              إغلاق التفاصيل
            </button>
          </div>

          <div className="staff-performance-detail-grid">
            <article>
              <small>متوسط قيمة الخدمة</small>
              <strong>{formatNullableSar(selectedRow.averageServiceValueHalalas)}</strong>
            </article>
            <article>
              <small>متوسط قيمة الحجز</small>
              <strong>{formatNullableSar(selectedRow.averageBookingValueHalalas)}</strong>
            </article>
            <article>
              <small>الإلغاءات / no-show</small>
              <strong>{selectedRow.cancellations.toLocaleString("ar-SA")} / {selectedRow.noShows.toLocaleString("ar-SA")}</strong>
            </article>
            <article>
              <small>التقييمات</small>
              <strong>{formatRating(selectedRow)}</strong>
            </article>
          </div>

          <div className="staff-performance-detail-columns">
            <section>
              <h3>الحجوزات المكتملة</h3>
              {selectedRow.bookingDetails.length ? (
                <div className="staff-performance-bookings">
                  {selectedRow.bookingDetails.map((booking) => (
                    <article key={booking.id}>
                      <div>
                        <strong>{booking.publicId}</strong>
                        <small>{booking.date} - {booking.clientName}</small>
                      </div>
                      <span>{booking.serviceCount.toLocaleString("ar-SA")} خدمة</span>
                      <b>{formatSar(booking.revenueHalalas)}</b>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="staff-performance-empty">لا توجد حجوزات مكتملة لهذه الفترة.</p>
              )}
            </section>

            <section>
              <h3>أكثر الخدمات تنفيذًا</h3>
              {selectedRow.topServices.length ? (
                <div className="staff-performance-services">
                  {selectedRow.topServices.slice(0, 6).map((service) => (
                    <article key={service.serviceId}>
                      <span>{service.serviceName}</span>
                      <strong>{service.count.toLocaleString("ar-SA")}</strong>
                      <small>{formatSar(service.revenueHalalas)}</small>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="staff-performance-empty">لا توجد خدمات منفذة في الفترة.</p>
              )}
            </section>

            <section>
              <h3>الحضور والانضباط</h3>
              <dl className="staff-performance-attendance">
                <div><dt>أيام الحضور</dt><dd>{selectedRow.attendance.attendanceDays.toLocaleString("ar-SA")}</dd></div>
                <div><dt>التأخير</dt><dd>{formatAttendanceHours(selectedRow.attendance.totalLateHours)}</dd></div>
                <div><dt>نقص الساعات</dt><dd>{formatAttendanceHours(selectedRow.attendance.totalMissingHours)}</dd></div>
                <div><dt>الساعات الزائدة</dt><dd>{formatAttendanceHours(selectedRow.attendance.totalExtraHours)}</dd></div>
                <div><dt>نسبة الالتزام</dt><dd>{formatPercent(selectedRow.attendance.commitmentPercent)}</dd></div>
              </dl>
              {!selectedRow.attendance.available ? (
                <p className="staff-performance-note">{selectedRow.attendance.note || "لا توجد بيانات حضور كافية لحساب الالتزام"}</p>
              ) : null}
            </section>

            <section>
              <h3>ملاحظات البيانات</h3>
              {[...selectedRow.dataWarnings, ...selectedRow.scoreNotes].length ? (
                <ul className="staff-performance-notes">
                  {Array.from(new Set([...selectedRow.dataWarnings, ...selectedRow.scoreNotes])).map((warning) => (
                    <li key={warning}><FiAlertTriangle />{warning}</li>
                  ))}
                </ul>
              ) : (
                <p className="staff-performance-empty">لا توجد ملاحظات بيانات ناقصة.</p>
              )}
            </section>
          </div>
        </section>
      ) : null}

      {loading ? <div className="staff-performance-loading"><FiRefreshCw className="is-spinning" /> جاري تحميل مؤشرات الأداء...</div> : null}
      {!result.summary.ratingAvailable ? <p className="staff-performance-note"><FiStar /> التقييمات غير متوفرة في بيانات الحجوزات الحالية.</p> : null}
    </div>
  );
}
