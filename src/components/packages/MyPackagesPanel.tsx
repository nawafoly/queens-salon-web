import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PackageOperationsService,
  type PackageClientWalletResult,
  type PackageCatalogRecord,
} from "../../services/PackageOperationsService";
import { packageDate } from "./packageFormat";
import "../../styles/SessionPackages.css";

type WalletPackage = {
  id: string;
  packageNameSnapshot?: string;
  allowedServiceIdsSnapshot?: string[];
  totalSessions?: number;
  remainingSessions?: number;
  reservedSessions?: number;
  usedSessions?: number;
  purchasedAt?: string;
  expiresAt?: string;
  status?: string;
};

type WalletTransaction = {
  id: string;
  clientPackageId?: string;
  type?: string;
  bookingId?: string;
  serviceId?: string;
  sessionsDelta?: number;
  remainingBefore?: number;
  remainingAfter?: number;
  reason?: string;
  createdAt?: string;
};

const txLabel: Record<string, string> = {
  purchase: "شراء الباقة",
  reserve: "حجز جلسة",
  consume: "استخدام جلسة",
  restore: "إعادة جلسة",
  release: "تحرير جلسة محجوزة",
  cancel: "إلغاء الباقة",
  admin_adjustment: "تعديل إداري",
  admin_restore: "استرجاع إداري",
  reapply_used: "إعادة احتساب الجلسة كمستخدمة",
  reapply_reserved: "إعادة حجز الجلسة",
};

const statusLabel: Record<string, string> = {
  active: "نشطة",
  exhausted: "مستهلكة",
  expired: "منتهية",
  cancelled: "ملغاة",
  suspended: "موقوفة",
};

