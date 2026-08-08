import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { DashboardErrorStateV2 } from "../components/dashboard-v2";
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
import { PackageOperationsService } from "../services/PackageOperationsService";
import { CoreClientService } from "../services/CoreClientService";
import { listCoreBookings, type BookingDocWithId } from "../services/firestoreBookings";
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

function bookingClientId(booking: BookingDocWithId): string {
  const row = booking as BookingDocWithId & { clientId?: unknown; userId?: unknown };
  return String(row.clientId ?? row.userId ?? "").trim();
}

function bookingCreatedAt(booking?: BookingDocWithId): string {
  if (!booking) return "";
  const row = booking as BookingDocWithId & { createdAt?: unknown; createdAtMs?: unknown };
  const raw = String(row.createdAt ?? "").trim();
  if (raw && Number.isFinite(Date.parse(raw))) return new Date(raw).toISOString();
  const timestamp = Number(row.createdAtMs || 0);
  return timestamp > 0 ? new Date(timestamp).toISOString() : "";
}

function sortBookingsNewest(first: BookingDocWithId, second: BookingDocWithId): number {
  const date = String(second.date || "").localeCompare(String(first.date || ""));
  return date || String(second.time || "").localeCompare(String(first.time || ""));
}

function riyadhDateKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function downloadXLSX(filename: string, rows: unknown[][], sheetName: string) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, filename);
}

function customerMatchesBooking(customer: CustomerRow, booking: BookingDocWithId): boolean {
  const clientId = bookingClientId(booking);
  if (customer.clientId && clientId) return customer.clientId === clientId;
  const customerPhone = customerPhoneDigits(customer.phone);
  const bookingPhone = customerPhoneDigits(booking.clientPhone);
  if (customerPhone && bookingPhone) return customerPhone === bookingPhone;
  return normalizeCustomerSearchText(customer.name) === normalizeCustomerSearchText(booking.clientName);
}

type DashboardClientsProps = { currentRole?: UiRole };

