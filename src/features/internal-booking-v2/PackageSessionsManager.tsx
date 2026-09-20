import DashboardNumberInputV2 from "../../components/dashboard-v2/DashboardNumberInputV2";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  FiActivity,
  FiAlertTriangle,
  FiClock,
  FiEdit3,
  FiTrash2,
  FiPackage,
  FiPlus,
  FiMinus,
  FiRefreshCw,
  FiSearch,
  FiUsers,
} from "react-icons/fi";
import {
  DashboardDatePickerV2,
  DashboardDrawerV2,
  DashboardModalV2,
  DashboardSelectV2,
} from "../../components/dashboard-v2";
import {
  PackageOperationsService,
  type PackageCatalogRecord,
  type PackageSessionDashboardPackage,
  type PackageSessionDashboardResult,
  type PackageSessionDashboardTransaction,
} from "../../services/PackageOperationsService";
import { CoreClientService } from "../../services/CoreClientService";
import { bookingsText, type DashboardLanguage } from "../../helpers/dashboardBookingsLanguage";

type SessionsTab = "overview" | "subscribers" | "packages" | "ledger" | "expiring";

const EMPTY_DASHBOARD: PackageSessionDashboardResult = {
  summary: {
    subscribedClients: 0,
    totalPackages: 0,
    activePackages: 0,
    totalRemainingSessions: 0,
    totalUsedSessions: 0,
    totalReservedSessions: 0,
    expiringSoonCount: 0,
    exhaustedPackages: 0,
    expiredPackages: 0,
  },
  packages: [],
  transactions: [],
};

function dateText(value: string, language: DashboardLanguage = "ar") {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return "—";
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "ar-SA-u-nu-latn", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

function dateTimeText(value: string, language: DashboardLanguage = "ar") {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return "—";
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "ar-SA-u-nu-latn", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function statusLabel(status: string, language: DashboardLanguage = "ar") {
  if (status === "active") return bookingsText(language, "نشطة");
  if (status === "exhausted") return bookingsText(language, "مستنفدة");
  if (status === "expired") return bookingsText(language, "منتهية");
  if (status === "cancelled") return bookingsText(language, "ملغاة");
  return status || bookingsText(language, "غير محددة");
}

function transactionLabel(type: string, language: DashboardLanguage = "ar") {
  const labels: Record<string, string> = {
    purchase: "شراء باقة",
    reserve: "حجز جلسة",
    redeem: "استهلاك جلسة",
    consume: "تأكيد استهلاك",
    release: "إعادة جلسة محجوزة",
    restore: "استرجاع جلسة",
    cancel: "إلغاء باقة",
    admin_adjustment: "تعديل إداري",
    admin_grant: "إضافة جلسة يدوية",
    admin_restore: "استرجاع إداري",
  };
  return labels[type] ? bookingsText(language, labels[type]) : type || bookingsText(language, "حركة جلسة");
}

function matchesSearch(search: string, values: unknown[]) {
  const needle = search.trim().toLocaleLowerCase("ar");
  if (!needle) return true;
  return values.some((value) => String(value || "").toLocaleLowerCase("ar").includes(needle));
}

function normalizeSaudiPhone(value: string) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("00966")) digits = `966${digits.slice(5)}`;
  if (digits.startsWith("9660")) digits = `966${digits.slice(4)}`;
  if (/^9665\d{8}$/.test(digits)) return `0${digits.slice(3)}`;
  if (/^5\d{8}$/.test(digits)) return `0${digits}`;
  if (/^05\d{8}$/.test(digits)) return digits;
  return "";
}

function packageNeedsAttention(pkg: PackageSessionDashboardPackage) {
  if (pkg.status !== "active") return false;
  if (pkg.remainingSessions <= 2) return true;
  const expiry = Date.parse(pkg.expiresAt || "");
  if (!Number.isFinite(expiry)) return false;
  return expiry >= Date.now() && expiry <= Date.now() + 30 * 24 * 60 * 60 * 1000;
}

