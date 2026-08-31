import DashboardNumberInputV2 from "../components/dashboard-v2/DashboardNumberInputV2";
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
import {
  DashboardDatePickerV2,
  DashboardSelectV2,
} from "../components/dashboard-v2";
import { formatAttendanceHours } from "../helpers/hr/attendanceDiscipline";
import type { StaffPerformanceResult, StaffPerformanceRow } from "../helpers/hr/staffPerformance";
import {
  exportStaffPerformanceReportExcel,
  exportStaffPerformanceReportPdf,
} from "../helpers/reports/exportStaffPerformanceReport";
import { StaffPerformanceService } from "../services/StaffPerformanceService";

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

const monthOptions = Array.from({ length: 12 }, (_, index) => {
  const value = String(index + 1);
  return { value, label: (index + 1).toLocaleString("ar-SA-u-nu-latn") };
});

const bookingStatusOptions = [
  { value: "completed", label: "المكتملة فقط" },
  { value: "all", label: "كل الحالات للتحليل" },
];

function currentYearMonth() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function formatSar(value: number) {
  return `${(Number(value || 0) / 100).toLocaleString("ar-SA-u-nu-latn", {
    maximumFractionDigits: 2,
  })} ر.س`;
}

function formatNullableSar(value: number | null) {
  return value == null ? "غير متوفر" : formatSar(value);
}

function formatRating(row: StaffPerformanceRow) {
  return row.averageRating == null
    ? "غير متوفر"
    : `${row.averageRating.toLocaleString("ar-SA-u-nu-latn", { maximumFractionDigits: 2 })} (${row.ratingCount})`;
}

function formatPercent(value: number | null) {
  return value == null ? "غير متوفر" : `${Math.round(value).toLocaleString("ar-SA-u-nu-latn")}%`;
}