export default function DashboardClients({ currentRole = "guest" }: DashboardClientsProps) {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [bookings, setBookings] = useState<BookingDocWithId[]>([]);
  const [coreClients, setCoreClients] = useState<CoreClient[]>([]);
  const [activePackageKeys, setActivePackageKeys] = useState<Map<string, number>>(new Map());
  const [packagesFilterAvailable, setPackagesFilterAvailable] = useState(false);
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
    const [bookingsResult, clientsResult, packagesResult] = await Promise.allSettled([
      listCoreBookings(),
      CoreClientService.list(),
      PackageOperationsService.sessionDashboard(),
    ]);

    const errors: string[] = [];
    if (bookingsResult.status === "fulfilled") setBookings(Array.isArray(bookingsResult.value) ? bookingsResult.value : []);
    else {
      setBookings([]);
      errors.push(bookingsResult.reason instanceof Error ? bookingsResult.reason.message : "تعذر تحميل الحجوزات");
    }

    if (clientsResult.status === "fulfilled") setCoreClients(Array.isArray(clientsResult.value) ? clientsResult.value : []);
    else {
      setCoreClients([]);
      errors.push(clientsResult.reason instanceof Error ? clientsResult.reason.message : "تعذر تحميل ملفات العملاء");
    }

    if (packagesResult.status === "fulfilled") {
      const keys = new Map<string, number>();
      for (const pkg of packagesResult.value.packages || []) {
        if (pkg.status !== "active") continue;
        const id = String(pkg.canonicalClientId || "").trim();
        const phone = customerPhoneDigits(pkg.phone);
        if (id) keys.set(`id:${id}`, (keys.get(`id:${id}`) || 0) + 1);
        if (phone) keys.set(`phone:${phone}`, (keys.get(`phone:${phone}`) || 0) + 1);
      }
      setActivePackageKeys(keys);
      setPackagesFilterAvailable(true);
    } else {
      setActivePackageKeys(new Map());
      setPackagesFilterAvailable(false);
    }

    setError(errors.join(" · "));
    setLoading(false);
  }, [canViewClients]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const customers = useMemo<CustomerRow[]>(() => {
    type Group = { key: string; core?: CoreClient; bookings: BookingDocWithId[]; rawName: string; rawPhone: string };
    const coreById = new Map(coreClients.map((client) => [String(client.id), client]));
    const coreByPhone = new Map<string, CoreClient>();
    coreClients.forEach((client) => {
      const phone = customerPhoneDigits(client.phoneNormalized);
      if (phone) coreByPhone.set(phone, client);
    });
    const groups = new Map<string, Group>();

    bookings.forEach((booking) => {
      const id = bookingClientId(booking);
      const phoneDigits = customerPhoneDigits(booking.clientPhone);
      const core = (id ? coreById.get(id) : undefined) || (phoneDigits ? coreByPhone.get(phoneDigits) : undefined);
      const rawName = String(core?.name || booking.clientName || "").trim();
      const rawPhone = String(core?.phoneNormalized || booking.clientPhone || "").trim();
      const key = core?.id ? `id:${core.id}` : id ? `id:${id}` : phoneDigits ? `phone:${phoneDigits}` : `name:${normalizeCustomerSearchText(rawName)}`;
      const group: Group = groups.get(key) || { key, core, bookings: [], rawName, rawPhone };
      group.core ||= core;
      group.rawName ||= rawName;
      group.rawPhone ||= rawPhone;
      group.bookings.push(booking);
      groups.set(key, group);
    });

    coreClients.forEach((client) => {
      const key = `id:${client.id}`;
      if (!groups.has(key)) groups.set(key, { key, core: client, bookings: [], rawName: client.name, rawPhone: client.phoneNormalized });
    });

    const today = riyadhDateKey();
    return Array.from(groups.values()).map((group) => {
      const sortedBookings = [...group.bookings].sort(sortBookingsNewest);
      const completedVisits = sortedBookings.filter((booking) => booking.status !== "cancelled" && String(booking.date || "") <= today);
      const last = completedVisits[0];
      const phone = formatCustomerPhone(group.core?.phoneNormalized || group.rawPhone);
      const clientId = String(group.core?.id || bookingClientId(sortedBookings[0]) || "").trim() || undefined;
      const createdAt = String(group.core?.createdAt || bookingCreatedAt(sortedBookings.at(-1)) || "").trim() || undefined;
      const phoneKey = customerPhoneDigits(phone);
      const activePackagesCount = (clientId ? activePackageKeys.get(`id:${clientId}`) : 0) || (phoneKey ? activePackageKeys.get(`phone:${phoneKey}`) : 0) || 0;
      const sourceValue: CustomerSource = group.core && group.bookings.length ? "combined" : group.core ? "client-record" : "booking-only";
      return {
        key: group.key,
        clientId,
        legacyClientDocId: group.core?.legacyClientDocId || undefined,
        name: normalizeCustomerName(group.core?.name || group.rawName),
        phone,
        bookingsCount: group.bookings.length,
        lastVisitDate: String(last?.date || ""),
        lastVisitTime: String(last?.time || ""),
        vip: Boolean(group.core?.vip || (!group.core && group.bookings.length >= 5)),
        status: String(group.core?.status || "active"),
        importedNote: String(group.core?.notes || "").trim() || undefined,
        source: sourceValue,
        createdAt,
        activePackagesCount,
      };
    });
  }, [activePackageKeys, bookings, coreClients]);

  const stats = useMemo<CustomerStats>(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const newThisMonth = customers.filter((customer) => {
      if (!customer.createdAt) return false;
      const created = new Date(customer.createdAt);
      return !Number.isNaN(created.getTime()) && created.getMonth() === currentMonth && created.getFullYear() === currentYear;
    }).length;
    return {
      totalClients: customers.length,
      totalBookings: bookings.length,
      activeClients: customers.filter((customer) => isCustomerActive(customer.status)).length,
      newThisMonth,
      vipClients: customers.filter((customer) => customer.vip).length,
      averageBookings: customers.length ? bookings.length / customers.length : 0,
    };
  }, [bookings.length, customers]);

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
      if (sort === "most") return second.bookingsCount - first.bookingsCount || first.name.localeCompare(second.name, "ar");
      if (sort === "newest") return Date.parse(second.createdAt || "") - Date.parse(first.createdAt || "") || first.name.localeCompare(second.name, "ar");
      return customerLastVisitTimestamp(second.lastVisitDate, second.lastVisitTime) - customerLastVisitTimestamp(first.lastVisitDate, first.lastVisitTime) || first.name.localeCompare(second.name, "ar");
    });
  }, [customers, deferredQuery, lastVisit, segment, sort, source]);

  const selectedBookings = useMemo(() => selectedCustomer ? bookings.filter((booking) => customerMatchesBooking(selectedCustomer, booking)) : [], [bookings, selectedCustomer]);

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
      setCopyToast("تم نسخ رقم الجوال");
    } catch {
      setCopyToast("تعذر نسخ رقم الجوال");
    }
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopyToast(""), 1800);
  };

  const handleCustomerUpdated = (updated: CoreClient) => {
    setCoreClients((current) => current.map((client) => (
      client.id === updated.id ? updated : client
    )));
    setBookings((current) => current.map((booking) => (
      bookingClientId(booking) === updated.id
        ? { ...booking, clientName: updated.name, clientPhone: updated.phoneNormalized }
        : booking
    )));
    setSelectedCustomer((current) => current && current.clientId === updated.id
      ? {
          ...current,
          name: normalizeCustomerName(updated.name),
          phone: formatCustomerPhone(updated.phoneNormalized),
          status: updated.status,
          vip: Boolean(updated.vip),
          importedNote: String(updated.notes || "").trim() || undefined,
        }
      : current);
  };

  const exportCustomers = () => {
    const rows: unknown[][] = [["العميلة", "رقم الجوال", "الحالة", "VIP", "عدد الحجوزات", "آخر زيارة", "المصدر"]];
    visibleCustomers.forEach((customer) => rows.push([
      normalizeCustomerName(customer.name),
      customer.phone === "—" ? "" : customer.phone,
      getCustomerStatusLabel(customer.status),
      customer.vip ? "VIP" : "عادية",
      customer.bookingsCount,
      formatCustomerLastVisit(customer.lastVisitDate, customer.lastVisitTime),
      getCustomerSourceLabel(customer.source),
    ]));
    const date = new Date().toISOString().slice(0, 10);
    downloadXLSX(`queens_customers_${date}.xlsx`, rows, "Customers");
  };

  if (!canViewClients) {
    return (
      <main className="dsv2-page dsv2-customers-page" dir="rtl">
        <DashboardErrorStateV2
          title="غير مصرح"
          description="هذه الصفحة متاحة للإدارة والاستقبال حسب الصلاحيات الحالية."
          compact
        />
      </main>
    );
  }

  const fatalError = Boolean(error) && !loading && customers.length === 0;
  const noData = !loading && !error && customers.length === 0;
  const noResults = !loading && customers.length > 0 && visibleCustomers.length === 0;

  return (
    <main className="dsv2-page dsv2-customers-page" dir="rtl">
      <CustomersPageHeader visibleCount={visibleCustomers.length} totalCount={customers.length} />
      <CustomersSearchToolbar query={query} loading={loading} canImport={canImport} canExport={canExport} onQueryChange={setQuery} onImport={() => setImportOpen(true)} onExport={exportCustomers} onRefresh={() => void loadData()} />
      <CustomersFilters segment={segment} sort={sort} source={source} lastVisit={lastVisit} packagesFilterAvailable={packagesFilterAvailable} hasActiveFilters={hasActiveFilters} onSegmentChange={setSegment} onSortChange={setSort} onSourceChange={setSource} onLastVisitChange={setLastVisit} onClear={clearFilters} />
      <CustomersStatsGrid stats={stats} loading={loading && customers.length === 0} />

      {error && !fatalError ? (
        <div className="dsv2-customers-alert dsv2-customers-alert--error" role="alert">
          <span>{error}</span>
          <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" onClick={() => void loadData()}>إعادة المحاولة</button>
        </div>
      ) : null}
      {fatalError ? <CustomersEmptyState kind="error" message={error} onPrimary={() => void loadData()} /> : null}
      {noData ? <CustomersEmptyState kind="empty" canImport={canImport} onPrimary={() => navigate("/dashboard/booking-internal")} onImport={() => setImportOpen(true)} /> : null}
      {noResults ? <CustomersEmptyState kind="no-results" onPrimary={clearFilters} /> : null}
      {!fatalError && !noData && !noResults ? (
        <>
          <CustomersTable customers={visibleCustomers} loading={loading} onCopy={(phone) => void copyPhone(phone)} onOpen={setSelectedCustomer} />
          <CustomersMobileList customers={visibleCustomers} loading={loading} onCopy={(phone) => void copyPhone(phone)} onOpen={setSelectedCustomer} />
        </>
      ) : null}

      {selectedCustomer ? <CustomerRecordModal customer={selectedCustomer} bookings={selectedBookings} currentRole={currentRole} onCustomerUpdated={handleCustomerUpdated} onClose={() => setSelectedCustomer(null)} /> : null}
      <CustomersImportModal open={importOpen} existingClients={coreClients} onClose={() => setImportOpen(false)} onImported={(clients) => { setCoreClients(clients); setError(""); }} />
      {copyToast ? <div className="dsv2-customers-copy-toast" role="status">{copyToast}</div> : null}
    </main>
  );
}
