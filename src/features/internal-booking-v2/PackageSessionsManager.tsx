import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  FiActivity,
  FiAlertTriangle,
  FiClock,
  FiEdit3,
  FiTrash2,
  FiPackage,
  FiPlus,
  FiRefreshCw,
  FiX,
  FiSearch,
  FiUsers,
} from "react-icons/fi";
import {
  PackageOperationsService,
  type PackageCatalogRecord,
  type PackageSessionDashboardPackage,
  type PackageSessionDashboardResult,
  type PackageSessionDashboardTransaction,
} from "../../services/PackageOperationsService";
import { CoreClientService } from "../../services/CoreClientService";

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

function dateText(value: string) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return "—";
  return new Intl.DateTimeFormat("ar-SA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

function dateTimeText(value: string) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return "—";
  return new Intl.DateTimeFormat("ar-SA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function statusLabel(status: string) {
  if (status === "active") return "نشطة";
  if (status === "exhausted") return "مستنفدة";
  if (status === "expired") return "منتهية";
  if (status === "cancelled") return "ملغاة";
  return status || "غير محددة";
}

function transactionLabel(type: string) {
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
  return labels[type] || type || "حركة جلسة";
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

export default function PackageSessionsManager() {
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
      setError(String(loadError?.message || "تعذر تحميل بيانات الباقات والجلسات."));
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
        clientName: pkg.clientName || "عميلة بدون اسم",
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
      transactionLabel(row.type),
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

  const editPackage = async (pkg: PackageSessionDashboardPackage) => {
    if (mutationLoading) return;
    const packageName = window.prompt("اسم الباقة", pkg.packageName || "");
    if (packageName === null) return;
    const remainingRaw = window.prompt("عدد الجلسات المتبقية", String(pkg.remainingSessions));
    if (remainingRaw === null) return;
    const remainingSessions = Number(remainingRaw);
    if (!packageName.trim() || !Number.isInteger(remainingSessions) || remainingSessions < 0) {
      window.alert("تحققي من اسم الباقة وعدد الجلسات المتبقية.");
      return;
    }
    const expiresAt = window.prompt("تاريخ الانتهاء بصيغة YYYY-MM-DD، أو اتركيه فارغًا", String(pkg.expiresAt || "").slice(0, 10));
    if (expiresAt === null) return;
    try {
      setMutationLoading(true);
      await PackageOperationsService.updateClientPackage({
        clientPackageId: pkg.id,
        packageName: packageName.trim(),
        remainingSessions,
        expiresAt: expiresAt.trim() || undefined,
        status: pkg.status,
      });
      await load();
    } catch (error: any) {
      window.alert(String(error?.message || "تعذر تعديل الباقة."));
    } finally {
      setMutationLoading(false);
    }
  };

  const deletePackage = async (pkg: PackageSessionDashboardPackage) => {
    if (mutationLoading) return;
    const ok = window.confirm(`حذف باقة ${pkg.packageName} نهائيًا من Cloudflare D1 مع سجل حركاتها؟`);
    if (!ok) return;
    try {
      setMutationLoading(true);
      await PackageOperationsService.deleteClientPackage(pkg.id);
      await load();
    } catch (error: any) {
      window.alert(String(error?.message || "تعذر حذف الباقة."));
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
      setGrantError("أدخلي اسم العميلة.");
      return;
    }
    if (!phone) {
      setGrantError("أدخلي رقم جوال سعودي صحيح.");
      return;
    }
    if (!packageCatalogId) {
      setGrantError("اختاري الباقة أو الخدمة المرتبطة بالجلسة.");
      return;
    }
    if (!Number.isInteger(sessionsCount) || sessionsCount < 1 || sessionsCount > 1000) {
      setGrantError("عدد الجلسات يجب أن يكون رقمًا صحيحًا من 1 إلى 1000.");
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
          "يوجد أكثر من ملف عميلة بنفس رقم الجوال. يجب دمج الملفات المكررة أولًا."
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
        reason: grantForm.reason.trim() || "إضافة جلسة للعميلة من لوحة الإدارة",
      });
      setGrantSuccess(
        `تمت إضافة ${result.sessionsCount} جلسة إلى ${clientName} بنجاح.`
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
        String(grantCause?.message || "تعذر إضافة الجلسة للعميلة.")
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
    <section className="bk2-sessions-shell" aria-label="إدارة الباقات والجلسات">
      <div className="bk2-sessions-toolbar">
        <div>
          <span className="bk2-sessions-kicker">Packages D1</span>
          <h2>الباقات والجلسات</h2>
          <p>إدارة اشتراكات العميلات، أرصدة الجلسات، والانتهاء وسجل الحركات من مصدر واحد.</p>
        </div>
        <div className="bk2-sessions-actions">
          <button type="button" className="bk2-sessions-add" onClick={openGrantDialog}>
            <FiPlus />
            إضافة جلسة لعميلة
          </button>
          <button type="button" className="bk2-sessions-refresh" onClick={() => void load()} disabled={loading}>
            <FiRefreshCw className={loading ? "is-spinning" : ""} />
            {loading ? "جاري التحديث" : "تحديث البيانات"}
          </button>
        </div>
      </div>

      <div className="bk2-sessions-tabs" role="tablist" aria-label="أقسام إدارة الجلسات">
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
            <strong>تعذر تحميل الباقات والجلسات</strong>
            <p>{error}</p>
          </div>
          <button type="button" onClick={() => void load()}>إعادة المحاولة</button>
        </div>
      ) : null}

      {!error && activeTab !== "overview" ? (
        <label className="bk2-sessions-search">
          <FiSearch />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ابحثي باسم العميلة أو الجوال أو الباقة أو رقم الحجز..."
          />
        </label>
      ) : null}

      {!error && activeTab === "overview" ? (
        <>
          <div className="bk2-session-stats">
            <article><span><FiUsers /></span><small>العميلات المشتركات</small><strong>{dashboard.summary.subscribedClients}</strong></article>
            <article><span><FiPackage /></span><small>الباقات النشطة</small><strong>{dashboard.summary.activePackages}</strong></article>
            <article><span><FiActivity /></span><small>الجلسات المتبقية</small><strong>{dashboard.summary.totalRemainingSessions}</strong></article>
            <article><span><FiClock /></span><small>الجلسات المستخدمة</small><strong>{dashboard.summary.totalUsedSessions}</strong></article>
            <article className="is-warning"><span><FiAlertTriangle /></span><small>تحتاج متابعة</small><strong>{dashboard.summary.expiringSoonCount + attentionPackages.filter((pkg) => pkg.remainingSessions <= 2).length}</strong></article>
          </div>

          <div className="bk2-session-overview-grid">
            <article className="bk2-session-panel">
              <header><div><h3>الباقات التي تحتاج متابعة</h3><p>رصيد منخفض أو انتهاء خلال 30 يومًا.</p></div><button type="button" onClick={() => setActiveTab("expiring")}>عرض الكل</button></header>
              <div className="bk2-session-compact-list">
                {attentionPackages.slice(0, 6).map((pkg) => (
                  <button key={pkg.id} type="button" onClick={() => { setSelectedClientId(pkg.canonicalClientId); setActiveTab("subscribers"); }}>
                    <span><strong>{pkg.clientName || "عميلة بدون اسم"}</strong><small>{pkg.packageName}</small></span>
                    <em>{pkg.remainingSessions} جلسات</em>
                  </button>
                ))}
                {!loading && !attentionPackages.length ? <p className="bk2-session-empty">لا توجد باقات تحتاج متابعة حاليًا.</p> : null}
              </div>
            </article>

            <article className="bk2-session-panel">
              <header><div><h3>آخر حركات الجلسات</h3><p>آخر عمليات الشراء والحجز والاستهلاك والاسترجاع.</p></div><button type="button" onClick={() => setActiveTab("ledger")}>السجل الكامل</button></header>
              <div className="bk2-session-compact-list">
                {dashboard.transactions.slice(0, 6).map((row) => (
                  <div key={row.id} className="bk2-session-ledger-mini">
                    <span><strong>{row.clientName || "عميلة بدون اسم"}</strong><small>{transactionLabel(row.type)} · {row.packageName}</small></span>
                    <em className={row.sessionsDelta < 0 ? "is-negative" : ""}>{row.sessionsDelta > 0 ? "+" : ""}{row.sessionsDelta}</em>
                  </div>
                ))}
                {!loading && !dashboard.transactions.length ? <p className="bk2-session-empty">لا توجد حركات جلسات مسجلة حتى الآن.</p> : null}
              </div>
            </article>
          </div>
        </>
      ) : null}

      {!error && activeTab === "subscribers" ? (
        <div className="bk2-session-table-wrap">
          <table className="bk2-session-table">
            <thead><tr><th>العميلة</th><th>الجوال</th><th>الباقات النشطة</th><th>الإجمالي</th><th>المستخدم</th><th>المتبقي</th><th>المحجوز</th><th>الإجراء</th></tr></thead>
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
                    <td><button type="button" onClick={() => setSelectedClientId(client.canonicalClientId)}>عرض المحفظة</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && !subscriberRows.length ? <p className="bk2-session-empty">لا توجد عميلات مشتركات مطابقة للبحث.</p> : null}
        </div>
      ) : null}

      {!error && activeTab === "packages" ? (
        <div className="bk2-session-table-wrap">
          <table className="bk2-session-table">
            <thead><tr><th>العميلة</th><th>الباقة</th><th>الإجمالي</th><th>المستخدم</th><th>المتبقي</th><th>المحجوز</th><th>الانتهاء</th><th>الحالة</th><th>الإجراء</th></tr></thead>
            <tbody>{visiblePackages.map((pkg) => (
              <tr key={pkg.id}>
                <td><strong>{pkg.clientName || "عميلة بدون اسم"}</strong><small dir="ltr">{pkg.phone || pkg.canonicalClientId}</small></td>
                <td><strong>{pkg.packageName}</strong><small>{pkg.invoiceId ? `فاتورة ${pkg.invoiceId}` : "بدون رقم فاتورة"}</small></td>
                <td>{pkg.totalSessions}</td><td>{pkg.usedSessions}</td><td><b>{pkg.remainingSessions}</b></td><td>{pkg.reservedSessions}</td><td>{dateText(pkg.expiresAt)}</td>
                <td><span className={`bk2-session-status is-${pkg.status}`}>{statusLabel(pkg.status)}</span></td>
                <td><button type="button" onClick={() => void editPackage(pkg)} disabled={mutationLoading}><FiEdit3 /> تعديل</button> <button type="button" onClick={() => void deletePackage(pkg)} disabled={mutationLoading}><FiTrash2 /> حذف</button></td>
              </tr>
            ))}</tbody>
          </table>
          {!loading && !visiblePackages.length ? <p className="bk2-session-empty">لا توجد باقات مطابقة للبحث.</p> : null}
        </div>
      ) : null}

      {!error && activeTab === "ledger" ? (
        <div className="bk2-session-table-wrap">
          <table className="bk2-session-table">
            <thead><tr><th>التاريخ</th><th>العميلة</th><th>الباقة</th><th>نوع الحركة</th><th>التغير</th><th>الرصيد قبل</th><th>الرصيد بعد</th><th>رقم الحجز</th></tr></thead>
            <tbody>{visibleTransactions.map((row: PackageSessionDashboardTransaction) => (
              <tr key={row.id}>
                <td>{dateTimeText(row.createdAt)}</td><td><strong>{row.clientName || "عميلة بدون اسم"}</strong><small dir="ltr">{row.phone || row.canonicalClientId}</small></td><td>{row.packageName || "—"}</td><td>{transactionLabel(row.type)}</td>
                <td><b className={row.sessionsDelta < 0 ? "bk2-session-negative" : "bk2-session-positive"}>{row.sessionsDelta > 0 ? "+" : ""}{row.sessionsDelta}</b></td><td>{row.remainingBefore}</td><td>{row.remainingAfter}</td><td dir="ltr">{row.bookingId || "—"}</td>
              </tr>
            ))}</tbody>
          </table>
          {!loading && !visibleTransactions.length ? <p className="bk2-session-empty">لا توجد حركات مطابقة للبحث.</p> : null}
        </div>
      ) : null}

      {!error && activeTab === "expiring" ? (
        <div className="bk2-session-attention-grid">
          {attentionPackages.map((pkg) => (
            <article key={pkg.id}>
              <header><span><FiAlertTriangle /></span><div><strong>{pkg.clientName || "عميلة بدون اسم"}</strong><small dir="ltr">{pkg.phone || pkg.canonicalClientId}</small></div></header>
              <h3>{pkg.packageName}</h3>
              <dl><div><dt>المتبقي</dt><dd>{pkg.remainingSessions} من {pkg.totalSessions}</dd></div><div><dt>تاريخ الانتهاء</dt><dd>{dateText(pkg.expiresAt)}</dd></div></dl>
              <button type="button" onClick={() => { setSelectedClientId(pkg.canonicalClientId); setActiveTab("subscribers"); }}>فتح محفظة العميلة</button>
            </article>
          ))}
          {!loading && !attentionPackages.length ? <p className="bk2-session-empty">لا توجد باقات تحتاج متابعة.</p> : null}
        </div>
      ) : null}

      {selectedClientId ? (
        <aside className="bk2-session-wallet" aria-label="محفظة العميلة">
          <header>
            <div><strong>{selectedClientPackages[0]?.clientName || "محفظة العميلة"}</strong><small dir="ltr">{selectedClientPackages[0]?.phone || selectedClientId}</small></div>
            <button type="button" onClick={() => setSelectedClientId("")} aria-label="إغلاق">×</button>
          </header>
          <div className="bk2-session-wallet-packages">
            {selectedClientPackages.map((pkg) => (
              <article key={pkg.id}><div><strong>{pkg.packageName}</strong><small>{statusLabel(pkg.status)} · تنتهي {dateText(pkg.expiresAt)}</small></div><b>{pkg.remainingSessions}<small> جلسات</small></b></article>
            ))}
          </div>
          <h4>آخر الحركات</h4>
          <div className="bk2-session-wallet-ledger">
            {selectedClientTransactions.slice(0, 12).map((row) => (
              <div key={row.id}><span><strong>{transactionLabel(row.type)}</strong><small>{dateTimeText(row.createdAt)}</small></span><b>{row.sessionsDelta > 0 ? "+" : ""}{row.sessionsDelta}</b></div>
            ))}
            {!selectedClientTransactions.length ? <p>لا توجد حركات مسجلة.</p> : null}
          </div>
        </aside>
      ) : null}

      {grantOpen ? (
        <div
          className="bk2-session-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !grantSaving) {
              setGrantOpen(false);
            }
          }}
        >
          <form
            className="bk2-session-dialog bk2-session-dialog--grant"
            onSubmit={submitGrant}
            aria-label="إضافة جلسة لعميلة"
          >
            <button
              type="button"
              className="bk2-session-dialog-close"
              onClick={() => setGrantOpen(false)}
              disabled={grantSaving}
              aria-label="إغلاق"
            >
              <FiX />
            </button>

            <div className="bk2-session-dialog-icon is-grant">
              <FiPlus />
            </div>
            <h3>إضافة جلسة لعميلة</h3>
            <p>
              أدخلي بيانات العميلة وحددي الباقة وعدد الجلسات. إذا لم يكن لها ملف،
              سيتم إنشاؤه تلقائيًا داخل Core D1.
            </p>

            <div className="bk2-session-grant-grid">
              <label>
                <span>اسم العميلة *</span>
                <input
                  autoFocus
                  value={grantForm.clientName}
                  onChange={(event) =>
                    setGrantForm((current) => ({
                      ...current,
                      clientName: event.target.value,
                    }))
                  }
                  placeholder="مثال: غادة العليان"
                  disabled={grantSaving}
                />
              </label>

              <label>
                <span>رقم الجوال *</span>
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

              <label className="is-wide">
                <span>الباقة أو الخدمة المرتبطة *</span>
                <select
                  value={grantForm.packageCatalogId}
                  onChange={(event) =>
                    setGrantForm((current) => ({
                      ...current,
                      packageCatalogId: event.target.value,
                    }))
                  }
                  disabled={grantSaving || !catalog.length}
                >
                  {!catalog.length ? (
                    <option value="">لا توجد باقات نشطة</option>
                  ) : null}
                  {catalog.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.sessionsCount} جلسات في الكتالوج
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>عدد الجلسات المراد إضافتها *</span>
                <input
                  type="number"
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

              <label>
                <span>تاريخ الانتهاء</span>
                <input
                  type="date"
                  value={grantForm.expiresAt}
                  onChange={(event) =>
                    setGrantForm((current) => ({
                      ...current,
                      expiresAt: event.target.value,
                    }))
                  }
                  disabled={grantSaving}
                />
              </label>

              <label className="is-wide">
                <span>ملاحظة</span>
                <textarea
                  rows={3}
                  value={grantForm.reason}
                  onChange={(event) =>
                    setGrantForm((current) => ({
                      ...current,
                      reason: event.target.value,
                    }))
                  }
                  placeholder="سبب الإضافة أو أي ملاحظة داخلية"
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

            <div className="bk2-session-dialog-actions">
              <button
                type="button"
                className="is-cancel"
                onClick={() => setGrantOpen(false)}
                disabled={grantSaving}
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="is-primary"
                disabled={grantSaving || !catalog.length}
              >
                {grantSaving ? "جاري الإضافة..." : "حفظ وإضافة الجلسة"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {loading && !dashboard.packages.length ? <div className="bk2-session-loading">جاري تحميل بيانات الباقات والجلسات...</div> : null}
    </section>
  );
}
