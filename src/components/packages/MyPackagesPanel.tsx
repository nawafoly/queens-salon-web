import { useEffect, useState } from "react";
import { PackageOperationsService } from "../../services/PackageOperationsService";
import { packageDate } from "./packageFormat";
import "../../styles/SessionPackages.css";

const txLabel: Record<string,string> = { purchase:"شراء", reserve:"حجز", consume:"استخدام", restore:"إلغاء واسترجاع", cancel:"إلغاء", admin_adjustment:"تعديل رصيد", admin_restore:"استرجاع" };

export default function MyPackagesPanel(props: { enabled: boolean }) {
  const [wallet, setWallet] = useState<any | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!props.enabled) { setWallet(null); return; }
    let alive = true; setLoading(true); setError("");
    PackageOperationsService.myWallet().then((value) => { if (alive) setWallet(value); })
      .catch((e) => { if (alive) setError(String(e?.message || "تعذر تحميل باقاتك.")); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [props.enabled]);
  if (!props.enabled) return <section className="session-packages__card"><h3>باقاتي</h3><p>سجّلي الدخول أو تحققي من رقم الجوال للوصول إلى رصيد باقاتك.</p></section>;
  const packages = Array.isArray(wallet?.packages) ? wallet.packages : [];
  const transactions = Array.isArray(wallet?.transactions) ? wallet.transactions : [];
  const services = wallet?.services || {};
  return <section className="session-packages" aria-label="باقاتي"><div className="session-packages__head"><h3>باقاتي</h3>{loading ? <span>جاري التحميل...</span> : null}</div>
    {error ? <div className="session-packages__error">{error.includes("verify") ? "تحققي من رقم الجوال لربط رصيدك القديم بأمان." : error}</div> : null}
    {!loading && !error && !packages.length ? <div className="session-packages__card">لا توجد باقات مرتبطة بحسابك.</div> : null}
    {packages.map((p:any) => <article className="session-packages__card" key={p.id}><div className="session-packages__head"><strong>{p.packageNameSnapshot || "باقة جلسات"}</strong><span>{p.status}</span></div><div className="session-packages__stats"><div className="session-packages__stat"><small>المتبقي</small><strong>{p.remainingSessions || 0}</strong></div><div className="session-packages__stat"><small>المحجوز</small><strong>{p.reservedSessions || 0}</strong></div><div className="session-packages__stat"><small>المستخدم</small><strong>{p.usedSessions || 0}</strong></div><div className="session-packages__stat"><small>ينتهي</small><strong>{packageDate(p.expiresAt)}</strong></div></div><p>الخدمات: {(p.allowedServiceIdsSnapshot || []).map((id:string) => services[id] || id).join("، ")}</p><details><summary>آخر الحركات</summary>{transactions.filter((t:any) => t.clientPackageId === p.id).slice(0,8).map((t:any) => <div key={t.id}>{txLabel[t.type] || t.type} · الرصيد {t.remainingBefore} ← {t.remainingAfter}</div>)}</details></article>)}
  </section>;
}
