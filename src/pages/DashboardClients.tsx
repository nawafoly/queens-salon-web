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
  unnamedCustomerSearchHaystack,
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
  const PAGE_SIZE = 50;
  const [coreClients, setCoreClients] = useState<CoreClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [page, setPage] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [totalClients, setTotalClients] = useState(0);
  const [directoryStats, setDirectoryStats] = useState<CustomerStats>({
    totalClients: 0,
    totalBookings: 0,
    activeClients: 0,
    newThisMonth: 0,
    vipClients: 0,
    averageBookings: 0,
  });
  const requestGenerationRef = useRef(0);
  const packagesFilterAvailable = true;
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


  useEffect(() => {
    setPage(0);
  }, [deferredQuery, segment, source, lastVisit, sort]);

  const loadData = useCallback(async () => {
    if (!canViewClients) {
      setLoading(false);
      return;
    }

    const generation = ++requestGenerationRef.current;
    setLoading(true);
    setError("");

    try {
      const search = String(deferredQuery || "").trim();


      const [rows, summary] = await Promise.all([
        CoreClientService.list(search, {
          includeMetrics: true,
          segment,
          lastVisit,
          source,
          sort,
          limit: PAGE_SIZE + 1,
          offset: page * PAGE_SIZE,
        }),
        CoreClientService.directorySummary(search, {
          segment,
          lastVisit,
          source,
        }),
      ]);

      if (generation !== requestGenerationRef.current) return;

      const safeRows = Array.isArray(rows) ? rows : [];
      const summaryTotal = Number(summary?.totalClients || 0);
      const lastValidPage = Math.max(
        0,
        Math.ceil(summaryTotal / PAGE_SIZE) - 1
      );

      if (page > lastValidPage) {
        setPage(lastValidPage);
        return;
      }

      setHasNextPage(safeRows.length > PAGE_SIZE);
      setCoreClients(safeRows.slice(0, PAGE_SIZE));
      setTotalClients(summaryTotal);
      setDirectoryStats({
        totalClients: summaryTotal,
        totalBookings: Number(summary?.totalBookings || 0),
        activeClients: Number(summary?.activeClients || 0),
        newThisMonth: Number(summary?.newThisMonth || 0),
        vipClients: Number(summary?.vipClients || 0),
        averageBookings: Number(summary?.averageBookings || 0),
      });
    } catch (cause) {
      if (generation !== requestGenerationRef.current) return;
      setCoreClients([]);
      setHasNextPage(false);
      setError(
        cause instanceof Error
          ? cause.message
          : t("\u062a\u0639\u0630\u0631 \u062a\u062d\u0645\u064a\u0644 \u0645\u0644\u0641\u0627\u062a \u0627\u0644\u0639\u0645\u0644\u0627\u0621")
      );
    } finally {
      if (generation === requestGenerationRef.current) {
        setLoading(false);
      }
    }
  }, [
    canViewClients,
    deferredQuery,
    segment,
    language,
    lastVisit,
    page,
    sort,
    source,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, String(deferredQuery || "").trim() ? 220 : 0);

    return () => window.clearTimeout(timer);
  }, [loadData, deferredQuery]);

  const coreClientToCustomerRow = useCallback((client: CoreClient): CustomerRow => {
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
  }, []);

  const customers = useMemo<CustomerRow[]>(
    () => coreClients.map(coreClientToCustomerRow),
    [coreClients, coreClientToCustomerRow]
  );

  const stats = directoryStats;

  const visibleCustomers = customers;

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

  const handleCustomerUpdated = async (updated: CoreClient) => {
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

    setError("");

    try {
      await loadData();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("\u062a\u0639\u0630\u0631 \u062a\u062d\u062f\u064a\u062b \u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u0639\u0645\u064a\u0644\u0629.")
      );
    }
  };

  const exportCustomers = async () => {
    const EXPORT_PAGE_SIZE = 500;
    const search = String(deferredQuery || "").trim();

    setLoading(true);
    setError("");

    try {
      const exportedClients: CoreClient[] = [];
      let offset = 0;

      while (true) {
        const batch = await CoreClientService.list(search, {
          includeMetrics: true,
          segment,
          lastVisit,
          source,
          sort,
          limit: EXPORT_PAGE_SIZE,
          offset,
        });

        const safeBatch = Array.isArray(batch) ? batch : [];
        exportedClients.push(...safeBatch);

        if (safeBatch.length < EXPORT_PAGE_SIZE) {
          break;
        }

        offset += safeBatch.length;
      }

      const rows: unknown[][] = [[
        t("\u0627\u0644\u0639\u0645\u064a\u0644\u0629"),
        t("\u0631\u0642\u0645 \u0627\u0644\u062c\u0648\u0627\u0644"),
        t("\u0627\u0644\u062d\u0627\u0644\u0629"),
        "VIP",
        t("\u0639\u062f\u062f \u0627\u0644\u062d\u062c\u0648\u0632\u0627\u062a"),
        t("\u0622\u062e\u0631 \u0632\u064a\u0627\u0631\u0629"),
        t("\u0627\u0644\u0645\u0635\u062f\u0631"),
      ]];

      exportedClients
        .map(coreClientToCustomerRow)
        .forEach((customer) => rows.push([
          normalizeCustomerName(customer.name),
          customer.phone === "\u2014" ? "" : customer.phone,
          getCustomerStatusLabel(customer.status, language),
          customer.vip
            ? "VIP"
            : t("\u0639\u0627\u062f\u064a\u0629"),
          customer.bookingsCount,
          formatCustomerLastVisit(
            customer.lastVisitDate,
            customer.lastVisitTime,
            language
          ),
          getCustomerSourceLabel(customer.source, language),
        ]));

      const date = new Date().toISOString().slice(0, 10);

      downloadXLSX(
        `malikat_clients_${date}.xlsx`,
        rows,
        "Clients"
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("\u062a\u0639\u0630\u0631 \u062a\u0635\u062f\u064a\u0631 \u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u0639\u0645\u064a\u0644\u0627\u062a.")
      );
    } finally {
      setLoading(false);
    }
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
  const noData =
    !loading &&
    !error &&
    !hasActiveFilters &&
    customers.length === 0;

  const noResults =
    !loading &&
    !error &&
    hasActiveFilters &&
    visibleCustomers.length === 0;

  return (
    <main className="dsv2-page dsv2-customers-page" dir={language === "en" ? "ltr" : "rtl"} lang={language}>
      <CustomersPageHeader visibleCount={visibleCustomers.length} totalCount={totalClients} language={language} />
      <CustomersSearchToolbar language={language} query={query} loading={loading} canImport={canImport} canExport={canExport} onQueryChange={setQuery} onImport={() => setImportOpen(true)} onExport={() => void exportCustomers()} onRefresh={() => void loadData()} />
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
          <div className="dsv2-customers-pagination" aria-label={language === "en" ? "Client pages" : "\u0635\u0641\u062d\u0627\u062a \u0627\u0644\u0639\u0645\u0644\u0627\u0621"}>
            <button
              type="button"
              className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm"
              disabled={loading || page === 0}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
            >
              {language === "en" ? "Previous" : "\u0627\u0644\u0633\u0627\u0628\u0642"}
            </button>
            <span>
              {language === "en"
                ? `Page ${page + 1}`
                : `\u0627\u0644\u0635\u0641\u062d\u0629 ${page + 1}`}
            </span>
            <button
              type="button"
              className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm"
              disabled={loading || !hasNextPage}
              onClick={() => setPage((current) => current + 1)}
            >
              {language === "en" ? "Next" : "\u0627\u0644\u062a\u0627\u0644\u064a"}
            </button>
          </div>
        </>
      ) : null}

      {selectedCustomer ? <CustomerRecordModal language={language} customer={selectedCustomer} onCustomerUpdated={handleCustomerUpdated} onClose={() => setSelectedCustomer(null)} /> : null}
      <CustomersImportModal
        language={language}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={async () => {
          setError("");
          await loadData();
        }}
      />
      {copyToast ? <div className="dsv2-customers-copy-toast" role="status">{copyToast}</div> : null}
    </main>
  );
}