function safeCount(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function readableService(value: string, services: Record<string, string>) {
  const mapped = String(services[value] || "").trim();
  if (mapped && mapped !== value) return mapped;
  return value.replace(/[_-]+/g, " ").trim();
}

export default function MyPackagesPanel(props: {
  enabled: boolean;
  onBrowse?: () => void;
  onSelectAvailable?: (packageId: string) => void;
}) {
  const [wallet, setWallet] = useState<PackageClientWalletResult | null>(null);
  const [available, setAvailable] = useState<PackageCatalogRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!props.enabled) {
      setWallet(null);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [walletResult, catalogResult] = await Promise.all([
        PackageOperationsService.myWallet(),
        PackageOperationsService.myCatalog(),
      ]);
      setWallet(walletResult);
      setAvailable(catalogResult);
    } catch (caught: any) {
      setError(String(caught?.message || "تعذر تحميل باقاتك."));
    } finally {
      setLoading(false);
    }
  }, [props.enabled]);

  useEffect(() => {
    let active = true;
    if (!active) return;
    void load();
    return () => {
      active = false;
    };
  }, [load]);

  const packages = useMemo(
    () => (Array.isArray(wallet?.packages) ? (wallet.packages as WalletPackage[]) : []),
    [wallet]
  );
  const transactions = useMemo(
    () => (Array.isArray(wallet?.transactions) ? (wallet.transactions as WalletTransaction[]) : []),
    [wallet]
  );
  const services = wallet?.services || {};

  if (!props.enabled) {
    return (
      <div className="session-packages__state">
        <strong>يلزم تسجيل الدخول</strong>
        <p>سجّلي الدخول بحسابك للوصول إلى باقاتك ورصيد الجلسات.</p>
      </div>
    );
  }

  if (loading && !wallet) {
    return (
      <div className="session-packages__loading" role="status" aria-live="polite">
        <span className="session-packages__skeleton" />
        <span className="session-packages__skeleton" />
      </div>
    );
  }

  if (error) {
    const message = /verify|phone|identity/i.test(error)
      ? "تعذر مطابقة رصيد الباقات مع حسابك. تحققي من رقم الجوال المسجل."
      : error;
    return (
      <div className="session-packages__state session-packages__state--error" role="alert">
        <strong>تعذر تحميل الباقات</strong>
        <p>{message}</p>
        <button type="button" onClick={() => void load()}>إعادة المحاولة</button>
      </div>
    );
  }

  return (
    <div className="session-packages" aria-label="باقاتي">
      {!packages.length ? (
        <div className="session-packages__state">
          <strong>لا توجد لديك باقات نشطة حاليًا</strong>
          <p>يمكنك اختيار باقة متاحة ثم إتمام الحجز بالخدمة المشمولة.</p>
        </div>
      ) : null}
      {packages.map((pkg) => {
        const total = safeCount(pkg.totalSessions);
        const remaining = safeCount(pkg.remainingSessions);
        const reserved = safeCount(pkg.reservedSessions);
        const used = safeCount(pkg.usedSessions);
        const progress = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
        const packageTransactions = transactions
          .filter((entry) => entry.clientPackageId === pkg.id)
          .slice(0, 12);
        const status = String(pkg.status || "active").toLowerCase();
        const serviceIds = Array.isArray(pkg.allowedServiceIdsSnapshot)
          ? pkg.allowedServiceIdsSnapshot.filter(Boolean)
          : [];

        return (
          <article className="session-packages__wallet-card" key={pkg.id}>
            <header className="session-packages__wallet-head">
              <div>
                <span className="session-packages__eyebrow">باقة جلسات</span>
                <h4>{pkg.packageNameSnapshot || "باقة جلسات"}</h4>
              </div>
              <span className={`session-packages__status is-${status}`}>
                {statusLabel[status] || status}
              </span>
            </header>

            <div className="session-packages__balance-row">
              <div><strong>{remaining}</strong><span>جلسة متبقية</span></div>
              <div><strong>{used}</strong><span>مستخدمة</span></div>
              <div><strong>{reserved}</strong><span>محجوزة</span></div>
              <div><strong>{total}</strong><span>الإجمالي</span></div>
            </div>

            <div className="session-packages__progress" aria-label={`تم استخدام ${progress}% من الباقة`}>
              <div className="session-packages__progress-copy"><span>تقدم الاستخدام</span><bdi dir="ltr">{progress}%</bdi></div>
              <div className="session-packages__progress-track"><span style={{ width: `${progress}%` }} /></div>
            </div>

            <dl className="session-packages__dates">
              <div><dt>تاريخ البداية</dt><dd>{packageDate(pkg.purchasedAt)}</dd></div>
              <div><dt>تاريخ الانتهاء</dt><dd>{packageDate(pkg.expiresAt)}</dd></div>
            </dl>

            <div className="session-packages__services">
              <strong>الخدمات المشمولة</strong>
              {serviceIds.length ? (
                <div>{serviceIds.map((id) => <span key={id}>{readableService(id, services)}</span>)}</div>
              ) : (
                <p>تُعرض الخدمات المشمولة عند توفرها في تعريف الباقة.</p>
              )}
            </div>

            <details className="session-packages__ledger">
              <summary>سجل الجلسات ({packageTransactions.length})</summary>
              {!packageTransactions.length ? <p>لا توجد حركات مسجلة على هذه الباقة بعد.</p> : null}
              {packageTransactions.map((entry) => (
                <div className="session-packages__ledger-row" key={entry.id}>
                  <div>
                    <strong>{txLabel[String(entry.type || "")] || String(entry.type || "حركة جلسة")}</strong>
                    <small>{packageDate(entry.createdAt)}{entry.bookingId ? ` · حجز ${entry.bookingId}` : ""}{entry.reason ? ` · ${entry.reason}` : ""}</small>
                  </div>
                  <span className={Number(entry.sessionsDelta || 0) < 0 ? "is-negative" : "is-positive"}>
                    {Number(entry.sessionsDelta || 0) > 0 ? "+" : ""}{Number(entry.sessionsDelta || 0)}
                  </span>
                </div>
              ))}
            </details>
          </article>
        );
      })}

      <section className="session-packages__available" aria-label="الباقات المتاحة">
        <div className="session-packages__available-head">
          <div><strong>الباقات المتاحة</strong><span>اختاري الباقة المناسبة ثم ابدئي الحجز.</span></div>
          {props.onBrowse ? <button type="button" onClick={props.onBrowse}>عرض صفحة العروض</button> : null}
        </div>
        {!available.length ? <p className="session-packages__muted">لا توجد باقات متاحة للبيع حاليًا.</p> : null}
        <div className="session-packages__available-grid">
          {available.map((item) => (
            <article key={item.id} className="session-packages__catalog-card">
              {item.imageUrl ? <img src={item.imageUrl} alt={item.name} /> : null}
              <div>
                <h5>{item.name}</h5>
                {item.description ? <p>{item.description}</p> : null}
                <div className="session-packages__catalog-meta">
                  <span>{safeCount(item.sessionsCount)} جلسات</span>
                  <span>{Number(item.price || 0).toFixed(2).replace(/\.00$/, "")} ريال</span>
                  {item.validityDays ? <span>صالحة {item.validityDays} يومًا</span> : null}
                </div>
                <button
                  type="button"
                  onClick={() => props.onSelectAvailable?.(item.id)}
                  disabled={!props.onSelectAvailable}
                >
                  احجزي بهذه الباقة
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
