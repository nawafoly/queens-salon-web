import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faCalendarAlt,
  faChartLine,
  faCircleCheck,
  faClock,
  faMoneyBillWave,
  faUsers,
  faWallet,
} from "@fortawesome/free-solid-svg-icons";
import { useMemo, type ReactNode } from "react";
import {
  DashboardDatePickerV2,
  DashboardEmptyStateV2,
  DashboardFieldV2,
} from "../../components/dashboard-v2";
import type { Booking, BookingStatus } from "../../helpers/dashboardService";
import {
  formatLocalDateISO,
  weekdayKeyFromISODate,
  type DashboardWeekdayKey,
} from "../../helpers/dashboardDateUtils";
import { formatTime12 } from "../../helpers/pageSharedUtils";
import { timeToMinutes } from "../../helpers/timeContract";
import { formatFinanceTransactionTitle } from "../../helpers/financeDisplay";

type BusinessHoursDay = {
  enabled?: boolean;
  start?: string;
  end?: string;
};

type BusinessHoursMap = Partial<
  Record<DashboardWeekdayKey, BusinessHoursDay>
>;

type DashboardOverviewFinanceTransaction = {
  id: string;
  type: "income" | "expense";
  title: string;
  amount: number;
  date: string;
  createdAt: number;
};

export type DashboardOverviewV2Props = {
  userInfo: { name?: string } | null;
  stats: {
    todayBookings: number;
    todayRevenue: number;
    completedBookings: number;
    busyEmployees: number;
  };
  scheduleBookings: Booking[];
  selectedScheduleDate: string;
  onSelectedScheduleDateChange: (nextDate: string) => void;
  businessHours?: BusinessHoursMap;
  onOpenBooking: (booking: Booking) => void;
  onQuickAction: (key: "newBooking" | "bookings" | "reports") => void;
  financial: {
    income: number;
    expenses: number;
    profit: number;
  };
  financeAccess: {
    income: boolean;
    expenses: boolean;
  };
  financeToday: {
    income: number;
    expenses: number;
    net: number;
  };
  recentFinanceTransactions: DashboardOverviewFinanceTransaction[];
};

const STATUS_LABELS: Record<BookingStatus, string> = {
  confirmed: "مؤكد",
  pending: "في الانتظار",
  cancelled: "ملغي",
  completed: "مكتمل",
};

const STATUS_TONES: Record<BookingStatus, string> = {
  confirmed: "dsv2-badge--gold",
  pending: "",
  cancelled: "dsv2-badge--danger",
  completed: "dsv2-badge--success",
};

