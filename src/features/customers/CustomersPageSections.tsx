import type { IconType } from "react-icons";
import {
  FiActivity,
  FiAlertCircle,
  FiBarChart2,
  FiCalendar,
  FiCopy,
  FiDatabase,
  FiDownload,
  FiEye,
  FiFilter,
  FiInbox,
  FiMessageCircle,
  FiPhone,
  FiRefreshCw,
  FiSearch,
  FiStar,
  FiUpload,
  FiUserPlus,
  FiUsers,
  FiX,
} from "react-icons/fi";
import { DashboardSelectV2 } from "../../components/dashboard-v2";
import {
  buildCustomerWhatsAppHref,
  formatCustomerCount,
  formatCustomerLastVisit,
  getCustomerInitials,
  getCustomerSourceDescription,
  getCustomerSourceLabel,
  getCustomerStatusLabel,
  hasCustomerPhone,
  isCustomerActive,
  normalizeCustomerName,
} from "./customerFormatters";
import type {
  CustomerLastVisitFilter,
  CustomerRow,
  CustomerSegment,
  CustomerSort,
  CustomerSource,
  CustomerStats,
} from "./customerTypes";

export function CustomersPageHeader({ visibleCount, totalCount }: { visibleCount: number; totalCount: number }) {
  return (
    <header className="dsv2-page-head dsv2-customers-page-head">
      <div className="dsv2-customers-heading">
        <p className="dsv2-customers-eyebrow">MALIKAT</p>
        <h1 className="dsv2-page-title">إدارة العملاء</h1>
        <p className="dsv2-page-subtitle">ملفات العميلات وحجوزاتهن وبيانات التواصل في مساحة واحدة منظّمة.</p>
      </div>
      <div className="dsv2-card dsv2-card--padded dsv2-customers-summary-card" aria-label="ملخص النتائج">
        <span className="dsv2-customers-summary-icon"><FiDatabase aria-hidden="true" /></span>
        <div>
          <small>المصدر الحالي</small>
          <strong>Core D1</strong>
        </div>
        <b className="dsv2-badge dsv2-badge--gold">{formatCustomerCount(visibleCount)} من {formatCustomerCount(totalCount)}</b>
      </div>
    </header>
  );
}

type ToolbarProps = {
  query: string;
  loading: boolean;
  canImport: boolean;
  canExport: boolean;
  onQueryChange: (value: string) => void;
  onImport: () => void;
  onExport: () => void;
  onRefresh: () => void;
};

export function CustomersSearchToolbar(props: ToolbarProps) {
  return (
    <section className="dsv2-card dsv2-card--padded dsv2-customers-toolbar" aria-label="بحث وأدوات العملاء">
      <label className="dsv2-customers-search-field">
        <FiSearch aria-hidden="true" />
        <input
          className="dsv2-input"
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
          placeholder="ابحثي بالاسم أو رقم الجوال"
          aria-label="البحث باسم العميلة أو رقم الجوال"
        />
        {props.query ? (
          <button
            type="button"
            className="dsv2-icon-btn dsv2-customers-search-clear"
            onClick={() => props.onQueryChange("")}
            title="مسح البحث"
            aria-label="مسح البحث"
          >
            <FiX />
          </button>
        ) : null}
      </label>

      <div className="dsv2-customers-toolbar-actions">
        {props.canImport ? (
          <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={props.onImport} disabled={props.loading}>
            <FiUpload />
            <span>استيراد Excel</span>
          </button>
        ) : null}
        {props.canExport ? (
          <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={props.onExport} disabled={props.loading}>
            <FiDownload />
            <span>تصدير Excel</span>
          </button>
        ) : null}
        <button type="button" className="dsv2-btn dsv2-btn--primary" onClick={props.onRefresh} disabled={props.loading}>
          <FiRefreshCw className={props.loading ? "dsv2-customers-spin" : ""} />
          <span>{props.loading ? "جارٍ التحديث" : "تحديث البيانات"}</span>
        </button>
      </div>
    </section>
  );
}

