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
import { clientsText, type DashboardLanguage } from "../../helpers/dashboardClientsLanguage";
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

export function CustomersPageHeader({ visibleCount, totalCount, language }: { visibleCount: number; totalCount: number; language: DashboardLanguage }) {
  const t = (text: string) => clientsText(language, text);
  return (
    <header className="dsv2-page-head dsv2-customers-page-head">
      <div className="dsv2-customers-heading">
        <p className="dsv2-customers-eyebrow">MALIKAT</p>
        <h1 className="dsv2-page-title">{t("إدارة العملاء")}</h1>
        <p className="dsv2-page-subtitle">{t("ملفات العميلات وحجوزاتهن وبيانات التواصل في مساحة واحدة منظّمة.")}</p>
      </div>
      <div className="dsv2-card dsv2-card--padded dsv2-customers-summary-card" aria-label={t("ملخص النتائج")}>
        <span className="dsv2-customers-summary-icon"><FiDatabase aria-hidden="true" /></span>
        <div>
          <small>{t("المصدر الحالي")}</small>
          <strong>Core D1</strong>
        </div>
        <b className="dsv2-badge dsv2-badge--gold">{formatCustomerCount(visibleCount, 0, language)} {language === "en" ? "of" : "من"} {formatCustomerCount(totalCount, 0, language)}</b>
      </div>
    </header>
  );
}

type ToolbarProps = {
  language: DashboardLanguage;
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
  const t = (text: string) => clientsText(props.language, text);
  return (
    <section className="dsv2-card dsv2-card--padded dsv2-customers-toolbar" aria-label={t("بحث وأدوات العملاء")}>
      <label className="dsv2-customers-search-field">
        <FiSearch aria-hidden="true" />
        <input
          className="dsv2-input"
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
          placeholder={t("ابحثي بالاسم أو رقم الجوال")}
          aria-label={t("البحث باسم العميلة أو رقم الجوال")}
        />
        {props.query ? (
          <button
            type="button"
            className="dsv2-icon-btn dsv2-customers-search-clear"
            onClick={() => props.onQueryChange("")}
            title={t("مسح البحث")}
            aria-label={t("مسح البحث")}
          >
            <FiX />
          </button>
        ) : null}
      </label>

      <div className="dsv2-customers-toolbar-actions">
        {props.canImport ? (
          <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={props.onImport} disabled={props.loading}>
            <FiUpload />
            <span>{t("استيراد Excel")}</span>
          </button>
        ) : null}
        {props.canExport ? (
          <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={props.onExport} disabled={props.loading}>
            <FiDownload />
            <span>{t("تصدير Excel")}</span>
          </button>
        ) : null}
        <button type="button" className="dsv2-btn dsv2-btn--primary" onClick={props.onRefresh} disabled={props.loading}>
          <FiRefreshCw className={props.loading ? "dsv2-customers-spin" : ""} />
          <span>{props.loading ? t("جارٍ التحديث") : t("تحديث البيانات")}</span>
        </button>
      </div>
    </section>
  );
}