export default function PackageSessionsManager({ language = "ar" }: { language?: DashboardLanguage }) {
  const t = (text: string) => bookingsText(language, text);
  const [activeTab, setActiveTab] = useState<SessionsTab>("overview");
  const [dashboard, setDashboard] = useState<PackageSessionDashboardResult>(EMPTY_DASHBOARD);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [mutationLoading, setMutationLoading] = useState(false);
  const [catalog, setCatalog] = useState<PackageCatalogRecord[]>([]);
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantSaving, setGrantSaving] = useState(false);
  const [grantError, setGrantError] = useState("");
  const [grantSuccess, setGrantSuccess] = useState("");
  const [grantForm, setGrantForm] = useState({
    clientName: "",
    phone: "",
    packageCatalogId: "",
    sessionsCount: "1",
    expiresAt: "",
    reason: "",
  });
  const [adjustPackage, setAdjustPackage] = useState<PackageSessionDashboardPackage | null>(null);
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [adjustError, setAdjustError] = useState("");
  const [adjustForm, setAdjustForm] = useState({
    operation: "add" as "add" | "subtract",
    sessionsCount: "1",
    reason: "",
  });
  const [detailsPackage, setDetailsPackage] = useState<PackageSessionDashboardPackage | null>(null);
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [detailsForm, setDetailsForm] = useState({
    packageName: "",
    expiresAt: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await PackageOperationsService.sessionDashboard();
      setDashboard({
        summary: { ...EMPTY_DASHBOARD.summary, ...(result?.summary || {}) },
        packages: Array.isArray(result?.packages) ? result.packages : [],
        transactions: Array.isArray(result?.transactions) ? result.transactions : [],
      });
    } catch (loadError: any) {
      setError(String(loadError?.message || t("تعذر تحميل بيانات الباقات والجلسات.")));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    PackageOperationsService.listCatalog()
      .then((rows: PackageCatalogRecord[]) => {
        if (cancelled) return;
        const next = Array.isArray(rows) ? rows.filter((row) => row.active !== false) : [];
        setCatalog(next);
        setGrantForm((current) => ({
          ...current,
          packageCatalogId: current.packageCatalogId || next[0]?.id || "",
        }));
      })
      .catch(() => {
        if (!cancelled) setCatalog([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visiblePackages = useMemo(
    () => dashboard.packages.filter((pkg) => matchesSearch(search, [
      pkg.clientName,
      pkg.phone,
      pkg.canonicalClientId,
      pkg.packageName,
      pkg.invoiceId,
    ])),
    [dashboard.packages, search]
  );

  const activePackages = useMemo(
    () => visiblePackages.filter((pkg) => pkg.status === "active"),
    [visiblePackages]
  );

  const attentionPackages = useMemo(
    () => visiblePackages.filter(packageNeedsAttention),
    [visiblePackages]
  );

  const subscriberRows = useMemo(() => {
    const groups = new Map<string, {
      canonicalClientId: string;
      clientName: string;
      phone: string;
      packages: PackageSessionDashboardPackage[];
    }>();
    for (const pkg of activePackages) {
      const key = pkg.canonicalClientId || `${pkg.phone}:${pkg.clientName}`;
      const current = groups.get(key) || {
        canonicalClientId: pkg.canonicalClientId,
        clientName: pkg.clientName || t("عميلة بدون اسم"),
        phone: pkg.phone,
        packages: [],
      };
      current.packages.push(pkg);
      groups.set(key, current);
    }
    return [...groups.values()].sort((a, b) => a.clientName.localeCompare(b.clientName, "ar"));
  }, [activePackages]);

  const visibleTransactions = useMemo(
    () => dashboard.transactions.filter((row) => matchesSearch(search, [
      row.clientName,
      row.phone,
      row.packageName,
      row.bookingId,
      row.invoiceId,
      transactionLabel(row.type, language),
    ])),
    [dashboard.transactions, search]
  );

  const selectedClientPackages = useMemo(
    () => dashboard.packages.filter((pkg) => pkg.canonicalClientId === selectedClientId),
    [dashboard.packages, selectedClientId]
  );
  const selectedClientTransactions = useMemo(
    () => dashboard.transactions.filter((row) => row.canonicalClientId === selectedClientId),
    [dashboard.transactions, selectedClientId]
  );

  const openAdjustmentDialog = (pkg: PackageSessionDashboardPackage) => {
    if (mutationLoading || adjustSaving) return;
    setAdjustError("");
    setAdjustForm({ operation: "add", sessionsCount: "1", reason: "" });
    setAdjustPackage(pkg);
  };

  const submitAdjustment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!adjustPackage || adjustSaving) return;

    const sessionsCount = Number(adjustForm.sessionsCount);
    const reason = adjustForm.reason.trim();
    if (!Number.isInteger(sessionsCount) || sessionsCount < 1 || sessionsCount > 1000) {
      setAdjustError(t("عدد الجلسات يجب أن يكون رقمًا صحيحًا من 1 إلى 1000."));
      return;
    }
    if (!reason) {
      setAdjustError(t("اكتبي سبب التعديل ليظهر في سجل الجلسات."));
      return;
    }
    if (adjustForm.operation === "subtract" && sessionsCount > adjustPackage.remainingSessions) {
      setAdjustError(t("لا يمكن خصم عدد أكبر من الجلسات المتبقية."));
      return;
    }

    const sessionsDelta = adjustForm.operation === "add" ? sessionsCount : -sessionsCount;
    try {
      setAdjustSaving(true);
      setAdjustError("");
      await PackageOperationsService.adjust(adjustPackage.id, sessionsDelta, reason);
      setAdjustPackage(null);
      await load();
    } catch (error: any) {
      setAdjustError(String(error?.message || t("تعذر تعديل رصيد الجلسات.")));
    } finally {
      setAdjustSaving(false);
    }
  };

  const openPackageDetailsDialog = (pkg: PackageSessionDashboardPackage) => {
    if (mutationLoading || detailsSaving) return;
    setDetailsError("");
    setDetailsForm({
      packageName: pkg.packageName || "",
      expiresAt: String(pkg.expiresAt || "").slice(0, 10),
    });
    setDetailsPackage(pkg);
  };

  const submitPackageDetails = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detailsPackage || detailsSaving) return;
    const packageName = detailsForm.packageName.trim();
    if (!packageName) {
      setDetailsError(t("اكتبي اسم الباقة."));
      return;
    }
    try {
      setDetailsSaving(true);
      setDetailsError("");
      await PackageOperationsService.updateClientPackage({
        clientPackageId: detailsPackage.id,
        packageName,
        remainingSessions: detailsPackage.remainingSessions,
        expiresAt: detailsForm.expiresAt || undefined,
        status: detailsPackage.status,
      });
      setDetailsPackage(null);
      await load();
    } catch (error: any) {
      setDetailsError(String(error?.message || t("تعذر تعديل بيانات الباقة.")));
    } finally {
      setDetailsSaving(false);
    }
  };

  const deletePackage = async (pkg: PackageSessionDashboardPackage) => {
    if (mutationLoading) return;
    const ok = window.confirm(language === "en"
      ? `Permanently delete package ${pkg.packageName} from Cloudflare D1 along with its movement history?`
      : `حذف باقة ${pkg.packageName} نهائيًا من Cloudflare D1 مع سجل حركاتها؟`);
    if (!ok) return;
    try {
      setMutationLoading(true);
      await PackageOperationsService.deleteClientPackage(pkg.id);
      await load();
    } catch (error: any) {
      window.alert(String(error?.message || t("تعذر حذف الباقة.")));
    } finally {
      setMutationLoading(false);
    }
  };

  const openGrantDialog = () => {
    setGrantError("");
    setGrantSuccess("");
    setGrantForm((current) => ({
      ...current,
      packageCatalogId: current.packageCatalogId || catalog[0]?.id || "",
      sessionsCount: current.sessionsCount || "1",
    }));
    setGrantOpen(true);
  };

  const submitGrant = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (grantSaving) return;

    const clientName = grantForm.clientName.trim();
    const phone = normalizeSaudiPhone(grantForm.phone);
    const packageCatalogId = grantForm.packageCatalogId.trim();
    const sessionsCount = Number(grantForm.sessionsCount);

    if (!clientName) {
      setGrantError(t("أدخلي اسم العميلة."));
      return;
    }
    if (!phone) {
      setGrantError(t("أدخلي رقم جوال سعودي صحيح."));
      return;
    }
    if (!packageCatalogId) {
      setGrantError(t("اختاري الباقة أو الخدمة المرتبطة بالجلسة."));
      return;
    }
    if (!Number.isInteger(sessionsCount) || sessionsCount < 1 || sessionsCount > 1000) {
      setGrantError(t("عدد الجلسات يجب أن يكون رقمًا صحيحًا من 1 إلى 1000."));
      return;
    }

    try {
      setGrantSaving(true);
      setGrantError("");
      const clientCandidates = await CoreClientService.list(phone);
      const exactClients = clientCandidates.filter(
        (client) => normalizeSaudiPhone(String(client.phoneNormalized || "")) === phone
      );
      if (exactClients.length > 1) {
        throw new Error(
          t("يوجد أكثر من ملف عميلة بنفس رقم الجوال. يجب دمج الملفات المكررة أولًا.")
        );
      }
      const client =
        exactClients[0] ||
        (await CoreClientService.create({
          name: clientName,
          phone,
        }));

      const result = await PackageOperationsService.grantClientSessions({
        clientId: client.id,
        clientName,
        phone,
        packageCatalogId,
        sessionsCount,
        expiresAt: grantForm.expiresAt || undefined,
        reason: grantForm.reason.trim() || t("إضافة جلسة للعميلة من لوحة الإدارة"),
      });
      setGrantSuccess(
        language === "en"
        ? `Added ${result.sessionsCount} session(s) to ${clientName} successfully.`
        : `تمت إضافة ${result.sessionsCount} جلسة إلى ${clientName} بنجاح.`
      );
      setSearch(phone);
      setActiveTab("packages");
      await load();
      setGrantForm({
        clientName: "",
        phone: "",
        packageCatalogId: catalog[0]?.id || "",
        sessionsCount: "1",
        expiresAt: "",
        reason: "",
      });
    } catch (grantCause: any) {
      setGrantError(
        String(grantCause?.message || t("تعذر إضافة الجلسة للعميلة."))
      );
    } finally {
      setGrantSaving(false);
    }
  };

  const tabs: Array<{ id: SessionsTab; label: string }> = [
    { id: "overview", label: "نظرة عامة" },
    { id: "subscribers", label: "العميلات المشتركات" },
    { id: "packages", label: "الباقات" },
    { id: "ledger", label: "سجل الجلسات" },
    { id: "expiring", label: "تحتاج متابعة" },
  ];

  return (
    <section className="bk2-sessions-shell" aria-label={t("إدارة الباقات والجلسات")} dir={language === "en" ? "ltr" : "rtl"} lang={language}>
      <div className="bk2-sessions-toolbar">
        <div>
          <span className="bk2-sessions-kicker">Packages D1</span>
          <h2>{t("الباقات والجلسات")}</h2>
          <p>{t("إدارة اشتراكات العميلات، أرصدة الجلسات، والانتهاء وسجل الحركات من مصدر واحد.")}</p>
        </div>
        <div className="bk2-sessions-actions">
          <button type="button" className="bk2-sessions-add" onClick={openGrantDialog}>
            <FiPlus />
            {t("إضافة جلسة لعميلة")}
          </button>
          <button type="button" className="bk2-sessions-refresh" onClick={() => void load()} disabled={loading}>
            <FiRefreshCw className={loading ? "is-spinning" : ""} />
            {loading ? t("جاري التحديث") : t("تحديث البيانات")}
          </button>
        </div>
      </div>

      <div className="bk2-sessions-tabs" role="tablist" aria-label={t("أقسام إدارة الجلسات")}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? "is-active" : ""}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="bk2-sessions-error">
          <FiAlertTriangle />
          <div>
            <strong>{t("تعذر تحميل الباقات والجلسات")}</strong>
            <p>{error}</p>
          </div>
          <button type="button" onClick={() => void load()}>{t("إعادة المحاولة")}</button>
        </div>
      ) : null}

      {!error && activeTab !== "overview" ? (
        <label className="bk2-sessions-search">
          <FiSearch />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("ابحثي باسم العميلة أو الجوال أو الباقة أو رقم الحجز...")}
          />
        </label>
      ) : null}

      {!error && activeTab === "overview" ? (
        <>
          <div className="bk2-session-stats">
            <article><span><FiUsers /></span><small>{t("العميلات المشتركات")}</small><strong>{dashboard.summary.subscribedClients}</strong></article>
            <article><span><FiPackage /></span><small>{t("الباقات النشطة")}</small><strong>{dashboard.summary.activePackages}</strong></article>
            <article><span><FiActivity /></span><small>{t("الجلسات المتبقية")}</small><strong>{dashboard.summary.totalRemainingSessions}</strong></article>
            <article><span><FiClock /></span><small>{t("الجلسات المستخدمة")}</small><strong>{dashboard.summary.totalUsedSessions}</strong></article>
            <article className="is-warning"><span><FiAlertTriangle /></span><small>{t("تحتاج متابعة")}</small><strong>{dashboard.summary.expiringSoonCount + attentionPackages.filter((pkg) => pkg.remainingSessions <= 2).length}</strong></article>
          </div>

          <div className="bk2-session-overview-grid">
            <article className="bk2-session-panel">
              <header><div><h3>{t("الباقات التي تحتاج متابعة")}</h3><p>{t("رصيد منخفض أو انتهاء خلال 30 يومًا.")}</p></div><button type="button" onClick={() => setActiveTab("expiring")}>{t("عرض الكل")}</button></header>
              <div className="bk2-session-compact-list">
                {attentionPackages.slice(0, 6).map((pkg) => (
                  <button key={pkg.id} type="button" onClick={() => { setSelectedClientId(pkg.canonicalClientId); setActiveTab("subscribers"); }}>
                    <span><strong>{pkg.clientName || t("عميلة بدون اسم")}</strong><small>{pkg.packageName}</small></span>
                    <em>{pkg.remainingSessions} {t("جلسات")}</em>
                  </button>
                ))}
                {!loading && !attentionPackages.length ? <p className="bk2-session-empty">{t("لا توجد باقات تحتاج متابعة حاليًا.")}</p> : null}
              </div>
            </article>

            <article className="bk2-session-panel">
              <header><div><h3>{t("آخر حركات الجلسات")}</h3><p>{t("آخر عمليات الشراء والحجز والاستهلاك والاسترجاع.")}</p></div><button type="button" onClick={() => setActiveTab("ledger")}>{t("السجل الكامل")}</button></header>
              <div className="bk2-session-compact-list">
                {dashboard.transactions.slice(0, 6).map((row) => (
                  <div key={row.id} className="bk2-session-ledger-mini">
                    <span><strong>{row.clientName || t("عميلة بدون اسم")}</strong><small>{transactionLabel(row.type, language)} · {row.packageName}</small></span>
                    <em className={row.sessionsDelta < 0 ? "is-negative" : ""}>{row.sessionsDelta > 0 ? "+" : ""}{row.sessionsDelta}</em>
                  </div>
                ))}
                {!loading && !dashboard.transactions.length ? <p className="bk2-session-empty">{t("لا توجد حركات جلسات مسجلة حتى الآن.")}</p> : null}
              </div>
            </article>
          </div>
        </>
      ) : null}

      {!error && activeTab === "subscribers" ? (
        <div className="bk2-session-table-wrap">
          <table className="bk2-session-table">
            <thead><tr><th>{t("العميلة")}</th><th>{t("الجوال")}</th><th>{t("الباقات النشطة")}</th><th>{t("الإجمالي")}</th><th>{t("المستخدم")}</th><th>{t("المتبقي")}</th><th>{t("المحجوز")}</th><th>{t("الإجراء")}</th></tr></thead>
            <tbody>
              {subscriberRows.map((client) => {
                const totals = client.packages.reduce((acc, pkg) => ({
                  total: acc.total + pkg.totalSessions,
                  used: acc.used + pkg.usedSessions,
                  remaining: acc.remaining + pkg.remainingSessions,
                  reserved: acc.reserved + pkg.reservedSessions,
                }), { total: 0, used: 0, remaining: 0, reserved: 0 });
                return (
                  <tr key={client.canonicalClientId || client.phone}>
                    <td><strong>{client.clientName}</strong><small>{client.canonicalClientId}</small></td>
                    <td dir="ltr">{client.phone || "—"}</td>
                    <td>{client.packages.length}</td><td>{totals.total}</td><td>{totals.used}</td><td><b>{totals.remaining}</b></td><td>{totals.reserved}</td>
                    <td><button type="button" onClick={() => setSelectedClientId(client.canonicalClientId)}>{t("عرض المحفظة")}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && !subscriberRows.length ? <p className="bk2-session-empty">{t("لا توجد عميلات مشتركات مطابقة للبحث.")}</p> : null}
        </div>
      ) : null}

      {!error && activeTab === "packages" ? (
        <div className="bk2-session-table-wrap">
          <table className="bk2-session-table">
            <thead><tr><th>{t("العميلة")}</th><th>{t("الباقة")}</th><th>{t("الإجمالي")}</th><th>{t("المستخدم")}</th><th>{t("المتبقي")}</th><th>{t("المحجوز")}</th><th>{t("الانتهاء")}</th><th>{t("الحالة")}</th><th>{t("الإجراء")}</th></tr></thead>
            <tbody>{visiblePackages.map((pkg) => (
              <tr key={pkg.id}>
                <td><strong>{pkg.clientName || t("عميلة بدون اسم")}</strong><small dir="ltr">{pkg.phone || pkg.canonicalClientId}</small></td>
                <td><strong>{pkg.packageName}</strong><small>{pkg.invoiceId ? `${t("فاتورة")} ${pkg.invoiceId}` : t("بدون رقم فاتورة")}</small></td>
                <td>{pkg.totalSessions}</td><td>{pkg.usedSessions}</td><td><b>{pkg.remainingSessions}</b></td><td>{pkg.reservedSessions}</td><td>{dateText(pkg.expiresAt, language)}</td>
                <td><span className={`bk2-session-status is-${pkg.status}`}>{statusLabel(pkg.status, language)}</span></td>
                <td>
                  <div className="bk2-session-row-actions">
                    <button type="button" className="is-adjust" onClick={() => openAdjustmentDialog(pkg)} disabled={mutationLoading || adjustSaving}>
                      <FiActivity /> {t("تعديل الجلسات")}
                    </button>
                    <button type="button" onClick={() => openPackageDetailsDialog(pkg)} disabled={mutationLoading || detailsSaving}>
                      <FiEdit3 /> {t("بيانات الباقة")}
                    </button>
                    <button type="button" className="is-delete" onClick={() => void deletePackage(pkg)} disabled={mutationLoading}>
                      <FiTrash2 /> {t("حذف")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table>
          {!loading && !visiblePackages.length ? <p className="bk2-session-empty">{t("لا توجد باقات مطابقة للبحث.")}</p> : null}
        </div>
      ) : null}

      {!error && activeTab === "ledger" ? (
        <div className="bk2-session-table-wrap">
          <table className="bk2-session-table">
            <thead><tr><th>{t("التاريخ")}</th><th>{t("العميلة")}</th><th>{t("الباقة")}</th><th>{t("نوع الحركة")}</th><th>{t("التغير")}</th><th>{t("الرصيد قبل")}</th><th>{t("الرصيد بعد")}</th><th>{t("رقم الحجز")}</th></tr></thead>
            <tbody>{visibleTransactions.map((row: PackageSessionDashboardTransaction) => (
              <tr key={row.id}>
                <td>{dateTimeText(row.createdAt, language)}</td><td><strong>{row.clientName || "عميلة بدون اسم"}</strong><small dir="ltr">{row.phone || row.canonicalClientId}</small></td><td>{row.packageName || "—"}</td><td>{transactionLabel(row.type, language)}</td>
                <td><b className={row.sessionsDelta < 0 ? "bk2-session-negative" : "bk2-session-positive"}>{row.sessionsDelta > 0 ? "+" : ""}{row.sessionsDelta}</b></td><td>{row.remainingBefore}</td><td>{row.remainingAfter}</td><td dir="ltr">{row.bookingId || "—"}</td>
              </tr>
            ))}</tbody>
          </table>
          {!loading && !visibleTransactions.length ? <p className="bk2-session-empty">{t("لا توجد حركات مطابقة للبحث.")}</p> : null}
        </div>
      ) : null}

      {!error && activeTab === "expiring" ? (
        <div className="bk2-session-attention-grid">
          {attentionPackages.map((pkg) => (
            <article key={pkg.id}>
              <header><span><FiAlertTriangle /></span><div><strong>{pkg.clientName || t("عميلة بدون اسم")}</strong><small dir="ltr">{pkg.phone || pkg.canonicalClientId}</small></div></header>
              <h3>{pkg.packageName}</h3>
              <dl><div><dt>{t("المتبقي")}</dt><dd>{pkg.remainingSessions} {t("من")} {pkg.totalSessions}</dd></div><div><dt>{t("تاريخ الانتهاء")}</dt><dd>{dateText(pkg.expiresAt, language)}</dd></div></dl>
              <button type="button" onClick={() => { setSelectedClientId(pkg.canonicalClientId); setActiveTab("subscribers"); }}>{t("فتح محفظة العميلة")}</button>
            </article>
          ))}
          {!loading && !attentionPackages.length ? <p className="bk2-session-empty">{t("لا توجد باقات تحتاج متابعة.")}</p> : null}
        </div>
      ) : null}

      <DashboardDrawerV2
        open={Boolean(selectedClientId)}
        onClose={() => setSelectedClientId("")}
        eyebrow={t("محفظة الجلسات")}
        title={selectedClientPackages[0]?.clientName || t("محفظة العميلة")}
        description={<span dir="ltr">{selectedClientPackages[0]?.phone || selectedClientId}</span>}
        size="md"
        side="end"
        className="bk2-session-wallet-drawer"
      >
        <div className="bk2-session-wallet-packages">
          {selectedClientPackages.map((pkg) => (
            <article key={pkg.id}><div><strong>{pkg.packageName}</strong><small>{statusLabel(pkg.status, language)} · تنتهي {dateText(pkg.expiresAt, language)}</small></div><b>{pkg.remainingSessions}<small> {t("جلسات")}</small></b></article>
          ))}
        </div>
        <h4 className="bk2-session-wallet-heading">{t("آخر الحركات")}</h4>
        <div className="bk2-session-wallet-ledger">
          {selectedClientTransactions.slice(0, 12).map((row) => (
            <div key={row.id}><span><strong>{transactionLabel(row.type, language)}</strong><small>{dateTimeText(row.createdAt, language)}</small></span><b>{row.sessionsDelta > 0 ? "+" : ""}{row.sessionsDelta}</b></div>
          ))}
          {!selectedClientTransactions.length ? <p>{t("لا توجد حركات مسجلة.")}</p> : null}
        </div>
      </DashboardDrawerV2>

      <DashboardModalV2
        open={Boolean(adjustPackage)}
        onClose={() => { if (!adjustSaving) setAdjustPackage(null); }}
        eyebrow={t("إدارة الرصيد")}
        title={t("تعديل جلسات الباقة")}
        description={t("التعديل يطبّق على الباقة الحالية فقط، ويُحفظ كحركة إدارية في سجل الجلسات.")}
        size="md"
        tone="success"
        closeOnBackdrop={!adjustSaving}
        closeOnEscape={!adjustSaving}
        className="bk2-session-v2-modal"
        footer={adjustPackage ? (
          <div className="bk2-session-v2-actions">
            <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => setAdjustPackage(null)} disabled={adjustSaving}>{t("إلغاء")}</button>
            <button type="submit" form="bk2-adjust-sessions-form" className="dsv2-btn dsv2-btn--primary" disabled={adjustSaving}>
              {adjustSaving ? t("جاري الحفظ...") : t("حفظ تعديل الجلسات")}
            </button>
          </div>
        ) : null}
      >
        {adjustPackage ? (
          <form id="bk2-adjust-sessions-form" className="bk2-session-v2-form" onSubmit={submitAdjustment}>
            <dl className="bk2-session-adjust-summary">
              <div><dt>{t("العميلة")}</dt><dd>{adjustPackage.clientName || "عميلة بدون اسم"}</dd></div>
              <div><dt>{t("الجوال")}</dt><dd dir="ltr">{adjustPackage.phone || "—"}</dd></div>
              <div><dt>{t("الباقة")}</dt><dd>{adjustPackage.packageName}</dd></div>
              <div><dt>{t("الرصيد الحالي")}</dt><dd>{adjustPackage.remainingSessions} {t("جلسات")}</dd></div>
              <div><dt>{t("المحجوز")}</dt><dd>{adjustPackage.reservedSessions} {t("جلسات")}</dd></div>
            </dl>

            <div className="bk2-session-adjust-operation" role="group" aria-label={t("نوع التعديل")}>
              <button
                type="button"
                className={adjustForm.operation === "add" ? "is-active" : ""}
                onClick={() => setAdjustForm((current) => ({ ...current, operation: "add" }))}
                disabled={adjustSaving}
              >
                <FiPlus /> {t("إضافة جلسات")}
              </button>
              <button
                type="button"
                className={adjustForm.operation === "subtract" ? "is-active is-subtract" : ""}
                onClick={() => setAdjustForm((current) => ({ ...current, operation: "subtract" }))}
                disabled={adjustSaving}
              >
                <FiMinus /> {t("خصم جلسات")}
              </button>
            </div>

            <div className="bk2-session-grant-grid bk2-session-adjust-fields">
              <label>
                <span>{t("عدد الجلسات")} *</span>
                <DashboardNumberInputV2
                  autoFocus
                  min={1}
                  max={1000}
                  value={adjustForm.sessionsCount}
                  onChange={(event) => setAdjustForm((current) => ({ ...current, sessionsCount: event.target.value }))}
                  disabled={adjustSaving}
                />
              </label>
              <label className="is-wide">
                <span>{t("سبب التعديل")} *</span>
                <textarea
                  rows={3}
                  value={adjustForm.reason}
                  onChange={(event) => setAdjustForm((current) => ({ ...current, reason: event.target.value }))}
                  placeholder={t("مثال: تعويض جلسة أو تصحيح رصيد")}
                  disabled={adjustSaving}
                />
              </label>
            </div>

            {(() => {
              const count = Number(adjustForm.sessionsCount);
              const validCount = Number.isInteger(count) && count > 0 ? count : 0;
              const delta = adjustForm.operation === "add" ? validCount : -validCount;
              const after = Math.max(0, adjustPackage.remainingSessions + delta);
              return (
                <div className={`bk2-session-balance-preview ${adjustForm.operation === "subtract" ? "is-subtract" : ""}`}>
                  <span><small>{t("الرصيد الحالي")}</small><strong>{adjustPackage.remainingSessions}</strong></span>
                  <b>{delta > 0 ? `+${delta}` : delta}</b>
                  <span><small>{t("الرصيد بعد التعديل")}</small><strong>{after}</strong></span>
                </div>
              );
            })()}

            {adjustError ? <div className="bk2-session-grant-message is-error">{adjustError}</div> : null}
          </form>
        ) : null}
      </DashboardModalV2>

      <DashboardModalV2
        open={Boolean(detailsPackage)}
        onClose={() => { if (!detailsSaving) setDetailsPackage(null); }}
        eyebrow={t("بيانات الباقة")}
        title={t("تعديل بيانات الباقة")}
        description={t("عدّلي اسم الباقة أو تاريخ الانتهاء فقط. رصيد الجلسات له إجراء مستقل ومحفوظ في السجل.")}
        size="sm"
        closeOnBackdrop={!detailsSaving}
        closeOnEscape={!detailsSaving}
        className="bk2-session-v2-modal"
        footer={detailsPackage ? (
          <div className="bk2-session-v2-actions">
            <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => setDetailsPackage(null)} disabled={detailsSaving}>{t("إلغاء")}</button>
            <button type="submit" form="bk2-package-details-form" className="dsv2-btn dsv2-btn--primary" disabled={detailsSaving}>
              {detailsSaving ? t("جاري الحفظ...") : t("حفظ بيانات الباقة")}
            </button>
          </div>
        ) : null}
      >
        {detailsPackage ? (
          <form id="bk2-package-details-form" className="bk2-session-v2-form" onSubmit={submitPackageDetails}>
            <div className="bk2-session-grant-grid">
              <label className="is-wide">
                <span>{t("اسم الباقة")} *</span>
                <input
                  autoFocus
                  value={detailsForm.packageName}
                  onChange={(event) => setDetailsForm((current) => ({ ...current, packageName: event.target.value }))}
                  disabled={detailsSaving}
                />
              </label>
              <div className="bk2-session-v2-field is-wide">
                <span>{t("تاريخ الانتهاء")}</span>
                <DashboardDatePickerV2
                  value={detailsForm.expiresAt}
                  onChange={(value) => setDetailsForm((current) => ({ ...current, expiresAt: value }))}
                  disabled={detailsSaving}
                  className="bk2-session-v2-control"
                />
              </div>
            </div>
            {detailsError ? <div className="bk2-session-grant-message is-error">{detailsError}</div> : null}
          </form>
        ) : null}
      </DashboardModalV2>

      <DashboardModalV2
        open={grantOpen}
        onClose={() => { if (!grantSaving) setGrantOpen(false); }}
        eyebrow={t("جلسة يدوية")}
        title={t("إضافة جلسة لعميلة")}
        description={t("أدخلي بيانات العميلة وحددي الباقة وعدد الجلسات. إذا لم يكن لها ملف، سيتم إنشاؤه تلقائيًا داخل Core D1.")}
        size="lg"
        tone="success"
        closeOnBackdrop={!grantSaving}
        closeOnEscape={!grantSaving}
        className="bk2-session-v2-modal bk2-session-v2-modal--grant"
        footer={(
          <div className="bk2-session-v2-actions">
            <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => setGrantOpen(false)} disabled={grantSaving}>{t("إلغاء")}</button>
            <button type="submit" form="bk2-grant-session-form" className="dsv2-btn dsv2-btn--primary" disabled={grantSaving || !catalog.length}>
              {grantSaving ? t("جاري الإضافة...") : t("حفظ وإضافة الجلسة")}
            </button>
          </div>
        )}
      >
        <form id="bk2-grant-session-form" className="bk2-session-v2-form" onSubmit={submitGrant}>
          <div className="bk2-session-grant-grid">
            <label>
              <span>{t("اسم العميلة")} *</span>
              <input
                autoFocus
                value={grantForm.clientName}
                onChange={(event) =>
                  setGrantForm((current) => ({
                    ...current,
                    clientName: event.target.value,
                  }))
                }
                placeholder={t("مثال: غادة العليان")}
                disabled={grantSaving}
              />
            </label>

            <label>
              <span>{t("رقم الجوال")} *</span>
              <input
                dir="ltr"
                inputMode="tel"
                value={grantForm.phone}
                onChange={(event) =>
                  setGrantForm((current) => ({
                    ...current,
                    phone: event.target.value,
                  }))
                }
                placeholder="05xxxxxxxx"
                disabled={grantSaving}
              />
            </label>

            <div className="bk2-session-v2-field is-wide">
              <span>{t("الباقة أو الخدمة المرتبطة")} *</span>
              <DashboardSelectV2
                value={grantForm.packageCatalogId}
                options={catalog.map((item) => ({
                  value: item.id,
                  label: `${item.name} · ${item.sessionsCount} ${t("جلسات في الكتالوج")}`,
                }))}
                placeholder={catalog.length ? t("اختاري الباقة أو الخدمة") : t("لا توجد باقات نشطة")}
                disabled={grantSaving || !catalog.length}
                className="bk2-session-v2-control"
                onChange={(value) =>
                  setGrantForm((current) => ({
                    ...current,
                    packageCatalogId: value,
                  }))
                }
              />
            </div>

            <label>
              <span>{t("عدد الجلسات المراد إضافتها")} *</span>
              <DashboardNumberInputV2
                min={1}
                max={1000}
                value={grantForm.sessionsCount}
                onChange={(event) =>
                  setGrantForm((current) => ({
                    ...current,
                    sessionsCount: event.target.value,
                  }))
                }
                disabled={grantSaving}
              />
            </label>

            <div className="bk2-session-v2-field">
              <span>{t("تاريخ الانتهاء")}</span>
              <DashboardDatePickerV2
                value={grantForm.expiresAt}
                onChange={(value) =>
                  setGrantForm((current) => ({
                    ...current,
                    expiresAt: value,
                  }))
                }
                disabled={grantSaving}
                className="bk2-session-v2-control"
              />
            </div>

            <label className="is-wide">
              <span>{t("ملاحظة")}</span>
              <textarea
                rows={3}
                value={grantForm.reason}
                onChange={(event) =>
                  setGrantForm((current) => ({
                    ...current,
                    reason: event.target.value,
                  }))
                }
                placeholder={t("سبب الإضافة أو أي ملاحظة داخلية")}
                disabled={grantSaving}
              />
            </label>
          </div>

          {grantError ? (
            <div className="bk2-session-grant-message is-error">{grantError}</div>
          ) : null}
          {grantSuccess ? (
            <div className="bk2-session-grant-message is-success">{grantSuccess}</div>
          ) : null}
        </form>
      </DashboardModalV2>

      {loading && !dashboard.packages.length ? <div className="bk2-session-loading">{t("جاري تحميل بيانات الباقات والجلسات...")}</div> : null}
    </section>
  );
}