type FiltersProps = {
  segment: CustomerSegment;
  sort: CustomerSort;
  source: "all" | CustomerSource;
  lastVisit: CustomerLastVisitFilter;
  packagesFilterAvailable: boolean;
  hasActiveFilters: boolean;
  onSegmentChange: (value: CustomerSegment) => void;
  onSortChange: (value: CustomerSort) => void;
  onSourceChange: (value: "all" | CustomerSource) => void;
  onLastVisitChange: (value: CustomerLastVisitFilter) => void;
  onClear: () => void;
};

const segments: Array<{ value: CustomerSegment; label: string }> = [
  { value: "all", label: "جميع العميلات" },
  { value: "vip", label: "VIP" },
  { value: "with-bookings", label: "لديها حجوزات" },
  { value: "without-bookings", label: "بدون حجوزات" },
  { value: "active-packages", label: "لديها باقات نشطة" },
];

const lastVisitOptions: Array<{ value: CustomerLastVisitFilter; label: string }> = [
  { value: "all", label: "كل الزيارات" },
  { value: "30-days", label: "خلال 30 يومًا" },
  { value: "90-days", label: "خلال 90 يومًا" },
  { value: "never", label: "لم تزر بعد" },
];

const sourceOptions: Array<{ value: "all" | CustomerSource; label: string }> = [
  { value: "all", label: "كل المصادر" },
  { value: "combined", label: "ملف موحّد وحجوزات" },
  { value: "client-record", label: "ملف العميلة" },
  { value: "booking-only", label: "سجل الحجوزات" },
];

const sortOptions: Array<{ value: CustomerSort; label: string }> = [
  { value: "latest", label: "الأحدث زيارة" },
  { value: "newest", label: "الأحدث تسجيلًا" },
  { value: "most", label: "الأكثر حجزًا" },
];

export function CustomersFilters(props: FiltersProps) {
  return (
    <section className="dsv2-card dsv2-card--padded dsv2-customers-filters" aria-label="فلاتر العملاء">
      <div className="dsv2-customers-filter-heading">
        <span className="dsv2-customers-filter-icon"><FiFilter /></span>
        <div>
          <strong>تصفية النتائج</strong>
          <small>اختاري شريحة أو رتّبي السجلات للوصول أسرع.</small>
        </div>
      </div>

      <div className="dsv2-customers-filter-chips" role="group" aria-label="شرائح العملاء">
        {segments
          .filter((item) => item.value !== "active-packages" || props.packagesFilterAvailable)
          .map((item) => (
            <button
              key={item.value}
              type="button"
              className={`dsv2-customers-filter-chip ${props.segment === item.value ? "is-active" : ""}`}
              onClick={() => props.onSegmentChange(item.value)}
              aria-pressed={props.segment === item.value}
            >
              {item.label}
            </button>
          ))}
      </div>

      <div className="dsv2-customers-filter-selects">
        <div className="dsv2-field">
          <span className="dsv2-field__label">آخر زيارة</span>
          <DashboardSelectV2
            value={props.lastVisit}
            options={lastVisitOptions}
            onChange={(value) => props.onLastVisitChange(value as CustomerLastVisitFilter)}
          />
        </div>
        <div className="dsv2-field">
          <span className="dsv2-field__label">المصدر</span>
          <DashboardSelectV2
            value={props.source}
            options={sourceOptions}
            onChange={(value) => props.onSourceChange(value as "all" | CustomerSource)}
          />
        </div>
        <div className="dsv2-field">
          <span className="dsv2-field__label">الترتيب</span>
          <DashboardSelectV2
            value={props.sort}
            options={sortOptions}
            onChange={(value) => props.onSortChange(value as CustomerSort)}
          />
        </div>
      </div>

      {props.hasActiveFilters ? (
        <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm dsv2-customers-clear-filters" onClick={props.onClear}>
          <FiX /> مسح الفلاتر
        </button>
      ) : null}
    </section>
  );
}