type FiltersProps = {
  language: DashboardLanguage;
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
  const t = (text: string) => clientsText(props.language, text);
  return (
    <section className="dsv2-card dsv2-card--padded dsv2-customers-filters" aria-label={t("فلاتر العملاء")}>
      <div className="dsv2-customers-filter-heading">
        <span className="dsv2-customers-filter-icon"><FiFilter /></span>
        <div>
          <strong>{t("تصفية النتائج")}</strong>
          <small>{t("اختاري شريحة أو رتّبي السجلات للوصول أسرع.")}</small>
        </div>
      </div>

      <div className="dsv2-customers-filter-chips" role="group" aria-label={t("شرائح العملاء")}>
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
              {t(item.label)}
            </button>
          ))}
      </div>

      <div className="dsv2-customers-filter-selects">
        <div className="dsv2-field">
          <span className="dsv2-field__label">{t("آخر زيارة")}</span>
          <DashboardSelectV2
            value={props.lastVisit}
            options={lastVisitOptions.map((option) => ({ ...option, label: t(option.label) }))}
            onChange={(value) => props.onLastVisitChange(value as CustomerLastVisitFilter)}
          />
        </div>
        <div className="dsv2-field">
          <span className="dsv2-field__label">{t("المصدر")}</span>
          <DashboardSelectV2
            value={props.source}
            options={sourceOptions.map((option) => ({ ...option, label: t(option.label) }))}
            onChange={(value) => props.onSourceChange(value as "all" | CustomerSource)}
          />
        </div>
        <div className="dsv2-field">
          <span className="dsv2-field__label">{t("الترتيب")}</span>
          <DashboardSelectV2
            value={props.sort}
            options={sortOptions.map((option) => ({ ...option, label: t(option.label) }))}
            onChange={(value) => props.onSortChange(value as CustomerSort)}
          />
        </div>
      </div>

      {props.hasActiveFilters ? (
        <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm dsv2-customers-clear-filters" onClick={props.onClear}>
          <FiX /> {t("مسح الفلاتر")}
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

export function CustomersStatsGrid({ stats, loading, language }: { stats: CustomerStats; loading: boolean; language: DashboardLanguage }) {
  const t = (text: string) => clientsText(language, text);
  const cards: StatCardProps[] = [
    { icon: FiUsers, label: t("إجمالي العملاء"), value: formatCustomerCount(stats.totalClients, 0, language), description: t("كل الملفات الفريدة"), tone: "maroon" },
    { icon: FiCalendar, label: t("إجمالي الحجوزات"), value: formatCustomerCount(stats.totalBookings, 0, language), description: t("الحجوزات المرتبطة بالعميلات"), tone: "blue" },
    { icon: FiActivity, label: t("العملاء النشطون"), value: formatCustomerCount(stats.activeClients, 0, language), description: t("حالة الملف نشطة"), tone: "green" },
    { icon: FiUserPlus, label: t("الجدد هذا الشهر"), value: formatCustomerCount(stats.newThisMonth, 0, language), description: t("ملفات أُنشئت خلال الشهر"), tone: "purple" },
    { icon: FiStar, label: t("عملاء VIP"), value: formatCustomerCount(stats.vipClients, 0, language), description: t("العميلات المميزات"), tone: "gold" },
    { icon: FiBarChart2, label: t("متوسط الحجوزات"), value: formatCustomerCount(stats.averageBookings, 1, language), description: t("لكل عميلة"), tone: "slate" },
  ];

  return (
    <section className="dsv2-grid--metrics dsv2-customers-stats-grid" aria-label={t("إحصائيات العملاء")}>
      {cards.map((card) => <CustomerStatsCard key={card.label} {...card} loading={loading} />)}
    </section>
  );
}

export function CustomerName({ customer, language }: { customer: CustomerRow; language: DashboardLanguage }) {
  const t = (text: string) => clientsText(language, text);
  const name = normalizeCustomerName(customer.name);
  return (
    <div className="dsv2-customers-name-block">
      <span className="dsv2-customers-avatar" aria-hidden="true">{getCustomerInitials(name)}</span>
      <span className="dsv2-customers-name-copy">
        <strong className="dsv2-table__primary">{t(name)}</strong>
        <small className="dsv2-table__secondary">{customer.clientId ? t("ملف موحّد") : t("من سجل الحجوزات")}</small>
      </span>
    </div>
  );
}

function CustomerBadges({ customer, language }: { customer: CustomerRow; language: DashboardLanguage }) {
  const t = (text: string) => clientsText(language, text);
  return (
    <div className="dsv2-customers-badges">
      <span className={`dsv2-badge ${isCustomerActive(customer.status) ? "dsv2-badge--success" : ""}`}>
        {getCustomerStatusLabel(customer.status, language)}
      </span>
      <span className={`dsv2-badge ${customer.vip ? "dsv2-badge--gold" : ""}`}>
        {customer.vip ? "VIP" : t("عادية")}
      </span>
    </div>
  );
}

type CustomerActionsProps = {
  language: DashboardLanguage;
  customer: CustomerRow;
  mobile?: boolean;
  onCopy: (phone: string) => void;
  onOpen: (customer: CustomerRow) => void;
};

export function CustomerActions({ customer, language, mobile = false, onCopy, onOpen }: CustomerActionsProps) {
  const t = (text: string) => clientsText(language, text);
  const hasPhone = hasCustomerPhone(customer.phone);
  const whatsappHref = buildCustomerWhatsAppHref(customer.name, customer.phone);
  return (
    <div className={`dsv2-customers-actions ${mobile ? `is-mobile ${hasPhone ? "has-phone" : "has-no-phone"}` : ""}`}>
      {mobile && hasPhone ? (
        <a className="dsv2-icon-btn dsv2-customers-action-btn is-call" href={`tel:${customer.phone}`} title={t("اتصال")} aria-label={language === "en" ? `Call ${customer.name}` : `اتصال بـ ${customer.name}`}>
          <FiPhone />
        </a>
      ) : null}
      {hasPhone ? (
        <>
          <button type="button" className="dsv2-icon-btn dsv2-customers-action-btn is-copy" onClick={() => onCopy(customer.phone)} title={t("نسخ رقم الجوال")} aria-label={language === "en" ? `Copy phone number for ${customer.name}` : `نسخ رقم جوال ${customer.name}`}>
            <FiCopy />
          </button>
          <a className="dsv2-icon-btn dsv2-customers-action-btn is-whatsapp" href={whatsappHref} target="_blank" rel="noreferrer" title={t("فتح واتساب")} aria-label={language === "en" ? `Open WhatsApp with ${customer.name}` : `فتح واتساب مع ${customer.name}`}>
            <FiMessageCircle />
          </a>
        </>
      ) : null}
      <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm dsv2-customers-open-btn" onClick={() => onOpen(customer)} title={t("عرض ملف العميلة")}>
        <FiEye /> <span>{t("عرض الملف")}</span>
      </button>
    </div>
  );
}

type ListProps = {
  language: DashboardLanguage;
  customers: CustomerRow[];
  loading: boolean;
  onCopy: (phone: string) => void;
  onOpen: (customer: CustomerRow) => void;
};

function CustomerTableSkeleton({ language }: { language: DashboardLanguage }) {
  return (
    <tbody aria-label={clientsText(language, "جارٍ تحميل العملاء")}>
      {Array.from({ length: 5 }, (_, index) => (
        <tr key={index} className="dsv2-customers-table-skeleton-row">
          {Array.from({ length: 8 }, (__, cell) => <td key={cell}><span className="dsv2-skeleton" /></td>)}
        </tr>
      ))}
    </tbody>
  );
}

export function CustomersTable({ customers, loading, onCopy, onOpen, language }: ListProps) {
  const t = (text: string) => clientsText(language, text);
  return (
    <section className="dsv2-table-card dsv2-customers-directory">
      <div className="dsv2-card--padded dsv2-customers-directory-heading">
        <div>
          <p className="dsv2-customers-eyebrow">{t("دليل العملاء")}</p>
          <h2 className="dsv2-section-title">{t("ملفات العميلات")}</h2>
        </div>
        <span className="dsv2-badge">{formatCustomerCount(customers.length, 0, language)} {t("نتيجة")}</span>
      </div>
      <div className="dsv2-table-scroll">
        <table className="dsv2-table dsv2-customers-table">
          <thead>
            <tr>
              <th>{t("العميلة")}</th>
              <th>{t("رقم الجوال")}</th>
              <th>{t("الحالة")}</th>
              <th>VIP</th>
              <th>{t("عدد الحجوزات")}</th>
              <th>{t("آخر زيارة")}</th>
              <th>{t("المصدر")}</th>
              <th>{t("الإجراءات")}</th>
            </tr>
          </thead>
          {loading && customers.length === 0 ? <CustomerTableSkeleton language={language} /> : (
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.key}>
                  <td><CustomerName customer={customer} language={language} /></td>
                  <td><bdi className="dsv2-customers-phone" dir="ltr">{customer.phone}</bdi></td>
                  <td><span className={`dsv2-badge ${isCustomerActive(customer.status) ? "dsv2-badge--success" : ""}`}>{getCustomerStatusLabel(customer.status, language)}</span></td>
                  <td><span className={`dsv2-badge ${customer.vip ? "dsv2-badge--gold" : ""}`}>{customer.vip ? "VIP" : t("عادية")}</span></td>
                  <td><strong className="dsv2-table__primary">{formatCustomerCount(customer.bookingsCount, 0, language)}</strong></td>
                  <td><span className="dsv2-customers-last-visit">{formatCustomerLastVisit(customer.lastVisitDate, customer.lastVisitTime, language)}</span></td>
                  <td><span className={`dsv2-badge dsv2-customers-source is-${customer.source}`} title={getCustomerSourceDescription(customer.source, language)}>{getCustomerSourceLabel(customer.source, language)}</span></td>
                  <td><CustomerActions customer={customer} language={language} onCopy={onCopy} onOpen={onOpen} /></td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>
    </section>
  );
}

export function CustomerMobileCard({ customer, onCopy, onOpen, language }: Omit<ListProps, "customers" | "loading"> & { customer: CustomerRow }) {
  const t = (text: string) => clientsText(language, text);
  return (
    <article className="dsv2-card dsv2-card--padded dsv2-customers-mobile-card">
      <header>
        <CustomerName customer={customer} language={language} />
        <CustomerBadges customer={customer} language={language} />
      </header>
      <div className="dsv2-customers-mobile-phone">
        <span>{t("رقم الجوال")}</span>
        <bdi dir="ltr">{customer.phone}</bdi>
      </div>
      <dl>
        <div><dt>{t("عدد الحجوزات")}</dt><dd>{formatCustomerCount(customer.bookingsCount, 0, language)} {t("حجزًا")}</dd></div>
        <div><dt>{t("آخر زيارة")}</dt><dd>{formatCustomerLastVisit(customer.lastVisitDate, customer.lastVisitTime, language)}</dd></div>
        <div><dt>{t("المصدر")}</dt><dd title={getCustomerSourceDescription(customer.source, language)}>{getCustomerSourceLabel(customer.source, language)}</dd></div>
      </dl>
      <CustomerActions customer={customer} language={language} mobile onCopy={onCopy} onOpen={onOpen} />
    </article>
  );
}

export function CustomersMobileList(props: ListProps) {
  return (
    <section className="dsv2-customers-mobile-list" aria-label={clientsText(props.language, "قائمة العملاء للجوال")}>
      {props.loading && props.customers.length === 0
        ? Array.from({ length: 4 }, (_, index) => <div className="dsv2-card dsv2-card--padded dsv2-customers-mobile-card is-skeleton" key={index}><span className="dsv2-skeleton" /><span className="dsv2-skeleton" /><span className="dsv2-skeleton" /></div>)
        : props.customers.map((customer) => <CustomerMobileCard key={customer.key} customer={customer} language={props.language} onCopy={props.onCopy} onOpen={props.onOpen} />)}
    </section>
  );
}

type EmptyStateProps = {
  language: DashboardLanguage;
  kind: "empty" | "no-results" | "error";
  message?: string;
  canImport?: boolean;
  onPrimary: () => void;
  onImport?: () => void;
};

export function CustomersEmptyState(props: EmptyStateProps) {
  const t = (text: string) => clientsText(props.language, text);
  const isError = props.kind === "error";
  const isResults = props.kind === "no-results";
  const Icon = isError ? FiAlertCircle : isResults ? FiSearch : FiInbox;
  return (
    <section className={`dsv2-state ${isError ? "dsv2-state--error" : "dsv2-state--empty"} dsv2-customers-empty-state is-${props.kind}`} data-tone={isError ? undefined : "gold"} role={isError ? "alert" : "status"}>
      <span className="dsv2-state__icon"><Icon /></span>
      <div className="dsv2-state__content">
        <h2 className="dsv2-state__title">{isError ? t("تعذر تحميل بيانات العملاء") : isResults ? t("لم يتم العثور على عميلات مطابقات") : t("لا توجد بيانات عملاء حتى الآن")}</h2>
        <p className="dsv2-state__description">{props.message || (isResults ? t("جرّبي عبارة بحث أخرى أو امسحي الفلاتر الحالية.") : t("يمكنك إضافة عميلة من الحجز الإداري أو استيراد ملف Excel جاهز."))}</p>
      </div>
      <div className="dsv2-state__action">
        <button type="button" className={`dsv2-btn ${isError ? "dsv2-btn--danger" : "dsv2-btn--accent"}`} onClick={props.onPrimary}>
          {isError ? <FiRefreshCw /> : isResults ? <FiX /> : <FiUserPlus />}
          {isError ? t("إعادة المحاولة") : isResults ? t("مسح البحث والفلاتر") : t("إضافة عميلة")}
        </button>
        {!isError && props.canImport && props.onImport ? (
          <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={props.onImport}><FiUpload /> {t("استيراد Excel")}</button>
        ) : null}
      </div>
    </section>
  );
}
