import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { DashboardErrorStateV2 } from "../components/dashboard-v2";
import { clientsText, type DashboardLanguage } from "../helpers/dashboardClientsLanguage";
import {
  CustomersEmptyState,
  CustomersFilters,
  CustomersMobileList,
  CustomersPageHeader,
  CustomersSearchToolbar,
  CustomersStatsGrid,
  CustomersTable,
} from "../features/customers/CustomersPageSections";
import CustomerRecordModal from "../features/customers/CustomerRecordModal";
import CustomersImportModal from "../features/customers/CustomersImportModal";
import {
  customerLastVisitTimestamp,
  customerPhoneDigits,
  formatCustomerLastVisit,
  formatCustomerPhone,
  getCustomerSourceLabel,
  getCustomerStatusLabel,
  isCustomerActive,
  normalizeCustomerName,
  normalizeCustomerSearchText,
} from "../features/customers/customerFormatters";
import type {
  CustomerLastVisitFilter,
  CustomerRow,
  CustomerSegment,
  CustomerSort,
  CustomerSource,
  CustomerStats,
} from "../features/customers/customerTypes";
import { CoreClientService } from "../services/CoreClientService";
import type { CoreClient } from "../types/coreApi";

/**
 * CustomerRecordModal owns the Core-backed detail workflow formerly embedded here:
 * CoreClientService.overview, CoreClientService.adjustLoyalty, السجل الموحد للعميلة,
 * الدفعات والاسترجاعات، والعروض المستخدمة.
 */

type UiRole = "owner" | "admin" | "hr" | "accountant" | "reception" | "staff" | "client" | "guest";

type AppSettings = {
  policies?: { allowStaffViewClients?: boolean };
};

const SETTINGS_KEY = "dashboard_settings_v1";
const DEFAULT_SETTINGS: AppSettings = { policies: { allowStaffViewClients: false } };