function scoreTone(score: number) {
  if (score >= 80) return "dsv2-staff-performance-score--strong";
  if (score >= 55) return "dsv2-staff-performance-score--steady";
  return "dsv2-staff-performance-score--low";
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

  const employeeSelectOptions = useMemo(
    () => [
      { value: "", label: "كل الموظفات" },
      ...employeeOptions.map(([id, name]) => ({ value: id, label: name })),
    ],
    [employeeOptions]
  );

  const statsCards = [
    {
      label: "الحجوزات المكتملة",
      value: result.summary.totalCompletedBookings.toLocaleString("ar-SA-u-nu-latn"),
      icon: FiCalendar,
      tone: "dsv2-metric-card--gold",
    },
    {
      label: "الإيراد المنسوب",
      value: formatSar(result.summary.totalAttributedRevenueHalalas),
      icon: FiDollarSign,
      tone: "dsv2-metric-card--success",
    },
    {
      label: "الموظفات النشطات",
      value: result.summary.activeEmployees.toLocaleString("ar-SA-u-nu-latn"),
      icon: FiUsers,
      tone: "dsv2-metric-card--dark",
    },
    {
      label: "متوسط درجة الأداء",
      value: `${result.summary.averagePerformanceScore.toLocaleString("ar-SA-u-nu-latn")}/100`,
      icon: FiBarChart2,
      tone: "dsv2-metric-card--danger",
    },
  ];

  return (
    <main className="dsv2-page dsv2-staff-performance-page" dir="rtl">
      <header className="dsv2-page-head dsv2-staff-performance-page-head">
        <div>
          <p className="dsv2-staff-performance-eyebrow">تحليل تشغيلي</p>
          <h1 className="dsv2-page-title">أداء الموظفات</h1>
          <p className="dsv2-page-subtitle">تحليل أداء الموظفات حسب الحجوزات المكتملة والحضور والإيرادات.</p>
        </div>
        <div className="dsv2-staff-performance-actions">
          <button
            type="button"
            className="dsv2-btn dsv2-btn--primary"
            onClick={() => void load()}
            disabled={loading}
          >
            <FiRefreshCw className={loading ? "dsv2-staff-performance-spin" : ""} />
            {loading ? "جار التحديث" : "تحديث"}
          </button>
        </div>
      </header>

      <section className="dsv2-card dsv2-card--padded dsv2-staff-performance-toolbar" aria-label="فلاتر أداء الموظفات">
        <label className="dsv2-field">
          <span className="dsv2-field__label">السنة</span>
          <DashboardNumberInputV2
            className="dsv2-input"
            value={year}
            min={2020}
            max={2100}
            onChange={(event) => applyMonth(Number(event.target.value), month)}
          />
        </label>
        <label className="dsv2-field">
          <span className="dsv2-field__label">الشهر</span>
          <DashboardSelectV2
            value={String(month)}
            options={monthOptions}
            onChange={(value) => applyMonth(year, Number(value))}
          />
        </label>
        <label className="dsv2-field">
          <span className="dsv2-field__label">من تاريخ</span>
          <DashboardDatePickerV2 value={fromDate} clearable={false} onChange={setFromDate} />
        </label>
        <label className="dsv2-field">
          <span className="dsv2-field__label">إلى تاريخ</span>
          <DashboardDatePickerV2 value={toDate} clearable={false} onChange={setToDate} />
        </label>
        <label className="dsv2-field">
          <span className="dsv2-field__label">الموظفة</span>
          <DashboardSelectV2
            value={employeeFilter}
            options={employeeSelectOptions}
            onChange={(next) => {
              setEmployeeFilter(next);
              if (routeEmployeeId) navigate(next ? `/dashboard/staff-performance/${encodeURIComponent(next)}` : "/dashboard/staff-performance");
            }}
          />
        </label>
        <label className="dsv2-field">
          <span className="dsv2-field__label">حالة الحجز</span>
          <DashboardSelectV2
            value={bookingStatus}
            options={bookingStatusOptions}
            onChange={(value) => setBookingStatus(value as "completed" | "all")}
          />
        </label>
        <div className="dsv2-staff-performance-export-actions" aria-label="تصدير تقرير أداء الموظفات">
          <button
            type="button"
            className="dsv2-btn dsv2-btn--secondary"
            onClick={handleExportPerformancePdf}
            disabled={loading}
          >
            <FiFileText /> تصدير PDF
          </button>
          <button
            type="button"
            className="dsv2-btn dsv2-btn--secondary"
            onClick={handleExportPerformanceExcel}
            disabled={loading}
          >
            <FiDownload /> تصدير Excel
          </button>
        </div>
      </section>

      {error ? (
        <div className="dsv2-staff-performance-alert dsv2-staff-performance-alert--error" role="alert">
          <FiAlertTriangle />{error}
        </div>
      ) : null}
      {result.warnings.length ? (
        <div className="dsv2-staff-performance-alert" role="status">
          <FiAlertTriangle />
          <div>{result.warnings.map((warning) => <span key={warning}>{warning}</span>)}</div>
        </div>
      ) : null}

      <section className="dsv2-grid--metrics dsv2-staff-performance-stats" aria-label="ملخص أداء الموظفات">
        {statsCards.map((card) => {
          const Icon = card.icon;
          return (
            <article key={card.label} className={`dsv2-metric-card ${card.tone} dsv2-staff-performance-metric`}>
              <span className="dsv2-metric-card__icon"><Icon /></span>
              <div>
                <p className="dsv2-metric-card__label">{card.label}</p>
                <p className="dsv2-metric-card__value">
                  {loading && !result.rows.length ? <span className="dsv2-skeleton dsv2-staff-performance-skeleton-value" /> : card.value}
                </p>
              </div>
            </article>
          );
        })}
      </section>

      <section className="dsv2-table-card dsv2-staff-performance-table-card" aria-label="جدول أداء الموظفات">
        <div className="dsv2-table-scroll">
          <table className="dsv2-table dsv2-staff-performance-table">
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
              {loading && !result.rows.length ? (
                <tr>
                  <td colSpan={10} className="dsv2-staff-performance-empty-cell">
                    <span className="dsv2-skeleton dsv2-skeleton--title" />
                    <span className="dsv2-skeleton" />
                    <span className="dsv2-sr-only">جاري تحميل مؤشرات الأداء...</span>
                  </td>
                </tr>
              ) : result.rows.map((row) => (
                <tr key={row.employeeId}>
                  <td data-label="الموظفة">
                    <span className="dsv2-table__primary">{row.employeeName}</span>
                    <span className="dsv2-table__secondary" dir="ltr">{row.employeeId}</span>
                  </td>
                  <td data-label="الحالة/القسم">
                    <span className={`dsv2-badge ${row.active ? "dsv2-badge--success" : ""}`}>
                      {row.active ? "نشطة" : "غير نشطة"}
                    </span>
                    <span className="dsv2-table__secondary">{row.department || row.jobTitle || "غير محدد"}</span>
                  </td>
                  <td data-label="الحجوزات المكتملة">{row.completedBookings.toLocaleString("ar-SA-u-nu-latn")}</td>
                  <td data-label="العميلات المخدومات">{row.uniqueClients.toLocaleString("ar-SA-u-nu-latn")}</td>
                  <td data-label="الخدمات المنفذة">{row.servicesPerformed.toLocaleString("ar-SA-u-nu-latn")}</td>
                  <td data-label="الإيراد المنسوب">{formatSar(row.attributedRevenueHalalas)}</td>
                  <td data-label="متوسط التقييم">{formatRating(row)}</td>
                  <td data-label="الالتزام بالحضور">{formatPercent(row.attendance.commitmentPercent)}</td>
                  <td data-label="درجة الأداء">
                    <span className={`dsv2-staff-performance-score ${scoreTone(row.performanceScore)}`}>
                      {row.performanceScore.toLocaleString("ar-SA-u-nu-latn")}
                    </span>
                  </td>
                  <td data-label="الإجراءات">
                    <button
                      type="button"
                      className="dsv2-icon-btn"
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
        </div>
        {!loading && !result.rows.length ? (
          <p className="dsv2-staff-performance-empty">لا توجد بيانات في الفترة المحددة.</p>
        ) : null}
      </section>

      {selectedRow ? (
        <section className="dsv2-card dsv2-card--padded dsv2-staff-performance-detail" aria-label="تفاصيل أداء الموظفة">
          <div className="dsv2-section-head dsv2-staff-performance-detail__head">
            <div>
              <p className="dsv2-staff-performance-eyebrow">تفاصيل الموظفة</p>
              <h2 className="dsv2-section-title">{selectedRow.employeeName}</h2>
            </div>
            <button
              type="button"
              className="dsv2-btn dsv2-btn--secondary"
              onClick={() => {
                setEmployeeFilter("");
                navigate("/dashboard/staff-performance");
              }}
            >
              إغلاق التفاصيل
            </button>
          </div>

          <div className="dsv2-staff-performance-detail-grid">
            <article className="dsv2-card dsv2-card--padded">
              <span>متوسط قيمة الخدمة</span>
              <strong>{formatNullableSar(selectedRow.averageServiceValueHalalas)}</strong>
            </article>
            <article className="dsv2-card dsv2-card--padded">
              <span>متوسط قيمة الحجز</span>
              <strong>{formatNullableSar(selectedRow.averageBookingValueHalalas)}</strong>
            </article>
            <article className="dsv2-card dsv2-card--padded">
              <span>الإلغاءات / no-show</span>
              <strong>{selectedRow.cancellations.toLocaleString("ar-SA-u-nu-latn")} / {selectedRow.noShows.toLocaleString("ar-SA-u-nu-latn")}</strong>
            </article>
            <article className="dsv2-card dsv2-card--padded">
              <span>التقييمات</span>
              <strong>{formatRating(selectedRow)}</strong>
            </article>
          </div>

          <div className="dsv2-staff-performance-detail-columns">
            <section className="dsv2-card dsv2-card--padded">
              <h3 className="dsv2-section-title">الحجوزات المكتملة</h3>
              {selectedRow.bookingDetails.length ? (
                <div className="dsv2-staff-performance-bookings">
                  {selectedRow.bookingDetails.map((booking) => (
                    <article key={booking.id}>
                      <div>
                        <strong>{booking.publicId}</strong>
                        <small>{booking.date}، {booking.clientName}</small>
                      </div>
                      <span>{booking.serviceCount.toLocaleString("ar-SA-u-nu-latn")} خدمة</span>
                      <b>{formatSar(booking.revenueHalalas)}</b>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="dsv2-staff-performance-empty">لا توجد حجوزات مكتملة لهذه الفترة.</p>
              )}
            </section>

            <section className="dsv2-card dsv2-card--padded">
              <h3 className="dsv2-section-title">أكثر الخدمات تنفيذًا</h3>
              {selectedRow.topServices.length ? (
                <div className="dsv2-staff-performance-services">
                  {selectedRow.topServices.slice(0, 6).map((service) => (
                    <article key={service.serviceId}>
                      <span>{service.serviceName}</span>
                      <strong>{service.count.toLocaleString("ar-SA-u-nu-latn")}</strong>
                      <small>{formatSar(service.revenueHalalas)}</small>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="dsv2-staff-performance-empty">لا توجد خدمات منفذة في الفترة.</p>
              )}
            </section>

            <section className="dsv2-card dsv2-card--padded">
              <h3 className="dsv2-section-title">الحضور والانضباط</h3>
              <dl className="dsv2-staff-performance-attendance">
                <div><dt>أيام الحضور</dt><dd>{selectedRow.attendance.attendanceDays.toLocaleString("ar-SA-u-nu-latn")}</dd></div>
                <div><dt>التأخير</dt><dd>{formatAttendanceHours(selectedRow.attendance.totalLateHours)}</dd></div>
                <div><dt>نقص الساعات</dt><dd>{formatAttendanceHours(selectedRow.attendance.totalMissingHours)}</dd></div>
                <div><dt>الساعات الزائدة</dt><dd>{formatAttendanceHours(selectedRow.attendance.totalExtraHours)}</dd></div>
                <div><dt>نسبة الالتزام</dt><dd>{formatPercent(selectedRow.attendance.commitmentPercent)}</dd></div>
              </dl>
              {!selectedRow.attendance.available ? (
                <p className="dsv2-staff-performance-note">{selectedRow.attendance.note || "لا توجد بيانات حضور كافية لحساب الالتزام"}</p>
              ) : null}
            </section>

            <section className="dsv2-card dsv2-card--padded">
              <h3 className="dsv2-section-title">ملاحظات البيانات</h3>
              {[...selectedRow.dataWarnings, ...selectedRow.scoreNotes].length ? (
                <ul className="dsv2-staff-performance-notes">
                  {Array.from(new Set([...selectedRow.dataWarnings, ...selectedRow.scoreNotes])).map((warning) => (
                    <li key={warning}><FiAlertTriangle />{warning}</li>
                  ))}
                </ul>
              ) : (
                <p className="dsv2-staff-performance-empty">لا توجد ملاحظات بيانات ناقصة.</p>
              )}
            </section>
          </div>
        </section>
      ) : null}

      {loading ? (
        <div className="dsv2-staff-performance-alert" role="status">
          <FiRefreshCw className="dsv2-staff-performance-spin" /> جاري تحميل مؤشرات الأداء...
        </div>
      ) : null}
      {!result.summary.ratingAvailable ? (
        <p className="dsv2-staff-performance-note"><FiStar /> التقييمات غير متوفرة في بيانات الحجوزات الحالية.</p>
      ) : null}
    </main>
  );
}