type StatCardProps = {
  icon: IconType;
  label: string;
  value: string;
  description: string;
  tone: "maroon" | "blue" | "green" | "gold" | "purple" | "slate";
  loading?: boolean;
};

export function CustomerStatsCard(props: StatCardProps) {
  const Icon = props.icon;
  const toneClass: Record<StatCardProps["tone"], string> = {
    maroon: "danger",
    blue: "dark",
    green: "success",
    gold: "gold",
    purple: "gold",
    slate: "dark",
  };
  return (
    <article className={`dsv2-metric-card dsv2-metric-card--${toneClass[props.tone]} dsv2-customers-metric`}>
      <span className="dsv2-metric-card__icon"><Icon /></span>
      <div className="dsv2-customers-metric-copy">
        <p className="dsv2-metric-card__label">{props.label}</p>
        {props.loading ? <span className="dsv2-skeleton dsv2-customers-stat-skeleton" /> : <p className="dsv2-metric-card__value">{props.value}</p>}
        <p className="dsv2-metric-card__meta">{props.description}</p>
      </div>
    </article>
  );
}

export function CustomersStatsGrid({ stats, loading }: { stats: CustomerStats; loading: boolean }) {
  const cards: StatCardProps[] = [
    { icon: FiUsers, label: "إجمالي العملاء", value: formatCustomerCount(stats.totalClients), description: "كل الملفات الفريدة", tone: "maroon" },
    { icon: FiCalendar, label: "إجمالي الحجوزات", value: formatCustomerCount(stats.totalBookings), description: "الحجوزات المرتبطة بالعميلات", tone: "blue" },
    { icon: FiActivity, label: "العملاء النشطون", value: formatCustomerCount(stats.activeClients), description: "حالة الملف نشطة", tone: "green" },
    { icon: FiUserPlus, label: "الجدد هذا الشهر", value: formatCustomerCount(stats.newThisMonth), description: "ملفات أُنشئت خلال الشهر", tone: "purple" },
    { icon: FiStar, label: "عملاء VIP", value: formatCustomerCount(stats.vipClients), description: "العميلات المميزات", tone: "gold" },
    { icon: FiBarChart2, label: "متوسط الحجوزات", value: formatCustomerCount(stats.averageBookings, 1), description: "لكل عميلة", tone: "slate" },
  ];

  return (
    <section className="dsv2-grid--metrics dsv2-customers-stats-grid" aria-label="إحصائيات العملاء">
      {cards.map((card) => <CustomerStatsCard key={card.label} {...card} loading={loading} />)}
    </section>
  );
}

export function CustomerName({ customer }: { customer: CustomerRow }) {
  const name = normalizeCustomerName(customer.name);
  return (
    <div className="dsv2-customers-name-block">
      <span className="dsv2-customers-avatar" aria-hidden="true">{getCustomerInitials(name)}</span>
      <span className="dsv2-customers-name-copy">
        <strong className="dsv2-table__primary">{name}</strong>
        <small className="dsv2-table__secondary">{customer.clientId ? "ملف موحّد" : "من سجل الحجوزات"}</small>
      </span>
    </div>
  );
}

function CustomerBadges({ customer }: { customer: CustomerRow }) {
  return (
    <div className="dsv2-customers-badges">
      <span className={`dsv2-badge ${isCustomerActive(customer.status) ? "dsv2-badge--success" : ""}`}>
        {getCustomerStatusLabel(customer.status)}
      </span>
      <span className={`dsv2-badge ${customer.vip ? "dsv2-badge--gold" : ""}`}>
        {customer.vip ? "VIP" : "عادية"}
      </span>
    </div>
  );
}

type CustomerActionsProps = {
  customer: CustomerRow;
  mobile?: boolean;
  onCopy: (phone: string) => void;
  onOpen: (customer: CustomerRow) => void;
};

