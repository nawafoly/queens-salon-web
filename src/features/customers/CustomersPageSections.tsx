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
    <header className="customers-page-header">
      <div className="customers-page-heading">
        <p className="customers-eyebrow">Queens Salon</p>
        <h1>إدارة العملاء</h1>
        <p>ملفات العميلات وحجوزاتهن وبيانات التواصل في مساحة واحدة منظّمة.</p>
      </div>
      <div className="customers-header-summary" aria-label="ملخص النتائج">
        <span><FiDatabase aria-hidden="true" /></span>
        <div>
          <small>المصدر الحالي</small>
          <strong>Core D1</strong>
        </div>
        <b>{formatCustomerCount(visibleCount)} من {formatCustomerCount(totalCount)}</b>
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
    <section className="customers-toolbar" aria-label="بحث وأدوات العملاء">
      <label className="customers-search-field">
        <FiSearch aria-hidden="true" />
        <input
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
          placeholder="ابحثي بالاسم أو رقم الجوال"
          aria-label="البحث باسم العميلة أو رقم الجوال"
        />
        {props.query ? (
          <button
            type="button"
            className="customers-search-clear"
            onClick={() => props.onQueryChange("")}
            title="مسح البحث"
            aria-label="مسح البحث"
          >
            <FiX />
          </button>
        ) : null}
      </label>

      <div className="customers-toolbar-actions">
        {props.canImport ? (
          <button type="button" className="customers-button is-secondary" onClick={props.onImport} disabled={props.loading}>
            <FiUpload />
            <span>استيراد Excel</span>
          </button>
        ) : null}
        {props.canExport ? (
          <button type="button" className="customers-button is-secondary" onClick={props.onExport} disabled={props.loading}>
            <FiDownload />
            <span>تصدير Excel</span>
          </button>
        ) : null}
        <button type="button" className="customers-button is-primary" onClick={props.onRefresh} disabled={props.loading}>
          <FiRefreshCw className={props.loading ? "is-spinning" : ""} />
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

export function CustomersFilters(props: FiltersProps) {
  return (
    <section className="customers-filters" aria-label="فلاتر العملاء">
      <div className="customers-filter-heading">
        <span><FiFilter /></span>
        <div>
          <strong>تصفية النتائج</strong>
          <small>اختاري شريحة أو رتّبي السجلات للوصول أسرع.</small>
        </div>
      </div>

      <div className="customers-filter-chips" role="group" aria-label="شرائح العملاء">
        {segments
          .filter((item) => item.value !== "active-packages" || props.packagesFilterAvailable)
          .map((item) => (
            <button
              key={item.value}
              type="button"
              className={props.segment === item.value ? "is-active" : ""}
              onClick={() => props.onSegmentChange(item.value)}
              aria-pressed={props.segment === item.value}
            >
              {item.label}
            </button>
          ))}
      </div>

      <div className="customers-filter-selects">
        <label>
          <span>آخر زيارة</span>
          <select value={props.lastVisit} onChange={(event) => props.onLastVisitChange(event.target.value as CustomerLastVisitFilter)}>
            <option value="all">كل الزيارات</option>
            <option value="30-days">خلال 30 يومًا</option>
            <option value="90-days">خلال 90 يومًا</option>
            <option value="never">لم تزر بعد</option>
          </select>
        </label>
        <label>
          <span>المصدر</span>
          <select value={props.source} onChange={(event) => props.onSourceChange(event.target.value as "all" | CustomerSource)}>
            <option value="all">كل المصادر</option>
            <option value="combined">ملف موحّد وحجوزات</option>
            <option value="client-record">ملف العميلة</option>
            <option value="booking-only">سجل الحجوزات</option>
          </select>
        </label>
        <label>
          <span>الترتيب</span>
          <select value={props.sort} onChange={(event) => props.onSortChange(event.target.value as CustomerSort)}>
            <option value="latest">الأحدث زيارة</option>
            <option value="newest">الأحدث تسجيلًا</option>
            <option value="most">الأكثر حجزًا</option>
          </select>
        </label>
      </div>

      {props.hasActiveFilters ? (
        <button type="button" className="customers-clear-filters" onClick={props.onClear}>
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
  return (
    <article className={`customer-stat-card is-${props.tone}`}>
      <span className="customer-stat-icon"><Icon /></span>
      <div>
        <small>{props.label}</small>
        {props.loading ? <span className="customers-skeleton customer-stat-skeleton" /> : <strong>{props.value}</strong>}
        <p>{props.description}</p>
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
    <section className="customers-stats-grid" aria-label="إحصائيات العملاء">
      {cards.map((card) => <CustomerStatsCard key={card.label} {...card} loading={loading} />)}
    </section>
  );
}

export function CustomerName({ customer }: { customer: CustomerRow }) {
  const name = normalizeCustomerName(customer.name);
  return (
    <div className="customer-name-block">
      <span className="customer-avatar" aria-hidden="true">{getCustomerInitials(name)}</span>
      <span className="customer-name-copy">
        <strong>{name}</strong>
        <small>{customer.clientId ? "ملف موحّد" : "من سجل الحجوزات"}</small>
      </span>
    </div>
  );
}

function CustomerBadges({ customer }: { customer: CustomerRow }) {
  return (
    <div className="customer-badges">
      <span className={`customer-badge ${isCustomerActive(customer.status) ? "is-active" : "is-muted"}`}>
        {getCustomerStatusLabel(customer.status)}
      </span>
      <span className={`customer-badge ${customer.vip ? "is-vip" : "is-regular"}`}>
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
    <div className={`customer-actions ${mobile ? `is-mobile ${hasPhone ? "has-phone" : "has-no-phone"}` : ""}`}>
      {mobile && hasPhone ? (
        <a className="customer-icon-button is-call" href={`tel:${customer.phone}`} title="اتصال" aria-label={`اتصال بـ ${customer.name}`}>
          <FiPhone />
        </a>
      ) : null}
      {hasPhone ? (
        <>
          <button type="button" className="customer-icon-button is-copy" onClick={() => onCopy(customer.phone)} title="نسخ رقم الجوال" aria-label={`نسخ رقم جوال ${customer.name}`}>
            <FiCopy />
          </button>
          <a className="customer-icon-button is-whatsapp" href={whatsappHref} target="_blank" rel="noreferrer" title="فتح واتساب" aria-label={`فتح واتساب مع ${customer.name}`}>
            <FiMessageCircle />
          </a>
        </>
      ) : null}
      <button type="button" className="customer-open-button" onClick={() => onOpen(customer)} title="عرض ملف العميلة">
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
        <tr key={index} className="customers-table-skeleton-row">
          {Array.from({ length: 8 }, (__, cell) => <td key={cell}><span className="customers-skeleton" /></td>)}
        </tr>
      ))}
    </tbody>
  );
}