function loadSettings(): AppSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      policies: { ...DEFAULT_SETTINGS.policies, ...(parsed?.policies || {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function downloadXLSX(filename: string, rows: unknown[][], sheetName: string) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, filename);
}

type DashboardClientsProps = { currentRole?: UiRole; language?: DashboardLanguage };

export default function DashboardClients({ currentRole = "guest", language = "ar" }: DashboardClientsProps) {
  const navigate = useNavigate();
  const t = (text: string) => clientsText(language, text);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [coreClients, setCoreClients] = useState<CoreClient[]>([]);
  const packagesFilterAvailable = true;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [segment, setSegment] = useState<CustomerSegment>("all");
  const [sort, setSort] = useState<CustomerSort>("latest");
  const [source, setSource] = useState<"all" | CustomerSource>("all");
  const [lastVisit, setLastVisit] = useState<CustomerLastVisitFilter>("all");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [copyToast, setCopyToast] = useState("");
  const copyTimer = useRef<number | null>(null);

  const allowStaffViewClients = settings.policies?.allowStaffViewClients === true;
  const canViewClients = currentRole === "owner" || currentRole === "admin" || currentRole === "hr" || currentRole === "accountant" || currentRole === "reception" || (currentRole === "staff" && allowStaffViewClients);
  const canImport = currentRole === "owner" || currentRole === "admin";
  const canExport = currentRole === "owner" || currentRole === "admin";

  useEffect(() => {
    const handleSettingsChange = () => setSettings(loadSettings());
    window.addEventListener("settingsChanged", handleSettingsChange);
    return () => window.removeEventListener("settingsChanged", handleSettingsChange);
  }, []);

  useEffect(() => () => {
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
  }, []);

  const loadData = useCallback(async () => {
    if (!canViewClients) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const clients = await CoreClientService.list("", {
        includeMetrics: true,
        limit: 500,
      });
      setCoreClients(Array.isArray(clients) ? clients : []);
    } catch (cause) {
      setCoreClients([]);
      setError(
        cause instanceof Error
          ? cause.message
          : t("تعذر تحميل ملفات العملاء")
      );
    } finally {
      setLoading(false);
    }
  }, [canViewClients, language]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const customers = useMemo<CustomerRow[]>(() => {
    return coreClients.map((client) => {
      const bookingsCount = Number(client.bookingsCount || 0);
      return {
        key: `id:${client.id}`,
        clientId: client.id,
        legacyClientDocId: client.legacyClientDocId || undefined,
        name: normalizeCustomerName(client.name),
        phone: formatCustomerPhone(client.phoneNormalized),
        bookingsCount,
        lastVisitDate: String(client.lastVisitDate || ""),
        lastVisitTime: String(client.lastVisitTime || ""),
        vip: Boolean(client.vip),
        status: String(client.status || "active"),
        importedNote: String(client.notes || "").trim() || undefined,
        source: bookingsCount > 0 ? "combined" : "client-record",
        createdAt: client.createdAt || undefined,
        activePackagesCount: Number(client.activePackagesCount || 0),
      } satisfies CustomerRow;
    });
  }, [coreClients]);

  const stats = useMemo<CustomerStats>(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const newThisMonth = customers.filter((customer) => {
      if (!customer.createdAt) return false;
      const created = new Date(customer.createdAt);
      return (
        !Number.isNaN(created.getTime()) &&
        created.getMonth() === currentMonth &&
        created.getFullYear() === currentYear
      );
    }).length;
    const totalBookings = customers.reduce(
      (sum, customer) => sum + customer.bookingsCount,
      0
    );
    return {
      totalClients: customers.length,
      totalBookings,
      activeClients: customers.filter((customer) =>
        isCustomerActive(customer.status)
      ).length,
      newThisMonth,
      vipClients: customers.filter((customer) => customer.vip).length,
      averageBookings: customers.length ? totalBookings / customers.length : 0,
    };
  }, [customers]);

  const visibleCustomers = useMemo(() => {
    const searchText = normalizeCustomerSearchText(deferredQuery);
    const searchDigits = customerPhoneDigits(deferredQuery);
    const rawSearchDigits = String(deferredQuery || "").replace(/\D/g, "");
    const now = Date.now();
    const rows = customers.filter((customer) => {
      const customerDigits = customerPhoneDigits(customer.phone);
      const customerDisplayDigits = String(customer.phone || "").replace(/\D/g, "");
      const matchesPhone = Boolean(rawSearchDigits) && (customerDisplayDigits.includes(rawSearchDigits) || customerDigits.includes(searchDigits));
      const matchesQuery = !searchText || normalizeCustomerSearchText(customer.name).includes(searchText) || matchesPhone;
      const matchesSegment = segment === "all" || (segment === "vip" && customer.vip) || (segment === "with-bookings" && customer.bookingsCount > 0) || (segment === "without-bookings" && customer.bookingsCount === 0) || (segment === "active-packages" && customer.activePackagesCount > 0);
      const matchesSource = source === "all" || customer.source === source;
      const visitTimestamp = customerLastVisitTimestamp(customer.lastVisitDate, customer.lastVisitTime);
      const matchesVisit = lastVisit === "all" || (lastVisit === "never" && !visitTimestamp) || (lastVisit === "30-days" && visitTimestamp > 0 && now - visitTimestamp <= 30 * 86400000) || (lastVisit === "90-days" && visitTimestamp > 0 && now - visitTimestamp <= 90 * 86400000);
      return matchesQuery && matchesSegment && matchesSource && matchesVisit;
    });
    return rows.sort((first, second) => {
      if (sort === "most") return second.bookingsCount - first.bookingsCount || first.name.localeCompare(second.name, language === "en" ? "en" : "ar");
      if (sort === "newest") return Date.parse(second.createdAt || "") - Date.parse(first.createdAt || "") || first.name.localeCompare(second.name, language === "en" ? "en" : "ar");
      return customerLastVisitTimestamp(second.lastVisitDate, second.lastVisitTime) - customerLastVisitTimestamp(first.lastVisitDate, first.lastVisitTime) || first.name.localeCompare(second.name, language === "en" ? "en" : "ar");
    });
  }, [customers, deferredQuery, language, lastVisit, segment, sort, source]);

  const hasActiveFilters = Boolean(query.trim()) || segment !== "all" || sort !== "latest" || source !== "all" || lastVisit !== "all";
  const clearFilters = () => {
    setQuery("");
    setSegment("all");
    setSort("latest");
    setSource("all");
    setLastVisit("all");
  };

  const copyPhone = async (phone: string) => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(phone);
      else {
        const input = document.createElement("textarea");
        input.value = phone;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
      setCopyToast(t("تم نسخ رقم الجوال"));
    } catch {
      setCopyToast(t("تعذر نسخ رقم الجوال"));
    }
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopyToast(""), 1800);
  };

  const handleCustomerUpdated = (updated: CoreClient) => {
    setCoreClients((current) =>
      current.map((client) =>
        client.id === updated.id
          ? {
              ...client,
              ...updated,
              bookingsCount: client.bookingsCount,
              completedBookingsCount: client.completedBookingsCount,
              cancelledBookingsCount: client.cancelledBookingsCount,
              noShowBookingsCount: client.noShowBookingsCount,
              lastVisitDate: client.lastVisitDate,
              lastVisitTime: client.lastVisitTime,
              activePackagesCount: client.activePackagesCount,
              remainingPackageSessions: client.remainingPackageSessions,
            }
          : client
      )
    );
    setSelectedCustomer((current) =>
      current && current.clientId === updated.id
        ? {
            ...current,
            name: normalizeCustomerName(updated.name),
            phone: formatCustomerPhone(updated.phoneNormalized),
            status: updated.status,
            vip: Boolean(updated.vip),
            importedNote:
              String(updated.notes || "").trim() || undefined,
          }
        : current
    );
  };

  const exportCustomers = () => {
    const rows: unknown[][] = [[t("العميلة"), t("رقم الجوال"), t("الحالة"), "VIP", t("عدد الحجوزات"), t("آخر زيارة"), t("المصدر")]];
    visibleCustomers.forEach((customer) => rows.push([
      normalizeCustomerName(customer.name),
      customer.phone === "—" ? "" : customer.phone,
      getCustomerStatusLabel(customer.status, language),
      customer.vip ? "VIP" : t("عادية"),
      customer.bookingsCount,
      formatCustomerLastVisit(customer.lastVisitDate, customer.lastVisitTime, language),
      getCustomerSourceLabel(customer.source, language),
    ]));
    const date = new Date().toISOString().slice(0, 10);
    downloadXLSX(`queens_customers_${date}.xlsx`, rows, "Customers");
  };

  if (!canViewClients) {
    return (
      <main className="dsv2-page dsv2-customers-page" dir={language === "en" ? "ltr" : "rtl"} lang={language}>
        <DashboardErrorStateV2
          title={t("غير مصرح")}
          description={t("هذه الصفحة متاحة للإدارة والاستقبال حسب الصلاحيات الحالية.")}
          compact
        />
      </main>
    );
  }

  const fatalError = Boolean(error) && !loading && customers.length === 0;
  const noData = !loading && !error && customers.length === 0;
  const noResults = !loading && customers.length > 0 && visibleCustomers.length === 0;

  return (
    <main className="dsv2-page dsv2-customers-page" dir={language === "en" ? "ltr" : "rtl"} lang={language}>
      <CustomersPageHeader visibleCount={visibleCustomers.length} totalCount={customers.length} language={language} />
      <CustomersSearchToolbar language={language} query={query} loading={loading} canImport={canImport} canExport={canExport} onQueryChange={setQuery} onImport={() => setImportOpen(true)} onExport={exportCustomers} onRefresh={() => void loadData()} />
      <CustomersFilters language={language} segment={segment} sort={sort} source={source} lastVisit={lastVisit} packagesFilterAvailable={packagesFilterAvailable} hasActiveFilters={hasActiveFilters} onSegmentChange={setSegment} onSortChange={setSort} onSourceChange={setSource} onLastVisitChange={setLastVisit} onClear={clearFilters} />
      <CustomersStatsGrid stats={stats} loading={loading && customers.length === 0} language={language} />

      {error && !fatalError ? (
        <div className="dsv2-customers-alert dsv2-customers-alert--error" role="alert">
          <span>{error}</span>
          <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" onClick={() => void loadData()}>{t("إعادة المحاولة")}</button>
        </div>
      ) : null}
      {fatalError ? <CustomersEmptyState language={language} kind="error" message={error} onPrimary={() => void loadData()} /> : null}
      {noData ? <CustomersEmptyState language={language} kind="empty" canImport={canImport} onPrimary={() => navigate("/dashboard/booking-internal")} onImport={() => setImportOpen(true)} /> : null}
      {noResults ? <CustomersEmptyState language={language} kind="no-results" onPrimary={clearFilters} /> : null}
      {!fatalError && !noData && !noResults ? (
        <>
          <CustomersTable language={language} customers={visibleCustomers} loading={loading} onCopy={(phone) => void copyPhone(phone)} onOpen={setSelectedCustomer} />
          <CustomersMobileList language={language} customers={visibleCustomers} loading={loading} onCopy={(phone) => void copyPhone(phone)} onOpen={setSelectedCustomer} />
        </>
      ) : null}

      {selectedCustomer ? <CustomerRecordModal language={language} customer={selectedCustomer} currentRole={currentRole} onCustomerUpdated={handleCustomerUpdated} onClose={() => setSelectedCustomer(null)} /> : null}
      <CustomersImportModal language={language} open={importOpen} existingClients={coreClients} onClose={() => setImportOpen(false)} onImported={(clients) => { setCoreClients(clients); setError(""); }} />
      {copyToast ? <div className="dsv2-customers-copy-toast" role="status">{copyToast}</div> : null}
    </main>
  );
}