export function CustomerActions({ customer, mobile = false, onCopy, onOpen }: CustomerActionsProps) {
  const hasPhone = hasCustomerPhone(customer.phone);
  const whatsappHref = buildCustomerWhatsAppHref(customer.name, customer.phone);
  return (
    <div className={`dsv2-customers-actions ${mobile ? `is-mobile ${hasPhone ? "has-phone" : "has-no-phone"}` : ""}`}>
      {mobile && hasPhone ? (
        <a className="dsv2-icon-btn dsv2-customers-action-btn is-call" href={`tel:${customer.phone}`} title="اتصال" aria-label={`اتصال بـ ${customer.name}`}>
          <FiPhone />
        </a>
      ) : null}
      {hasPhone ? (
        <>
          <button type="button" className="dsv2-icon-btn dsv2-customers-action-btn is-copy" onClick={() => onCopy(customer.phone)} title="نسخ رقم الجوال" aria-label={`نسخ رقم جوال ${customer.name}`}>
            <FiCopy />
          </button>
          <a className="dsv2-icon-btn dsv2-customers-action-btn is-whatsapp" href={whatsappHref} target="_blank" rel="noreferrer" title="فتح واتساب" aria-label={`فتح واتساب مع ${customer.name}`}>
            <FiMessageCircle />
          </a>
        </>
      ) : null}
      <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm dsv2-customers-open-btn" onClick={() => onOpen(customer)} title="عرض ملف العميلة">
        <FiEye /> <span>عرض الملف</span>
      </button>
    </div>
  );
}

type ListProps = {
  customers: CustomerRow[];
  loading: boolean;
  onCopy: (phone: string) => void;
  onOpen: (customer: CustomerRow) => void;
};

function CustomerTableSkeleton() {
  return (
    <tbody aria-label="جارٍ تحميل العملاء">
      {Array.from({ length: 5 }, (_, index) => (
        <tr key={index} className="dsv2-customers-table-skeleton-row">
          {Array.from({ length: 8 }, (__, cell) => <td key={cell}><span className="dsv2-skeleton" /></td>)}
        </tr>
      ))}
    </tbody>
  );
}