function formatFinanceDate(value: string): string {
  const normalized = String(value || "").trim();
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return normalized || "-";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatHourLabel(hour: number): string {
  const normalized = ((hour % 24) + 24) % 24;
  return formatTime12(`${String(normalized).padStart(2, "0")}:00`);
}

function MetricIcon({ children }: { children: ReactNode }) {
  return <span className="overview-v2-metric__icon">{children}</span>;
}

export default function DashboardOverviewV2({
  userInfo,
  stats,
  scheduleBookings,
  selectedScheduleDate,
  onSelectedScheduleDateChange,
  businessHours,
  onOpenBooking,
  onQuickAction,
  financial,
  financeAccess,
  financeToday,
  recentFinanceTransactions,
}: DashboardOverviewV2Props) {
  const todayISO = useMemo(() => formatLocalDateISO(new Date()), []);

  const hourRows = useMemo(() => {
    const bookingByHour = new Map<number, Booking[]>();

    const sorted = (scheduleBookings || [])
      .map((booking) => ({
        booking,
        minute: timeToMinutes(booking.time),
      }))
      .filter(
        (item): item is { booking: Booking; minute: number } =>
          item.minute !== null,
      )
      .sort((a, b) => a.minute - b.minute);

    sorted.forEach(({ booking, minute }) => {
      const hour = Math.floor(minute / 60);
      const rows = bookingByHour.get(hour) || [];
      rows.push(booking);
      bookingByHour.set(hour, rows);
    });

    return Array.from(bookingByHour.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([hour, bookings]) => ({ hour, bookings }));
  }, [scheduleBookings]);

  const scheduleHint = useMemo(() => {
    const weekday = weekdayKeyFromISODate(selectedScheduleDate);
    const dayHours = weekday ? businessHours?.[weekday] : undefined;

    if (dayHours?.enabled === false) {
      return "اليوم المختار مغلق حسب إعدادات ساعات العمل";
    }

    const start = String(dayHours?.start || "").trim();
    const end = String(dayHours?.end || "").trim();

    if (start && end) {
      return `ساعات العمل: ${formatTime12(start)} - ${formatTime12(end)}`;
    }

    return "اختاري التاريخ ثم اضغطي على الحجز لعرض تفاصيله";
  }, [businessHours, selectedScheduleDate]);

  const displayName = String(userInfo?.name || "مستخدم").trim() || "مستخدم";

  return (
    <main className="dsv2-page overview-v2-page" aria-labelledby="overview-v2-title">
      <section className="dsv2-card dsv2-card--padded dsv2-card--elevated overview-v2-hero">
        <div className="overview-v2-hero__content">
          <span className="dsv2-badge dsv2-badge--gold">لوحة التشغيل اليومية</span>
          <h1 id="overview-v2-title" className="dsv2-page-title">
            مرحبًا بك، {displayName}
          </h1>
          <p className="dsv2-page-subtitle">
            متابعة موحدة للحجوزات والإيرادات والتشغيل اليومي من مصدر واحد واضح.
          </p>
        </div>

        <div className="overview-v2-live" role="status" aria-live="polite">
          <span className="overview-v2-live__icon" aria-hidden="true">
            <FontAwesomeIcon icon={faCircleCheck} />
          </span>
          <div>
            <strong>البيانات متصلة</strong>
            <span>تتحدث مع نشاط لوحة التحكم</span>
          </div>
        </div>
      </section>

      <section className="overview-v2-section" aria-labelledby="overview-v2-performance">
        <div className="dsv2-section-head overview-v2-section__head">
          <div>
            <h2 id="overview-v2-performance" className="dsv2-section-title">
              أداء الصالون اليوم
            </h2>
            <p className="dsv2-section-caption">
              المؤشرات التشغيلية الأساسية بدون خلطها مع إجماليات الفترات المالية.
            </p>
          </div>
        </div>

        <div className="dsv2-grid--metrics overview-v2-metrics">
          <button
            type="button"
            className="dsv2-metric-card dsv2-metric-card--gold overview-v2-metric overview-v2-metric--interactive"
            onClick={() => onQuickAction("bookings")}
          >
            <MetricIcon>
              <FontAwesomeIcon icon={faCalendarAlt} />
            </MetricIcon>
            <span className="dsv2-metric-card__label">حجوزات اليوم</span>
            <strong className="dsv2-metric-card__value">
              {stats.todayBookings.toLocaleString("ar-SA")}
            </strong>
            <span className="dsv2-metric-card__meta">فتح قائمة الحجوزات</span>
          </button>

          <button
            type="button"
            className="dsv2-metric-card dsv2-metric-card--success overview-v2-metric overview-v2-metric--interactive"
            onClick={() => onQuickAction("reports")}
          >
            <MetricIcon>
              <FontAwesomeIcon icon={faChartLine} />
            </MetricIcon>
            <span className="dsv2-metric-card__label">إيرادات اليوم</span>
            <strong className="dsv2-metric-card__value">
              {financeAccess.income
                ? `${stats.todayRevenue.toLocaleString("ar-SA")} ر.س`
                : "غير متاح"}
            </strong>
            <span className="dsv2-metric-card__meta">
              {financeAccess.income ? "فتح التقارير" : "تتطلب صلاحية الإيرادات"}
            </span>
          </button>

          <button
            type="button"
            className="dsv2-metric-card dsv2-metric-card--dark overview-v2-metric overview-v2-metric--interactive"
            onClick={() => onQuickAction("bookings")}
          >
            <MetricIcon>
              <FontAwesomeIcon icon={faClock} />
            </MetricIcon>
            <span className="dsv2-metric-card__label">الحجوزات المكتملة</span>
            <strong className="dsv2-metric-card__value">
              {stats.completedBookings.toLocaleString("ar-SA")}
            </strong>
            <span className="dsv2-metric-card__meta">المكتملة في تاريخ اليوم</span>
          </button>

          <article className="dsv2-metric-card dsv2-metric-card--danger overview-v2-metric">
            <MetricIcon>
              <FontAwesomeIcon icon={faUsers} />
            </MetricIcon>
            <span className="dsv2-metric-card__label">موظفات مرتبطات بحجوزات</span>
            <strong className="dsv2-metric-card__value">
              {stats.busyEmployees.toLocaleString("ar-SA")}
            </strong>
            <span className="dsv2-metric-card__meta">عدد فريد حسب حجوزات اليوم</span>
          </article>
        </div>
      </section>

      <section className="overview-v2-section" aria-labelledby="overview-v2-finance">
        <div className="dsv2-section-head overview-v2-section__head">
          <div>
            <h2 id="overview-v2-finance" className="dsv2-section-title">
              الملخص المالي المسجل
            </h2>
            <p className="dsv2-section-caption">
              إجمالي الدخل والمصروفات وصافي الربح للفترة التي يعتمدها النظام.
            </p>
          </div>
        </div>

        <div className="dsv2-grid--3 overview-v2-finance-metrics">
          <article className="dsv2-metric-card dsv2-metric-card--success overview-v2-metric">
            <MetricIcon>
              <FontAwesomeIcon icon={faWallet} />
            </MetricIcon>
            <span className="dsv2-metric-card__label">إجمالي الدخل</span>
            <strong className="dsv2-metric-card__value">
{financeAccess.income
                ? `${financial.income.toLocaleString("ar-SA")} ر.س`
                : "غير متاح"}
            </strong>
          </article>

          <article className="dsv2-metric-card dsv2-metric-card--danger overview-v2-metric">
            <MetricIcon>
              <FontAwesomeIcon icon={faMoneyBillWave} />
            </MetricIcon>
            <span className="dsv2-metric-card__label">إجمالي المصروفات</span>
            <strong className="dsv2-metric-card__value">
{financeAccess.expenses
                ? `${financial.expenses.toLocaleString("ar-SA")} ر.س`
                : "غير متاح"}
            </strong>
          </article>

          <article
            className={`dsv2-metric-card overview-v2-metric ${
              financial.profit >= 0
                ? "dsv2-metric-card--success"
                : "dsv2-metric-card--danger"
            }`}
          >
            <MetricIcon>
              <FontAwesomeIcon icon={faChartLine} />
            </MetricIcon>
            <span className="dsv2-metric-card__label">صافي الربح</span>
            <strong className="dsv2-metric-card__value">
{financeAccess.income && financeAccess.expenses
                ? `${financial.profit.toLocaleString("ar-SA")} ر.س`
                : "غير متاح"}
            </strong>
          </article>
        </div>
      </section>

      <section className="overview-v2-section" aria-labelledby="overview-v2-operations">
        <div className="dsv2-section-head overview-v2-section__head">
          <div>
            <h2 id="overview-v2-operations" className="dsv2-section-title">
              التشغيل اليومي
            </h2>
            <p className="dsv2-section-caption">
              الجدول الزمني للحجوزات مع ملخص اليوم وآخر العمليات المالية.
            </p>
          </div>
        </div>

        <div className="overview-v2-operation-grid">
          <section className="dsv2-card dsv2-table-card overview-v2-schedule-card">
            <header className="overview-v2-card-head overview-v2-schedule-head">
              <div>
                <h3 className="dsv2-section-title">جدول الحجوزات حسب الساعة</h3>
                <p className="dsv2-section-caption">{scheduleHint}</p>
              </div>

              <DashboardFieldV2
                id="overview-v2-schedule-date"
                label="تاريخ الجدول"
                className="overview-v2-date-field"
              >
                <DashboardDatePickerV2
                  id="overview-v2-schedule-date"
                  value={selectedScheduleDate}
                  clearable={false}
                  onChange={(value) =>
                    onSelectedScheduleDateChange(value || todayISO)
                  }
                />
              </DashboardFieldV2>
            </header>

            {hourRows.length === 0 ? (
              <div className="overview-v2-empty-wrap">
                <DashboardEmptyStateV2
                  compact
                  tone="gold"
                  title="لا توجد حجوزات في التاريخ المحدد"
                  description="اختاري تاريخًا آخر أو أضيفي حجزًا جديدًا من الإجراءات السريعة."
                  action={
                    <button
                      type="button"
                      className="dsv2-btn dsv2-btn--primary dsv2-btn--sm"
                      onClick={() => onQuickAction("newBooking")}
                    >
                      إضافة حجز
                    </button>
                  }
                />
              </div>
            ) : (
              <>
                <div className="dsv2-table-scroll overview-v2-desktop-schedule">
                  <table className="dsv2-table overview-v2-table">
                    <thead>
                      <tr>
                        <th>الساعة</th>
                        <th>الحجوزات داخل الساعة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hourRows.map((row) => (
                        <tr key={`hour-${row.hour}`}>
                          <td className="overview-v2-hour-cell">
                            {formatHourLabel(row.hour)}
                          </td>
                          <td>
                            <div className="overview-v2-booking-list">
                              {row.bookings.map((booking) => (
                                <button
                                  key={`${row.hour}-${booking.id}`}
                                  type="button"
                                  className="overview-v2-booking"
                                  onClick={() => onOpenBooking(booking)}
                                >
                                  <span className="overview-v2-booking__main">
                                    <strong>{booking.customerName}</strong>
                                    <small>
                                      {booking.serviceName || booking.serviceId || "-"}
                                    </small>
                                  </span>
                                  <span className="overview-v2-booking__time">
                                    {formatTime12(booking.time)}
                                  </span>
                                  <span
                                    className={`dsv2-badge ${STATUS_TONES[booking.status]}`}
                                  >
                                    {STATUS_LABELS[booking.status]}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="overview-v2-mobile-schedule">
                  {hourRows.map((row) => (
                    <article className="overview-v2-hour-card" key={`mobile-${row.hour}`}>
                      <header>{formatHourLabel(row.hour)}</header>
                      <div>
                        {row.bookings.map((booking) => (
                          <button
                            key={`mobile-${row.hour}-${booking.id}`}
                            type="button"
                            className="overview-v2-mobile-booking"
                            onClick={() => onOpenBooking(booking)}
                          >
                            <span>
                              <strong>{booking.customerName}</strong>
                              <small>
                                {booking.serviceName || booking.serviceId || "-"}
                              </small>
                            </span>
                            <span>
                              <bdi dir="ltr">{formatTime12(booking.time)}</bdi>
                              <span
                                className={`dsv2-badge ${STATUS_TONES[booking.status]}`}
                              >
                                {STATUS_LABELS[booking.status]}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>

          <aside className="overview-v2-side-stack">
            <section className="dsv2-card dsv2-card--padded overview-v2-summary-card">
              <div className="overview-v2-card-head">
                <div>
                  <h3 className="dsv2-section-title">ملخص اليوم</h3>
                  <p className="dsv2-section-caption">الحركة المسجلة في تاريخ اليوم.</p>
                </div>
              </div>

              <dl className="overview-v2-summary-list">
                <div>
                  <dt>دخل اليوم</dt>
                  <dd data-tone="success">
{financeAccess.income
                      ? `${financeToday.income.toLocaleString("ar-SA")} ر.س`
                      : "غير متاح"}
                  </dd>
                </div>
                <div>
                  <dt>مصروف اليوم</dt>
                  <dd data-tone="danger">
{financeAccess.expenses
                      ? `${financeToday.expenses.toLocaleString("ar-SA")} ر.س`
                      : "غير متاح"}
                  </dd>
                </div>
                <div className="overview-v2-summary-list__net">
                  <dt>الصافي</dt>
                  <dd data-tone={financeToday.net >= 0 ? "success" : "danger"}>
{financeAccess.income && financeAccess.expenses
                      ? `${financeToday.net.toLocaleString("ar-SA")} ر.س`
                      : "غير متاح"}
                  </dd>
                </div>
              </dl>
            </section>


          </aside>

          <section className="dsv2-card overview-v2-recent-card">
            <header className="overview-v2-card-head overview-v2-card-head--padded">
              <div>
                <h3 className="dsv2-section-title">آخر العمليات</h3>
                <p className="dsv2-section-caption">أحدث الحركات المالية المسجلة.</p>
              </div>
            </header>

            {!financeAccess.income && !financeAccess.expenses ? (
              <div className="overview-v2-recent-empty">
                لا تملك صلاحية عرض العمليات المالية
              </div>
            ) : recentFinanceTransactions.length === 0 ? (
              <div className="overview-v2-recent-empty">لا توجد عمليات حديثة</div>
            ) : (
              <div className="overview-v2-recent-list">
                {recentFinanceTransactions.map((transaction) => (
                  <article className="overview-v2-recent-item" key={transaction.id}>
                    <div>
                      <strong title={formatFinanceTransactionTitle(transaction.title)}>
                        <bdi dir="auto">
                          {formatFinanceTransactionTitle(transaction.title)}
                        </bdi>
                      </strong>
                      <span>{formatFinanceDate(transaction.date)}</span>
                    </div>
                    <b data-tone={transaction.type === "income" ? "success" : "danger"}>
                      {transaction.type === "income" ? "+" : "-"}
                      {Math.abs(transaction.amount).toLocaleString("ar-SA")} ر.س
                    </b>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="overview-v2-section overview-v2-actions-panel" aria-labelledby="overview-v2-actions">
            <div className="dsv2-section-head overview-v2-section__head">
              <div>
                <h2 id="overview-v2-actions" className="dsv2-section-title">
                  إجراءات سريعة
                </h2>
                <p className="dsv2-section-caption">
                  انتقال مباشر إلى المهام الأكثر استخدامًا داخل لوحة الإدارة.
                </p>
              </div>
            </div>

            <div className="overview-v2-actions-grid">
              <article className="dsv2-card dsv2-card--padded overview-v2-action-card">
                <span className="overview-v2-action-card__icon">
                  <FontAwesomeIcon icon={faCalendarAlt} />
                </span>
                <div>
                  <h3>حجز جديد</h3>
                  <p>إنشاء حجز للعميلة وإسناده إلى الموظفة والخدمة المناسبة.</p>
                </div>
                <button
                  type="button"
                  className="dsv2-btn dsv2-btn--primary dsv2-btn--sm"
                  onClick={() => onQuickAction("newBooking")}
                >
                  إضافة حجز
                  <FontAwesomeIcon icon={faArrowLeft} />
                </button>
              </article>

              <article className="dsv2-card dsv2-card--padded overview-v2-action-card">
                <span className="overview-v2-action-card__icon">
                  <FontAwesomeIcon icon={faUsers} />
                </span>
                <div>
                  <h3>إدارة الحجوزات</h3>
                  <p>مراجعة الحالات والمواعيد والتعديلات ضمن مساحة الحجوزات.</p>
                </div>
                <button
                  type="button"
                  className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm"
                  onClick={() => onQuickAction("bookings")}
                >
                  فتح الحجوزات
                  <FontAwesomeIcon icon={faArrowLeft} />
                </button>
              </article>

              <article className="dsv2-card dsv2-card--padded overview-v2-action-card">
                <span className="overview-v2-action-card__icon">
                  <FontAwesomeIcon icon={faChartLine} />
                </span>
                <div>
                  <h3>التقارير</h3>
                  <p>فتح تقارير الأداء والإيرادات والمصروفات للفترة المطلوبة.</p>
                </div>
                <button
                  type="button"
                  className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm"
                  onClick={() => onQuickAction("reports")}
                >
                  فتح التقارير
                  <FontAwesomeIcon icon={faArrowLeft} />
                </button>
              </article>
            </div>
          </section>
        </div>
      </section>


    </main>
  );
}
