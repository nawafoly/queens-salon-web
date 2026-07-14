import { useCallback, useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../../services/firebase";
import { ClientPackageService, type ClientPackage, type ClientPackageTransaction } from "../../services/ClientPackageService";
import { PackageOperationsService } from "../../services/PackageOperationsService";
import { packageDate, printPackageDocument } from "./packageFormat";
import "../../styles/SessionPackages.css";

const labels: Record<string, string> = { purchase:"شراء", reserve:"حجز", consume:"استخدام", restore:"إلغاء واسترجاع", cancel:"إلغاء باقة", admin_adjustment:"تعديل إداري", admin_restore:"استرجاع إداري" };

export default function ClientPackagesPanel(props: { clientId?: string; canManage: boolean }) {
  const clientId = String(props.clientId || "").trim();
  const [packages, setPackages] = useState<ClientPackage[]>([]);
  const [transactions, setTransactions] = useState<Record<string, ClientPackageTransaction[]>>({});
  const [services, setServices] = useState<Record<string,string>>({});
  const [bookings, setBookings] = useState<Record<string, any[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!clientId) return;
    setBusy(true); setError("");
    try {
      const [rows, serviceSnap] = await Promise.all([
        ClientPackageService.getByClient(clientId),
        getDocs(collection(db, "salons", "main", "services")),
      ]);
      setPackages(rows);
      setServices(Object.fromEntries(serviceSnap.docs.map((d) => [d.id, String(d.data()?.name || d.id)])));
      const txPairs = await Promise.all(rows.map(async (p) => [String(p.id), await ClientPackageService.getTransactions(String(p.id))] as const));
      setTransactions(Object.fromEntries(txPairs));
      const bookingPairs = await Promise.all(rows.map(async (p) => {
        const snap = await getDocs(query(collection(db, "salons", "main", "bookings"), where("clientPackageId", "==", p.id)));
        return [String(p.id), snap.docs.map((d) => ({ id:d.id, ...d.data() }))] as const;
      }));
      setBookings(Object.fromEntries(bookingPairs));
    } catch { setError("تعذر تحميل الباقات والجلسات."); }
    finally { setBusy(false); }
  }, [clientId]);
  useEffect(() => { void load(); }, [load]);

  async function adjust(p: ClientPackage) {
    const raw = window.prompt("عدد الجلسات المراد إضافتها أو خصمها (مثال: 1 أو -1)");
    if (raw === null) return;
    const delta = Number(raw);
    const reason = window.prompt("سبب التعديل الإداري") || "";
    if (!Number.isInteger(delta) || !delta || !reason.trim()) return setError("يلزم إدخال عدد صحيح وسبب واضح.");
    setBusy(true); try { await PackageOperationsService.adjust(String(p.id), delta, reason); await load(); } catch(e:any){ setError(e.message); } finally { setBusy(false); }
  }
  async function cancel(p: ClientPackage) {
    const reason = window.prompt("سبب إلغاء الباقة"); if (!reason?.trim()) return;
    if (!window.confirm(`تأكيد إلغاء ${p.packageNameSnapshot}؟`)) return;
    setBusy(true); try { await PackageOperationsService.cancel(String(p.id), reason); await load(); } catch(e:any){ setError(e.message); } finally { setBusy(false); }
  }
  async function restore(booking: any) {
    const reason = window.prompt("سبب استرجاع الجلسة المستخدمة"); if (!reason?.trim()) return;
    setBusy(true); try { await PackageOperationsService.restoreConsumed(String(booking.id), reason); await load(); } catch(e:any){ setError(e.message); } finally { setBusy(false); }
  }
  async function invoice(p: ClientPackage) {
    const invoiceDocumentId = p.invoiceDocumentId || (p.invoiceId ? `invoice_${p.invoiceId}` : "");
    if (!invoiceDocumentId) return setError("لا يوجد مرجع فاتورة لهذه الباقة.");
    const snap = await getDoc(doc(db, "salons", "main", "invoices", invoiceDocumentId));
    if (!snap.exists()) return setError("تعذر العثور على الفاتورة الأصلية.");
    const v:any = snap.data();
    printPackageDocument(`فاتورة ${v.invoiceNumber || p.invoiceId}`, `<b>الباقة:</b> ${p.packageNameSnapshot}<br><b>الجلسات:</b> ${p.totalSessions}<br><b>قبل الضريبة:</b> ${Number(v.subtotal||0).toFixed(2)} ر.س<br><b>الضريبة:</b> ${Number(v.taxAmount||0).toFixed(2)} ر.س<br><b>الإجمالي:</b> ${Number(v.total||0).toFixed(2)} ر.س<br><b>طريقة الدفع:</b> ${v.paymentMethod||"—"}<br><b>تاريخ الانتهاء:</b> ${packageDate(p.expiresAt)}`);
  }

  if (!clientId) return <div className="session-packages__error">لا يوجد clientId ثابت لهذا الملف؛ لا يمكن عرض رصيد بالاعتماد على الهاتف فقط.</div>;
  return <section className="session-packages" aria-label="الباقات والجلسات"><div className="session-packages__head"><h3>الباقات والجلسات</h3><button type="button" className="session-packages__button secondary" onClick={() => void load()} disabled={busy}>تحديث</button></div>
    {error ? <div className="session-packages__error">{error}</div> : null}
    {!busy && !packages.length ? <div className="session-packages__card">لا توجد باقات مسجلة.</div> : null}
    {packages.map((p) => <article key={p.id} className="session-packages__card">
      <div className="session-packages__head"><div><strong>{p.packageNameSnapshot}</strong><span className="session-packages__muted">الحالة: {p.status}</span></div><span>فاتورة: {p.invoiceNumber || p.invoiceId || "—"}</span></div>
      <div className="session-packages__stats"><div className="session-packages__stat"><small>الإجمالي</small><strong>{p.totalSessions}</strong></div><div className="session-packages__stat"><small>المتبقي</small><strong>{p.remainingSessions}</strong></div><div className="session-packages__stat"><small>المحجوز</small><strong>{p.reservedSessions}</strong></div><div className="session-packages__stat"><small>المستخدم</small><strong>{p.usedSessions}</strong></div></div>
      <p className="session-packages__muted">الشراء: {packageDate(p.purchasedAt)} · الانتهاء: {packageDate(p.expiresAt)}</p><p>الخدمات: {p.allowedServiceIdsSnapshot.map((id) => services[id] || id).join("، ")}</p>
      <details><summary>سجل الحركات ({transactions[String(p.id)]?.length || 0})</summary>{(transactions[String(p.id)] || []).map((t) => <div key={t.id}>{labels[t.type] || t.type}: {t.remainingBefore} ← {t.remainingAfter} {t.reason ? `· ${t.reason}` : ""}</div>)}</details>
      <details><summary>الحجوزات المرتبطة ({bookings[String(p.id)]?.length || 0})</summary>{(bookings[String(p.id)] || []).map((b) => <div key={b.id}>{b.publicId || b.id} · {b.serviceName} · {b.date} {b.time} · {b.status} {props.canManage && b.packageRedemptionState === "consumed" ? <button type="button" onClick={() => void restore(b)}>استرجاع جلسة</button> : null}</div>)}</details>
      <div className="session-packages__actions"><button type="button" className="session-packages__button secondary" onClick={() => void invoice(p)}>فتح الفاتورة الأصلية</button>{props.canManage ? <><button type="button" className="session-packages__button secondary" onClick={() => void adjust(p)} disabled={busy}>تعديل الرصيد</button><button type="button" className="session-packages__button danger" onClick={() => void cancel(p)} disabled={busy || p.status === "cancelled"}>إلغاء الباقة</button></> : null}</div>
    </article>)}
  </section>;
}