export function CustomersTable({ customers, loading, onCopy, onOpen }: ListProps) {
  return (
    <section className="dsv2-table-card dsv2-customers-directory">
      <div className="dsv2-card--padded dsv2-customers-directory-heading">
        <div>
          <p className="dsv2-customers-eyebrow">دليل العملاء</p>
          <h2 className="dsv2-section-title">ملفات العميلات</h2>
        </div>
        <span className="dsv2-badge">{formatCustomerCount(customers.length)} نتيجة</span>
      </div>
      <div className="dsv2-table-scroll">
        <table className="dsv2-table dsv2-customers-table">
          <thead>
            <tr>
              <th>العميلة</th>
              <th>رقم الجوال</th>
              <th>الحالة</th>
              <th>VIP</th>
              <th>عدد الحجوزات</th>
              <th>آخر زيارة</th>
              <th>المصدر</th>
              <th>الإجراءات</th>
            </tr>
          </thead>
          {loading && customers.length === 0 ? <CustomerTableSkeleton /> : (
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.key}>
                  <td><CustomerName customer={customer} /></td>
                  <td><bdi className="dsv2-customers-phone" dir="ltr">{customer.phone}</bdi></td>
                  <td><span className={`dsv2-badge ${isCustomerActive(customer.status) ? "dsv2-badge--success" : ""}`}>{getCustomerStatusLabel(customer.status)}</span></td>
                  <td><span className={`dsv2-badge ${customer.vip ? "dsv2-badge--gold" : ""}`}>{customer.vip ? "VIP" : "عادية"}</span></td>
                  <td><strong className="dsv2-table__primary">{formatCustomerCount(customer.bookingsCount)}</strong></td>
                  <td><span className="dsv2-customers-last-visit">{formatCustomerLastVisit(customer.lastVisitDate, customer.lastVisitTime)}</span></td>
                  <td><span className={`dsv2-badge dsv2-customers-source is-${customer.source}`} title={getCustomerSourceDescription(customer.source)}>{getCustomerSourceLabel(customer.source)}</span></td>
                  <td><CustomerActions customer={customer} onCopy={onCopy} onOpen={onOpen} /></td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>
    </section>
  );
}

export function CustomerMobileCard({ customer, onCopy, onOpen }: Omit<ListProps, "customers" | "loading"> & { customer: CustomerRow }) {
  return (
    <article className="dsv2-card dsv2-card--padded dsv2-customers-mobile-card">
      <header>
        <CustomerName customer={customer} />
        <CustomerBadges customer={customer} />
      </header>
      <div className="dsv2-customers-mobile-phone">
        <span>رقم الجوال</span>
        <bdi dir="ltr">{customer.phone}</bdi>
      </div>
      <dl>
        <div><dt>عدد الحجوزات</dt><dd>{formatCustomerCount(customer.bookingsCount)} حجزًا</dd></div>
        <div><dt>آخر زيارة</dt><dd>{formatCustomerLastVisit(customer.lastVisitDate, customer.lastVisitTime)}</dd></div>
        <div><dt>المصدر</dt><dd title={getCustomerSourceDescription(customer.source)}>{getCustomerSourceLabel(customer.source)}</dd></div>
      </dl>
      <CustomerActions customer={customer} mobile onCopy={onCopy} onOpen={onOpen} />
    </article>
  );
}

export function CustomersMobileList(props: ListProps) {
  return (
    <section className="dsv2-customers-mobile-list" aria-label="قائمة العملاء للجوال">
      {props.loading && props.customers.length === 0
        ? Array.from({ length: 4 }, (_, index) => <div className="dsv2-card dsv2-card--padded dsv2-customers-mobile-card is-skeleton" key={index}><span className="dsv2-skeleton" /><span className="dsv2-skeleton" /><span className="dsv2-skeleton" /></div>)
        : props.customers.map((customer) => <CustomerMobileCard key={customer.key} customer={customer} onCopy={props.onCopy} onOpen={props.onOpen} />)}
    </section>
  );
}

type EmptyStateProps = {
  kind: "empty" | "no-results" | "error";
  message?: string;
  canImport?: boolean;
  onPrimary: () => void;
  onImport?: () => void;
};

export function CustomersEmptyState(props: EmptyStateProps) {
  const isError = props.kind === "error";
  const isResults = props.kind === "no-results";
  const Icon = isError ? FiAlertCircle : isResults ? FiSearch : FiInbox;
  return (
    <section className={`dsv2-state ${isError ? "dsv2-state--error" : "dsv2-state--empty"} dsv2-customers-empty-state is-${props.kind}`} data-tone={isError ? undefined : "gold"} role={isError ? "alert" : "status"}>
      <span className="dsv2-state__icon"><Icon /></span>
      <div className="dsv2-state__content">
        <h2 className="dsv2-state__title">{isError ? "تعذر تحميل بيانات العملاء" : isResults ? "لم يتم العثور على عميلات مطابقات" : "لا توجد بيانات عملاء حتى الآن"}</h2>
        <p className="dsv2-state__description">{props.message || (isResults ? "جرّبي عبارة بحث أخرى أو امسحي الفلاتر الحالية." : "يمكنك إضافة عميلة من الحجز الإداري أو استيراد ملف Excel جاهز.")}</p>
      </div>
      <div className="dsv2-state__action">
        <button type="button" className={`dsv2-btn ${isError ? "dsv2-btn--danger" : "dsv2-btn--accent"}`} onClick={props.onPrimary}>
          {isError ? <FiRefreshCw /> : isResults ? <FiX /> : <FiUserPlus />}
          {isError ? "إعادة المحاولة" : isResults ? "مسح البحث والفلاتر" : "إضافة عميلة"}
        </button>
        {!isError && props.canImport && props.onImport ? (
          <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={props.onImport}><FiUpload /> استيراد Excel</button>
        ) : null}
      </div>
    </section>
  );
}