export function CustomersTable({ customers, loading, onCopy, onOpen }: ListProps) {
  return (
    <section className="customers-directory-card">
      <div className="customers-directory-heading">
        <div>
          <p className="customers-eyebrow">دليل العملاء</p>
          <h2>ملفات العميلات</h2>
        </div>
        <span>{formatCustomerCount(customers.length)} نتيجة</span>
      </div>
      <div className="customers-table-wrap">
        <table className="customers-table">
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
                  <td><bdi className="customer-phone" dir="ltr">{customer.phone}</bdi></td>
                  <td><span className={`customer-badge ${isCustomerActive(customer.status) ? "is-active" : "is-muted"}`}>{getCustomerStatusLabel(customer.status)}</span></td>
                  <td><span className={`customer-badge ${customer.vip ? "is-vip" : "is-regular"}`}>{customer.vip ? "VIP" : "عادية"}</span></td>
                  <td><strong className="customer-booking-count">{formatCustomerCount(customer.bookingsCount)}</strong></td>
                  <td><span className="customer-last-visit">{formatCustomerLastVisit(customer.lastVisitDate, customer.lastVisitTime)}</span></td>
                  <td><span className={`customer-source is-${customer.source}`} title={getCustomerSourceDescription(customer.source)}>{getCustomerSourceLabel(customer.source)}</span></td>
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
    <article className="customer-mobile-card">
      <header>
        <CustomerName customer={customer} />
        <CustomerBadges customer={customer} />
      </header>
      <div className="customer-mobile-phone">
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
    <section className="customers-mobile-list" aria-label="قائمة العملاء للجوال">
      {props.loading && props.customers.length === 0
        ? Array.from({ length: 4 }, (_, index) => <div className="customer-mobile-card is-skeleton" key={index}><span className="customers-skeleton" /><span className="customers-skeleton" /><span className="customers-skeleton" /></div>)
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
    <section className={`customers-empty-state is-${props.kind}`}>
      <span><Icon /></span>
      <h2>{isError ? "تعذر تحميل بيانات العملاء" : isResults ? "لم يتم العثور على عميلات مطابقات" : "لا توجد بيانات عملاء حتى الآن"}</h2>
      <p>{props.message || (isResults ? "جرّبي عبارة بحث أخرى أو امسحي الفلاتر الحالية." : "يمكنك إضافة عميلة من الحجز الإداري أو استيراد ملف Excel جاهز.")}</p>
      <div>
        <button type="button" className="customers-button is-primary" onClick={props.onPrimary}>
          {isError ? <FiRefreshCw /> : isResults ? <FiX /> : <FiUserPlus />}
          {isError ? "إعادة المحاولة" : isResults ? "مسح البحث والفلاتر" : "إضافة عميلة"}
        </button>
        {!isError && props.canImport && props.onImport ? (
          <button type="button" className="customers-button is-secondary" onClick={props.onImport}><FiUpload /> استيراد Excel</button>
        ) : null}
      </div>
    </section>
  );
}
